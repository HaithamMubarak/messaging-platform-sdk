import os, time
from hmdev.messaging.agent.core.agent_connection import AgentConnection
from hmdev.messaging.agent.core.agent_connection_event_handler import AgentConnectionEventHandler

# Step 2 — connect with your API key
agent = AgentConnection.with_api_key(
    "https://hmdevonline.com/messaging-platform/api/v1/messaging-service",
    os.environ["MESSAGING_PLATFORM_API_KEY"])

# Step 3 — join a channel (created on first use)
agent.connect(os.environ.get("QS_CHANNEL", "quickstart-room"), "channel-password", "python-agent")

# Step 5 — receive
class Printer(AgentConnectionEventHandler):
    def on_message_events(self, events):
        for e in events:
            if e.get("type") == "chat-text":
                print(e.get("from"), "says", e.get("content"), flush=True)

agent.receive_async(Printer())

# Step 4 — send
agent.send_message("Hello from Python!")
time.sleep(int(os.environ.get("QS_WAIT", "20")))
agent.disconnect()
