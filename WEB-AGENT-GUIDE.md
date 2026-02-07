# Web Agent User Guide

**Messaging Platform SDK - JavaScript/Web Client**  
**Version:** 1.0.0  
**Last Updated:** January 22, 2026

---

> **📌 API Configuration Note:**  
> The production messaging service URL is `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`.  
> - Web agents require explicit URL configuration in the `connect()` call via the `api` parameter
> - Examples in this guide use `http://localhost:8082` to demonstrate local development setup
> - For production deployments, use: `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`
> - The production messaging service is a private service managed by the platform

---

## 🎯 Quick Start

The Web Agent enables real-time messaging and WebRTC video streaming in web browsers using pure JavaScript - no dependencies required.

### Installation

Include the agent scripts in your HTML:

```html
<!-- Core Web Agent -->
<script src="js/web-agent.libs.js"></script>
<script src="js/web-agent.js"></script>

<!-- Optional: WebRTC Support -->
<script src="js/web-agent.webrtc.js"></script>
```

Or load from CDN (when available):
```html
<script src="https://cdn.example.com/web-agent@1.0.0/web-agent.min.js"></script>
```

---

## 📚 Core Concepts

### Connection Lifecycle

```
Initialize → Connect → Ready → Send/Receive Messages → Disconnect
```

### Message Types

- **TEXT** - Plain text messages
- **DATA** - JSON/binary data
- **WEBRTC** - WebRTC signaling (offers, answers, ICE candidates)
- **COMMAND** - System commands

### Storage

- **Channel Storage** - Persistent key-value store per channel
- **Versioning** - Keep multiple versions of data
- **Metadata** - Attach custom properties to stored values

---

## 💬 Basic Messaging

### Simple Chat Example

```html
<!DOCTYPE html>
<html>
<head>
    <title>Simple Chat</title>
</head>
<body>
    <div id="messages"></div>
    <input type="text" id="messageInput" placeholder="Type a message...">
    <button onclick="sendMessage()">Send</button>

    <!-- Include Web Agent -->
    <script src="js/web-agent.libs.js"></script>
    <script src="js/web-agent.js"></script>

    <script>
        let agent;
        const messagesDiv = document.getElementById('messages');

        // Initialize connection
        async function connect() {
            try {
                // Create agent instance
                agent = new AgentConnection();

                // Set up message handler
                agent.onMessage = function(msg) {
                    const div = document.createElement('div');
                    div.textContent = `${msg.from}: ${msg.content}`;
                    messagesDiv.appendChild(div);
                };

                // Connection event handlers
                agent.onChannelConnect = function() {
                    console.log('Connected to channel');
                };

                agent.onChannelDisconnect = function() {
                    console.log('Disconnected from channel');
                };

                // Connect to channel
                agent.connect({
                    channelName: 'my-channel',
                    channelPassword: 'password123',
                    agentName: 'web-user-1',
                    api: 'http://localhost:8082',
                    apiKey: 'your-api-key-here',
                    autoReceive: true
                });
            } catch (error) {
                console.error('Connection failed:', error);
            }
        }

        // Send message
        function sendMessage() {
            const input = document.getElementById('messageInput');
            const content = input.value.trim();
            
            if (content && channel) {
                channel.sendTextMessage(content);
                input.value = '';
            }
        }

        // Connect on page load
        connect();
    </script>
</body>
</html>
```

---

## 🎥 WebRTC Video Streaming

### Sending Video Stream

