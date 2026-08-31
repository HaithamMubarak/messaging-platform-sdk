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

agent.addEventListener('message', (ev) => {
    ((ev.response && ev.response.data) || []).forEach((item) => {
        if (item && item.type === 'chat-text') console.log(`${item.from}: ${item.content}`);
    });
});

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'secret123',
    agentName: 'web-user-1',
    api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service',
    apiKey: 'your-api-key',
    autoReceive: true
});

agent.sendMessage('Hello, World!');
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

        agent.addEventListener('message', (ev) => {
            // One event can carry several items, and the same stream carries
            // join/leave notices as type 'connect' and 'disconnect'. Text sent
            // with sendMessage() arrives as 'chat-text'.
            ((ev.response && ev.response.data) || []).forEach((item) => {
                if (!item || item.type !== 'chat-text') return;
                const div = document.createElement('div');
                div.textContent = `${item.from}: ${item.content}`;
                document.getElementById('messages').appendChild(div);
            });
        });

        agent.addEventListener('connect', () => console.log('Connected'));
        agent.addEventListener('disconnect', () => console.log('Disconnected'));

        agent.connect({
            channelName: 'chat-room',
            channelPassword: 'password123',
            agentName: 'user-' + Date.now(),
            api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service',
            apiKey: 'your-api-key',
            autoReceive: true
        });

        function send() {
            const input = document.getElementById('input');
            if (input.value.trim()) {
                agent.sendMessage(input.value);
                input.value = '';
            }
        }
    </script>
</body>
</html>
```

### Event Handlers

`AgentConnection` is an event target, not a bag of callback properties —
register with `addEventListener(name, handler)`:

```javascript
agent.addEventListener('connect',    (ev) => { /* ev.response.status is 'success' or 'error' */ });
agent.addEventListener('disconnect', (ev) => { /* left the channel */ });
agent.addEventListener('message',    (ev) => { /* ev.response.data is an array of items */ });

agent.addEventListener('agent-connect',    (ev) => { /* ev.agentName joined */ });
agent.addEventListener('agent-disconnect', (ev) => { /* ev.agentName left */ });

agent.addEventListener('connection-lost',   () => { /* transport dropped; the SDK retries */ });
agent.addEventListener('session-not-found', () => { /* the server forgot this session */ });
```

Errors are not a separate event: a failed connect arrives as a `connect` event
whose `ev.response.status` is `'error'`, and `ev.response.data` carries the
reason.

### Sending Messages

Everything goes through `sendMessage()`. Pass a string to broadcast, or an
object to address or filter it:

```javascript
// Text, to everyone in the channel
agent.sendMessage('Hello World!');

// JSON data — the content is a string on the wire, so stringify it yourself
agent.sendMessage(JSON.stringify({ type: 'game-state', position: { x: 100, y: 200 } }));

// To a specific agent
agent.sendMessage({ content: 'Private message', to: 'specific-agent-name' });

// To agents matching a filter
agent.sendMessage({ content: 'Team update', filter: 'team=blue' });

// With a completion callback
agent.sendMessage('Did it land?', (res) => console.log(res.status));
```

`to` and `filter` are mutually exclusive — passing both throws. For binary or
high-rate data use a WebRTC data channel (`WebRtcHelper.sendData`) rather than
the channel; see [WebRTC](#webrtc-support).

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

// All versions — note this one takes the key as a plain string, not an object.
// Passing { storageKey } here fails server-side with a JSON parse error.
agent.storageGetList('scores', (response) => {
    response.data.data.versions.forEach(entry => console.log(entry));
});

// List all keys
agent.storageKeys((response) => console.log(response.data.data.keys));

// Every value in the channel
agent.storageValues((response) => console.log(response.data.data.values));

// Delete
agent.storageDeleteByKey('old-data', (r) => {});
```

#### Reading the response

`storageGet` hands you the stored content directly at `response.data`:

```javascript
agent.storageGet({ storageKey: 'game-state' }, (r) => {
    if (r.status === 'success') console.log(r.data.level, r.data.score);  // your object
});
```

Every **other** storage call wraps the server's reply one level deeper —
`response.data` is the server envelope and the payload is at
`response.data.data`:

| Call | Where the payload is |
|------|----------------------|
| `storageGet(...)` | `response.data` — the content itself |
| `storageGetList(key, cb)` | `response.data.data.versions` — see the note on `content` below |
| `storageKeys(cb)` | `response.data.data.keys` |
| `storageValues(cb)` | `response.data.data.values` |
| `storagePut` / `storageAdd` | `response.data.data` — version metadata |
| `storageDeleteByKey(key, cb)` | `response.data.data.versionsDeleted` |

