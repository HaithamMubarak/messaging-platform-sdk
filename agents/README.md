# Messaging Agents

Agents are client-side programs that connect to the Messaging Service. This folder contains multiple agent implementations and examples.

## 🎮 Game Developer Integration

**New to the platform? Building a game?**

- 📘 **[Game Integration Guide](GAME-INTEGRATION-GUIDE.md)** - Complete guide with architecture, code examples, and recommendations
- ⚡ **[Quick Reference](GAME-INTEGRATION-QUICK-REF.md)** - Fast decision matrix and code snippets

**TL;DR:**
- **Java/Python/JavaScript games** → Use direct library integration (best performance)
- **C++/C#/Unity/Unreal games** → Use TCP server bridge (language agnostic)

---

## Documentation Index

Canonical documentation (this file) and per-agent sections are below:
- Root README: `../README.md`
- Services: `../services/README.md`
- Docker/dev: `../docker/README.md`

---

## Web Agent (browser UI)

The Web Agent is a browser-based interface for the Messaging API with advanced features including encrypted sharing, QR codes, and mobile optimization.

### Quick Usage
- **Main Interface**: Open `sdk/agents/web-agent/index.html` in your browser
- **Chat Interface**: `sdk/agents/web-agent/examples/chat.html` - Full-featured chat with sharing
- **WebRTC Demo**: `sdk/agents/web-agent/examples/webrtc-video-sender.html` - Video streaming test
- **TURN/STUN Test**: `sdk/agents/web-agent/examples/turn-stun-test.html` - Server verification

### ✨ Key Features (New)
- 🔐 **Encrypted Link Sharing** - Generate secure shareable links with auto-generated keys
- 🌐 **Public Link Sharing** - Quick non-encrypted sharing for trusted environments
- 📱 **QR Code Generation** - Instant QR codes for mobile device sharing (qrcodejs)
- 🔓 **Auto-decrypt URLs** - One-click channel joining via shared links (URL hash detection)
- ✅ **Visual Confirmation** - Green checkmark indicators for user actions
- ⌨️ **Keyboard Shortcuts** - ESC to close modals, Enter to confirm actions
- 📱 **Mobile-Responsive** - Collapsible sidebar with +173% more chat space
- 👥 **Real-time Agent List** - See all connected agents with visual indicators
- 🎨 **Modern UI** - Dark theme with gradients, smooth animations

### Authentication & Security
- Supports channel name + password, API key via header, or `channelId`-based auth
- Messages are encrypted client-side when using channel password
- End-to-end encryption with PBKDF2 key derivation (SHA-256)
- Server never decrypts payloads (stateless relay)
- Exposes an `AgentConnection` class for embedding in other pages

### Connecting Examples
- **Channel name + password**: Derive the secret locally, then call `connect()`
- **Channel name + API key**: Supply `apiKey` and optional `apiKeyHeaderName`
- **channelId + API key**: Use `channelId` to avoid exposing channel name/password
- **Shared link**: Click encrypted/public link → auto-connects via URL hash

### Docker Note
- For local end-to-end testing you can run the full compose stack from the repository `docker/` folder (recommended). See `../docker/README.md` for details.
- If you don't want to build the Messaging Service locally, a pre-built image is available on Docker Hub: `haithammubarak/messaging-platform:messaging-service`. Use the compose override pattern in `docker/README.md` to run the stack with the Hub image instead of building locally.

### Documentation
- 📚 **Complete Guide**: `sdk/agents/web-agent/README.md` - Comprehensive documentation (all features, quick start, troubleshooting)
- 📖 **Examples Guide**: `sdk/agents/web-agent/examples/README.md` - Usage examples and quick starts
- 🎥 **WebRTC Setup**: `docs/webrtc.md` - WebRTC configuration and troubleshooting

---

## Java Agent

The Java Agent is a client library and runnable example for connecting to the Messaging Service.

Features
- Derives channel secret from channel name + password and uses AES-CTR for payload encryption.
- Supports UDP bridge for low-latency push/pull operations.
- Configurable base URL, logging (Logback), and UDP port.

Quick run (example)
From the repository root:

