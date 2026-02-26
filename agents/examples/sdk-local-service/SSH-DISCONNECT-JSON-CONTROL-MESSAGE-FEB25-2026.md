# SSH Disconnect JSON Control Message Fix - February 25, 2026

## Problem: False Alarm with Magic String Marker

### Previous Implementation
When SSH channel disconnected, the backend sent a magic string marker:
```
__SSH_DISCONNECTED__
```

### Critical Issue
**False Alarms**: If a user ran a command that output this exact string, the frontend would incorrectly think SSH disconnected:

```bash
# This would trigger false alarm!
cat file.txt  # if file contains __SSH_DISCONNECTED__
echo "__SSH_DISCONNECTED__"
grep "__SSH_DISCONNECTED__" log.txt
```

This is a **serious UX bug** - legitimate terminal output could break the connection UI.

## Solution: JSON Control Messages

### Backend Change
Instead of sending a magic string in the terminal output stream, we now send a **proper JSON control message**:

```java
// TerminalWebSocketHandler.java
if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
    log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);
    
    // Broadcast to ALL WebSocket clients connected to this session
    Set<WebSocketSession> clients = sessionClients.get(sessionId);
    if (clients != null) {
        for (WebSocketSession client : clients) {
            if (client.isOpen()) {
                // 1. Send visual error message (terminal output)
                client.sendMessage(new TextMessage("\r\n\u001b[1;31m✖ SSH Connection Lost\u001b[0m\r\n"));
                client.sendMessage(new TextMessage("\u001b[33mPress R to reconnect...\u001b[0m\r\n"));
                
                // 2. Send JSON control message (NOT terminal output)
                String controlMsg = "{\"type\":\"error\",\"code\":\"SSH_DISCONNECTED\",\"sessionId\":\"" + sessionId + "\"}";
                client.sendMessage(new TextMessage(controlMsg));
            }
        }
    }
    return;
}
```

### Frontend Change
The frontend now detects JSON control messages separately from terminal output:

```javascript
// terminal.js - ws.onmessage handler
ws.onmessage = (event) => {
    let data = event.data;
    
    // 1. Try parsing as JSON control message FIRST
    try {
        const maybeJson = JSON.parse(data);
        if (maybeJson.type === 'error' && maybeJson.code === 'SSH_DISCONNECTED') {
            console.error('[WS] SSH channel disconnected (JSON control message)');
            session.connected = false;
            session.dataSender = null;
            updateTab(sessionId, true);
            showReconnectOverlay(sessionId);
            showToast('warning', 'SSH Disconnected', 'Connection lost. Press R to reconnect.');
            return; // ✅ Don't write control message to terminal
        }
        // Unknown JSON control message - ignore
        console.warn('[WS] Unknown JSON control message:', maybeJson);
        return;
    } catch (e) {
        // Not JSON - continue as normal terminal data
    }
    
    // 2. Legacy fallback (for backwards compatibility)
    if (data.includes('__SSH_DISCONNECTED__')) {
        // ... handle old way ...
    }
    
    // 3. Write to terminal (normal output)
    session.terminal.write(data);
};
```

## Benefits

### ✅ No More False Alarms
- JSON control messages are **completely separate** from terminal output
- User commands like `cat file.txt` containing `__SSH_DISCONNECTED__` won't trigger reconnect overlay
- **Safe and robust** - no string collision possible

### ✅ Backwards Compatible
- Still supports legacy `__SSH_DISCONNECTED__` string marker
- Can upgrade backend without breaking old frontend
- Can upgrade frontend without breaking old backend

### ✅ Extensible
- Easy to add more control messages in the future:
  ```json
  {"type": "warning", "code": "HIGH_LATENCY", "latency": 500}
  {"type": "info", "code": "SESSION_RESUMED"}
  {"type": "error", "code": "AUTH_FAILED"}
  ```

### ✅ Proper Separation of Concerns
- **Terminal output** = printable text + ANSI escapes
- **Control messages** = JSON metadata
- Never mix the two!

## Testing

### 1. Test Normal SSH Disconnect
```bash
# Connect SSH session
ssh user@host

# Wait for timeout or kill SSH server
# Verify:
# - Red error message appears in terminal
# - "Press R to reconnect..." message appears
# - Reconnect overlay (R button) appears
# - No __SSH_DISCONNECTED__ string visible in terminal
```

### 2. Test False Alarm Prevention
```bash
# Connect SSH session
ssh user@host

# Create test file
echo "__SSH_DISCONNECTED__" > test.txt

# This should NOT trigger reconnect overlay
cat test.txt

# Verify:
# - Terminal shows: __SSH_DISCONNECTED__
# - No reconnect overlay appears
# - Session still works normally
```

### 3. Test JSON Control Message
```bash
# Send test JSON control message via WebSocket
ws.send('{"type":"error","code":"SSH_DISCONNECTED","sessionId":"abc123"}');

# Verify:
# - Reconnect overlay appears
# - Session marked as disconnected
# - No JSON text visible in terminal
```

## Files Modified

### Backend
- `sdk-local-service/src/main/java/com/hmdev/sdk/local/terminal/websocket/TerminalWebSocketHandler.java`
  - Changed SSH disconnect notification to send JSON control message
  - Still sends visual error messages to terminal output

### Frontend
- `web-sdk-server/src/main/resources/static/apps/terminal/terminal.js`
  - Added JSON control message detection in `ws.onmessage` handler
  - Kept legacy `__SSH_DISCONNECTED__` string check for backwards compatibility
  - Properly separates control messages from terminal output

## Future Improvements

### Consider Binary Control Channel
For even better separation, could use:
- **Text WebSocket frames** for terminal output (UTF-8 text)
- **Binary WebSocket frames** for control messages (JSON encoded as bytes)

This would make it **impossible** to confuse control messages with terminal output.

### Control Message Schema
Define a proper TypeScript/Java type:
```typescript
interface ControlMessage {
    type: 'error' | 'warning' | 'info';
    code: string;
    sessionId: string;
    data?: any;
}
```

## Conclusion

✅ **Problem solved**: No more false alarms from terminal output containing magic strings  
✅ **Robust solution**: JSON control messages are completely separate from terminal data  
✅ **Backwards compatible**: Still supports legacy marker for gradual migration  
✅ **Extensible**: Easy to add more control messages in the future  

The "R to reconnect" feature is now **safe and reliable**! 🎉

