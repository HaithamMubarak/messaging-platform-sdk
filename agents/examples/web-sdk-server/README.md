# 🎮 Mini Games Server

**Spring Boot backend serving interactive multiplayer games with secure temporary API key management.**

> **📁 Resource Organization:** This module uses a clean separation between SDK files (copied at build time to `static/generated/`) and demo-specific files (in `static/js/` and `static/css/`). See [ORGANIZATION-SUMMARY.md](ORGANIZATION-SUMMARY.md) for details.

---

## ✨ Features

- 🎮 **3 Interactive Multiplayer Games** served from static resources
- 🔐 **Secure Temporary Keys** - Real API key never exposed to browsers
- 🚀 **Production Ready** - Built with Spring Boot
- 📦 **Single JAR Deployment** - All games bundled
- 🌐 **CORS Enabled** - Works with any frontend
- 💉 **Automatic API Key Injection** - No manual configuration in games
- 📊 **Health Checks** - Monitor service status

---

## 🎯 Games Included

### 1. ⚡ Reaction Speed Battle
- Test your reflexes in multiplayer
- Click when box turns green
- Real-time leaderboard

### 2. 🧠 Quiz Battle
- Answer trivia questions
- Speed-based scoring
- 10 diverse questions

### 3. 🎨 Real-Time Whiteboard
- Collaborative drawing
- Live cursor tracking
- Export artwork

---

## 🚀 Quick Start

### Prerequisites

1. **Java 11+** installed
2. **Messaging Service** running (localhost:8080)
3. **Developer API Key** (optional but recommended)

### 1. Set Environment Variable

```bash
# Set your developer API key
export MESSAGING_API_KEY="your-developer-api-key-here"

# Or in Windows
set MESSAGING_API_KEY=your-developer-api-key-here
```

### 2. Build the Project

```bash
cd mini-games-server
./gradlew build
```

### 3. Run the Server

```bash
./gradlew bootRun

# Or run the JAR directly
java -jar build/libs/mini-games-server.jar
```

### 4. Access Games

Open your browser to:
- **Portal:** http://localhost:8090/
- **Reaction Game:** http://localhost:8090/reaction-game/
- **Quiz Battle:** http://localhost:8090/quiz-battle/
- **Whiteboard:** http://localhost:8090/whiteboard/

---

## 🔧 Configuration

### application.properties

```properties
# Server port (default: 8090)
server.port=8090

# Messaging Service URL
minigames.messaging-service-url=${MESSAGING_SERVICE_URL:http://localhost:8080}

# Developer API Key (from environment)
minigames.api-key=${MESSAGING_API_KEY:}

# Temporary key TTL in seconds (default: 1 hour)
minigames.default-temp-key-ttl=3600

# CORS configuration
minigames.cors-enabled=true
minigames.cors-allowed-origins=*
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MESSAGING_SERVICE_URL` | Messaging service API URL | http://localhost:8080 |
| `MESSAGING_API_KEY` | Your developer API key | (none) |
| `SERVER_PORT` | Port to run on | 8090 |

