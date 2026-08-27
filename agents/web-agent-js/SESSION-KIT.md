# Session Kit

**Status: design, not shipped.** This document names the API before the code
exists, because the point of the exercise is to find the common core in the five
hand-built versions that already work — not to invent a sixth. Every claim below
about what apps do today is from reading their source; the file and line are
named so it can be checked rather than believed. Nothing in
`@messaging-platform/web-agent-js` implements this yet.

---

## Why

The SDK's public vocabulary is transport and storage: `sendData`, `receive`,
`storagePut`, a host election, a WebRTC handshake. Everything between those
primitives and a working session has now been written five times:

| Built by hand in | What it solved | Where |
|---|---|---|
| BlockParty | snapshot, save, restore, chunked catch-up for late joiners | `blockparty.js:3660–3900` |
| Whiteboard | version history over an append-only key | `whiteboard-client.js:2980–3120` |
| PartyKit | host authority and addressed messaging across four games | `party-kit.js:50–100` |
| Drop | resume of in-flight work after a reconnect | `drop.js:63–76` |
| Chess | catch-up for a joiner, from a peer rather than storage | `chess-game.js:887` |

They are five answers to two questions: *how does a session survive its host*,
and *how does a message stay private when the transport wants to broadcast it*.

One correction to the plan's framing, which listed these as five solutions to
host resume: **Chess is not one.** It has no storage call anywhere — a joiner's
board is re-sent by the other player as `game-sync`. Its own page promises "a
board another player restores for you after a refresh", which is honest, and it
means the last player to leave takes the game with them.

That distinction is load-bearing for this design rather than pedantry. There are
two restore *sources* — a live peer, and durable storage — and they fail in
opposite conditions. Peer catch-up dies when the room empties; storage restore
dies when nothing has been written yet. The kit needs both, and Chess is the
evidence for the peer path.

Neither is an application problem. Both have already been got wrong in shipped
code — the host-forgery hole existed in two games at once and had to be fixed in
both — which is the argument for the kit better than any line count.

---

## What the diff found

The plan for this item specified "periodic snapshots to `storageAdd` — an
append-only log is already what that API is." Checking that against the code
turned up two things worth having found before writing the kit rather than after.

### 1. `storageGet` used to die on the second version — now fixed

`ChannelStorageRepository.findLatestByChannelIdAndStorageKey` was JPQL with
`ORDER BY cs.updatedAt DESC` returning `Optional`. `ORDER BY` does not limit, so
a key with two versions threw `NonUniqueResultException`, and the controller's
generic handler returned a 500. Reproduced against the live stack:

```
after 1 add,  storageGet -> success
after 2 adds, storageGet -> error
```

A kit that snapshots with `storageAdd` and restores with `storageGet` would have
broken on its *second* snapshot — precisely the failure it exists to prevent.

This is also why Whiteboard splits a board across two keys, `storagePut` for the
live state and `storageAdd` for history (`whiteboard-client.js:2983`, which
describes it as a property of the API). It was a workaround for this bug.

Fixed at the source with a derived query that limits, plus an `id` tiebreak —
two versions written in the same millisecond share an `updatedAt`, and without
the tiebreak "the latest" is whichever row the database happened to return.
Verified after deploy: three adds, `storageGet` returns `{"n":3}`, and
`storageGetList` still returns all three rows.

**Consequence for this design:** one key is enough. The kit does not need
Whiteboard's two-key layout, and Whiteboard can retire it.

### 2. Read-back shape differs by call, and every app has to know

`storageGet` with `encrypted:false` returns the content decoded. Rows from
`storageGetList` carry **base64 of the JSON**, nested at
`res.data.data.versions[]`. With `encrypted:true` the SDK decrypts *and* parses,
so the value arrives as an object.

Three different shapes for one logical read. Pulse got it wrong and its version
history rendered permanently empty — the app looked fine and the panel was just
blank. The kit owns this decode so no app has to know it exists.

---

## The API

### Setting up

```js
import { SessionKit } from '@messaging-platform/web-agent-js';

const session = new SessionKit(connection, {
  key: 'game-state',     // one storage key; versions are the history
  version: 4,            // schema version, stamped on every snapshot
  snapshotEvery: 15000,  // host-side autosave, ms; 0 disables

  snapshot: () => ({ blocks: world.encode(), turn }),
  restore: (state) => { world.decode(state.blocks); turn = state.turn; },

  // Optional. Without it a snapshot whose `v` differs is refused rather than
  // fed to `restore` — an old snapshot reaching new restore code is how a
  // corrupt board survives a deploy.
  migrate: (state, fromVersion) => state,
});
```

