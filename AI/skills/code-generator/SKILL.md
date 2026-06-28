---
name: code-generator
description: Generate ready-to-run connection code or docs for any SDK language (Python, Java, JS, C++), or produce the ai_channel_agent.py file for running an AI-powered bot. Default language is Python. Claude generates code directly from templates — no script needed.
when_to_use: Use whenever the user asks to generate connection code or docs for a channel, wants a runnable file for a specific language, or wants to run an AI agent on a channel.
---

# Code Generator & AI Agent

Claude generates code directly from the templates below. No script file needed for generation.

**Default language: Python** — use it unless the user specifies another.

---

## Config resolution

Before generating, resolve these values in priority order:

| Value | Priority |
|-------|----------|
| `url` | `--url` arg → `MESSAGING_API_URL` env → services `.env` `MESSAGING_API_URL` → `https://hmdevonline.com/messaging-platform/api/v1/messaging-service` |
| `key` | `--key` arg → `MESSAGING_API_KEY` env → services `.env` `DEFAULT_API_KEY` → `""` |

Services `.env` is at `../messaging-platform-services/.env` relative to the SDK root. Parse it with:
```python
# simple .env parse — skip comments, split on first =
{k.strip(): v.strip() for line in open(path)
 if not line.startswith("#") and "=" in line
 for k, v in [line.partition("=")[::2]]}
```

Tell the user which source the key/URL came from.

---

## Python agent template

```python
#!/usr/bin/env python3
import os, sys, time, signal
from typing import List, Dict, Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "agents/python-agent"))

from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.core.agent_connection_event_handler import AgentConnectionEventHandler

API_URL      = os.environ.get("MESSAGING_API_URL", "<URL>")
API_KEY      = os.environ.get("MESSAGING_API_KEY", "<KEY>")
CHANNEL_NAME = "<channel>"
CHANNEL_PASS = "<password>"
AGENT_NAME   = "<agent>"

class MyHandler(AgentConnectionEventHandler):
    def on_message_events(self, message_events: List[Dict[str, Any]]) -> None:
        for ev in message_events:
            from_agent = ev.get("from", "?")
            content    = ev.get("content", "")
            msg_type   = ev.get("type", "")
            if from_agent == AGENT_NAME:
                continue
            if msg_type in ("agent-connect", "agent-disconnect"):
                print(f"[presence] {msg_type}: {from_agent}")
                continue
            if content.strip():
                print(f"[{msg_type}] {from_agent}: {content}")
                # agent.send_message("reply here", destination=from_agent)

agent = AgentConnection.with_api_key(api_url=API_URL, developer_api_key=API_KEY)
ok = agent.connect(config={
    "channelName":     CHANNEL_NAME,
    "channelPassword": CHANNEL_PASS,
    "agentName":       AGENT_NAME,
    "apiKeyScope":     "private",
    "pollSource":      "AUTO",
})
if not ok:
    print("connect() failed", file=sys.stderr); sys.exit(1)

print(f"Connected as {AGENT_NAME}. Listening...")
agent.receive_async(MyHandler())

def on_exit(sig, frame):
    agent.disconnect(); sys.exit(0)
signal.signal(signal.SIGINT, on_exit)
signal.signal(signal.SIGTERM, on_exit)
while agent.is_ready():
    time.sleep(1)
```

---

## Java agent template

```java
import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;
import com.hmdev.messaging.agent.core.AgentConnectionEventHandler;
import com.hmdev.messaging.common.data.EventMessage;

public class ChannelConnect {
    static final String API_URL  = System.getenv().getOrDefault("MESSAGING_API_URL", "<URL>");
    static final String API_KEY  = System.getenv().getOrDefault("MESSAGING_API_KEY", "<KEY>");

    public static void main(String[] args) throws Exception {
        AgentConnection agent = new AgentConnection(API_URL, API_KEY);

        boolean ok = agent.connect(ConnectConfig.builder()
            .channelName("<channel>")
            .channelPassword("<password>")
            .agentName("<agent>")
            .apiKeyScope("private")
            .build());

        if (!ok) { System.err.println("connect() failed"); System.exit(1); }

        agent.receiveAsync(new AgentConnectionEventHandler() {
            @Override public void onMessage(EventMessage msg) {
                if ("<agent>".equals(msg.getFrom())) return;
                System.out.println(msg.getFrom() + ": " + msg.getContent());
                // agent.sendMessage("reply", msg.getFrom());
            }
        });

        Runtime.getRuntime().addShutdownHook(new Thread(agent::disconnect));
        Thread.currentThread().join();
    }
}
```

---

## JavaScript (browser) template

