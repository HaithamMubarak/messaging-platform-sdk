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
4. [Attest (Tamper-Evident Receipts)](#attest-tamper-evident-receipts)
5. [Till (Licences and Seats)](#till-licences-and-seats)
6. [Knock (Reaching a Closed Browser)](#knock-reaching-a-closed-browser)
7. [Vault (Encrypted Blobs)](#vault-encrypted-blobs)
8. [Key Escrow and Recovery](#key-escrow-and-recovery)
9. [WebRTC Video Streaming](#webrtc-video-streaming)
10. [Advanced Topics](#advanced-topics)
11. [Security Best Practices](#security-best-practices)
12. [Troubleshooting](#troubleshooting)
13. [API Reference](#api-reference)

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

## Attest (Tamper-Evident Receipts)

Sometimes you need to prove that something happened: a form was signed, a
handover was acknowledged, a file was delivered. Attest records that as a hash
chain the recipient can check — including long after they have stopped
believing you.

**Your content never leaves your machine.** You hash it; you send the hash. The
server adds only what a server can honestly witness — the order records were
written in, its own clock, and the authenticated agent — and signs that.

### Writing a chain

A chain is named by you: one per consent, per shift, per delivery.

```javascript
// Hash whatever you want to prove. Text, a Blob, an ArrayBuffer.
const contentHash = await agent.attestHash(JSON.stringify(signedForm));

agent.attest({
    chainKey: 'consent-9f2e',      // your name for this chain
    kind: 'consent-signed',        // your vocabulary
    contentHash,                   // computed here, not there
    meta: { formVersion: 7 }       // small, and PUBLIC-SAFE (see below)
}, (r) => {
    if (r.status === 'success') {
        console.log('record', r.data.record.seq, r.data.record.chain);
    }
});
```

The first `attest()` on a `chainKey` creates the chain. Every later one links to
the previous record, so a record cannot be removed or reordered without breaking
everything after it.

### Reading and verifying

```javascript
agent.attestList('consent-9f2e', async (r) => {
    const bundle = r.data;                            // records + genesis + keys
    const result = await AgentConnection.attestVerify(bundle);

    if (result.ok) console.log(`${result.length} records, all intact`);
    else console.log(`broken at record ${result.brokenAt}: ${result.reason}`);
});
```

`attestVerify` is deliberately a plain function over plain data. It does not call
the platform: it re-derives every hash and checks every signature against the
published key. Hand it a bundle you saved to a file last year and it still
answers — which is the entire point of a receipt.

For something to file or attach to an invoice, `attestExport` returns a
self-contained bundle including the chain rule and the public key:

```javascript
agent.attestExport('consent-9f2e', (r) => save(JSON.stringify(r.data.bundle)));
```

### The rules that keep it honest

**`meta` is public-safe, and small (4 KB).** It is hashed into the chain and
travels with any export, so it must be something you would hand to a stranger.
Anything sensitive belongs in the content you hashed, not here.

**The author is the session, not the payload.** Attest stamps the agent the
transport authenticated. A request that tries to name a different author is
ignored, not honoured.

**Chains are append-only.** There is no update and no delete — not by
convention, but because no such endpoint exists.

### What a receipt does and does not prove

It proves that a given hash was recorded, in this position in the chain, at the
time this platform's clock said, by this authenticated agent — and that nothing
has been altered since.

It does **not** prove the time is correct beyond trusting this platform's clock
(it is not an RFC 3161 timestamping authority), and it does not make a document
legally binding. Whether a receipt satisfies a regulator, a court, or an insurer
is their decision, not ours. Say what it is; do not oversell it.

### Verifying without the SDK

The format is deliberately boring so that anyone can check it:

```
genesis  = sha256(channelId + "|" + chainKey)
chain[i] = sha256(prev + "|" + contentHash + "|" + canonical(stamp))
signature: ECDSA P-256 / SHA-256 over the chain value, in IEEE P1363 raw
           r||s form (64 bytes), base64. Key from GET /attest/keys, SPKI base64.
           Note the format: WebCrypto uses raw r||s, while openssl's command
           line expects DER -- convert if you verify that way.
```

where `canonical` is JSON with object keys sorted recursively and no incidental
whitespace, and `stamp` is `{agent, serverTime}`. That is checkable with
WebCrypto in a browser, `openssl` on a terminal, or twenty lines in any
language.

---

## Till (Licences and Seats)

One licensing check, so no app builds "Stripe checkout in v1" for the fifth
time. Till answers three questions — is this key good for this app, is a seat
free, and until when — and nothing else. It never sees a card.

### Read this before you gate anything on it

**A licence check in a browser is a courtesy.** It shows an honest customer the
honest path and makes the paid door obvious. It stops nobody who opens
devtools, and it is not meant to. The check that *protects* something is the
one on whichever server call your app already had to make. Till makes the
honest check cheap enough that no app has an excuse to skip it — it does not
make a client trustworthy, and no amount of care on this page changes that.

### Checking a licence

```javascript
const Till = AgentConnection.Till.configure('/messaging-platform/api/v1/messaging-service');

const verdict = await Till.check({ app: 'signet', key: Till.recall('signet') });
if (!verdict.valid) {
    showPurchaseScreen(verdict.reason);   // never a blank "no"
}
```

`check()` resolves to `{ valid, plan, seats, seatsUsed, expiresAt, reason }` and
**never rejects** — a dropped packet resolves `{valid: false, reason:
'unavailable'}`, because an app that threw on a flaky network would lock out a
paying customer over one lost request. Treat `unavailable` as "ask again", not
as "unlicensed forever".

`reason` is one of `unknown_or_revoked`, `revoked`, `past_due`, `expired`,
`site_mismatch`, `no_seats_available`, `unavailable`.

### Seats

```javascript
const seat = await Till.claimSeat({ app: 'signet', key, seatRef: currentUser.email });
if (!seat.valid && seat.reason === 'no_seats_available') {
    showSeatFullScreen(seat.seats);
}
// when they sign out
await Till.releaseSeat({ app: 'signet', key, seatRef: currentUser.email });
```

`seatRef` is whatever your app calls a user. It is **hashed before the server
stores it** — Till counts distinct seats without keeping a list of who they
are. Re-claiming a seat you already hold always succeeds, even on a full
licence: otherwise closing a laptop could lock somebody out until a colleague
signed off.

`seats: 0` means unmetered — a site licence.

### Gating an app shell

```javascript
try {
    await AgentConnection.Till.require({ app: 'signet', key, seatRef: user.email });
    startApp();
} catch (e) {
    // e.verdict carries the reason, so the screen can say WHY
    showPurchaseScreen(e.verdict);
}
```

### The rules that keep it honest

- **A key is a bearer credential**, so it travels in a POST body and never in a
  URL. URLs end up in access logs, proxy logs, browser history and `Referer`
  headers. (The design sketch said `GET /till/entitlement?key=...`; this is a
  deliberate departure from it.)
- **The server stores only a hash of the key.** It is shown once when issued
  and cannot be read back — a copy of the licence table is not a set of working
  licences. Lost key, new licence.
- **An unknown key and a real key for a different product get the same
  answer.** The endpoint will not confirm a guess or tell a caller what else
  somebody owns.
- **Site binding is a guard rail, not a boundary.** `site` stops a key being
  pasted into another deployment by a helpful colleague. The origin is asserted
  by the caller, and a caller that is not a browser asserts whatever it likes.
- **Webhooks are verified over the raw body before anything parses it**,
  compared in constant time, refused outside a five-minute window, and recorded
  by event id so a replay is applied once. With no signing secret configured,
  every webhook is refused — the endpoint that can hand out a paid plan fails
  closed.
- **`/checkout` answers 501** until a provider is actually wired. An endpoint
  that silently upgraded an account would be worse than none, because it would
  look finished.

---

## Knock (Reaching a Closed Browser)

A knock is a **content-free ping**. No payload is sent — not an encrypted one,
none at all — so the push service learns that something happened in some
subscription and never what, or from whom. When the person opens the page, the
page fetches the real thing over the authenticated channel.

### The sentence you are allowed to write

**"A knock was sent."** Never "they were notified". Push is best effort:
permission gets declined, iOS delivers only to an installed PWA, push services
throttle, and a sleeping laptop gets it when it wakes. Nothing in this API
knows whether a human saw anything. Attest can receipt that a knock was sent;
nothing can receipt that somebody read it.

### Subscribing

```javascript
// From a CLICK. A permission prompt on page load is refused outright by some
// browsers and resented by every user.
const res = await channel.knockSubscribe({ swPath: '/knock-sw.js' });
if (!res.ok) {
    // 'unsupported' | 'denied' | 'no_key' | 'ephemeral_key' | 'subscribe_failed'
    explain(res.reason);
}
```

Each failure is a different problem, so they are different reasons.
`ephemeral_key` means the platform has no configured VAPID key: a subscription
taken against it dies at the next restart, so the SDK refuses rather than
spending somebody's permission on it (pass `allowEphemeralKey: true` in a demo
where the churn does not matter).

**The service worker's scope is its own directory.** `/js/knock-sw.js` can only
control `/js/*`, which is the single most common reason push "silently does
nothing". Serve it from the root of whatever scope needs it — the SDK site
serves one at `/knock-sw.js`.

### Knocking

```javascript
channel.knock('Dana', { tag: 'shift-handover' }, (res) => {
    // res.data.sent / rateCapped / failed, one result per device,
    // and res.data.meaning — the sentence to show the user
    show(res.data.meaning);
});
```

`tag` becomes a push Topic, so three knocks about the same thing collapse into
one waiting notification rather than three buzzes.

### Who can be reached

```javascript
channel.knockReachable(res => {
    // [{agent: 'Dana', devices: 2}, ...] — names and counts, never endpoints
});
```

An endpoint is the capability to ping somebody's device. It is never handed
back to anyone, including other members of the channel.

### The rules that keep it honest

- **Membership is the authorisation.** The session says which channel you are
  in, and every lookup is scoped to it. You cannot subscribe for somebody else,
  knock outside your channel, or read anybody's endpoint.
- **Knocks are rate-capped per device.** Not to be polite to the push service —
  something that can ping a phone in a loop is a weapon.
- **The server will not fetch whatever URL it is handed.** A push endpoint is
  client-supplied and server-fetched, which is the exact shape of an SSRF
  gadget; endpoints are checked against an allowlist of push hosts at subscribe
  time.
- **A dead subscription is deleted, not retried forever.** A 404 or 410 from a
  push service means gone.

---

## Vault (Encrypted Blobs)

Chunked, resumable storage for things past Dead Drop's 512 KB line.

### Say the right sentence

Dead Drop's promise is **"never on a server"**. Vault's promise is **"never
*readable* by the server"**. The ciphertext is stored, on disk, in this
platform's database. The key is generated in the browser and never sent, so the
server cannot read a byte of it and has nothing to hand over if asked — but the
bytes exist. That is a weaker claim than the one made everywhere else here, and
a product adopts Vault knowingly and repeats the second sentence, or it uses
Dead Drop instead.

### Storing something

```javascript
const { blobId, key } = await channel.vaultPut(file, {
    ttlSeconds: 3600,
    onProgress: p => bar.style.width = (p.sent / p.total * 100) + '%'
});
// Share blobId AND key with whoever should be able to read it.
// Lose the key and the bytes are gone — that is the point, not a gap.
```

A key is generated **per blob**, not per channel: a key that opens everything
is a key whose loss opens everything. Each chunk carries its own 12-byte IV,
because reusing a nonce across chunks under one AES-GCM key leaks the XOR of
the plaintexts.

### Reading it back

```javascript
const bytes = await channel.vaultGet(blobId, key, {
    onProgress: p => status.textContent = `${p.received}/${p.total}`
});
```

Chunks are fetched in order and decrypted as they arrive, so peak memory is one
chunk plus the output rather than two copies of the whole file — the ceiling
Drop Pro hit at 1.5 GB.

### Resume

`vaultPut` asks the server what already arrived and sends only what is missing,
so an interrupted upload continues instead of starting over. Re-sending the
chunk that was in flight when the connection died is accepted, not rejected —
otherwise resume would be the thing that breaks resume.

### The rules that keep it honest

- **The server verifies the ciphertext hash before sealing a blob.** It is the
  one hash a server can honestly check, because it has the ciphertext. A blob
  whose bytes do not add up is refused, never quietly stored — otherwise a
  truncated upload could be downloaded as though it were whole.
- **Everything expires.** A blob store with no TTL is a landfill with a quota
  attached. TTLs are capped by the deployment and swept on a timer.
- **Quota is checked up front**, against the declared size, not as chunks
  arrive — so a 100 MB upload fails in the first second rather than the last.
- **Blob ids are random and access is scoped to the channel.** An unguessable
  id is not an access control decision; the channel check is.

| Limit | Default | Property |
|-------|---------|----------|
| Per blob | 100 MB | `vault.max-blob-bytes` |
| Per chunk | 1 MB | `vault.max-chunk-bytes` |
| Per channel | 500 MB | `vault.channel-quota-bytes` |
| TTL default / max | 7 / 30 days | `vault.default-ttl-seconds`, `vault.max-ttl-seconds` |

---

## Key Escrow and Recovery

Encrypted storage where a fumbled key loses the records is a liability, not a
feature. This is the way back in, and it is deliberately not a convenient one.

### Two halves, and the server holds neither

```javascript
const { escrowId, ownerShare } = await channel.escrowSeal({
    secret: channelPassword,
    recoveryPhrase: 'seventeen rusty lanterns above the harbour',
    label: 'clinic channel password'
});
// Show ownerShare ONCE. Let it be printed or copied. Do not offer to remember
// it — a share kept next to the phrase is not a second factor.
```

Opening it needs **both** the recovery phrase and the owner share. Neither half
alone reveals anything, and this platform stores neither: the sealed record is
ciphertext, and the share exists only wherever its owner put it.

### The ceremony

```javascript
const { secret } = await channel.escrowRecover({ escrowId, recoveryPhrase, ownerShare });
```

Every seal, every successful recovery **and every failed attempt** is written to
an Attest chain (`keyring-escrow`) before the call returns. That is the actual
product: not that recovery is possible, but that it **cannot happen quietly**.
Whoever performs a recovery leaves a receipt they cannot remove.

```javascript
channel.escrowHistory(res => {
    // an Attest bundle — verify it offline with AgentConnection.attestVerify
});
```

### What this does not do

- **If both halves are lost, the data is gone.** No third path, no support
  ticket, nobody here can help. That is the property being bought.
- A failed attempt never says *which* half was wrong. Telling somebody "the
  phrase was right" would turn one half into a test oracle for the other.
- A receipt proves an authenticated agent performed a recovery at a time. It
  does not prove who was physically holding the phrase.
- The escrow record is stored **unencrypted** (it is already ciphertext) so
  that recovering a lost channel key does not require that same key. Its whole
  security is the two halves.

The recovery phrase runs through 300,000 PBKDF2 iterations — three times what a
channel password uses. A channel password is typed daily and is one factor among
several; a recovery phrase is written on paper, used once in years, and is half
of everything.

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

### Receiving to disk instead of memory

Assembling a transfer in an array is what puts a ceiling on it — Drop Pro's is
about 1.5 GB. `diskSink` writes arriving chunks to OPFS, a real file private to
this origin:

```javascript
const sink = await AgentConnection.diskSink({ name: 'movie.mp4' });
if (!sink) fallBackToMemory();          // null where OPFS is unavailable

if (sink.written > 0) askPeerToResumeFrom(sink.written);

await sink.writeAt(offset, chunk);      // out-of-order chunks are fine
const file = await sink.finish();       // a File — the bytes never come back into memory
```

Two properties follow: the size is bounded by the disk rather than the tab, and
an interrupted transfer **resumes after the page is closed and reopened**,
because what arrived is still on disk.

`resume: false` truncates. Getting that backwards appends to stale bytes, and
that looks like corruption a long way from its cause.

**What OPFS is not**: shared, backed up, or permanent. A browser may evict
origin-private storage under pressure, and clearing site data takes it. It is a
place to land a transfer, not to keep one.

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

See `agents/examples/web-sdk-server/src/main/resources/static/apps/drop/drop.js`
for a complete working implementation — QuickShare was retired to a redirect and
Drop is the maintained version, with the offer/accept step, 16 KB chunking, gap
refill and resume after a reconnect.

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
| `attestHash(content)` | Promise of the SHA-256 hex Attest expects |
| `attest(params, callback)` | Append a record to a chain (created on first use) |
| `attestList(chainKey, callback)` | Read a chain back with its genesis and keys |
| `attestExport(chainKey, callback)` | Self-contained bundle to file or send on |
| `attestChains(callback)` | Every chain name in this channel |
| `AgentConnection.attestVerify(bundle)` | Static — re-derive and check a chain offline |
| `AgentConnection.Till.configure(api)` | Static — set the API base once |
| `AgentConnection.Till.check({app, key})` | Static — licence verdict; never rejects |
| `AgentConnection.Till.claimSeat({app, key, seatRef})` | Static — take or refresh a seat |
| `AgentConnection.Till.releaseSeat({app, key, seatRef})` | Static — give a seat back |
| `AgentConnection.Till.require({app, key, seatRef?})` | Static — as above, but rejects when the answer is no |
| `AgentConnection.Till.remember/recall/forget(app, key?)` | Static — the holder's own copy of their key, in their browser |
| `knockSubscribe(options?)` | Promise — ask this browser to accept knocks (call from a click) |
| `knockUnsubscribe()` | Promise — stop knocks to this browser |
| `knock(agentName, options?, callback)` | Knock on one member; per-device outcomes |
| `knockReachable(callback)` | Who can be reached here — names and device counts only |
| `vaultPut(blobOrBuffer, options?)` | Promise — encrypt, chunk, upload resumably; returns `{blobId, key}` |
| `vaultGet(blobId, key, options?)` | Promise — download and decrypt, chunk by chunk |
| `vaultNewKey()` | Promise — a fresh AES-256-GCM key, base64 |
| `vaultList(callback)` | Blobs in this channel — sizes and hashes, never keys |
| `vaultStatus(blobId, callback)` | What arrived, what is missing |
| `vaultQuota(callback)` | This deployment's limits and the channel's usage |
| `vaultDelete(blobId, callback)` | Delete one |
| `escrowSeal(options)` | Promise — seal a secret; returns `{escrowId, ownerShare}` once |
| `escrowRecover(options)` | Promise — open it with phrase + owner share; attested either way |
| `escrowList(callback)` | Escrows in this channel — labels and dates, never a half |
| `escrowHistory(callback)` | The ceremony's Attest chain: seals, recoveries, failed attempts |
| `AgentConnection.diskSink(options)` | Static, Promise — a disk-backed (OPFS) sink for an incoming transfer; null where unsupported |
| `AgentConnection.diskSinkList()` | Static, Promise — part-finished transfers this origin holds |

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
