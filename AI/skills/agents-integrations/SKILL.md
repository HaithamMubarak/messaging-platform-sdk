---
name: agents-integrations
description: Build a client ("agent") in JavaScript, Java, Python, or C++, or integrate the SDK into a game or app. Covers which client to pick, where each lives, and the shared connect→send/receive→disconnect lifecycle.
when_to_use: Use when starting a new integration, choosing a client language, locating example agents, or wiring the SDK into a multiplayer game.
---

# Agents & Integrations

## Concept

An **agent** is any client that connects to a channel. The four official clients
share the same lifecycle — `connect → send/receive → disconnect` — so concepts
transfer between languages.

## Where each client lives

| Language | Location | Notes |
|----------|----------|-------|
| JavaScript (Web) | `WEB-AGENT-GUIDE.md`, `agents/web-agent-js/` | Browser; `AgentConnection` API |
| Java | `agents/java-agent/` | JVM and Android |
| Python | `agents/examples/python-agent-chat/` | Bots, scripts, automation |
| C++ | `agents/cpp-agent/` | Native (experimental) |

Runnable examples:
- `agents/examples/java-agent-chat/` — text chat + WebRTC video example
- `agents/examples/python-agent-chat/` — minimal chat bot
- `agents/examples/web-sdk-server/` — server hosting the web SDK + sample apps
- `agents/examples/sdk-local-service/` — local service wrapper

## Game integration

Start at `agents/GAME-DEV-INDEX.md` and `agents/GETTING-STARTED-GAMES.md`.
`agents/INTEGRATION-COMPARISON.txt` compares approaches (WebSocket vs WebRTC
relay vs HTTP) so you can pick by latency and topology needs.

## Lifecycle (any language)

1. Construct the client with `remoteUrl` (+ optional `developerApiKey`).
2. `connect({ channelName, channelPassword, agentName, ... })`.
3. Register an `onMessage` handler and/or poll with `receive(...)`.
4. `send(eventType, payload)` to publish.
5. `disconnect(sessionId)` to leave.

## Notes for assistants

- Recommend the client matching the host environment (browser → JS, server bot →
  Python/Java, native game → C++).
- For real-time games, point to the WebRTC relay path (`enableWebrtcRelay`) and
  the game guides above rather than re-deriving an architecture.
- The C++ client is marked experimental — flag that when recommending it.
