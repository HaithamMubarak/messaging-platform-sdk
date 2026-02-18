# Messaging Local Service (MLS)

**Version:** 1.0.0  
**Port:** 8088  
**Description:** Local service for terminal management, SSH connections, and command execution

---

## Overview

The Messaging Local Service (MLS) is a Spring Boot application that runs locally on the user's machine, providing:

- ✅ **Local Terminal Sessions** - Execute commands on the local machine (cmd, bash, PowerShell)
- ✅ **SSH Connection Management** - Store and manage SSH connections with credentials
- ✅ **Remote Terminal via SSH** - Connect to remote servers and execute commands
- ✅ **Session Management** - Maintain multiple terminal sessions simultaneously
- ✅ **WebSocket Streaming** - Real-time terminal output via WebSocket
- ✅ **TCP Packet Forwarding** - Forward TCP traffic through SSH tunnels (future feature)

---

## Quick Start

### Prerequisites
- Java 11 or higher
- Windows, Linux, or macOS

### Build
```bash
gradlew.bat clean build -x test
```

### Start Service
```bash
# Using startup script (recommended)
start-mls.bat

# Or manually
java -jar build\libs\messaging-local-service-1.0.0.jar
```

### Stop Service
```bash
stop-mls.bat
```

### Verify Service
```bash
# Check if running
netstat -ano | findstr :8088

# Test endpoint
curl http://localhost:8088/ssh/connections

# Access H2 Database Console
# Open browser to: http://localhost:8088/h2-console
# JDBC URL: jdbc:h2:file:./mls-data
# Username: sa (password: empty)
```

### H2 Console Access
The H2 database console is enabled for easy database management:
- **URL:** http://localhost:8088/h2-console
- **JDBC URL:** `jdbc:h2:file:./mls-data`
- **Username:** `sa`
- **Password:** (leave empty)

See `H2-CONSOLE-GUIDE.md` for detailed instructions and SQL queries.

---

## API Endpoints

### Terminal Management

#### Spawn Local Terminal
```http
POST /terminal/spawn
Content-Type: application/json

{
  "shell": "cmd"  // or "bash", "powershell"
}

Response:
{
  "sessionId": "abc123",
  "shell": "cmd",
  "status": "active"
}
```

#### Connect to SSH
```http
POST /terminal/connect-ssh
Content-Type: application/json

{
  "connectionId": 1
}

Response:
{
  "sessionId": "xyz789",
  "connectionName": "prod-server",
  "host": "server.example.com",
  "status": "active"
}
```

#### Send Input to Terminal
```http
POST /terminal/{sessionId}/input
Content-Type: application/json

{
  "data": "ls -la\n"
}
```

#### Resize Terminal
```http
POST /terminal/{sessionId}/resize
Content-Type: application/json

{
  "cols": 80,
  "rows": 24
}
```

#### Close Terminal Session
```http
DELETE /terminal/{sessionId}
```

#### Stream Terminal Output (WebSocket)
```
ws://localhost:8088/terminal/stream/{sessionId}
```

---

### SSH Connection Management

#### List All Connections
```http
GET /ssh/connections

Response:
[
  {
    "id": 1,
    "name": "prod-server",
    "host": "server.example.com",
    "port": 22,
    "username": "admin",
    "description": "Production server",
    "createdAt": "2026-02-10T12:00:00"
  }
]
```

#### Get Connection by ID
```http
GET /ssh/connections/{id}
```

#### Create New Connection
```http
POST /ssh/connections
Content-Type: application/json

{
  "name": "prod-server",
  "host": "server.example.com",
  "port": 22,
  "username": "admin",
  "password": "secret",        // optional
  "privateKey": "-----BEGIN...", // optional
  "description": "Production server"
}

Response:
{
  "id": 1,
  "name": "prod-server",
  "host": "server.example.com",
  ...
}
```

#### Update Connection
```http
PUT /ssh/connections/{id}
Content-Type: application/json

{
  "name": "updated-name",
  ...
}
```

#### Delete Connection
```http
DELETE /ssh/connections/{id}
```

---

## Configuration

### application.properties

```properties
# Server Configuration
server.port=8088

# Database (H2, file-based)
spring.datasource.url=jdbc:h2:file:./mls-data
spring.jpa.hibernate.ddl-auto=update

# Command Execution
mls.command.timeout=30000
mls.command.maxConcurrent=10
mls.command.shell=bash

# Session Management
mls.session.maxActive=50
mls.session.timeout=3600000

# TCP Configuration
mls.tcp.maxForwardingRules=20
mls.tcp.bufferSize=8192
```

---

## CORS Configuration

MLS accepts requests from:
- ✅ `https://hmdevonline.com` (production)
- ✅ `http://localhost:*` (any local port)
- ✅ `http://127.0.0.1:*` (any local port)

