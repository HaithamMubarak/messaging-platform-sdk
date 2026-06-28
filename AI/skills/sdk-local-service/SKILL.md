---
name: sdk-local-service
description: SDK Local Service (SLS) — a standalone Spring Boot app (port 8088) that runs on the user's machine providing terminal sessions, SSH connection management, filesystem access, cloud-platform connection, and WebSocket streaming.
when_to_use: Use when working on the local service app, adding new endpoints, understanding the terminal/SSH/filesystem architecture, or integrating the web app with SLS features.
---

# SDK Local Service (SLS)

Source: `agents/examples/sdk-local-service/`
Built JAR: `build/libs/sdk-local-service.jar`
Port: **8088**
Database: H2 embedded at `./mls-data` (file-based persistence)

---

## What it does

Runs locally on the user's machine and exposes a REST + WebSocket API that the web app calls. Provides:

- **Local terminal sessions** — spawn bash/cmd/PowerShell, stream output via WebSocket
- **SSH connection management** — store credentials, open remote terminals
- **Filesystem access** — local, SFTP (via SSH), and notes filesystems
- **Cloud platform connection** — connect to the messaging platform from local context
- **Config backup/restore** — export and import app config
- **Auth** — token-based security (local only, not exposed externally)

---

## Module structure

```
src/main/java/com/hmdev/sdk/local/
  controller/          REST endpoints
  terminal/            Terminal session implementations
  filesystem/          File system abstraction layer
  security/            Token-based auth filter
  config/              CORS, WebSocket, security config
  model/               AppConfig, SshConnection, TerminalSession
  repository/          H2 JPA repositories
  dto/                 Request/response shapes
```

---

## Controllers & endpoints

### `HealthController`
- `GET /health` — liveness check

### `AuthController`
- `POST /auth/token` — generate access token (`TokenGenerationRequest`)
- `GET /auth/validate` — validate token
- `GET /auth/status` — security status

### `TerminalController`
- `POST /terminal/spawn` — create terminal session (local or SSH)
- `DELETE /terminal/{sessionId}` — kill terminal session
- WebSocket: `/terminal/ws/{sessionId}` — bi-directional terminal I/O stream (`TerminalWebSocketHandler`)

### `FileSystemController`
- `POST /filesystem/create` — create filesystem (local / SFTP / notes)
- `GET /filesystem/{id}/list` — list directory
- `GET /filesystem/{id}/read` — read file
- `POST /filesystem/{id}/write` — write file
- `DELETE /filesystem/{id}/delete` — delete file/dir

### `CloudConnectionController`
- Manages the connection from local service → messaging platform cloud

### `ConfigBackupController`
- `GET /config/export` — export current config as JSON
- `POST /config/import` — import config JSON

---

## Terminal architecture

```
TerminalController
  └─→ TerminalService
        ├─→ LocalTerminalSession  (bash/cmd/PowerShell via ProcessBuilder)
        └─→ SshTerminalSession    (remote shell via SSH)

TerminalWebSocketHandler  ← streams I/O between browser and session
```

`ITerminalSession` interface: `write(input)`, `read()`, `close()`

Session state persisted in H2 via `TerminalSessionRepository`.

---

## Filesystem architecture

```
FileSystemController
  └─→ FileSystemService
        ├─→ LocalFileSystem   (java.nio on local disk)
        ├─→ SftpFileSystem    (JSch SFTP over SSH)
        └─→ NotesFileSystem   (notes-specific virtual FS)
```

`IFileSystem` interface: `list()`, `read()`, `write()`, `delete()`, `mkdir()`

Filesystem instances are keyed by ID and created via `POST /filesystem/create` with a type discriminator.

---

## SSH connection management

`SshConnection` model (stored in H2 via `SshConnectionRepository`):
- `host`, `port`, `username`, `password` / `privateKey`
- Used by both `SshTerminalSession` and `SftpFileSystem`

Test an SSH connection:
- `POST /ssh/test` with `SshTestRequest` → `SshTestResponse`

---

## Security

`SecurityFilter` intercepts all requests (except `/health`, `/auth/token`) and validates the token from the `Authorization: Bearer <token>` header.

`SecurityService` generates/validates tokens stored in H2 via `SecurityTokenRepository`.

`SecurityConfig` — Spring Security config (stateless, token-based). CORS is open (`CorsConfig`) since the service is local-only.

---

## Configuration

`AppConfig` model in H2 (`AppConfigRepository`) — stores key-value pairs for app settings. Backed up/restored via `ConfigBackupController`.

`application.properties` key settings:
- `server.port=8088`
- `spring.datasource.url=jdbc:h2:file:./mls-data`
- `spring.h2.console.enabled=true` → http://localhost:8088/h2-console

---

## Build & run

```bash
# Build
cd agents/examples/sdk-local-service
./gradlew clean build -x test

# Run
java -jar build/libs/sdk-local-service.jar

# Windows scripts
start-sls.bat
stop-sls.bat
```

---

## Notes for assistants

- SLS is a **local-only** service — it must never be exposed on a public port. `CorsConfig` is permissive because the caller is always the local browser.
- Terminal sessions survive the HTTP request lifecycle; they are managed by `TerminalService` in-memory and persisted to H2 for reconnection.
- SFTP filesystems require an active `SshConnection` — create the SSH connection first, then reference its ID when creating the SFTP filesystem.
- The H2 console at `/h2-console` is enabled — useful for debugging stored sessions and config.
- `ShellConfig` determines which shell binary to use per OS (`bash` on Linux/Mac, `cmd.exe` / `powershell.exe` on Windows).
