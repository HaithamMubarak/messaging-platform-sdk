# Gavel

A courtroom run on anonymous testimony: the template for a party game with the
host as referee. The host is the only broadcaster; every player-to-host message
is addressed rather than shouted, and each verdict is appended to channel
storage as case law the next session inherits.

## SDK calls it makes

| Call | Where |
|---|---|
| `class GavelGame extends PartyKit.PartyGame` | `gavel.js` (PartyGame extends `UserConnectionBase`) |
| `this.toHost(msg)` | `gavel.js`, `party-kit.js` — a player's plea, testimony or vote, to the host only |
| `this.broadcastState()` | `gavel.js`, `party-kit.js` — the host's public state, to the room |
| `this.senderOf(peerId, data)` | `party-kit.js` — the true author of each message |
| `this.channel.storageAdd({...})` / `this.channel.storageReadList(key)` | `gavel.js` — case law |
| `Seals.seal(...)` / `Seals.who(...)` | `gavel.js` — which bench ruled each verdict (`js/seals.js`, on Attest) |

## Key files

- `index.html` — the page
- `gavel.js` — the game
- `gavel.css`
- `../shared/party-kit.js` — host/guest messaging, roster, clock (shared by party games)
- `../shared/party.css`, `../shared/party-sfx.js`

## Run it locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/mini-games/gavel/index.html> in three or
more windows. The server talks to the messaging service at `MESSAGING_API_URL`
(default `http://localhost:8080`) with `DEFAULT_API_KEY`, and hands the page a
short-lived temporary key from `/app/api/config`.

Browser tests: `e2e/suites/gavel-*.js` (see `e2e/README.md`). Every run makes
channels: give them a unique prefix and delete them afterwards.