```html
<!DOCTYPE html>
<html>
<head>
    <title>Video Sender</title>
</head>
<body>
    <video id="localVideo" autoplay muted width="640" height="480"></video>
    <button onclick="startStreaming()">Start Streaming</button>
    <button onclick="stopStreaming()">Stop Streaming</button>

    <!-- Include Web Agent + WebRTC -->
    <script src="js/web-agent.libs.js"></script>
    <script src="js/web-agent.js"></script>
    <script src="js/web-agent.webrtc.js"></script>

    <script>
        let channel;
        let webrtc;
        let localStream;
        const streamId = 'my-stream-' + Date.now();

        async function initialize() {
            // Create agent
            agent = new AgentConnection({ usePubKey: false });

            // Create WebRTC helper
            webrtc = new WebRtcHelper(agent);

            // Connect to messaging channel
            agent.connect({
                'video-channel',
                'broadcaster-1',
                'password123',
                {
                    api: 'http://localhost:8082',
                    apiKey: 'your-api-key-here'
                }
            );

            console.log('Connected and ready to stream');
        }

        async function startStreaming() {
            try {
                // Get camera/microphone access
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 1280, height: 720 },
                    audio: true
                });

                // Display local preview
                document.getElementById('localVideo').srcObject = localStream;

                // Start broadcasting to all viewers
                await webrtc.startStreamBroadcast(
                    streamId,
                    localStream,
                    null  // null = broadcast to all agents
                );

                console.log('Streaming started:', streamId);
            } catch (error) {
                console.error('Failed to start streaming:', error);
            }
        }

        function stopStreaming() {
            if (localStream) {
                // Stop all tracks
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;

                // Stop broadcast
                webrtc.stopStreamBroadcast(streamId);
                
                console.log('Streaming stopped');
            }
        }

        // Initialize on page load
        initialize();
    </script>
</body>
</html>
```

### Receiving Video Stream

```html
<!DOCTYPE html>
<html>
<head>
    <title>Video Receiver</title>
</head>
<body>
    <video id="remoteVideo" autoplay width="640" height="480"></video>
    <div id="status">Waiting for stream...</div>

    <!-- Include Web Agent + WebRTC -->
    <script src="js/web-agent.libs.js"></script>
    <script src="js/web-agent.js"></script>
    <script src="js/web-agent.webrtc.js"></script>

    <script>
        let agent;
        let webrtc;

        async function initialize() {
            // Create agent
            agent = new AgentConnection();

            // Create WebRTC helper
            webrtc = new WebRtcHelper(agent);

            // Handle incoming streams
            webrtc.on('stream-added', (streamId, mediaStream) => {
                console.log('Stream received:', streamId);
                
                // Display remote video
                const videoElement = document.getElementById('remoteVideo');
                videoElement.srcObject = mediaStream;
                
                document.getElementById('status').textContent = 'Streaming...';
            });

            webrtc.on('stream-removed', (streamId) => {
                console.log('Stream ended:', streamId);
                document.getElementById('status').textContent = 'Stream ended';
            });

            // Connect to messaging channel
            agent.connect({
                channelName: 'video-channel',
                channelPassword: 'password123',
                agentName: 'viewer-1',
                api: 'http://localhost:8082',
                apiKey: 'your-api-key-here',
                autoReceive: true
            });

            console.log('Connected, waiting for streams...');
        }

        // Initialize on page load
        initialize();
    </script>
</body>
</html>
```

---

## 💾 Channel Storage (Key-Value Store)

The Web Agent provides a persistent key-value storage system for each channel. Store game state, whiteboard data, shared documents, or any JSON data that needs to persist across sessions.

### Features

- **Persistent Storage** - Data survives agent disconnections
- **Channel-Scoped** - Each channel has its own storage
- **Versioning** - Keep multiple versions of the same key
- **Binary & JSON Support** - Store any data type
- **Metadata** - Attach custom metadata to stored values

### Basic Operations

#### 1. Store Data (PUT - Replace)

```javascript
// Store data to channel storage
channel.storagePut({
    storageKey: 'game-state',
    content: {
        level: 5,
        score: 1000,
        playerName: 'Alice'
    },
    encrypted: false,
    metadata: {
        contentType: 'application/json',
        description: 'Game save state'
    }
}, function(response) {
    if (response.status === 'success') {
        console.log('Saved:', response.data);
    }
});
```

#### 2. Retrieve Data (GET)

```javascript
// Get latest version
channel.storageGet({
    storageKey: 'game-state'
}, function(response) {
    if (response.status === 'success' && response.data) {
        const gameState = response.data;
        console.log('Level:', gameState.level);
        console.log('Score:', gameState.score);
    }
});
```

