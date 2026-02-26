# WebSocket Control Messages Implementation

**Date**: February 25, 2026  
**Component**: Terminal WebSocket Handler  
**Purpose**: Separate control/error messages from terminal output

## Problem Solved

Previously, error messages like `__SSH_DISCONNECTED__` were sent as raw text, which could cause **false alarms** if a user ran:
```bash
cat file.txt  # and file contains "__SSH_DISCONNECTED__"
```

## Solution

Send **two distinct message types** over WebSocket:
1. **Terminal Output** → Raw `TextMessage` (actual terminal data)
2. **Control Messages** → JSON-formatted `TextMessage` (errors, status, system events)

Frontend can distinguish between them by attempting to parse as JSON.

## Backend Changes

### File Modified
- `TerminalWebSocketHandler.java`

### New Method Added
```java
/**
 * Send JSON control message to all clients (for errors, status, etc.)
 * Frontend can distinguish this from terminal output by parsing as JSON
 */
private void broadcastControlMessage(String sessionId, String type, String code, String message)
```

### Control Message Format
```json
{
  "type": "error",
  "code": "SSH_DISCONNECTED",
  "message": "SSH connection lost. Press R to reconnect.",
  "sessionId": "session-uuid",
  "timestamp": 1740432000000
}
```

### Usage Examples

#### SSH Disconnection
```java
broadcastControlMessage(sessionId, "error", "SSH_DISCONNECTED", 
    "SSH connection lost. Press R to reconnect.");
```

#### Input Error
```java
broadcastControlMessage(sessionId, "error", "INPUT_ERROR", errorMessage);
```

#### Stream Closed
```java
broadcastControlMessage(sessionId, "status", "STREAM_CLOSED", 
    "Terminal stream has ended");
```

## Frontend Changes Required

### WebSocket Message Handler
```javascript
ws.onmessage = function(event) {
    const data = event.data;
    
    // Try to parse as JSON
    try {
        const controlMsg = JSON.parse(data);
        
        // If it has control message structure, handle it
        if (controlMsg.type && controlMsg.code && controlMsg.message) {
            handleControlMessage(controlMsg);
            return; // Don't print to terminal
        }
    } catch (e) {
        // Not JSON - it's terminal output
    }
    
    // Print regular terminal output
    terminal.write(data);
};

function handleControlMessage(msg) {
    switch (msg.code) {
        case 'SSH_DISCONNECTED':
            showErrorNotification('SSH connection lost. Press R to reconnect.');
            enableReconnectButton();
            break;
        case 'INPUT_ERROR':
            showWarning('Input error: ' + msg.message);
            break;
        case 'STREAM_CLOSED':
            showInfo('Terminal session ended');
            break;
    }
}
```

## Benefits

### 1. No False Alarms
- File content containing `__SSH_DISCONNECTED__` won't trigger error handling
- Only valid JSON control messages are processed as system events

### 2. Clean Separation
- Terminal output: raw text (like user expects)
- System messages: structured JSON (easy to parse)

### 3. Extensible
- Easy to add new error codes without breaking existing code
- Can add metadata fields (timestamp, sessionId, etc.)

### 4. Debuggable
- Control messages visible in browser console
- Clear distinction in logs

## Error Codes

| Code | Type | Trigger | User Action |
|------|------|---------|-------------|
| `SSH_DISCONNECTED` | error | SSH channel loses connection | Press R to reconnect |
| `INPUT_ERROR` | error | Failed to send input to terminal | Check connection |
| `STREAM_CLOSED` | status | Terminal stream ended normally | Session complete |

## Testing

### Test 1: SSH Disconnection
1. Create SSH session
2. Kill SSH server or break network
3. Try typing in terminal
4. Should receive JSON control message:
   ```json
   {"type":"error","code":"SSH_DISCONNECTED",...}
   ```

### Test 2: False Alarm Prevention
1. Create SSH session
2. Run: `echo '__SSH_DISCONNECTED__'`
3. Should print `__SSH_DISCONNECTED__` in terminal (not trigger error)
4. Only valid JSON messages trigger control flow

### Test 3: Stream Closed
1. Create SSH session
2. Run: `exit`
3. Should receive:
   ```json
   {"type":"status","code":"STREAM_CLOSED",...}
   ```

## Documentation

- See `WEBSOCKET-CONTROL-MESSAGES.md` for complete frontend guide
- Includes all error codes and handling examples
- Shows JSON message structure

## Next Steps

### Frontend Implementation
- [ ] Add JSON parsing to WebSocket message handler
- [ ] Implement control message routing
- [ ] Add error notification UI
- [ ] Handle SSH_DISCONNECTED with reconnect button
- [ ] Test with various error scenarios

### Future Enhancements
- Add more control message types (RECONNECTING, RECONNECTED, etc.)
- Add server-side heartbeat with PING/PONG control messages
- Implement automatic reconnection with status updates
- Add session timeout warnings

