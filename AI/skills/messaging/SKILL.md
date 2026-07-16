---
name: messaging
description: Send and receive event messages over a channel. Covers EventMessage shape, event types, send/receive, and the WebSocket-primary / HTTP+UDP-fallback transport model.
when_to_use: Use when producing or consuming messages, handling the onMessage callback, choosing an event type, or reasoning about delivery transport.
---

# Messaging

## Concept

Once connected to a channel you exchange **event messages**. A producer calls
`send(eventType, ...)`; consumers receive via a `receive(...)` poll or an
`onMessage` callback. Transport is **WebSocket-primary with HTTP fallback**, and
**UDP** is available for latency-sensitive paths (`udpPush` / `udpPull`).

## API entry points

Interface: `agents/cpp-agent/include/hmdev/messaging/api/connection_channel_api.h`

- `send(eventType, ...) -> bool`
- `receive(sessionId, ReceiveConfig) -> EventMessageResult`
- `udpPush(message, ...) -> bool`
- `udpPull(sessionId, ReceiveConfig) -> EventMessageResult`

Data models (Java reference):
`agents/examples/web-sdk-server/src/main/java/com/hmdev/messaging/common/data/`
- `EventMessage.java`, `EventMessageRequest.java`, `EventMessageResult.java`
- `ReceiveConfig.java`, `MessageReceiveRequest.java`

A message carries at least a sender, a content payload, and an event type;
results are returned as an `EventMessageResult` (batch of `EventMessage`).

## Minimal example (Web/JS surface)

```js
agent.onMessage = msg => {
  console.log(`${msg.from}: ${msg.content}`);
};
agent.send('chat', { content: 'hello world' });
```

## Notes for assistants

- The receive loop is bounded by a polling timeout (≈40s in the C++ client);
  treat receive as long-poll, not a single instantaneous read.
- For history vs live tail, the **offsets** skill governs where messages come
  from (cache/database). Messaging is the *what*; offsets are the *from where*.
- Don't fabricate event-type enums — read them from the data models above.
