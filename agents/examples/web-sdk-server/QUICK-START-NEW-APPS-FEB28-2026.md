# 🚀 QUICK START GUIDE - Testing New Apps

**Date:** February 28, 2026  
**Status:** All apps ready - Backend setup required

---

## ⚠️ IMPORTANT: Config Loader Fixed

The config-loader.js has been updated to:
- ✅ Detect web-sdk-server (port 8090) and use `/api/config`
- ✅ Detect web-agent (port 8088) and use `/app/api/config`
- ✅ Handle `file://` protocol gracefully (defaults to localhost:8090)

---

## 🎯 ISSUE #1 FIXED: Config Endpoint

**Problem:** Apps tried to use `/app/api/config` (wrong endpoint for web-sdk-server)

**Solution:** Updated `config-loader.js` to detect environment:
```javascript
// Web SDK Server (port 8090) - different endpoint
if (port === '8090' || pathname.includes('/apps/')) {
    configUrl = '/api/config';
}
// Web Agent (port 8088) or IntelliJ dev server
else if (hostname === 'localhost' || hostname === '127.0.0.1') {
    configUrl = '/app/api/config';
}
```

**File:// Protocol:** Now defaults to `http://localhost:8090/api/config`

---

## 🎯 ISSUE #2 FIXED: Hide New Apps in Production

**Problem:** New experimental apps should only show on localhost

**Solution:** 
1. Added `localhost-only` class to all 5 new app cards
2. Added `display: none` inline style by default
3. Added JavaScript to show them only on localhost:

```javascript
window.addEventListener('DOMContentLoaded', function() {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
    
    if (isLocalhost) {
        document.querySelectorAll('.localhost-only').forEach(card => {
            card.style.display = '';
        });
    }
});
```

**Result:**
- ✅ On localhost: All 5 new apps visible with 🆕 badges
- ✅ On production: New apps hidden (only stable apps shown)

---

## 🚀 HOW TO TEST

### Step 1: Start Backend

```bash
cd messaging-platform-sdk/agents/examples/web-sdk-server
./gradlew bootRun
```

**Wait for:** `Started WebSdkServerApplication in X.XXX seconds`

### Step 2: Verify Backend Running

```bash
curl http://localhost:8090/api/health
```

**Expected Response:**
```json
{
  "status": "UP",
  "service": "web-sdk-server",
  "messagingService": "UP"
}
```

### Step 3: Open Landing Page

Open browser to: **http://localhost:8090/**

**You should see:**
- ✅ All existing apps (Whiteboard, Chat, etc.)
- ✅ 5 new apps with 🆕 NEW badges (localhost only!)

### Step 4: Test Any New App

Click on any new app card (e.g., Pictionary):
1. Connection modal appears
2. Enter username (e.g., "Alice")
3. Enter channel (e.g., "test-room")
4. Click Connect
5. ✅ Should connect successfully!

### Step 5: Test Multiplayer

1. **Tab 1:** Connected as "Alice" in "test-room"
2. **Tab 2:** Open same app → Connect as "Bob" in "test-room"
3. ✅ Both users should see each other
4. ✅ Actions sync in real-time!

---

## 🐛 TROUBLESHOOTING

### Problem: "Failed to fetch config: Not Found"

**Cause:** Backend not running or wrong port

**Fix:**
```bash
# Start backend
cd messaging-platform-sdk/agents/examples/web-sdk-server
./gradlew bootRun

# Then open: http://localhost:8090/apps/pictionary/
# NOT file:///path/to/index.html
```

### Problem: Apps not visible on landing page

**Cause 1:** Not accessing via localhost

**Fix:** Use `http://localhost:8090/` not `http://127.0.0.1:8090/` (hostname check)

**Cause 2:** JavaScript not executed

**Fix:** Check browser console for errors, refresh page

### Problem: "Cannot connect to channel"

**Cause:** Messaging service not running

**Fix:**
```bash
# Start messaging service first
cd messaging-platform-services
./gradlew :services:bootRun

# Then start web-sdk-server
cd messaging-platform-sdk/agents/examples/web-sdk-server
./gradlew bootRun
```

### Problem: DataChannel not establishing

**Cause:** WebRTC connection issues

**Fix:**
1. Check browser console for WebRTC errors
2. Verify TURN/STUN servers from messaging service
3. Test with simple app (chat) first
4. Check firewall settings