`snapshot()` must be **pure and synchronous**: it is called on a timer, during
handoff, and when a latecomer arrives.

### Messaging — the footgun leaves app code

```js
session.toHost(msg);          // client -> host. Addressed. Never broadcast.
session.toRoom(msg);          // host -> everyone.
session.toPeer(name, msg);    // host -> one player. Addressed.

session.onFromHost = (msg) => {};        // only ever fires for the real host
session.onFromPeer = (from, msg) => {};  // host only; `from` is the transport's
```

`from` is the transport's `peerId`. The kit **never** reads identity from the
payload.

This is the whole of the host-forgery fix, promoted. `UserConnectionBase` strips
`_fromHost` when it *relays* a broadcast but not on an *addressed* send, so any
peer could address a message to you with `_fromHost: true` and be believed. Two
games trusted that flag and both were exploitable. Under this kit an app cannot
express the bug: there is no flag to check.

When the sender is the host, `toHost` and `toPeer` deliver locally rather than
going over the wire. Convenient, and a trap for tests — a test whose sender is
the host exercises none of the transport. The chaos fixtures in item 05 must use
a non-host sender.

### Surviving the host

```js
session.onBecomeHost = async () => {};  // after state is restored, not before
session.onResume = () => {};            // after a reconnect; pick up in-flight work
session.onHostLost = () => {};
```

On promotion the kit restores from the latest snapshot **before** `onBecomeHost`
runs and before any player action is accepted. A new host that starts refereeing
from empty state is how a session survives the disconnection and loses the game.

`onResume` is Drop's case: the connection came back and there is half-finished
work to ask about again (`drop.js:63`). Distinct from `onBecomeHost` — the same
tab may get one, both, or neither.

### Latecomers

A client joining mid-session gets the current snapshot from the host
automatically, chunked when large. BlockParty sends 400 cells per message and
paces past a threshold (`blockparty.js:44`); the kit takes the same approach
with the size and pacing as options.

```js
catchUpChunk: 400,     // items per message
catchUpPaceAfter: 8,   // chunks before pacing kicks in
```

### Failure is visible

`onSaveError` fires when a snapshot cannot be written. If unset, the kit warns
on the console **and once in the UI**.

BlockParty's comment earns this: *"Silence would let a room build for an hour on
top of a world that is not being saved."* A save path that fails quietly is
worse than one that throws, because the loss is discovered only when it is
already unrecoverable.

---

## Rules the kit enforces so apps cannot get them wrong

These are all bugs that have actually shipped in this repo.

1. **Identity comes from the transport, never the payload.** No `_fromHost`.
2. **`applyState` must not clobber host-authoritative state.** The host adopts
   its own broadcast so there is one render path, which means shared state and
   host-owned state cannot share names. Chorus and Autocue both scored correctly
   and rendered an empty board until `hostParts` / `hostHoles` / `hostDelivered`
   were separated out. The kit keeps host state in its own namespace so the
   collision is not expressible.
3. **The host never replays its own broadcast into itself.** Open Outcry
   double-counted every tape print this way.
4. **Restore never overwrites live state**, and re-checks its precondition
   *after* the await. BlockParty tests `isMatchActive()` both before and after
   the storage round trip (`blockparty.js:3707`, `:3714`) because a match can
   start while the read is in flight.
5. **Every snapshot carries its schema version**, and a mismatch is refused
   rather than guessed at.

---

## What this is not

Not a game framework, not a CRDT, and not conflict resolution. The host is the
referee; when the host goes, the newest snapshot is the truth and anything after
it is lost. That is a real limit and worth stating plainly: apps needing
convergent concurrent editing want a CRDT, and this kit is not one.

---

## Open questions

- **Snapshot cadence vs. storage cost.** 15s is a guess. Item 02's telemetry
  should answer how often a host is actually lost before this is tuned; the
  ordering in the plan exists for exactly this reason.
- **Encryption default.** `encrypted: true` costs SDK-side crypto per snapshot
  but means the server cannot read session state — which is the platform's whole
  pitch. Leaning to encrypted-by-default with an opt-out.
- **Whiteboard's second key.** Now redundant. Retiring it is a migration:
  existing boards have history under `HISTORY_KEY` that would need reading from
  both places for a while.
