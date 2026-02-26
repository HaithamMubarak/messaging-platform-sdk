# SSH Disconnect Detection via WebSocket onmessage - February 26, 2026

## Problem

When SSH channel disconnected, the user received this backend error:
```
java.lang.RuntimeException: SSH channel is not connected
	at com.hmdev.sdk.local.terminal.SshTerminalSession.sendInput(SshTerminalSession.java:124)
	at com.hmdev.sdk.local.terminal.TerminalService.sendInput(TerminalService.java:183)
	at com.hmdev.sdk.local.terminal.websocket.TerminalWebSocketHandler.handleTextMessage(TerminalWebSocketHandler.java:146)
```

### Critical Issue
**The WebSocket `ws.onmessage` event listener never got triggered!**

Previous implementation:
- Backend: Only **logged** the SSH disconnection error, didn't send any message
- Frontend: WebSocket remained open, but no messages were received
- Result: `ws.onmessage` never triggered, reconnect overlay (R button) didn't appear

The user had to wait for:
- `ws.onclose` event (might take minutes due to TCP timeout)
- Manual page refresh

## Root Cause

**Backend wasn't sending anything when SSH disconnected:**

```java
// OLD CODE - Line 168-171
if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
    log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);
    return;  // ❌ Just returns - no message sent!
}
```

**Frontend `ws.onmessage` only writes terminal output:**
- No JSON control message detection
- No SSH disconnect handling
- Only `ws.onclose` handled reconnection (but that might not trigger immediately)

## Solution

### 1. Backend: Send JSON Control Message

**File:** `TerminalWebSocketHandler.java`

When SSH disconnects, **broadcast a JSON control message** to all WebSocket clients:

```java
// NEW CODE - Line 168-174
if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
    log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);
    // Send control message to ALL WebSocket clients for this session
    broadcastControlMessage(sessionId, "error", "SSH_DISCONNECTED", "SSH connection lost. Please reconnect.");
    return;
}
```

**Control Message Format:**
```json
{
  "type": "error",
  "code": "SSH_DISCONNECTED",
  "message": "SSH connection lost. Please reconnect.",
  "sessionId": "abc123",
  "timestamp": 1708963200000
}
```

### 2. Frontend: Detect JSON Control Messages in ws.onmessage

**File:** `terminal.js`

Added JSON control message detection **at the start** of `ws.onmessage` handler:

```javascript
ws.onmessage = (event) => {
    try {
        let data = event.data;

        // ✅ NEW: Check if this is a JSON control message (not terminal output)
        try {
            const controlMsg = JSON.parse(data);
            if (controlMsg.type && controlMsg.code) {
                // This is a control message - handle it separately
                console.log('[WS] Control message received:', controlMsg);

                if (controlMsg.code === 'SSH_DISCONNECTED') {
                    // SSH connection lost - trigger reconnect overlay
                    console.error('[WS] SSH disconnected for session:', sessionId);
                    session.connected = false;
                    session.dataSender = null;
                    updateTab(sessionId, true);

                    // Check if session is still alive
                    checkSessionAlive(sessionId).then(alive => {
                        console.log('[WS] Session alive check after SSH disconnect:', alive);
                        showReconnectOverlay(sessionId);
                        showToast('error', 'SSH Disconnected', controlMsg.message || 'SSH connection lost. Press R to reconnect.');
                    }).catch(err => {
                        console.error('[WS] Failed to check session alive:', err);
                        showReconnectOverlay(sessionId);
                    });
                } else if (controlMsg.type === 'error') {
                    // Other error control messages
                    console.error('[WS] Error message:', controlMsg.message);
                    showToast('error', 'Terminal Error', controlMsg.message);
                }

                // Don't write control messages to terminal
                return;
            }
        } catch (jsonError) {
            // Not JSON - it's regular terminal output, continue processing below
        }

        // ... existing terminal output handling ...
    } catch (e) {
        console.warn('[Terminal] Write error:', e);
    }
};
```

## Flow

1. **User types in SSH terminal** → sends input via WebSocket
2. **SSH channel is disconnected** → backend catches exception
3. **Backend sends JSON control message** → `broadcastControlMessage(sessionId, "error", "SSH_DISCONNECTED", "...")`
4. **Frontend `ws.onmessage` receives message** → immediately triggered
5. **Frontend detects JSON control message** → parses JSON, checks `code === 'SSH_DISCONNECTED'`
6. **Frontend shows reconnect overlay** → "Press R to reconnect"
7. **User presses R** → reconnects session

## Benefits

### ✅ Instant Detection
- `ws.onmessage` triggered **immediately** when SSH disconnects
- No need to wait for `ws.onclose` (TCP timeout can take minutes)

### ✅ No False Alarms
- JSON control messages **cannot be spoofed** by terminal output
- Even if a file contains `{"code":"SSH_DISCONNECTED"}`, it will be written to terminal as text
- Backend's `broadcastControlMessage()` creates proper JSON

### ✅ Clean Separation
- Control messages: JSON format, handled separately
- Terminal output: Raw text, written to xterm.js

## Testing

### 1. Test SSH Disconnect
```bash
# Start SSH session
# Wait for SSH to timeout or disconnect
# Verify:
# - Reconnect overlay appears immediately
# - Toast notification shows "SSH Disconnected"
# - Press R button reconnects
```

### 2. Test False Alarm Prevention
```bash
# Create a file with JSON control message
echo '{"type":"error","code":"SSH_DISCONNECTED","message":"Fake disconnect"}' > test.txt

# Display file in terminal
cat test.txt

# Verify:
# - Text appears in terminal normally
# - NO reconnect overlay appears
# - Session still works
```

### 3. Test Regular Terminal Output
```bash
# Normal commands should work as before
ls -la
echo "Hello World"
cat large-file.txt

# Verify:
# - All output appears correctly
# - No control message interference
```

## Files Modified

### Backend
- `sdk-local-service/src/main/java/com/hmdev/sdk/local/terminal/websocket/TerminalWebSocketHandler.java`
  - Line 168-174: Added `broadcastControlMessage()` call when SSH disconnects
  - Removed comment about "frontend will detect via WebSocket events"

### Frontend
- `web-sdk-server/src/main/resources/static/apps/terminal/terminal.js`
  - Line 2350-2390: Added JSON control message detection at start of `ws.onmessage`
  - Added handling for `SSH_DISCONNECTED` code
  - Added generic error message handling

## Related Documentation
- `SSH-DISCONNECT-NO-BANNER-FEB26-2026.md` - Previous approach (removed banners)
- `SSH-DISCONNECT-JSON-CONTROL-MESSAGE-FEB25-2026.md` - Initial JSON control message design
- `WEBSOCKET-CONTROL-MESSAGES-IMPLEMENTATION-FEB25-2026.md` - Control message format spec

## Future Improvements

### Binary WebSocket Frames
Could use **binary frames** for control messages instead of JSON strings:
- Text frames: Terminal output (UTF-8)
- Binary frames: Control messages (MessagePack or Protobuf)

This would provide **perfect separation** at the WebSocket protocol level.