#### 3. Add Version (Keep History)

```javascript
// Add new version without deleting old ones
channel.storageAdd({
    storageKey: 'game-state',
    content: { level: 6, score: 1500 },
    encrypted: false
}, function(response) {
    console.log('Version added:', response.data.version);
});
```

**See full example:** `examples/whiteboard/whiteboard-client.js`
agent.storageAdd('game-scores', {
    player: 'user-1',
    score: 1500,
    date: Date.now()
}, null, function(response) {
    console.log('Score added:', response);
});

// Later, get all versions
agent.storageGetList('game-scores', function(response) {
    if (response.status === 'success') {
        const allScores = response.data;
        console.log('All scores:', allScores);
    }
});
```

#### 4. Delete Data

```javascript
// Delete all versions of a key
agent.storageDeleteByKey('old-data', function(response) {
    if (response.status === 'success') {
        console.log('Deleted successfully');
    }
});
```

### List Operations

#### Get All Keys

```javascript
// List all storage keys in the channel
agent.storageKeys(function(response) {
    if (response.status === 'success') {
        const keys = response.data;
        console.log('Available keys:', keys);
        // Example: ['game-settings', 'whiteboard-data', 'player-scores']
    }
});
```

#### Get All Values with Metadata

```javascript
// Get metadata for all stored values
agent.storageValues(function(response) {
    if (response.status === 'success') {
        const values = response.data;
        values.forEach(item => {
            console.log('Key:', item.key);
            console.log('Version:', item.version);
            console.log('Created:', item.createdAt);
        });
    }
});
```

### Complete Examples

#### Example 1: Game State Persistence

```javascript
// Save game state
function saveGameState() {
    const gameState = {
        level: 5,
        lives: 3,
        score: 2500,
        inventory: ['sword', 'shield', 'potion'],
        position: { x: 100, y: 200 }
    };
    
    agent.storagePut('game-state', gameState, {
        description: 'Player save state',
        properties: { player: agent.agentName }
    }, function(response) {
        if (response.status === 'success') {
            console.log('Game saved!');
            showMessage('Game saved successfully');
        }
    });
}

// Load game state
function loadGameState() {
    agent.storageGet('game-state', function(response) {
        if (response.status === 'success') {
            const gameState = response.data;
            
            // Restore game state
            player.level = gameState.level;
            player.lives = gameState.lives;
            player.score = gameState.score;
            player.inventory = gameState.inventory;
            player.position = gameState.position;
            
            console.log('Game loaded!');
        } else {
            console.log('No saved game found, starting new game');
        }
    });
}
```

#### Example 2: Collaborative Whiteboard

```javascript
// Real-time whiteboard with persistence
const whiteboard = {
    strokes: []
};

// Add new stroke
function addStroke(stroke) {
    whiteboard.strokes.push(stroke);
    
    // Save to storage (replaces previous version)
    agent.storagePut('whiteboard', whiteboard, {
        properties: { 
            lastModified: Date.now(),
            modifiedBy: agent.agentName
        }
    }, function(response) {
        console.log('Whiteboard saved');
    });
    
    // Also send real-time update to other agents
    agent.sendCustomMessage('whiteboard-update', stroke);
}

// Load whiteboard on connect
agent.onChannelConnect = function() {
    agent.storageGet('whiteboard', function(response) {
        if (response.status === 'success') {
            whiteboard.strokes = response.data.strokes || [];
            redrawWhiteboard();
            console.log('Whiteboard loaded with', whiteboard.strokes.length, 'strokes');
        } else {
            console.log('Starting with blank whiteboard');
        }
    });
};
```

#### Example 3: Score Leaderboard with History

```javascript
// Add score (keeps all versions)
function submitScore(playerName, score) {
    agent.storageAdd('leaderboard', {
        player: playerName,
        score: score,
        timestamp: Date.now()
    }, null, function(response) {
        console.log('Score submitted:', response);
        updateLeaderboard();
    });
}

