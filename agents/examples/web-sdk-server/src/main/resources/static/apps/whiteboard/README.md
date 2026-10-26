# Whiteboard

A shared drawing surface: pen, shapes, text and sticky notes. Every stroke
reaches the room as it is made, undo reaches everybody, and the board is still
there when you come back, stored encrypted so the server keeps a board it cannot
read. Every save is a version, and History scrubs or plays back through them
without touching the board. Alone, play Guess the Doodle: a bot draws, you guess.

## SDK calls it makes

| Call | Where |
|---|---|
| `channel.storagePut({ storageKey: 'board', content })` | `whiteboard-client.js` — save the board |
| `channel.storageGet({...})` | `whiteboard-client.js` — load it on join |
| `channel.storageAdd({...})` / `channel.storageGetList(key)` | `whiteboard-client.js` — history versions |
| `broadcastAction(action, command)` | `whiteboard-client.js` — strokes and undo to the room |
| `webrtcHelper.sendData(agentId, data)` | `whiteboard-client.js` — canvas sync to one peer |
| `this.senderOf(peerId, data)` | `whiteboard-client.js` — the real author of a relayed stroke or undo |
| `channel.isHostAgent(...)` | `whiteboard-client.js` — who answers a joiner |

## Key files

- `app.html` — the board; `index.html` — the about page
- `whiteboard-client.js` — connection, sync, storage (large; splitting it is on the roadmap)
- `whiteboard-tools.js` — drawing tools
- `board-replay.js` — the History panel's playback
- `doodle-game.js`, `doodle-bot.js` — Guess the Doodle
- `whiteboard.css`, `excalidraw-style.css`

## Run it locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/whiteboard/app.html>. The server talks to
the messaging service at `MESSAGING_API_URL` (default `http://localhost:8080`)
with `DEFAULT_API_KEY`, and hands the page a short-lived temporary key from
`/app/api/config`. Open a second window to draw together.

Tests: `src/test/js/board-replay.test.js`, `doodle-bot.test.js`, and the browser
suites `e2e/suites/wb-*.js` (see `e2e/README.md`). Every browser run makes
channels: give them a unique prefix and delete them afterwards.
