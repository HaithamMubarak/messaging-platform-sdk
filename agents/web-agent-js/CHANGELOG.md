# Changelog

All notable changes to the Web Agent JavaScript SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-21

### Added
- 🎉 **Initial release** of Web Agent JavaScript SDK
- Core SDK files:
  - `web-agent.js` - AgentConnection class for channel communication
  - `web-agent.webrtc.js` - WebRTC P2P data channels support
  - `web-agent.libs.js` - Encryption libraries (RSA, AES, MD5)
- Utility files:
  - `config-loader.js` - Automatic API configuration loading
  - `mini-game-utils.js` - Helper utilities for multiplayer games
  - `share-modal.js` - Beautiful sharing UI with QR codes
- UI Components:
  - Connection modal styles (`mini-games-connection.css`)
  - Share modal styles (`share-modal.css`)
  - Common styles (`common.css`)
  - Icon styles (`icons.css`)
- Documentation:
  - Beautiful visual documentation (`index.html`)
  - Comprehensive README with examples
  - File structure visualization
- Features:
  - Real-time messaging via HTTP/WebSocket
  - Ultra-low latency P2P with WebRTC
  - Persistent channel storage API
  - Optional RSA + AES encryption
  - Automatic message deduplication
  - WebSocket auto-reconnection
  - QR code generation for easy sharing

### Documentation
- 📖 Complete API documentation for AgentConnection class
- 📖 WebRTCHelper class documentation
- 🎨 Interactive HTML documentation with syntax highlighting
- 💡 6 use case examples (games, chat, collaboration, dashboards, IoT, notifications)
- 🚀 Quick start guide with code examples
- 📋 File descriptions with sizes

### Developer Experience
- ✅ Standalone SDK (no external dependencies to include)
- ✅ Copy-paste ready code examples
- ✅ npm package metadata (`package.json`)
- ✅ Gradle build integration
- ✅ Follows same pattern as Java and Python agents

## [Unreleased]

### Planned
- TypeScript definitions (.d.ts files)
- npm package publishing
- CDN distribution
- More code examples
- Video tutorials
- Integration guides for popular frameworks (React, Vue, Angular)

---

## Version History

- **1.0.0** (2026-01-21) - Initial release

---

## Links

- [Documentation](index.html)
- [File Structure](file-structure.html)
- [GitHub Repository](https://github.com/your-org/messaging-platform-sdk)
- [Issue Tracker](https://github.com/your-org/messaging-platform-sdk/issues)

