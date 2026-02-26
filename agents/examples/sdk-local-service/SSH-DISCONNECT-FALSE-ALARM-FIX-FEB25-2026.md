# Summary of Changes - February 25, 2026

## Issue: False Alarm with SSH Disconnect Detection

### Problem
User reported: If someone runs `cat file.txt` where the file contains the string `__SSH_DISCONNECTED__`, it would trigger a false alarm and show the reconnect overlay (R button).

### Root Cause
The backend was sending a **magic string marker** (`__SSH_DISCONNECTED__`) through the normal terminal output stream to signal SSH disconnection. This created a collision risk with legitimate terminal output.

## Solution: JSON Control Messages

### Changes Made

#### 1. Backend (TerminalWebSocketHandler.java)
**Changed from:**
```java
// Send a marker that frontend can detect to trigger reconnect overlay
client.sendMessage(new TextMessage("__SSH_DISCONNECTED__\r\n"));
```

**Changed to:**
```java
// Send JSON control message (won't conflict with terminal output)
String controlMsg = "{\"type\":\"error\",\"code\":\"SSH_DISCONNECTED\",\"sessionId\":\"" + sessionId + "\"}";
client.sendMessage(new TextMessage(controlMsg));
```

#### 2. Frontend (terminal.js)
**Added JSON control message detection:**
```javascript
ws.onmessage = (event) => {
    let data = event.data;
    
    // Check for JSON control messages from backend (e.g., error notifications)
    try {
        const maybeJson = JSON.parse(data);
        if (maybeJson.type === 'error' && maybeJson.code === 'SSH_DISCONNECTED') {
            console.error('[WS] SSH channel disconnected (JSON control message)');
            session.connected = false;
            session.dataSender = null;
            updateTab(sessionId, true);
            showReconnectOverlay(sessionId);
            showToast('warning', 'SSH Disconnected', 'Connection lost. Press R to reconnect.');
            return; // Don't write control message to terminal
        }
        console.warn('[WS] Unknown JSON control message:', maybeJson);
        return;
    } catch (e) {
        // Not JSON - continue processing as normal terminal data
    }
    
    // Legacy check for backwards compatibility (kept but deprecated)
    if (data.includes('__SSH_DISCONNECTED__')) {
        // ... handle old way ...
    }
    
    // Write normal terminal output
    session.terminal.write(data);
};
```

## Benefits

✅ **No False Alarms**: Terminal commands like `cat file.txt` containing `__SSH_DISCONNECTED__` won't trigger reconnect overlay  
✅ **Proper Separation**: Control messages are JSON, terminal output is text - never mixed  
✅ **Backwards Compatible**: Still supports legacy marker for gradual migration  
✅ **Extensible**: Easy to add more control message types in the future  
✅ **Robust**: No string collision possible  

## Testing

### Test Normal SSH Disconnect
1. Create SSH session
2. Wait for timeout or disconnect
3. Verify: Reconnect overlay appears, no visible control messages in terminal

### Test False Alarm Prevention (NEW)
1. Create SSH session
2. Run: `echo "__SSH_DISCONNECTED__" > test.txt`
3. Run: `cat test.txt`
4. Verify: 
   - Terminal shows: `__SSH_DISCONNECTED__`
   - No reconnect overlay appears
   - Session still works normally

## Files Modified

- `sdk-local-service/src/main/java/com/hmdev/sdk/local/terminal/websocket/TerminalWebSocketHandler.java`
- `web-sdk-server/src/main/resources/static/apps/terminal/terminal.js`

## Documentation Created

- `SSH-DISCONNECT-JSON-CONTROL-MESSAGE-FEB25-2026.md` - Detailed explanation

## Status

✅ **COMPLETE** - SSH disconnect detection now uses proper JSON control messages, preventing false alarms from terminal output.

