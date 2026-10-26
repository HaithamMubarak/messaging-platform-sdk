# Chess

Turn-based chess where the board is rebuilt from the other player, not from a
server. A joiner is sent the position and the whole move list in one addressed
message, so a spectator arrives mid-game with the history intact. Alone, play
the computer; a room can watch.

## SDK calls it makes

| Call | Where |
|---|---|
| `class ChessGame extends UserConnectionBase` | `chess-game.js` |
| `this.sendData({ type: 'move', from, to, promotion, fen })` | `chess-game.js` — a move, to the room |
| `this.sendData({ type: 'game-sync', fen, pgn, ... }, targetUsername)` | `chess-game.js` — the whole game, to one joiner |
| `this.senderOf(peerId, data)` | `chess-game.js` — only a seated player may move or resign |
| `this.isHost()` | `chess-game.js` — who answers a joiner |

## Key files

- `index.html` — the page
- `chess-game.js` — the app and its message handling
- `chess-bot.js` — the computer opponent
- `lib/chess.min.js` — move rules (chess.js)
- `chess.css`

## Run it locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/chess/index.html>. The server talks to the
messaging service at `MESSAGING_API_URL` (default `http://localhost:8080`) with
`DEFAULT_API_KEY`, and hands the page a short-lived temporary key from
`/app/api/config`.

Tests: `src/test/js/chess-bot.test.js`, and the browser suites
`e2e/suites/chess-*.js` (see `e2e/README.md`). Every browser run makes channels:
give them a unique prefix and delete them afterwards.
