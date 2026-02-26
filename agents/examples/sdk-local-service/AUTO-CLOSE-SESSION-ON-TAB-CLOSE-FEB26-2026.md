# Auto-Close Terminal Session on Tab Close - February 26, 2026

## Problem

When users closed browser tabs with active SSH or local terminal sessions:
- ✅ WebSocket connection was closed properly
- ✅ Frontend cleaned up local resources
- ❌ **SSH/local sessions remained open on backend**
- ❌ **Resource leak** - sessions accumulated indefinitely

### Why This Happened

The `TerminalWebSocketHandler.afterConnectionClosed()` method only:
1. Removed WebSocket client from tracking
2. Cleaned up input buffers
3. **Did NOT close the underlying terminal session**

This meant SSH connections to remote servers stayed active even after all browser tabs were closed.

## Solution

Modified `TerminalWebSocketHandler.afterConnectionClosed()` to automatically close terminal sessions when the **last WebSocket client** disconnects.

### Implementation

**File:** `TerminalWebSocketHandler.java`

```java
@Override
public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
    String sessionId = extractSessionId(session);

    if (sessionId != null) {
        Set<WebSocketSession> clients = sessionClients.get(sessionId);
        if (clients != null) {
            clients.remove(session);
            if (clients.isEmpty()) {  // ✅ Last client disconnected
                log.info("[WebSocket] All clients disconnected for session: {}, closing terminal session", sessionId);
                
                // Clean up resources
                sessionClients.remove(sessionId);
                inputBuffers.remove(sessionId);
                streamingThreads.remove(sessionId);
                
                // ✅ Close the terminal session (SSH or local)
                try {
                    terminalService.closeSession(sessionId);
                    log.info("[WebSocket] Terminal session closed: {}", sessionId);
                } catch (Exception e) {
                    log.error("[WebSocket] Failed to close terminal session {}: {}", sessionId, e.getMessage());
                }
            } else {
                log.info("[WebSocket] Client disconnected, {} client(s) remaining for session: {}", clients.size(), sessionId);
            }
        }
    }

    log.info("WebSocket disconnected: {}", session.getId());
}
```

## Behavior

### Single Browser Tab
1. User opens SSH terminal → WebSocket connects → Session created
2. User closes tab → WebSocket disconnects → **Session automatically closed**
3. SSH connection to remote server is terminated
4. Database updated with `status='closed'` and `closedAt` timestamp

### Multiple Browser Tabs (Same Session)
1. User opens same session in 2 tabs → 2 WebSocket clients
2. User closes tab 1 → 1 WebSocket client remains → **Session stays open**
3. User closes tab 2 → Last WebSocket client disconnected → **Session automatically closed**

### Shared Sessions
1. Owner shares session with viewer → 2 WebSocket clients
2. Viewer disconnects → 1 WebSocket client remains → **Session stays open**
3. Owner disconnects → Last WebSocket client disconnected → **Session automatically closed**

## Benefits

✅ **No resource leaks** - SSH sessions are cleaned up automatically  
✅ **Proper cleanup** - Database updated, SSH connections closed  
✅ **Multi-client support** - Sessions stay open if any tab is active  
✅ **Shared session support** - Sessions stay open until all viewers disconnect  
✅ **User-friendly** - Seamless behavior matching user expectations  

## Testing

### Test 1: Single Tab Close
```
1. Open SSH terminal
2. Close browser tab
3. Check backend logs: "All clients disconnected for session: {id}, closing terminal session"
4. Verify SSH connection is closed
5. Check database: status='closed', closedAt is set
```

### Test 2: Multiple Tabs
```
1. Open SSH terminal in tab 1
2. Open same session in tab 2 (via session restore or direct URL)
3. Close tab 1
4. Backend logs: "Client disconnected, 1 client(s) remaining for session"
5. Session should still be active
6. Close tab 2
7. Backend logs: "All clients disconnected, closing terminal session"
8. Session should be closed
```

### Test 3: Shared Session
```
1. Owner shares SSH session
2. Viewer connects
3. Owner closes tab
4. Viewer should still have access (session stays open)
5. Viewer closes tab
6. Session should be closed automatically
```

## Files Modified

- `sdk-local-service/src/main/java/com/hmdev/sdk/local/terminal/websocket/TerminalWebSocketHandler.java`

## Related Issues

- **SSH_DISCONNECTED banner** - When SSH channel dies (separate from tab close)
- **Session restore** - Closed sessions won't be restored on page reload
- **SFTP sessions** - Auto-created SFTP sessions are cleaned up with parent SSH session

## Notes

- Frontend `beforeunload` handler still closes WebSocket and shows confirmation dialog
- Backend now ensures complete cleanup when WebSocket closes
- SFTP channels associated with SSH sessions are also cleaned up via `SshTerminalSession.close()`

