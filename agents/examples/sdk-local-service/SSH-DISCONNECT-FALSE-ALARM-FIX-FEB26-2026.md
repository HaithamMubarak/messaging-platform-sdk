# SSH Disconnect False Alarm Fix - February 26, 2026

## Problem
When SSH channel disconnected, the backend sends a `_SSH_DISCONNECTED_` banner to the frontend. However, this could cause **false alarms** if:

1. User runs: `cat file.txt` where file contains `_SSH_DISCONNECTED_`
2. User runs: `echo "_SSH_DISCONNECTED_"`
3. User runs: `grep "_SSH_DISCONNECTED_" log.txt`

### Previous Behavior
```javascript
if (data.includes('_SSH_DISCONNECTED_')) {
    // Immediately mark session as disconnected
    session.connected = false;
    session.dataSender = null;
    updateTab(sessionId, true);
    
    // Show reconnect overlay regardless of session state
    showReconnectOverlay(sessionId);
    showToast('error', 'SSH Disconnected', '...');
    return; // Don't write banner to terminal
}
```

**Issue**: Even if the session was still alive (false alarm from file content), it would immediately disconnect and show the reconnect overlay.

## Solution: Check Session Alive FIRST

The fix verifies if the session is actually still alive before taking action:

### New Logic Flow

1. **Banner detected** → `_SSH_DISCONNECTED_` found in terminal data
2. **Check session alive** → Call `GET /terminal/{sessionId}` API
3. **If session is alive** → False alarm (file content)
   - Continue normal processing
   - Write the banner to terminal as regular data
   - No disconnection, no reconnect overlay
4. **If session is NOT alive** → Real disconnection
   - Mark session as disconnected
   - Show reconnect overlay
   - Show toast notification
   - Enable "Press R to reconnect"

### Implementation

**File**: `terminal.js` (lines ~2349-2393)

```javascript
ws.onmessage = (event) => {
    try {
        let data = event.data;

        // Check for SSH disconnection banner
        if (data.includes('_SSH_DISCONNECTED_')) {
            console.error('[WS] SSH disconnection banner detected for session:', sessionId);

            // Verify if session is still alive via API to avoid false alarms
            checkSessionAlive(sessionId).then(alive => {
                console.log('[WS] Session alive check after SSH banner:', alive);
                
                if (alive) {
                    // FALSE ALARM: Session is still alive - this was just file content
                    // Continue normal processing - write the banner to terminal as regular data
                    console.log('[WS] Session is alive - banner was false alarm, continuing normal processing');
                    processBannerAsNormalData(data);
                } else {
                    // REAL DISCONNECTION: Session is dead
                    console.error('[WS] Session is NOT alive - real SSH disconnection');
                    session.connected = false;
                    session.dataSender = null;
                    updateTab(sessionId, true);
                    showReconnectOverlay(sessionId);
                    showToast('error', 'SSH Disconnected', 'SSH connection lost. Press R to reconnect.');
                }
            }).catch(err => {
                console.error('[WS] Failed to check session alive:', err);
                // On error, assume disconnection to be safe
                session.connected = false;
                session.dataSender = null;
                updateTab(sessionId, true);
                showReconnectOverlay(sessionId);
            });
            
            // Don't continue processing in this handler - async check will handle it
            return;
        }
        
        // Helper function to process banner as normal data
        function processBannerAsNormalData(bannerData) {
            // Apply same processing as normal terminal data
            bannerData = bannerData.replace(/[\x7F]/g, ''); // Remove DEL character
            const shell = session.config?.shell || 'cmd';
            bannerData = cleanOutput(bannerData, shell);
            
            if (bannerData.length > 0) {
                session.terminal.write(bannerData);
            }
        }
        
        // ... rest of normal message processing ...
    } catch (e) {
        console.warn('[Terminal] Write error:', e);
    }
};
```

## Test Scenarios

### 1. Real SSH Disconnection
```bash
# Start SSH terminal
# Kill SSH server or wait for timeout
# Expected:
# - Session alive check returns false
# - Reconnect overlay appears
# - "Press R to reconnect" shown
# - Tab shows disconnect icon
```

### 2. False Alarm - Cat File
```bash
# Create test file
echo "_SSH_DISCONNECTED_" > test.txt

# Display it
cat test.txt

# Expected:
# - Session alive check returns true
# - Banner appears in terminal as normal text
# - NO reconnect overlay
# - Terminal continues working normally
# - Tab remains connected
```

### 3. False Alarm - Echo Command
```bash
# Run echo with banner text
echo "_SSH_DISCONNECTED_"

# Expected:
# - Session alive check returns true
# - Text appears in terminal normally
# - NO reconnect overlay
# - Terminal continues working
```

### 4. False Alarm - Grep Output
```bash
# Search for banner in logs
grep "_SSH_DISCONNECTED_" /var/log/app.log

# Expected:
# - Session alive check returns true
# - Grep output appears normally
# - NO reconnect overlay
# - Terminal continues working
```

## Benefits

### ✅ No More False Alarms
- File content with banner text won't break terminal
- Echo/grep commands with banner text work normally
- Only real disconnections trigger reconnect overlay

### ✅ Reliable Disconnect Detection
- Backend still sends banner when SSH channel fails
- Frontend verifies with API before taking action
- Async check doesn't block terminal output

### ✅ Better User Experience
- No confusion from false disconnection warnings
- Real disconnections are still caught and handled
- "Press R to reconnect" only shows when needed

## API Used

### Check Session Alive
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

**Returns**:
- `true` = Session exists and is active (200 OK)
- `false` = Session not found or dead (404 or error)

## Related Files

### Backend
- `TerminalWebSocketHandler.java` (lines 151-158)
  - Sends `_SSH_DISCONNECTED_` banner when SSH channel fails
  - No changes needed - already working correctly

### Frontend
- `terminal.js` (lines ~2349-2393)
  - Modified `ws.onmessage` to check session alive before acting
  - Added `processBannerAsNormalData()` helper for false alarms

## Performance Considerations

### API Call Overhead
- Only called when `_SSH_DISCONNECTED_` is detected
- Unlikely to happen frequently (only on real disconnect or rare false alarm)
- Async call doesn't block terminal output processing
- Other terminal data continues to be processed normally

### False Positive Rate
- Very low - `_SSH_DISCONNECTED_` is unlikely to appear in normal files
- Even if it does, session alive check resolves it correctly
- No negative impact on terminal performance

## Edge Cases

### API Call Fails
If `checkSessionAlive()` throws an error:
- Assume disconnection to be safe
- Show reconnect overlay
- Better to show unnecessary overlay than miss real disconnect

### Session State Race Condition
If session dies between:
1. Banner detection
2. Session alive check

The alive check will return `false`, correctly showing reconnect overlay.

### Multiple Banners in Output
If multiple banners appear (e.g., grep finds many matches):
- Each banner triggers separate alive check
- All checks will return `true` (false alarm)
- All banners written to terminal normally
- No reconnect overlay shown

## Conclusion

This fix ensures that the `_SSH_DISCONNECTED_` banner mechanism is robust against false alarms while still reliably detecting real SSH disconnections. The session alive check adds a verification layer that prevents legitimate terminal output from breaking the UI.

