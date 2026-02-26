# Quick Test Guide - SSH Disconnect Detection

## Prerequisites
- SLS (SDK Local Service) running on localhost:8080
- Web SDK Server running on localhost:8081
- SSH connection configured

## Test Steps

### 1. Start Services
```bash
# Terminal 1: Start SLS
cd messaging-platform-sdk
gradlew :agents:examples:sdk-local-service:bootRun

# Terminal 2: Start Web SDK Server
cd messaging-platform-sdk
gradlew :agents:examples:web-sdk-server:bootRun
```

### 2. Create SSH Session
1. Open browser: http://localhost:8081/apps/terminal/
2. Click "New SSH Terminal"
3. Configure connection:
   - Host: your-ssh-server.com
   - Port: 22
   - Username: your-username
   - Password/Key: your-credentials
4. Click "Connect"
5. Verify terminal is working

### 3. Test SSH Disconnect Detection

#### Option A: Force Disconnect (Server Side)
On the SSH server, kill the session:
```bash
# Find your SSH session
who
# Kill it
pkill -9 -t pts/0  # Replace with your terminal
```

#### Option B: Network Timeout
Disconnect your network for 30+ seconds, then reconnect

#### Option C: SSH Server Restart
```bash
# On SSH server
sudo systemctl restart sshd
```

### 4. Verify Fix

**Before the fix:**
- Terminal stops responding
- No error message
- No reconnect overlay
- Have to refresh page

**After the fix:**
- **Immediate detection** (within 1 second of typing)
- **Console log**: `[WS] Control message received: {type: 'error', code: 'SSH_DISCONNECTED', ...}`
- **Console log**: `[WS] SSH disconnected for session: <sessionId>`
- **Reconnect overlay appears** with "Press R to reconnect"
- **Toast notification**: "SSH Disconnected - SSH connection lost. Press R to reconnect."
- **Tab shows red dot** (disconnected state)

### 5. Test Reconnection
1. Press **R** key (while reconnect overlay is visible)
2. Verify:
   - Overlay disappears
   - Terminal reconnects
   - New session created
   - Terminal is responsive again

### 6. Test False Alarm Prevention
In the terminal, run:
```bash
# Create fake control message
echo '{"type":"error","code":"SSH_DISCONNECTED","message":"Fake"}' > test.txt

# Display it
cat test.txt

# Verify:
# - Text appears in terminal normally
# - NO reconnect overlay appears
# - NO console log about control message
# - Session still works fine
```

### 7. Check Browser Console
Open DevTools (F12) and verify logs:

**On SSH disconnect:**
```
[WS] Control message received: {type: "error", code: "SSH_DISCONNECTED", message: "SSH connection lost. Please reconnect.", ...}
[WS] SSH disconnected for session: abc-123-def
[WS] Session alive check after SSH disconnect: false
```

**On false alarm test (cat test.txt):**
```
(No control message logs - just normal terminal output)
```

## Expected Behavior

### ws.onmessage Event Flow
1. **SSH disconnects** → Backend catches exception
2. **Backend sends JSON** → `broadcastControlMessage(sessionId, "error", "SSH_DISCONNECTED", ...)`
3. **WebSocket delivers** → `ws.onmessage` event triggered
4. **Frontend parses JSON** → Detects `controlMsg.code === 'SSH_DISCONNECTED'`
5. **Frontend shows UI** → Reconnect overlay + toast + tab update
6. **User presses R** → Calls `reconnectSession(sessionId)`

### Control Message Format
```json
{
  "type": "error",
  "code": "SSH_DISCONNECTED",
  "message": "SSH connection lost. Please reconnect.",
  "sessionId": "abc-123-def",
  "timestamp": 1708963200000
}
```

## Troubleshooting

### Reconnect overlay doesn't appear
1. Check browser console for errors
2. Verify `[WS] Control message received:` log appears
3. Check if `showReconnectOverlay()` function exists
4. Verify `checkSessionAlive()` API is responding

### False alarms (overlay appears when it shouldn't)
1. Check if terminal output actually contains valid JSON
2. Verify JSON parsing is wrapped in try-catch
3. Check if `controlMsg.type && controlMsg.code` condition is met

### Backend logs show error but frontend doesn't respond
1. Verify WebSocket connection is still open
2. Check if `broadcastControlMessage()` is being called
3. Verify `sessionClients.get(sessionId)` returns clients
4. Check browser console for WebSocket errors

## Success Criteria

✅ Reconnect overlay appears **within 1 second** of SSH disconnect  
✅ Toast notification shows clear error message  
✅ Terminal tab shows disconnected state (red dot)  
✅ Pressing R key reconnects successfully  
✅ No false alarms when displaying files with JSON content  
✅ Browser console shows proper control message logs  
✅ Multiple browser tabs all receive disconnect notification  

## Files to Monitor

### Backend Logs
```bash
tail -f logs/sls.log | grep "SSH channel disconnected"
tail -f logs/sls.log | grep "Broadcast-Control"
```

### Browser Console
- `[WS] Control message received:`
- `[WS] SSH disconnected for session:`
- `[WS] Session alive check after SSH disconnect:`

## Related Documentation
- `SSH-DISCONNECT-ONMESSAGE-FIX-FEB26-2026.md` - Detailed technical explanation
- `SSH-DISCONNECT-FIX-SUMMARY-FEB26-2026.md` - Quick summary