```
gradlew.bat :sdk:agents:examples:java-agent-chat:run --args="--channel=system001 --password=12345678 --agent-name=java-agent-example-001"
```

---

## C++ Agent

The C++ Agent is a native, high-performance client library for the Messaging Platform, ideal for game development and embedded systems.

### Features
- 🚀 **High Performance** - Native C++17 implementation with minimal overhead
- 🔌 **HTTP & UDP Support** - Reliable HTTP and fast UDP messaging
- 🔒 **Built-in Security** - SHA-256 hashing, HMAC, channel secret derivation
- 🎮 **Game-Ready** - Optimized for real-time game networking (60+ FPS)
- 🌍 **Cross-Platform** - Linux, macOS, Windows support
- 📦 **Minimal Dependencies** - Only libcurl, OpenSSL, and nlohmann/json

### Quick Start

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get install build-essential cmake libcurl4-openssl-dev libssl-dev nlohmann-json3-dev

# Build
cd agents/cpp-agent
./build.sh

# Run example
./build/examples/basic_chat_example http://localhost:8080 your_api_key
```

### Example Code

```cpp
#include "hmdev/messaging/api/messaging_channel_api.h"

using namespace hmdev::messaging;

int main() {
    MessagingChannelApi api("http://localhost:8080", "your_api_key");
    
    ConnectResponse resp = api.connect("room", "password", "player-1");
    if (resp.success) {
        api.send(EventType::CHAT_TEXT, "Hello from C++!", "*", resp.sessionId, false);
        api.disconnect(resp.sessionId);
    }
    
    return 0;
}
```

### Documentation
- 📘 **README**: `agents/cpp-agent/README.md` - Complete user guide
- ⚡ **Quick Start**: `agents/cpp-agent/QUICK_START.md` - 5-minute setup
- 📖 **API Docs**: `agents/cpp-agent/docs/API_DOCUMENTATION.md` - Detailed API reference
- 💡 **Examples**: `agents/cpp-agent/examples/` - Working code examples

### Performance
- **HTTP**: 10-50ms latency, 100% reliable
- **UDP**: 1-5ms latency, ~95-99% reliable
- **Throughput**: 10,000+ messages/second (UDP)

### Use Cases
- C++ game engines (Unreal, custom engines)
- Real-time multiplayer games
- Embedded systems and IoT
- High-performance applications

---

## Python Agent

The Python Agent package provides a lightweight scripting client for the Messaging Service.

Notes
- The project includes a minimal TCP-only control entrypoint (see `hmdev/messaging/agent/agent.py`) used by local tooling.
- Use the example in `sdk/agents/examples/python-agent-chat` to test interactive flows.

Quick run (example)

```
cd /d C:\Users\admin\dev\messaging-platform\sdk\agents\examples\python-agent-chat
python chat_example.py --url http://localhost:8082/messaging-platform/api/v1/messaging-service --channel system001 --password 12345678 --agent-name python-agent-example-001
```

---

## Examples

This repository contains runnable examples demonstrating agent behavior:
- Java chat demo: `sdk/agents/examples/java-agent-chat`
- Python chat demo: `sdk/agents/examples/python-agent-chat`

Example notes
- The Python example uses a local path reference to the `python-agent` folder in `requirements.txt` for development installs.
- The Java example accepts an `--api-key` argument to include a developer API key in requests.

---

## Selenium tests (automation)

There is a pytest-based Selenium test suite in `sdk/agents/selenium-tests` for automating basic connect flows and simple integration checks. Quick run:

```
cd sdk/agents/selenium-tests
python -m pytest -q
```

Prerequisites
- Python 3.8+
- Install test dependencies (`requirements.txt`) and a browser driver (e.g. `chromedriver`) on PATH.
- Messaging service reachable (tests assume local defaults, or adjust environment variables).

---

## Developer notes & where to look
- For service URLs and run instructions see the root `README.md` and `services/README.md`.
- For Docker-based local setup and SSH tunnel helpers see `docker/README.md`.

(This `sdk/agents/README.md` is now the canonical agents index; per-project READMEs in agent subfolders have been merged into this file and replaced with pointers.)
