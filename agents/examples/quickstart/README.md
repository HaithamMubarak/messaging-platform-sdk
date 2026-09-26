# Quickstart — the same five steps in three languages

These files are the source of the snippets on the hub's
[quickstart page](https://hmdevonline.com/messaging-platform/hub/quickstart.html).
Change a snippet here first, run it, then copy it to
`web-sdk-server/src/main/resources/static/quickstart.html`.

Each program connects with an API key, joins `quickstart-room`, sends one
message and prints every chat message it receives for ~20 seconds. Run two
(or all three) at once and each prints the others' messages.

```bash
export MESSAGING_PLATFORM_API_KEY=your-key   # from the developer portal
export QS_CHANNEL=quickstart-$RANDOM          # optional: a fresh channel

# Python 3.10+
pip install "git+https://github.com/HaithamMubarak/messaging-platform-sdk.git@develop#subdirectory=agents/python-agent"
python quickstart.py

# Node 18+ (from this directory, inside an SDK checkout)
node quickstart.js

# Java 17 (classpath from the java-agent-chat example project)
javac -cp "<java-agent runtime classpath>" Quickstart.java
java  -cp "<java-agent runtime classpath>;." Quickstart
```

**Verified 2026-09-26** against the live platform: Python, Java and Node on
one channel, each printed all three greetings (`java-agent says Hello from
Java!`, `python-agent says Hello from Python!`, `browser-user says Hello from
the browser!`). The pip line above was installed into a clean venv from the
public GitHub mirror the same day.

Two things the snippets depend on that are easy to get wrong:

- **JS needs `autoReceive: true`**, or an HTTP-polling connection never
  receives anything.
- **Chat events are typed `chat-text`** on the wire (Python, JS) and
  `EventMessage.EventType.CHAT_TEXT` in Java. Filtering on anything else
  prints join/leave events or nothing.

C++ is not here: it has no payload encryption yet, so on a password-protected
channel it can join but cannot read the other SDKs' messages. Its example is
`agents/cpp-agent/examples/basic_chat_example.cpp`.
