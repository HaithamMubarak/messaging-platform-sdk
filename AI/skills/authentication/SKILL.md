---
name: authentication
description: Authenticate SDK clients using developer API keys, apiKeyScope (private/public), and per-channel passwords. Covers what each credential protects and when each is required.
when_to_use: Use when configuring a developer API key, choosing private vs public key scope, setting channel passwords, or debugging auth failures.
---

# Authentication

## Concept

Three independent credentials, each protecting a different layer:

1. **Developer API key** — identifies your app to the messaging service. Passed
   when constructing the client (`developerApiKey` in `MessagingChannelApi`).
   Optional for some public/demo flows, required for scoped/production use.
2. **`apiKeyScope`** — `"private"` (default) or `"public"`. Controls **channel
   isolation** — it determines how the channel ID is computed on `connect(...)`:
   - `"private"`: channel ID = `channelName + password + apiKey`. Same name/password
     but different API key → **separate isolated channels**. Use for production,
     multi-tenant systems, and any case where channels must be siloed per developer.
   - `"public"`: channel ID = `channelName + password` only. API key is excluded →
     **shared channel across any API key**. Use for testing with teammates, demos,
     and cross-developer collaboration where everyone needs to land on the same channel.
3. **Channel password** — `channelPassword` on `connect(...)`. Protects an
   individual channel regardless of API key.

## API entry points

- Constructor: `MessagingChannelApi(remoteUrl, developerApiKey="")`
  in `agents/cpp-agent/include/hmdev/messaging/api/messaging_channel_api.h`
- `apiKeyScope` parameter on the extended `connect(...)` overloads (same header).
- Web client surface exposes `usePubKey` on the connection options
  (see `WEB-AGENT-GUIDE.md`).

## Minimal example

```js
// Browser client: public scope, no secret key embedded
const agent = new AgentConnection({ usePubKey: false });
agent.connect({
  channelName: 'lobby',
  channelPassword: 'secret',
  agentName: 'alice',
  apiKeyScope: 'public'
});
```

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
- Never embed a **private**-scope key in browser/client code — recommend
  `public` scope there, `private` for server-side agents.
- Channel password and API key are orthogonal; a wrong password fails connect
  even with a valid key.
- Public-key encryption hooks exist in the C++ client but are currently noted as
  not implemented (`setUsePublicKey`); don't present it as active encryption.