// Get all scores and display top 10
function updateLeaderboard() {
    agent.storageGetList('leaderboard', function(response) {
        if (response.status === 'success') {
            const allScores = response.data;
            
            // Sort by score descending
            allScores.sort((a, b) => b.score - a.score);
            
            // Display top 10
            const top10 = allScores.slice(0, 10);
            displayLeaderboard(top10);
        }
    });
}
```

#### Example 4: Settings with Versioning

```javascript
// Save settings
function saveSettings(settings) {
    agent.storagePut('app-settings', settings, {
        properties: {
            version: '2.0',
            updatedBy: agent.agentName,
            updatedAt: new Date().toISOString()
        }
    }, function(response) {
        if (response.status === 'success') {
            console.log('Settings saved');
        }
    });
}

// Load settings with error handling
function loadSettings(callback) {
    agent.storageGet('app-settings', function(response) {
        if (response.status === 'success') {
            const settings = response.data;
            
            // Apply default values for missing properties
            const defaultSettings = {
                theme: 'light',
                notifications: true,
                soundEnabled: true
            };
            
            const finalSettings = { ...defaultSettings, ...settings };
            callback(finalSettings);
        } else {
            // Return defaults if no settings found
            callback(getDefaultSettings());
        }
    });
}
```

### API Reference

#### `storagePut(key, content, metadata, callback)`

**Replace all versions** of a key with new content.

- **key** (string) - Storage key (e.g., 'game-state')
- **content** (object|string) - Data to store (auto-serialized to JSON)
- **metadata** (object|null) - Optional metadata:
  - `contentType` - MIME type (default: 'application/json')
  - `description` - Human-readable description
  - `version` - Version string
  - `properties` - Custom key-value pairs
- **callback** (function) - `function(response)` where response is `{status, data}`

#### `storageAdd(key, content, metadata, callback)`

**Append new version** (keeps existing versions).

Same parameters as `storagePut()`.

#### `storageGet(key, callback)`

**Get latest version** by key.

- **key** (string) - Storage key
- **callback** (function) - Response includes:
  - `status` - 'success' or 'error'
  - `data` - Parsed JSON content
  - `headers` - Content-Type and metadata

#### `storageGetList(key, callback)`

**Get all versions** of a key (chronological order).

- **key** (string) - Storage key
- **callback** (function) - Returns array of all versions

#### `storageKeys(callback)`

**List all keys** in the channel.

- **callback** (function) - Returns array of key names

#### `storageValues(callback)`

**Get metadata** for all stored values.

- **callback** (function) - Returns array of metadata objects

#### `storageDeleteByKey(key, callback)`

**Delete all versions** of a key.

- **key** (string) - Storage key to delete
- **callback** (function) - Confirmation response

### Best Practices

#### 1. Use Descriptive Keys

```javascript
// ✅ Good - Clear purpose
agent.storagePut('game-settings', {...});
agent.storagePut('player-inventory', {...});
agent.storagePut('whiteboard-session-2025-01-22', {...});

// ❌ Bad - Unclear
agent.storagePut('data', {...});
agent.storagePut('temp', {...});
```

#### 2. Choose PUT vs ADD Wisely

```javascript
// Use PUT for single-value storage (replaces)
agent.storagePut('current-game-state', state);

