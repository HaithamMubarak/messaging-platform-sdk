# Messaging Platform SDK — AI Skills

**Scope:** This skills set is **self-contained**. It describes only the public
`messaging-platform-sdk` repository and never depends on any private repo.
An AI assistant working in this repo should be able to use these skills with no
external context.

## What this SDK is

A real-time messaging SDK for multiplayer games, collaborative apps, and
real-time communication. Client libraries exist for **JavaScript (Web)**,
**Java**, **Python**, and **C++**. The core surface is small and consistent
across languages: you **connect** to a **channel**, **send/receive** event
messages, control **offsets / poll source** for history, authenticate with an
**API key + channel password**, and ship it inside an **agent / integration**.

## Skills in this set

| Skill | Use it when you need to… | Folder |
|-------|--------------------------|--------|
| **messaging** | Send and receive event messages; understand `EventMessage` / event types; WebSocket vs HTTP/UDP transport | `messaging/` |
| **channels** | Connect, disconnect, list active/system agents, manage channel lifecycle and per-channel storage | `channels/` |
| **offsets** | Reason about message history, `PollSource` (CACHE/KAFKA/DATABASE/AUTO), and `ChannelOffsetInfo` | `offsets/` |
| **authentication** | Use developer API keys, `apiKeyScope` (private/public), and channel passwords | `authentication/` |
| **agents-integrations** | Build a client in JS/Java/Python/C++ or wire the SDK into a game/app | `agents-integrations/` |

## How to use a skill

Each `SKILL.md` has a frontmatter-style header (`name`, `description`,
`when_to_use`), a short conceptual model, the **real API entry points with file
paths**, and a minimal example. Paths point at actual files in this repo so the
guidance stays consistent with the code.

## Conventions

- Skills describe **public** SDK behavior only. Do not add anything here that
  documents private backend/services internals.
- When code changes, update the matching `SKILL.md` in the same commit.
- Keep examples runnable against the public SDK surface.

## Canonical references in this repo

- `README.md`, `USER-GUIDE.md`, `DEVELOPER-GUIDE.md`, `WEB-AGENT-GUIDE.md`
- C++ API headers: `agents/cpp-agent/include/hmdev/messaging/api/`
- Shared data models: `agents/examples/web-sdk-server/src/main/java/com/hmdev/messaging/common/data/`