**Note:** WebRTC ICE servers (STUN/TURN) are automatically provided by the messaging service via the `/api/config` endpoint.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│          Browser (Game Client)              │
│                                             │
│  1. Load game HTML                          │
│  2. Fetch /api/config → Get temp key       │
│  3. Connect to channel → Get ICE servers   │
│  4. Use ICE servers for WebRTC (if needed) │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│       Mini Games Server (Port 8090)         │
│                                             │
│  Spring Boot Backend:                       │
│  - Serves static games                      │
│  - Handles /api/config endpoint             │
│  - Creates temporary keys                   │
│  - Never exposes real API key               │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│    Messaging Service (Port 8080)            │
│                                             │
│  - Creates temp keys via /api-access        │
│  - Handles channel connections (/connect)   │
│  - Provides ICE servers in connect response │
│  - Real-time message routing                │
└─────────────────────────────────────────────┘
```

---

## 🔐 Security Model

### Why Temporary Keys?

**Problem:** Exposing your developer API key in browser JavaScript is insecure.

**Solution:** The server creates temporary keys with:
- ✅ Limited lifetime (1 hour default)
- ✅ Restricted permissions
- ✅ Can be single-use
- ✅ Real key stays on server

### How It Works

1. **Browser requests config:**
   ```javascript
   fetch('/api/config', {method: 'POST'})
   ```

2. **Server creates temp key:**
   ```java
   // Using your real API key
   POST /temp-keys
   X-Api-Key: your-real-key
   
   // Returns temporary key
   {"temporaryKey": "temp_abc123...", "ttlSeconds": 3600}
   ```

3. **Browser uses temp key:**
   ```javascript
   fetch('http://localhost:8080/connect', {
       headers: {'X-Api-Key': 'temp_abc123...'}
   })
   ```

4. **Temp key expires after 1 hour**

---

## 📡 API Endpoints

### GET /
Main portal listing all games

### GET /api/config
**POST /api/config**
Get API configuration with temporary key

**Request:**
```json
{
  "ttlSeconds": 3600,
  "singleUse": false
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "apiUrl": "http://localhost:8080",
    "temporaryKey": "temp_abc123...",
    "ttlSeconds": 3600,
    "singleUse": false,
    "expiresAt": "2025-12-30T15:00:00Z"
  }
}
```

### GET /api/games
List available games

### GET /api/health
Health check

**Response:**
```json
{
  "status": "UP",
  "service": "mini-games-server",
  "version": "1.0.0",
  "messagingService": "UP",
  "messagingServiceUrl": "http://localhost:8080"
}
```

---

## 🎮 Game Integration

### How Games Use the SDK

All games include `mini-games-sdk.js`:

```html
<script src="/mini-games-sdk.js"></script>
<script src="game.js"></script>
```

In your game code:

```javascript
// Load API config with temp key
const config = await window.miniGamesSDK.loadConfig();

// Use the config
const API_URL = config.apiUrl;
const apiKey = config.apiKey;

// Connect to messaging service
fetch(`${API_URL}/connect`, {
    headers: {
        'X-Api-Key': apiKey
    },
    body: JSON.stringify({...})
});
```

### No API Key in Game UI

Notice: Games no longer have API key input fields!

**Before:**
```html
<input type="text" placeholder="API Key" id="apiKeyInput">
```

**After:**
```html
<!-- No API key field - handled automatically! -->
```

---

## 📁 Project Structure

```
mini-games-server/
├── build.gradle                    # Gradle build config
├── settings.gradle
├── src/main/
│   ├── java/com/hmdev/messaging/minigames/
│   │   ├── MiniGamesApplication.java         # Main app
│   │   ├── controller/
│   │   │   └── ApiController.java            # API endpoints
│   │   ├── config/
│   │   │   ├── MiniGamesProperties.java      # Configuration
│   │   │   └── WebConfig.java                # CORS config
│   │   ├── service/
│   │   │   └── MessagingServiceClient.java   # Temp key creation
│   │   └── dto/
│   │       ├── JsonResponse.java
│   │       ├── ApiConfigResponse.java
│   │       └── CreateTemporaryKeyRequest.java
│   └── resources/
│       ├── application.properties             # App config
│       └── static/                            # Static web files
│           ├── index.html                     # Game portal
│           ├── mini-games-sdk.js              # SDK helper
│           ├── reaction-game/
│           │   ├── index.html
│           │   └── reaction-game.js
│           ├── quiz-battle/
│           │   ├── index.html
│           │   └── quiz-battle.js
│           └── whiteboard/
│               ├── index.html
│               └── whiteboard-client.js
└── README.md (this file)
```

---

## 🔨 Development

### Build

```bash
./gradlew build
```

### Run in development

```bash
./gradlew bootRun
```

### Run with custom port

```bash
SERVER_PORT=9090 ./gradlew bootRun
```

### Create executable JAR

```bash
./gradlew bootJar
# Creates: build/libs/mini-games-server.jar
```

---

## 🚀 Deployment

### Option 1: Run JAR directly

```bash
java -jar mini-games-server.jar \
  -DMESSAGING_API_KEY=your-key \
  -DMESSAGING_SERVICE_URL=https://your-server.com
```

### Option 2: Systemd Service

```ini
[Unit]
Description=Mini Games Server
After=network.target