// Use ADD for accumulating history (appends)
agent.storageAdd('player-actions-log', action);
agent.storageAdd('high-scores', score);
```

#### 3. Add Meaningful Metadata

```javascript
agent.storagePut('document', content, {
    description: 'Project proposal v3',
    properties: {
        author: agent.agentName,
        lastModified: new Date().toISOString(),
        tags: ['important', 'draft'],
        version: '3.0'
    }
});
```

#### 4. Handle Errors Gracefully

```javascript
agent.storageGet('user-data', function(response) {
    if (response.status === 'success') {
        // Use data
        processData(response.data);
    } else {
        // Fallback
        console.warn('Could not load data:', response.data);
        useDefaultData();
    }
});
```

#### 5. Clean Up Old Data

```javascript
// Periodically clean up old storage
function cleanupOldData() {
    agent.storageKeys(function(response) {
        if (response.status === 'success') {
            response.data.forEach(key => {
                if (key.startsWith('temp-')) {
                    agent.storageDeleteByKey(key);
                }
            });
        }
    });
}
```

### Storage Limits

- **Key Length**: Up to 255 characters
- **Content Size**: Check your server configuration (typically 1-10 MB per value)
- **Total Storage**: Depends on server plan and channel limits

### Use Cases

✅ **Game State Persistence** - Save/load player progress  
✅ **Collaborative Editing** - Shared documents, whiteboards  
✅ **Leaderboards** - High scores, rankings  
✅ **User Preferences** - Settings, themes  
✅ **Session History** - Logs, audit trails  
✅ **Cached Data** - Reduce server requests  
✅ **Offline Support** - Store data when disconnected  

---

## 🎯 Advanced Topics

### Message Filtering

Target specific agents using filter queries:

```javascript
// Send to agents matching filter criteria
channel.sendTextMessage(
    'Hello gamers!',
    null,  // to: null = use filter
    'gameType=shooter,level>5'  // filter query
);
```

**Filter Syntax:**
- `key=value` - Exact match
- `key:value` - Contains match
- `key>value` - Greater than (numeric)
- `key<value` - Less than (numeric)
- Multiple conditions: `key1=value1,key2=value2`

**Note:** Filter matching is done at the server level based on agent connection metadata.

### Temporary API Keys

For enhanced security, request temporary keys:

```javascript
// Request temp key before connecting
agent.requestTempKey = true;  // Enable temp key mode

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'password',
    agentName: 'agent-1',
    api: 'http://localhost:8082',
    apiKey: 'your-permanent-key',
    autoReceive: true
});
// Agent now uses temporary key that expires in 24 hours
```

### File Sharing

Share files peer-to-peer using WebRTC DataChannels (see QuickShare example):

```javascript
// Extend AgentInteractionBase for P2P file sharing
class MyFileShare extends AgentInteractionBase {
    constructor() {
        super({
            storagePrefix: 'fileshare',
            customType: 'file-share',
            autoCreateDataChannel: true,
            dataChannelName: 'files-data'
        });
    }
    
    // Share file to all connected peers
    async shareFile(file, targetPeer = null) {
        const transferId = 'transfer-' + Date.now();
        const chunkSize = 16384; // 16KB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        console.log(`Sharing ${file.name} (${file.size} bytes) in ${totalChunks} chunks`);
        
        // Send file metadata first
        this.sendData({
            type: 'file-offer',
            transferId: transferId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            totalChunks: totalChunks
        }, targetPeer);
        
        // Send file chunks
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = await file.slice(start, end).arrayBuffer();
            
            this.sendData({
                type: 'file-chunk',
                transferId: transferId,
                chunkIndex: i,
                chunk: Array.from(new Uint8Array(chunk))
            }, targetPeer);
        }
        
        console.log(`File transfer ${transferId} complete`);
    }
}

// Receive files
myFileShare.on('data-received', (peerId, data) => {
    if (data.type === 'file-offer') {
        console.log(`Receiving file: ${data.fileName} from ${peerId}`);
        // Initialize transfer buffer
    } else if (data.type === 'file-chunk') {
        // Reassemble chunks and download when complete
    }
});
```

For a complete working example, see: `examples/quickshare/QuickShare.js`

---

## 🎮 WebRTC Advanced Usage

### One-to-One Video Call

```javascript
// Include WebRTC support
<script src="js/web-agent.webrtc.js"></script>

// Initialize
const agent = new AgentConnection({ usePubKey: false });
const webrtc = new WebRtcHelper(agent);

await agent.connect({
    channelName: 'video-call',
    channelPassword: 'secret',
    agentName: 'user1',
    api: 'https://hmdevonline.com/messaging-platform/api',
    apiKey: 'your-api-key',
    autoReceive: true
});

// Get local video stream
const localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
});

// Display local video
document.getElementById('localVideo').srcObject = localStream;

// Set local stream in WebRTC helper
webrtc.setLocalMediaStream(localStream);

