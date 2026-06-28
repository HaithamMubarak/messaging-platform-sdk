---
name: python-agent
description: Python agent SDK — AgentConnection methods, connect config, async receive, UDP, and AES encryption. Covers agents/python-agent/hmdev/.
when_to_use: Use when building a Python bot, script, or automation agent — connecting to a channel, sending/receiving messages, or using UDP in Python.
---

# Python Agent

Source: `agents/python-agent/hmdev/messaging/agent/`

Key modules:

| Module | Role |
|--------|------|
| `core/agent_connection.py` | High-level agent (`AgentConnection` class) |
| `api/impl/messaging_channel_api.py` | Low-level HTTP transport |
| `api/impl/udp_client.py` | UDP send/receive |
| `api/models.py` | `ConnectResponse`, `EventMessageResult`, `AgentInfo`, `ReceiveConfig` |
| `security/my_security.py` | AES-CTR encrypt/decrypt, RSA |
| `security/aes/aes_ctr.py` | AES-CTR implementation |
| `util/session_recovery_utility.py` | Last-session recovery helper |

---

## Construction

```python
from hmdev.messaging.agent.core.agent_connection import AgentConnection

# Simple
agent = AgentConnection(api_url="https://hmdevonline.com")

# With developer API key (preferred)
agent = AgentConnection.with_api_key(
    api_url="https://hmdevonline.com",
    developer_api_key="your-api-key"
)
```

---

## Connect

```python
# Dict-based (recommended)
agent.connect(config={
    "channelName": "my-channel",
    "channelPassword": "secret",
    "agentName": "bot-1",
    "apiKeyScope": "private",   # "private" or "public"
    "pollSource": "AUTO",       # "AUTO" | "CACHE" | "KAFKA" | "DATABASE"
    "enableWebrtcRelay": False,
})

# Positional (legacy, still supported)
agent.connect("my-channel", "secret", "bot-1")

# Connect by channel ID (skip password derivation)
agent.connect_with_channel_id(
    channel_id="cid-xxx",
    agent_name="bot-1",
    maybe_channel_name="my-channel"  # optional
)
```

Returns `True` on success.

`_check_last_session = True` by default — recovers the last known session on reconnect. Set to `False` to start fresh.

---

## Send

```python
# Broadcast text
agent.send_message("hello world")

# Targeted
agent.send_message("hello bob", destination="bob")

# With filter regex flag
agent.send_message("hello", destination="bob", as_filter_regex=True)

# Camel-case alias (mirrors Java naming)
agent.sendMessage("hello")

# UDP fast send (unreliable)
agent.udp_push_message("payload", destination="*")
agent.udpPushMessage("payload", "*")   # alias
```

---

## Receive (synchronous)

```python
from hmdev.messaging.agent.api.models import ReceiveConfig

result = agent.receive(agent.initial_receive_config)
# or current position:
result = agent.receive(agent.current_receive_config)

for msg in result.messages:
    print(f"{msg.from_agent}: {msg.content}")

# UDP receive
result = agent.udp_pull(receive_config)
agent.udpPull(receive_config)   # alias
```

---

## Receive (async loop)

```python
from hmdev.messaging.agent.core.agent_connection_event_handler import AgentConnectionEventHandler

class MyHandler(AgentConnectionEventHandler):
    def on_message(self, message):
        print(f"{message.from_agent}: {message.content}")

agent.receive_async(MyHandler())
# Spins a daemon thread; stops when agent.disconnect() is called
```

---

## Disconnect

```python
agent.disconnect()
```

---

## Agent presence

```python
agents = agent.get_active_agents()  # list of AgentInfo
# AgentInfo fields: agent_name, connection_time, metadata, ...
```

---

## Key state attributes

| Attribute | Notes |
|-----------|-------|
| `agent.agent_name` | Set after successful connect |
| `agent.channel_id` | Stable channel ID |
| `agent.channel_secret` | Derived AES secret (channelName + password) |
| `agent.initial_receive_config` | Offset at connect time (start of channel) |
| `agent.current_receive_config` | Offset at current position |
| `agent.connection_time` | Float epoch seconds of connect |
| `agent._ready_state` | `True` when connected |
| `agent._session_id` | Internal session token |

---

## Encryption (AES-CTR)

```python
from hmdev.messaging.agent.security.my_security import MySecurity

sec = MySecurity()
ciphertext = sec.encrypt(plaintext, agent.channel_secret)
plaintext  = sec.decrypt(ciphertext, agent.channel_secret)
```

RSA helpers (`MySecurity.rsa_generate`, `rsa_encrypt`, `rsa_decrypt`) are available for the password-request protocol.

---

## Password-request protocol

```python
# Requesting agent (needs the password):
agent.password_request_handler = None  # don't respond to requests

# Agent that holds the password — set a callable:
def on_password_request(channel_id, requester_name, requester_public_key_pem):
    return True  # return True to send the encrypted reply

agent.password_request_handler = on_password_request
```

---

## Notes for assistants

- Use `with_api_key()` class method — the default constructor does not accept an API key.
- `send_message` / `sendMessage` are equivalent; the camelCase form exists for developers coming from Java.
- `initial_receive_config` points to the start of the channel's history; `current_receive_config` is the live head — use `current` for "only new messages since I connected".
- The `enable_webrtc_relay` attribute exists on `AgentConnection` but WebRTC in Python is rudimentary — signaling messages can be sent/received but no peer connection is managed in Python.
- Package install: `pip install -e agents/python-agent` (editable) or reference via `PYTHONPATH`.
