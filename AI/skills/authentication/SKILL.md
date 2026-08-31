---
name: authentication
description: Authenticate SDK clients using server-held developer API keys, short-lived browser temporary keys, apiKeyScope (private/public), and per-channel passwords. Covers the secure frontend/backend handoff and credential boundaries.
when_to_use: Use when configuring developer or temporary keys, choosing private vs public key scope, setting channel passwords, or debugging auth failures.
---

# Authentication

## Concept

Three independent credentials, each protecting a different layer:

1. **Developer API key** — identifies your app to the messaging service. Keep
   it in the backend environment; it may call the platform directly and may
   mint a browser key. Never ship it in browser or mobile code.
2. **Temporary key** — a short-lived key minted by the authenticated backend
   for a signed-in browser that needs its own platform connection. Call
   `POST /messaging-platform/api/v1/messaging-service/channels/api-access`
   from the backend with `X-API-Key: $MESSAGING_PLATFORM_API_KEY`, then return
   only `data.temporaryKey` to the browser. Prefer `singleUse: true`; honor the
   granted `expiresAt`/`ttlSeconds` in the response.
3. **`apiKeyScope`** — `"private"` (default) or `"public"`. Controls **channel
   isolation** — it determines how the channel ID is computed on `connect(...)`:
   - `"private"`: channel ID = `channelName + password + apiKey`. Same name/password
     but different API key → **separate isolated channels**. Use for production,
     multi-tenant systems, and any case where channels must be siloed per developer.
   - `"public"`: channel ID = `channelName + password` only. API key is excluded →
     **shared channel across any API key**. Use for testing with teammates, demos,
     and cross-developer collaboration where everyone needs to land on the same channel.
4. **Channel password** — `channelPassword` on `connect(...)`. Protects an
   individual channel regardless of API key.

## API entry points

- Constructor: `MessagingChannelApi(remoteUrl, developerApiKey="")`
  in `agents/cpp-agent/include/hmdev/messaging/api/messaging_channel_api.h`
- `apiKeyScope` parameter on the extended `connect(...)` overloads (same header).
- Web client surface exposes `usePubKey` on the connection options
  (see `WEB-AGENT-GUIDE.md`).

## Minimal example

```js
// Browser: ask your authenticated backend, never the platform directly.
const { temporaryKey } = await fetch('/api/messaging-access', {
  method: 'POST', credentials: 'same-origin'
}).then((response) => response.json());

const agent = new AgentConnection({ apiKey: temporaryKey, usePubKey: false });
agent.connect({
  channelName: 'lobby',
  channelPassword: 'secret',
  agentName: 'alice',
  apiKeyScope: 'private'
});
```

The backend uses its developer API key directly for server-to-server work; it
does not need a temporary key for that path.

## Scope quick-reference

| Scenario | Scope |
|----------|-------|
| Production app, multi-tenant, data isolation | `private` |
| Testing with teammates, SDK demos | `public` |
| Cross-developer collaboration on same channel | `public` |
| Server-side Python/Java agent (your own channel) | `private` |

## Notes for assistants

- `apiKeyScope` is a **namespace mechanism**: private scope namespaces channels
  per API key; public scope removes that namespace so channels are shared.
- Never embed a developer API key in browser/client code. Browser clients that
  need platform access receive a temporary key from the app's authenticated
  backend; `apiKeyScope` is a channel namespace, not a substitute for a secret.
- Channel password and API key are orthogonal; a wrong password fails connect
  even with a valid key.
- Public-key encryption hooks exist in the C++ client but are currently noted as
  not implemented (`setUsePublicKey`); don't present it as active encryption.
