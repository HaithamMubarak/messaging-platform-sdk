# Legacy SSH Disconnect Marker Removed - February 25, 2026

## Summary
Removed the legacy `__SSH_DISCONNECTED__` marker detection code from the frontend to prevent false alarms and simplify the codebase.

## Problem
The legacy code checked for the string `__SSH_DISCONNECTED__` in terminal output, which could cause **false alarms** when:
- User runs: `cat file.txt` and the file contains that string
- User runs: `echo "__SSH_DISCONNECTED__"`
- User runs: `grep "__SSH_DISCONNECTED__" log.txt`

This was a serious UX bug where legitimate terminal output could trigger the reconnect overlay.

## Solution
### Backend Status
The backend (`TerminalWebSocketHandler.java`) was **already updated** to use JSON control messages exclusively:
```java
// Lines 156-157: SSH disconnect notification
broadcastControlMessage(sessionId, "error", "SSH_DISCONNECTED",
    "SSH connection lost. Press R to reconnect.");

// Lines 225: Stream closed notification  
broadcastControlMessage(sessionId, "status", "STREAM_CLOSED", "Terminal stream has ended");
```

The `__SSH_DISCONNECTED__` string marker is **no longer sent** by the backend.

### Frontend Changes
**Removed from `terminal.js` (lines 2373-2386):**
```javascript
// Legacy check: SSH disconnection marker string (for backwards compatibility)
// Note: This can cause false alarms if user runs: cat file.txt containing __SSH_DISCONNECTED__
// The JSON control message above is the preferred method
if (data.includes('__SSH_DISCONNECTED__')) {
    console.error('[WS] SSH channel disconnected (legacy marker) for session:', sessionId);
    session.connected = false;
    session.dataSender = null;
    updateTab(sessionId, true);
    showReconnectOverlay(sessionId);
    showToast('warning', 'SSH Disconnected', 'Connection lost. Press R to reconnect.');
    // Remove the marker from output
    data = data.replace('__SSH_DISCONNECTED__\r\n', '');
    if (!data.trim()) return; // Don't write empty data
}
```

**This legacy code is now completely removed.**

### Current Implementation (JSON Control Messages)
The frontend now **only** uses JSON control messages (lines 2346-2368):
```javascript
ws.onmessage = (event) => {
    let data = event.data;
    
    // Try parsing as JSON control message FIRST
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
        // Unknown JSON - ignore
        console.warn('[WS] Unknown JSON control message:', maybeJson);
        return;
    } catch (e) {
        // Not JSON - continue as normal terminal data
    }
    
    // Write to terminal (normal output)
    session.terminal.write(data);
};
```

## Benefits
✅ **No More False Alarms**: Terminal commands containing `__SSH_DISCONNECTED__` won't trigger errors  
✅ **Cleaner Code**: Removed redundant legacy compatibility layer  
✅ **Proper Separation**: JSON control messages vs. terminal output  
✅ **Extensible**: Easy to add new control message types  

## Testing
### Test 1: Normal SSH Disconnect
1. Create SSH session
2. Wait for SSH timeout or kill server
3. Try typing in terminal
4. **Expected Result:**
   - Red error message appears in terminal
   - "Press R to reconnect..." message appears
   - Reconnect overlay (R button) appears
   - No `__SSH_DISCONNECTED__` string visible

### Test 2: False Alarm Prevention ✅
1. Create SSH session
2. Create test file: `echo "__SSH_DISCONNECTED__" > test.txt`
3. Run: `cat test.txt`
4. **Expected Result:**
   - Terminal shows: `__SSH_DISCONNECTED__`
   - **NO** reconnect overlay appears
   - Session remains connected and functional

### Test 3: Echo Test ✅
1. Create SSH session
2. Run: `echo "__SSH_DISCONNECTED__"`
3. **Expected Result:**
   - Terminal shows: `__SSH_DISCONNECTED__`
   - **NO** reconnect overlay appears

## Files Modified
### Frontend
- `web-sdk-server/src/main/resources/static/apps/terminal/terminal.js`
  - **Removed**: Lines 2373-2386 (legacy marker detection)
  - **Kept**: Lines 2346-2368 (JSON control message detection)

### Backend (No Changes - Already Correct)
- `sdk-local-service/src/main/java/com/hmdev/sdk/local/terminal/websocket/TerminalWebSocketHandler.java`
  - Already using `broadcastControlMessage()` for all control notifications
  - Never sends `__SSH_DISCONNECTED__` string marker

## Historical Context
For full history of this change, see:
- `SSH-DISCONNECT-JSON-CONTROL-MESSAGE-FEB25-2026.md`
- `SSH-DISCONNECT-FALSE-ALARM-FIX-FEB25-2026.md`
- `SSH-RECONNECT-ON-DISCONNECT-FEB25-2026.md`
- `SSH-DISCONNECT-BROADCAST-FEB25-2026.md`

## Conclusion
The codebase now uses **JSON control messages exclusively** for all error and status notifications. The legacy string marker approach has been completely removed, eliminating the risk of false alarms from legitimate terminal output.

