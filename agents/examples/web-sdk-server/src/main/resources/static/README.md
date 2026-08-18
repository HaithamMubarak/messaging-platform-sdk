# Messaging Platform SDK

[![Live Demo](https://img.shields.io/badge/Live-Demo-success?logo=firefox)](https://hmdevonline.com/messaging-platform/sdk/)
[![Documentation](https://img.shields.io/badge/Docs-Online-informational?logo=readthedocs)](https://hmdevonline.com/messaging-platform/sdk/docs.html)

Real-time messaging SDK for building multiplayer games, collaborative apps, and real-time communication features. Client libraries available for **JavaScript (Web)**, **Java**, **Python**, and **C++**.

---

## 🎯 Quick Links

- **🌐 Live Demo:** [https://hmdevonline.com/messaging-platform/sdk/](https://hmdevonline.com/messaging-platform/sdk/)
- **📚 Documentation:** [https://hmdevonline.com/messaging-platform/sdk/docs.html](https://hmdevonline.com/messaging-platform/sdk/docs.html)
- **🎮 Example Games:** [Air Hockey](https://hmdevonline.com/messaging-platform/sdk/#games) | [Quiz Battle](https://hmdevonline.com/messaging-platform/sdk/#games) | [Reactor](https://hmdevonline.com/messaging-platform/sdk/#games)

---

## ✨ Features

- **🚀 Real-time Messaging** - WebSocket-based instant messaging
- **🔗 WebRTC P2P** - Ultra-low latency (10-30ms) peer-to-peer connections
- **💾 Channel Storage** - Persistent key-value storage per channel
- **🎮 Game-Ready** - Built-in utilities for multiplayer games
- **🔐 Secure** - Password-protected channels, API key authentication
- **📡 Multi-Protocol** - WebSocket primary, HTTP fallback
- **🌐 Cross-Platform** - JavaScript, Java, Python, C++ SDKs
- **📹 Video/Audio** - WebRTC video/audio streaming support

---

## 📚 Documentation

### Quick Start Guides

| Platform | Guide | Description |
|----------|-------|-------------|
| **🌐 Web (JavaScript)** | [WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md) | Complete guide for web browsers |
| **☕ Java** | [Java Agent](agents/java-agent/README.md) | JVM and Android applications |
| **🐍 Python** | [Python Agent](agents/python-agent/README.md) | Bots, scripts, and automation |
| **⚡ C++** | [C++ Agent](agents/cpp-agent/) | Native applications (experimental) |

### For Game Developers

- **[Game Development Index](agents/GAME-DEV-INDEX.md)** - Start here for games
- **[Getting Started with Games](agents/GETTING-STARTED-GAMES.md)** - Quick game setup
- **[Integration Comparison](agents/INTEGRATION-COMPARISON.txt)** - Choose your integration approach

### Advanced Topics

- **[User Guide](USER-GUIDE.md)** - Comprehensive SDK features
- **[Developer Guide](DEVELOPER-GUIDE.md)** - Architecture and API reference
- **[Contributing](CONTRIBUTING.md)** - How to contribute

---

## ⚡ Quick Start

### Web (JavaScript)

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://hmdevonline.com/messaging-platform/sdk/js/web-agent.libs.js"></script>
    <script src="https://hmdevonline.com/messaging-platform/sdk/js/web-agent.js"></script>
</head>
<body>
    <div id="messages"></div>
    <input id="input" placeholder="Type message...">
    <button onclick="send()">Send</button>

    <script>
        const agent = new AgentConnection({ usePubKey: false });

        agent.onMessage = msg => {
            document.getElementById('messages').innerHTML += 
                `<p><b>${msg.from}:</b> ${msg.content}</p>`;
        };

        agent.connect({
            channelName: 'my-channel',
            channelPassword: 'secret123',
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

### Java

```java
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;

public class QuickChat {
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

        agent.sendMessage("Hello from Java!");
    }
}
```

### Python

```python
from messaging_agent import AgentConnection

agent = AgentConnection()

@agent.on_message
def handle_message(msg):
    print(f"{msg['from']}: {msg['content']}")

agent.connect(
    api_url="https://hmdevonline.com/messaging-platform/api",
    api_key="your-api-key",
    channel_name="my-channel",
    channel_password="secret123",
    agent_name="python-user"
)

agent.send_message("Hello from Python!")
```

> **📌 Note on API Configuration:**  
> The default messaging service URL is `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`.  
> - Java and Python agents use this as the default if no URL is specified
> - Web agents require explicit URL configuration in the `connect()` call
> - The messaging service is a managed service — you consume the endpoint above with an API key;
>   there is nothing to deploy or operate on your side

---

## 🎮 Example Applications

The SDK includes fully functional example applications:

### ⭐ Featured Games
- **🏒 Air Hockey** - 2-4 player real-time physics game with P2P networking
- **❓ Quiz Battle** - Multiplayer trivia with real-time scoring and leaderboards
- **⚡ Reactor** - Fast-paced reaction time game

### More Examples
- **🎨 Whiteboard** - Real-time collaborative drawing with channel storage
- **📁 Quick Share** - Peer-to-peer file sharing via WebRTC DataChannels
- **🤥 Find the Liar** - Social deduction party game (experimental)

[View All Examples →](agents/examples/)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Application                         │
├─────────────┬─────────────────┬─────────────────────────────┤
│  Web Agent  │   Java Agent    │       Python Agent          │
│ (JavaScript)│   (JVM/Android) │    (Scripts/Bots/ML)        │
├─────────────┴─────────────────┴─────────────────────────────┤
│                  Messaging Platform API                      │
│                 (WebSocket + REST + WebRTC)                  │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

- **AgentConnection** - Main client API for all platforms
- **WebRtcHelper** - Peer-to-peer audio/video/data channels
- **Channel Storage** - Distributed key-value persistence
- **Message Routing** - Publish-subscribe messaging patterns

---

## 🚀 Building from Source

### Prerequisites

- Java 11+
- Gradle 7.0+ (wrapper included)
- Python 3.8+ (for Python agent)
- Node.js 16+ (optional, for web demos)

### Build All Agents

```bash
# Clone repository
git clone https://github.com/HaithamMubarak/messaging-platform-sdk.git
cd messaging-platform-sdk

# Build all agents
./gradlew clean build

# Run tests
./gradlew test

# Build specific agent
./gradlew :agents:web-agent-js:build
./gradlew :agents:java-agent:build
./gradlew :agents:python-agent:build
```

### Run Web Server (Examples)

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

Then open the demo site on the port the command prints.

---

## 📦 Installation

### JavaScript (Web)

Include in your HTML:

```html
<script src="https://hmdevonline.com/messaging-platform/sdk/js/web-agent.libs.js"></script>
<script src="https://hmdevonline.com/messaging-platform/sdk/js/web-agent.js"></script>

<!-- Optional: WebRTC support -->
<script src="https://hmdevonline.com/messaging-platform/sdk/js/web-agent.webrtc.js"></script>
```

Or use from your build:

```bash
cd agents/web-agent-js
./gradlew build
# Output: build/distributions/web-agent-js.zip
```

### Java (Gradle)

```gradle
dependencies {
    implementation 'com.hmdev:messaging-agent:1.0.0'
}
```

### Python (pip)

```bash
pip install messaging-agent
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Areas to Contribute

- Bug fixes and improvements
- New example applications
- Documentation improvements
- Language bindings (Rust, Go, etc.)
- Performance optimizations

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🔗 Links

- **Documentation:** https://hmdevonline.com/messaging-platform/sdk/docs.html
- **Live Demo:** https://hmdevonline.com/messaging-platform/sdk/
- **GitHub Issues:** https://github.com/HaithamMubarak/messaging-platform-sdk/issues
- **API Reference:** [WEB-AGENT-GUIDE.md](WEB-AGENT-GUIDE.md)

---

**Built with ❤️ for real-time applications**
