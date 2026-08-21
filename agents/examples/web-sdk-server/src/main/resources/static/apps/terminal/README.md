# Messaging Platform - Shared Terminal

A modern web-based terminal emulator with real-time collaboration features, SSH support, file management, and integrated code editing capabilities.

**Live App:** [https://hmdevonline.com/messaging-platform/sdk/apps/terminal/app.html](https://hmdevonline.com/messaging-platform/sdk/apps/terminal/app.html) *(requires SDK Local Service running)*

**GitHub:** [Terminal App Source Code](https://github.com/HaithamMubarak/messaging-platform-sdk/tree/main/agents/examples/web-sdk-server/src/main/resources/static/apps/terminal)

---

## 🎯 Overview

The Shared Terminal is a full-featured web terminal that runs in the browser while executing commands on your local machine or remote servers. It combines the power of a native terminal with the convenience of web technologies and adds real-time collaboration features.

### Key Capabilities
- 🖥️ **Local Terminal Sessions** - Execute shell commands on your local machine
- 🔐 **SSH Connection Management** - Connect to remote servers with saved profiles
- 🤝 **Real-time Terminal Sharing** - Share your terminal with others via WebRTC
- 📁 **File System Browser** - Browse and manage files with SFTP support
- ✏️ **Integrated Code Editor** - Edit files with syntax highlighting
- 📝 **Notes Management** - Create and organize markdown notes
- 💾 **Session Persistence** - Auto-save and restore terminal sessions
- 🎨 **Modern UI** - Clean, responsive dark interface using the site's shared design tokens

---

## 🏗️ Architecture

### Frontend (This Application)
**Location:** `/apps/terminal`  
**Port:** 8084 (via web-sdk-server)  
**Technology Stack:**
- xterm.js 5.x - Terminal emulator
- CodeMirror 5.65.x - Code editor
- Vanilla JavaScript - No framework dependencies
- CSS3 with CSS Variables - Theming system
- WebRTC - Peer-to-peer terminal sharing
- WebSocket - Real-time terminal I/O

### Backend (SDK Local Service)
**Location:** `/agents/examples/sdk-local-service`  
**Port:** 8088  
**GitHub:** [SDK Local Service](https://github.com/HaithamMubarak/messaging-platform-sdk/tree/main/agents/examples/sdk-local-service)

Provides:
- Terminal process management
- SSH connection handling
- File system operations
- Session persistence (H2 database)
- Token-based security

### Communication Flow
```
Browser (Terminal App - port 8084)
    ↓ HTTP/WebSocket
SDK Local Service (port 8088)
    ↓ Process/SSH
Local Shell or Remote Server
```

---

## 📂 File Structure

### Core Files

#### HTML
- **`index.html`** (1,871 lines)
  - Main application structure
  - Modal dialogs (SSH, Settings, About, Help, Share)
  - Context menus (session, tab, viewer)
  - Cloud connection UI
  - All UI components and layouts

#### JavaScript

- **`terminal.js`** (8,819 lines) - Main application logic
  - Terminal session management
  - SSH connection handling
  - WebSocket communication with backend
  - Real-time terminal sharing (WebRTC)
  - Tab management and drag-drop
  - Settings and configuration
  - File operations coordination

- **`terminal-sharing.js`** (~600 lines) - Terminal sharing logic
  - WebRTC peer connection management
  - Terminal output synchronization
  - Permission management (read-only/read-write)
  - Multi-viewer support
  - Session owner controls

- **`file-explorer.js`** (~800 lines) - File browser
  - Directory tree navigation
  - File/folder operations (create, delete, rename, chmod)
  - SFTP integration for remote sessions
  - Context menu actions
  - Upload/download coordination

- **`file-editor.js`** (~600 lines) - Code editor
  - Multi-tab file editing
  - CodeMirror integration
  - Syntax highlighting (15+ languages)
  - Save/close/switch file operations
  - Remote file editing via SLS

- **`note-editor.js`** (~400 lines) - Notes management
  - Markdown note creation/editing
  - Note list and organization
  - Auto-save functionality
  - CodeMirror markdown mode

- **`FileTransferProxy.js`** (~300 lines) - File transfer handling
  - Chunked file upload/download
  - Progress tracking
  - Local and remote file operations
  - Large file support

- **`storage-manager.js`** (~200 lines) - Local storage management
  - Centralized localStorage wrapper
  - Session data persistence
  - Settings storage
  - Cache management

#### CSS

- **`terminal.css`** - Main application styles
  - Layout and grid system
  - Terminal styling
  - Tab bar and sidebar
  - Responsive design
  - Theme variables

- **`file-explorer.css`** - File browser styles
  - Tree view styling
  - File icons
  - Context menu
  - Action buttons

- **`file-editor.css`** - Code editor styles
  - Multi-tab layout
  - Editor container
  - Toolbar buttons

- **`note-editor.css`** - Notes editor styles
  - Note list styling
  - Editor layout
  - Markdown preview

### Supporting Files

- **`manifest.json`** - PWA manifest for installable app
- **`service-worker.js`** - PWA service worker for offline support
- **`icons/`** - App icons for PWA (192x192, 512x512)
- **`lib/`** - Third-party libraries
  - xterm.js and addons
  - CodeMirror core and modes
- **`libs/`** - Additional libraries (QR code, etc.)

---

## ✨ Features

### Terminal Management

#### Local Terminals
- Spawn local shell (CMD, PowerShell, Bash, Zsh)
- Multiple concurrent sessions
- Tab-based interface with drag & drop
- Session persistence and auto-restore
- Terminal resize and auto-fit
- Copy/paste support (right-click menu)
- Custom font sizes (Ctrl+= / Ctrl+-)
- Application shortcuts: Ctrl+Shift+T new tab, Ctrl+Shift+W close tab, Ctrl+PgUp/PgDn cycle tabs

#### SSH Connections
- Save SSH connection profiles
- Username/password authentication
- SSH key (private key) authentication
- Connection testing before saving
- Quick connect from saved profiles
- SFTP automatic integration
- Session reconnection

#### Terminal Sharing
- Share terminal with others in real-time
- Generate shareable links with QR codes
- Read-only or read-write permissions
- Multiple simultaneous viewers
- Owner controls (upgrade/downgrade permissions)
- WebRTC peer-to-peer connections
- Cloud connection status indicators
- Automatic session cleanup

### File Management

#### File Explorer
- Browse local and remote file systems
- Tree view navigation
- Create files and directories
- Delete, rename, move operations
- File upload/download
- Drag & drop file upload
- Chunked transfer for large files

#### Code Editor
- Multi-tab file editing
- Syntax highlighting for 15+ languages:
  - JavaScript, TypeScript, Python, Java, C/C++
  - PHP, Ruby, Go, Swift, Rust
  - HTML, CSS, Markdown, YAML, SQL
  - Shell scripts, Properties files
- CodeMirror features:
  - Bracket matching
  - Auto-close brackets
  - Active line highlighting
  - Search and replace
  - Match highlighting
  - Line numbers

#### Notes
- Create markdown notes
- Rich text editing with CodeMirror
- File-based storage
- Quick note creation
- Note renaming and deletion
- Integrated with file system

### User Interface

#### Multi-Tab System
- Up to 20 concurrent tabs
- Middle-click to close a tab
- Tab context menu:
  - Close tab, Close others, Close to right/left
  - Close all tabs
  - Rename tab
  - Share terminal
  - Request permission (for shared sessions)
- Tab indicators:
  - Session type icons (local, SSH, shared)
  - Permission badges (read-only, read-write)
  - Shared session indicators

#### Sidebar
- Collapsible sidebar
- Multiple panels:
  - **Sessions** - Saved SSH connections
  - **Agents** - Connected viewers (when sharing)
  - **My Shares** - Your shared terminals
- Context menus for quick actions
- Session information display

#### Modal Dialogs
- **SSH Connection** - Add/edit SSH profiles
- **Settings** - Configure SLS port, backup/restore
- **Help** - Installation guide and setup instructions
- **About** - App information and GitHub links
- **Share Terminal** - Cloud connection and sharing options

#### Responsive Design
- Mobile-friendly layout
- Touch-optimized controls
- Hamburger menu for mobile
- Adaptive sidebar
- Portrait/landscape support

### Configuration & Backup

#### Settings
- Configure SDK Local Service port
- Import/export configuration
- Three backup formats:
  - Plain XML
  - Compressed ZIP
  - Password-protected ZIP (AES-256)
- Backup includes:
  - SSH connection profiles
  - Application settings
  - Optional: Notes, terminal sessions

#### Storage
- LocalStorage for client settings
- H2 database (backend) for:
  - SSH connection profiles
  - Terminal session metadata
  - Application configuration
- Session persistence across page reloads
- Automatic cleanup of closed sessions

---

## 🔧 Technologies

### Frontend Libraries

#### Terminal Emulation
- **xterm.js 5.x** - Full-featured terminal emulator
  - VT100/xterm escape sequences
  - 256 color support
  - Unicode support
  - Terminal addons:
    - `xterm-addon-fit` - Auto-sizing

#### Code Editor
- **CodeMirror 5.65.x** - Versatile text editor
  - 15+ language modes
  - Syntax highlighting
  - Code folding
  - Search & replace
  - Addons:
    - Match brackets
    - Auto-close brackets
    - Active line highlighting
    - Search cursor
    - Match highlighter

#### UI & Utilities
- **QRCode.js** - QR code generation for sharing
- **Vanilla JavaScript** - No framework overhead
- **CSS3 Variables** - Dynamic theming
- **Web APIs:**
  - WebSocket - Real-time terminal I/O
  - WebRTC - Peer-to-peer sharing
  - LocalStorage - Client-side persistence
  - Fetch API - HTTP requests
  - FileReader API - File upload
  - Blob API - File download

### Backend Integration

#### SDK Local Service APIs
- **REST API** - Terminal and SSH management
- **WebSocket** - Real-time terminal streams
- **Token-based Auth** - Security via X-SLS-Token header

#### Messaging Platform SDK
- **WebAgent** - Cloud connection management
- **WebRTC** - Peer-to-peer data channels
- **STOMP** - Messaging protocol

---

## 📦 Installation

The terminal app requires **TWO components** working together:

1. **PWA (Progressive Web App)** - Frontend application (caches HTML/CSS/JS files)
2. **SDK Local Service** - Backend service (executes commands on your local machine)

> **Important:** Both are required! The PWA provides the user interface, while SDK Local Service enables interaction with your local environment (Bash, CMD, PowerShell, SSH, etc.)

---

### Step 1: Install PWA (Frontend Application)

**Purpose:** Provides the web-based terminal interface  
**What it does:** Caches app files (HTML, CSS, JavaScript) for offline access and native app experience

#### Desktop Installation (Chrome, Edge, Opera)

1. **Access the App:**
   ```
   https://hmdevonline.com/messaging-platform/sdk/apps/terminal/app.html
   ```

2. **Install Options:**
   
   **Method A - Install Button:**
   - Look for the install icon (⊕) in the address bar
   - Click it and select "Install"
   
   **Method B - Menu:**
   - Click browser menu (⋮)
   - Select "Install Terminal App" or "Install Messaging Platform"
   - Click "Install" in the dialog
   
   **Method C - App Menu:**
   - Click "Install" in the top menu bar of the app
   - Follow the installation wizard

3. **Launch Installed App:**
   - Find "Messaging Platform - Terminal" on your desktop
   - Or search in Start Menu (Windows) / Applications (Mac/Linux)
   - App opens in standalone window

#### Mobile Installation (iOS)

1. **Open Safari:**
   ```
   https://hmdevonline.com/messaging-platform/sdk/apps/terminal/app.html
   ```

2. **Add to Home Screen:**
   - Tap the Share button (□↑)
   - Scroll down and tap "Add to Home Screen"
   - Edit name if desired
   - Tap "Add"

3. **Launch App:**
   - Find app icon on home screen
   - Tap to open in fullscreen mode

#### Mobile Installation (Android)

1. **Open Chrome:**
   ```
   https://hmdevonline.com/messaging-platform/sdk/apps/terminal/app.html
   ```

2. **Install Options:**
   
   **Method A - Banner:**
   - Look for "Add to Home screen" banner at bottom
   - Tap "Install" or "Add"
   
   **Method B - Menu:**
   - Tap menu (⋮)
   - Select "Add to Home screen" or "Install app"
   - Tap "Install"

3. **Launch App:**
   - Find app icon in app drawer
   - Tap to open

#### PWA Benefits
- ✅ **Offline Support** - App files cached locally
- ✅ **Auto-Updates** - Automatically updates to latest version
- ✅ **Native Feel** - Standalone window without browser UI
- ✅ **Fast Loading** - Cached resources load instantly
- ✅ **Desktop/Mobile** - Works like a native app

---

### Step 2: Install SDK Local Service (Backend Service)

**Purpose:** Enables local system access and command execution  
**What it does:** 
- Executes shell commands (Bash, CMD, PowerShell, Zsh)
- Manages SSH connections to remote servers
- Handles file system operations (SFTP, local files)
- Provides REST API and WebSocket for terminal I/O
- Runs on **localhost:8088** (your machine only)

#### Download Pre-built JAR

**Official Download:**
```
https://raw.githubusercontent.com/HaithamMubarak/messaging-platform-sdk/develop/agents/examples/sdk-local-service/build/libs/sdk-local-service.jar
```

**Alternative (GitHub Releases):**
```
https://github.com/HaithamMubarak/messaging-platform-sdk/releases
```

#### Run the Service

1. **Ensure Java 11+ is installed:**
   ```bash
   java -version
   ```
   
   If not installed, download from: https://adoptium.net/

2. **Run SDK Local Service:**
   ```bash
   java -jar sdk-local-service.jar
   ```

3. **Service starts on:**
   ```
   http://localhost:8088
   ```
   
   You should see:
   ```
   SDK Local Service started on port 8088
   ✓ Terminal API ready
   ✓ WebSocket enabled
   ✓ Security: Token-based authentication
   ```

4. **Keep it running:**
   - Leave this terminal window open
   - Or run as system service (see below)

#### Configuration Options

**View Default Configuration:**

See all available configuration options in <a href="https://raw.githubusercontent.com/HaithamMubarak/messaging-platform-sdk/develop/agents/examples/sdk-local-service/src/main/resources/application.properties" target="_blank">application.properties</a>

**Custom Port:**
```bash
java -jar sdk-local-service.jar --server.port=9090
```

**Custom Data Directory:**
```bash
java -jar sdk-local-service.jar --sls.data.directory=/custom/path
```

**Background Mode (Linux/Mac):**
```bash
nohup java -jar sdk-local-service.jar > sls.log 2>&1 &
```

**View All Options:**
```bash
java -jar sdk-local-service.jar --help
```

#### Run as System Service (Optional)

**Linux (systemd):**
```bash
sudo nano /etc/systemd/system/sls.service
```

```ini
[Unit]
Description=SDK Local Service
After=network.target

[Service]
Type=simple
User=yourusername
WorkingDirectory=/opt/sls
ExecStart=/usr/bin/java -jar /opt/sls/sdk-local-service.jar
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable sls
sudo systemctl start sls
sudo systemctl status sls
```

**Windows (NSSM - Non-Sucking Service Manager):**
1. Download NSSM from https://nssm.cc/download
2. Run: `nssm install SLSService`
3. Set Application Path: `C:\Program Files\Java\jdk-11\bin\java.exe`
4. Set Arguments: `-jar C:\path\to\sdk-local-service.jar`
5. Start service: `nssm start SLSService`

**macOS (launchd):**
```bash
nano ~/Library/LaunchAgents/com.hmdev.sls.plist
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hmdev.sls</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/java</string>
        <string>-jar</string>
        <string>/Users/yourusername/sls/sdk-local-service.jar</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.hmdev.sls.plist
launchctl start com.hmdev.sls
```

---

### Step 3: Launch & Connect

1. **Launch the PWA:**
   - Click the installed app icon on desktop/home screen
   - App opens in standalone window

2. **Automatic Connection:**
   - PWA automatically connects to SDK Local Service (localhost:8088)
   - Status indicator at top-right shows "Local - Online" when connected

3. **Start Using:**
   - Click "+ Local" to create a local terminal
   - Click "+ SSH" to connect to remote servers
   - Start typing commands!

---

## 🔄 How They Work Together

```
┌─────────────────────────────────────────┐
│  PWA (Frontend) - hmdevonline.com       │
│  - User Interface                       │
│  - Terminal Emulator (xterm.js)         │
│  - Code Editor, File Browser            │
│  - Cached HTML/CSS/JS files             │
└─────────────────┬───────────────────────┘
                  │ HTTP/WebSocket
                  │ localhost:8088
┌─────────────────▼───────────────────────┐
│  SDK Local Service (Backend)            │
│  - Executes shell commands              │
│  - Manages SSH connections              │
│  - File system operations               │
│  - Runs on YOUR machine                 │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  Your Local System                      │
│  - Bash, CMD, PowerShell, Zsh           │
│  - SSH to remote servers                │
│  - File system access                   │
│  - Terminal I/O                         │
└─────────────────────────────────────────┘
```

### Why Both Are Needed:

| Component | Purpose | Technology |
|-----------|---------|------------|
| **PWA** | User interface, terminal display, cached app files | HTML/CSS/JavaScript, xterm.js, Service Worker |
| **SDK Local Service** | Execute commands, access local system, SSH | Java, Spring Boot, JSch, Process API |

**PWA alone** = Beautiful interface but can't execute any commands  
**SLS alone** = Can execute commands but no way to interact with it  
**PWA + SLS** = Complete terminal application! ✅

---

## 🌐 Alternative: Local Development Setup

For developers who want to modify the source code or run everything locally:

### Build from Source

#### Prerequisites
- Java 11 or higher
- Gradle 8.14 or compatible
- Git

#### Clone Repository

```bash
git clone https://github.com/HaithamMubarak/messaging-platform-sdk.git
cd messaging-platform-sdk
```

#### Build & Run SDK Local Service

```bash
cd agents/examples/sdk-local-service
./gradlew build
./gradlew bootRun
```

Service starts on: `http://localhost:8088`

#### Build & Run Web SDK Server (for local frontend)

```bash
cd agents/examples/web-sdk-server
./gradlew bootRun
```

Frontend available at: `http://localhost:8084/apps/terminal`

**Note:** If you're developing locally, you don't need to install the PWA. Just access `http://localhost:8084/apps/terminal` in your browser.

---

## 🚀 Quick Start Guide

### First Time Setup

1. **Install PWA** (if not already installed):
   - Visit https://hmdevonline.com/messaging-platform/sdk/apps/terminal/app.html
   - Click install button or use browser menu
   - Launch from desktop/home screen

2. **Download & Run SDK Local Service**:
   ```bash
   # Download
   curl -O https://raw.githubusercontent.com/HaithamMubarak/messaging-platform-sdk/develop/agents/examples/sdk-local-service/build/libs/sdk-local-service.jar
   
   # Run
   java -jar sdk-local-service.jar
   ```
   
3. **Launch PWA**:
   - Click the installed app icon
   - App auto-connects to localhost:8088
   - Status shows "Local - Online" when connected

4. **Start Using**:
   - Click "+ Local" for local terminal
   - Click "+ SSH" for remote connections
   - Start typing commands!

### Troubleshooting Connection

If PWA shows "Local Service Offline":

1. **Check SLS is running**:
   ```bash
   # Should show "SDK Local Service" process
   netstat -an | grep 8088  # Linux/Mac
   netstat -an | findstr 8088  # Windows
   ```

2. **Restart SLS**:
   ```bash
   java -jar sdk-local-service.jar
   ```

3. **Refresh PWA**:
   - Close and reopen the app
   - Or click Local badge at top-right

4. **Check port conflicts**:
   - Another service using port 8088?
   - Run SLS on different port: `java -jar sdk-local-service.jar --server.port=9090`
   - Update port in PWA Settings

---

## 📖 Usage Guide

### Creating a Local Terminal
1. Click **"+ Local"** button in toolbar
2. Select shell type (Bash, CMD, PowerShell)
3. Terminal opens in new tab
4. Start typing commands

### Adding SSH Connection
1. Click **"+ SSH"** button
2. Fill in connection details:
   - Name (e.g., "Production Server")
   - Host, Port, Username
   - Password or Private Key
3. Click **"Test Connection"** to verify
4. Click **"Save Connection"**
5. Connection appears in sidebar

### Connecting via SSH
1. Click saved connection in sidebar
2. Or right-click → "Open Connection"
3. SSH terminal opens in new tab
4. Authenticate if required

### Sharing a Terminal
1. Open terminal you want to share
2. Click **"Share"** button in toolbar
3. Configure sharing options:
   - Agent name
   - Channel name and password
   - Read-only or read-write permission
4. Click **"Start Sharing"**
5. Share the generated link or QR code

### Browsing Files
1. Open a terminal session
2. Click **"Files"** tab button
3. Browse directory tree
4. Right-click for actions:
   - Create, delete, rename
   - Download, upload

### Editing Files
1. In file explorer, click a file
2. File opens in code editor
3. Edit with syntax highlighting
3. Click **"Save"** to save changes
4. Click **"Close"** or switch tabs

### Creating Notes
1. Click **"Notes"** tab button
2. Click **"+ New Note"**
3. Write markdown content
4. Auto-saves on typing
5. Rename or delete via context menu

### Configuration Backup
1. Click **"Settings"** menu or Local badge
2. Scroll to "Backup & Restore Configuration"
3. Choose export format and options
4. Click **"Export Configuration"**
5. File downloads automatically

---

## 🎨 Customization

### Themes
The app uses CSS variables for theming. Key variables in `terminal.css`:
- `--bg-primary` - Main background
- `--bg-secondary` - Secondary backgrounds
- `--text-primary` - Main text color
- `--accent-cyan`, `--accent-blue`, etc. - Accent colors

### Terminal Font
Modify font size via terminal context menu or settings.

### Shell Selection
Configure default shell in SLS configuration or select when creating terminal.

---

## 🔒 Security

### Client-Side
- Token-based authentication with SLS
- Tokens expire after 24 hours
- CORS origin validation
- No sensitive data in localStorage (tokens only)

### Backend (SLS)
- Localhost-only binding (127.0.0.1)
- Strict CORS policies
- Token validation on all requests
- SSH credential encryption
- Session isolation

### Terminal Sharing
- WebRTC peer-to-peer (no server relay)
- Optional password protection
- Granular permissions (read-only/read-write)
- Owner controls
- Automatic disconnection

---

## 🐛 Troubleshooting

### SLS Connection Failed
- Verify SLS is running on port 8088
- Check browser console for errors
- Try refreshing the page
- Click Local badge to open settings and reconnect

### SSH Connection Issues
- Test connection before saving
- Verify credentials
- Check firewall/network settings
- Try password instead of key (or vice versa)

### Terminal Sharing Not Working
- Check cloud connection status (top-right)
- Verify both parties have internet access
- Ensure WebRTC is not blocked by firewall
- Try different browser

### File Operations Failing
- Check file permissions
- Verify sufficient disk space
- For remote files, check SSH connection
- Check browser console for errors

---

## 📚 API Integration

### Terminal Operations
```javascript
// Create local terminal
POST /terminal
{ "shell": "bash" }

// Send input
POST /terminal/{sessionId}/input
{ "data": "ls -la\n" }

// Resize terminal
POST /terminal/{sessionId}/resize
{ "cols": 120, "rows": 40 }
```

### WebSocket Stream
```javascript
const ws = new WebSocket(`ws://localhost:8088/terminal/stream/${sessionId}`);
ws.send(JSON.stringify({ type: 'input', data: 'command\n' }));
```

See [SDK Local Service Documentation](https://github.com/HaithamMubarak/messaging-platform-sdk/blob/main/agents/examples/sdk-local-service/README.md) for complete API reference.

---

## 🔗 Related Projects

- **SDK Local Service** - Backend API ([GitHub](https://github.com/HaithamMubarak/messaging-platform-sdk/tree/main/agents/examples/sdk-local-service))
- **Web SDK Server** - Frontend server ([GitHub](https://github.com/HaithamMubarak/messaging-platform-sdk/tree/main/agents/examples/web-sdk-server))
- **Messaging Platform SDK** - Main repository ([GitHub](https://github.com/HaithamMubarak/messaging-platform-sdk))

---

## 🤝 Contributing

### Report Issues
Found a bug or have a feature request?  
[Create an Issue](https://github.com/HaithamMubarak/messaging-platform-sdk/issues/new?title=[Terminal%20App]%20)

### Discussions
Join the community discussion:  
[GitHub Discussions](https://github.com/HaithamMubarak/messaging-platform-sdk/discussions)

---

## 📄 License

Part of the Messaging Platform SDK  
© 2026 - Open Source Project

---

## 🙏 Acknowledgments

Built with amazing open source projects:
- **xterm.js** - Terminal emulator by xtermjs team
- **CodeMirror** - Code editor by Marijn Haverbeke
- **Spring Boot** - Backend framework by Pivotal/VMware
- **JSch** - SSH library by JCraft

---

**Version:** 1.0.0  
**Last Updated:** March 7, 2026




