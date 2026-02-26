# Dead Session Tab Restoration Fix - February 26, 2026

## 🐛 Problem

When users had active SSH/local terminal sessions and then:
1. SSH connection went **idle and disconnected** (e.g., server timeout)
2. User **refreshed the browser page**

**Result:**
- ❌ Dead session tabs were **restored** even though SSH connection was dead
- ❌ User saw tabs for sessions that no longer existed in memory
- ❌ Tabs persisted indefinitely because they were stored in database with `status='active'`

### Why This Happened

The tab restoration flow had a critical flaw:

```
1. User refreshes page
   ↓
2. Frontend calls: GET /terminal/sessions
   ↓
3. Backend returns: ALL sessions with status='active' from database
   ↓
4. Frontend restores tabs for ALL returned sessions
   ↓
5. Problem: Some sessions are 'active' in DB but DEAD in memory!
```

**Root Cause:**
- Backend stored session metadata in database with `status='active'`
- When SSH connection died (idle timeout, network error, etc.), the session was removed from **memory** but remained `active` in **database**
- The `GET /terminal/sessions` endpoint returned ALL database sessions with `status='active'` without checking if they were actually alive in memory

## ✅ Solution

Modified `TerminalService.getAllActiveSessions()` to **only return sessions that are actually alive in memory**.

### Implementation

**File:** `TerminalService.java`

```java
/**
 * Get all active terminal sessions (only returns sessions that are ALIVE in memory)
 *
 * This prevents restoring tabs for dead SSH connections that are still marked
 * as 'active' in the database. If a session exists in DB but not in memory,
 * it gets marked as 'closed' automatically.
 *
 * @return List of active sessions that are actually running
 */
public List<TerminalSession> getAllActiveSessions() {
    List<TerminalSession> dbSessions = sessionRepository.findByStatus("active");
    
    // Filter out sessions that are NOT alive in memory
    List<TerminalSession> aliveSessions = dbSessions.stream()
        .filter(dbSession -> {
            String sessionId = dbSession.getSessionId();
            boolean isAlive = sessions.containsKey(sessionId);
            
            if (!isAlive) {
                // Session is in DB but NOT in memory - mark it as closed
                log.info("[GetActiveSessions] Session {} is dead (not in memory), marking as closed", sessionId);
                dbSession.setStatus("closed");
                dbSession.setClosedAt(LocalDateTime.now());
                sessionRepository.save(dbSession);
            }
            
            return isAlive;
        })
        .collect(java.util.stream.Collectors.toList());
    
    log.debug("[GetActiveSessions] Found {} alive sessions out of {} in DB", aliveSessions.size(), dbSessions.size());
    return aliveSessions;
}
```

### How It Works

**Before Fix:**
```
GET /terminal/sessions
  ↓
Return ALL sessions with status='active' from database
  ↓
Frontend restores tabs for dead sessions ❌
```

**After Fix:**
```
GET /terminal/sessions
  ↓
For each session in database with status='active':
  ├─ Is session alive in memory (sessions.containsKey(sessionId))?
  │  ├─ YES → Include in response ✅
  │  └─ NO → Mark as 'closed' in database, exclude from response ✅
  ↓
Return ONLY alive sessions
  ↓
Frontend restores tabs ONLY for alive sessions ✅
```

## 🧪 Testing Scenarios

### Scenario 1: SSH Idle Timeout
1. Open SSH session
2. Leave it idle until server disconnects (e.g., 5 minutes)
3. SSH banner appears: `<<SSH_DISCONNECTED>>`
4. Session is removed from memory but still `active` in DB
5. User refreshes page
6. **Expected:** Tab is NOT restored (session is marked as closed)

### Scenario 2: Manual Close Tab
1. Open SSH session
2. User clicks "X" to close tab
3. Frontend calls `DELETE /terminal/{sessionId}`
4. Backend closes session and marks it as `closed` in DB
5. User refreshes page
6. **Expected:** Tab is NOT restored

### Scenario 3: Active Sessions
1. Open SSH session
2. Keep it active (typing commands)
3. User refreshes page
4. **Expected:** Tab IS restored and auto-reconnects

### Scenario 4: Mixed Sessions
1. Open 3 SSH sessions
2. Session 1: Active ✅
3. Session 2: Idle timeout (dead) ❌
4. Session 3: Active ✅
5. User refreshes page
6. **Expected:** Only Session 1 and Session 3 are restored

## 📊 Impact

### Before Fix
```
Database: 10 sessions with status='active'
Memory: 7 sessions actually alive
GET /terminal/sessions returns: 10 sessions
Tabs restored: 10 tabs (including 3 dead sessions) ❌
```

### After Fix
```
Database: 10 sessions with status='active'
Memory: 7 sessions actually alive
GET /terminal/sessions:
  - Checks each session against memory
  - Marks 3 dead sessions as 'closed' in DB
  - Returns: 7 sessions
Tabs restored: 7 tabs (only alive sessions) ✅
```

## 🔄 Related Files

1. **Backend:**
   - `TerminalService.java` - Modified `getAllActiveSessions()`
   - `TerminalController.java` - Endpoint: `GET /terminal/sessions`

2. **Frontend:**
   - `terminal.js` - `restoreSavedTabs()` function
   - `terminal.js` - Tab persistence logic

3. **Database:**
   - `TerminalSession` entity - Updated status automatically

## 📝 Additional Notes

- This fix also improves database hygiene by automatically cleaning up stale session records
- No frontend changes required - fix is entirely on backend
- Backward compatible - existing behavior preserved for active sessions
- Dead sessions are properly marked as `closed` with timestamp for audit trail

## ✅ Verification

Build successful:
```bash
cd C:\Users\admin\dev\messaging\messaging-platform-sdk
gradlew :agents:examples:sdk-local-service:build -x test
# BUILD SUCCESSFUL
```

No compilation errors, only pre-existing warnings.

