# Web Agent Guide

**Messaging Platform SDK — JavaScript/Web Client**  
**Version:** 1.0.0

> For a multi-language overview and quick-start, see [USER-GUIDE.md](USER-GUIDE.md).  
> For repo structure and build system, see [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md).

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Basic Messaging](#basic-messaging)
3. [Channel Storage (Key-Value Store)](#channel-storage-key-value-store)
4. [WebRTC Video Streaming](#webrtc-video-streaming)
5. [Advanced Topics](#advanced-topics)
6. [Security Best Practices](#security-best-practices)
7. [Troubleshooting](#troubleshooting)
8. [API Reference](#api-reference)

---

## Quick Start

### Installation

```html
<!-- Core (required) -->
<script src="js/web-agent.libs.js"></script>
<script src="js/web-agent.js"></script>

<!-- Optional: WebRTC support -->
<script src="js/web-agent.webrtc.js"></script>
```

### Minimal Example

```javascript
const agent = new AgentConnection();

agent.onMessage = (msg) => console.log(`${msg.from}: ${msg.content}`);

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'secret123',
    agentName: 'web-user-1',
    api: 'http://localhost:8082',
    apiKey: 'your-api-key',
    autoReceive: true
});

agent.sendTextMessage('Hello, World!');
```

---

## Basic Messaging

### Full Chat Example

```html
<!DOCTYPE html>
<html>
<body>
    <div id="messages" style="height:400px;overflow-y:scroll;border:1px solid #ccc;padding:10px"></div>
    <input id="input" placeholder="Type message...">
    <button onclick="send()">Send</button>

    <script src="js/web-agent.libs.js"></script>
    <script src="js/web-agent.js"></script>
    <script>
        const agent = new AgentConnection();

        agent.onMessage = (msg) => {
            const div = document.createElement('div');
            div.textContent = `${msg.from}: ${msg.content}`;
            document.getElementById('messages').appendChild(div);
        };

        agent.onChannelConnect = () => console.log('Connected');
        agent.onChannelDisconnect = () => console.log('Disconnected');

        agent.connect({
            channelName: 'chat-room',
            channelPassword: 'password123',
            agentName: 'user-' + Date.now(),
            api: 'http://localhost:8082',
            apiKey: 'your-api-key',
            autoReceive: true
        });

        function send() {
            const input = document.getElementById('input');
            if (input.value.trim()) {
                agent.sendTextMessage(input.value);
                input.value = '';
            }
        }
    </script>
</body>
</html>
```

### Event Handlers

```javascript
agent.onMessage          = (msg) => { /* message received */ };
agent.onChannelConnect   = () => { /* connected to channel */ };
agent.onChannelDisconnect = () => { /* disconnected */ };
agent.onAgentJoin        = (name) => { /* agent joined */ };
agent.onAgentLeave       = (name) => { /* agent left */ };
agent.onError            = (err) => { /* error occurred */ };
```

### Sending Messages

```javascript
// Text
agent.sendTextMessage('Hello World!');

// JSON data
agent.sendDataMessage({ type: 'game-state', position: { x: 100, y: 200 } });

// To a specific agent
agent.sendTextMessage('Private message', 'specific-agent-name');

// To agents matching a filter
agent.sendTextMessage('Team update', null, 'team=blue');

// Binary
agent.sendBinaryMessage(new Uint8Array([1, 2, 3, 4]).buffer);
```

---

## Channel Storage (Key-Value Store)

Persistent key-value storage per channel. Data survives agent disconnections.

**Features:**
- **PUT** — replace all versions of a key
- **ADD** — append a new version (keep history)
- **GET** — retrieve latest version
- **GET LIST** — retrieve all versions

### Basic Operations

```javascript
// Store (replace)
agent.storagePut({
    storageKey: 'game-state',
    content: { level: 5, score: 1000 },
    metadata: { description: 'Player save' }
}, (response) => {
    if (response.status === 'success') console.log('Saved');
});

// Retrieve latest
agent.storageGet({ storageKey: 'game-state' }, (response) => {
    if (response.status === 'success') console.log(response.data);
});

// Append version (keep history)
agent.storageAdd({ storageKey: 'scores', content: { player: 'alice', score: 1500 } }, (r) => {});

// All versions
agent.storageGetList({ storageKey: 'scores' }, (response) => {
    response.data.forEach(entry => console.log(entry));
});

// List all keys
agent.storageKeys((response) => console.log(response.data));

// Delete
agent.storageDeleteByKey('old-data', (r) => {});
```

### Example: Game State Persistence

```javascript
function saveGame() {
    agent.storagePut({ storageKey: 'game-state', content: gameState }, (r) => {
        if (r.status === 'success') showMessage('Saved!');
    });
}

function loadGame() {
    agent.storageGet({ storageKey: 'game-state' }, (r) => {
        if (r.status === 'success') restoreState(r.data);
        else startNewGame();
    });
}
```

### Example: Collaborative Whiteboard

```javascript
// Save whiteboard state on each stroke
function addStroke(stroke) {
    whiteboard.strokes.push(stroke);
    agent.storagePut({ storageKey: 'whiteboard', content: whiteboard }, () => {});
    agent.sendCustomMessage('whiteboard-update', stroke); // real-time sync
}

// Load on connect
agent.onChannelConnect = () => {
    agent.storageGet({ storageKey: 'whiteboard' }, (r) => {
        if (r.status === 'success') redraw(r.data.strokes);
    });
};
```

### Example: Leaderboard

```javascript
function submitScore(player, score) {
    agent.storageAdd({ storageKey: 'leaderboard', content: { player, score, ts: Date.now() } }, () => {
        loadLeaderboard();
    });
}

function loadLeaderboard() {
    agent.storageGetList({ storageKey: 'leaderboard' }, (r) => {
        const top10 = r.data.sort((a, b) => b.score - a.score).slice(0, 10);
        displayLeaderboard(top10);
    });
}
```

### Storage Best Practices

```javascript
// Use PUT for single-value (replaces), ADD for history (appends)
agent.storagePut({ storageKey: 'current-state', content: state }, cb);  // replaces
agent.storageAdd({ storageKey: 'action-log', content: action }, cb);     // appends

// Add meaningful metadata
agent.storagePut({
    storageKey: 'document',
    content: doc,
    metadata: { description: 'Draft v3', properties: { author: agent.agentName } }
}, cb);

// Handle errors
agent.storageGet({ storageKey: 'prefs' }, (r) => {
    if (r.status === 'success') applyPrefs(r.data);
    else useDefaults();
});
```

---

## WebRTC Video Streaming

### Broadcast Video

```html
<video id="local" autoplay muted></video>
<script src="js/web-agent.libs.js"></script>
<script src="js/web-agent.js"></script>
<script src="js/web-agent.webrtc.js"></script>
<script>
    const agent = new AgentConnection({ usePubKey: false });
    const webrtc = new WebRtcHelper(agent);

    agent.connect({ channelName: 'video', channelPassword: 'pass', agentName: 'broadcaster',
        api: 'http://localhost:8082', apiKey: 'your-key' });

    async function startStreaming() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local').srcObject = stream;
        await webrtc.startStreamBroadcast('stream-' + Date.now(), stream, null);
    }
</script>
```

### Receive Video

```javascript
const webrtc = new WebRtcHelper(agent);

webrtc.on('stream-added', (streamId, mediaStream) => {
    document.getElementById('remoteVideo').srcObject = mediaStream;
});

webrtc.on('stream-removed', (streamId) => {
    document.getElementById('remoteVideo').srcObject = null;
});
```

### One-to-One Call

```javascript
const webrtc = new WebRtcHelper(agent);
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
document.getElementById('localVideo').srcObject = stream;
webrtc.setLocalMediaStream(stream);
await webrtc.createStreamOffer('call-' + Date.now(), 'other-agent-name', { stream });
```

### Screen Sharing

```javascript
async function shareScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } });
    const streamId = 'screen-' + Date.now();
    await webrtc.startStreamBroadcast(streamId, stream, null);
    stream.getVideoTracks()[0].onended = () => webrtc.stopStreamBroadcast(streamId);
}
```

### TURN/STUN Configuration

```javascript
const webrtc = new WebRtcHelper(agent);
webrtc.iceServers = [
    { urls: ['stun:your-stun-server.com:3478'] },
    { urls: ['turn:your-turn-server.com:3478'], username: 'user', credential: 'pass' }
];
```

### WebRTC Best Practices

✅ Always use HTTPS in production (required for WebRTC)  
✅ Stop tracks on disconnect: `stream.getTracks().forEach(t => t.stop())`  
✅ Configure TURN servers for reliable NAT traversal  
✅ Request camera/mic permissions explicitly  
❌ Don't rely on P2P without TURN servers in production  

---

## Advanced Topics

### Message Filtering

```javascript
// Send to agents matching filter criteria
agent.sendTextMessage('Hello team!', null, 'team=blue,level>3');
```

**Filter syntax:**
- `key=value` — exact match
- `key:value` — contains
- `key>value` / `key<value` — numeric comparison
- `key1=v1,key2=v2` — multiple conditions (AND)

### Temporary API Keys

```javascript
agent.requestTempKey = true;  // Agent will request and use a temporary key

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'password',
    agentName: 'agent-1',
    api: 'http://localhost:8082',
    apiKey: 'your-permanent-key',
    autoReceive: true
});
```

### `apiKeyScope` — Channel Isolation

```javascript
agent.connect({
    // ...
    apiKeyScope: 'private'  // default — channels isolated per API key
    // apiKeyScope: 'public' — channels shared across all API keys (for demos/testing)
});
```

See [USER-GUIDE.md § API Key & Channel Isolation](USER-GUIDE.md#api-key--channel-isolation) for full explanation.

### File Sharing (P2P via DataChannels)

```javascript
class MyFileShare extends AgentInteractionBase {
    constructor() {
        super({ storagePrefix: 'fileshare', customType: 'file-share',
            autoCreateDataChannel: true, dataChannelName: 'files-data' });
    }

    async shareFile(file, targetPeer = null) {
        const transferId = 'transfer-' + Date.now();
        const chunkSize = 16384;
        const totalChunks = Math.ceil(file.size / chunkSize);

        this.sendData({ type: 'file-offer', transferId, fileName: file.name,
            fileSize: file.size, totalChunks }, targetPeer);

        for (let i = 0; i < totalChunks; i++) {
            const chunk = await file.slice(i * chunkSize, (i + 1) * chunkSize).arrayBuffer();
            this.sendData({ type: 'file-chunk', transferId, chunkIndex: i,
                chunk: Array.from(new Uint8Array(chunk)) }, targetPeer);
        }
    }
}
```

See `examples/quickshare/QuickShare.js` for a complete working implementation.

---

## Security Best Practices

```javascript
// ❌ Never hardcode API keys
const apiKey = 'your-key-here';

// ✅ Load from server
const { apiKey } = await fetch('/api/config').then(r => r.json());

// ✅ Strong channel passwords
agent.connect({ channelPassword: 'Xy9$mK#pL2@nQ5!wR', ... });

// ✅ Validate input before sending
function send(text) {
    const clean = text.trim().replace(/<script>/gi, '');
    if (clean.length > 0 && clean.length < 1000) agent.sendTextMessage(clean);
}

// ✅ Disconnect on page unload
window.addEventListener('beforeunload', () => {
    if (agent?.isConnected()) agent.disconnect();
});

// ✅ HTTPS in production — WebSocket automatically uses WSS
const api = 'https://your-domain.com';
```

---

## Troubleshooting

### Can't Connect

```javascript
agent.onError = (e) => console.error(e);
// Also check: fetch('http://localhost:8082/messaging-platform/actuator/health')
```

1. Verify server is running
2. Check API URL and port
3. Verify API key is valid
4. Look for CORS errors in browser console
5. Ensure WebSocket port is not blocked by firewall

### No Video (WebRTC)

```javascript
webrtc.on('peer-state-change', (streamId, state) => console.log('State:', state));
webrtc.on('ice-candidate', (streamId, c) => console.log('ICE:', c));
```

1. Check camera/mic permissions in browser
2. Verify HTTPS (required for camera access in production)
3. Check TURN/STUN server configuration
4. Test with different browsers

### Messages Not Received

1. Verify both agents on same channel with same password
2. Check `apiKeyScope` — `private` vs `public` must match
3. Confirm `autoReceive: true` is set
4. Check filter query — is receiver's metadata matching?

---

## API Reference

### `connect(config)` Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `channelName` | Yes* | Channel name (* or use `channelId`) |
| `channelPassword` | Yes* | Channel password (* or use `channelId`) |
| `agentName` | Yes | Your agent's identifier |
| `api` | Yes | API base URL |
| `apiKey` | Yes | Developer API key |
| `autoReceive` | No | Auto-receive messages (default: false) |
| `channelId` | No | Connect by ID instead of name/password |
| `sessionId` | No | Resume existing session |
| `apiKeyScope` | No | `'private'` (default) or `'public'` |

### AgentConnection Methods

| Method | Description |
|--------|-------------|
| `connect(config)` | Connect to channel |
| `disconnect()` | Disconnect |
| `sendTextMessage(content, to?, filter?)` | Send text |
| `sendDataMessage(data, to?, filter?)` | Send JSON data |
| `sendBinaryMessage(buffer)` | Send binary |
| `isConnected()` | Check connection state |
| `storagePut(params, callback)` | Store/replace value |
| `storageAdd(params, callback)` | Append version |
| `storageGet(params, callback)` | Get latest version |
| `storageGetList(params, callback)` | Get all versions |
| `storageKeys(callback)` | List all keys |
| `storageDeleteByKey(key, callback)` | Delete key |

### WebRtcHelper Methods

| Method | Description |
|--------|-------------|
| `startStreamBroadcast(id, stream, target)` | Broadcast video |
| `stopStreamBroadcast(id)` | Stop broadcast |
| `createStreamOffer(id, target, options)` | One-to-one call |
| `setLocalMediaStream(stream)` | Set local stream |
| `on(event, handler)` | Register event handler |

### WebRtcHelper Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `stream-added` | `(streamId, stream, sourceAgent)` | Remote stream received |
| `stream-removed` | `(streamId)` | Remote stream ended |
| `peer-connected` | `(peerId)` | Peer connected |
| `peer-disconnected` | `(peerId)` | Peer disconnected |
| `peer-state-change` | `(streamId, state)` | Connection state changed |
| `error` | `(streamId, error)` | WebRTC error |

---

## Running the Demos

```bash
cd agents/examples/web-sdk-server
./gradlew bootRun
# Open http://localhost:8084
```

**Available demos:** chat, WebRTC video, whiteboard, leaderboard, storage, mini-games, developer console.
