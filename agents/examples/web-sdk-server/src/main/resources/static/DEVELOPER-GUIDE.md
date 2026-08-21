# Messaging Platform SDK - Developer Guide

**Version:** 1.0.0  
**Focus:** Repository structure, build system, per-agent library reference, contributing.

> For SDK usage and quick-start examples, see [USER-GUIDE.md](USER-GUIDE.md).  
> For Web/JS deep dive, see [WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md).

---

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [Build System](#build-system)
3. [Agent Libraries](#agent-libraries)
   - [Web Agent (JavaScript)](#web-agent-javascript)
   - [Java Agent](#java-agent)
   - [Python Agent](#python-agent)
4. [Examples](#examples)
5. [Contributing](#contributing)
6. [Troubleshooting](#troubleshooting)

---

## Repository Structure

```
messaging-platform-sdk/
├── README.md                   # Project overview
├── USER-GUIDE.md               # SDK feature overview & quick-start (all languages)
├── WEB-AGENT-GUIDE.md          # Web agent deep dive
├── DEVELOPER-GUIDE.md          # This file — architecture & contribution
├── build.gradle                # Root Gradle build
├── settings.gradle             # Gradle settings
│
├── agents/
│   ├── web-agent-js/           # JavaScript/Web client
│   │   └── js/
│   │       ├── web-agent.js         # Main agent class
│   │       ├── web-agent.libs.js    # Bundled dependencies
│   │       └── web-agent.webrtc.js  # WebRTC helper
│   │
│   ├── java-agent/             # Java client
│   │   └── src/main/java/com/hmdev/messaging/agent/
│   │       ├── core/
│   │       │   ├── AgentConnection.java   # Main class
│   │       │   └── ConnectConfig.java     # Connection config builder
│   │       ├── api/
│   │       ├── util/
│   │       └── webrtc/
│   │
│   ├── python-agent/           # Python client
│   │   └── hmdev/messaging/agent/
│   │       ├── core/agent_connection.py   # Main class
│   │       ├── api/
│   │       ├── security/
│   │       └── util/
│   │
│   └── examples/
│       ├── web-sdk-server/     # Spring Boot demo server
│       ├── java-agent-chat/    # Java CLI chat example
│       └── python-agent-chat/  # Python CLI chat example
│
├── messaging-common/           # Shared JAR (data models, crypto)
└── AI/                         # AI skills and documentation
    └── skills/
```

---

## Build System

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Java | 11+ | Java agent, demo server, build |
| Gradle | 7.x+ | Build orchestration (wrapper included) |
| Python | 3.8+ | Python agent |
| Node.js | 16+ (optional) | Web agent npm tasks |

### Common Commands

```bash
# Build everything
./gradlew clean build

# Build specific agent
./gradlew :agents:java-agent:build
./gradlew :agents:examples:web-sdk-server:build

# Run tests
./gradlew test
./gradlew :agents:java-agent:test

# Run demo server
./gradlew :agents:examples:web-sdk-server:bootRun
# Then open http://localhost:8084
```

### Python Agent

```bash
cd agents/python-agent

# Development install (editable)
pip install -e .

# Run tests
pytest
pytest --cov=hmdev.messaging
```

---

## Agent Libraries

### Web Agent (JavaScript)

Browser-compatible JavaScript library with no external dependencies.

**Files:**
- `web-agent.js` — `AgentConnection` class, messaging, channel storage
- `web-agent.libs.js` — bundled dependencies (SockJS, etc.)
- `web-agent.webrtc.js` — optional `WebRtcHelper` class

**Quick reference:**

```javascript
const agent = new AgentConnection({ usePubKey: false });

agent.addEventListener('message', (ev) => {
    ((ev.response && ev.response.data) || []).forEach((item) => {
        if (item && item.type === 'chat-text') console.log(`${item.from}: ${item.content}`);
    });
});

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'secret123',
    agentName: 'my-agent',
    api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service',
    apiKey: 'your-api-key',
    autoReceive: true
});

agent.sendMessage('Hello!');
agent.disconnect();
```

Full guide: **[WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md)**

---

### Java Agent

JVM-compatible client supporting desktop apps, server-side bots, and Android.

**Package:** `com.hmdev.messaging.agent.core`

**Gradle dependency:**
```gradle
dependencies {
    implementation 'com.hmdev.messaging:java-agent:1.0.0'
}
```

**Key classes:**

| Class | Purpose |
|-------|---------|
| `AgentConnection` | Main connection class |
| `ConnectConfig` | Builder-pattern connection config |
| `EventMessage` | Received message |
| `EventMessageResult` | Result of message queries |

**Quick reference:**

```java
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;

AgentConnection agent = new AgentConnection(
    "https://hmdevonline.com/messaging-platform/api/v1/messaging-service",
    "your-api-key");

agent.connect(ConnectConfig.builder()
    .channelName("my-channel")
    .channelPassword("secret123")
    .agentName("java-bot")
    .build());

agent.sendMessage("Hello from Java!");

// Receive messages (pull)
EventMessageResult result = agent.receive(ReceiveConfig.builder()
    .globalOffset(0L)
    .limit(50L)
    .build());
result.getEvents().forEach(msg -> System.out.println(msg.getContent()));

// Receive messages (async push)
agent.receiveAsync(messages -> messages.forEach(this::process));

agent.disconnect();
```

**Key methods:**

| Method | Description |
|--------|-------------|
| `connect(ConnectConfig)` | Connect to channel |
| `disconnect()` | Close connection |
| `sendMessage(String)` | Send to everyone in the channel |
| `sendMessage(String, String destination)` | Send to one agent |
| `receive(ReceiveConfig)` | Pull messages by offset |
| `receiveAsync(handler)` | Begin async receive |
| `getActiveAgents()` | Agents currently in the channel |
| `isHostAgent()` | Whether this agent is host |
| `isReady()` | Whether the channel is usable |

The API-key scope is set on the connect config —
`ConnectConfig.builder().apiKeyScope("public")` — not by a separate setter.

---

### Python Agent

Ideal for scripts, bots, automation, and ML integrations.

**Package:** `hmdev.messaging.agent.core`

**Install:**
```bash
pip install messaging-platform-python-agent
# or from source:
cd agents/python-agent && pip install -e .
```

**Key classes:**

| Class | Purpose |
|-------|---------|
| `AgentConnection` | Main connection class |
| `ReceiveConfig` | Message receive configuration |
| `EventMessage` | Received message |

**Quick reference:**

```python
from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.api.models import ReceiveConfig

agent = AgentConnection.with_api_key(
    "https://hmdevonline.com/messaging-platform/api/v1/messaging-service",
    "your-api-key")

connected = agent.connect(
    channel_name="my-channel",
    channel_password="secret123",
    agent_name="python-bot"
)

agent.send_message("Hello from Python!")

# Pull messages
result = agent.receive(ReceiveConfig(globalOffset=0, limit=50))
for msg in result.events:
    print(f"{msg.get('from')}: {msg.get('content')}")

# Async receive
agent.receive_async(lambda events: [process(e) for e in events])

agent.disconnect()
```

**Key methods:**

| Method | Description |
|--------|-------------|
| `AgentConnection(api_url)` / `AgentConnection.with_api_key(api_url, key)` | Construct |
| `connect(channel_name, channel_password, agent_name)` | Connect |
| `disconnect()` | Close connection |
| `send_message(msg, destination='*')` | Send a message |
| `receive(ReceiveConfig)` | Pull messages |
| `receive_async(handler)` | Async receive |
| `get_active_agents()` | Agents currently in the channel |
| `is_ready()` / `is_host_agent()` | State checks |

---

## Examples

### Web SDK Demo Server

Spring Boot app hosting interactive demos and documentation.

```bash
cd agents/examples/web-sdk-server
./gradlew bootRun
# Open http://localhost:8084
```

Includes: chat, WebRTC video, whiteboard, leaderboard, storage demo, mini-games, developer console.

### Java CLI Chat

```bash
cd agents/examples/java-agent-chat
./gradlew run
```

### Python CLI Chat

```bash
cd agents/examples/python-agent-chat
python chat.py --channel my-room --name user1
```

---

## Contributing

### Code Style

**Java:** standard Java conventions, SLF4J for logging, Javadoc on public APIs  
**Python:** PEP 8, type hints, snake_case, docstrings on public functions  
**JavaScript:** ES6+, camelCase, JSDoc on public APIs

### Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Write tests for new functionality
4. Ensure all tests pass: `./gradlew test`
5. Update relevant docs ([USER-GUIDE.md](USER-GUIDE.md), [WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md), or this file)
6. Submit pull request with a clear description of changes and rationale

### Adding New Features

1. Implement in the relevant agent (`java-agent`, `python-agent`, or `web-agent-js`)
2. Add tests
3. Add example to `/agents/examples/` if user-facing
4. Update docs:
   - **User-facing feature** → [USER-GUIDE.md](USER-GUIDE.md)
   - **Web-specific feature** → [WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md)
   - **Architecture change** → this file

---

## Troubleshooting

### Build Fails

```bash
# Check Java version
java -version   # must be 11+

# Clear caches
./gradlew clean
rm -rf ~/.gradle/caches && ./gradlew build

# Verify libs/ folder
ls libs/
```

### Connection Refused

```bash
# Confirm the platform is reachable from this machine
curl -I https://hmdevonline.com/messaging-platform/api/v1/messaging-service/health
```

If that succeeds, the problem is local: check the `api` URL and API key passed to
`connect()`, and that the channel name and password match on every agent.

### Tests Failing

```bash
# Run with output
./gradlew cleanTest test --info

# Python tests
cd agents/python-agent && pytest -v
```

### WebRTC Not Working in Demos

1. Verify HTTPS (required for camera in production)
2. Grant camera/microphone permissions
3. Check TURN server is configured and reachable
4. Inspect browser console for WebRTC errors
