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

In a browser, load two script tags — no build step. `AgentConnection` is then a
global:

```html
<script src="https://hmdevonline.com/messaging-platform/sdk/generated-web-agent-js/js/web-agent.libs.js"></script>
<script src="https://hmdevonline.com/messaging-platform/sdk/generated-web-agent-js/js/web-agent.js"></script>

<!-- Optional: peer-to-peer data channels, audio and video -->
<script src="https://hmdevonline.com/messaging-platform/sdk/generated-web-agent-js/js/web-agent.webrtc.js"></script>
```

In Node 18+, `require()` this directory from an SDK checkout
(`const { AgentConnection } = require('./agents/web-agent-js')`). The package is
named `@messaging-platform/web-agent-js` but is **not published to npm yet**.

### 2. Join a channel and send something

A channel is identified by a name and a password. Everyone who connects with the
same pair is in the same room, and the password also encrypts the payloads.

```js
const agent = new AgentConnection();

agent.addEventListener('connect', (e) => {
    if (e.response.status !== 'success') return console.error(e.response);
    agent.sendMessage({ content: 'hello, everyone' });          // to the whole channel
});

agent.addEventListener('message', (e) => {
    e.response.data
        .filter((m) => m.type === 'chat-text')
        .forEach((m) => console.log(m.from, 'says', m.content));
});

agent.addEventListener('agent-connect', (e) => console.log('joined:', e.agentName));
agent.addEventListener('agent-disconnect', (e) => console.log('left:', e.agentName));

agent.connect({
    api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service',
    apiKey: temporaryKey,           // minted by YOUR server; never ship the developer key
    channelName: 'my-room',
    channelPassword: 'a-shared-secret',
    agentName: generateRandomAgentName(),
    autoReceive: true,              // without it, an HTTP-polling connection receives nothing
});
```

To reach one participant rather than the whole channel, name them:

```js
agent.sendMessage({ content: { deal: 'your card' }, to: 'Priya' });
```

The same program in Python, Java and C++, verified against the live platform,
is in [`../examples/quickstart`](../examples/quickstart/README.md).

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

The calls below are the ones `js/web-agent.js` actually defines. The full
reference is `WEB-AGENT-GUIDE.md` at the repository root.

### Connection and messages

```javascript
const agent = new AgentConnection({ useWebsocket: true });   // WebSocket, falls back to HTTP polling
agent.connect({ api, apiKey, channelName, channelPassword, agentName, autoReceive: true });
agent.sendMessage({ content, to /* optional agent name */, type /* default 'chat-text' */ });
agent.addEventListener('message', e => e.response.data /* array of events */);
agent.disconnect();
```

Events: `connect`, `disconnect`, `message`, `agent-connect`, `agent-disconnect`,
`connection-lost`, `reconnecting`, `session-not-found`, `socket-open`.

### TypeScript

`index.d.ts` declares everything on this page, `WebRtcHelper` included (as the
global that `web-agent.webrtc.js` defines). It uses DOM types (`Blob`,
`MediaStream`, `RTCDataChannel`), so keep `dom` in your `lib`. Callbacks of the
attest, vault and knock calls receive the platform envelope, typed
`PlatformResponse<T>`: check `status === 'success'` before reading `data`.
`test/types-check.ts` uses every declaration; `npm run test:types` compiles it.

### Session helpers

```javascript
const { channelId, sessionId } = agent.getSessionInfo();
agent.refreshIceServers(servers => { /* fresh TURN credentials, or null */ });
agent.getSystemAgents(res => { if (res.status === 'success') console.log(res.data); });
```

The connection refreshes its ICE servers by itself five minutes before the TURN
credential expires; call `refreshIceServers` before an ICE restart you start
yourself.

### Presence

```javascript
agent.getActiveAgents(agents => { /* who is connected now */ });
agent.isHostAgent(name);  agent.getHostAgentName();
```

An agent that leaves with `disconnect()` is announced at once (`agent-disconnect`).
One that vanishes without a goodbye (a closed lid, a cut network, a killed tab)
is announced by the server once its socket has been silent for about 12 s, or
about 10 s after its socket closed without one; every page then re-elects the
same way. A page that comes back after that finds its session gone and gets
`session-not-found`, so it can join again. To test how your app copes with a
vanished host, `agent.dropWithoutGoodbye()` goes silent the way a crash would.

### Shared state (channel storage)

```javascript
agent.storagePut({ storageKey: 'board', content: board }, done);
agent.storageGet({ storageKey: 'board' }, result => { /* ... */ });
agent.storageKeys(keys => { /* ... */ });
agent.storageDeleteByKey('board', done);
```

The promise forms decode the value for you and reject on any failure:

```javascript
const board = await agent.storageRead('board');          // null when nothing is stored
const log = await agent.storageReadEntries('moves');     // newest first, each with its writer
log.forEach(e => console.log(e.writtenBy, e.value));
```

`writtenBy` is stamped by the server from the writing session, so unlike a name
inside the value it cannot be made up by the writer.

### Attest (tamper-evident receipts)

Your content never leaves your machine: you hash it and send the hash. The
server adds only what a server can honestly witness (the order, its own clock,
the authenticated agent) and signs that.

```javascript
const contentHash = await agent.attestHash(JSON.stringify(signedForm));
agent.attest({ chainKey: 'consent-9f2e', kind: 'consent-signed', contentHash,
               meta: { formVersion: 7 } },              // small and PUBLIC-SAFE
    r => { if (r.status === 'success') console.log('record', r.data.record.seq); });

agent.attestList('consent-9f2e', async (r) => {
    if (r.status !== 'success') return;
    const result = await AgentConnection.attestVerify(r.data);   // offline, plain data
    console.log(result.ok ? `${result.length} records, all intact`
                          : `broken at record ${result.brokenAt}: ${result.reason}`);
});
```

