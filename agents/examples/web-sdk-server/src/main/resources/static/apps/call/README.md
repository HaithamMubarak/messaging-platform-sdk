# Call

Camera, microphone and screen share, straight between browsers. The channel
carries who is here and what each person has switched on; the media itself goes
peer to peer over WebRTC. Sharing your screen replaces your camera rather than
adding a second stream. Alone, add a companion: its camera is a test card sent
over WebRTC.

## SDK calls it makes

| Call | Where |
|---|---|
| `class Call extends UserConnectionBase` | `call.js` — connection, presence, data channels |
| `this.webrtcHelper.createStreamOffer(peer, { stream })` | `call.js` — the stream goes in the offer |
| `this.sendData({...})` | `call.js` — who has camera/mic/screen on |
| `this.senderOf(peer, data)` | `call.js` — the real author of a relayed message |

## Key files

- `index.html` — the page and its script list
- `call.js` — the app (tiles, toggles, screen share, companion)
- `call.css`

## Run it locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/call/index.html>. The server talks to the
messaging service at `MESSAGING_API_URL` (default `http://localhost:8080`) with
`DEFAULT_API_KEY`, and hands the page a short-lived temporary key from
`/app/api/config`. Open a second window to be two people in the room.

Browser tests: `e2e/suites/call-test.js`, `call-room-test.js`, `call-solo-test.js`
(see `e2e/README.md`). Every run makes channels: give them a unique prefix and
delete them afterwards.