`storageGet` decodes the content for you. The listing calls do not: every
`content` field they return is **base64-encoded JSON**, so decode it yourself
with `JSON.parse(atob(entry.content))`.

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
    // Real-time sync: a CUSTOM message carries your own type alongside it.
    agent.sendMessage({
        content: JSON.stringify(stroke),
        type: 'CUSTOM',
        customType: 'whiteboard-update'
    });
}

// Load on connect
agent.addEventListener('connect', () => {
    agent.storageGet({ storageKey: 'whiteboard' }, (r) => {
        if (r.status === 'success') redraw(r.data.strokes);
    });
});
```

### Example: Leaderboard

```javascript
function submitScore(player, score) {
    agent.storageAdd({ storageKey: 'leaderboard', content: { player, score, ts: Date.now() } }, () => {
        loadLeaderboard();
    });
}

function loadLeaderboard() {
    agent.storageGetList('leaderboard', (r) => {
        // Listing calls return content base64-encoded; storageGet does not.
        const entries = r.data.data.versions.map((v) => JSON.parse(atob(v.content)));
        const top10 = entries.sort((a, b) => b.score - a.score).slice(0, 10);
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
        api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service', apiKey: 'your-key' });

    // A stream is offered per peer. Keep the ids so you can close them later.
    const published = new Map();

    async function startStreaming() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local').srcObject = stream;
        webrtc.setLocalMediaStream(stream);

        agent.getActiveAgents((res) => {
            ((res && res.data) || []).forEach(async (peer) => {
                const name = peer.agentName || peer;
                if (name === 'broadcaster' || published.has(name)) return;
                published.set(name, await webrtc.createStreamOffer(name, { stream }));
            });
        });
    }
</script>
```

### Receive Video

```javascript
const webrtc = new WebRtcHelper(agent);

webrtc.on('remote-stream', (streamId, mediaStream, sourceAgent) => {
    document.getElementById('remoteVideo').srcObject = mediaStream;
});

webrtc.on('connection-state', (streamId, state) => {
    if (state === 'failed' || state === 'closed') {
        document.getElementById('remoteVideo').srcObject = null;
    }
});
```

### One-to-One Call

```javascript
const webrtc = new WebRtcHelper(agent);
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
document.getElementById('localVideo').srcObject = stream;
webrtc.setLocalMediaStream(stream);
// createStreamOffer(remoteAgent, constraints) — it returns the stream id.
const streamId = await webrtc.createStreamOffer('other-agent-name', { stream });
```

### Screen Sharing

```javascript
async function shareScreen(peerName) {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } });
    const streamId = await webrtc.createStreamOffer(peerName, { stream });
    // closeStream() stops the tracks it holds, so the browser's own
    // "stop sharing" bar and your UI end up doing the same thing.
    stream.getVideoTracks()[0].onended = () => webrtc.closeStream(streamId);
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
agent.sendMessage({ content: 'Hello team!', filter: 'team=blue,level>3' });
```

**Filter syntax:**
- `key=value` — exact match
- `key:value` — contains
- `key>value` / `key<value` — numeric comparison
- `key1=v1,key2=v2` — multiple conditions (AND)

### Temporary API Keys

Do not let a browser use your developer API key to ask for a temporary key.
That only moves the permanent credential into client-side code. Your own server
must authenticate the visitor, call the platform with its environment-held
developer key, and return only the short-lived result.

Your backend should use the developer API key directly for its own platform
calls. It does not need a temporary key for server-to-server work:

```javascript
// server-worker.mjs — backend-to-platform call; never sent to the frontend
const channels = await fetch(
    'https://hmdevonline.com/messaging-platform/api/v1/messaging-service/channels',
    { headers: { 'X-API-Key': process.env.MESSAGING_PLATFORM_API_KEY } }
).then(response => response.json());
```

Create a temporary key only after authorising a frontend user who needs their
own browser connection. The backend route below is the boundary between those
two cases:

```javascript
// server.mjs — frontend handoff route; runs on your server, never in a browser bundle
app.post('/api/messaging-access', requireSignedInUser, async (req, res) => {
    const response = await fetch(
        'https://hmdevonline.com/messaging-platform/api/v1/messaging-service/channels/api-access',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.MESSAGING_PLATFORM_API_KEY
            },
            body: JSON.stringify({ ttlSeconds: 30, singleUse: true })
        }
    );
    const body = await response.json();
    const access = body.data;
    if (!response.ok || !access?.temporaryKey) {
        return res.status(502).json({ error: 'Messaging access could not be created.' });
    }
    res.set('Cache-Control', 'no-store');
    res.json({ temporaryKey: access.temporaryKey, expiresAt: access.expiresAt });
});
```

```javascript
// client.js — receives an expiring credential only
const access = await fetch('/api/messaging-access', {
    method: 'POST', credentials: 'same-origin'
}).then(async response => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Access was not granted.');
    return body;
});

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'password',
    agentName: 'agent-1',
    api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service',
    apiKey: access.temporaryKey,
    autoReceive: true
});
```

Use a short TTL. For a one-time connection, use `singleUse: true`; for an
operation that legitimately needs repeat calls, use the smallest multi-use TTL
your flow can tolerate. The platform returns the granted `ttlSeconds` and
`expiresAt`; do not assume a requested TTL was granted unchanged.

```javascript
// Wrong: a permanent key in browser JavaScript can be extracted and reused.
agent.connect({ apiKey: 'your-permanent-key' });
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

