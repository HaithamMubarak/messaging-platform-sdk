# 🚀 Web Agent JavaScript SDK

> Build real-time multiplayer experiences in minutes!

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/your-org/messaging-platform-sdk)
[![Size](https://img.shields.io/badge/size-332KB-green.svg)](https://github.com/your-org/messaging-platform-sdk)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE.md)

**Version:** 1.0.0 | **Date:** January 21, 2026

---

## 🎯 What is This?

The **Web Agent JavaScript SDK** is your toolkit for building **real-time multiplayer applications**! Whether you're creating games, chat apps, collaborative tools, or live dashboards - this SDK has you covered.

Think of it as the **JavaScript equivalent** of our Java and Python agents, but supercharged with **WebRTC support** for ultra-low latency P2P connections! ⚡

### 📊 At a Glance

- 🎮 **11 SDK files** ready to use
- ⚡ **Sub-100ms latency** with WebRTC
- 🔒 **Built-in encryption** (RSA + AES)
- 💾 **Persistent storage** per channel
- 🎨 **Pre-built UI components**
- 📱 **Mobile-friendly** QR code sharing

---

## ✨ Features That Rock

### 🎯 Main SDK Files

| File | Size | What It Does |
|------|------|--------------|
| **web-agent.js** | 86 KB | 🎯 Core SDK - Agent, Channel, messaging magic |
| **web-agent.webrtc.js** | 28 KB | ⚡ WebRTC P2P - Lightning-fast data channels |
| **web-agent.libs.js** | 149 KB | 🔒 Crypto libraries - RSA, AES, MD5, Base64 |

### 🛠️ Utility Files

| File | Size | What It Does |
|------|------|--------------|
| **config-loader.js** | 3.4 KB | ⚙️ Auto-loads API configuration |
| **mini-game-utils.js** | 31 KB | 🎮 Game helpers & utilities |
| **share-modal.js** | 34 KB | 📤 Beautiful sharing UI with QR codes |
| **qrcode.min.js** | 20 KB | 📱 QR code generation library |

### 🎨 Style Files

- `common.css` - Base styles
- `icons.css` - Icon styles  
- `mini-games-connection.css` - Connection modal
- `share-modal.css` - Share modal styles

**Total:** 11 files, ~332 KB of awesome! 🎉

---

## 📂 Project Structure

```
web-agent-js/
├── README.md                       # This file
├── js/
│   ├── web-agent.js                # Core SDK (Channel, Agent, HTTP/WebSocket)
│   ├── web-agent.webrtc.js         # WebRTC helper for P2P connections
│   ├── web-agent.libs.js           # Third-party libraries (JSEncrypt, crypto)
│   ├── config-loader.js            # Configuration loader
│   ├── mini-game-utils.js          # Utilities for mini-games
│   └── share-modal.js              # Share modal functionality
├── css/
│   ├── common.css                  # Common styles
│   ├── icons.css                   # Icon styles
│   ├── mini-games-connection.css   # Connection modal styles
│   └── share-modal.css             # Share modal styles
└── lib/
    └── qrcode.min.js               # QR code generation library
```

---

## 🚀 Quick Start

### 1. Include SDK Files

```html
<!DOCTYPE html>
<html>
<head>
    <!-- CSS -->
    <link rel="stylesheet" href="path/to/web-agent-js/css/common.css">
    <link rel="stylesheet" href="path/to/web-agent-js/css/mini-games-connection.css">
</head>
<body>
    <!-- Your content -->
    
    <!-- JS Libraries (load in order) -->
    <script src="path/to/web-agent-js/js/config-loader.js"></script>
    <script src="path/to/web-agent-js/js/web-agent.libs.js"></script>
    <script src="path/to/web-agent-js/js/web-agent.webrtc.js"></script>
    <script src="path/to/web-agent-js/js/web-agent.js"></script>
    <script src="path/to/web-agent-js/js/mini-game-utils.js"></script>
</body>
</html>
```

### 2. Basic Usage

```javascript
// Create agent and channel
const agent = await Agent.create({
    apiKey: 'your-api-key',
    baseURL: 'http://localhost:8080'
});

const channel = await agent.getOrCreateChannel({
    channelName: 'my-room',
    channelPassword: 'optional-password'
});

// Listen for messages
channel.setCustomMessageHandler((message) => {
    console.log('Received:', message);
});

// Send a message
channel.sendMessage({
    type: 'chat',
    content: 'Hello World!'
});
```

### 3. With WebRTC

```javascript
const game = await Game.create({
    username: 'Player1',
    channelName: 'game-room',
    channelPassword: ''
});

const channel = game.channel;
const webrtcHelper = game.webrtcHelper;

// Broadcast via WebRTC (low latency)
webrtcHelper.broadcastDataChannel({
    type: 'position',
    x: 100,
    y: 200
});

// Listen for WebRTC messages
webrtcHelper.setDataChannelHandler((message) => {
    console.log('WebRTC message:', message);
});
```

---

## 📚 Core Components

### **web-agent.js**
Main SDK containing:
- `AgentConnection` - Main class for connecting to channels and messaging
- `MySecurity` - Encryption utilities (RSA, AES, MD5, hashing)
- `FileSystem` - File upload/download through channels

### **web-agent.webrtc.js**
WebRTC helper for P2P connections:
- `WebRTCHelper` - Manages WebRTC data channels
- Auto-reconnection on connection failures
- Binary data support for efficiency

### **web-agent.libs.js**
Third-party libraries:
- JSEncrypt (RSA encryption)
- AES encryption utilities
- MD5 hashing
- Base64 encoding

### **config-loader.js**
Configuration management:
- Loads API endpoint from `/config`
- Environment-specific settings

### **mini-game-utils.js**
Utilities for building games:
- `Game.create()` - Easy game initialization
- Connection modal helpers
- Player management utilities

### **share-modal.js**
Sharing functionality:
- QR code generation
- Link copying
- Mobile-friendly sharing

---

## 🎮 Live Examples

Ready to see it in action? Check out working examples:

### 📁 [examples/](examples/)

- **[basic-connection.html](examples/basic-connection.html)** - Simple connection and messaging
  - Create connection
  - Send/receive messages
  - Handle player joins/leaves

- **[webrtc-example.html](examples/webrtc-example.html)** - WebRTC P2P demonstration
  - Ultra-low latency P2P
  - Performance comparison
  - Peer connection management

Open them in your browser to see the SDK in action! See [examples/README.md](examples/README.md) for more details.

---

## 💡 What Can You Build?

### 🎮 Multiplayer Games
- Real-time action games (FPS, racing, sports)
- Turn-based strategy games (chess, cards)
- Collaborative puzzle games
- **Examples:** Bounce Ball, 4-Player Reactor, Babyfoot

### 💬 Chat & Social
- Group chat applications
- Private messaging
- Video chat with data channels
- Live comments & reactions

### 🎨 Collaboration Tools
- Real-time whiteboards
- Collaborative document editing
- Design tools (Figma-style)
- Code pair programming

### 📊 Live Dashboards
- Real-time analytics
- Stock tickers
- Monitoring dashboards
- IoT device control panels

### 🔔 Notification Systems
- Push notifications
- Live alerts
- Event broadcasting
- Activity feeds

**See it in action:** Check out the **mini-games-server** project for 6 working examples! 🎉

---

## 📖 Examples

See the following for complete examples:

- **mini-games-server** - Multiple game implementations
  - Reaction Speed Battle
  - Quiz Battle
  - Real-Time Whiteboard
  - Babyfoot (3D Foosball)
  - Bounce Ball
  - 4-Player Reactor

- **web-agent-service** - Web service serving games

---

## 🔧 API Reference

### Agent API

```javascript
// Create agent
const agent = await Agent.create({ apiKey, baseURL });

// Get or create channel
const channel = await agent.getOrCreateChannel({ 
    channelName, 
    channelPassword 
});
```

### Channel API

```javascript
// Send message
channel.sendMessage({ type: 'event', data: {} });

// Listen for messages
channel.setCustomMessageHandler((msg) => { /* ... */ });

// Storage API
await channel.storagePut('key', 'value');
const value = await channel.storageGet('key');
await channel.storageDelete('key');

// Agent management
channel.setAgentJoinHandler((agent) => { /* ... */ });
channel.setAgentLeaveHandler((agentName) => { /* ... */ });
```

### WebRTC API

```javascript
// Broadcast to all peers
webrtcHelper.broadcastDataChannel({ type: 'update', data });

// Listen for data channel messages
webrtcHelper.setDataChannelHandler((msg) => { /* ... */ });

// Connection handlers
webrtcHelper.setConnectionEstablishedHandler((peerId) => { /* ... */ });
webrtcHelper.setConnectionClosedHandler((peerId) => { /* ... */ });
```

---

## 🔒 Security

- **RSA Encryption** - For key exchange
- **AES Encryption** - For message content (optional)
- **Password Protection** - Channel-level passwords
- **Temporary Keys** - Short-lived API keys for demos

---

## 🤝 Comparison with Other Agents

| Feature | Java Agent | Python Agent | **Web Agent JS** |
|---------|-----------|--------------|------------------|
| Language | Java | Python | JavaScript |
| Platform | JVM | CPython | Browser/Node.js |
| WebRTC | ❌ | ❌ | ✅ |
| UI Components | ❌ | ❌ | ✅ (modals) |
| Encryption | ✅ | ✅ | ✅ |
| Storage API | ✅ | ✅ | ✅ |
| WebSocket | ✅ | ✅ | ✅ |

---

## 📝 License

See LICENSE.md in the root of the messaging-platform-sdk repository.

---

## 🚀 Getting Started

1. **Copy this SDK** to your web project
2. **Include JS/CSS files** in your HTML
3. **Initialize** Agent and Channel
4. **Start building!**

For detailed examples, see the `mini-games-server` project.

---

**Last Updated:** January 21, 2026

