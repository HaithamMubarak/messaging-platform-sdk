# Messaging Platform SDK - Developer Guide

**Version:** 1.0.0  
**Last Updated:** January 25, 2026  
**Repository:** [messaging-platform-sdk](https://github.com/your-org/messaging-platform-sdk)

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Repository Structure](#repository-structure)
4. [Build System](#build-system)
5. [Agent Libraries](#agent-libraries)
   - [Web Agent (JavaScript)](#web-agent-javascript)
   - [Java Agent](#java-agent)
   - [Python Agent](#python-agent)
6. [Examples](#examples)
7. [API Reference](#api-reference)
8. [Contributing](#contributing)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The Messaging Platform SDK provides cross-platform client libraries for building real-time messaging applications. It supports:

- **Real-time messaging** - WebSocket-based communication with high-performance message broker
- **WebRTC streaming** - Audio/video streaming with built-in SFU support
- **Multi-platform** - JavaScript/Web, Java, and Python agents
- **Secure communication** - AES encryption, temporary API keys
- **Flexible filtering** - Target specific agents with filter queries

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Application                         │
├─────────────┬─────────────────┬─────────────────────────────┤
│  Web Agent  │   Java Agent    │       Python Agent          │
│ (JavaScript)│   (JVM/Android) │      (Scripts/ML)           │
├─────────────┴─────────────────┴─────────────────────────────┤
│                  Messaging Platform API                      │
│            (REST + WebSocket + WebRTC SFU)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

| Agent | Requirements |
|-------|--------------|
| **Web** | Modern browser (Chrome, Firefox, Safari, Edge) |
| **Java** | Java 11+ |
| **Python** | Python 3.8+ |

### 5-Minute Setup

#### Web Agent (Fastest)

```html
<!DOCTYPE html>
<html>
<head>
    <title>Quick Chat</title>
    <!-- Include SDK -->
    <script src="https://your-cdn.com/js/web-agent.libs.js"></script>
    <script src="https://your-cdn.com/js/web-agent.js"></script>
</head>
<body>
    <div id="messages"></div>
    <input id="input" placeholder="Type message...">
    <button onclick="send()">Send</button>

    <script>
        const agent = new AgentConnection({ usePubKey: false });

        agent.onMessage = (msg) => {
            document.getElementById('messages').innerHTML += 
                `<p><b>${msg.from}:</b> ${msg.content}</p>`;
        };

        agent.connect({
            channelName: 'quick-chat',
            channelPassword: 'demo123',
            agentName: 'user-' + Math.random().toString(36).substr(2, 5),
            api: 'https://hmdevonline.com/messaging-platform/api',
            apiKey: 'your-api-key',
            autoReceive: true
        });

        function send() {
            const input = document.getElementById('input');
            agent.sendTextMessage(input.value);
            input.value = '';
        }
    </script>
</body>
</html>
```

#### Java Agent

```java
import com.hmdev.messaging.agent.core.AgentConnection;

public class QuickStart {
    public static void main(String[] args) throws Exception {
        AgentConnection agent = new AgentConnection(
            "https://hmdevonline.com/messaging-platform/api", 
            "your-api-key"
        );
        
        agent.connect("quick-chat", "demo123", "java-user");
        agent.sendTextMessage("Hello from Java!");
        agent.disconnect();
    }
}
```

#### Python Agent

```python
from hmdev.messaging.agent.core.agent_connection import AgentConnection

agent = AgentConnection.with_api_key(
    "https://hmdevonline.com/messaging-platform/api", 
    "your-api-key"
)

agent.connect("quick-chat", "demo123", "python-user")
agent.send_text_message("Hello from Python!")
agent.disconnect()
```

---

## Repository Structure

```
messaging-platform-sdk/
├── README.md                   # Project overview
├── DEVELOPER-GUIDE.md          # This file
├── USER-GUIDE.md               # End-user documentation
├── WEB-AGENT-GUIDE.md          # Web agent detailed guide
├── build.gradle                # Root Gradle build
├── settings.gradle             # Gradle settings
│
├── agents/                     # Agent implementations
│   ├── web-agent-js/           # JavaScript/Web client
│   │   ├── js/
│   │   │   ├── web-agent.js         # Main agent class
│   │   │   ├── web-agent.libs.js    # Dependencies
│   │   │   └── web-agent.webrtc.js  # WebRTC helper
│   │   └── package.json
│   │
│   ├── java-agent/             # Java client
│   │   ├── src/main/java/
│   │   │   └── com/hmdev/messaging/agent/
│   │   │       ├── core/
│   │   │       │   └── AgentConnection.java   # Main class
│   │   │       ├── api/
│   │   │       ├── util/
│   │   │       └── webrtc/
│   │   └── build.gradle
│   │
│   ├── python-agent/           # Python client
│   │   ├── hmdev/messaging/agent/
│   │   │   ├── core/
│   │   │   │   └── agent_connection.py  # Main class
│   │   │   ├── api/
│   │   │   ├── security/
│   │   │   └── util/
│   │   ├── setup.py
│   │   └── requirements.txt
│   │
│   └── examples/               # Example applications
│       ├── web-sdk-server/     # Spring Boot SDK server (docs, demos, examples)
│       ├── java-agent-chat/    # Java chat example
│       └── python-agent-chat/  # Python chat example
│
├── libs/                       # Compiled JARs
│   ├── agents-1.0.0.jar
│   └── messaging-common-1.0.0.jar
│
└── AI/                         # AI-assisted documentation
    ├── AI-CODING-INSTRUCTIONS.md
    └── mini-games/             # Mini-game development guides
```

---

## Build System

### Prerequisites

- **Gradle 7.x+** (wrapper included)
- **Java 11+** (for Java agent and demo server)
- **Node.js 16+** (optional, for web agent npm tasks)
- **Python 3.8+** (for Python agent)

### Building All Agents

```bash
cd messaging-platform-sdk
./gradlew clean build
```

### Building Individual Agents

```bash
# Java Agent only
./gradlew :agents:java-agent:build

# Web SDK Server
./gradlew :agents:examples:web-sdk-server:build
```

### Running the Web SDK Server

```bash
cd agents/examples/web-sdk-server
./gradlew bootRun

# Or use the script
./start.sh
```

Then open: http://localhost:8084

### Python Agent Installation

```bash
cd agents/python-agent

# Development install
pip install -e .

# Or production install
pip install .
```

---

## Agent Libraries

### Web Agent (JavaScript)

The Web Agent is a browser-compatible JavaScript library.

#### Installation

```html
<!-- Required files -->
<script src="js/web-agent.libs.js"></script>
<script src="js/web-agent.js"></script>

<!-- Optional: WebRTC support -->
<script src="js/web-agent.webrtc.js"></script>
```

#### Creating a Connection

```javascript
// Create agent instance
const agent = new AgentConnection({ usePubKey: false });

// Configure event handlers
agent.onMessage = (msg) => {
    console.log(`${msg.from}: ${msg.content}`);
};

agent.onChannelConnect = () => {
    console.log('Connected!');
};

agent.onChannelDisconnect = () => {
    console.log('Disconnected');
};

agent.onError = (error) => {
    console.error('Error:', error);
};

// Connect
agent.connect({
    channelName: 'my-channel',
    channelPassword: 'secret123',
    agentName: 'my-agent',
    api: 'https://hmdevonline.com/messaging-platform/api',
    apiKey: 'your-api-key',
    autoReceive: true  // Auto-poll for messages
});
```

#### Sending Messages

```javascript
// Text message
agent.sendTextMessage('Hello World!');

// Data message (JSON)
agent.sendDataMessage({
    type: 'game-state',
    position: { x: 100, y: 200 },
    health: 100
});

// Message with filter (target specific agents)
agent.sendTextMessage('Team message', null, 'team=blue');

// Binary data
agent.sendBinaryMessage(arrayBuffer);
```

#### WebRTC Streaming

```javascript
// Include WebRTC helper
const webrtc = new WebRtcHelper(agent);

// Start broadcasting
const stream = await navigator.mediaDevices.getUserMedia({ 
    video: true, 
    audio: true 
});
await webrtc.startStreamBroadcast('my-stream', stream);

// Receive streams
webrtc.on('stream-added', (streamId, mediaStream) => {
    document.getElementById('video').srcObject = mediaStream;
});
```

### Java Agent

The Java Agent supports JVM applications and Android.

#### Gradle Dependency

```gradle
dependencies {
    implementation 'com.hmdev.messaging:java-agent:1.0.0'
}
```

#### Creating a Connection

```java
import com.hmdev.messaging.agent.core.AgentConnection;

// Create with API key
AgentConnection agent = new AgentConnection(
    "https://hmdevonline.com/messaging-platform/api",
    "your-api-key"
);

// Or without (for temporary key flow)
AgentConnection agent = new AgentConnection("https://hmdevonline.com/messaging-platform/api");
```

#### Connecting & Sending

```java
// Connect to channel
boolean connected = agent.connect(
    "my-channel",      // channel name
    "secret123",       // password
    "java-agent"       // agent name
);

if (connected) {
    // Send text
    agent.sendTextMessage("Hello from Java!");
    
    // Send data (JSON object)
    JSONObject data = new JSONObject();
    data.put("type", "update");
    data.put("value", 42);
    agent.sendDataMessage(data);
}

// Always disconnect when done
agent.disconnect();
```

#### Receiving Messages

```java
// Sync receive
EventMessageResult result = agent.receive(new ReceiveConfig(0, 0, 20));
for (EventMessage msg : result.getMessages()) {
    System.out.println(msg.getFrom() + ": " + msg.getContent());
}

// Async receive with callback
agent.startReceiving((messages) -> {
    for (EventMessage msg : messages) {
        processMessage(msg);
    }
});

// Stop async receiving
agent.stopReceiving();
```

### Python Agent

The Python Agent is ideal for scripts, bots, and ML integrations.

#### Installation

```bash
pip install hmdev-messaging-agent
# Or from source
pip install -e ./agents/python-agent
```

#### Creating a Connection

```python
from hmdev.messaging.agent.core.agent_connection import AgentConnection

# With API key
agent = AgentConnection.with_api_key(
    "https://hmdevonline.com/messaging-platform/api",
    "your-api-key"
)

# Without API key
agent = AgentConnection("https://hmdevonline.com/messaging-platform/api")
```

#### Connecting & Sending

```python
# Connect
connected = agent.connect(
    channel_name="my-channel",
    channel_password="secret123",
    agent_name="python-agent"
)

if connected:
    # Send text
    agent.send_text_message("Hello from Python!")
    
    # Send data (dict)
    agent.send_data_message({
        "type": "status",
        "online": True
    })

# Disconnect
agent.disconnect()
```

#### Receiving Messages

```python
from hmdev.messaging.agent.api.models import ReceiveConfig

# Sync receive
result = agent.receive(ReceiveConfig(
    globalOffset=0,
    localOffset=0,
    limit=20
))

for msg in result.messages:
    print(f"{msg.sender}: {msg.content}")

# Async receive with handler
def on_message(messages):
    for msg in messages:
        process_message(msg)

agent.start_receiving(on_message)

# Stop async
agent.stop_receiving()
```

---

## Examples

### Web Demos Server

A Spring Boot server with SDK documentation, demos, and examples:

```bash
cd agents/examples/web-sdk-server
./gradlew bootRun
```

**Features:**
- SDK Documentation
- Interactive code examples
- Chat demo
- WebRTC video streaming
- Collaborative whiteboard
- Mini-games (Race Balls, Air Hockey, Quiz Battle, etc.)
- Storage demo
- Mini-games

### Java Chat Example

```bash
cd agents/examples/java-agent-chat
./gradlew run
```

### Python Chat Example

```bash
cd agents/examples/python-agent-chat
python chat.py --channel my-room --name user1
```

---

## API Reference

### AgentConnection Methods

| Method | Web | Java | Python | Description |
|--------|-----|------|--------|-------------|
| `connect()` | ✅ | ✅ | ✅ | Connect to channel |
| `disconnect()` | ✅ | ✅ | ✅ | Disconnect from channel |
| `sendTextMessage(text)` | ✅ | ✅ | ✅ | Send text message |
| `sendDataMessage(data)` | ✅ | ✅ | ✅ | Send JSON data |
| `receive(config)` | ✅ | ✅ | ✅ | Pull messages |
| `startReceiving(cb)` | ✅ | ✅ | ✅ | Start async receive |
| `stopReceiving()` | ✅ | ✅ | ✅ | Stop async receive |
| `updateAgentMetadata(meta)` | ✅ | ✅ | ✅ | Update agent metadata |
| `isHost()` | ✅ | ✅ | ✅ | Check if host (first connected) |

### Event Handlers (Web Agent)

| Handler | Description |
|---------|-------------|
| `onMessage` | Received new message |
| `onChannelConnect` | Connected to channel |
| `onChannelDisconnect` | Disconnected from channel |
| `onAgentJoin` | Another agent joined |
| `onAgentLeave` | Another agent left |
| `onError` | Error occurred |

### Message Types

| Type | Description |
|------|-------------|
| `TEXT` | Plain text message |
| `DATA` | JSON data message |
| `BINARY` | Binary data |
| `WEBRTC` | WebRTC signaling |
| `COMMAND` | System command |

---

## Contributing

### Code Style

- **Java**: Follow standard Java conventions, use SLF4J logging
- **Python**: Follow PEP 8, use type hints
- **JavaScript**: ES6+, consistent with existing code

### Testing

```bash
# Run all tests
./gradlew test

# Java agent tests
./gradlew :agents:java-agent:test

# Python tests
cd agents/python-agent
pytest
```

### Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit pull request with clear description

---

## Troubleshooting

### Connection Issues

**Problem:** Cannot connect to channel

**Solutions:**
1. Verify API key is valid
2. Check server URL is correct
3. Ensure channel name doesn't contain special characters
4. Check network/firewall settings

### Message Not Received

**Problem:** Messages sent but not received

**Solutions:**
1. Ensure `autoReceive: true` or call `startReceiving()`
2. Verify channel name/password match between agents
3. Check filter queries if using targeted messages

### WebRTC Issues

**Problem:** Video stream not working

**Solutions:**
1. Ensure HTTPS is used (required for WebRTC)
2. Grant camera/microphone permissions
3. Check if WebRTC SFU service is running
4. Verify TURN server configuration for NAT traversal

### Build Issues

**Problem:** Gradle build fails

**Solutions:**
1. Ensure Java 11+ is installed: `java -version`
2. Clear Gradle cache: `./gradlew clean`
3. Check `libs/` folder contains required JARs

---

## Support

- **Documentation:** [USER-GUIDE.md](USER-GUIDE.md)
- **Web Agent Guide:** [WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md)
- **Issues:** GitHub Issues
- **Discussions:** GitHub Discussions

---

## License

[MIT License](LICENSE)

---

*Built with ❤️ for the developer community*