// ✅ Ask your authenticated backend for a temporary key
const { temporaryKey } = await fetch('/api/messaging-access', {
    method: 'POST', credentials: 'same-origin'
}).then(r => r.json());

// ✅ Strong channel passwords
agent.connect({ channelPassword: 'Xy9$mK#pL2@nQ5!wR', ... });

// ✅ Validate input before sending
function send(text) {
    const clean = text.trim().replace(/<script>/gi, '');
    if (clean.length > 0 && clean.length < 1000) agent.sendMessage(clean);
}

// ✅ Disconnect on page unload
window.addEventListener('beforeunload', () => {
    if (agent?.readyState) agent.disconnect();
});

// ✅ HTTPS in production — WebSocket automatically uses WSS
const api = 'https://your-domain.com';
```

---

## Troubleshooting

### Can't Connect

```javascript
// A failed connect is reported through the 'connect' event, not a separate
// error event: response.status is 'error' and response.data says why.
agent.addEventListener('connect', (ev) => {
    const res = ev.response || {};
    if (res.status === 'error') console.error('Connect failed:', res.data);
});
// If connections fail, verify the api URL and key rather than the service:
// the platform is managed and its health is not something clients poll.
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
| `disconnect(config?)` | Disconnect |
| `sendMessage(content \| {content, to, filter}, callback?)` | Send a message. `to` and `filter` are mutually exclusive |
| `receive(range, autoReceive, options?)` | Pull messages by offset |
| `status(callback)` | Ask the server for channel status |
| `getActiveAgents(callback)` | Agents currently in the channel |
| `getSystemAgents(callback)` | System agents in the channel |
| `getSessionInfo()` | Local session details |
| `isHostAgent(agentName?)` | Whether that agent (default: you) is host |
| `readyState` | Property — `true` once the channel is usable |
| `storagePut(params, callback)` | Store/replace value |
| `storageAdd(params, callback)` | Append version |
| `storageGet(params, callback)` | Get latest version |
| `storageGetList(storageKey, callback)` | Get all versions — takes a **string**, not an object |
| `storageKeys(callback)` | List all keys |
| `storageValues(callback)` | Every value in the channel |
| `storageDeleteByKey(storageKey, callback)` | Delete key |

### WebRtcHelper Methods

| Method | Description |
|--------|-------------|
| `createStreamOffer(id, target, options)` | Offer media or a data channel to a peer |
| `setLocalMediaStream(stream)` | Set the stream offered to peers |
| `sendData(peerId, data)` | Send over that peer's data channel |
| `broadcastDataChannel(data)` | Send over every open data channel |
| `getActiveDataChannels()` | Peers with an open data channel |
| `closeDataChannel(peerId)` | Close one data channel |
| `closeStream(id)` / `closeAllStreams()` | Tear down media |
| `getStats(peerId)` | WebRTC statistics for a peer |
| `on(event, handler)` | Register event handler |

### WebRtcHelper Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `remote-stream` | `(streamId, stream, sourceAgent)` | Remote media arrived |
| `stream-ready` | `(streamId, stream)` | Local stream ready to offer |
| `datachannel-open` | `(peerId, channel, connectionTimeMs)` | Data channel usable |
| `datachannel-message` | `(peerId, data)` | Data arrived from a peer |
| `datachannel-close` | `(peerId)` | Data channel closed |
| `datachannel-error` | `(peerId, error)` | Data channel error |
| `connection-state` | `(peerId, state)` | Peer connection state changed |
| `offer` / `answer` / `ice-candidate` | signalling payload | Emitted while negotiating |

---

## Trying the demos

Everything below is running on the site already — open the
[playground](playground.html); nothing needs installing.

**Available demos:** chat, WebRTC video, whiteboard, leaderboard, storage, mini-games, developer console.