// Start broadcasting to a specific peer
const streamId = 'my-stream-' + Date.now();
await webrtc.createStreamOffer(streamId, 'other-agent-name', {
    stream: localStream
});

// Receive remote streams
webrtc.on('stream-added', (streamId, mediaStream, sourceAgent) => {
    console.log(`Received stream from ${sourceAgent}`);
    
    // Display remote video
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = mediaStream;
    remoteVideo.play();
});

// Handle errors
webrtc.on('error', (streamId, error) => {
    console.error('WebRTC error:', error);
});
```

### Screen Sharing

```javascript
async function shareScreen() {
    try {
        // Request screen capture
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: false
        });

        // Broadcast screen
        await webrtc.startStreamBroadcast(
            'screen-' + Date.now(),
            screenStream,
            null  // Broadcast to all
        );

        // Handle user stopping screen share via browser UI
        screenStream.getVideoTracks()[0].onended = () => {
            console.log('Screen sharing stopped by user');
            webrtc.stopStreamBroadcast('screen-' + Date.now());
        };
    } catch (error) {
        console.error('Screen share failed:', error);
    }
}
```

### Data Channels (for low-latency data)

```javascript
// Enable data channel when starting stream
webrtc.on('peer-connected', (peerId) => {
    // Data channel is automatically created
    const dataChannel = webrtc.dataChannels.get(peerId);
    
    if (dataChannel) {
        dataChannel.onmessage = (event) => {
            console.log('Received via data channel:', event.data);
        };
        
        // Send data
        dataChannel.send(JSON.stringify({ type: 'game-state', data: {...} }));
    }
});
```

### TURN/STUN Configuration

```javascript
// Custom ICE servers (for NAT traversal)
const webrtc = new WebRtcHelper(agent);

// Override default ICE servers
webrtc.iceServers = [
    {
        urls: ['stun:your-stun-server.com:3478'],
    },
    {
        urls: ['turn:your-turn-server.com:3478'],
        username: 'username',
        credential: 'password'
    }
];
```

---

## 🔐 Security Best Practices

### 1. API Key Management

```javascript
// ❌ DON'T hardcode keys
const config = {
    apiKey: 'your-api-key-here'  // Never hardcode real keys!
};

// ✅ DO load from server endpoint
const response = await fetch('/api/config');
const config = await response.json();

await channel.connect(channel, name, password, config);
```

### 2. Channel Passwords

```javascript
// ❌ DON'T use weak passwords
await channel.connect('public-channel', 'user-1', '123');

// ✅ DO use strong passwords
await channel.connect('private-channel', 'user-1', 'Xy9$mK#pL2@nQ5!wR');
```

### 3. Input Validation

```javascript
// ✅ Validate user input before sending
function sendMessage() {
    let content = inputElement.value.trim();
    
    // Sanitize
    content = content.replace(/<script>/gi, '');
    
    // Length check
    if (content.length > 0 && content.length < 1000) {
        channel.sendTextMessage(content);
    }
}
```

### 4. HTTPS/WSS in Production

```javascript
// ✅ Always use secure protocols in production
const config = {
    api: 'https://your-domain.com',  // HTTPS
    apiKey: apiKey
};
// WebSocket will automatically use WSS
```

---

## 🐛 Troubleshooting

### Connection Issues

**Problem:** Can't connect to server

```javascript
// Check console for errors
channel.onError = function(error) {
    console.error('Connection error:', error);
};

// Verify server is running
fetch('http://localhost:8082/messaging-platform/actuator/health')
    .then(r => r.json())
    .then(data => console.log('Server status:', data));
```

**Solution:**
1. Verify server is running
2. Check API URL and port
3. Verify API key is valid
4. Check browser console for CORS errors

### WebRTC Issues

**Problem:** Video not showing

```javascript
// Enable verbose logging
webrtc.on('ice-candidate', (streamId, candidate) => {
    console.log('ICE candidate:', candidate);
});

