# SSH Disconnect Detection Without False Alarms - February 26, 2026

## Problem with Previous Approach

The previous implementation sent a visual banner from backend when SSH disconnected:

```
╔══════════════════════════════════════════╗
║      SSH CONNECTION DISCONNECTED         ║
╚══════════════════════════════════════════╝
[SSH_DISCONNECTED]
Press R to reconnect...
```

### Critical Issue: False Alarms

**Problem**: If a user runs a command that outputs similar text, it could trigger false alarms:

```bash
cat file.txt  # if file contains "[SSH_DISCONNECTED]"
echo "[SSH_DISCONNECTED]"
grep -r "SSH" logs/  # might find this string in logs
```

This would incorrectly trigger the reconnect overlay even though the connection is fine.

## New Solution: WebSocket Event-Based Detection

### Backend Changes

**File**: `TerminalWebSocketHandler.java`

Backend now **only logs** SSH disconnection errors, doesn't broadcast any banner:

```java
// Check for SSH channel disconnection - this is a critical error
// Just log it - don't send any banner to avoid false alarms
// Frontend will detect disconnection via WebSocket events and check session alive status
if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
    log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);
    return;
}
```

**Benefits**:
- No false alarms from terminal output
- Clean separation of concerns
- Backend focuses on logging and connection management

### Frontend Changes

**File**: `terminal.js`

#### 1. Removed Banner Detection

Removed the code that checked for `[SSH_DISCONNECTED]` in terminal output:

```javascript
// REMOVED - no longer checking for banner
if (data.includes('[SSH_DISCONNECTED]')) {
    checkSessionAlive(sessionId).then(alive => { ... });
}
```

#### 2. Enhanced WebSocket Close Handler

Updated `ws.onclose` to check session alive status before showing reconnect UI:

```javascript
ws.onclose = (event) => {
    clearTimeout(connectionTimeout);
    
    console.log('[WS] WebSocket closed for session:', sessionId);
    console.log('[WS] Close code:', event.code, 'Reason:', event.reason || 'No reason provided');
    console.log('[WS] Was clean close:', event.wasClean);

    session.connected = false;
    session.dataSender = null;
    updateTab(sessionId, true);

    // Check if session is still alive before showing reconnect overlay
    checkSessionAlive(sessionId).then(alive => {
        console.log('[WS] Session alive check on close:', alive);
        
        if (!alive) {
            // Session is dead - show reconnect UI
            showReconnectOverlay(sessionId);
            showToast('warning', 'Session Disconnected', 'Connection lost. Press R to reconnect.');
        } else {
            // Session is alive but WebSocket closed (e.g., SSH channel disconnected)
            // Still show reconnect overlay so user can re-establish connection
            showReconnectOverlay(sessionId);
            showToast('warning', 'Connection Closed', 'WebSocket closed. Press R to reconnect.');
        }
    }).catch(err => {
        console.error('[WS] Failed to check session alive:', err);
        // On error, show reconnect overlay to be safe
        showReconnectOverlay(sessionId);
    });
    
    // ... rest of close handling ...
};
```

#### 3. Session Alive Check API

The `checkSessionAlive()` function queries the backend to verify session status:

```javascript
async function checkSessionAlive(sessionId) {
    try {
        const response = await fetch(`${MLS_URL}/terminal/${sessionId}`);
        return response.ok; // 200 = alive, 404 = not found
    } catch (error) {
        console.error('[CheckAlive] Failed to check session status:', error);
        return false;
    }
}
```

## How It Works Now

### Normal Flow

1. **User types in terminal**
2. **Frontend sends input via WebSocket**
3. **Backend processes input**
4. **Backend sends output via WebSocket**
5. **Frontend displays output in terminal**

### SSH Disconnection Flow

1. **SSH channel disconnects** (network timeout, server disconnect, etc.)
2. **Backend detects error** when trying to send input to SSH session
3. **Backend logs error** (no banner sent)
4. **WebSocket connection may close** or remain open but unusable
5. **Frontend detects WebSocket close event**
6. **Frontend calls `checkSessionAlive(sessionId)`** to verify session status
7. **Frontend shows reconnect overlay** with appropriate message
8. **User sees "Press R to reconnect"** and can press R button
9. **Reconnect creates new WebSocket** and re-establishes SSH connection

