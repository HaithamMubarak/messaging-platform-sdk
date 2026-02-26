# SSH Disconnect Notification Broadcast Fix - February 25, 2026

## Problem
When SSH channel disconnected with error:
```
java.lang.RuntimeException: SSH channel is not connected
```

The reconnect overlay (R button) was not appearing reliably because:
- The disconnect notification was only sent to the single WebSocket client that triggered the error
- Other WebSocket clients connected to the same session didn't get notified
- If the triggering client's WebSocket was already having issues, the message might not be delivered

## Root Cause
**WebSocket message handlers (`handleTextMessage`) cannot return values** - they are void methods. The protocol is:
- **Input**: Client → Server (one-way, no response expected)
- **Output**: Server → Client (via separate streaming thread)

The SSH disconnection messages (`__SSH_DISCONNECTED__`) must be sent as **outgoing messages** to all connected clients, not as a "response" to the input message.

## Solution
Changed `TerminalWebSocketHandler.handleTextMessage()` to **broadcast** SSH disconnection notifications to **ALL WebSocket clients** connected to the terminal session:

```java
// Check for SSH channel disconnection - this is a critical error
if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
    log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);
    
    // Broadcast disconnection to ALL WebSocket clients connected to this session
    Set<WebSocketSession> clients = sessionClients.get(sessionId);
    if (clients != null) {
        log.info("[WebSocket-Input] Broadcasting SSH disconnect to {} clients for session {}", 
                 clients.size(), sessionId);
        for (WebSocketSession client : clients) {
            try {
                if (client.isOpen()) {
                    // Send special error message that frontend can detect
                    client.sendMessage(new TextMessage("\r\n\u001b[1;31m✖ SSH Connection Lost\u001b[0m\r\n"));
                    client.sendMessage(new TextMessage("\u001b[33mPress R to reconnect...\u001b[0m\r\n"));
                    // Send a marker that frontend can detect to trigger reconnect overlay
                    client.sendMessage(new TextMessage("__SSH_DISCONNECTED__\r\n"));
                }
            } catch (Exception sendEx) {
                log.warn("[WebSocket-Input] Failed to send disconnect notification to client: {}", 
                         sendEx.getMessage());
            }
        }
    }
    return;
}
```

## Benefits
1. **All connected clients** are notified immediately
2. **Reliable notification** - sends to all healthy WebSocket connections
3. **R button** reconnect overlay appears for all viewers
4. **Graceful error handling** - doesn't fail if one client has issues

## Frontend Handling
The frontend (`terminal.js`) already handles the `__SSH_DISCONNECTED__` marker:
```javascript
if (data.includes('__SSH_DISCONNECTED__')) {
    console.error('[WS] SSH channel disconnected for session:', sessionId);
    session.connected = false;
    session.dataSender = null;
    updateTab(sessionId, true);
    showReconnectOverlay(sessionId);  // Shows R button
    showToast('warning', 'SSH Disconnected', 'Connection lost. Press R to reconnect.');
}
```

## Files Modified
- `sdk-local-service/src/main/java/com/hmdev/sdk/local/terminal/websocket/TerminalWebSocketHandler.java`

## Testing
1. Create SSH terminal session
2. Let SSH connection timeout or disconnect
3. Try typing in terminal
4. Verify:
   - Error message appears: "✖ SSH Connection Lost"
   - Instruction appears: "Press R to reconnect..."
   - Reconnect overlay appears with R button
   - All connected WebSocket clients receive notification

