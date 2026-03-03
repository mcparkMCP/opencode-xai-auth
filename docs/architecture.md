# Architecture

## Overview

```
┌─────────────┐       ┌──────────────────┐       ┌─────────────────┐
│   OpenCode   │──────▶│  opencode-xai-   │──────▶│   grok.com      │
│   AI SDK     │       │  auth plugin     │       │   internal API  │
│              │◀──────│                  │◀──────│                 │
└─────────────┘       └──────────────────┘       └─────────────────┘
    OpenAI format         Translates              NDJSON format
    (messages, tools,     request/response        (single message,
     SSE streaming)       formats                  token streaming)
```

## Request flow

### SSO Cookie mode

1. OpenCode's AI SDK constructs an OpenAI-format request to `api.x.ai/v1/chat/completions`
2. The plugin's custom `fetch` interceptor catches the request
3. The OpenAI messages array is flattened:
   - `system` messages → `customInstructions` field
   - `user`/`assistant`/`tool` messages → concatenated into a single `message` string
4. A new request is built for `grok.com/rest/app-chat/conversations/new`
5. The SSO cookie is injected in the `Cookie` header along with browser-like headers
6. Grok responds with newline-delimited JSON (NDJSON), one JSON object per line
7. The plugin transforms this into OpenAI-compatible SSE or a single JSON response
8. The transformed response is returned to the AI SDK

### API Key mode

1. OpenCode's AI SDK constructs a request to `api.x.ai/v1/chat/completions`
2. The plugin returns an empty config from the loader
3. The platform handles auth natively (Bearer token in Authorization header)
4. No translation needed — xAI's official API is OpenAI-compatible

## Grok internal API details

### Endpoint

```
POST https://grok.com/rest/app-chat/conversations/new
```

### Request payload

```json
{
  "temporary": true,
  "modelName": "grok-3",
  "message": "the user's message",
  "customInstructions": "system prompt",
  "fileAttachments": [],
  "imageAttachments": [],
  "disableSearch": true,
  "enableImageGeneration": false,
  "returnImageBytes": false,
  "returnRawGrokInXaiRequest": false,
  "enableImageStreaming": false,
  "imageGenerationCount": 0,
  "forceConcise": false,
  "toolOverrides": {},
  "enableSideBySide": false,
  "isPreset": false,
  "sendFinalMetadata": true,
  "deepsearchPreset": "",
  "isReasoning": false
}
```

### Response format (NDJSON)

Each line is a standalone JSON object:

```
{"result":{"response":{"token":"Hello"}}}
{"result":{"response":{"token":" world"}}}
{"result":{"response":{"token":"!"}}}
{"result":{"response":{"modelResponse":{"message":"Hello world!"}}}}
```

- `result.response.token` — partial text fragment (streaming)
- `result.response.modelResponse.message` — complete final message
- `result.response.isThinking` — reasoning indicator (unused currently)
- `result.response.isSoftStop` — pause indicator (skipped)

### Required headers

| Header | Value | Purpose |
|---|---|---|
| `content-type` | `application/json` | Request body format |
| `origin` | `https://grok.com` | CORS origin |
| `referer` | `https://grok.com/` | Referrer |
| `cookie` | `sso=...` | Session authentication |
| `user-agent` | Chrome UA string | Browser impersonation |
| `sec-fetch-*` | Standard values | Fetch metadata |

### Required cookies

| Cookie | Purpose |
|---|---|
| `sso` | Main SSO session token (required) |
| `sso-rw` | Read-write SSO token (optional but recommended) |
| `x-anonuserid` | Anonymous user ID (optional) |
| `x-challenge` | Challenge token (optional) |
| `x-signature` | Signature validation (optional) |

The minimum required cookie is `sso`. Including all five provides the most reliable authentication.

## OpenAI SSE translation

The plugin translates Grok's NDJSON tokens into OpenAI SSE format:

```
Grok NDJSON:
{"result":{"response":{"token":"Hi"}}}

Becomes SSE:
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234,"model":"grok-3","choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":null}]}
```

Stream termination:

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234,"model":"grok-3","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}

data: [DONE]
```

## Plugin interface

The plugin implements the `@opencode-ai/plugin` `Plugin` type:

```
XaiAuthPlugin({ client })
  └── returns
      └── auth
          ├── provider: "xai"
          ├── loader(getAuth, provider) → { fetch }
          │   └── Custom fetch intercepts api.x.ai → grok.com
          └── methods[]
              ├── [0] type:"oauth"  — SSO cookie flow
              │   ├── authorize()   → { url: "https://grok.com", verifier: "" }
              │   └── callback(code) → { type:"success", access: cookie }
              └── [1] type:"api"    — Standard API key entry
```

The `loader` function is called once during initialization. It:
1. Calls `getAuth()` to retrieve stored credentials
2. If type is `"oauth"` (SSO cookie), returns a custom `fetch` that intercepts and translates requests
3. If type is anything else, returns `{}` and lets the platform handle auth natively

## Message formatting

Multi-turn OpenAI conversations are flattened for Grok's single-message API:

```
OpenAI messages:
[
  { role: "system", content: "You are helpful" },
  { role: "user", content: "What is 2+2?" },
  { role: "assistant", content: "4" },
  { role: "user", content: "And 3+3?" }
]

Becomes:
customInstructions: "You are helpful"
message: "User: What is 2+2?\n\nAssistant: 4\n\nUser: And 3+3?"
```

Tool calls and results are inlined as text to preserve context:

```
Assistant: [tool_call: readFile({"path":"/src/main.ts"})]

Tool Result (readFile): <file contents>
```
