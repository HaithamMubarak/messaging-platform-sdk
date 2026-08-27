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

> **What the npm package contains.** Installing
> `@messaging-platform/web-agent-js` gives you `js/web-agent.js`,
> `js/web-agent.libs.js`, `js/web-agent.webrtc.js` and the TypeScript
> definitions — that is the SDK. The file tables and project tree below
> describe this **repository folder**, which additionally holds page helpers
> (`config-loader.js`, `mini-game-utils.js`, `share-modal.js`) and stylesheets
> used by the showcase site. Those are not published, and nothing in the Quick
> Start above needs them.

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

### 1. Install

```bash
npm i @messaging-platform/web-agent-js
```

About 80 KB gzipped, with TypeScript definitions included.

```js
import { AgentConnection, generateRandomAgentName } from '@messaging-platform/web-agent-js';
// CommonJS:
// const { AgentConnection } = require('@messaging-platform/web-agent-js');
```

Or with no build step at all, straight from script tags — load the libraries
first, since `web-agent.js` expects them as globals:

```html
<script src="node_modules/@messaging-platform/web-agent-js/js/web-agent.libs.js"></script>
<script src="node_modules/@messaging-platform/web-agent-js/js/web-agent.js"></script>

<!-- Optional: peer-to-peer data channels, audio and video -->
<script src="node_modules/@messaging-platform/web-agent-js/js/web-agent.webrtc.js"></script>
```

### 2. Join a channel and send something

A channel is identified by a name and a password. Everyone who connects with the
same pair is in the same room; there are no accounts to create.

```js
const agent = new AgentConnection();

agent.on('connect', () => {
    agent.sendMessage({ msg: { hello: 'everyone' } });     // to the whole channel
});

agent.on('message', (event) => {
    console.log('received', event);
});

agent.on('agentConnected', (event) => console.log('joined:', event));
agent.on('agentDisconnected', (event) => console.log('left:', event));

agent.connect({
    api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service',
    apiKey: 'your-api-key',
    apiKeyScope: 'public',          // 'public' keys are safe to ship in a browser
    channelName: 'my-room',
    channelPassword: 'a-shared-secret',
    agentName: generateRandomAgentName(),
});
```

To reach one participant rather than the whole channel, name them:

```js
agent.sendMessage({ msg: { deal: 'your card' }, destAgent: 'Priya', encrypted: true });
```

### 3. Warn before losing work

The SDK only prompts on unload when an app says there is something to lose, so
a read-only page never nags:

```js
agent.setUnsavedChanges(true);   // ...and false once saved
```

### 4. Peer-to-peer, with WebRTC

Load `web-agent.webrtc.js` as well and the connection gains a WebRTC helper for
data channels and media that travel browser to browser rather than through the
service. See `WEB-AGENT-GUIDE.md` for the signalling flow and the helper's API.


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

### 📁 examples/

- **basic-connection.html** - Simple connection and messaging
  - Create connection
  - Send/receive messages
  - Handle player joins/leaves

- **webrtc-example.html** - WebRTC P2P demonstration
  - Ultra-low latency P2P
  - Performance comparison
  - Peer connection management

Open them in your browser to see the SDK in action! See examples/README.md for more details.

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

