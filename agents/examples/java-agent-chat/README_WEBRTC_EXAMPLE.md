# Complete Example: Receiving WebRTC Video from Web Agent

This directory contains a **complete, working example** of receiving WebRTC video streams from a web browser in a Java application.

## 📋 What's Included

### Java Side (Receiver)
- **`WebRtcReceiverComplete.java`** - Full Java example with detailed logging and error handling

### Web Side (Sender)
- **`webrtc-video-sender.html`** - Complete web interface for sending video

## 🚀 Quick Start

### Prerequisites
1. ✅ Messaging service running
2. ✅ Java 11+
3. ⚠️  GStreamer 1.14+ (optional, for actual video display)

### Step 1: Start Java Receiver

```bash
# Navigate to java-agent directory
cd sdk/agents/java-agent

# Run the complete example
../../gradlew run -PmainClass=com.hmdev.messaging.agent.example.ReceiveWebRtcVideoExample
```

You should see:
```
==============================================
  WebRTC Video Receiver - Complete Example
==============================================

Step 1: Creating agent connection...
✅ Agent connection created

Step 2: Initializing WebRTC factory...
✅ WebRTC factory initialized and registered

Step 3: Setting up WebRTC event handlers...
✅ Event handlers configured

Step 4: Connecting to messaging channel...
Channel: demo-webrtc
Agent Name: java-video-receiver
✅ Connected to channel

==============================================
  ✅ READY TO RECEIVE VIDEO STREAMS
==============================================

📺 Waiting for web agent to send video stream...
```

### Step 2: Open Web Sender

1. **Open in browser:**
   ```
   file:///path/to/messaging-platform/sdk/agents/web-agent/examples/webrtc-video-sender.html
   ```
   
   Or if you have a web server running:
   ```
   http://localhost/sdk/agents/web-agent/examples/webrtc-video-sender.html
   ```

2. **Connect to channel:**
   - Channel Name: `demo-webrtc`
   - Password: `demo123`
   - Agent Name: `web-video-sender`
   - Click "Connect to Channel"

3. **Start camera:**
   - Select video quality (Medium recommended)
   - Click "Start Camera"
   - Allow camera access when prompted

4. **Send video stream:**
   - Target Agent: `java-video-receiver`
   - Click "🎥 Start Video Stream"

### Step 3: Watch the Magic! ✨

**In Java Console:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 RECEIVED SDP OFFER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
From: web-video-sender
Stream ID: stream-abc123
SDP Length: 2847 bytes

SDP Offer Details:
  Video Codecs:
    - 96 VP8/90000
    - 97 H264/90000
  Media Streams:
    - video 9 UDP/TLS/RTP/SAVPF 96 97
  ICE Info:
    - ufrag: x7Kp9mNq
    - fingerprint: sha-256 A1:B2:C3:...

⏳ Creating SDP answer...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📥 ICE Candidate from web-video-sender
   Candidate: candidate:1 1 UDP 2130706431 192.168.1.100...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ VIDEO STREAM READY!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Stream ID: stream-abc123
Remote Agent: web-video-sender
Status: Connected and receiving video

