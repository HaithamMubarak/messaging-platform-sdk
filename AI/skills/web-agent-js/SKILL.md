---
name: web-agent-js
description: JavaScript browser agent — AgentConnection API, callbacks, channel storage, WebRTC signaling, and encryption surface. Covers the full JS-specific API in agents/web-agent-js/js/web-agent.js.
when_to_use: Use when building browser-side integrations, handling JS callbacks (onconnect/ondisconnect/onMessage), using channel storage from the browser, or wiring up WebRTC signaling in JS.
---

# Web Agent (JavaScript)

Source: `agents/web-agent-js/js/web-agent.js`
Include: `web-agent.js` + `web-agent.libs.js` (bundled dependencies: CryptoJS, AesCtr, etc.)
For WebRTC: also include `web-agent.webrtc.js`

---

## Construction

```js
const agent = new AgentConnection({ usePubKey: false });
```

`usePubKey` — keep `false`; RSA public-key encryption is reserved for future use. HTTPS is sufficient.

## Browser credential boundary

The browser must never hold the developer API key. Its authenticated backend
keeps that key in an environment variable and calls the platform directly to
mint a short-lived key only when the browser needs its own connection:

```js
// Backend endpoint, after authorizing the signed-in user.
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
const { data } = await response.json();
res.set('Cache-Control', 'no-store');
res.json({ temporaryKey: data.temporaryKey, expiresAt: data.expiresAt });
```

The browser fetches that app endpoint and supplies `temporaryKey` as `apiKey`
when constructing `AgentConnection`. Do not let browser code call
`/channels/api-access` itself. A backend calling the platform for its own work
uses the developer key directly and does not mint a temporary key.

---

## Connect

```js
agent.connect({
  channelName: 'my-channel',
  channelPassword: 'secret',
  agentName: 'alice',
  apiKeyScope: 'public',        // 'public' for browser, 'private' for server-side
  enableWebrtcRelay: false,     // true to enable WebRTC P2P relay
  pollSource: 'AUTO',           // 'AUTO' | 'CACHE' | 'DATABASE'  ('KAFKA' deprecated)
  channelId: '',                // optional: connect by channel ID instead of name
  sessionId: '',                // optional: reconnect with existing session
});
```

`channelPassword` must not contain `* , / \` or spaces — enforced by regex before the request is sent.

---

## Callbacks

Set these before calling `connect()`:

```js
agent.onconnect = function(response) { /* fired when connected */ };
agent.ondisconnect = function(response) { /* fired on disconnect */ };
agent.onMessage = function(message) {
  // message: { from, type, content, date, globalOffset, localOffset, ... }
};
agent.onerror = function(error) { /* transport or protocol error */ };
agent.onreset = function() { /* channel reset, re-connect needed */ };
```

---

## Send

```js
// Broadcast to all agents
agent.sendMessage({ type: 'chat', content: 'hello' }, callback);

// Targeted send (to specific agent)
agent.sendMessage({ type: 'chat', content: 'hey', destination: 'bob' }, callback);

// Low-level send (full EventMessage shape)
agent.send({ type: 'custom-type', content: '...', destination: '*' }, callback);
```

`destination: '*'` = broadcast. Omit or pass `undefined` for the default (broadcast).

---

## Receive (polling fallback)

When WebSocket is active, messages arrive via `onMessage`. For manual polling:

```js
agent.receive(receiveConfig, autoReceive, options);
// receiveConfig: { globalOffset, localOffset, limit }
// autoReceive: true = keep polling in a loop
```

`_last_receive_range` is updated automatically after each receive.

---

## Disconnect

```js
agent.disconnect();
// or with callback:
agent.disconnect({ callback: fn });
```

---

## Channel storage (key-value per channel)

```js
// Write
agent.storagePut({ key: 'board_state', content: data, contentType: 'application/json' }, cb);
agent.storageAdd({ key: 'moves', content: move }, cb);   // append to list

// Read
agent.storageGet({ key: 'board_state' }, cb);
agent.storageGetList('moves', cb);
agent.storageKeys(cb);          // list all keys
agent.storageValues(cb);        // all values

// Delete
agent.storageDeleteByKey('moves', cb);
```

---

## Agent presence

```js
agent.getActiveAgents(function(agents) {
  // agents: array of AgentInfo { agentName, connectionTime, metadata, ... }
});
agent.isHostAgent(peerAgentName);  // bool: is this agent the earliest-connected?
```

---

## WebRTC signaling

```js
// Send signaling message to a peer
agent.sendWebRtcSignaling(signalingMsg, remoteAgent, filter);

// WebRTC signaling is received via the onMessage callback
// type === 'webrtc-signaling' messages are WebRTC control frames
```

WebSocket is the transport for signaling; COTURN handles media relay.

---

## Encryption (channel-level, AES-CTR)

```js
// Channel secret is derived from channelName + password at connect time
// Encrypt/decrypt within onMessage:
const encrypted = MySecurity.encrypt(plaintext, agent.channelSecret);
const plain = MySecurity.decrypt(ciphertext, agent.channelSecret);

// Sign + encrypt
const signed = MySecurity.encryptAndSign(message, agent.channelSecret);
// Verify + decrypt
const verified = MySecurity.decryptAndVerify(signedMsg, agent.channelSecret);
```

---

## FileSystem helper (channel-scoped)

```js
const fs = new FileSystem(agent);
fs.list('/', cb);
fs.put(file, 'filename.txt', cb);
fs.download('filename.txt');
fs.getDownloadLink('filename.txt');
fs.mkdir('/folder', cb);
fs.delete('filename.txt', cb);
```

---

## Transport model

1. **WebSocket (primary)** — established at connect; messages pushed via `onMessage` handler. Auto-reconnects with exponential backoff (max 5 attempts, capped at 30s).
2. **HTTP long-poll (fallback)** — `receive()` is called when WebSocket is unavailable. Timeout ~40s per poll.
3. **UDP** — not available in the browser JS agent (UDP is server-side / Java/C++ only).

---

## Notes for assistants

- Always set `usePubKey: false` — the RSA hook exists but is not active.
- Do not put a developer key in browser JS. Use a backend-issued temporary key;
  `apiKeyScope` selects the channel namespace and is independent of this
  credential boundary.
- The `channelSecret` is derived client-side from `channelName + password` via PBKDF2 — it is never sent to the server.
- `agent.connectedAgents` (array) and `agent._connectedAgentsMap` (map by name) are kept in sync automatically on `agent-connect`/`agent-disconnect` events.
- Storage operations require an active session (`readyState === true`).
