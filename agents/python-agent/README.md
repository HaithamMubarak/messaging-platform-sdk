# Messaging Platform Python agent

Python 3.10 or newer is required (the runtime uses Python 3.10 union annotations).
The package includes the channel API, HTTP/WebSocket/UDP helpers, cryptographic
helpers and a local TCP-control entry point.

From this directory, install into a virtual environment with `python -m pip
install .`. Run `hmdev-agent --help` for the TCP-only command's options. This
command is not a complete chat client; the example is `python -m hmdev.chat_example
--help`. No production connection is needed to print help.

## Channel storage

Each channel has a key-value store on the server, with versions: the same
store, and the same wire format, as the web agent's `storage*` methods. Once
connected, `connection.storage` has the calls:

```python
from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.api.impl.channel_storage import StorageError

agent = AgentConnection.with_api_key(api_url, api_key)
agent.connect(channel_name="my-room", channel_password="secret-pw", agent_name="bot")

agent.storage.put("settings", {"theme": "dark"}, encrypted=True)  # replace every version
entry = agent.storage.get("settings")       # latest version, or None when nothing is stored
entry.value, entry.written_by               # {'theme': 'dark'}, 'bot'

agent.storage.add("audit", {"event": "opened"}, append_only=True)  # append; locks a new key
[e.value for e in agent.storage.get_list("audit")]                # every version, newest first
agent.storage.keys()                        # ['audit', 'settings']
agent.storage.delete_by_key("settings")     # how many versions were deleted

try:
    agent.storage.put("audit", "overwrite")
except StorageError as e:
    e.append_only, e.http_status            # True, 409: the log is append-only
```

- A dict, list, number or bool is stored as JSON and read back parsed; a
  string is stored as is.
- `encrypted=True` stores the value under the channel secret (derived from the
  channel name and password), so the server holds only ciphertext. Python, Java
  and web agents read each other's encrypted values. Encrypting without a
  channel secret raises instead of storing the value in clear.
- `written_by` is the agent name the server stamped on the version; a name
  inside the value is only the writer's claim.
- Every failure raises `StorageError`, so a failed read is never mistaken for
  an empty one.

A runnable example: `agents/examples/python-agent-chat/storage_example.py`.

## Release verification

From the repository root run `python tools/check-python-package.py`. It builds
the source archive and a wheel from that archive, then installs each into its
own temporary environment outside the checkout. It verifies module imports,
declared dependencies, the CLI and authenticated-encryption round trips. The
check downloads build/runtime dependencies and cleans up its own environments.
It does not publish a package or contact a messaging service.

Both `requirements.txt` and this README are mandatory source-archive inputs.
An incomplete archive must fail to build instead of producing a wheel with
silently missing dependencies. CI checks Python 3.10 and 3.12 on Linux and Windows.
Cross-language protocol and real-network tests are separate release gates.