This allows the web UI to connect from various development servers while maintaining security for production.

**Configuration:** `src/main/java/com/hmdev/mls/config/CorsConfig.java`

---

## Architecture

### Components

1. **Controllers**
   - `TerminalController` - Terminal session management
   - `SshConnectionController` - SSH connection CRUD operations

2. **Services**
   - `TerminalService` - Process management, terminal sessions

3. **WebSocket**
   - `TerminalWebSocketHandler` - Real-time terminal output streaming

4. **Models**
   - `TerminalSession` - Active terminal session data
   - `SshConnection` - SSH connection credentials (JPA entity)

5. **Repositories**
   - `TerminalSessionRepository` - In-memory session storage
   - `SshConnectionRepository` - H2 database persistence

### Data Storage

- **Terminal Sessions:** In-memory (cleared on restart)
- **SSH Connections:** H2 database (file: `./mls-data.mv.db`)
- **Logs:** `./logs/mls.log`

---

## Usage Example

### From Web UI (terminal.html)

```javascript
// 1. Spawn local terminal
const response = await fetch('http://localhost:8088/terminal/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shell: 'cmd' })
});
const { sessionId } = await response.json();

// 2. Connect WebSocket for output
const ws = new WebSocket(`ws://localhost:8088/terminal/stream/${sessionId}`);
ws.onmessage = (event) => {
    terminal.write(event.data);
};

// 3. Send input
await fetch(`http://localhost:8088/terminal/${sessionId}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'dir\n' })
});

// 4. Close session
await fetch(`http://localhost:8088/terminal/${sessionId}`, {
    method: 'DELETE'
});
```

---

## Security Considerations

### Local-Only Service
- MLS runs **only on localhost** (127.0.0.1/::1)
- Not exposed to external networks
- No authentication required (local trust model)

### SSH Credentials
- Passwords and private keys stored in local H2 database
- Database file encrypted at rest (OS-level encryption recommended)
- Consider using SSH key authentication instead of passwords

### Process Isolation
- Terminal sessions run with the same privileges as MLS
- Command execution inherits user permissions
- No privilege escalation without explicit credentials

---

## Troubleshooting

### Port Already in Use
```bash
# Find and kill process on port 8088
netstat -ano | findstr :8088
taskkill /F /PID <PID>
```

### Database Locked
```bash
# Delete database files and restart
del mls-data.mv.db
del mls-data.trace.db
```

### SSH Connection Fails
- Verify credentials are correct
- Check network connectivity to remote host
- Ensure SSH server is running on target
- Verify private key format (should be OpenSSH format)

### Terminal Output Garbled
- Ensure proper terminal encoding (UTF-8)
- Check terminal size matches WebSocket dimensions
- Verify shell compatibility (cmd on Windows, bash on Unix)

---

## Development

### Project Structure
```
messaging-local-service/
├── src/main/java/com/hmdev/mls/
│   ├── MessagingLocalServiceApplication.java
│   ├── config/
│   │   ├── CorsConfig.java
│   │   └── WebSocketConfig.java
│   ├── controller/
│   │   ├── SshConnectionController.java
│   │   └── TerminalController.java
│   ├── service/
│   │   └── TerminalService.java
│   ├── websocket/
│   │   └── TerminalWebSocketHandler.java
│   ├── model/
│   │   ├── SshConnection.java
│   │   └── TerminalSession.java
│   └── repository/
│       ├── SshConnectionRepository.java
│       └── TerminalSessionRepository.java
├── src/main/resources/
│   └── application.properties
├── build.gradle
├── start-mls.bat
└── stop-mls.bat
```

### Adding New Features

1. **New Terminal Type:** Extend `TerminalService.spawnTerminal()`
2. **New Authentication:** Update `SshConnection` model
3. **New Protocol:** Create new controller and WebSocket handler

---

## Dependencies

- **Spring Boot 2.7.14** - Web framework
- **Spring WebSocket** - Real-time communication
- **Spring Data JPA** - Database persistence
- **H2 Database** - Embedded database
- **JSch 0.1.55** - SSH client library
- **JNA 5.12.1** - Native process support

---

## Future Enhancements

- [ ] TCP port forwarding
- [ ] SSH tunnel management
- [ ] File transfer via SFTP
- [ ] Terminal session recording/playback
- [ ] Multiple terminal tabs in one session
- [ ] Clipboard integration
- [ ] Custom key bindings
- [ ] Terminal themes

---

## License

See LICENSE file for details.

---

## Support

For issues or questions:
1. Check the logs: `./logs/mls.log`
2. Review troubleshooting section above
3. Contact development team

---

**Last Updated:** February 10, 2026


