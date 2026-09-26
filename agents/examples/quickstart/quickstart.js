const { AgentConnection } = require(process.env.SDK_JS || '../../web-agent-js');   // in a page: the two <script> tags
const API = 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service';

// Step 2 — create a connection and listen before connecting
const agent = new AgentConnection();
agent.addEventListener('message', e => {                           // Step 5 — receive
  e.response.data.filter(m => m.type === 'chat-text')
    .forEach(m => console.log(m.from, 'says', m.content));
});
agent.addEventListener('agent-connect', e => console.log(e.agentName, 'joined'));
agent.addEventListener('connect', e => {
  if (e.response.status !== 'success') return console.error('connect failed', e.response);
  agent.sendMessage({ content: 'Hello from the browser!' });       // Step 4 — send
});

// Step 3 — join a channel (created on first use)
agent.connect({
  api: API,
  apiKey: process.env.MESSAGING_PLATFORM_API_KEY,   // in a page: a short-lived temporary key
  channelName: process.env.QS_CHANNEL || 'quickstart-room',
  channelPassword: 'channel-password',
  agentName: 'browser-user',
  autoReceive: true,
});
setTimeout(() => { agent.disconnect && agent.disconnect(); process.exit(0); }, 15000);
