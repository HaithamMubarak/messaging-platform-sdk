---
name: connect
description: Ready-to-run connect snippets for every SDK — JavaScript, Java, Python, and C++. Covers the minimal code to connect, send a message, receive messages, and disconnect in each language.
when_to_use: Use this skill first whenever you need to connect to a channel using any SDK. Grab the snippet for your language and go.
---

# Connect to a Channel — Any SDK

**Server URL:** `https://hmdevonline.com/messaging-platform/api/v1/messaging-service`
**Developer portal (get API key):** `https://hmdevonline.com/messaging-platform/dashboard`
**Local dev portal:** `http://localhost:8084/developer/index.html`

Recommended `.env` file (all SDKs read this automatically):
```
MESSAGING_API_URL=https://hmdevonline.com/messaging-platform/api/v1/messaging-service
MESSAGING_API_KEY=your-api-key-here
```

---

## JavaScript (Browser)

Include `web-agent.js` and `web-agent.libs.js` from `agents/web-agent-js/js/`.

```html
<script src="web-agent.libs.js"></script>
<script src="web-agent.js"></script>
```

```js
const agent = new AgentConnection({ usePubKey: false });

// Callbacks — set BEFORE connect
agent.onconnect = function(response) {
    console.log('Connected!', response);
};
agent.ondisconnect = function(response) {
    console.log('Disconnected');
};
agent.onMessage = function(msg) {
    console.log(msg.from + ': ' + msg.content);
};

// Connect
agent.connect({
    api: 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service/',
    apiKey: 'your-api-key',          // omit for public channels
    apiKeyScope: 'public',           // 'public' for browser, 'private' for server-side
    channelName: 'my-channel',
    channelPassword: 'mypassword',
    agentName: 'alice',
    pollSource: 'AUTO',              // 'AUTO' | 'CACHE' | 'KAFKA' | 'DATABASE'
    enableWebrtcRelay: false,
});

// Send
agent.sendMessage({ type: 'chat', content: 'hello world' });

// Disconnect
agent.disconnect();
```

> **Note:** `apiKeyScope: 'public'` is correct for browsers. Never put `'private'`-scope keys in browser code.

---

## Java

Source: `agents/java-agent/`

```java
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;
import com.hmdev.messaging.agent.core.AgentConnectionEventHandler;
import com.hmdev.messaging.common.data.EventMessage;

String url = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
String apiKey = "your-api-key";  // or load from env: System.getenv("MESSAGING_API_KEY")

AgentConnection agent = new AgentConnection(url, apiKey);

// Connect
boolean ok = agent.connect(ConnectConfig.builder()
    .channelName("my-channel")
    .channelPassword("mypassword")
    .agentName("alice")
    .apiKeyScope("private")     // "private" (default) or "public"
    .pollSource("AUTO")
    .enableWebrtcRelay(false)
    .build());

if (!ok) {
    System.err.println("Connect failed");
    return;
}

// Send
agent.sendMessage("hello world");                      // broadcast
agent.sendMessage("hey bob", "bob");                   // targeted

// Receive (async loop — runs in background thread)
agent.receiveAsync(new AgentConnectionEventHandler() {
    @Override
    public void onMessage(EventMessage msg) {
        System.out.println(msg.getFrom() + ": " + msg.getContent());
    }
});

// Disconnect
agent.disconnect();
```

**Minimal connect (no API key, default scope):**
```java
AgentConnection agent = new AgentConnection(url);
agent.connect(ConnectConfig.of("my-channel", "mypassword", "alice"));
```

**Connect by channel ID:**
```java
agent.connect(ConnectConfig.withChannelId("cid-xxx", "alice"));
```

---

## Python

Source: `agents/python-agent/hmdev/`
Install: `pip install -e agents/python-agent`

```python
from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.core.agent_connection_event_handler import AgentConnectionEventHandler

url = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service"
api_key = "your-api-key"  # or os.environ.get("MESSAGING_API_KEY")

# Construct with API key
agent = AgentConnection.with_api_key(api_url=url, developer_api_key=api_key)

# Connect (dict-based, recommended)
ok = agent.connect(config={
    "channelName": "my-channel",
    "channelPassword": "mypassword",
    "agentName": "alice",
    "apiKeyScope": "private",    # "private" or "public"
    "pollSource": "AUTO",
    "enableWebrtcRelay": False,
})

if not ok:
    print("Connect failed")
    exit(1)

# Send
agent.send_message("hello world")             # broadcast
agent.send_message("hey bob", destination="bob")  # targeted

# Receive (async loop — runs in background thread)
class MyHandler(AgentConnectionEventHandler):
    def on_message(self, message):
        print(f"{message.from_agent}: {message.content}")

agent.receive_async(MyHandler())

# Disconnect
agent.disconnect()
```

**Minimal connect (no API key):**
```python
agent = AgentConnection(api_url=url)
agent.connect("my-channel", "mypassword", "alice")
```

---

## C++ *(experimental)*

Source: `agents/cpp-agent/`
Include: `agents/cpp-agent/include/`

```cpp
#include "hmdev/messaging/api/messaging_channel_api.h"
#include "hmdev/messaging/agent/data_models.h"

using namespace hmdev::messaging;

std::string url    = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
std::string apiKey = "your-api-key";

MessagingChannelApi api(url, apiKey);

// Connect (object-based)
std::map<std::string, std::string> config = {
    {"channelName",     "my-channel"},
    {"channelPassword", "mypassword"},
    {"agentName",       "alice"},
    {"apiKeyScope",     "private"},
    {"pollSource",      "AUTO"},
    {"enableWebrtcRelay", "false"},
};
ConnectResponse resp = api.connect(config);
std::string sessionId = resp.sessionId;

// Connect (positional overloads)
// ConnectResponse resp = api.connect("my-channel", "mypassword", "alice");

// Send
api.send(EventType::CHAT_TEXT, "hello world", "*", sessionId, false);

// Receive (single poll, 40s timeout)
ReceiveConfig rcfg;
EventMessageResult result = api.receive(sessionId, rcfg);
for (auto& msg : result.messages) {
    std::cout << msg.from << ": " << msg.content << "\n";
}

// Disconnect
api.disconnect(sessionId);
```

> **Note:** C++ client is experimental — no async receive loop is built-in. Wrap `receive()` in your own thread.

---

## Common parameters

| Parameter | Values | Notes |
|-----------|--------|-------|
| `channelName` | string | Channel identifier |
| `channelPassword` | string | No `* , / \` or spaces |
| `agentName` | string | Your identity in the channel |
| `apiKeyScope` | `"private"` / `"public"` | `"public"` for browsers, `"private"` for servers |
| `pollSource` | `"AUTO"` `"CACHE"` `"KAFKA"` `"DATABASE"` | Default: `"AUTO"` (recommended) |
| `enableWebrtcRelay` | `true` / `false` | Enable WebRTC P2P relay |
| `channelId` | string | Connect by stable ID instead of name+password |
| `sessionId` | string | Reconnect with an existing session |

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Connect returns error / false | Wrong API key, bad channel password, or network unreachable |
| `Channel key shouldn't have...` | Password contains `* , / \` or a space |
| No messages received | Wrong `pollSource` — try `"DATABASE"` for history, `"AUTO"` for live |
| `Channel is in ready/connecting state` (JS) | `agent.connect()` called while already connected — call `disconnect()` first |
| Java `receiveAsync` never fires | `connect()` returned `false` — check the return value first |
