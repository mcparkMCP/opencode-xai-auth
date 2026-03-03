# opencode-xai-auth

xAI Grok SSO authentication plugin for [OpenCode](https://github.com/sst/opencode). Use your Grok/SuperGrok subscription instead of paying for API credits.

## How it works

This plugin intercepts requests to `api.x.ai` and redirects them through `grok.com`'s internal web API using your browser session cookies. It translates between the OpenAI-compatible format that OpenCode uses and Grok's internal NDJSON streaming format.

## Install

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-xai-auth@latest"]
}
```

Or for local development:

```json
{
  "plugin": ["file:///path/to/opencode-xai-auth/index.mjs"]
}
```

## Setup

### Method 1: Grok SSO Cookie (subscription-based, no API credits)

1. Run `opencode auth login`
2. Select **xai** as the provider
3. Select **Grok SSO Cookie (grok.com subscription)**
4. OpenCode will open `grok.com` — log in if needed
5. Get your SSO cookie (see below)
6. Paste it when prompted

#### How to get your SSO cookie

**Option A — From DevTools Cookies panel:**

1. Open [grok.com](https://grok.com) in your browser (make sure you're logged in)
2. Open DevTools (`F12` or `Cmd+Option+I`)
3. Go to **Application** → **Cookies** → `https://grok.com`
4. Find the `sso` cookie
5. Copy its **Value**
6. Paste into OpenCode

**Option B — From a network request (includes all cookies):**

1. Open [grok.com](https://grok.com) and open DevTools → **Network** tab
2. Send any message in the Grok chat
3. Find the request to `grok.com/rest/app-chat/conversations/new`
4. Right-click → **Copy** → **Copy as cURL**
5. Find the `-H 'cookie: ...'` part and copy the full cookie value
6. Paste into OpenCode

### Method 2: xAI API Key (standard, uses API credits)

1. Run `opencode auth login`
2. Select **xai** as the provider
3. Select **xAI API Key (console.x.ai)**
4. Paste your API key from [console.x.ai](https://console.x.ai)

This is the same as setting `XAI_API_KEY` — the plugin just makes it available through `opencode auth login`.

## Limitations

### No tool/function calling in SSO mode

This is the big one. Grok's internal web API (`grok.com/rest/app-chat/conversations/new`) does **not** support OpenAI-style tool/function calling. This means:

- OpenCode's coding agent features (file reads, edits, shell commands) **will not work** in SSO cookie mode
- The LLM cannot call tools, so it operates in a chat-only mode
- For full agent functionality, use the **xAI API Key** method instead

### Other limitations

- **No conversation persistence**: Each request creates a new conversation on Grok's side. OpenCode manages context by sending the full message history each time.
- **No token counting**: Usage stats are reported as zero since Grok's internal API doesn't expose token counts.
- **Cookie expiration**: SSO cookies expire (typically after a few days to a week). When they expire, you'll see a clear error telling you to re-authenticate.
- **Fragile**: This relies on Grok's undocumented internal API. It can break at any time if xAI changes their web app.
- **Possible ToS issues**: Using browser cookies to access Grok programmatically may violate xAI's Terms of Service. Use at your own risk.

## Cookie expiration

When your SSO cookie expires, you'll see:

```
opencode-xai-auth: SSO cookie expired or invalid.
Run `opencode auth login` and paste a fresh cookie from grok.com DevTools
```

Just run `opencode auth login` again and paste a fresh cookie.

## How the translation works

| OpenAI format | Grok internal format |
|---|---|
| `messages[role=system].content` | `customInstructions` |
| `messages[role=user].content` | Concatenated into `message` |
| `messages[role=assistant].content` | Concatenated into `message` |
| `messages[role=tool]` | Inlined as text in `message` |
| `stream: true` | Always streams (NDJSON → SSE) |
| `model` | `modelName` |

## References

Built by studying these projects:

- [CNFlyCat/GrokProxy](https://github.com/CNFlyCat/GrokProxy) — Python reverse proxy with cookie rotation
- [klu-ai/swift-grok](https://github.com/klu-ai/swift-grok) — Swift proxy with OpenAI-compatible API
- [mem0ai/grok3-api](https://github.com/mem0ai/grok3-api) — Python client with cookie auth
- [opencode-anthropic-auth](https://github.com/anomalyco/opencode-anthropic-auth) — Reference plugin implementation

## License

MIT
