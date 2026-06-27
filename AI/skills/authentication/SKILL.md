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
2. **`apiKeyScope`** — `"private"` (default) or `"public"`. Controls the access
   scope of the key on `connect(...)`. Use `private` for trusted server-side
   agents; `public` for browser clients where the key is exposed.
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

## Notes for assistants

- Never embed a **private**-scope key in browser/client code — recommend
  `public` scope there, `private` for server-side agents.
- Channel password and API key are orthogonal; a wrong password fails connect
  even with a valid key.
- Public-key encryption hooks exist in the C++ client but are currently noted as
  not implemented (`setUsePublicKey`); don't present it as active encryption.
