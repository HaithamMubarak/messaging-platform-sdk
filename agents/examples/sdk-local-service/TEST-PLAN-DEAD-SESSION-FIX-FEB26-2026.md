# Test Plan: Dead Session Tab Restoration Fix - February 26, 2026

## Overview
This test plan verifies that tabs are correctly restored ONLY for sessions that are actually alive in memory, and dead sessions (e.g., SSH idle timeout) are NOT restored.

---

## Test Environment Setup

### Prerequisites
1. Start MLS (sdk-local-service) backend
2. Open terminal web app in browser
3. Have access to SSH server with configurable idle timeout (or ability to kill SSH connections)

### Test Data
- **SSH Server:** Any accessible SSH server
- **Local Terminal:** CMD/PowerShell on Windows, Bash on Linux/Mac
- **Idle Timeout:** Set SSH server timeout to 1-2 minutes for faster testing

---

## Test Cases

### Test Case 1: Active Session Restoration (Positive Test)
**Objective:** Verify active sessions are properly restored after page refresh

**Steps:**
1. Open SSH terminal session
2. Run some commands to keep it active
3. Verify session is connected and responding
4. **Refresh the page (F5)**
5. Wait for tabs to restore

**Expected Results:**
- ✅ Tab is restored with correct name and icon
- ✅ Terminal auto-reconnects to WebSocket
- ✅ Terminal shows previous output (if any)
- ✅ Terminal is interactive and responds to commands
- ✅ Backend logs: `[GetActiveSessions] Found 1 alive sessions out of 1 in DB`

**Actual Results:**
- [ ] Pass
- [ ] Fail (describe issue):

---

### Test Case 2: Dead SSH Session After Idle Timeout (Negative Test)
**Objective:** Verify dead SSH sessions are NOT restored

**Steps:**
1. Open SSH terminal session
2. Leave it idle (no commands) for timeout period (e.g., 5 minutes)
3. Wait for SSH disconnection banner to appear: `<<SSH_DISCONNECTED>>`
4. Verify session shows reconnect overlay
5. **Refresh the page (F5)**
6. Wait for tabs to restore

**Expected Results:**
- ✅ Tab is NOT restored
- ✅ Empty state message shown: "No terminal sessions open"
- ✅ Backend logs: `[GetActiveSessions] Session {id} is dead (not in memory), marking as closed`
- ✅ Database: Session status changed from 'active' to 'closed'
- ✅ Database: closedAt timestamp is set

**Actual Results:**
- [ ] Pass
- [ ] Fail (describe issue):

---

### Test Case 3: Manual Tab Close (Positive Test)
**Objective:** Verify manually closed tabs are not restored

**Steps:**
1. Open SSH terminal session
2. Click the "X" button to close the tab
3. Verify tab is removed from UI
4. **Refresh the page (F5)**
5. Wait for tabs to restore

**Expected Results:**
- ✅ Tab is NOT restored
- ✅ Empty state message shown (if no other tabs)
- ✅ Backend received DELETE request for session
- ✅ Database: Session status = 'closed'

**Actual Results:**
- [ ] Pass
- [ ] Fail (describe issue):

---

### Test Case 4: Mixed Sessions (Multiple Active + Dead)
**Objective:** Verify only alive sessions are restored when mixing active and dead sessions

**Steps:**
1. Open 4 terminal sessions:
   - Session A: SSH (keep active - run commands periodically)
   - Session B: Local CMD (keep active)
   - Session C: SSH (let it idle timeout)
   - Session D: SSH (keep active)
2. Wait for Session C to timeout and show disconnection banner
3. **Refresh the page (F5)**
4. Wait for tabs to restore

**Expected Results:**
- ✅ 3 tabs restored: Session A, B, D
- ✅ Session C is NOT restored
- ✅ Restored tabs are in correct order
- ✅ Active tab is properly selected
- ✅ Backend logs: `[GetActiveSessions] Found 3 alive sessions out of 4 in DB`
- ✅ Database: Session C marked as 'closed', others still 'active'

**Actual Results:**
- [ ] Pass
- [ ] Fail (describe issue):

---

### Test Case 5: Backend Restart (Edge Case)
**Objective:** Verify behavior when backend restarts and all memory sessions are lost

**Steps:**
1. Open 2 SSH terminal sessions
2. Keep them active and connected
3. **Stop the backend (sdk-local-service)**
4. **Start the backend again**
5. **Refresh the browser page (F5)**
6. Wait for tabs to restore

**Expected Results:**
- ✅ NO tabs are restored (backend memory is empty)
- ✅ Empty state message shown
- ✅ Backend logs: All sessions marked as closed
- ✅ Database: All sessions status changed to 'closed'
- ✅ No errors in browser console

