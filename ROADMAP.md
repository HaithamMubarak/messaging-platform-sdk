# Roadmap

**Updated:** 2026-10-26

A short backlog of open work in this repository. Shipped features are not
listed: see [README.md](README.md) and each agent's guide for what exists
today. Open an issue to suggest an item or to pick one up.

## Agent parity

The web agent (`agents/web-agent-js`) has four primitives the other agents do
not have yet:

| Primitive | Web | Python | Java | C++ |
|---|---|---|---|---|
| Channel storage (`storagePut`, `storageAdd`, `storageGetList`, ...) | yes | no | no | no |
| Attest (`attest`, `attestList`, `attestVerify`) | yes | no | no | no |
| Vault (`vaultPut`, `vaultGet`, `vaultDelete`) | yes | no | no | no |
| Knock (`knockSubscribe`, `knockReachable`) | yes | no | no | no |

Each one is an addition to that agent's client plus a test against a real
service, written from the web agent's wire format (capture a real response
before writing a stub).

## Demos (`agents/examples/web-sdk-server/.../static/apps`)

- **One shared game kit.** Air Hockey and Chess build their networking on
  `UserConnectionBase` directly, Gavel on `mini-games/shared/party-kit.js`, and
  only Air Hockey uses the physics and effects in
  `mini-games/shared/game-kit.js`. Settle on one kit for host authority,
  addressed messages and state handover to joiners, and move the games onto it.
- **Terminal onto the connection modal.** `apps/terminal` still has its own
  connect flow; every other demo uses `js/connection-modal.js`.
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
