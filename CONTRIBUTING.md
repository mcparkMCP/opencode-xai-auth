# Contributing to opencode-xai-auth

## Getting started

```bash
git clone https://github.com/mcparkMCP/opencode-xai-auth.git
cd opencode-xai-auth
```

No build step — the plugin is a single `index.mjs` ES module.

## Local testing

Point OpenCode at your local copy:

```json
{
  "plugin": ["file:///path/to/opencode-xai-auth/index.mjs"]
}
```

Then run `opencode auth login`, select xai, and test with your SSO cookie.

## Project structure

```
index.mjs       — Entire plugin (single file, ~300 lines)
package.json    — npm metadata
README.md       — User-facing documentation
CONTRIBUTING.md — This file
```

The plugin is intentionally kept as a single file with zero production dependencies. This matches the pattern established by the official `opencode-anthropic-auth` plugin.

## What to work on

### High-value contributions

- **Testing against current grok.com API**: The internal API format was reverse-engineered from community projects (GrokProxy, grok3-api, swift-grok). If grok.com has changed their payload format, the plugin needs updating.
- **Better model name mapping**: The plugin currently passes model names through directly. If opencode uses model IDs that differ from what grok.com expects, a mapping table is needed.
- **Cookie refresh**: Currently the user has to manually re-authenticate when cookies expire. An automated refresh mechanism would improve UX.

### Known limitations that need solutions

- **No tool/function calling**: Grok's internal web API doesn't support OpenAI-style tool calling. This is the biggest limitation for use as a coding agent. If xAI adds tool support to their web API, or exposes a proper OAuth flow for their official API, this plugin should be updated.
- **Single-turn context only**: Each request creates a new conversation on grok.com. The full message history is sent each time, but long conversations may hit payload size limits.

### If xAI adds proper OAuth

If xAI ever exposes a public OAuth flow (like OpenAI did for Codex), the plugin should be rewritten to use that instead of cookie-based auth. The auth method would change from cookie paste to a real PKCE flow:

```js
// Hypothetical future implementation
import { generatePKCE } from "@openauthjs/openauth/pkce"

async authorize() {
  const { challenge, verifier } = await generatePKCE()
  const url = `https://auth.x.ai/oauth/authorize?client_id=...&code_challenge=${challenge}&...`
  return { url, verifier }
}
```

## Code style

- No build tooling, no TypeScript — plain ES modules
- Use JSDoc for type hints: `/** @type {import('@opencode-ai/plugin').Plugin} */`
- Keep it in one file unless there's a strong reason to split
