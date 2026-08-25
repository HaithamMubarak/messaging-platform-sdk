# 🎮 Game Developer Documentation Index

**Welcome game developers!** This index helps you find the right documentation for integrating the Messaging Platform into your game.

---

## 🚀 Start Here

### Brand New?
→ **[Getting Started Guide](GETTING-STARTED-GAMES.md)** - Get connected in 5 minutes!

### Need to Choose Integration Method?
→ **[Comparison Chart](INTEGRATION-COMPARISON.txt)** - Visual decision guide with performance data

### Want Quick Answers?
→ **Quick Reference** - Code snippets and decision matrix

### Need Deep Dive?
→ **Complete Integration Guide** - Full architecture, examples, benchmarks

---

## 📚 Documentation by Topic

### Integration Methods

| Document | Purpose | Best For |
|----------|---------|----------|
| [Getting Started](GETTING-STARTED-GAMES.md) | Quick start, copy-paste code | Beginners, rapid prototyping |
| Quick Reference | Fast lookup, code snippets | Experienced devs, quick reference |
| Integration Guide | Complete architecture guide | Production apps, deep understanding |
| [Comparison Chart](INTEGRATION-COMPARISON.txt) | Visual performance comparison | Decision making, architecture review |

### By Game Language

| Language | Recommended Method | Documentation |
|----------|-------------------|---------------|
| **Java** | Direct Integration | [Getting Started - Java](GETTING-STARTED-GAMES.md#for-java-games) |
| **Python** | Direct Integration | [Getting Started - Python](GETTING-STARTED-GAMES.md#for-python-games) |
| **JavaScript** | Direct Integration | [Getting Started - JavaScript](GETTING-STARTED-GAMES.md#for-javascriptweb-games) |
| **C++** | TCP Bridge | [Getting Started - C++](GETTING-STARTED-GAMES.md#for-c-c-unity-unreal-godot-games) |
| **C# / Unity** | TCP Bridge | [Getting Started - C#](GETTING-STARTED-GAMES.md#for-c-c-unity-unreal-godot-games) |
| **Rust** | TCP Bridge | Integration Guide - TCP |
| **Unreal** | TCP Bridge | Integration Guide - C++ |
| **Godot** | TCP Bridge | Integration Guide - TCP |

### By Game Type

| Game Type | Recommended Approach | Key Features |
|-----------|---------------------|--------------|
| **Real-time Multiplayer** (FPS, Racing) | Direct Integration + UDP | Fast position updates, low latency |
| **Turn-based** (Chess, Card Games) | Direct Integration + HTTP | Reliable message delivery |
| **MMO** (Massive Multiplayer) | Direct Integration + Mixed | Channel per room, UDP for movement |
| **Co-op** (2-4 players) | Either method works | Simple setup, any protocol |
| **Mobile** (iOS/Android) | Web Agent (JavaScript) | Browser-based, lightweight |
| **Browser** (HTML5) | Web Agent (JavaScript) | Native web support |

---

## 🎯 Quick Decision Guide

### Step 1: What's your game language?

```
Java / Python / JavaScript?
│
├─> YES → Use Direct Integration ✅
│          • Fastest performance
│          • Simplest setup
│          • Best developer experience
│          → See: Getting Started Guide
│
└─> NO (C++/C#/Rust/Unity/Unreal)
    │
    └─> Use TCP Bridge ⚠️
        • Works with any language
        • Slight performance overhead
        • Two processes to manage
        → See: Getting Started Guide (TCP Bridge section)
```

### Step 2: What's your priority?

```
Performance Critical?
│
├─> YES → Direct Integration (if possible)
│          → See: Performance Comparison
│
└─> NO → Either method works
          → Choose by language support
```

### Step 3: Get Started!

→ **[Getting Started Guide](GETTING-STARTED-GAMES.md)**

---

## 📖 Documentation Structure

```
agents/
├── GETTING-STARTED-GAMES.md          ⭐ Start here! Quick setup guide
├── GAME-INTEGRATION-QUICK-REF.md     ⚡ Fast lookup, code snippets
├── GAME-INTEGRATION-GUIDE.md         📘 Complete guide with examples
├── INTEGRATION-COMPARISON.txt        📊 Visual performance comparison
├── GAME-DEV-INDEX.md                 📚 This file
└── README.md                         📄 Main agents documentation
```

---

## 🏗️ Architecture Overview

### Direct Integration (Recommended for Java/Python/JS)
```
┌────────────────────────────┐
│      Your Game             │
│  ┌──────┐   ┌──────────┐  │
│  │ Game │──>│ SDK (JAR)│  │  ← Just import!
│  └──────┘   └──────────┘  │
│                   │        │
└───────────────────┼────────┘
                    │ HTTPS/UDP
                    ▼
          ┌──────────────────┐
          │ Messaging Service│
          └──────────────────┘

Performance: ⚡⚡⚡ (1-2ms latency)
Complexity:  ⭐ (Simple)
```

### TCP Bridge (For C++/C#/Unity/Unreal)
```
┌──────────┐  TCP   ┌──────────────────┐
│   Game   │◄──────►│  Agent Process   │
└──────────┘ :7071  │  ┌────────────┐  │
                     │  │ SDK (JAR)  │  │
                     │  └────────────┘  │
                     │        │         │
                     └────────┼─────────┘
                              │ HTTPS/UDP
                              ▼
                     ┌──────────────────┐
                     │ Messaging Service│
                     └──────────────────┘

Performance: ⚡⚡ (1.5-3ms latency)
Complexity:  ⭐⭐⭐ (Two processes)
```

---

## 🔥 Common Use Cases

### 1. Multiplayer Chat
```java
// Send to all players
messaging.push(EventMessage.EventType.CHAT_TEXT, "Hello!", "*", sessionId, false);

// Send to specific player
messaging.push(EventMessage.EventType.CHAT_TEXT, "Hi Bob!", "player2", sessionId, false);
```

### 2. Real-time Position Updates
```java
// Fast UDP push (60 times per second)
String state = String.format("{\"x\":%f,\"y\":%f}", player.x, player.y);
messaging.udpPush(state, "*", sessionId);
```

### 3. Turn-based Game Moves
```java
// Reliable HTTP push
String move = "{\"action\":\"move\",\"from\":\"E2\",\"to\":\"E4\"}";
messaging.push(EventMessage.EventType.GAME_STATE, move, "*", sessionId, false);
```

### 4. Matchmaking Lobby
```java
// List all connected players
List<AgentInfo> players = messaging.getActiveAgents(sessionId);
System.out.println("Players in lobby: " + players.size());
```

---

## 📊 Performance Quick Reference

| Operation | Direct | TCP Bridge | Best For |
|-----------|--------|------------|----------|
| Chat messages | 1.2ms | 1.7ms | HTTP push |
| Position updates | 0.3ms | 0.8ms | UDP push |
| Receive messages | 1.5ms | 2.0ms | HTTP pull |
| Fast polling | 0.4ms | 0.9ms | UDP pull |

**Memory Overhead:**
- Direct: 0 MB
- TCP Bridge: +50-100 MB

**Recommendation:** Use direct integration when possible for best performance.

---

## 🛠️ Common Code Patterns

### Initialize Once
```java
// At game startup
MessagingChannelApi messaging = new MessagingChannelApi(apiUrl, apiKey);
```

### Connect to Room
```java
// When entering multiplayer
ConnectResponse response = messaging.connect("room-name", "password", "player1");
String sessionId = response.getSessionId();
```

### Background Polling Thread
```java
// Start once after connecting
new Thread(() -> {
    ReceiveConfig config = new ReceiveConfig(0, 0, 50);
    while (connected) {
        EventMessageResult result = messaging.pull(sessionId, config);
        result.getMessages().forEach(this::handleMessage);
        if (result.getNextGlobalOffset() != null) {
            config.setGlobalOffset(result.getNextGlobalOffset());
        }
    }
}).start();
```

### Disconnect
```java
// When leaving multiplayer
messaging.disconnect(sessionId);
```

---

## 🐛 Troubleshooting

### Common Issues

| Problem | Solution | Documentation |
|---------|----------|---------------|
| "Connection refused" | Check service is running | [Getting Started - Testing](GETTING-STARTED-GAMES.md#testing-locally) |
| "Session expired" | Reconnect to channel | Integration Guide - Errors |
| "TCP failed" (bridge) | Check agent server running | [Getting Started - TCP](GETTING-STARTED-GAMES.md#tcp-bridge) |
| Slow performance | Use UDP instead of HTTP | Quick Ref - Performance |
| High latency | Switch to direct integration | [Comparison Chart](INTEGRATION-COMPARISON.txt) |

---

## 🎓 Learning Path

### Beginner
1. Read [Getting Started Guide](GETTING-STARTED-GAMES.md)
2. Copy-paste code for your language
3. Test with local messaging service
4. Build simple chat feature

### Intermediate
1. Read Quick Reference
2. Understand UDP vs HTTP trade-offs
3. Implement real-time position updates
4. Add matchmaking lobby

### Advanced
1. Read Complete Integration Guide
2. Optimize polling frequency
3. Implement encryption for competitive games
4. Build production-ready error handling

---

## 📦 SDK Files Reference

### Java Agent
- **API Interface:** `/java-agent/src/main/java/com/hmdev/messaging/agent/api/ConnectionChannelApi.java`
- **Implementation:** `/java-agent/src/main/java/com/hmdev/messaging/agent/api/impl/MessagingChannelApi.java`
- **JAR Files:** `/libs/agents-1.0.0.jar`, `/libs/messaging-common-1.0.0.jar`

### Python Agent
- **Main Class:** `/python-agent/hmdev/messaging/agent/core/agent_connection.py`
- **Models:** `/python-agent/hmdev/messaging/agent/api/models.py`
- **Install:** `pip install -e ./python-agent`

### Web Agent
- **Connection Class:** `/web-agent/js/agent-connection.js`
- **Config Loader:** `/web-agent/js/config-loader.js`
- **Examples:** `/web-agent/examples/chat.html`, `/web-agent/examples/webrtc.html`

---

## 🔗 External Resources

### Local Development
- **Start Services:** `messaging-env.sh start`
- **Service URL:** `http://localhost:8082/messaging-platform/api/v1/messaging-service`
- **Health Check:** `curl http://localhost:8082/health`

### Production
- **Production URL:** `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`
- **API Docs:** (add your API documentation link)
- **Status Page:** (add your status page link)

---

## ❓ FAQ

**Q: Which method should I use for my Java game?**
A: Direct integration - best performance and simplest setup.

**Q: Can I use this with Unity?**
A: Yes, use TCP bridge. See [Getting Started - C#](GETTING-STARTED-GAMES.md#for-c-c-unity-unreal-godot-games).

**Q: What's the latency difference?**
A: Direct is 30-50% faster. See [Comparison Chart](INTEGRATION-COMPARISON.txt).

**Q: Can I switch from TCP bridge to direct integration later?**
A: Yes, if you migrate to Java/Python/JS. The API is similar.

**Q: Do I need to run a local server for testing?**
A: Yes, run `messaging-env.sh start` for local development.

**Q: Is encryption supported?**
A: Yes, pass `encrypted=true` to push methods. See examples.

---

## 📞 Support

- **Documentation:** You're here! 📚
- **Examples:** `/agents/examples/` directory
- **Issues:** (add your issue tracker link)
- **Community:** (add your community link)

---

## 🎉 You're Ready!

Pick your path:
- **Quick Start** → [Getting Started Guide](GETTING-STARTED-GAMES.md)
- **Need Details** → Integration Guide
- **Just Code** → Quick Reference

**Good luck with your game!** 🎮🚀

---

**Last Updated:** December 30, 2025  
**Maintained by:** Messaging Platform Team

