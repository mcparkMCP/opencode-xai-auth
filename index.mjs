// opencode-xai-auth — Grok SSO cookie auth plugin for OpenCode
//
// Intercepts requests to api.x.ai and redirects them through grok.com's
// internal API using browser SSO cookies. This lets you use your
// Grok/SuperGrok subscription instead of paying for API credits.
//
// Limitation: grok.com's internal API does not support tool/function calling.
// The plugin works for chat/completion but the coding agent's tool-based
// workflow (file reads, edits, shell commands) will not function in SSO mode.
// For full agent functionality, use the "xAI API Key" method instead.

const GROK_API_URL = "https://grok.com/rest/app-chat/conversations/new"

const GROK_HEADERS = {
  "accept": "*/*",
  "accept-language": "en-GB,en;q=0.9",
  "content-type": "application/json",
  "origin": "https://grok.com",
  "referer": "https://grok.com/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull text out of string or content-block arrays (multimodal messages). */
function extractContent(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
  }
  return JSON.stringify(content)
}

/**
 * Convert an OpenAI-style messages array into a single `message` string and
 * a `customInstructions` string that Grok's internal API understands.
 *
 * Tool calls and tool results are inlined as text so conversation context is
 * preserved even though Grok cannot execute tools.
 */
function formatMessages(messages) {
  const systemParts = []
  const conversationParts = []

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        systemParts.push(extractContent(msg.content))
        break

      case "user":
        conversationParts.push(`User: ${extractContent(msg.content)}`)
        break

      case "assistant":
        if (msg.tool_calls) {
          const calls = msg.tool_calls
            .map(
              (tc) =>
                `[tool_call: ${tc.function?.name ?? tc.name}(${tc.function?.arguments ?? ""})]`
            )
            .join("\n")
          conversationParts.push(`Assistant: ${calls}`)
        } else {
          const text = extractContent(msg.content)
          if (text) conversationParts.push(`Assistant: ${text}`)
        }
        break

      case "tool":
        conversationParts.push(
          `Tool Result (${msg.name || msg.tool_call_id || "tool"}): ${extractContent(msg.content)}`
        )
        break
    }
  }

  return {
    message: conversationParts.join("\n\n"),
    customInstructions: systemParts.join("\n"),
  }
}

/** Build the JSON payload that grok.com/rest/app-chat/conversations/new expects. */
function buildGrokPayload(message, modelName, customInstructions) {
  return {
    temporary: true,
    modelName: modelName || "grok-3",
    message,
    fileAttachments: [],
    imageAttachments: [],
    disableSearch: true,
    enableImageGeneration: false,
    returnImageBytes: false,
    returnRawGrokInXaiRequest: false,
    enableImageStreaming: false,
    imageGenerationCount: 0,
    forceConcise: false,
    toolOverrides: {},
    enableSideBySide: false,
    isPreset: false,
    sendFinalMetadata: true,
    customInstructions: customInstructions || "",
    deepsearchPreset: "",
    isReasoning: false,
  }
}

// ---------------------------------------------------------------------------
// Response transformers — Grok NDJSON ➜ OpenAI SSE / JSON
// ---------------------------------------------------------------------------

/**
 * Transform a Grok NDJSON streaming response into an OpenAI-compatible
 * Server-Sent Events stream.
 *
 * Grok sends one JSON object per line:
 *   {"result":{"response":{"token":"Hello"}}}
 *
 * We emit:
 *   data: {"id":"...","object":"chat.completion.chunk",...}\n\n
 */
function createSSEResponse(grokResponse, model) {
  const id = `chatcmpl-${crypto.randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  let isFirst = true
  let buffer = ""
  let sentDone = false

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += new TextDecoder().decode(chunk)
      const lines = buffer.split("\n")
      buffer = lines.pop() || "" // keep last (possibly incomplete) line

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          const token = data?.result?.response?.token
          const modelResponse = data?.result?.response?.modelResponse

          if (token) {
            const sseData = {
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  delta: isFirst
                    ? { role: "assistant", content: token }
                    : { content: token },
                  index: 0,
                  finish_reason: null,
                },
              ],
            }
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify(sseData)}\n\n`
              )
            )
            isFirst = false
          }

          if (modelResponse) {
            // If we haven't streamed any tokens yet, emit the full message
            if (isFirst && modelResponse.message) {
              const fullData = {
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    delta: { role: "assistant", content: modelResponse.message },
                    index: 0,
                    finish_reason: null,
                  },
                ],
              }
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify(fullData)}\n\n`
                )
              )
            }
            const stopData = {
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
            }
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify(stopData)}\n\n`
              )
            )
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
            sentDone = true
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    },

    flush(controller) {
      // Handle any remaining data in the buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer)
          const token = data?.result?.response?.token
          if (token && !sentDone) {
            const sseData = {
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  delta: isFirst
                    ? { role: "assistant", content: token }
                    : { content: token },
                  index: 0,
                  finish_reason: null,
                },
              ],
            }
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify(sseData)}\n\n`
              )
            )
          }
        } catch {
          // ignore
        }
      }
      // Ensure we always close the stream properly
      if (!sentDone) {
        const stopData = {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
        }
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify(stopData)}\n\n`
          )
        )
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
      }
    },
  })

  return new Response(grokResponse.body.pipeThrough(transform), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  })
}

