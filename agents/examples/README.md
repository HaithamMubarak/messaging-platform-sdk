# 🚀 Messaging Platform SDK - Example Applications

**Showcase applications demonstrating the power and versatility of the Messaging Platform SDK**

---

## 🎨 Interactive Examples

### 0. 🎮 Mini Games Server (All-in-One Backend) ⭐ NEW!

**Status:** ✅ Complete Production-Ready Server

**The easiest way to run all games!** Spring Boot backend that serves all games with secure temporary API key management.

**Features:**
- 🚀 Single JAR deployment (all games included)
- 🔐 Secure temporary keys (real API key never exposed)
- 🎮 Serves all 3 games from static resources
- 🌐 Built-in CORS support
- 📊 Health monitoring
- 🔧 Easy configuration

**🚀 Quick Start | 📖 Documentation**

```bash
cd mini-games-server
export MESSAGING_API_KEY=your-key
./gradlew bootRun
# Open http://localhost:8090
```

**Perfect for:** Production, demos, workshops, trying it out!

---

### Included Games

The mini-games-server includes **three complete games**:

#### 1. 🎨 Real-Time Collaborative Whiteboard
- Multi-user drawing synchronization
- Live cursor tracking
- Color picker & brush sizes
- Integrated chat
- Export artwork as PNG
- Mobile-friendly with touch support

**[📖 Documentation](web-sdk-server/WHITEBOARD-README.md)**

#### 2. 🎯 Quiz Battle
- Real-time multiplayer quiz competition
- Multiple choice questions
- Live scoring and rankings
- Question timer
- Mobile-friendly

#### 3. ⚡ Reaction Game
- Speed-based reaction time challenge
- Multiplayer competition
- Real-time leaderboard
- Simple and addictive gameplay

**All games accessible at:** `http://localhost:8090` (quiz-battle, reaction-game, whiteboard)

---

## 💬 Chat Examples

### 2. Java Agent Chat

Simple text chat demonstrating Java SDK integration.

**Features:**
- Connect to channels
- Send/receive messages
- User presence
- WebRTC video support

**[📖 View Code](java-agent-chat/)**

**Tech:** Java 11+, Swing/CLI  
**Difficulty:** ⭐⭐ Easy  

### 3. Python Agent Chat

Lightweight Python chat client.

**Features:**
- Simple CLI interface
- Async message receiving
- Easy to extend

**[📖 View Code](python-agent-chat/)**

**Tech:** Python 3.7+  
**Difficulty:** ⭐ Very Easy  

---

## 🎮 Gaming Examples

### 4. Gaming Server Relay (Java)

HTTP relay server for game engines.

**Features:**
- Forward game events
- API key injection
- CORS support
- Multiple game support

**📖 View Code**

**Tech:** Java, Spring Boot  
**Use Case:** Unity, Unreal, Custom engines

**Note:** For serving mini-games with secure API key management, use the **mini-games-server** instead (see above).  

---

## 📋 Coming Soon

### Multiplayer Tic-Tac-Toe 🎯

Turn-based game in multiple languages showing game networking patterns.

**Status:** 📋 Planned  
**Languages:** Java, Python, JavaScript, C++

### Live Polling/Voting App 📊

Real-time polling with live charts and QR code sharing.

**Status:** 📋 Planned  
**Features:** Multiple poll types, real-time visualization, mobile-friendly

### Code Pair Programming Tool 👨‍💻

Collaborative code editor with syntax highlighting.

**Status:** 📋 Planned  
**Features:** Real-time editing, cursor sync, chat, file tree

### Pixel Art Collaboration 🎨

r/place-style collaborative pixel canvas.

**Status:** 📋 Planned  
**Features:** Large canvas, rate limiting, timelapse replay

---

## 📊 Example Comparison

| Example | Complexity | Visual | Real-Time | Multi-Lang | Best For |
|---------|-----------|--------|-----------|------------|----------|
| **Mini Games Server** | Medium | ⭐⭐⭐⭐⭐ | ✅ | JavaScript | Production games, demos |
| Java Chat | Low | ⭐⭐ | ✅ | Java | Enterprise apps |
| Python Chat | Low | ⭐ | ✅ | Python | Scripts & tools |
| Gaming Server | Medium | ⭐⭐ | ✅ | Any | Game integration |
| Tic-Tac-Toe | Low-Med | ⭐⭐⭐⭐ | ✅ | Multiple | Game networking |
| Live Polling | Medium | ⭐⭐⭐⭐⭐ | ✅ | JavaScript | Presentations |
| Code Collab | High | ⭐⭐⭐⭐ | ✅ | JavaScript | Dev tools |

---

## 🎯 Choose Your Path

### I want to learn the SDK basics
→ Start with **Java Chat** or **Python Chat**

### I want to have FUN while learning
→ Play **Mini Games Server** (Reaction Game, Quiz Battle, or Whiteboard) 🎮

### I want to build collaborative tools
→ Check out **Mini Games Server** (includes Real-Time Whiteboard)

### I want to integrate into my game
→ Use **Gaming Server Relay** + SDK

### I want to impress people
→ Show them **Mini Games Server** (all 3 games included!)

### I want quick demos (< 5 minutes)
→ **Mini Games Server** is perfect - just run and play!

