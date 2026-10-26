# Evidence Chain

The demo of Attest. A note goes to channel storage; its hash goes to the
platform, which orders it, signs it and links it to the record before. Alter or
delete an entry yourself, then verify: the page re-derives the chain and checks
every signature without trusting the platform, and names where it broke.

## SDK calls it makes

| Call | Where |
|---|---|
| `channel.attest({ chainKey, kind, contentHash })` | `evidence-chain.js` — get a signed receipt |
| `channel.attestList(chainKey)` | `evidence-chain.js` — the platform's chain |
| `AgentConnection.attestVerify(bundle)` | `evidence-chain.js` — offline verification |
| `channel.storageAdd({...})` / `channel.storageGetList(key)` | `evidence-chain.js` — the notes themselves |
| `this.sendCustomEventMessage({ type: 'sealed', seq }, '*')` | `evidence-chain.js` — tell the room to reload |

## Key files

- `app.html` — the demo; `index.html` — the about page
- `evidence-chain.js` — the app
- `evidence-chain.css`

## Run it locally

From the SDK root:

```bash
./gradlew :agents:examples:web-sdk-server:bootRun
```

then open <http://localhost:8084/apps/evidence-chain/app.html>. The server talks
to the messaging service at `MESSAGING_API_URL` (default `http://localhost:8080`)
with `DEFAULT_API_KEY`, and hands the page a short-lived temporary key from
`/app/api/config`. Attest needs the service's signing key configured.

Browser tests: `e2e/suites/evidence-chain-test.js`, `ec-room-test.js`,
`ec-storage-test.js`, `attest-test.js` (see `e2e/README.md`). Every run makes
channels: give them a unique prefix and delete them afterwards.
