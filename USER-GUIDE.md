# Messaging Platform SDK - User Guide

**Version:** 1.0.0  
**Last Updated:** December 27, 2025  
**Status:** Production Ready

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Java Agent](#java-agent)
5. [Python Agent](#python-agent)
6. [Web Agent](#web-agent)
7. [Examples](#examples)
8. [API Reference](#api-reference)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

> **📌 API Configuration Note:**  
> The default production messaging service URL is `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`.  
> - Java and Python agents use this URL as the default if no URL is specified
> - Web agents require explicit URL configuration in the `connect()` call  
> - Examples in this guide may use `http://localhost:8082` to demonstrate local development
> - For production, use: `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`
> - The messaging service is a private platform service

---

## Overview

The Messaging Platform SDK provides client libraries for building real-time messaging applications with support for:

- ✅ **Real-time messaging** - WebSocket-based communication
- ✅ **Advanced filtering** - Target specific agents with filter queries ⭐ NEW
- ✅ **WebRTC support** - Audio/video streaming
- ✅ **Multi-platform** - Java, Python, JavaScript/Web
- ✅ **Secure** - Temporary API keys, encryption support
- ✅ **Scalable** - Kafka-backed message delivery

### Supported Languages

| Language | Agent | Use Case |
|----------|-------|----------|
| **Java** | `java-agent` | Desktop apps, Android, backend services |
| **Python** | `python-agent` | Scripts, bots, ML integrations |
| **JavaScript** | `web-agent` | Web browsers, Node.js |

---

## Quick Start

### Prerequisites

- Java 11+ (for Java agent)
- Python 3.8+ (for Python agent)
- Modern web browser (for Web agent)
- Messaging Platform Services running

### Installation

#### Java Agent
```gradle
dependencies {
    implementation 'com.hmdev.messaging:java-agent:1.0.0'
}
```

#### Python Agent
```bash
pip install messaging-platform-python-agent
```

#### Web Agent
```html
<!-- Include Web Agent SDK -->
<script src="js/web-agent.libs.js"></script>
<script src="js/web-agent.js"></script>
<!-- Optional: WebRTC support -->
<script src="js/web-agent.webrtc.js"></script>
```

### Your First Message (5 Minutes)

#### Java
```java
import com.hmdev.messaging.agent.core.AgentConnection;

public class QuickStart {
    public static void main(String[] args) {
        AgentConnection agent = new AgentConnection(
            "https://api.messaging-platform.com",
            "your-api-key"
        );
        
        agent.connect("my-channel", "agent-1", "password");
        agent.sendMessage("Hello, World!");
        agent.disconnect();
    }
}
```

#### Python
```python
from messaging_agent import AgentConnection

agent = AgentConnection(
    api_url="https://api.messaging-platform.com",
    api_key="your-api-key"
)

agent.connect("my-channel", "agent-1", "password")
agent.send_message("Hello, World!")
agent.disconnect()
```

#### JavaScript
```javascript
const agent = new AgentConnection();

agent.connect({
    channelName: 'my-channel',
    channelPassword: 'password',
    agentName: 'agent-1',
    api: 'https://api.messaging-platform.com',
    apiKey: 'your-api-key',
    autoReceive: true
});

agent.onMessage = (msg) => console.log('Received:', msg.content);
agent.sendTextMessage('Hello, World!');
agent.disconnect();
```

---

## Architecture

### API Keys and Channel Isolation

#### Understanding API Keys

The Messaging Platform supports two types of API keys:

1. **Original API Key** - Your main developer API key used for authentication
2. **Temporary API Key** (Optional) - Short-lived keys with restricted capabilities for security

**Temporary API Keys:**
- Optional security feature to prevent clients from having your original API key
- Created with expiration time and restricted capabilities
- Useful for client-side applications where you don't want to expose your main API key
- You can use your original API key directly if preferred

#### Channel Isolation with `apiKeyScope`

The `apiKeyScope` parameter controls how channels are isolated between developers:

**`apiKeyScope="private"` (Default)**
- Channels are isolated per API key
- Two developers using the same channel name and password but different API keys will get **separate channels**
- Use case: Production environments where each developer needs isolated channels
- Example: Developer A and Developer B both connect to "game-lobby" with password "test123" but get different channels

**`apiKeyScope="public"`
- Channels are shared across all API keys
- Developers with the same channel name and password connect to the **same channel**
- Use case: Testing, demos, or collaborative development
- Example: Multiple developers can test together by connecting to a public channel

#### Usage Examples

**Java with apiKeyScope:**
```java
AgentConnection agent = new AgentConnection(
    "http://localhost:8082",
    "your-api-key"
);

// Private scope (default) - isolated channels
agent.setApiKeyScope("private");
agent.connect("game-lobby", "password123", "player-1");

// Public scope - shared channels for testing
agent.setApiKeyScope("public");
agent.connect("test-channel", "demo-pass", "tester-1");
```

**JavaScript with apiKeyScope:**
```javascript
const agent = new AgentConnection();

// Private scope (default)
agent.connect({
    channelName: 'game-lobby',
    channelPassword: 'password123',
    agentName: 'player-1',
    apiKey: 'your-api-key',
    apiKeyScope: 'private'  // Default
});

// Public scope for testing
agent.connect({
    channelName: 'test-channel',
    channelPassword: 'demo-pass',
    agentName: 'tester-1',
    apiKey: 'your-api-key',
    apiKeyScope: 'public'  // Share channel with others
});
```

**Python with apiKeyScope:**
```python
from messaging_agent import AgentConnection

agent = AgentConnection(
    api_url="http://localhost:8082",
    api_key="your-api-key"
)

# Using config dictionary (recommended)
config = {
    'channelName': 'game-lobby',
    'channelPassword': 'password123',
    'agentName': 'player-1',
    'apiKeyScope': 'public'  # or 'private' (default)
}
agent.connect_with_config(config)
```

#### When to Use Each Scope

| Scenario | Recommended Scope | Reason |
|----------|------------------|---------|
| Production app | `private` | Isolate your users from other developers |
| Development/Testing | `public` | Test with team members easily |
| SDK Examples | `public` | Allow users to connect without API key conflicts |
| Demos | `public` | Share demo channels with audience |
| Multi-tenant apps | `private` | Keep customer data isolated |

---

```java
import com.hmdev.messaging.agent.webrtc.WebRTCHelper;

// Enable WebRTC
agent.setWebRTCHelper(new WebRTCHelper());

// Handle video streams
agent.getWebRTCHelper().setOnRemoteStream(stream -> {
    System.out.println("Received video stream: " + stream.getId());
    // Process video stream
});

// Start streaming
agent.getWebRTCHelper().startLocalStream();
```

#### Message History Recovery

```java
// Recover messages from specific offset
agent.receiveMessages(
    0L,          // Start offset
    100L,        // End offset
    50           // Max messages
);
```

#### Custom Message Types

```java
// Send custom JSON data
EventMessage customMsg = new EventMessage();
customMsg.setType(EventMessage.EventType.CUSTOM);
customMsg.setContent("{\"action\": \"notify\", \"data\": \"value\"}");
agent.send(customMsg);
```

### Configuration

```java
AgentConnection agent = new AgentConnection();
agent.setApi("http://localhost:8082");
agent.setApiKey("your-api-key");
agent.setUsePubKey(false);  // Disable public key encryption
agent.setAutoReceive(true);  // Auto-receive messages
```

### Examples

See `/agents/examples/java/` for complete examples:
- `SimpleChat.java` - Basic text messaging
- `WebRTCExample.java` - Video streaming
- `BotExample.java` - Automated bot agent

---

## Python Agent

### Installation

```bash
pip install -r requirements.txt
```

Or manually:
```bash
pip install websocket-client requests
```

### Basic Usage

```python
from messaging_agent import AgentConnection
import time

# 1. Create connection
agent = AgentConnection(
    api_url="http://localhost:8082",
    api_key="your-api-key"
)

# 2. Set message handler
def on_message(message):
    print(f"Received: {message['content']}")

agent.on_message = on_message

# 3. Connect
agent.connect(
    channel_name="my-channel",
    agent_name="python-agent-1",
    channel_password="secret123"
)

# 4. Send messages
agent.send_text_message("Hello from Python!")

# 5. Keep alive
time.sleep(60)

# 6. Disconnect
agent.disconnect()
```

### Advanced Features

#### Async Support

```python
import asyncio
from messaging_agent.async_agent import AsyncAgentConnection

async def main():
    agent = AsyncAgentConnection(
        api_url="http://localhost:8082",
        api_key="your-api-key"
    )
    
    await agent.connect("my-channel", "async-agent", "pass123")
    await agent.send_message("Hello async!")
    await asyncio.sleep(10)
    await agent.disconnect()

asyncio.run(main())
```

#### Bot Example

```python
class EchoBot:
    def __init__(self, api_url, api_key):
        self.agent = AgentConnection(api_url, api_key)
        self.agent.on_message = self.handle_message
    
    def handle_message(self, message):
        # Echo back the message
        if message['from'] != self.agent.agent_name:
            response = f"Echo: {message['content']}"
            self.agent.send_text_message(response)
    
    def start(self, channel, agent_name, password):
        self.agent.connect(channel, agent_name, password)
        print(f"Echo bot started on channel: {channel}")
        
        # Keep alive
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.agent.disconnect()

# Usage
bot = EchoBot("http://localhost:8082", "your-api-key")
bot.start("echo-channel", "echo-bot", "password123")
```

### Examples

See `/agents/examples/python/` for complete examples:
- `simple_chat.py` - Basic messaging
- `echo_bot.py` - Echo bot implementation
- `file_transfer.py` - File sharing

---

## Web Agent

### Installation

Include in your HTML:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Messaging Platform</title>
    <!-- Include the SDK -->
    <script src="js/web-agent.libs.js"></script>
    <script src="js/web-agent.js"></script>
    <script src="js/web-agent.webrtc.js"></script>
</head>
<body>
    <script>
        // Your code here
    </script>
</body>
</html>
```

### Basic Usage

```javascript
// 1. Initialize agent
const agent = new AgentConnection({
    usePubKey: false
});

// 2. Set message handler
agent.onMessage = (message) => {
    console.log('Received:', message.content);
    displayMessage(message);
};

// 3. Connect to channel
async function connect() {
    // Get fresh temporary API key
    const config = await fetch('/api/config?ttlSeconds=300').then(r => r.json());
    
    agent.connect({
        channelName: 'my-channel',
        channelPassword: 'secret123',
        agentName: 'web-user-1',
        api: 'http://localhost:8082',
        apiKey: config.apiKey,
        autoReceive: true
    });
    
    console.log('Connected!');
}

// 4. Send messages
function sendMessage(text) {
    agent.sendTextMessage(text);
}

// 5. Disconnect
function disconnect() {
    agent.disconnect();
}
```

### WebRTC Video Chat

```javascript
// Initialize WebRTC
const webrtc = new WebRTCHelper({
    localVideoElement: document.getElementById('localVideo'),
    remoteVideoContainer: document.getElementById('remoteVideos')
});

// Set WebRTC helper on agent
agent.setWebRTCHelper(webrtc);

// Start local camera
async function startCamera() {
    await webrtc.startLocalStream({
        video: true,
        audio: true
    });
}

// Connect with WebRTC enabled
agent.connect({
    channelName: 'video-channel',
    channelPassword: 'pass',
    agentName: 'user-1',
    api: 'http://localhost:8082',
    apiKey: config.apiKey,
    enableWebrtcRelay: true,  // Enable WebRTC
    autoReceive: true
});
```

### Complete Examples

#### Chat Application

```html
<!DOCTYPE html>
<html>
<head>
    <title>Chat App</title>
    <script src="js/web-agent.libs.js"></script>
    <script src="js/web-agent.js"></script>
    <style>
        #messages { height: 400px; overflow-y: scroll; border: 1px solid #ccc; padding: 10px; }
        .message { margin: 5px 0; }
    </style>
</head>
<body>
    <div id="messages"></div>
    <input type="text" id="messageInput" placeholder="Type message...">
    <button onclick="sendMessage()">Send</button>
    
    <script>
        const agent = new AgentConnection({ usePubKey: false });
        
        // Display messages
        agent.onMessage = (msg) => {
            const div = document.createElement('div');
            div.className = 'message';
            div.textContent = `${msg.from}: ${msg.content}`;
            document.getElementById('messages').appendChild(div);
        };
        
        // Connect on page load
        window.onload = async () => {
            const config = await fetch('/api/config?ttlSeconds=300').then(r => r.json());
            agent.connect({
                channelName: 'chat-room',
                channelPassword: 'password',
                agentName: 'user-' + Date.now(),
                api: 'http://localhost:8082',
                apiKey: config.apiKey,
                autoReceive: true
            });
        };
        
        // Send message
        function sendMessage() {
            const input = document.getElementById('messageInput');
            agent.sendTextMessage(input.value);
            input.value = '';
        }
    </script>
</body>
</html>
```

### Live Examples

Visit these URLs after starting the platform:

- **Chat Example:** `http://localhost:8083/examples/chat.html`
- **WebRTC Example:** `http://localhost:8083/examples/webrtc.html`
- **Index:** `http://localhost:8083/examples/index.html`

---

## Examples

### Example 1: Simple Chat Room

**Scenario:** Two users chatting in a channel

```java
// User 1
AgentConnection user1 = new AgentConnection("http://localhost:8082", "api-key");
user1.setOnMessage(msg -> System.out.println("User1 received: " + msg.getContent()));
user1.connect("chat-room", "alice", "password123");
user1.sendTextMessage("Hi Bob!");

// User 2
AgentConnection user2 = new AgentConnection("http://localhost:8082", "api-key");
user2.setOnMessage(msg -> System.out.println("User2 received: " + msg.getContent()));
user2.connect("chat-room", "bob", "password123");
user2.sendTextMessage("Hi Alice!");
```

### Example 2: Broadcasting Bot

**Scenario:** Bot that broadcasts messages to all connected agents

```python
class BroadcastBot:
    def __init__(self, api_url, api_key):
        self.agent = AgentConnection(api_url, api_key)
    
    def broadcast(self, channel, message, interval=60):
        self.agent.connect(channel, "broadcast-bot", "bot-pass")
        
        while True:
            self.agent.send_text_message(f"[Broadcast] {message}")
            time.sleep(interval)

# Usage
bot = BroadcastBot("http://localhost:8082", "api-key")
bot.broadcast("announcements", "Server status: OK", interval=300)
```

### Example 3: Video Conference Room

**Scenario:** Multiple users in a video call

```javascript
// User joins video room
const agent = new AgentConnection();
const webrtc = new WebRTCHelper({
    localVideoElement: document.getElementById('myVideo'),
    remoteVideoContainer: document.getElementById('participants')
});

agent.setWebRTCHelper(webrtc);

// Connect and start camera
async function joinVideoCall(roomName, userName) {
    const config = await fetch('/api/config').then(r => r.json());
    
    await webrtc.startLocalStream({ video: true, audio: true });
    agent.connect({
        channelName: roomName,
        channelPassword: 'room-password',
        agentName: userName,
        api: 'http://localhost:8082',
        apiKey: config.apiKey,
        enableWebrtcRelay: true,
        autoReceive: true
    });
    
    console.log('Joined video call:', roomName);
}

joinVideoCall('meeting-room-1', 'john-doe');
```

### Example 4: File Transfer

**Scenario:** Sending files between agents

```java
// Sender
byte[] fileData = Files.readAllBytes(Paths.get("document.pdf"));
String base64Data = Base64.getEncoder().encodeToString(fileData);

EventMessage fileMsg = new EventMessage();
fileMsg.setType(EventMessage.EventType.CUSTOM);
fileMsg.setContent("{\"type\":\"file\",\"name\":\"document.pdf\",\"data\":\"" + base64Data + "\"}");
agent.send(fileMsg);

// Receiver
agent.setOnMessage(msg -> {
    if (msg.getType() == EventMessage.EventType.CUSTOM) {
        JSONObject json = new JSONObject(msg.getContent());
        if ("file".equals(json.getString("type"))) {
            String fileName = json.getString("name");
            byte[] data = Base64.getDecoder().decode(json.getString("data"));
            Files.write(Paths.get("received-" + fileName), data);
            System.out.println("File received: " + fileName);
        }
    }
});
```

---

## API Reference

### AgentConnection

#### Constructor

**Java:**
```java
AgentConnection()
AgentConnection(String api, String apiKey)
```

**Python:**
```python
AgentConnection(api_url=None, api_key=None)
```

**JavaScript:**
```javascript
new AgentConnection(options)
```

#### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `connect()` | Connect to channel | channel, agentName, password | void/Promise |
| `disconnect()` | Close connection | - | void |
| `sendTextMessage()` | Send text message | content | void |
| `send()` | Send custom message | EventMessage | void |
| `receiveMessages()` | Get message history | startOffset, endOffset, limit | EventMessageResult |
| `setOnMessage()` | Set message handler | callback | void |

### EventMessage

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `from` | String | Sender agent name |
| `to` | String | Recipient (optional) |
| `content` | String | Message content |
| `type` | EventType | Message type (CHAT_TEXT, CUSTOM, etc.) |
| `date` | Long | Unix timestamp |
| `localOffset` | Long | Channel offset |
| `globalOffset` | Long | Kafka offset |
| `encrypted` | Boolean | Encryption flag |

#### Types

```java
enum EventType {
    CHAT_TEXT,
    CHAT_IMAGE,
    CHAT_FILE,
    WEBRTC_SIGNAL,
    CUSTOM
}
```

---

## Best Practices

### 1. API Key Security

✅ **DO:**
- Use temporary API keys (5-15 minute TTL)
- Request fresh keys for each connection
- Never hardcode API keys in client code
- Store keys in environment variables

❌ **DON'T:**
- Reuse API keys across sessions
- Store API keys in browser localStorage
- Commit API keys to git

**Example:**
```javascript
// GOOD: Fetch fresh key on each connect
async function connect() {
    const response = await fetch('/api/config?ttlSeconds=300');
    const config = await response.json();
    agent.connect({
        channelName: 'my-channel',
        channelPassword: 'password',
        agentName: 'my-agent',
        api: config.api,
        apiKey: config.apiKey,
        autoReceive: true
    });
        apiKey: config.apiKey  // Fresh temporary key
    });
}

// BAD: Storing and reusing key
const API_KEY = "hardcoded-key";  // ❌ Never do this!
```

### 2. Message Handling

✅ **DO:**
- Handle connection failures gracefully
- Implement message retry logic
- Use message offsets for recovery
- Validate message content

**Example:**
```java
agent.setOnMessage(msg -> {
    try {
        // Validate message
        if (msg.getContent() == null || msg.getContent().isEmpty()) {
            logger.warn("Received empty message");
            return;
        }
        
        // Process message
        processMessage(msg);
        
        // Track offset for recovery
        lastProcessedOffset = msg.getLocalOffset();
        
    } catch (Exception e) {
        logger.error("Message processing failed", e);
        // Don't throw - handle gracefully
    }
});
```

### 3. Connection Management

✅ **DO:**
- Always disconnect when done
- Handle reconnection scenarios
- Monitor connection state
- Implement heartbeat/ping

**Example:**
```javascript
// Graceful shutdown
window.addEventListener('beforeunload', () => {
    if (agent && agent.isConnected()) {
        agent.disconnect();
    }
});

// Auto-reconnect
agent.onDisconnect = () => {
    console.log('Disconnected, attempting reconnect...');
    setTimeout(() => reconnect(), 5000);
};
```

### 4. WebRTC Best Practices

✅ **DO:**
- Check browser compatibility
- Handle permission prompts
- Clean up streams on disconnect
- Use TURN servers for NAT traversal

**Example:**
```javascript
// Check WebRTC support
if (!navigator.mediaDevices || !RTCPeerConnection) {
    alert('WebRTC not supported in this browser');
    return;
}

// Request permissions
try {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });
    // Use stream
} catch (err) {
    console.error('Camera/mic access denied:', err);
    // Fallback to text-only
}

// Cleanup
function cleanup() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
}
```

### 5. Performance

✅ **DO:**
- Batch messages when possible
- Use appropriate message limits
- Implement pagination for history
- Clean up old message references

**Example:**
```java
// Efficient message retrieval
EventMessageResult result = agent.receiveMessages(
    startOffset,
    endOffset,
    100  // Reasonable limit
);

// Process in batches
List<EventMessage> messages = result.getEvents();
for (int i = 0; i < messages.size(); i += 10) {
    List<EventMessage> batch = messages.subList(i, Math.min(i + 10, messages.size()));
    processBatch(batch);
}
```

---

## Troubleshooting

### Common Issues

#### 1. Invalid Agent Name

**Symptoms:** "Invalid agentName: must contain only letters, numbers, hyphens (-), and underscores (_)"

**Cause:** Agent name contains invalid characters

**Solutions:**
- Use only letters (a-z, A-Z), numbers (0-9), hyphens (-), underscores (_)
- Remove spaces and special characters (@, #, $, %, etc.)
- Examples:
  - ❌ Bad: `user@1`, `my agent`, `bot$special`
  - ✅ Good: `user-1`, `my-agent`, `bot_special`

**Fix:**
```java
// Before (invalid)
agent.connect("channel", "user@domain.com", "password");

// After (valid)
agent.connect("channel", "user-domain-com", "password");
```

#### 2. Connection Failed

**Symptoms:** "Connection refused" or timeout errors

**Solutions:**
- Check messaging service is running: `docker ps`
- Verify API URL is correct
- Check firewall/network settings
- Ensure API key is valid

**Debug:**
```bash
# Check service status
curl http://localhost:8082/messaging-platform/api/v1/messaging-service/health

# Check logs
docker logs messaging-service
```

#### 3. Messages Not Received

**Symptoms:** Send succeeds but receiver gets nothing

**Solutions:**
- Verify both agents on same channel
- Check channel password matches
- Confirm receiver is connected
- Check message offset range

**Debug:**
```java
// Enable debug logging
agent.setDebug(true);

// Check connection status
if (!agent.isConnected()) {
    System.out.println("Agent not connected!");
}

// Verify channel
System.out.println("Connected to: " + agent.getChannelId());
```

#### 3. API Key Expired

**Symptoms:** "401 Unauthorized" or "Invalid API key"

**Solutions:**
- Request fresh temporary key
- Check key TTL hasn't expired
- Verify web-agent service running
- Check rate limits

**Debug:**
```javascript
// Check key validity
const response = await fetch('/api/config?ttlSeconds=300');
if (!response.ok) {
    console.error('Failed to get API key:', response.status);
}
const config = await response.json();
console.log('API key expires at:', new Date(config.expiresAt * 1000));
```

#### 4. WebRTC Connection Issues

**Symptoms:** No video/audio despite successful connect

**Solutions:**
- Check camera/mic permissions
- Verify TURN server configured
- Check firewall for UDP traffic
- Test with different browsers

**Debug:**
```javascript
// Check ICE candidates
webrtc.onIceCandidate = (candidate) => {
    console.log('ICE candidate:', candidate.type);
};

// Check connection state
webrtc.onConnectionStateChange = (state) => {
    console.log('WebRTC state:', state);
    if (state === 'failed') {
        console.error('WebRTC connection failed - check TURN servers');
    }
};
```

#### 5. Kafka Key Mismatch

**Symptoms:** Messages sent but not retrieved from Kafka

**Solution:** This was a bug fixed in Dec 27, 2025. Update to latest version.

**Verify Fix:**
```bash
# Check service version
curl http://localhost:8082/messaging-platform/api/v1/messaging-service/health

# Should be >= 1.0.0 (Dec 27, 2025)
```

### Getting Help

1. **Check logs:**
   ```bash
   docker logs messaging-service
   docker logs kafka
   docker logs redis
   ```

2. **Enable debug mode:**
   ```java
   agent.setDebug(true);
   ```

3. **Check documentation:**
   - `/messaging-platform-sdk/AI/INDEX.md`

4. **Common error codes:**
   - `401`: Invalid/expired API key
   - `403`: Permission denied (wrong password)
   - `404`: Channel not found
   - `429`: Rate limit exceeded

---

## Additional Resources

### Documentation

- **API Endpoints:** See `PROJECT-ARCHITECTURE.md`
- **Database Schema:** See `DATABASE-SCHEMA-MANAGEMENT.md`
- **Temporary Keys:** See `TEMPORARY-API-KEY-SYSTEM.md`

### Source Code

```
messaging-platform-sdk/
├── agents/
│   ├── java-agent/src/main/java/com/hmdev/messaging/agent/
│   ├── python-agent/messaging_agent/
│   └── web-agent/src/main/resources/static/
└── common/messaging-common/src/main/java/com/hmdev/messaging/common/
```

### Build & Deploy

```bash
# Build SDK
cd messaging-platform-sdk
./gradlew build

# Ensure messaging service is running and available

# Run Tests
./gradlew test
```

---

## License

Copyright © 2025 HMDev. All rights reserved.

See `LICENSE.md` for details.

---

**Questions? Found a bug?**  
Check the troubleshooting section or review the SDK documentation in `/messaging-platform-sdk/AI/` folder.

**Version:** 1.0.0 | **Updated:** January 27, 2026