[Service]
Type=simple
User=games
Environment="MESSAGING_API_KEY=your-key"
Environment="MESSAGING_SERVICE_URL=http://localhost:8080"
ExecStart=/usr/bin/java -jar /opt/mini-games/mini-games-server.jar
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

---

## 🧪 Testing

### Test locally

```bash
# Ensure messaging service is running at http://localhost:8080

# Start mini-games-server
cd mini-games-server
MESSAGING_API_KEY=test-key ./gradlew bootRun

# Open browser
open http://localhost:8090
```

### Test endpoints

```bash
# Health check
curl http://localhost:8090/api/health

# Get API config
curl -X POST http://localhost:8090/api/config \
  -H "Content-Type: application/json" \
  -d '{"ttlSeconds": 3600}'

# List games
curl http://localhost:8090/api/games
```

---

## 🐛 Troubleshooting

### Problem: "Failed to create temporary key"

**Cause:** Messaging service not available or invalid API key

**Solution:**
1. Check messaging service is running: `curl http://localhost:8080/health`
2. Verify API key is set: `echo $MESSAGING_API_KEY`
3. Check logs: `tail -f logs/mini-games-server.log`

### Problem: Games can't connect

**Cause:** CORS or API URL mismatch

**Solution:**
1. Check browser console for errors
2. Verify `MESSAGING_SERVICE_URL` is correct
3. Check CORS settings in `application.properties`

### Problem: No API key configured warning

**Cause:** `MESSAGING_API_KEY` not set

**Solution:**
```bash
export MESSAGING_API_KEY=your-key-here
```

**Note:** Games will still work without API key if messaging service allows anonymous access.

---

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:8090/api/health
```

Returns service status and messaging service availability.

### Logs

Located in `logs/` directory (if configured).

Check for:
- `Created temporary key with ttl: Xs`
- `Failed to create temporary key: ...`
- API request errors

---

## 🎓 How This Compares to Web Agent

This project follows the **same pattern** as `web-agent`:

| Feature | Web Agent | Mini Games Server |
|---------|-----------|-------------------|
| **Backend** | Spring Boot ✅ | Spring Boot ✅ |
| **Temp Keys** | `/api/config` ✅ | `/api/config` ✅ |
| **Static Files** | `src/main/resources/static` ✅ | `src/main/resources/static` ✅ |
| **Security** | Real key hidden ✅ | Real key hidden ✅ |
| **CORS** | Enabled ✅ | Enabled ✅ |

**Key Difference:** Mini Games Server serves multiple games, Web Agent serves one app.

---

## 🎉 Benefits

### For Developers
- ✅ No API key in browser code
- ✅ Single deployment (backend + frontend)
- ✅ Production-ready security
- ✅ Easy to add more games

### For Users
- ✅ No login required
- ✅ Just enter room name and play
- ✅ Works on any device
- ✅ Secure connections

### For Operations
- ✅ Single JAR to deploy
- ✅ Health monitoring
- ✅ Easy configuration
- ✅ Scalable architecture

---

## 📖 Related Documentation

- [Messaging Platform SDK](../../README.md)
- [Web Agent Example](../../agents/web-agent/README.md)
- [Game Examples](../GAMES-README.md)
- [Temporary Keys Guide](../../agents/web-agent/TEMPORARY-KEY-INTEGRATION.md)

---

## 🤝 Contributing

Want to add a new game?

1. Create game HTML/JS in `src/main/resources/static/your-game/`
2. Use `mini-games-sdk.js` for API config
3. Update `ApiController.listGames()` to include your game
4. Update `static/index.html` to show your game card
5. Submit a pull request!

---

## 📝 License

Same as main Messaging Platform SDK (MIT License)

---

## 🎊 Summary

This server provides:
- 🎮 **3 ready-to-play multiplayer games**
- 🔐 **Secure temporary key management**
- 🚀 **Production-ready Spring Boot backend**
- 📦 **Single JAR deployment**
- 🌐 **No CORS issues**
- 💉 **Automatic API key injection**

**No more exposing API keys in browser code!** 🔒

---

**Built with ❤️ for the Messaging Platform SDK**

**Questions?** Check the [main README](../../README.md) or open an issue.