/**
 * Collect a full Grok NDJSON response and return it as a single
 * OpenAI-compatible chat.completion JSON response.
 */
async function createJsonResponse(grokResponse, model) {
  const text = await grokResponse.text()
  const lines = text.split("\n").filter((l) => l.trim())
  let fullContent = ""

  for (const line of lines) {
    try {
      const data = JSON.parse(line)
      const modelResponse = data?.result?.response?.modelResponse
      if (modelResponse?.message) {
        fullContent = modelResponse.message
        break
      }
      const token = data?.result?.response?.token
      if (token) fullContent += token
    } catch {
      // skip
    }
  }

  return new Response(
    JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          message: { role: "assistant", content: fullContent },
          index: 0,
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  )
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Accept cookies in multiple formats:
 *  - Full cookie header string (RECOMMENDED): "sso=abc; sso-rw=xyz; cf_clearance=..."
 *  - Single key=value:                        "sso=abc123"
 *  - Bare SSO value:                          "abc123..."
 *
 * IMPORTANT: grok.com is behind Cloudflare. The full cookie header
 * (including cf_clearance) is needed to avoid the Cloudflare JS challenge.
 * Paste the ENTIRE Cookie header from DevTools, not just the sso value.
 */
function formatCookie(raw) {
  if (!raw) return ""
  raw = raw.trim()
  if (raw.includes("=") && raw.includes(";")) return raw
  if (raw.startsWith("sso=")) return raw
  return `sso=${raw}`
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

/** @type {import('@opencode-ai/plugin').Plugin} */
export async function XaiAuthPlugin({ client }) {
  return {
    auth: {
      provider: "xai",

      loader: async (getAuth, provider) => {
        const auth = await getAuth()
        if (!auth || auth.type !== "oauth") return {}

        const cookie = formatCookie(auth.access)
        if (!cookie) return {}

        // Zero out model costs for subscription users
        if (provider?.models) {
          for (const model of Object.values(provider.models)) {
            if (model.cost) {
              model.cost = {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              }
            }
          }
        }

        return {
          fetch: async (input, init) => {
            const url =
              typeof input === "string"
                ? input
                : input?.url || String(input)

            // Intercept chat/completions requests
            if (
              !url.includes("/chat/completions") &&
              !url.includes("/v1/messages")
            ) {
              // Handle /v1/models locally
              if (url.includes("/models")) {
                return new Response(
                  JSON.stringify({
                    object: "list",
                    data: [
                      { id: "grok-3", object: "model", created: 1700000000, owned_by: "xai" },
                      { id: "grok-2", object: "model", created: 1700000000, owned_by: "xai" },
                    ],
                  }),
                  {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  }
                )
              }
              // Pass through anything else
              return fetch(input, init)
            }

            // Parse the OpenAI-format request body
            let body
            try {
              const bodyText =
                typeof init?.body === "string"
                  ? init.body
                  : await new Response(init?.body).text()
              body = JSON.parse(bodyText)
            } catch (e) {
              throw new Error(
                `opencode-xai-auth: failed to parse request body: ${e.message}`
              )
            }

            const {
              messages = [],
              model = "grok-3",
              stream = false,
            } = body

            const { message, customInstructions } =
              formatMessages(messages)

            const grokPayload = buildGrokPayload(
              message,
              model,
              customInstructions
            )

            // Call Grok's internal API
            const grokResponse = await fetch(GROK_API_URL, {
              method: "POST",
              headers: { ...GROK_HEADERS, cookie },
              body: JSON.stringify(grokPayload),
            })

            if (
              grokResponse.status === 401 ||
              grokResponse.status === 403
            ) {
              throw new Error(
                "opencode-xai-auth: Cookie expired or Cloudflare challenge triggered. " +
                  "Run `opencode auth login` and paste the FULL Cookie header " +
                  "(including cf_clearance) from grok.com DevTools → Network → " +
                  "any request → Headers → Cookie"
              )
            }

            if (!grokResponse.ok) {
              const errText = await grokResponse
                .text()
                .catch(() => "unknown error")
              throw new Error(
                `opencode-xai-auth: Grok API error ${grokResponse.status}: ${errText}`
              )
            }

            return stream
              ? createSSEResponse(grokResponse, model)
              : createJsonResponse(grokResponse, model)
          },
        }
      },

      methods: [
        {
          type: "oauth",
          label: "Grok Cookie (grok.com subscription)",
          async authorize() {
            return { url: "https://grok.com", verifier: "" }
          },
          async callback(code, _verifier) {
            // cf_clearance typically expires in 30min-2hrs, sso lasts longer.
            // Use the shorter expiry as a conservative estimate.
            return {
              type: "success",
              access: code.trim(),
              refresh: "",
              expires: Date.now() + 2 * 60 * 60 * 1000, // 2 hours (cf_clearance lifetime)
            }
          },
        },
        {
          type: "api",
          label: "xAI API Key (console.x.ai)",
        },
      ],
    },
  }
}
