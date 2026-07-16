---
name: agents-integrations
description: Navigator skill — pick a client language (JS/Java/Python/C++) and find the right detailed skill. Covers the shared connect→send/receive→disconnect lifecycle and when to use each client.
when_to_use: Use as the entry point when starting a new integration or choosing a language. Then follow the link to the language-specific skill for implementation details.
---

# Agents & Integrations

## Concept

An **agent** is any client that connects to a channel. All four clients share the same lifecycle — `connect → send/receive → disconnect` — and the same connect parameters. See the language-specific skill for implementation details.

## Choose your client

| Language | Skill | Source | Best for |
|----------|-------|--------|----------|
| JavaScript (Browser) | [[web-agent-js]] | `agents/web-agent-js/js/web-agent.js` | Browser apps, collaborative tools, games |
| Java | [[java-agent]] | `agents/java-agent/` | JVM servers, Android, bots |
| Python | [[python-agent]] | `agents/python-agent/hmdev/` | Scripts, automation bots, data pipelines |
| C++ | *(experimental)* | `agents/cpp-agent/` | Native games, embedded systems |

## Examples to run

| Example | Location | What it shows |
|---------|----------|---------------|
| Java chat | `agents/examples/java-agent-chat/` | Text chat + WebRTC video |
| Python chat | `agents/examples/python-agent-chat/` | Minimal bot |
| Web SDK server | `agents/examples/web-sdk-server/` | Spring Boot server hosting the web SDK + sample apps |
| SDK local service | `agents/examples/sdk-local-service/` | Local terminal/SSH/filesystem service — see [[sdk-local-service]] |

## Game integration

Start at `agents/GETTING-STARTED-GAMES.md`. For approach comparison (WebSocket vs WebRTC relay vs HTTP polling), see `agents/INTEGRATION-COMPARISON.txt`.

## Shared lifecycle (any language)

1. Construct the client with `remoteUrl` (+ optional `developerApiKey`).
2. `connect({ channelName, channelPassword, agentName, apiKeyScope, pollSource, ... })`.
3. Register an `onMessage` / `receiveAsync` handler or poll with `receive(config)`.
4. `sendMessage(content)` / `send(...)` to publish.
5. `disconnect()` to leave.

## Connect parameters (all languages)

| Parameter | Type | Notes |
|-----------|------|-------|
| `channelName` | string | Channel identifier |
| `channelPassword` | string | No `* , / \` or spaces |
| `agentName` | string | Your identity in the channel |
| `apiKeyScope` | `"private"` / `"public"` | Use `"public"` in browsers — see [[authentication]] |
| `pollSource` | `"AUTO"` (default) / `"CACHE"` / `"DATABASE"` (`"KAFKA"` deprecated) | See [[offsets]] |
| `enableWebrtcRelay` | bool | Opt into WebRTC P2P relay |
| `channelId` | string | Connect by ID instead of name |
| `sessionId` | string | Reconnect with existing session |

## Notes for assistants

- Browser → `"public"` scope; server-side → `"private"` scope. See [[authentication]].
- For real-time games, recommend `enableWebrtcRelay: true` with COTURN for NAT traversal.
- Flag C++ as experimental when recommending it.
- `isHostAgent()` (Java/JS) returns `true` for the earliest-connected agent — useful for P2P leader election.
