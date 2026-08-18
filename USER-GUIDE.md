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
5. [Basic Examples](#basic-examples)
6. [Per-Language Guides](#per-language-guides)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

> **📌 API Configuration Note:**  
> The default production messaging service URL is `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`.  
> - Java and Python agents use this URL as the default if no URL is specified  
> - Web agents require explicit URL configuration in the `connect()` call  
> - The messaging service is fully managed: there is nothing to install, run or configure

---

## Overview

The Messaging Platform SDK provides client libraries for building real-time messaging applications with support for:

- ✅ **Real-time messaging** - HTTP long-polling today; WebSocket and UDP transports in development
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

Send and receive messages instantly across connected agents. The production transport today is HTTP long-polling; WebSocket and UDP are in development.

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

Stream live video and audio between agents with built-in SFU support.

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
agent.receiveMessages(0L, 100L, 50);  // Start offset, end offset, max messages
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
<script src="js/web-agent.libs.js"></script>
<script src="js/web-agent.js"></script>
<!-- Optional: WebRTC support -->
<script src="js/web-agent.webrtc.js"></script>
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

## Basic Examples

### Java

```java
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;

public class QuickStart {
    public static void main(String[] args) throws Exception {
        AgentConnection agent = new AgentConnection();

        agent.setOnMessage(msg -> {
            System.out.println(msg.getFrom() + ": " + msg.getContent());
        });

        agent.connect(ConnectConfig.builder()
            .channelName("my-channel")
            .channelPassword("secret123")
            .agentName("java-user")
            .build());

        agent.sendTextMessage("Hello from Java!");
        agent.disconnect();
    }
}
```

> See [DEVELOPER-GUIDE.md § Java Agent](DEVELOPER-GUIDE.md#java-agent) for the full Java API reference.

### Python

```python
from messaging_agent import AgentConnection

agent = AgentConnection(
    api_url="https://hmdevonline.com/messaging-platform/api",
    api_key="your-api-key"
)

agent.on_message = lambda msg: print(f"{msg['from']}: {msg['content']}")

agent.connect("my-channel", "secret123", "python-user")
agent.send_text_message("Hello from Python!")
agent.disconnect()
```

> See [DEVELOPER-GUIDE.md § Python Agent](DEVELOPER-GUIDE.md#python-agent) for the full Python API reference.

### Web/JavaScript

```javascript
const agent = new AgentConnection();

agent.onMessage = (msg) => console.log(`${msg.from}: ${msg.content}`);

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'secret123',
    agentName: 'web-user',
    api: 'https://hmdevonline.com/messaging-platform/api',
    apiKey: 'your-api-key',
    autoReceive: true
});

agent.sendTextMessage("Hello from Web!");
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
- Use temporary API keys (5–15 minute TTL) in client-side code
- Never hardcode API keys — load from server or environment variables
- Use `private` scope for production; `public` only for demos/testing

❌ **DON'T:**
- Store keys in browser localStorage
- Commit keys to git
- Use `private`-scope keys in browser/client code

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
- Receiver has `autoReceive: true` (Web) or calls `startReceiving()` (Java/Python)
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
// Java
agent.setDebug(true);
```

```python
# Python
import logging
logging.basicConfig(level=logging.DEBUG)
```

```javascript
// Web — check browser console
agent.onError = (error) => console.error('Error:', error);
```

---

## Additional Resources

- **[DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md)** — Repo structure, build system, contributing
- **[WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md)** — Web/JS deep dive
- **[README.md](README.md)** — Project overview and quick links

### Running the Demo Server

```bash
cd agents/examples/web-sdk-server
./gradlew bootRun
# Open http://localhost:8084
```
