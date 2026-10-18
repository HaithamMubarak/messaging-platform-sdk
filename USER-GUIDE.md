# Messaging Platform SDK - User Guide

**Version:** 1.0.0  
**Last Updated:** August 18, 2026  
**Status:** Beta — free to use, APIs may still change

---

## Table of Contents

1. [Overview](#overview)
2. [Core Features](#core-features)
3. [Quick Start](#quick-start)
4. [API Key & Channel Isolation](#api-key--channel-isolation)
5. [Managed Channels (who may join)](#managed-channels-who-may-join)
6. [Basic Examples](#basic-examples)
7. [Per-Language Guides](#per-language-guides)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

> **📌 API Configuration Note:**  
> The default production messaging service URL is `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`.  
> - Java and Python agents use this URL as the default if no URL is specified  
> - Web agents require explicit URL configuration in the `connect()` call  
> - The messaging service is fully managed: there is nothing to install, run or configure

---

## Overview

The Messaging Platform SDK provides client libraries for building real-time messaging applications with support for:

- ✅ **Real-time messaging** - WebSocket by default, with HTTP long-polling as a fallback; UDP in development
- ✅ **Advanced filtering** - Target specific agents with filter queries
- ✅ **WebRTC support** - Audio/video streaming
- ✅ **Channel storage** - Persistent key-value data per channel
- ✅ **Message offsets** - Message history recovery
- ✅ **Multi-platform** - Java, Python, JavaScript/Web
- ✅ **Secure** - Temporary API keys, AES encryption
- ✅ **Fast** - In-memory delivery with durable persistence behind it

### Supported Languages & Platforms

| Language | Agent | Use Case | Learn More |
|----------|-------|----------|------------|
| **Java** | `java-agent` | Desktop apps, Android, backend services | [DEVELOPER-GUIDE.md § Java Agent](DEVELOPER-GUIDE.md#java-agent) |
| **Python** | `python-agent` | Scripts, bots, ML integrations | [DEVELOPER-GUIDE.md § Python Agent](DEVELOPER-GUIDE.md#python-agent) |
| **JavaScript** | `web-agent` | Web browsers, Node.js | [WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md) |

---

## Core Features

### 1. Real-Time Messaging

Send and receive messages instantly across connected agents. The default transport is a WebSocket, which falls back to HTTP long-polling where a socket cannot be held open; UDP is in development.

**Supported message types:**
- Text messages
- JSON data payloads
- Binary data
- WebRTC signaling
- Custom events

### 2. Advanced Filtering

Target specific agents without hardcoding recipient names:

```
gameType=shooter,level>5
```

See [WEB-AGENT-GUIDE.md § Message Filtering](WEB-AGENT-GUIDE.md#message-filtering) for full syntax.

### 3. WebRTC Audio/Video

Stream live video and audio straight between agents, with nothing to deploy in the middle.

**Capabilities:**
- One-to-one video calls
- Broadcast to multiple recipients
- Screen sharing
- Low-latency data channels

Full guide: [WEB-AGENT-GUIDE.md § WebRTC Video Streaming](WEB-AGENT-GUIDE.md#webrtc-video-streaming)

### 4. Channel Storage (Key-Value Store)

Persist data across disconnections. Each channel has its own isolated storage with versioning.

**Use cases:**
- Game state & progress
- Collaborative documents
- Leaderboards & scores
- User preferences

Full API reference: [WEB-AGENT-GUIDE.md § Channel Storage](WEB-AGENT-GUIDE.md#channel-storage-key-value-store)

### 5. Message Offset & History Recovery

Resume from a specific message offset to recover missed messages.

```java
agent.receive(ReceiveConfig.builder()
    .globalOffset(0L)   // start from this offset
    .limit(50L)         // at most this many messages
    .build());
```

> ⚠️ **Recovery is scoped to the channel's lifetime.** History lives in the
> platform's database for as long as the channel exists — **deleting a channel
> permanently destroys its messages**, and recreating one with the same name
> starts empty. If you need messages to outlive a channel, persist them on your
> side. *(Before 2026-07-14 a broker retained messages behind the channel and
> could sometimes resurrect them after deletion; that no longer happens.)*

### 6. Secure Communication

- **Developer API key** — identifies your app
- **Temporary API keys** — short-lived, restricted keys for client-side apps
- **Channel passwords** — per-channel access control

---

## Quick Start

### Prerequisites

- Java 11+ (for Java agent)
- Python 3.8+ (for Python agent)
- Modern web browser (for Web agent)

### Installation

#### Java Agent
```gradle
dependencies {
    implementation 'com.hmdev.messaging:java-agent:1.0.0'
}
```

#### Python Agent
```bash
pip install messaging-platform-python-agent
```

#### Web Agent
```html
<!-- Hosted, ready to use -->
<script src="https://hmdevonline.com/messaging-platform/sdk/generated-web-agent-js/js/web-agent.libs.js"></script>
<script src="https://hmdevonline.com/messaging-platform/sdk/generated-web-agent-js/js/web-agent.js"></script>
<!-- Optional: WebRTC support -->
<script src="https://hmdevonline.com/messaging-platform/sdk/generated-web-agent-js/js/web-agent.webrtc.js"></script>
```

---

## API Key & Channel Isolation

### Understanding `apiKeyScope`

The `apiKeyScope` parameter controls how channels are isolated between developers — it determines how the channel ID is computed on `connect()`:

**`apiKeyScope="private"` (Default)**
- Channel ID = `channelName + password + apiKey`
- Same name/password but different API key → **separate isolated channels**
- Use for production, multi-tenant systems, any case where channels must be siloed per developer

**`apiKeyScope="public"`**
- Channel ID = `channelName + password` only. API key excluded
- Same name/password → **shared channel across any API key**
- Use for testing with teammates, demos, cross-developer collaboration

| Scenario | Scope |
|----------|-------|
| Production app, multi-tenant | `private` |
| Testing with teammates, SDK demos | `public` |
| Cross-developer collaboration | `public` |
| Server-side bot (your own channel) | `private` |

---

## Managed Channels (who may join)

By default anyone who knows a channel's name and password can join it, and an
existing channel can also be joined by its `channelId`, which every member
receives on connect. That is fine for open rooms and demos. When **your app**
decides who belongs (members of a team, players in a match, people you might
remove), make the channel **managed**: it then admits only the agents your
backend lists, each with its own key.

Nothing changes for channels you do not manage, and an agent that does not
send a key behaves exactly as before.

### How it works

1. **Your backend registers agents** with your developer API key (never a
   temporary key). For each person it picks an agent name and a random key
   (24+ characters), and an expiry. The channel becomes managed.
2. **Your backend hands each person their own agent name and key** (with the
   temporary key it already gives them).
3. **The client connects** with `agentName` + `agentKey`. Anyone else is
   refused, whether they name the channel by name and password or by
   `channelId`.
4. **To remove someone, revoke their agent:** their sessions close at once and
   their key stops working.

Rotating identities is the same call: register a fresh name and key for the
person and revoke the old one. Keep your own mapping from your user id to the
agent name; you may store it in `externalId` (an opaque id, never an email).

### Your backend: the owner calls

All four are `POST` with your developer API key in `X-Api-Key`. Name the
channel by `channelId`, or by `channelName` + `channelPassword` exactly as you
give them to your users (the plain password: the service derives what agents send).

```bash
BASE=https://hmdevonline.com/messaging-platform/api/v1/messaging-service

# Admit agents (creates the channel if new; it becomes managed)
curl -s -X POST $BASE/channels/managed/agents -H "X-Api-Key: $DEV_KEY" -H "Content-Type: application/json" -d '{
  "channelName": "team-42", "channelPassword": "the-room-password",
  "agents": [
    { "agentName": "u-7f3a91", "agentKey": "<random 32+ chars>", "ttlSeconds": 3600, "externalId": "user-1093" }
  ]
}'

# Remove agents: their sessions close now
curl -s -X POST $BASE/channels/managed/revoke  -H "X-Api-Key: $DEV_KEY" -H "Content-Type: application/json" \
     -d '{ "channelName": "team-42", "channelPassword": "the-room-password", "agentNames": ["u-7f3a91"] }'

# Who is admitted now (names, externalId, expiry; never keys)
curl -s -X POST $BASE/channels/managed/list    -H "X-Api-Key: $DEV_KEY" -H "Content-Type: application/json" \
     -d '{ "channelName": "team-42", "channelPassword": "the-room-password" }'

# Back to an ordinary channel
curl -s -X POST $BASE/channels/managed/release -H "X-Api-Key: $DEV_KEY" -H "Content-Type: application/json" \
     -d '{ "channelName": "team-42", "channelPassword": "the-room-password" }'
```

`agents` adds to the list; add `"replace": true` to make it the whole list
(agents left out are revoked and disconnected).

| Rule | Value |
|------|-------|
| Agent key | 24 to 256 characters, random; stored only as a hash |
| `ttlSeconds` | 60 s to 7 days (default 1 day). After it, new connects with that key are refused; a session already open stays until it ends or you revoke it |
| Agents per channel | up to 2000 |
| Who may call | the API key that owns the channel; temporary keys are refused |

### The client: connect with the agent key

```javascript
// Web / JavaScript
agent.connect({ api, apiKey: temporaryKey, channelName: 'team-42', channelPassword: 'the-room-password',
                agentName: 'u-7f3a91', agentKey: keyFromYourBackend });
```

```python
# Python
agent.connect(channelName='team-42', channelPassword='the-room-password',
              agentName='u-7f3a91', agentKey=key_from_your_backend)
```

```java
// Java
ConnectConfig config = ConnectConfig.builder()
        .channelName("team-42").channelPassword("the-room-password")
        .agentName("u-7f3a91").agentKey(keyFromYourBackend)
        .build();
agent.connect(config);
```

A refused connect answers `unauthorized`: *"This channel admits only agents its
owner registered."* The C++ agent does not send `agentKey` yet; until it does,
keep C++ clients on ordinary channels.

---

## Basic Examples

### Java

```java
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;

public class QuickStart {
    public static void main(String[] args) throws Exception {
        // The constructor takes the API URL, and your key if you have one.
        AgentConnection agent = new AgentConnection(
            "https://hmdevonline.com/messaging-platform/api/v1/messaging-service",
            "your-api-key");

        agent.connect(ConnectConfig.builder()
            .channelName("my-channel")
            .channelPassword("secret123")
            .agentName("java-user")
            .build());

        // Handlers are registered after connecting.
        agent.receiveAsync(events -> events.forEach(e ->
            System.out.println(e.getFrom() + ": " + e.getContent())));

        agent.sendMessage("Hello from Java!");
        agent.disconnect();
    }
}
```

> See [DEVELOPER-GUIDE.md § Java Agent](DEVELOPER-GUIDE.md#java-agent) for the full Java API reference.

### Python

```python
from hmdev.messaging.agent.core.agent_connection import AgentConnection

agent = AgentConnection.with_api_key(
    "https://hmdevonline.com/messaging-platform/api/v1/messaging-service",
    "your-api-key")

agent.connect("my-channel", "secret123", "python-user")

# Handlers are registered after connecting.
agent.receive_async(lambda events: [
    print(f"{e.get('from')}: {e.get('content')}") for e in events
])

agent.send_message("Hello from Python!")
agent.disconnect()
```

> See [DEVELOPER-GUIDE.md § Python Agent](DEVELOPER-GUIDE.md#python-agent) for the full Python API reference.

### Web/JavaScript

```javascript
const agent = new AgentConnection();

agent.addEventListener('message', (ev) => {
    ((ev.response && ev.response.data) || []).forEach((item) => {
        if (item && item.type === 'chat-text') console.log(`${item.from}: ${item.content}`);
    });
});

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'secret123',
    agentName: 'web-user',
    api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service',
    apiKey: 'your-api-key',
    autoReceive: true
});

agent.sendMessage("Hello from Web!");
```

> For full Web guide with WebRTC, channel storage, and advanced features: **[WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md)**

---

## Per-Language Guides

- **[DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md)** — Repository structure, build system, per-agent library reference
  - [Java Agent](DEVELOPER-GUIDE.md#java-agent)
  - [Python Agent](DEVELOPER-GUIDE.md#python-agent)
  - [Web Agent](DEVELOPER-GUIDE.md#web-agent-javascript)
  - [Build Instructions](DEVELOPER-GUIDE.md#build-system)
  - [Contributing](DEVELOPER-GUIDE.md#contributing)

- **[WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md)** — Deep dive for JavaScript/Web
  - [Basic Messaging](WEB-AGENT-GUIDE.md#basic-messaging)
  - [Channel Storage API](WEB-AGENT-GUIDE.md#channel-storage-key-value-store)
  - [WebRTC Video Streaming](WEB-AGENT-GUIDE.md#webrtc-video-streaming)
  - [Message Filtering](WEB-AGENT-GUIDE.md#advanced-topics)
  - [Security Best Practices](WEB-AGENT-GUIDE.md#security-best-practices)
  - [API Reference](WEB-AGENT-GUIDE.md#api-reference)

---

## Best Practices

### API Key Security

✅ **DO:**
- Use a short-lived temporary key in client-side code
- Keep the developer API key in a server environment variable
- Return temporary-key responses with `Cache-Control: no-store`
- Use `private` scope for production; `public` only for demos/testing

❌ **DON'T:**
- Store keys in browser localStorage
- Commit keys to git
- Send a developer API key to browser/client code

### Connection Management

✅ **DO:**
- Always call `disconnect()` when done
- Implement reconnect logic with exponential backoff
- Validate message content before processing
- Use message offsets for recovery after disconnection

### WebRTC

✅ **DO:**
- Use HTTPS in production (required for WebRTC)
- Stop tracks on disconnect: `stream.getTracks().forEach(t => t.stop())`
- Configure TURN servers for NAT traversal

---

## Troubleshooting

### Connection Failed

**Check:**
1. The `api` URL passed to `connect()` matches the one documented above
2. Your API key is valid and has not been revoked — verify it with the API key tester
3. The channel name and password match on every agent joining the room

If a key stops working, rotate it from the developer portal; the previous key is
revoked as soon as the replacement is issued.

### Messages Not Received

**Check:**
- Both agents on same channel with same password
- Receiver has `autoReceive: true` (Web) or calls `receiveAsync()` (Java/Python)
- `apiKeyScope` matches — if one uses `private` and the other `public`, they're on different channels

### 401 Unauthorized

- API key expired (common with temporary keys) — request a fresh one
- Wrong API key

### Common Error Codes

| Code | Meaning |
|------|---------|
| `401` | Invalid/expired API key |
| `403` | Wrong channel password |
| `404` | Channel not found |
| `429` | Rate limit exceeded |

### Debug Logging

```java
// Java — the agent logs through SLF4J, so raise the level of the SDK's logger
// rather than calling a setter on the connection.
// logback.xml:  <logger name="com.hmdev.messaging" level="DEBUG"/>
```

```python
# Python
import logging
logging.basicConfig(level=logging.DEBUG)
```

```javascript
// Web — check browser console. A failed connect arrives as a 'connect' event
// whose response.status is 'error'; there is no separate error event.
agent.addEventListener('connect', (ev) => {
    const res = ev.response || {};
    if (res.status === 'error') console.error('Connect failed:', res.data);
});
```

---

## Additional Resources

- **[WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md)** — Web/JS deep dive

### Trying the demos

Every demo runs in the browser with nothing installed — open the
[playground](playground.html) and pick one.
