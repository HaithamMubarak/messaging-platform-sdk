# SDK demos

Each demo shows one or two primitives of the web SDK in a working app. The
playground lists them from `../data/catalogue.json`, which is the source of truth
for what is live, what it is called and which call it teaches;
`src/test/js/catalogue.test.js` checks that each Learn card's call is one its own
source makes.

| Demo | Shows | README |
|---|---|---|
| Chat | the raw `AgentConnection`, presence, Knock | [below](#chat) |
| Under the Hood | presence, host election, relay routes | [under-the-hood/](under-the-hood/README.md) |
| Whiteboard | broadcast, encrypted storage, versions | [whiteboard/](whiteboard/README.md) |
| Evidence Chain | Attest receipts, offline verification | [evidence-chain/](evidence-chain/README.md) |
| Drop | binary transfer over data channels, Vault | [drop/](drop/README.md) |
| Call | WebRTC media and screen share | [call/](call/README.md) |
| Air Hockey | host-authoritative realtime game | [mini-games/air-hockey/](mini-games/air-hockey/README.md) |
| Gavel | host as referee, stored record (Party Kit) | [mini-games/gavel/](mini-games/gavel/README.md) |
| Chess | turn-based state handed over by a peer | [chess/](chess/README.md) |
| Terminal | shared terminal (needs the SDK Local Service) | [terminal/](terminal/README.md) |

Demos that have moved (Pulse, Dead Drop, Doorbell, Party Arcade games and
others) are listed in the catalogue with `"status": "moved"`; their old URLs
redirect at the gateway.

Developer tools, not demos, so they stay out of the catalogue and out of search
(`noindex`, `robots.txt`): `test-api-key/` checks an API key against the
service and is served as the developer portal's key verifier
(`/messaging-platform/hub/developer/key-verifier/`, a gateway rule);
`turn-stun-test.html` checks STUN/TURN reachability and is opened by URL.

## Chat

The only demo on the raw connection API rather than the `UserConnectionBase`
wrapper: connect by channel ID, resume a session after a reload, and approve
another agent's key before they get the channel password. "Ring me when I'm
away" adds Knock: a content-free push that reaches somebody whose page is
closed. Typing and reactions are custom message types, one ephemeral and one
kept; alone, add a companion that types, answers and reacts.

| Call | Where |
|---|---|
| `new AgentConnection()` / `ch.connect(cfg)` (with a stored `sessionId`) | `chat.html` |
| `window.channel.sendMessage(text, done)` | `chat.html` |
| `window.channel.addEventListener('message' / 'connect' / 'disconnect', ...)` | `chat.html` |
| `ch.onPasswordRequest = async (channelId, requester, pubKeyPem) => ...` | `chat.html` — approve a joiner |
| `c.knockSubscribe({ swPath, swScope })` / `c.knockReachable(...)` | `chat-knock.js` |
| `c.storageAdd({ storageKey, content, appendOnly: true })` / `c.storageReadEntries(key)` | `chat-knock.js` — the ring log |
| `conn.sendMessage({ content, type: 'CUSTOM', customType, ephemeral })` | `chat-extras.js` — typing, reactions |

Key files: `chat.html` (page and connection), `chat-knock.js`, `chat-extras.js`,
`chat-bot.js` (the companion), `chat-*.css`, `../knock-sw.js` (Knock's service
worker).

## Run them locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/chat.html> (or any demo's page). The server
talks to the messaging service at `MESSAGING_API_URL` (default
`http://localhost:8080`) with `DEFAULT_API_KEY`, and hands each page a
short-lived temporary key from `/app/api/config`.

Browser tests live in `e2e/suites/` (see `e2e/README.md`); Chat's are
`chat-*.js` and `knock-test.js`. Every run makes channels: give them a unique
prefix and delete them afterwards.
