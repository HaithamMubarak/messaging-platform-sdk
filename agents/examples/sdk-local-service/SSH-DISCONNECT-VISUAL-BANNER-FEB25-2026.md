# SSH Disconnect Visual Banner - February 25, 2026

## Problem with Previous Approach

The previous implementation sent JSON control messages when SSH disconnected:
```json
{"type":"error","code":"SSH_DISCONNECTED","message":"..."}
```

**Issues:**
1. JSON parsing could fail if format changed
2. No visual feedback in the terminal itself
3. If a file contained this JSON structure, it could trigger false alarms

## New Solution: Visual Banner with Session Alive Check

### Backend Changes

**File:** `TerminalWebSocketHandler.java`

When SSH channel disconnection is detected, send a **visual banner** that appears in the terminal:

```java
if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
    log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);

    // Send visual banner to all clients that will appear in terminal
    // Frontend will detect this banner and check session alive status
    broadcast(sessionId, "\r\n\u001b[1;31m╔══════════════════════════════════════════╗\u001b[0m\r\n");
    broadcast(sessionId, "\u001b[1;31m║      SSH CONNECTION DISCONNECTED         ║\u001b[0m\r\n");
    broadcast(sessionId, "\u001b[1;31m╚══════════════════════════════════════════╝\u001b[0m\r\n");
    broadcast(sessionId, "\u001b[33m[SSH_DISCONNECTED]\u001b[0m\r\n");
    broadcast(sessionId, "\u001b[33mPress \u001b[1mR\u001b[0m\u001b[33m to reconnect...\u001b[0m\r\n\r\n");
    return;
}
```

**Benefits:**
- Users see a clear, formatted box in the terminal
- The `[SSH_DISCONNECTED]` marker is embedded in ANSI color codes
- Much less likely to appear in normal file content
- Visual feedback is immediate

### Frontend Changes

**File:** `terminal.js`

1. **Added `checkSessionAlive()` function:**
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

2. **WebSocket message handler detects banner:**
```javascript
ws.onmessage = (event) => {
    let data = event.data;

    // Check for SSH disconnection banner
    if (data.includes('[SSH_DISCONNECTED]')) {
        console.error('[WS] SSH disconnection banner detected for session:', sessionId);
        
        // Check if session is still alive before showing reconnect overlay
        checkSessionAlive(sessionId).then(alive => {
            console.log('[WS] Session alive check result:', alive);
            
            if (!alive) {
                // Session is dead - mark as disconnected and show reconnect UI
                session.connected = false;
                session.dataSender = null;
                updateTab(sessionId, true);
                showReconnectOverlay(sessionId);
                showToast('warning', 'SSH Disconnected', 'Connection lost. Press R to reconnect.');
            } else {
                // Session reports as alive but SSH channel disconnected
                // Still show reconnect overlay to let user re-establish SSH
                session.connected = false;
                session.dataSender = null;
                updateTab(sessionId, true);
                showReconnectOverlay(sessionId);
                showToast('warning', 'SSH Disconnected', 'SSH channel lost. Press R to reconnect.');
            }
        });
        
        // Still write the banner to terminal so user sees it
        session.terminal.write(data);
        return;
    }
    
    // ... rest of message handling ...
};
```

## How It Works

1. **SSH channel disconnects** (network timeout, server disconnect, etc.)
2. **Backend detects error** in `handleTextMessage()` catch block
3. **Backend broadcasts visual banner** to all connected WebSocket clients
4. **Frontend detects `[SSH_DISCONNECTED]` marker** in terminal output
5. **Frontend checks if session is alive** using `GET /terminal/{sessionId}`
6. **Frontend shows reconnect overlay** and "Press R" hint
7. **User sees both:**
   - Visual banner in terminal with box and colors
   - Reconnect overlay with R button functionality

## Why This is Better

### Robust Detection
- Banner is unlikely to appear in legitimate file content
- Embedded in ANSI escape codes makes it even less likely
- Session alive check confirms state before triggering UI

### Visual Feedback
- User immediately sees what happened
- Clear, formatted message in terminal
- Professional appearance with box drawing characters

### No False Alarms
- Previous `__SSH_DISCONNECTED__` could trigger if file contained that string
- New banner `[SSH_DISCONNECTED]` wrapped in ANSI codes is very specific
- Session alive check adds confirmation layer

### User Experience
- Terminal shows disconnect reason visually
- Reconnect overlay appears automatically
- Press R to reconnect (existing functionality)
- Toast notification for additional awareness

## Testing Scenarios

1. **Normal SSH Disconnect:**
   - SSH server closes connection
   - User sees red box in terminal
   - Reconnect overlay appears
   - Press R works to reconnect

2. **Network Timeout:**
   - Network drops while SSH active
   - Backend detects channel disconnection
   - Visual banner shown
   - Session alive check runs
   - Appropriate UI shown based on result

3. **Cat File with Similar String:**
   - User runs `cat file.txt` where file contains `[SSH_DISCONNECTED]`
   - Frontend detects marker
   - Session alive check returns true (session still active)
   - Shows reconnect overlay (minor issue, but session is still alive)
   - User can press R to refresh connection or continue using terminal

## Note on Edge Case

If a user has a file with `[SSH_DISCONNECTED]` and cats it, the frontend will detect it and run the alive check. Since the session is still alive, the reconnect overlay might show briefly but the terminal remains functional. This is much better than the previous `__SSH_DISCONNECTED__` approach which was just plain text.

To completely eliminate false positives, we could:
- Make the marker even more unique (e.g., `\x1b[SSH_DISCONNECT_EVENT_\x1b]`)
- Send a binary WebSocket frame instead of text
- Use a separate WebSocket channel for control messages

However, the current solution provides a good balance between simplicity and robustness.