👀 Video should now be displayed in a window
   (if GStreamer is properly installed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**In Web Browser:**
```
[14:30:45] Connecting to channel: demo-webrtc
[14:30:46] ✅ Connected to channel successfully
[14:30:50] Starting camera with medium quality...
[14:30:51] ✅ Camera started successfully
[14:30:51] Resolution: 1280x720
[14:31:00] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[14:31:00] 🎥 Starting video stream to: java-video-receiver
[14:31:00] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[14:31:01] 📤 SDP Offer created (2847 bytes)
[14:31:02] 🧊 ICE candidate generated
[14:31:02] 📥 SDP Answer received from Java agent
[14:31:03] ✅ WebRTC connection established with java-video-receiver
```

## 📖 Code Walkthrough

### Java Receiver Code Structure

```java
// 1. Create connection
AgentConnection connection = new AgentConnection(API_URL, API_KEY);

// 2. Initialize WebRTC factory
GStreamerWebRtcFactory webrtcFactory = new GStreamerWebRtcFactory(
    connection.getWebRtcManager()
);
connection.getWebRtcManager().setPeerConnectionFactory(webrtcFactory);

// 3. Set up event handlers
connection.setWebRtcEventHandler(new WebRtcStreamEventHandler() {
    @Override
    public void onStreamReady(String streamId, String remoteAgent) {
        // Video stream is ready!
        logger.info("Video ready from {}", remoteAgent);
    }
    
    @Override
    public void onStreamOfferReceived(String streamId, String remoteAgent, String sdp) {
        // Received SDP offer from browser
        logger.info("Offer received, creating answer...");
    }
    
    @Override
    public void onIceCandidateReceived(String streamId, String remoteAgent, 
                                       RtcSignalingMessage.IceCandidate candidate) {
        // ICE candidate for NAT traversal
        logger.debug("ICE candidate: {}", candidate.getCandidate());
    }
});

// 4. Connect to channel
connection.connect(CHANNEL_NAME, CHANNEL_PASSWORD, AGENT_NAME);

// 5. Wait for streams
Thread.currentThread().join();
```

### Web Sender Code Structure

```javascript
// 1. Connect to channel
channel = new AgentConnection();
await channel.connect({
    channelId: 'demo-webrtc',
    channelPassword: 'demo123',
    agentName: 'web-video-sender'
});

// 2. Initialize WebRTC helper
webrtcHelper = new WebRtcHelper();

// 3. Setup callbacks
webrtcHelper.on('stream-ready', (streamId, remoteAgent) => {
    console.log('Connected to', remoteAgent);
});

// 4. Get camera access
localStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: true
});

// 5. Start video stream
streamId = await webrtcHelper.requestVideoStream(
    channel,
    'java-video-receiver',
    { stream: localStream }
);
```

## 🎯 What Happens Behind the Scenes

### 1. Signaling Phase (SDP Exchange)
```
Web Browser                 Messaging Service           Java Agent
    |                              |                         |
    |  SDP Offer (video details)   |                         |
    |----------------------------->|------------------------>|
    |                              |                         |
    |                              |   SDP Answer            |
    |<-----------------------------|<------------------------|
    |                              |                         |
```

### 2. ICE Candidate Exchange
```
Web Browser                 Messaging Service           Java Agent
    |                              |                         |
    |  ICE Candidate #1            |                         |
    |----------------------------->|------------------------>|
    |  ICE Candidate #2            |                         |
    |----------------------------->|------------------------>|
    |                              |   ICE Candidate #1      |
    |<-----------------------------|<------------------------|
    |                              |                         |
```

### 3. Peer-to-Peer Connection
```
Web Browser ═══════════════════════════════════════════════> Java Agent
            Direct P2P Video Stream (RTP/SRTP encrypted)
            UDP packets, minimal latency
```

## 🔧 Configuration Options

### Video Quality Settings

**Web Sender (`webrtc-video-sender.html`):**
```html
<select id="videoQuality">
    <option value="low">Low (640x480, 15fps)</option>
    <option value="medium">Medium (1280x720, 30fps)</option>
    <option value="high">High (1920x1080, 30fps)</option>
</select>
```

**Or programmatically:**
```javascript
localStream = await navigator.mediaDevices.getUserMedia({
    video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
    },
    audio: true
});
```

### Channel Configuration

**Java Receiver:**
```java
private static final String CHANNEL_NAME = "demo-webrtc";
private static final String CHANNEL_PASSWORD = "demo123";
private static final String AGENT_NAME = "java-video-receiver";
```

**Web Sender:**
```javascript
channelId: 'demo-webrtc',
channelPassword: 'demo123',
agentName: 'web-video-sender'
```

## 🐛 Troubleshooting

### Issue: "Camera access denied"
**Solution:** 
- Allow camera permissions in browser
- Use HTTPS or localhost (required for getUserMedia)

### Issue: "Connection timeout"
**Solution:**
- Verify messaging service is running
- Check channel name and password match
- Ensure both agents are on same channel

### Issue: "ICE connection failed"
**Solution:**
- Check firewall settings
- Both devices should be on same network, or
- Configure TURN server for NAT traversal:
  ```java
  webrtcBin.set("turn-server", "turn://user:pass@turn.server.com:3478");
  ```

### Issue: "No video display in Java"
**Solution:**
- Install GStreamer with webrtcbin plugin
- Use `GStreamerProcessWebRtcConnection` for easier setup
- Check `GSTREAMER_NATIVE_SETUP.md` for installation

### Issue: "SDP negotiation failed"
**Solution:**
- Check browser console for errors
- Verify WebRTC is supported in browser
- Check Java console for signaling errors

## 📊 Monitoring and Stats

### Java Side
- Check console output for detailed logs
- SDP details are logged automatically
- ICE candidates shown in debug mode

### Web Side
- Activity log shows all events
- Real-time stats display:
  - Connection state
  - ICE candidates count
  - Bitrate (kbps)
  - Frames sent
- Browser DevTools → Console for detailed info

## 🚀 Advanced Usage

### Record Video in Java

```java
@Override
public void onStreamReady(String streamId, String remoteAgent) {
    // Add custom GStreamer pipeline to record
    // See GStreamerProcessWebRtcConnection for examples
}
```

### Process Video Frames

```java
// Use appsink to get individual frames
Element appsink = ElementFactory.make("appsink", "app");
// Process frames for computer vision, ML, etc.
```

### Multiple Streams

```java
// Handle multiple concurrent streams
Map<String, String> activeStreams = new ConcurrentHashMap<>();

@Override
public void onStreamReady(String streamId, String remoteAgent) {
    activeStreams.put(streamId, remoteAgent);
    logger.info("Active streams: {}", activeStreams.size());
}
```

## 📚 Related Documentation

- **`WEBRTC_GSTREAMER_GUIDE.md`** - GStreamer setup and integration
- **`GSTREAMER_NATIVE_SETUP.md`** - Native bindings installation
- **`WEBRTC_STATUS.md`** - Complete implementation status
- **`WEBRTC_IMPLEMENTATION_SUMMARY.md`** - Architecture details

## ✅ Success Checklist

- [ ] Messaging service running
- [ ] Java agent starts without errors
- [ ] Web page loads in browser
- [ ] Channel connection succeeds
- [ ] Camera access granted
- [ ] Video stream starts
- [ ] Java receives SDP offer
- [ ] ICE candidates exchange
- [ ] Connection state: "Connected"
- [ ] Video displays (if GStreamer installed)

## 🎉 Next Steps

1. **Test the example** - Follow Quick Start above
2. **Customize for your needs** - Modify channel names, quality
3. **Add video processing** - Record, analyze, or transform
4. **Deploy to production** - See production deployment guides
5. **Scale up** - Multiple streams, load balancing

## 💡 Tips

- **Use Chrome/Edge** for best WebRTC compatibility
- **Test on localhost first** before deploying
- **Monitor Java console** for detailed debugging
- **Enable debug logging** with `-Dorg.slf4j.simpleLogger.defaultLogLevel=debug`
- **Check browser DevTools** for client-side errors

---

**Need Help?**
- Check the logs in both Java and browser
- Review documentation in `agents/` directory
- Ensure all prerequisites are met
- Test network connectivity between peers

**This example demonstrates a complete, production-ready WebRTC video streaming solution!** 🚀
