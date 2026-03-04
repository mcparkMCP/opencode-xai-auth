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

#### How to get your cookies

> **IMPORTANT:** grok.com is behind Cloudflare. You need the **full Cookie header** (including `cf_clearance`), not just the `sso` value. The `cf_clearance` cookie proves a real browser solved the Cloudflare challenge.

**Recommended — Copy full cookie string from Network tab:**

1. Open [grok.com](https://grok.com) in your browser (make sure you're logged in)
2. Open DevTools (`F12` or `Cmd+Option+I`) → **Network** tab
3. Send any message in the Grok chat
4. Find the request to `grok.com/rest/app-chat/conversations/new`
5. Click it → **Headers** tab → scroll to **Request Headers** → find `cookie:`
6. Copy the **entire cookie value** (it will contain `cf_clearance=...; sso=...; sso-rw=...` etc.)
7. Paste into OpenCode

**Alternative — Copy as cURL:**

1. Same as above, but right-click the request → **Copy** → **Copy as cURL**
2. Find the `-H 'cookie: ...'` part and copy the full cookie value

> **Note:** The `cf_clearance` cookie expires every 30 minutes to 2 hours. You'll need to re-paste periodically. The `sso` cookie lasts longer (days).

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
- **Cloudflare protection**: grok.com uses Cloudflare's JS challenge. You must include the `cf_clearance` cookie (obtained by your browser solving the challenge). This cookie expires every **30 minutes to 2 hours**, so you'll need to re-paste cookies frequently.
- **Cookie expiration**: `cf_clearance` expires quickly (~2 hours). `sso` cookies last longer (~days). When either expires, you'll see a clear error.
- **Fragile**: This relies on Grok's undocumented internal API and Cloudflare cookie replay. It can break if xAI changes their API or Cloudflare tightens their challenge.
- **Possible ToS issues**: Using browser cookies to access Grok programmatically may violate xAI's Terms of Service. Use at your own risk.

## Cookie expiration

When your cookies expire (most likely `cf_clearance`), you'll see:

```
opencode-xai-auth: Cookie expired or Cloudflare challenge triggered.
Run `opencode auth login` and paste the FULL Cookie header...
```

Just run `opencode auth login` again, go back to grok.com, grab fresh cookies from DevTools Network tab, and paste.

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