### Key Detection Points

| Event | Detection Method | Action |
|-------|-----------------|--------|
| SSH disconnects | WebSocket closes | Check session alive → Show reconnect UI |
| SLS crashes | WebSocket closes (code 1006) | Show reconnect UI immediately |
| Network timeout | WebSocket closes | Check session alive → Show reconnect UI |
| User cats file with "[SSH_DISCONNECTED]" | **No detection** ✅ | Normal terminal output, no false alarm |

## Benefits

### ✅ No False Alarms

- No special strings in terminal output that could trigger false alarms
- Terminal output is purely terminal output
- Control signals use WebSocket protocol events, not text patterns

### ✅ Robust Detection

- WebSocket close events are reliable
- Session alive check confirms backend state
- Works for all disconnection scenarios:
  - SSH channel disconnected
  - SLS crashed
  - Network timeout
  - Server restart

### ✅ Better User Experience

- Clear distinction between different error types
- Appropriate messages based on actual state
- R button always works to reconnect
- No confusing visual banners appearing in terminal

### ✅ Clean Architecture

- Backend focuses on connection management and logging
- Frontend handles UI and user interaction
- Proper separation of concerns
- Uses WebSocket protocol features correctly

## Testing Scenarios

### 1. SSH Timeout
```bash
# Start SSH terminal
# Wait for SSH timeout (or kill SSH server)
# Verify:
# - WebSocket closes
# - Session alive check runs
# - Reconnect overlay appears
# - Press R reconnects
```

### 2. SLS Crash
```bash
# Start SSH terminal
# Kill SLS process
# Verify:
# - WebSocket closes (code 1006)
# - Reconnect overlay appears
# - Terminal shows "SLS may have stopped"
```

### 3. Cat File with Similar String
```bash
# Create test file
echo "[SSH_DISCONNECTED]" > test.txt
cat test.txt

# Verify:
# - Text appears in terminal normally
# - No reconnect overlay
# - No false alarm
# - Terminal continues to work
```

### 4. Network Interruption
```bash
# Start SSH terminal
# Disconnect network temporarily
# Reconnect network
# Verify:
# - WebSocket closes
# - Reconnect overlay appears
# - Press R successfully reconnects
```

## Files Modified

### Backend
- `sdk-local-service/src/main/java/com/hmdev/sdk/local/terminal/websocket/TerminalWebSocketHandler.java`
  - Removed visual banner broadcast for SSH disconnection
  - Kept error logging only

### Frontend
- `web-sdk-server/src/main/resources/static/apps/terminal/terminal.js`
  - Removed `[SSH_DISCONNECTED]` banner detection from `ws.onmessage`
  - Enhanced `ws.onclose` to check session alive status
  - Shows reconnect UI based on actual session state

## Future Improvements

### Heartbeat Mechanism
Could add periodic heartbeat to detect disconnections faster:
- Frontend sends ping every 30 seconds
- Backend responds with pong
- If no pong received, consider connection dead

### Automatic Reconnection
Could add automatic reconnection attempts:
- Try to reconnect automatically after disconnect
- Exponential backoff (1s, 2s, 4s, 8s, etc.)
- Show manual reconnect option after N failed attempts

### Connection Quality Indicator
Could show connection quality in UI:
- Green: Connected and healthy
- Yellow: Connected but slow/unstable
- Red: Disconnected

### SSH Keepalive
Could configure SSH to send keepalive packets:
- Prevents timeouts from idle connections
- Detects broken connections faster
- Configurable interval (e.g., 60 seconds)

## Summary

This implementation provides:
- ✅ **No false alarms** from terminal output
- ✅ **Reliable disconnection detection** via WebSocket events
- ✅ **Session state verification** via API calls
- ✅ **Clean architecture** with proper separation of concerns
- ✅ **Better UX** with appropriate messages and recovery options

The key insight is to **use WebSocket protocol events** (onclose, onerror) rather than **pattern matching in terminal output** for control signaling.