---

## ✅ SUCCESS INDICATORS

### Backend Started Successfully
```
Started WebSdkServerApplication in 3.456 seconds (process running for 4.123)
```

### Landing Page Loaded
- Can see Whiteboard, Chat, Terminal (existing apps)
- Can see 5 new apps with 🆕 badges (localhost only)

### App Connected Successfully
- Connection status shows "Connected" (green dot)
- Share button appears (top-right)
- Room name displayed in badge
- UI becomes interactive

### Multiplayer Working
- Second user connects to same channel
- Both users see each other in user list
- Actions in Tab 1 appear in Tab 2 instantly

---

## 📋 VERIFICATION CHECKLIST

### Backend
- [ ] Messaging service running (port 8080)
- [ ] Web-sdk-server running (port 8090)
- [ ] Health check returns "UP" status
- [ ] `/api/config` endpoint responding

### Landing Page
- [ ] Accessible at http://localhost:8090/
- [ ] All existing apps visible
- [ ] 5 new apps visible (with 🆕 badges)
- [ ] No console errors

### Pictionary
- [ ] Opens at http://localhost:8090/apps/pictionary/
- [ ] Connection modal appears
- [ ] Can connect to channel
- [ ] Can draw on canvas
- [ ] Multiplayer sync works

### Chess
- [ ] Opens at http://localhost:8090/apps/chess/
- [ ] Can choose color (white/black/spectator)
- [ ] Can move pieces
- [ ] Move validation works
- [ ] Spectator can watch

### Pixel Art
- [ ] Opens at http://localhost:8090/apps/pixel-art/
- [ ] Can draw pixels
- [ ] Tools work (pen, eraser, fill, eyedropper)
- [ ] Zoom works
- [ ] Export PNG works

### Collab Doc
- [ ] Opens at http://localhost:8090/apps/collab-doc/
- [ ] CodeMirror loads
- [ ] Can type in editor
- [ ] Preview updates
- [ ] Theme toggle works

### Mind Map
- [ ] Opens at http://localhost:8090/apps/mind-map/
- [ ] Can create nodes
- [ ] Can drag nodes
- [ ] Can connect nodes
- [ ] Zoom and pan works

---

## 🎯 NEXT STEPS

### 1. Start Backend
```bash
cd messaging-platform-sdk/agents/examples/web-sdk-server
./gradlew bootRun
```

### 2. Open Landing Page
```
http://localhost:8090/
```

### 3. Try New Apps
Look for 🆕 NEW badges in "Live Demos" section

### 4. Share & Collaborate
- Click Share button in any app
- Show QR code or copy link
- Others scan/open link → auto-connect!

---

## 🎉 SUMMARY

### What Was Fixed
1. ✅ **Config loader** - Now detects web-sdk-server port 8090
2. ✅ **File protocol** - Handles file:// gracefully (defaults to localhost:8090)
3. ✅ **Localhost-only visibility** - New apps hidden in production
4. ✅ **Auto-show on localhost** - JavaScript detects hostname

### What's Ready
- ✅ 5 new apps implemented
- ✅ All using UserConnectionBase pattern
- ✅ Config endpoint detection fixed
- ✅ Production/localhost separation
- ✅ Documentation complete

### How to Access
1. **Start backend:** `./gradlew bootRun`
2. **Open portal:** http://localhost:8090/
3. **See new apps:** Look for 🆕 badges
4. **Test immediately:** Click any app card

---

## 💡 PRO TIPS

### Development Tips
- Always access via **http://localhost:8090/** (not file://)
- Check backend console for API calls
- Use browser dev tools network tab
- Test with 2+ browser tabs

### Sharing Tips
- Use Share button (generates QR + link)
- QR codes work great for mobile
- Password-protect sensitive channels
- Shareable links auto-connect users

### Debugging Tips
- Check browser console first
- Verify `/api/config` returns 200 OK
- Check WebRTC DataChannel establishment
- Look for "Connected" status (green dot)

---

## 🎊 ALL FIXED & READY!

Both issues resolved:
1. ✅ Config loader endpoint detection fixed
2. ✅ New apps hidden on production, shown on localhost

**Test now at:** http://localhost:8090/

(Make sure backend is running first!)

---

**End of Quick Start Guide**