webrtc.on('peer-state-change', (streamId, state) => {
    console.log('Peer connection state:', state);
});
```

**Common Solutions:**
1. **No video stream:** Check camera permissions
2. **Black screen:** Verify `getUserMedia()` succeeded
3. **Connection fails:** Check TURN/STUN server configuration
4. **One-way video:** Check firewall/NAT settings

### Message Not Received

```javascript
// Debug message routing
agent.onMessage = function(msg) {
    console.log('Message received:', {
        from: msg.from,
        to: msg.to,
        content: msg.content,
        filterQuery: msg.filterQuery
    });
};

// Check if metadata matches filter
console.log('My metadata:', agent.getAgentState().metadata);
```

---

## 📦 Complete Example

See the `/examples/` directory for full working examples:

- **chat.html** - Complete chat application with UI
- **webrtc.html** - Video streaming example
- **turn-stun-test.html** - Test TURN/STUN connectivity
- **developer-console.html** - Debug console with full API access

### Running Examples Locally

```bash
# Start the web SDK server
cd agents/examples/web-sdk-server
./gradlew bootRun

# Open browser to:
http://localhost:8084
```

---

## 🚀 Deployment Checklist

Before deploying your web agent application:

- [ ] Use HTTPS for all connections
- [ ] Never expose API keys in client code
- [ ] Implement rate limiting
- [ ] Add error handling for all async operations
- [ ] Test WebRTC with real network conditions
- [ ] Configure TURN servers for production
- [ ] Add reconnection logic
- [ ] Implement message queuing for offline support
- [ ] Add user authentication
- [ ] Test across different browsers

---

## 📖 API Reference

### AgentConnection Methods

| Method | Description |
|--------|-------------|
| `connect(config)` | Connect to messaging channel with config object |
| `disconnect()` | Disconnect from channel |
| `sendTextMessage(content, to, filterQuery)` | Send text message |
| `sendDataMessage(data, to, filterQuery)` | Send JSON/binary data |
| `updateAgentMetadata(metadata)` | Update agent metadata |
| `getChannelHistory(range, callback)` | Get message history |
| `shareFile(file, callback)` | Upload and share file |

**Config Object for `connect(config)`:**
```javascript
{
    channelName: 'channel-name',     // Required (or use channelId)
    channelPassword: 'password',     // Required (or use channelId)
    agentName: 'your-agent-name',    // Required
    api: 'http://localhost:8082',    // Required
    apiKey: 'your-api-key',          // Required
    autoReceive: true,               // Optional: auto-receive messages
    channelId: 'channel-id',         // Optional: connect by ID instead
    sessionId: 'session-id'          // Optional: resume session
}
```

### AgentConnection Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `onMessage` | `(message)` | Message received |
| `onChannelConnect` | `()` | Connected to channel |
| `onChannelDisconnect` | `()` | Disconnected from channel |
| `onAgentJoin` | `(agentName)` | Agent joined channel |
| `onAgentLeave` | `(agentName)` | Agent left channel |
| `onError` | `(error)` | Error occurred |

### WebRTC Methods

| Method | Description |
|--------|-------------|
| `startStreamBroadcast(streamId, mediaStream, targetAgent)` | Start video broadcast |
| `stopStreamBroadcast(streamId)` | Stop video broadcast |
| `on(event, handler)` | Register event handler |

### WebRTC Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `stream-added` | `(streamId, mediaStream)` | Remote stream received |
| `stream-removed` | `(streamId)` | Remote stream ended |
| `peer-connected` | `(peerId)` | Peer connection established |
| `peer-disconnected` | `(peerId)` | Peer connection closed |

---

## 🔗 Related Documentation

- [Repository README](../README.md) - Project overview
- [AI Coding Instructions](AI/AI-CODING-INSTRUCTIONS.md) - For contributors
- [Java Agent Guide](agents/java-agent/README.md) - Java client
- [Python Agent Guide](agents/python-agent/README.md) - Python client

---

## 💬 Support

For issues, questions, or contributions:
- Check existing examples in `/agents/examples/`
- Review this guide thoroughly
- Check browser console for error messages
- Verify server logs

---

**Happy coding! 🎉**
