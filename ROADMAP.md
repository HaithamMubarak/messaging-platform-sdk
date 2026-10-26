# Roadmap

**Updated:** 2026-10-26

A short backlog of open work in this repository. Shipped features are not
listed: see [README.md](README.md) and each agent's guide for what exists
today. Open an issue to suggest an item or to pick one up.

## Agent parity

The web agent (`agents/web-agent-js`) has four primitives; the other agents are
catching up:

| Primitive | Web | Python | Java | C++ |
|---|---|---|---|---|
| Channel storage (`storagePut`, `storageAdd`, `storageGetList`, ...) | yes | yes | yes | no |
| Attest (`attest`, `attestList`, `attestVerify`) | yes | no | no | no |
| Vault (`vaultPut`, `vaultGet`, `vaultDelete`) | yes | no | no | no |
| Knock (`knock`, `knockReachable`; `knockSubscribe` is browser-only) | yes | no | no | no |

Each one is an addition to that agent's client plus a test against a real
service, written from the web agent's wire format (capture a real response
before writing a stub). Storage is the model: `ChannelStorage` in both agents,
reached as `connection.storage` / `connection.storage()`.

Next, for Python and Java (estimates are for both agents together, with unit
tests, one live round trip and a cross-language read):

- **Attest** (about 1.5 days). `attest`, `attestList`, `attestExport`,
  `attestChains`, and the offline verifier: canonical JSON, SHA-256 and ECDSA
  P-256 signatures (`cryptography` in Python, JCA in Java). The risk is the
  canonical form: it must stay byte-identical to the web agent's and the
  server's, numbers included, or a chain stops verifying with no error. Test
  it on a chain the web agent made.
- **Vault** (about 2 days). Chunked upload and download (256 KB chunks), a key
  made per blob, AES-256-GCM on each chunk and a SHA-256 of the ciphertext;
  `vaultList`, `vaultQuota`, `vaultStatus` and `vaultDelete` are thin calls.
  Prove a blob sealed by the web agent opens in Python and Java, and the
  reverse.
- **Knock** (about half a day). Only the sending side applies: `knock` and
  `knockReachable`. Subscribing is the browser's Push API and has no
  counterpart in a server-side agent.

## Demos (`agents/examples/web-sdk-server/.../static/apps`)

- **One shared game kit.** Air Hockey and Chess build their networking on
  `UserConnectionBase` directly, Gavel on `mini-games/shared/party-kit.js`, and
  only Air Hockey uses the physics and effects in
  `mini-games/shared/game-kit.js`. Settle on one kit for host authority,
  addressed messages and state handover to joiners, and move the games onto it.
- **Split the two largest pages.** `apps/chat.html` (~2,700 lines, inline
  script) and `apps/whiteboard/app.html` (~2,800 lines) with
  `whiteboard-client.js` (~7,500 lines) should become a page plus modules, which
  would also let the site carry a Content Security Policy.
- **Refresh `agents/examples/web-sdk-server/README.md`.** It still describes
  port 8090 and demos that have moved (Pictionary, Quiz Battle, Collaborative
  document); the server runs on 8084 and `static/data/catalogue.json` is the
  list of what is live.

## Releases

- Reproducible package releases for each agent (versioned artefacts built
  from a tag).
- A cross-language compatibility check: the same scenario run by every agent
  against one service, in CI.
