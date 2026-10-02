# Messaging Platform SDK examples

Runnable examples for the Messaging Platform SDKs. The browser demos and game
templates are live at the
[Demos page](https://hmdevonline.com/messaging-platform/hub/playground.html);
their source is in `web-sdk-server/` below.

| Folder | What it is | Language |
|---|---|---|
| [`quickstart/`](quickstart/) | The five steps of the [quickstart](https://hmdevonline.com/messaging-platform/hub/quickstart.html): connect, join a channel, send, receive. Run it twice and watch the two talk. | JavaScript, Python, Java |
| [`java-agent-chat/`](java-agent-chat/) | A console chat agent, and an agent that receives a WebRTC video stream. | Java |
| [`python-agent-chat/`](python-agent-chat/) | A console chat agent. | Python |
| [`web-sdk-server/`](web-sdk-server/) | The demo site itself: the browser demos (chat, presence, storage, polls, whiteboard, files, calls, proof logs), the game templates (Air Hockey, Gavel, Chess) and the shared terminal. A Spring Boot app serving static pages. | JavaScript (browser) |
| [`sdk-local-service/`](sdk-local-service/) | The local helper the shared terminal talks to: runs shells, SSH sessions and file operations on your machine. | Java |

## Before you run one

1. Get an API key in the [developer portal](https://hmdevonline.com/messaging-platform/hub/developer/index.html).
   Keep it on your server; browsers use short-lived keys (`POST /channels/api-access`).
2. Follow the README in the example's folder.

More: the [SDK guide](https://hmdevonline.com/messaging-platform/hub/sdk-guide.html) and the
[documentation](https://hmdevonline.com/messaging-platform/hub/docs.html).
