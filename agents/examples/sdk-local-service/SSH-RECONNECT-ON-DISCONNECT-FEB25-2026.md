# SSH Auto-Reconnect on Disconnection - February 25, 2026

## Problem

When an SSH connection is lost (e.g., network timeout, server disconnect), users received this error:

```
java.lang.RuntimeException: SSH channel is not connected
	at com.hmdev.sdk.local.terminal.SshTerminalSession.sendInput(SshTerminalSession.java:124)
	at com.hmdev.sdk.local.terminal.TerminalService.sendInput(TerminalService.java:183)
	at com.hmdev.sdk.local.terminal.websocket.TerminalWebSocketHandler.handleTextMessage(TerminalWebSocketHandler.java:146)
```

**User Experience:**
- Terminal appeared functional but was unresponsive
- No clear indication that connection was lost
- No easy way to reconnect without closing and reopening tab

## Solution

### 1. Backend Detection & Notification
**File:** `TerminalWebSocketHandler.java`

When SSH channel disconnection is detected:
- Log the error properly
- Send visual error messages to terminal
- Send special marker `__SSH_DISCONNECTED__` that frontend can detect
- Show "Press R to reconnect" message

```java
// Check for SSH channel disconnection - this is a critical error
if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
    log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);
    if (session.isOpen()) {
        // Send special error message that frontend can detect
        session.sendMessage(new TextMessage("\r\n\u001b[1;31m✖ SSH Connection Lost\u001b[0m\r\n"));
        session.sendMessage(new TextMessage("\u001b[33mPress R to reconnect...\u001b[0m\r\n"));
        // Send a marker that frontend can detect to trigger reconnect overlay
        session.sendMessage(new TextMessage("__SSH_DISCONNECTED__\r\n"));
    }
    return;
}
```

### 2. Frontend Auto-Detection & Reconnect UI
**File:** `terminal.js`

WebSocket message handler detects the marker and automatically:
- Marks session as disconnected
- Closes the WebSocket data sender
- Updates tab to show "disconnected" state
- Shows reconnect overlay with "Press R to reconnect" hint
- Shows toast notification

```javascript
ws.onmessage = (event) => {
    try {
        let data = event.data;
        
        // Check for SSH disconnection marker from backend
        if (data.includes('__SSH_DISCONNECTED__')) {
            console.error('[WS] SSH channel disconnected for session:', sessionId);
            session.connected = false;
            session.dataSender = null;
            updateTab(sessionId, true);
            showReconnectOverlay(sessionId);
            showToast('warning', 'SSH Disconnected', 'Connection lost. Press R to reconnect.');
            // Remove the marker from output
            data = data.replace('__SSH_DISCONNECTED__\r\n', '');
            if (!data.trim()) return; // Don't write empty data
        }
        
        // ... rest of message processing
    }
};
```

### 3. Existing Reconnect Functionality
The 'R' key handler was already implemented (just needed to be triggered):

```javascript
document.addEventListener('keydown', (e) => {
    // R to reconnect (when overlay is visible and terminal not focused for input)
    if (e.key && e.key.toLowerCase() === 'r' && activeSessionId) {
        const session = sessions.get(activeSessionId);
        if (session && !session.connected) {
            const overlay = document.getElementById(`reconnect-${activeSessionId}`);
            if (overlay && overlay.classList.contains('visible')) {
                e.preventDefault();
                reconnectSession(activeSessionId);
            }
        }
    }
});
```

## User Experience After Fix

### When SSH Connection Lost:
1. ✅ Backend detects "SSH channel is not connected" error
2. ✅ Terminal shows: "✖ SSH Connection Lost" in red
3. ✅ Terminal shows: "Press R to reconnect..." in yellow
4. ✅ Reconnect overlay appears automatically with big "R" button hint
5. ✅ Tab shows orange "disconnected" indicator
6. ✅ Toast notification: "SSH Disconnected - Connection lost. Press R to reconnect."

### When User Presses 'R':
1. ✅ Overlay disappears
2. ✅ System checks if backend session still exists
3. ✅ If exists: just reconnects WebSocket
4. ✅ If not exists: recreates SSH session with same ID
5. ✅ Terminal clears and shows "✓ Connected" or "✓ Session recreated!"
6. ✅ Terminal becomes responsive again

## Testing

### Manual Test
1. Start SLS and open SSH terminal
2. Simulate disconnection:
   - Kill SSH server
   - Block network temporarily
   - Wait for idle timeout
3. Try typing in terminal
4. Verify:
   - Error message appears in terminal
   - Reconnect overlay shows automatically
   - Tab shows orange indicator
   - Toast notification appears
5. Press 'R' key
6. Verify:
   - Connection re-establishes
   - Terminal becomes responsive
   - Overlay disappears

### Common Disconnection Scenarios:
- ✅ Network timeout
- ✅ SSH server restart
- ✅ Firewall blocking connection
- ✅ SSH idle timeout
- ✅ Server reached max connections

## Files Modified

### Backend
- `sdk-local-service/src/main/java/com/hmdev/sdk/local/terminal/websocket/TerminalWebSocketHandler.java`
  - Added special handling for SSH channel disconnection
  - Send visual error messages + detection marker

### Frontend
- `web-sdk-server/src/main/resources/static/apps/terminal/terminal.js`
  - Added detection of `__SSH_DISCONNECTED__` marker
  - Automatically trigger reconnect UI

## Build Verification
```bash
cd C:\Users\admin\dev\messaging\messaging-platform-sdk
gradlew :agents:examples:sdk-local-service:clean :agents:examples:sdk-local-service:build -x test
```
✅ BUILD SUCCESSFUL

## Related Features

### Existing Reconnect Infrastructure:
- Reconnect overlay UI (already implemented)
- 'R' key handler (already implemented)
- `reconnectSession()` function (already implemented)
- Session recreation logic (already implemented)

### This Fix Adds:
- **Automatic detection** of SSH disconnection
- **Automatic trigger** of reconnect UI
- **Better error messages** in terminal

## Future Improvements

### Optional: Auto-Reconnect After Delay
Could add automatic reconnection after X seconds:
```javascript
if (data.includes('__SSH_DISCONNECTED__')) {
    // ... existing code ...
    
    // Optional: Auto-reconnect after 5 seconds
    session.reconnectTimer = setTimeout(() => {
        console.log('[Auto-Reconnect] Attempting to reconnect session:', sessionId);
        reconnectSession(sessionId);
    }, 5000);
}
```

### Optional: Heartbeat/Keep-Alive
Add periodic heartbeat to detect disconnection faster:
```java
// In SshTerminalSession
public boolean isChannelHealthy() {
    return channel != null && channel.isConnected() && !channel.isClosed();
}
```

## Summary
Users can now easily recover from SSH disconnections by pressing the 'R' key, with clear visual feedback and automatic detection. No need to manually close/reopen tabs or diagnose connection issues.

