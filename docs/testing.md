# Testing Guide

## Prerequisites

- [OpenCode](https://github.com/sst/opencode) installed
- A Grok/SuperGrok subscription (for SSO cookie method)
- Or an xAI API key from [console.x.ai](https://console.x.ai) (for API key method)

## Quick start

### 1. Point OpenCode at the local plugin

Add to `~/.config/opencode/opencode.json` (or your project's `opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///path/to/opencode-xai-auth/index.mjs"]
}
```

### 2. Authenticate

```bash
opencode auth login
```

Select `xai`, then choose your auth method.

### 3. Test basic chat

Start opencode and send a simple message. Check for:

- [ ] Response comes back from Grok
- [ ] Streaming works (text appears incrementally)
- [ ] No errors in the console

## Test cases

### SSO Cookie auth

| Test | Expected | Status |
|---|---|---|
| Paste full cookie string (`sso=...;sso-rw=...;...`) | Stores and works | Untested |
| Paste just SSO value (no `sso=` prefix) | Auto-prefixed, works | Untested |
| Paste `sso=VALUE` format | Works | Untested |
| Expired cookie | Clear error message prompting re-auth | Untested |
| Invalid/garbage cookie | 401/403 error with clear message | Untested |

### Streaming

| Test | Expected | Status |
|---|---|---|
| `stream: true` request | SSE chunks with `data: {...}\n\n` format | Untested |
| `stream: false` request | Single JSON response | Untested |
| Stream includes `[DONE]` terminator | Yes | Untested |
| First chunk has `role: "assistant"` in delta | Yes | Untested |
| Last chunk has `finish_reason: "stop"` | Yes | Untested |

### Message formatting

| Test | Expected | Status |
|---|---|---|
| System message → customInstructions | System content in customInstructions field | Untested |
| Multi-turn conversation | All messages concatenated in message field | Untested |
| Messages with tool_calls | Inlined as text | Untested |
| Messages with content arrays (multimodal) | Text parts extracted | Untested |

### Error handling

| Test | Expected | Status |
|---|---|---|
| Cookie expired (401) | Error: "SSO cookie expired..." | Untested |
| Cookie invalid (403) | Error: "SSO cookie expired..." | Untested |
| Grok API changed format | Graceful error, no crash | Untested |
| Network timeout | Fetch error propagated | Untested |

## Debugging

### Check what's being sent to Grok

Add temporary logging in `index.mjs` inside the fetch interceptor:

```js
console.log("[xai-auth] Sending to Grok:", JSON.stringify(grokPayload, null, 2))
console.log("[xai-auth] Cookie:", cookie.substring(0, 20) + "...")
```

### Check the response

```js
// Before the transform, log the raw response
const rawText = await grokResponse.clone().text()
console.log("[xai-auth] Raw Grok response:", rawText.substring(0, 500))
```

### Test the Grok endpoint directly

```bash
curl -X POST https://grok.com/rest/app-chat/conversations/new \
  -H "content-type: application/json" \
  -H "origin: https://grok.com" \
  -H "referer: https://grok.com/" \
  -H "cookie: sso=YOUR_SSO_COOKIE_HERE" \
  -H "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -d '{
    "temporary": true,
    "modelName": "grok-3",
    "message": "Say hello",
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
    "customInstructions": "",
    "deepsearchPreset": "",
    "isReasoning": false
  }'
```

If this returns a streaming response with JSON lines, the API format is still correct. If it returns an error or different format, the plugin needs updating.

## Publishing

Once tested and working:

```bash
npm publish
```

Then users can install with:

```json
{
  "plugin": ["opencode-xai-auth@latest"]
}
```
