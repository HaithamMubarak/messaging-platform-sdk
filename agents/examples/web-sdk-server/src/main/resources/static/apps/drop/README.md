# Drop

Two ways to hand somebody a file.

- **Send now** streams it in chunks over the WebRTC data channel, straight
  between browsers. Nothing is uploaded and nothing is stored.
- **Leave for later** encrypts a note or file in your browser and stores it in
  the room: notes in channel storage, larger files in the Vault, for whoever
  opens the link next.

Alone, add a companion and send it a postcard.

## SDK calls it makes

| Call | Where |
|---|---|
| `class Drop extends UserConnectionBase` | `drop.js` |
| `this.sendData(chunk, peerId)` | `drop.js` — one chunk, addressed to one peer |
| `onDataChannelOpen()` | `drop.js` — resume once the channel is open |
| `this.senderOf(peerId, data)` | `drop.js` — answer a resend only to the file's recipient |
| `channel.storageAdd({ ..., appendOnly: true })` / `channel.storageGetList(key)` | `mailbox.js` — the mailbox |
| `channel.vaultPut(blob, { ttlSeconds })` / `vaultGet` / `vaultDelete` | `mailbox.js` — larger files, deleted once read |

## Key files

- `index.html` — the page
- `drop.js` — Send now (chunked transfer, resume)
- `mailbox.js` — Leave for later (encrypted drops, Vault, seals)
- `drop.css`, `mailbox.css`

## Run it locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/drop/index.html> (`?mode=later` opens
Leave for later). The server talks to the messaging service at
`MESSAGING_API_URL` (default `http://localhost:8080`) with `DEFAULT_API_KEY`, and
hands the page a short-lived temporary key from `/app/api/config`.

Browser tests: `e2e/suites/drop-*.js` (see `e2e/README.md`). Every run makes
channels: give them a unique prefix and delete them afterwards.
