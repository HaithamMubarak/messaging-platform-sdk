# 🎮 Game Developer Quick Start

**Get your game connected in 5 minutes!**

## Step 1: Choose Your Integration Method

### Is your game in Java, Python, or JavaScript?
→ **YES** - Go to [Direct Integration](#direct-integration) (recommended)

### Is your game in C++, C#, Unity, Unreal, or Godot?
→ **YES** - Go to [TCP Bridge](#tcp-bridge)

---

## Direct Integration

### For Java Games

#### 1. Add SDK to your project
```bash
# Copy JAR files to your project
cp messaging-platform-sdk/libs/agents-1.0.0.jar your-game/libs/
cp messaging-platform-sdk/libs/messaging-common-1.0.0.jar your-game/libs/
```

#### 2. Add to your game code
```java
import com.hmdev.messaging.agent.api.impl.MessagingChannelApi;
import com.hmdev.messaging.common.data.*;

public class MyGame {
    private MessagingChannelApi messaging;
    private String sessionId;
    
    public void connectToMultiplayer() {
        // Initialize
        String apiUrl = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
        messaging = new MessagingChannelApi(apiUrl, null);
        
        // Connect to channel
        ConnectResponse response = messaging.connect(
            "my-game-room",     // Channel name
            "secret-password",  // Password
            "player1"           // Your player name
        );
        
        if (response.getSessionId() != null) {
            sessionId = response.getSessionId();
            System.out.println("✅ Connected to multiplayer!");
            startMessagePolling();
        }
    }
    
    public void sendMessage(String message) {
        messaging.push(
            EventMessage.EventType.CHAT_TEXT,
            message,
            "*",           // Send to all players
            sessionId,
            false          // Not encrypted
        );
    }
    
    public void sendGameState(String jsonState) {
        // Use UDP for fast updates
        messaging.udpPush(jsonState, "*", sessionId);
    }
    
    private void startMessagePolling() {
        new Thread(() -> {
            ReceiveConfig config = new ReceiveConfig(0, 0, 50);
            while (true) {
                EventMessageResult result = messaging.pull(sessionId, config);
                result.getMessages().forEach(msg -> {
                    System.out.println("Message: " + msg.getContent());
                });
                if (result.getNextGlobalOffset() != null) {
                    config.setGlobalOffset(result.getNextGlobalOffset());
                }
            }
        }).start();
    }
}
```

#### 3. Run your game
```bash
java -jar your-game.jar
```

**Done!** ✅ Your game is now multiplayer-enabled.

---

### For Python Games

#### 1. Install SDK
```bash
cd messaging-platform-sdk/agents/python-agent
pip install -e .
```

#### 2. Add to your game code
```python
from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.api.models import ReceiveConfig
import threading

class MyGame:
    def __init__(self):
        api_url = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service"
        self.agent = AgentConnection(api_url)
        self.connected = False
    
    def connect_to_multiplayer(self):
        # Connect to channel
        success = self.agent.connect(
            "my-game-room",     # Channel name
            "secret-password",  # Password
            "player1"           # Your player name
        )
        
        if success:
            self.connected = True
            print("✅ Connected to multiplayer!")
            threading.Thread(target=self._poll_messages, daemon=True).start()
        
        return success
    
    def send_message(self, message):
        return self.agent.push_message(message, "*")
    
    def send_game_state(self, json_state):
        # Use UDP for fast updates
        return self.agent.udp_push_message(json_state, "*")
    
    def _poll_messages(self):
        config = ReceiveConfig(global_offset=0, local_offset=0, limit=50)
        while self.connected:
            result = self.agent.pull_messages(config)
            for msg in result.get("messages", []):
                print(f"Message: {msg.get('content')}")
            next_offset = result.get("nextGlobalOffset")
            if next_offset:
                config.global_offset = next_offset

# Use in your game
game = MyGame()
game.connect_to_multiplayer()
game.send_message("Hello, world!")
```

#### 3. Run your game
```bash
python your_game.py
```

**Done!** ✅ Your game is now multiplayer-enabled.

---

### For JavaScript/Web Games

#### 1. Include SDK in your HTML
```html
<script type="module">
import { AgentConnection } from './messaging-platform-sdk/agents/web-agent/js/agent-connection.js';

class MyGame {
    constructor() {
        const apiUrl = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
        this.agent = new AgentConnection(apiUrl);
        this.connected = false;
    }
    
    async connectToMultiplayer() {
        const response = await this.agent.connect(
            "my-game-room",     // Channel name
            "secret-password",  // Password
            "player1"           // Your player name
        );
        
        if (response.sessionId) {
            this.connected = true;
            console.log("✅ Connected to multiplayer!");
            this.startPolling();
        }
        
        return this.connected;
    }
    
    async sendMessage(message) {
        await this.agent.push({
            type: "CHAT_TEXT",
            content: message,
            to: "*"
        });
    }
    
    async sendGameState(jsonState) {
        // Use UDP for fast updates
        await this.agent.udpPush({
            content: jsonState,
            to: "*"
        });
    }
    
    startPolling() {
        let offset = 0;
        const poll = async () => {
            if (!this.connected) return;
            const result = await this.agent.pull({ globalOffset: offset, limit: 50 });
            result.messages.forEach(msg => {
                console.log("Message:", msg.content);
            });
            if (result.nextGlobalOffset) {
                offset = result.nextGlobalOffset;
            }
            setTimeout(poll, 100);
        };
        poll();
    }
}

// Use in your game
const game = new MyGame();
await game.connectToMultiplayer();
game.sendMessage("Hello, world!");
</script>
```

**Done!** ✅ Your game is now multiplayer-enabled.

---

## TCP Bridge

### For C++, C#, Unity, Unreal, Godot Games

#### 1. Start the agent server

**Option A: Java Agent**
```bash
cd messaging-platform-sdk/agents/java-agent
./gradlew build
java -jar build/libs/java-agent-1.0.0.jar --tcp-port=7071
```

**Option B: Python Agent**
```bash
cd messaging-platform-sdk/agents/python-agent
pip install -e .
python -m hmdev.messaging.agent.agent --tcp-server --tcp-port=7071
```

**Leave this running** - it's a bridge between your game and the messaging service.

#### 2. Connect from your game

**C++ Example:**
```cpp
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// Connect to agent
int sock = socket(AF_INET, SOCK_STREAM, 0);
sockaddr_in server;
server.sin_family = AF_INET;
server.sin_port = htons(7071);
inet_pton(AF_INET, "127.0.0.1", &server.sin_addr);
connect(sock, (sockaddr*)&server, sizeof(server));

// Send connect command
json cmd = {
    {"op", "connect"},
    {"channel", "my-game-room"},
    {"password", "secret-password"},
    {"agentName", "player1"}
};
std::string request = cmd.dump() + "\n";
send(sock, request.c_str(), request.length(), 0);

// Receive response
char buffer[4096];
int n = recv(sock, buffer, sizeof(buffer), 0);
buffer[n] = '\0';
json response = json::parse(buffer);

if (response["status"] == "ok") {
    std::string sessionId = response["data"]["sessionId"];
    std::cout << "✅ Connected to multiplayer!" << std::endl;
}

// Send message
json pushCmd = {
    {"op", "push"},
    {"content", "Hello, world!"},
    {"destination", "*"},
    {"sessionId", sessionId}
};
request = pushCmd.dump() + "\n";
send(sock, request.c_str(), request.length(), 0);
```

**C# Unity Example:**
```csharp
using System.Net.Sockets;
using System.IO;
using Newtonsoft.Json.Linq;

// Connect to agent
TcpClient client = new TcpClient("127.0.0.1", 7071);
StreamReader reader = new StreamReader(client.GetStream());
StreamWriter writer = new StreamWriter(client.GetStream()) { AutoFlush = true };

// Send connect command
var cmd = new JObject {
    ["op"] = "connect",
    ["channel"] = "my-game-room",
    ["password"] = "secret-password",
    ["agentName"] = "player1"
};
writer.WriteLine(cmd.ToString());

// Receive response
string response = reader.ReadLine();
JObject result = JObject.Parse(response);

if (result["status"].ToString() == "ok") {
    string sessionId = result["data"]["sessionId"].ToString();
    Debug.Log("✅ Connected to multiplayer!");
}

// Send message
var pushCmd = new JObject {
    ["op"] = "push",
    ["content"] = "Hello, world!",
    ["destination"] = "*",
    ["sessionId"] = sessionId
};
writer.WriteLine(pushCmd.ToString());
```

**Done!** ✅ Your game is now multiplayer-enabled.

---

## Common Operations

### Send Chat Message
```java
// Java/Direct
messaging.push(EventMessage.EventType.CHAT_TEXT, "Hi!", "*", sessionId, false);

// Python/Direct
agent.push_message("Hi!", "*")

// TCP Bridge (JSON)
{"op":"push","content":"Hi!","destination":"*","sessionId":"abc123"}
```

### Send Game State (Fast UDP)
```java
// Java/Direct
messaging.udpPush("{\"x\":100,\"y\":200}", "*", sessionId);

// Python/Direct
agent.udp_push_message('{"x":100,"y":200}', "*")

// TCP Bridge (JSON)
{"op":"udpPush","content":"{\"x\":100,\"y\":200}","destination":"*","sessionId":"abc123"}
```

### Receive Messages
```java
// Java/Direct
ReceiveConfig config = new ReceiveConfig(0, 0, 50);
EventMessageResult result = messaging.pull(sessionId, config);

// Python/Direct
config = ReceiveConfig(global_offset=0, local_offset=0, limit=50)
result = agent.pull_messages(config)

// TCP Bridge (JSON)
{"op":"pull","startOffset":0,"limit":50,"sessionId":"abc123"}
```

---

## Testing Locally

### 1. Ensure messaging service is running

Make sure the messaging service is available at your configured endpoint.

### 2. Change API URL in your game
```java
// Use local service instead of production
String apiUrl = "http://localhost:8082/messaging-platform/api/v1/messaging-service";
```

### 3. Test with multiple players
Open multiple game instances with different player names:
- Player 1: `agentName = "player1"`
- Player 2: `agentName = "player2"`

They'll see each other's messages! 🎮

---

## Performance Tips

### For Real-time Games
- ✅ Use **UDP push/pull** for position updates (fast but unreliable)
- ✅ Use **HTTP push/pull** for chat/important events (reliable but slower)
- ✅ Poll every 100ms for smooth updates
- ✅ Send position updates 10-60 times per second

### For Turn-based Games
- ✅ Use **HTTP push/pull** for all operations (reliability important)
- ✅ Poll every 1-5 seconds (no need for frequent updates)
- ✅ Use encryption for competitive games

---

## Troubleshooting

### "Connection refused"
- ✅ Check messaging service is running: `curl http://localhost:8082/health`
- ✅ Check firewall allows connections
- ✅ Verify API URL is correct

### "Session expired"
- ✅ Reconnect to channel
- ✅ Check network connectivity
- ✅ Session timeout is 5 minutes by default

### "TCP connection failed" (bridge only)
- ✅ Check agent server is running
- ✅ Verify port 7071 is not blocked
- ✅ Check localhost connectivity

---

## Next Steps

1. ✅ **Read full documentation:** [GAME-INTEGRATION-GUIDE.md](GAME-INTEGRATION-GUIDE.md)
2. ✅ **See examples:** `/agents/examples/` directory
3. ✅ **Join community:** (add your community link)
4. ✅ **Report issues:** (add your issue tracker)

---

## Need Help?

- 📘 **Full Guide:** [GAME-INTEGRATION-GUIDE.md](GAME-INTEGRATION-GUIDE.md)
- ⚡ **Quick Reference:** [GAME-INTEGRATION-QUICK-REF.md](GAME-INTEGRATION-QUICK-REF.md)
- 🎨 **Comparison Chart:** [INTEGRATION-COMPARISON.txt](INTEGRATION-COMPARISON.txt)
- 📚 **Main README:** [README.md](README.md)

---

**Good luck with your game!** 🎮🚀

**Last Updated:** December 30, 2025

