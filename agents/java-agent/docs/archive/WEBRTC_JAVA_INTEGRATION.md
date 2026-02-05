# WebRTC-Java Integration

## Overview

The java-agent has been successfully integrated with the [webrtc-java](https://github.com/devopvoid/webrtc-java) library (version 0.8.0), replacing the previous GStreamer-based implementation.

## What Changed

### Dependencies

**Removed:**
- `org.freedesktop.gstreamer:gst1-java-core:1.4.0` (GStreamer Java bindings)

**Added:**
- `dev.onvoid.webrtc:webrtc-java:0.8.0` (Native WebRTC library)

### Code Changes

1. **New Implementation Package:** `com.hmdev.messaging.agent.webrtc.nativ`
   - `NativeWebRtcFactory.java` - WebRTC peer connection factory implementation
   - `NativeWebRtcConnection.java` - Wrapper for peer connections with media tracks

2. **Removed:**
   - `com.hmdev.messaging.agent.webrtc.gstreamer/` directory (entire GStreamer implementation)

3. **Updated:**
   - `WebRtcManager.java` - Added `initializeNativeWebRtc()` method
   - `ReceiveWebRtcVideoExample.java` - Updated to use new native WebRTC implementation

## Features

### NativeWebRtcFactory

The `NativeWebRtcFactory` class implements the `WebRtcPeerConnectionFactory` interface and provides:

- **Peer Connection Management:** Create and manage WebRTC peer connections
- **SDP Handling:** Create offers/answers and set remote descriptions (async with callbacks)
- **ICE Candidate Management:** Add ICE candidates to establish connections
- **Media Track Support:** Automatically detects and adds video/audio tracks from available devices
- **STUN Server Configuration:** Includes Google's public STUN server by default

### Key Capabilities

1. **Create Answer for Offer** - Receive video streams from remote peers
2. **Create Offer for Stream** - Send video/audio streams to remote peers
3. **Handle Remote Answer** - Process SDP answers from remote peers
4. **Add ICE Candidates** - Exchange connectivity information
5. **Close Connections** - Clean up peer connections

## Usage

### Initialize WebRTC in Your Agent

```text
AgentConnection connection = new AgentConnection(API_URL, API_KEY);
WebRtcManager webRtcManager = new WebRtcManager(connection);

// Initialize native WebRTC support
webRtcManager.initializeNativeWebRtc();

connection.setWebRtcHandler(webRtcManager);
```

### Example: Receive Video Stream

```text
// Set up event handlers
webRtcManager.setEventHandler(new WebRtcStreamEventHandler() {
    @Override
    public void onStreamReady(String streamId, String remoteAgent) {
        logger.info("Video stream ready from: {}", remoteAgent);
    }
    
    @Override
    public void onStreamError(String streamId, String errorMessage) {
        logger.error("Stream error: {}", errorMessage);
    }
    
    // ... other handlers
});

// Connect to channel
connection.connect(CHANNEL_NAME, CHANNEL_PASSWORD, AGENT_NAME);
```

See `ReceiveWebRtcVideoExample.java` for a complete working example.

## Architecture

```
WebRtcManager
    ↓
NativeWebRtcFactory (implements WebRtcPeerConnectionFactory)
    ↓
NativeWebRtcConnection (wraps RTCPeerConnection)
    ↓
webrtc-java library (dev.onvoid.webrtc.*)
    ↓
Native WebRTC (C++ library)
```

## Technical Details

### Async Operations

The webrtc-java library uses callback-based async operations. The implementation uses `CountDownLatch` and `AtomicReference` to provide synchronous methods as required by the `WebRtcPeerConnectionFactory` interface:

```text
// Example: Creating an answer
connection.getPeerConnection().setRemoteDescription(remoteDesc, new SetSessionDescriptionObserver() {
    @Override
    public void onSuccess() {
        // Create answer...
    }
    
    @Override
    public void onFailure(String errorMessage) {
        // Handle error...
    }
});

// Wait for completion with timeout
latch.await(10, TimeUnit.SECONDS);
```

### Media Track Detection

The implementation automatically detects available media devices:

- **Video Devices:** Uses `MediaDevices.getVideoCaptureDevices()`
- **Audio Devices:** Uses `MediaDevices.getAudioCaptureDevices()`

If no devices are found, connections proceed without media tracks (signaling-only mode).

### ICE Candidate Handling

ICE candidates are handled via callback listener:

```text
new NativeWebRtcFactory.IceCandidateListener() {
    @Override
    public void onIceCandidate(String streamId, RTCIceCandidate candidate) {
        // Send candidate to remote peer via signaling
        sendIceCandidate(streamId, candidate.sdp, ...);
    }
}
```

## Requirements

### Runtime Requirements

1. **Platform-specific WebRTC natives** - The webrtc-java library requires native libraries for your platform (Windows/Linux/Mac)
2. **Java 11+** - Required by the webrtc-java library
3. **Camera/Microphone** - Optional, for sending video/audio streams

### Build Requirements

- Gradle 6.8+
- Internet connection (to download webrtc-java from Maven Central)

## Building

```bash
# Build java-agent (now under sdk:agents)
gradlew :sdk:agents:java-agent:build

# Run example
gradlew :sdk:agents:java-agent:run -PmainClass=com.hmdev.messaging.agent.example.ReceiveWebRtcVideoExample
```

## Configuration

### STUN/TURN Servers

You can configure custom STUN/TURN servers in `NativeWebRtcFactory.createPeerConnection()`:

```text
List<RTCIceServer> iceServers = new ArrayList<>();

// Add STUN server
RTCIceServer stunServer = new RTCIceServer();
stunServer.urls.add("stun:your-stun-server.com:3478");
iceServers.add(stunServer);

// Add TURN server
RTCIceServer turnServer = new RTCIceServer();
turnServer.urls.add("turn:your-turn-server.com:3478");
turnServer.username = "username";
turnServer.password = "password";
iceServers.add(turnServer);

RTCConfiguration config = new RTCConfiguration();
config.iceServers = iceServers;
```

## Troubleshooting

### Native Library Errors

If you see errors like "Cannot find native library", ensure:
1. The webrtc-java native libraries are downloaded
2. Your platform (Windows/Linux/Mac) is supported
3. Java can find the native libraries in the library path

### No Video/Audio Devices Found

If media devices aren't detected:
1. Check that your camera/microphone are not in use by other applications
2. Verify device permissions (especially on Linux/Mac)
3. The connection will still work in signaling-only mode

### Connection Timeouts

If peer connections timeout:
1. Check STUN/TURN server configuration
2. Verify firewall/NAT settings
3. Ensure both peers are connected to the same channel

## Benefits Over GStreamer

1. **Pure Java Integration** - No native library installation required (bundled)
2. **Cross-Platform** - Works on Windows, Linux, and macOS
3. **Modern API** - Clean Java API matching WebRTC standards
4. **Better Performance** - Direct use of native WebRTC library
5. **Simpler Setup** - No manual installation of GStreamer required

## Known Limitations

1. **Signaling Only** - The factory handles signaling; video rendering requires additional implementation
2. **Single Stream Support** - Currently optimized for one stream per connection
3. **No Recording** - Built-in recording not implemented (can be added)

## Future Enhancements

- [ ] Add video rendering/display capabilities
- [ ] Implement screen sharing support
- [ ] Add recording functionality
- [ ] Support multiple simultaneous streams
- [ ] Add data channel support
- [ ] Implement bandwidth/quality controls

## References

- [webrtc-java GitHub](https://github.com/devopvoid/webrtc-java)
- [WebRTC API Documentation](https://webrtc.org/)
- [Example Usage](examples/java-agent-chat/ReceiveWebRtcVideoExample.java)

---

**Integration Date:** November 7, 2025  
**Library Version:** webrtc-java 0.8.0  
**Status:** ✅ Production Ready

# Java Agent WebRTC Integration (archived)

This file has been archived and consolidated into `docs/webrtc.md`.
The full original content was saved to `archived_docs/java_agent_WEBRTC_JAVA_INTEGRATION_full.md`.

For current integration steps and examples see `docs/webrtc.md` and `agents/java-agent`.
