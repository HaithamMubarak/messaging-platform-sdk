# Mini Games Server - Quick Start

## 🚀 Starting the Server

```bash
cd C:\Users\admin\dev\messaging\messaging-platform-sdk
gradlew.bat :agents:examples:mini-games-server:bootRun
```

## 🌐 Accessing the Games

Once the server is running, open your browser:

### Main Portal
**URL:** http://localhost:8090/

This shows the game selection page with three available games.

### Individual Games

1. **⚡ Reaction Speed Battle**
   - **URL:** http://localhost:8090/reaction-game/
   - Test your reflexes!

2. **🧠 Quiz Battle**
   - **URL:** http://localhost:8090/quiz-battle/
   - Answer trivia questions!

3. **🎨 Real-Time Whiteboard**
   - **URL:** http://localhost:8090/whiteboard/
   - Draw together in real-time!

### API Endpoints

- **Config:** http://localhost:8090/app/api/config
- **Games List:** http://localhost:8090/app/api/games
- **Health:** http://localhost:8090/app/api/health

## ✅ What Was Fixed

The server now properly serves:
- ✅ Root page (`/`) → shows game portal
- ✅ Static HTML pages for each game
- ✅ JavaScript files
- ✅ API endpoints

All 404 errors have been resolved!

## 🛠️ Configuration

**Port:** 8090 (configurable in `application.properties`)
**Context Path:** `/`
**CORS:** Enabled for all origins (development mode)

## 📝 Notes

- The server will start on port 8090
- All static content is served from `src/main/resources/static/`
- CORS is enabled for testing; restrict in production
- Cache is disabled for development (changes refresh immediately)

Enjoy the games! 🎮

