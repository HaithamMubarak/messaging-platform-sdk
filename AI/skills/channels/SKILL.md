---
name: channels
description: Connect to and manage messaging channels — the unit of grouping for agents and messages. Covers connect/disconnect, sessions, listing active and system agents, WebRTC relay, and channel scope.
when_to_use: Use when joining or leaving a channel, managing the session lifecycle, listing who is connected, or deciding channel name/password/id and WebRTC relay options.
---

# Channels

## Concept

A **channel** is the room that agents join to exchange messages. You identify a
channel by `channelName` (+ optional `channelId`) and protect it with a
`channelPassword`. Connecting returns a **session** (`sessionId`) that all
subsequent calls (`send`, `receive`, `disconnect`) use.

## API entry points

Interface: `agents/cpp-agent/include/hmdev/messaging/api/connection_channel_api.h`
Implementation: `agents/cpp-agent/include/hmdev/messaging/api/messaging_channel_api.h`

Core operations (names are consistent across the JS/Java/Python/C++ clients):

- `connect(channelName, channelPassword, agentName, [sessionId], [channelId], [enableWebrtcRelay], [apiKeyScope], [pollSource]) -> ConnectResponse`
  - An object/map form is also available and **recommended** for readability:
    `connect({ channelName, channelPassword, agentName, ... })`
- `disconnect(sessionId) -> bool`
- `getActiveAgents(sessionId) -> [AgentInfo]`
- `getSystemAgents(sessionId) -> [AgentInfo]`

`enableWebrtcRelay` opts the channel into WebRTC P2P relay for low-latency
media/data. `apiKeyScope` and `pollSource` are covered by the **authentication**
and **offsets** skills respectively.

## Minimal example (Web/JS surface)

```js
const agent = new AgentConnection({ usePubKey: false });
agent.onMessage = msg => console.log(msg.from, msg.content);
agent.connect({ channelName: 'lobby', channelPassword: 'secret', agentName: 'alice' });
// ... later
agent.disconnect();
```

## Notes for assistants

- Don't invent channel fields. The connect parameter list above is the real one.
- `sessionId` is the handle for everything after connect; thread it through.
- Per-channel persistent key-value storage exists (see `USER-GUIDE.md`); treat
  it as channel-scoped, not global.