**Actual Results:**
- [ ] Pass
- [ ] Fail (describe issue):

---

### Test Case 6: WebSocket Close Without Tab Close (Edge Case)
**Objective:** Verify session cleanup when WebSocket closes but tab isn't explicitly closed

**Steps:**
1. Open SSH terminal session
2. Open browser DevTools → Network tab
3. Find the WebSocket connection
4. **Manually close the WebSocket** (right-click → Close Connection)
5. Wait 5 seconds
6. **Refresh the page (F5)**

**Expected Results:**
- ✅ Tab is NOT restored
- ✅ Backend detected WebSocket close
- ✅ Backend called `closeSession()` after last client disconnected
- ✅ Database: Session marked as 'closed'
- ✅ Backend logs: `[WebSocket] All clients disconnected for session: {id}, closing terminal session`

**Actual Results:**
- [ ] Pass
- [ ] Fail (describe issue):

---

### Test Case 7: Browser Tab Close (System Event)
**Objective:** Verify session cleanup when user closes browser tab (not explicit close button)

**Steps:**
1. Open SSH terminal session
2. Keep it active
3. **Close the browser tab** (not the "X" button, but the browser tab itself)
4. Open new browser tab
5. Navigate to terminal app
6. Wait for tabs to restore

**Expected Results:**
- ✅ Tab is NOT restored (WebSocket closed when browser tab closed)
- ✅ Empty state message shown
- ✅ Backend: WebSocket disconnect triggered session cleanup
- ✅ Database: Session marked as 'closed'

**Actual Results:**
- [ ] Pass
- [ ] Fail (describe issue):

---

### Test Case 8: Multiple Browser Windows (Concurrent Clients)
**Objective:** Verify session is kept alive when multiple browser windows are connected

**Steps:**
1. Open terminal app in **Browser Window 1**
2. Create SSH session
3. Open terminal app in **Browser Window 2**
4. Verify both windows show the same session tab
5. Close **Browser Window 1**
6. Wait 5 seconds
7. Verify **Browser Window 2** still shows active session
8. **Refresh Browser Window 2**

**Expected Results:**
- ✅ Session is NOT closed when Window 1 closes (Window 2 still connected)
- ✅ After refresh, tab IS restored (session still alive)
- ✅ Backend logs: `Client disconnected, 1 client(s) remaining for session: {id}`

**Actual Results:**
- [ ] Pass
- [ ] Fail (describe issue):

---

## Database Verification Queries

Use these SQL queries to verify database state during testing:

```sql
-- View all sessions with status
SELECT sessionId, type, status, createdAt, closedAt, tabName 
FROM terminal_session 
ORDER BY createdAt DESC;

-- Count active vs closed sessions
SELECT status, COUNT(*) 
FROM terminal_session 
GROUP BY status;

-- Find sessions that should be closed (created > 1 hour ago, still active)
SELECT sessionId, type, createdAt, 
       TIMESTAMPDIFF(MINUTE, createdAt, NOW()) as age_minutes
FROM terminal_session 
WHERE status = 'active' 
  AND TIMESTAMPDIFF(MINUTE, createdAt, NOW()) > 60;
```

---

## Backend Log Monitoring

Watch for these key log messages:

### During Tab Restoration (GET /terminal/sessions)
```
[GetActiveSessions] Session {id} is dead (not in memory), marking as closed
[GetActiveSessions] Found {alive} alive sessions out of {total} in DB
```

### During WebSocket Close
```
[WebSocket] All clients disconnected for session: {id}, closing terminal session
[WebSocket] Client disconnected, {count} client(s) remaining for session: {id}
```

### During Session Close (DELETE /terminal/{id})
```
[Controller] Received close request for session: {id}
[TerminalService] Closing session: {id}
[TerminalService] Database updated for session: {id}
```

---

## Performance Testing

### Load Test: Many Dead Sessions
**Objective:** Verify performance when cleaning up many dead sessions

**Setup:**
1. Create 50 SSH sessions (automate via script)
2. Let all sessions idle timeout
3. Refresh page
4. Measure time to restore tabs

**Metrics:**
- Time to process GET /terminal/sessions: < 2 seconds
- Database queries: < 1 second
- Frontend restoration: < 1 second
- **Total:** < 5 seconds

---

## Regression Testing

Ensure fix doesn't break existing functionality:

1. ✅ New session creation (local, SSH)
2. ✅ Tab rename
3. ✅ Tab reordering
4. ✅ Session sharing
5. ✅ SFTP integration
6. ✅ Context menu (right-click)
7. ✅ Keyboard shortcuts
8. ✅ Mobile support

---

## Sign-off

**Tester:** _________________  
**Date:** _________________  
**Status:** ☐ Passed ☐ Failed ☐ Blocked  
**Notes:**

