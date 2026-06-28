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

### Generate code, docs, or run an AI agent ← start here for any "create/run" request

| Skill | Use it when you need to… | Folder |
|-------|--------------------------|--------|
| **code-generator** | Generate runnable connection code (default: Python) or docs for any language, or run the AI agent on a channel | `code-generator/` |

### Quick copy-paste snippets

| Skill | Use it when you need to… | Folder |
|-------|--------------------------|--------|
| **connect** | Static copy-paste snippets for JS, Java, Python, and C++ — no script needed | `connect/` |

### Core concepts (language-agnostic)

| Skill | Use it when you need to… | Folder |
|-------|--------------------------|--------|
| **messaging** | Send and receive event messages; `EventMessage` shape / event types; WebSocket vs HTTP/UDP transport | `messaging/` |
| **channels** | Connect, disconnect, list active/system agents, manage channel lifecycle and per-channel storage | `channels/` |
| **offsets** | Message history, `PollSource` (CACHE/KAFKA/DATABASE/AUTO), and `ChannelOffsetInfo` counters | `offsets/` |
| **authentication** | Developer API keys, `apiKeyScope` (private/public), channel passwords | `authentication/` |
| **agents-integrations** | Choose a language, understand shared lifecycle, find examples | `agents-integrations/` |

### Language-specific clients

| Skill | Use it when you need to… | Folder |
|-------|--------------------------|--------|
| **web-agent-js** | Build a browser agent — callbacks, storage, WebRTC, encryption, FileSystem helper | `web-agent-js/` |
| **java-agent** | Build a Java/Android agent — `ConnectConfig`, `AgentConnection`, async receive, UDP | `java-agent/` |
| **python-agent** | Build a Python bot or script — `AgentConnection`, `receive_async`, UDP, AES | `python-agent/` |

### Apps & examples

| Skill | Use it when you need to… | Folder |
|-------|--------------------------|--------|
| **sdk-local-service** | Work on the local service app (terminal, SSH, filesystem, cloud connection, WebSocket) | `sdk-local-service/` |
| **git-workflow** | Push/pull either repo, understand the two-remote setup (SDK: private origin + public; services: private only) | `git-workflow/` |

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
