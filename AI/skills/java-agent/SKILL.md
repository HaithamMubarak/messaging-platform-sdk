---
name: java-agent
description: Java agent SDK — AgentConnection lifecycle, ConnectConfig builder, send/receive, async receive loop, WebRTC, UDP, and password-request protocol. Covers agents/java-agent/.
when_to_use: Use when building a Java or Android agent, wiring the receive loop, using ConnectConfig, or implementing the password-request handshake in Java.
---

# Java Agent

Source: `agents/java-agent/src/main/java/com/hmdev/messaging/agent/`

Key classes:

| Class | Package | Role |
|-------|---------|------|
| `AgentConnection` | `core` | High-level agent lifecycle (connect/send/receive/disconnect) |
| `ConnectConfig` | `core` | Builder-style connect params |
| `MessagingChannelApi` | `api/impl` | Low-level HTTP + UDP transport |
| `ConnectionChannelApi` | `api` | Interface implemented by `MessagingChannelApi` |
| `ConnectionChannelApiFactory` | `api` | Creates `MessagingChannelApi` instances |
| `UdpClient` | `api/impl` | UDP push/pull |
| `AgentConnectionEventHandler` | `core` | Callback interface for async receive |
| `WebRtcManager` | `webrtc` | WebRTC peer connection management |

---

## Construction

```java
// Simple — no API key
AgentConnection agent = new AgentConnection("https://hmdevonline.com");

// With developer API key
AgentConnection agent = new AgentConnection("https://hmdevonline.com", "your-api-key");

// Custom API implementation (for testing)
AgentConnection agent = new AgentConnection(customChannelApi);
```

---

## Connect

```java
boolean ok = agent.connect(ConnectConfig.builder()
    .channelName("my-channel")
    .channelPassword("secret")
    .agentName("alice")
    .apiKeyScope("private")      // "private" (default) or "public"
    .enableWebrtcRelay(false)
    .pollSource("AUTO")          // "AUTO" | "CACHE" | "KAFKA" | "DATABASE"
    .build());
```

`ConnectConfig` is the recommended form. The underlying `MessagingChannelApi` also accepts a `Map<String, Object>` via `connect(map)`.

`checkLastSession` (default `true`) — if `true`, agent tries to recover the last known session on reconnect. Set to `false` to always start fresh.

---

## Send

```java
// Broadcast text chat
agent.sendMessage("hello world");

// Targeted send
agent.sendMessage("hey bob", "bob");

// With event type and encryption flag
agent.sendMessage(EventMessage.EventType.CHAT_TEXT, "content", "*", false);

// UDP fast send (unreliable)
agent.udpPushMessage("payload", "*");
```

---

## Receive (synchronous)

```java
EventMessageResult result = agent.receive(agent.getInitialReceiveConfig());
// or current position:
EventMessageResult result = agent.receive(agent.getCurrentReceiveConfig());

List<EventMessage> messages = result.getMessages();
ReceiveConfig next = result.getNextReceiveConfig(); // use for next call
```

Polling timeout: **40 seconds** per call (long-poll).

UDP receive:
```java
EventMessageResult result = agent.udpPull(receiveConfig);
```

---

## Receive (async loop)

```java
agent.receiveAsync(new AgentConnectionEventHandler() {
    @Override
    public void onMessage(EventMessage message) {
        System.out.println(message.getFrom() + ": " + message.getContent());
    }
});

// With a custom starting offset:
agent.receiveAsync(handler, agent.getInitialReceiveConfig());
```

`receiveAsync` spins a background thread. Call `disconnect()` to stop it.

---

## Disconnect

```java
agent.disconnect();
```

Stops the receive thread, calls the API disconnect endpoint, clears session state.

---

## Agent presence

```java
List<AgentInfo> agents = agent.getActiveAgents();
boolean iAmHost = agent.isHostAgent();
// Host = earliest-connected agent (by connectionTime) — useful for P2P leader election
```

---

## Password-request protocol

Used to securely share the channel password with a newcomer:

```java
// On the requesting agent side:
agent.requestPassword(5 /* timeout seconds */);

// On the agent that holds the password:
agent.setPasswordRequestHandler((channelId, requesterName, requesterPublicKeyPem) -> {
    // return true to send the encrypted password reply
    return true;
});
```

Encryption uses RSA-OAEP: the requester generates a key pair, sends the public key in `PASSWORD_REQUEST`, and the holder encrypts the password with it in `PASSWORD_REPLY`.

---

## WebRTC (Java)

```java
agent.setEnableWebrtcRelay(true); // must be set before connect()

// Or on ConnectConfig:
ConnectConfig.builder().enableWebrtcRelay(true) ...

// WebRTC events via:
agent.setWebRtcStreamEventHandler(new WebRtcStreamEventHandler() { ... });
```

`WebRtcManager` handles ICE negotiation via COTURN (URLs from `ConnectResponse.getIceServers()`).
`VideoStreamSession` manages individual peer video/data streams.

---

## Key state fields

| Field | Accessor | Notes |
|-------|----------|-------|
| `sessionId` | `getSessionId()` | Needed for raw API calls |
| `agentName` | `getAgentName()` | Set after successful connect |
| `channelId` | `getChannelId()` | Channel's stable ID |
| `channelSecret` | `getChannelSecret()` | Derived secret for AES encryption |
| `initialReceiveConfig` | `getInitialReceiveConfig()` | Offset at connect time (start of channel) |
| `connectionTime` | `getConnectionTime()` | Epoch millis of connect |
| `readyState` | `isReady()` | `true` when connected and operational |

---

## Low-level API (MessagingChannelApi)

All `AgentConnection` methods delegate here. Use directly only when you need raw control:

```java
MessagingChannelApi api = new MessagingChannelApi(remoteUrl, developerApiKey);
ConnectResponse resp = api.connect(config);
boolean ok = api.send(EventMessage.EventType.CHAT_TEXT, content, "*", sessionId, false);
EventMessageResult result = api.receive(sessionId, receiveConfig);
api.disconnect(sessionId);
```

UDP port defaults to `9999`; override via `-Dmessaging.udp.port=XXXX` or `MESSAGING_UDP_PORT` env var.

---

## Notes for assistants

- `AgentConnection` is not thread-safe beyond the async receive thread — do not share across threads.
- `isHostAgent()` compares `connectionTime` across `getActiveAgents()` — the agent with the smallest `connectionTime` is the host.
- The common data models (`EventMessage`, `ConnectRequest`, etc.) live in `com.hmdev.messaging.common.data` — they are shared with the services repo via the `messaging-common` JAR.
- `usePublicKey` on `MessagingChannelApi` is kept `false` — HTTPS handles transport security.
