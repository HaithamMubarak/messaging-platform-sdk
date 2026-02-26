# WebSocket Control Messages for Terminal

## Overview

The terminal WebSocket handler sends **two types of messages**:

1. **Terminal Output** (raw text) - Actual terminal data from SSH/CMD/Bash
2. **Control Messages** (JSON) - Errors, status updates, system notifications

## Message Types

### Terminal Output (Raw Text)
Regular terminal output is sent as plain text:
```
user@host:~$ ls -la
total 48
drwxr-xr-x  6 user user 4096 Feb 25 10:30 .
drwxr-xr-x 12 user user 4096 Feb 25 10:00 ..
```

### Control Messages (JSON)
System messages are sent as JSON objects:
```json
{
  "type": "error",
  "code": "SSH_DISCONNECTED",
  "message": "SSH connection lost. Press R to reconnect.",
  "sessionId": "session-uuid",
  "timestamp": 1740432000000
}
```

## Control Message Types

### Error Messages
```json
{
  "type": "error",
  "code": "SSH_DISCONNECTED",
  "message": "SSH connection lost. Press R to reconnect.",
  "sessionId": "session-uuid",
  "timestamp": 1740432000000
}
```

```json
{
  "type": "error",
  "code": "INPUT_ERROR",
  "message": "Failed to send input: connection timeout",
  "sessionId": "session-uuid",
  "timestamp": 1740432000000
}
```

### Status Messages
```json
{
  "type": "status",
  "code": "STREAM_CLOSED",
  "message": "Terminal stream has ended",
  "sessionId": "session-uuid",
  "timestamp": 1740432000000
}
```

## Frontend Handling

### JavaScript Example

```javascript
const ws = new WebSocket('ws://localhost:7080/terminal/stream/' + sessionId);

ws.onmessage = function(event) {
    const data = event.data;
    
    // Try to parse as JSON - if successful, it's a control message
    try {
        const controlMsg = JSON.parse(data);
        
        // Check if it's a control message (has type, code, message)
        if (controlMsg.type && controlMsg.code && controlMsg.message) {
            handleControlMessage(controlMsg);
            return; // Don't print to terminal
        }
    } catch (e) {
        // Not JSON - it's terminal output
    }
    
    // Regular terminal output - print to terminal
    terminal.write(data);
};

function handleControlMessage(msg) {
    console.log('[Control Message]', msg);
    
    switch (msg.code) {
        case 'SSH_DISCONNECTED':
            // Show reconnect button or notification
            showNotification('SSH connection lost. Press R to reconnect.', 'error');
            enableReconnectButton();
            break;
            
        case 'INPUT_ERROR':
            // Show error notification
            showNotification('Input error: ' + msg.message, 'warning');
            break;
            
        case 'STREAM_CLOSED':
            // Terminal stream ended
            showNotification('Terminal session ended', 'info');
            break;
            
        default:
            console.warn('Unknown control message:', msg);
    }
}
```

### Why This Approach Works

1. **No Conflicts with File Content**
   - If a user does `cat file.txt` and the file contains `__SSH_DISCONNECTED__`, it won't trigger false alarms
   - Only valid JSON messages with `type`, `code`, `message` fields are treated as control messages

2. **Backward Compatible**
   - Existing terminals that don't parse JSON will just ignore the control messages
   - Or they can be filtered client-side

3. **Extensible**
   - Easy to add new control message types without breaking existing code
   - Can add metadata (timestamp, sessionId, etc.) as needed

4. **Debugging**
   - Control messages are clearly visible in browser console
   - Easy to distinguish from terminal output in logs

## Backend Implementation

### Sending Terminal Output
```java
// Regular terminal data - send as-is
broadcast(sessionId, terminalOutput);
```

### Sending Control Messages
```java
// Error or status notification - send as JSON
broadcastControlMessage(sessionId, "error", "SSH_DISCONNECTED", 
    "SSH connection lost. Press R to reconnect.");
```

## Error Codes Reference

| Code | Type | Description | User Action |
|------|------|-------------|-------------|
| `SSH_DISCONNECTED` | error | SSH channel lost connection | Press R to reconnect |
| `INPUT_ERROR` | error | Failed to send input to terminal | Check connection |
| `STREAM_CLOSED` | status | Terminal stream ended | Session completed |

## Future Enhancements

Potential future control message types:
- `RECONNECTING` - Automatic reconnection in progress
- `RECONNECTED` - Connection restored
- `SESSION_TIMEOUT` - Session expired
- `PERMISSION_DENIED` - Permission error
- `SFTP_READY` - SFTP session available
- `SFTP_ERROR` - SFTP operation failed

