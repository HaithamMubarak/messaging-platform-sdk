# Air Hockey

Air hockey for two to six players with a real physics loop: the template for a
host-authoritative realtime game. The host runs the puck and the score; each
player sends only their paddle. The tightest latency test on the site: if the
puck feels right, the transport is working.

## SDK calls it makes

| Call | Where |
|---|---|
| `class AirHockeyGame extends UserConnectionBase` | `air-hockey.js` |
| `this.isHost()` / `onBecomeHost()` | `air-hockey.js` — the host simulates; a new host takes over |
| `onDataChannelOpen(peerId)` | `air-hockey.js` — send state once the channel is open |
| `this.sendData({ type: 'paddle-update', ... })` | `air-hockey.js` — each player's paddle |
| `this.sendData({ type: 'puck-update' / 'game-state', ... })` | `air-hockey.js` — the host's world |
| `this.senderOf(peerId, data)` | `air-hockey.js` — a paddle moves only for its owner, and only inside its zone |

## Key files

- `index.html` — the page
- `air-hockey.js` — game loop, physics, networking
- `air-hockey-bot.js` — bot players
- `air-hockey.css`
- `../shared/game-kit.js` — physics and effects helpers (vectors, collisions, particles)

## Run it locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/mini-games/air-hockey/index.html> in two
windows. The server talks to the messaging service at `MESSAGING_API_URL`
(default `http://localhost:8080`) with `DEFAULT_API_KEY`, and hands the page a
short-lived temporary key from `/app/api/config`.

Tests: `src/test/js/air-hockey-bot.test.js`, and the browser suites
`e2e/suites/air-hockey-*.js` (see `e2e/README.md`). Every browser run makes
channels: give them a unique prefix and delete them afterwards.