`attestExport(chainKey, cb)` answers `r.data.bundle`, a self-contained file that
`attestVerify` still checks years later; `attestChains(cb)` lists the chain names.
`attestHash` takes text, an `ArrayBuffer` or a typed array.

### Vault (encrypted blobs)

Vault's promise is **"never *readable* by the server"**: the ciphertext is
stored, the key is generated in the browser and never sent.

```javascript
const { blobId, key } = await agent.vaultPut(file, {
    ttlSeconds: 3600,
    onProgress: p => bar.style.width = (p.sent / p.total * 100) + '%'
});
// Share blobId AND key. Lose the key and the bytes are gone.
const bytes = await agent.vaultGet(blobId, key);         // a Uint8Array
```

An interrupted `vaultPut` sends only the chunks the server is missing.
`vaultStatus`, `vaultList`, `vaultQuota` and `vaultDelete` take a callback and
answer the envelope; `vaultNewKey()` makes a key in advance.

### Key escrow and recovery

```javascript
const { escrowId, ownerShare } = await agent.escrowSeal({
    secret: channelPassword,
    recoveryPhrase: 'seventeen rusty lanterns above the harbour',  // 12+ characters
    label: 'clinic channel password'
});
// Show ownerShare ONCE. Do not offer to remember it.

const { secret } = await agent.escrowRecover({ escrowId, recoveryPhrase, ownerShare });
```

Opening needs both halves, and the platform stores neither. Every seal, every
recovery and every failed attempt is written to the `keyring-escrow` Attest
chain, which `escrowHistory(cb)` returns; `escrowList(cb)` gives labels and
dates, never a half. A wrong pair rejects without saying which half was wrong.

### Knock (reaching a closed browser)

A knock is a **content-free ping**: no payload at all. The sentence an app may
write is "a knock was sent", never "they were notified".

```javascript
// From a CLICK, not on page load.
const res = await agent.knockSubscribe({ swPath: '/knock-sw.js' });
if (!res.ok) explain(res.reason);   // 'unsupported' | 'denied' | 'no_key' | 'ephemeral_key' | ...

agent.knock('Dana', { tag: 'shift-handover' }, (r) => {
    if (r.status === 'success') show(r.data.meaning);   // per-device results in r.data.results
});
agent.knockReachable(r => { /* r.data.reachable: [{agent, devices}], never endpoints */ });
```

The service worker controls only its own directory, so serve it from the root
of the scope that needs it. `knockUnsubscribe()` stops knocks to this browser.

### Till (licences and seats)

A licence check in a browser is a courtesy, not protection: the check that
protects something is on your own server.

```javascript
const Till = AgentConnection.Till.configure('/messaging-platform/api/v1/messaging-service');
const verdict = await Till.check({ app: 'signet', key: Till.recall('signet') });
if (!verdict.valid) showPurchaseScreen(verdict.reason);   // never rejects
```

`claimSeat` / `releaseSeat` take a `seatRef` (hashed before it is stored), and
`require` is `check` that rejects with `e.verdict` when the answer is no.

### WebRTC (load `web-agent.webrtc.js`)

```javascript
const rtc = new WebRtcHelper(agent);
rtc.on('datachannel-message', (peerId, data) => { /* ... */ });
rtc.broadcastDataChannel({ type: 'update', data });
rtc.sendData(peerId, data);
rtc.createStreamOffer(remoteAgent, { audio: true, video: true });
```

**Camera to screen share without renegotiating.** Swap what an existing
connection sends; it resolves `false` when the connection was never set up to
send that kind (say, an audio-only call turning video on), and then you close
and offer as before:

```javascript
const sid = await rtc.createStreamOffer(peer, { stream: camera });
if (!(await rtc.replaceStream(sid, screen))) {
    rtc.closeStream(sid);                       // tells the peer ('bye')
    await rtc.createStreamOffer(peer, { stream: screen });
}
```

A stream you pass in stays yours: closing a connection never stops its tracks.

**Files over a data channel.** `sendFile` needs a reliable, ordered channel,
and the helper's default one is neither (it is tuned for game state), so ask
for one when offering:

```javascript
await rtc.createStreamOffer(peer, { dataChannel: { name: 'files', options: { ordered: true } } });
rtc.on('datachannel-open', async (peerId) => {
    const meta = await rtc.sendFile(peerId, file);   // resolves once the receiver checked its SHA-256
});
rtc.on('file', (peerId, f) => saveAs(f.blob, f.name));
```

**Reconnecting is automatic.** A connection that drops (Wi-Fi to mobile, a
blip, the peer's tab reloading) is brought back by the side that offered it,
under the same stream id: first an ICE restart, then a new connection, up to
`rtc.reconnect.maxAttempts`. While the device is offline nothing is spent;
coming back online reconnects at once. `rtc.restartStream(sid)` does it on
demand.

```javascript
rtc.on('stream-reconnecting', (sid, peer, attempt) => showBadge(peer, 'reconnecting'));
rtc.on('stream-recovered', (sid, peer) => showBadge(peer, null));
rtc.on('stream-failed', (sid, peer) => showBadge(peer, 'lost'));      // gave up
rtc.on('stream-closed', (sid, peer, reason) => dropTile(sid));         // local | remote | failed
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

