# Terminal Banner Implementation - SSH Disconnection Detection
**Date:** February 26, 2026  
**Purpose:** Implement smart SSH disconnection detection using banners to avoid false alarms

## Overview
When an SSH connection drops, we need to notify the frontend without causing false positives (e.g., when a file containing the banner text is displayed).

## Solution Architecture

### 1. Backend Sends Banner (Java)
**File:** `TerminalWebSocketHandler.java`

**Constants Defined:**
```java
public static final String BANNER_SSH_DISCONNECTED = "<<SSH_DISCONNECTED>>";
public static final String BANNER_STREAM_CLOSED = "<<STREAM_CLOSED>>";
```

**Banner Sent on SSH Disconnection:**
```java
// In handleTextMessage() exception handler
if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
    log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);
    broadcast(sessionId, "\r\n" + BANNER_SSH_DISCONNECTED + "\r\n");
    return;
}
```

**Banner Sent on Stream Close:**
```java
// In startOutputStreaming() when EOF is detected
if (bytesRead == -1) {
    log.info("[Stream-{}] Stream closed (EOF)", sessionId);
    broadcast(sessionId, "\r\n" + BANNER_STREAM_CLOSED + "\r\n");
    break;
}
```

### 2. Frontend Detects and Verifies (JavaScript)
**File:** `terminal.js`

**Constants Defined:**
```javascript
const BANNER_SSH_DISCONNECTED = '<<SSH_DISCONNECTED>>';
const BANNER_STREAM_CLOSED = '<<STREAM_CLOSED>>';
```

**WebSocket Message Handler:**
```javascript
ws.onmessage = async (event) => {
    const rawData = event.data;

    // Check for special banners
    if (rawData.includes(BANNER_SSH_DISCONNECTED) || rawData.includes(BANNER_STREAM_CLOSED)) {
        const bannerType = rawData.includes(BANNER_SSH_DISCONNECTED) ? 'SSH_DISCONNECTED' : 'STREAM_CLOSED';
        console.warn(`[WS] ${bannerType} banner detected for session:`, sessionId);

        // ✅ VERIFY: Check if session is truly dead or banner is in file content
        const isAlive = await checkSessionAlive(sessionId);

        if (!isAlive) {
            // REAL DISCONNECTION: Session is dead
            console.error('[WS] Confirmed: Session is dead');
            session.connected = false;
            session.dataSender = null;
            updateTab(sessionId, true);
            showReconnectOverlay(sessionId);

            const message = bannerType === 'SSH_DISCONNECTED'
                ? 'SSH connection lost. Press R to reconnect.'
                : 'Terminal stream ended. Press R to reconnect.';
            showToast('error', 'Disconnected', message);

            return; // Don't write banner text to terminal
        }

        // FALSE ALARM: Session is alive - banner is just in file content
        console.log('[WS] Banner is false alarm (session still alive), processing as normal output');
        // Fall through to write the data normally
    }

    // Process and display terminal data
    writeTerminalData(session, rawData);
};
```

**Session Alive Check:**
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

### 3. WebSocket Close Handler
**Similar pattern applied to `ws.onclose`:**
```javascript
ws.onclose = async (event) => {
    clearTimeout(connectionTimeout);
    console.log('[WS] WebSocket closed for session:', sessionId);
    
    session.connected = false;
    session.dataSender = null;
    updateTab(sessionId, true);

    // Check if session is still alive before showing reconnect overlay
    const alive = await checkSessionAlive(sessionId);
    console.log('[WS] Session alive check on close:', alive);

    if (!alive) {
        // Session is truly dead - show reconnect UI
        showReconnectOverlay(sessionId);
        showToast('warning', 'Session Disconnected', 'Connection lost. Press R to reconnect.');
    } else {
        // Session is alive but WebSocket closed (e.g., SSH channel disconnected)
        showReconnectOverlay(sessionId);
        showToast('warning', 'Connection Closed', 'WebSocket closed. Press R to reconnect.');
    }
};
```

## Key Benefits

### 1. **No False Alarms**
- Banner detection triggers a session alive check via API
- If session is alive, banner is treated as normal file content
- Only shows reconnect UI when session is truly dead

### 2. **Clean Error Handling**
- No control messages sent to frontend (JSON parsing avoided)
- Simple string banner that's easy to detect
- Banner format `<<BANNER_NAME>>` is unlikely to appear in normal terminal output

### 3. **User-Friendly Experience**
- Clear distinction between "SSH disconnected" vs "Stream closed"
- Appropriate toast notifications
- Press 'R' to reconnect functionality

### 4. **Robust Detection**
- Works even when WebSocket is still open
- Handles both SSH channel failures and stream EOF
- Gracefully handles SLS offline scenarios

## Test Scenarios

### Scenario 1: Real SSH Disconnection
1. Connect to SSH server
2. Kill SSH daemon or disconnect network
3. Backend detects error, sends `<<SSH_DISCONNECTED>>` banner
4. Frontend checks session alive → returns false
5. Reconnect overlay shown with "Press R to reconnect"

### Scenario 2: False Alarm (Banner in File)
1. Create file with banner text: `echo "<<SSH_DISCONNECTED>>" > test.txt`
2. Display file: `cat test.txt`
3. Frontend detects banner, checks session alive → returns true
4. Banner displayed normally in terminal (no reconnect overlay)

### Scenario 3: Stream Closed (Process Exit)
1. Run command that exits (e.g., `exit`)
2. Backend detects EOF, sends `<<STREAM_CLOSED>>` banner
3. Frontend checks session alive
4. Appropriate action taken based on session state

### Scenario 4: Browser Tab Close
1. Close browser tab
2. WebSocket `onclose` fires
3. Frontend checks if session is alive
4. If backend session still exists, show reconnect option
5. If backend session was cleaned up, no action needed

## Implementation Notes

### Banner Format Choice
- **Format:** `<<BANNER_NAME>>`
- **Why:** Double angle brackets are rarely used in terminal output
- **Alternative Considered:** JSON messages (rejected - requires parsing, more overhead)

### Performance
- Session alive check is only performed when banner is detected
- No performance impact on normal terminal operations
- Async/await ensures UI doesn't freeze during check

### Cleanup
- Removed unnecessary methods (`broadcastControlMessage` was never implemented)
- Code is now cleaner and more maintainable
- Comments clearly explain false alarm handling

## Files Modified
1. `TerminalWebSocketHandler.java` - Banner sending logic
2. `terminal.js` - Banner detection and verification logic

## Future Enhancements
- Add more banner types if needed (e.g., `<<AUTH_FAILURE>>`, `<<TIMEOUT>>`)
- Consider telemetry to track false alarm rate
- Add configuration to customize banner format