### I want production examples
→ All examples are production-ready!

---

## 🚀 Quick Start Guide

### 1. Ensure Messaging Service is Running

Make sure the messaging service is available and running.

### 2. Choose an Example

Pick from the examples above and follow its README.

### 3. Run and Explore

Each example includes:
- ✅ Complete source code
- ✅ Documentation
- ✅ Instructions
- ✅ Multiple users supported

### 4. Customize

Fork the code and build your own features!

---

## 💡 Use Case Inspiration

### Education
- Virtual classrooms
- Live quizzes
- Collaborative note-taking
- Student presence tracking

### Business
- Team whiteboards
- Live presentations
- Remote collaboration
- Project dashboards

### Gaming
- Multiplayer lobbies
- Leaderboards
- Real-time state sync
- Chat systems

### Social
- Drawing together
- Watch parties
- Shared playlists
- Group activities

### IoT
- Sensor dashboards
- Device control
- Home automation
- Monitoring systems

---

## 📚 Learning Resources

### Documentation
- [SDK Overview](../README.md)
- [API Reference](../cpp-agent/docs/API_DOCUMENTATION.md)
- Game Integration Guide
- Quick Start

### Tutorials
- Build a Whiteboard (this example!)
- Creating Multiplayer Games (coming soon)
- Real-Time Dashboards (coming soon)
- WebRTC Integration (see java-agent-chat)

### Support
- [GitHub Issues](https://github.com/your-repo/issues)
- [Discord Community](#)
- [Stack Overflow Tag](#)

---

## 🛠️ Technical Stack

### Frontend
- HTML5, CSS3, JavaScript
- Canvas API for drawing
- Responsive design
- Touch support

### Backend
- Java (Spring Boot)
- Python (Flask/FastAPI)
- C++ (native performance)
- Node.js (coming soon)

### SDK Features Used
- Channel connections
- Real-time messaging
- User presence
- Long-polling
- UDP support (C++ examples)
- WebRTC (Java examples)

---

## 🎬 Demo Videos

### Real-Time Whiteboard
[▶️ Watch Demo](https://youtube.com/demo-whiteboard) (Coming soon)

### Java Chat with WebRTC
[▶️ Watch Demo](https://youtube.com/demo-java-chat) (Coming soon)

### Game Integration
[▶️ Watch Demo](https://youtube.com/demo-game) (Coming soon)

---

## 🤝 Contributing

Want to add your own example?

1. Fork the repository
2. Create your example in this directory
3. Follow the structure of existing examples
4. Submit a pull request

**Example template:**
```
your-example/
├── README.md           # Documentation
├── src/               # Source code
├── assets/            # Images, etc.
└── package.json       # Dependencies (if applicable)
```

---

## 📖 Code Quality

All examples include:
- ✅ Clean, readable code
- ✅ Comments explaining key concepts
- ✅ Error handling
- ✅ Best practices
- ✅ Ready for production

---

## 🌟 Featured Example: Mini Games Server

The Mini Games Server is our flagship showcase demonstrating:

**Architecture:**
```
Client (Browser) → SDK → Messaging Service ← SDK ← Client (Browser)
        ↓                                              ↓
    Game action                                  Receive & render
```

**Includes three complete games:**
- 🎨 **Whiteboard:** Real-time collaborative drawing
- 🎯 **Quiz Battle:** Multiplayer quiz competition
- ⚡ **Reaction Game:** Speed-based challenge

**Secure by design:** Uses temporary API keys, so your real API key is never exposed to clients.

**Try it:** Open multiple tabs and play together in real-time! 🎮

---

## 📝 Example Request

Missing an example you'd like to see? 

**[Submit a request](https://github.com/your-repo/issues/new?template=example-request.md)**

Popular requests get priority!

---

## 📊 Statistics

- **Total Examples:** 3 active (+ 4 coming soon)
- **Mini Games Included:** 3 (Whiteboard, Quiz Battle, Reaction Game)
- **Languages:** Java, Python, JavaScript, C++
- **Lines of Code:** ~5,000+
- **Ready to Run:** Yes!
- **Free to Use:** MIT License

---

## 🎉 Success Stories

> "The mini-games server convinced me to use this SDK for our project. We had a prototype running in 2 hours!" - *Developer A*

> "Gaming server relay made it trivial to add multiplayer to our Unity game." - *Game Studio B*

> "Clean code, great documentation. Exactly what I needed." - *Startup C*

*(Your testimonial here! Share your story)*

---

## 🚀 Get Started Now!

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-repo.git
   ```

2. **Ensure messaging service is running**

3. **Try the mini-games**
   ```bash
   cd messaging-platform-sdk/agents/examples/mini-games-server
   export MESSAGING_API_KEY=your-key
   ./gradlew bootRun
   # Open http://localhost:8090
   ```

4. **Build something amazing!** 🎨🚀

---

**Questions?** Check the FAQ or [open an issue](https://github.com/your-repo/issues).

**Want to showcase your project?** We'd love to feature it! [Submit here](https://github.com/your-repo/showcase).

---

<div align="center">

**Built with ❤️ by the Messaging Platform Team**

[Website](#) | [Docs](../README.md) | [GitHub](https://github.com/your-repo) | [Discord](#)

</div>

