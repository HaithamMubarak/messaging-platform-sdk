# SDK Local Service (SLS)

**Version:** 1.0.0  
**Port:** 8088 (localhost only - 127.0.0.1)  
**Database:** H2 (sls-data.mv.db)  
**Security:** ✅ Token-based authentication enabled

---

## 🎯 What is SDK Local Service?

**SDK Local Service (SLS)** is a **secure** general-purpose local service for the Messaging Platform SDK that provides:
- ✅ Execute terminal commands (local or SSH)
- ✅ Session management with H2 database persistence
- ✅ SSH connection management (saved connections)
- ✅ Interactive terminal via WebSocket
- ✅ REST API for all operations
- 🔒 **Token-based security** for all API endpoints
- 🔒 **Localhost-only binding** (127.0.0.1) - no external access
- 🔒 **Origin validation** to prevent CSRF attacks

---

## 🚀 Quick Start

### 1. Build

```bash
./gradlew build
```

### 2. Run

```bash
java -jar build/libs/sdk-local-service.jar
```

Or:

```bash
./gradlew bootRun
```

### 3. Access

- **Terminal UI:** http://localhost:8088
- **Health Check:** http://localhost:8088/health

### 4. Get Security Token

**IMPORTANT:** All API endpoints (except public ones) require a security token.

Request a token:
```bash
curl -X POST http://localhost:8088/auth/token
```

Response:
```json
{
  "token": "your-secure-token-here",
  "expiresIn": 24,
  "message": "Token generated successfully. Include this token in 'X-SLS-Token' header for all requests."
}
```

Use token in requests:
```bash
curl -H "X-SLS-Token: your-token-here" http://localhost:8088/terminal/create
```

---

## 🔒 Security Features

SLS implements **production-ready security** measures:

| Feature | Status | Description |
|---------|--------|-------------|
| Localhost-only binding | ✅ Enabled | Service only accessible from 127.0.0.1 |
| Token authentication | ✅ Enabled | All API endpoints require valid token |
| Strict CORS | ✅ Enabled | Only trusted origins allowed |
| Origin validation | ✅ Enabled | Prevents CSRF attacks |
| Token expiry | ✅ Enabled | Tokens auto-expire after 24 hours |
| Secure token generation | ✅ Enabled | 48-byte cryptographically secure random tokens |
| Request logging | ✅ Enabled | All security events logged |
| H2 Console | ❌ Disabled | Disabled by default for security |

**See:** [SECURITY-IMPLEMENTATION.md](./SECURITY-IMPLEMENTATION.md) for complete security documentation.

---

## 📋 REST API

### Terminal Operations

**POST /terminal/spawn**  
Spawn local terminal
```json
{
  "shell": "bash"  // or "cmd", "powershell"
}
```

**POST /terminal/connect-ssh**  
Connect to SSH using saved connection
```json
{
  "connectionId": 1  // or "connectionName": "prod-server"
}
```

**POST /terminal/{sessionId}/input**  
Send input to terminal
```json
{
  "data": "ls -la\n"
}
```

**POST /terminal/{sessionId}/resize**  
Resize terminal
```json
{
  "cols": 120,
  "rows": 40
}
```

**DELETE /terminal/{sessionId}**  
Close terminal session

**WS /terminal/stream/{sessionId}**  
WebSocket stream for terminal output

---

### SSH Connection Management

**GET /ssh/connections**  
Get all saved SSH connections

**GET /ssh/connections/{id}**  
Get specific SSH connection

**POST /ssh/connections**  
Create new SSH connection
```json
{
  "name": "prod-server",
  "host": "server.example.com",
  "port": 22,
  "username": "admin",
  "password": "secret",
  "privateKey": "-----BEGIN RSA PRIVATE KEY-----...",
  "description": "Production server"
}
```

**PUT /ssh/connections/{id}**  
Update SSH connection

**DELETE /ssh/connections/{id}**  
Delete SSH connection

---

## 🗄️ Database Schema

### ssh_connections

```sql
CREATE TABLE ssh_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(255) NOT NULL UNIQUE,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username VARCHAR(255) NOT NULL,
  password VARCHAR(255),
  private_key TEXT,
  description TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  last_used_at DATETIME
);
```

### terminal_sessions

