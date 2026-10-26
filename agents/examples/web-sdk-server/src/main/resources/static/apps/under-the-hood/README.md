# Under the Hood

Presence, the elected host and the shape of the relay, drawn live. Press
"Step aside" and watch host migration happen: the part of the system every app
depends on and none of them shows.

## SDK calls it makes

| Call | Where |
|---|---|
| `class UnderTheHood extends UserConnectionBase` | `under-the-hood.js` |
| `onBecomeHost() { ... }` | `under-the-hood.js` — you are the relay now |
| `this.isHost()` / `this._getHostName()` | `under-the-hood.js` — who holds the crown |
| `onDataChannelOpen(peerId, ms)` | `under-the-hood.js` — draw a direct link |
| `this.sendCustomEventMessage({ type: 'ping', ... }, '*')` / `this.sendData(...)` | `under-the-hood.js` — route a message and show its path |
| `this.connect()` / `this.disconnect()` | `under-the-hood.js` — leave, rejoin, drop without goodbye |

## Key files

- `app.html` — the demo; `index.html` — the about page
- `under-the-hood.js` — the app
- `under-the-hood.css`

## Run it locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/under-the-hood/app.html> in two or three
windows. The server talks to the messaging service at `MESSAGING_API_URL`
(default `http://localhost:8080`) with `DEFAULT_API_KEY`, and hands the page a
short-lived temporary key from `/app/api/config`.

Browser tests: `e2e/suites/under-the-hood-test.js`, `hood-routes-test.js` (see
`e2e/README.md`). Every run makes channels: give them a unique prefix and delete
them afterwards.