```html
<script src="web-agent.libs.js"></script>
<script src="web-agent.js"></script>
<script>
const agent = new AgentConnection({ usePubKey: false });

agent.onconnect    = r  => console.log("connected", r);
agent.ondisconnect = () => console.log("disconnected");
agent.onMessage    = msg => {
    if (msg.from === "<agent>") return;
    console.log(msg.from + ": " + msg.content);
    // agent.sendMessage({ type: "chat", content: "reply", destination: msg.from });
};
agent.onerror = err => console.error(err);

agent.connect({
    api:             "<URL>/",
    apiKey:          "<KEY>",
    apiKeyScope:     "public",       // use "public" for browsers
    channelName:     "<channel>",
    channelPassword: "<password>",
    agentName:       "<agent>",
    pollSource:      "AUTO",
});
</script>
```

> Use `apiKeyScope: "public"` for browsers; never put a `private`-scope key in frontend code.

---

## C++ agent template *(experimental)*

```cpp
#include "hmdev/messaging/api/messaging_channel_api.h"
#include "hmdev/messaging/agent/data_models.h"
#include <iostream>
#include <csignal>
#include <atomic>

using namespace hmdev::messaging;
static std::atomic<bool> running{true};

int main() {
    std::signal(SIGINT, [](int){ running = false; });

    MessagingChannelApi api("<URL>", "<KEY>");
    ConnectResponse resp = api.connect({
        {"channelName",     "<channel>"},
        {"channelPassword", "<password>"},
        {"agentName",       "<agent>"},
        {"apiKeyScope",     "private"},
        {"pollSource",      "AUTO"},
    });
    if (resp.sessionId.empty()) { std::cerr << "connect failed\n"; return 1; }

    ReceiveConfig rcfg;
    while (running) {
        auto result = api.receive(resp.sessionId, rcfg);
        for (auto& msg : result.messages) {
            if (msg.from == "<agent>") continue;
            std::cout << msg.from << ": " << msg.content << "\n";
        }
        if (!result.messages.empty()) {
            rcfg.globalOffset = result.nextGlobalOffset;
            rcfg.localOffset  = result.nextLocalOffset;
        }
    }
    api.disconnect(resp.sessionId);
}
```

---

## AI-powered agent (file: `scripts/ai_channel_agent.py`)

This one **must be a real file** — it runs as a long-lived process. Generate and write it to disk, then tell the user how to run it.

Key points when generating:
- Requires `ANTHROPIC_API_KEY`
- Messaging key/URL auto-loaded from services `.env` via `find_services_env()`
- Handler subclasses `AgentConnectionEventHandler` and calls `anthropic.Anthropic(...).messages.create(...)` inside `on_message_events`
- Sends Claude's reply back with `agent.send_message(reply, destination=from_agent)`
- Skips own messages (`from_agent == AGENT_NAME`) to avoid loops
- Skips `agent-connect` / `agent-disconnect` events

See `scripts/ai_channel_agent.py` for the full implementation.

Run it:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
python3 scripts/ai_channel_agent.py \
  --channel <channel> --password <password> --agent claude-bot
```

Options: `--model`, `--system` (prompt text or file), `--history` (turns), `--no-context`, `--scope`, `--verbose`, `--debug`, `--env-file`.

---

## Docs to generate

When the user asks for docs, produce a markdown table like this and fill it in:

```markdown
## Connection details — <channel>

| Field | Value |
|-------|-------|
| Service URL | `<URL>` |
| Channel | `<channel>` |
| Password | `<password>` |
| Agent name | `<agent>` |
| API key scope | `private` / `public` |
| Poll source | `AUTO` |

### Quick start

| Language | How to run |
|----------|-----------|
| Python | `python3 connect.py` |
| Java | Add `java-agent.jar` to classpath, run `ChannelConnect` |
| JavaScript | Include `web-agent.js`, call `agent.connect(...)` |
| C++ | Build with cmake, link agent lib |

### Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `connect() failed` | Wrong key or URL | Check `MESSAGING_API_KEY` / `MESSAGING_API_URL` |
| Password validation | Special chars in password | No `* , / \` or spaces |
| No messages | Wrong poll source | Use `AUTO` (live) or `DATABASE` (history) |
```

---

## Notes for assistants

- **Always default to Python** unless the user says otherwise.
- Fill `<URL>`, `<KEY>`, `<channel>`, `<password>`, `<agent>` from context before showing code — never show unfilled placeholders if the values are known.
- For the AI agent, `scripts/ai_channel_agent.py` already exists — don't regenerate it; tell the user to run it.
- If the services `.env` is missing and no key is provided, ask the user for their API key or tell them to set `MESSAGING_API_KEY`.