```sql
CREATE TABLE terminal_sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  shell VARCHAR(50),
  ssh_connection_id INTEGER,
  current_directory VARCHAR(500),
  status VARCHAR(50) NOT NULL,
  created_at DATETIME,
  closed_at DATETIME,
  process_id INTEGER
);
```

---

## 🎨 Web Interface

The web interface provides:

1. **Interactive Terminal**
   - Full xterm.js terminal emulator
   - Real-time output via WebSocket
   - Keyboard input support
   - Terminal resizing

2. **SSH Connection Manager**
   - Save SSH connections to H2 database
   - Quick connect from saved connections
   - Password or private key authentication
   - Connection descriptions

3. **Session Management**
   - Spawn local terminals
   - Connect to saved SSH servers
   - Close active sessions
   - Status indicators

---

## 📦 Project Structure

```
sdk-local-service/
├── build.gradle
├── settings.gradle
├── README.md
├── start-sls.bat
├── stop-sls.bat
└── src/main/
    ├── java/com/hmdev/sdk/local/
    │   ├── SdkLocalServiceApplication.java
    │   ├── config/
    │   │   ├── CorsConfig.java
    │   │   └── WebSocketConfig.java
    │   ├── controller/
    │   │   ├── CloudConnectionController.java
    │   │   ├── HealthController.java
    │   │   ├── SftpController.java
    │   │   └── TerminalController.java
    │   ├── model/
    │   │   ├── AppConfig.java
    │   │   ├── SshConnection.java
    │   │   └── TerminalSession.java
    │   ├── repository/
    │   │   ├── AppConfigRepository.java
    │   │   ├── SshConnectionRepository.java
    │   │   └── TerminalSessionRepository.java
    │   ├── service/
    │   │   └── TerminalService.java
    │   └── websocket/
    │       └── TerminalWebSocketHandler.java
    └── resources/
        └── application.properties
```

---

## 🔧 Configuration

Edit `application.properties`:

```properties
# Server
server.port=8088

# H2 Database
spring.datasource.url=jdbc:h2:file:./sls-data

# Command Execution
sls.command.timeout=30000
sls.command.maxConcurrent=10

# Session Management
sls.session.maxActive=50
sls.session.timeout=3600000
```

---

## 🧪 Testing

### Test SLS API

```bash
# Start SLS
./gradlew bootRun

# In another terminal:

# Create SSH connection
curl -X POST http://localhost:8088/ssh/connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-server",
    "host": "localhost",
    "port": 22,
    "username": "admin",
    "password": "secret"
  }'

# Get all connections
curl http://localhost:8088/ssh/connections

# Spawn local terminal
curl -X POST http://localhost:8088/terminal/spawn \
  -H "Content-Type: application/json" \
  -d '{"shell":"bash"}'

# Response: {"sessionId":"abc-123",...}
```

### Test Web Interface

1. Start SLS: `./gradlew bootRun` (port 8088)
2. Start web-sdk-server: `cd ../web-sdk-server && ./gradlew bootRun` (port 8090)
3. Open browser: http://localhost:8090/examples/terminal/
4. Click "New Local Terminal" or add SSH connection

---

## 🐛 Troubleshooting

### SLS won't start
- Check if port 8088 is available
- Check Java version (requires Java 11+)
- Check logs in `./logs/sls.log`

### Terminal not connecting
- Verify SLS is running on port 8088
- Check browser console for errors
- Verify WebSocket connection

### SSH connection fails
- Verify SSH server is accessible
- Check username/password
- Test SSH manually: `ssh user@host`

---

## 📝 Notes

- H2 database is created automatically on first run at `./sls-data.mv.db`
- Passwords and private keys are stored in H2 (consider encryption for production)
- PTY (pty4j) is used for local terminals
- JSch is used for SSH connections
- WebSocket is used for real-time terminal output

---

## 🎯 Features

✅ Local terminal spawning (bash, cmd, PowerShell)  
✅ SSH connection management (saved to H2 database)  
✅ Interactive terminal (xterm.js)  
✅ Real-time output streaming (WebSocket)  
✅ Session persistence (H2 database)  
✅ Multiple concurrent sessions  
✅ Terminal resizing  
✅ Password and private key authentication  

---

**Ready to use!** 🚀

