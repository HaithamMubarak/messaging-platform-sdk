package com.hmdev.messaging.agent.webrtc.nativ;

import com.hmdev.messaging.agent.webrtc.IceCandidateListener;
import com.hmdev.messaging.agent.webrtc.TrackEventListener;
import com.hmdev.messaging.agent.webrtc.WebRtcPeerConnectionFactory;
import com.hmdev.messaging.common.data.RtcSignalingMessage;
import dev.onvoid.webrtc.*;
import dev.onvoid.webrtc.media.*;
import dev.onvoid.webrtc.media.audio.*;
import dev.onvoid.webrtc.media.video.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.swing.*;
import java.awt.*;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * WebRTC peer connection factory implementation using webrtc-java library
 * https://github.com/devopvoid/webrtc-java
 */
public class NativeWebRtcFactory implements WebRtcPeerConnectionFactory {

    private static final Logger logger = LoggerFactory.getLogger(NativeWebRtcFactory.class);

    private final PeerConnectionFactory peerConnectionFactory;
    private final Map<String, NativeWebRtcConnection> connections = new ConcurrentHashMap<>();
    private final IceCandidateListener<RTCIceCandidate> iceCandidateListener;

    private final TrackEventListener<VideoTrack> trackEventListener;

    private final Properties webrtcConfig;

    public NativeWebRtcFactory(IceCandidateListener<RTCIceCandidate> iceCandidateListener,
                               TrackEventListener<VideoTrack> trackEventListener) {
        this.iceCandidateListener = iceCandidateListener;
        this.trackEventListener = trackEventListener;

        // Load WebRTC configuration
        this.webrtcConfig = loadWebRtcConfig();

        // Initialize WebRTC
        logger.info("Initializing WebRTC native library");

        // Create peer connection factory (initialization is automatic)
        try {
            this.peerConnectionFactory = new PeerConnectionFactory();
        } catch (Throwable t) {
            // Provide detailed diagnostics to help users resolve native load issues
            logger.error("Failed to initialize the PeerConnectionFactory (native webrtc library load failed): {}", t.getMessage(), t);
            logNativeLoadDiagnostics(t);
            throw new RuntimeException("Load library 'webrtc-java' failed. See previous log entries for diagnostics and ensure native libraries are available and java/jna library paths are set.", t);
        }

        logger.info("WebRTC native factory initialized successfully");
    }

    private void logNativeLoadDiagnostics(Throwable t) {
        logger.error("=== Native load diagnostics ===");
        logger.error("OS name: {}", System.getProperty("os.name"));
        logger.error("OS arch: {}", System.getProperty("os.arch"));
        logger.error("Java version: {}", System.getProperty("java.version"));
        logger.error("java.library.path: {}", System.getProperty("java.library.path"));
        // jna.library.path may be set via -Djna.library.path; show it if present
        logger.error("jna.library.path: {}", System.getProperty("jna.library.path"));
        // Show PATH environment variable (trimmed)
        String path = System.getenv("PATH");
        if (path != null) {
            String truncatedPath = path.length() > 1000 ? path.substring(0, 1000) + "..." : path;
            logger.error("PATH (truncated): {}", truncatedPath);
        } else {
            logger.error("PATH environment variable is not set");
        }

        logger.error("Looking for likely native library files in java.library.path directories...");
        String[] paths = System.getProperty("java.library.path").split(System.getProperty("path.separator"));
        for (String p : paths) {
            logger.error(" - {}", p);
        }

        logger.error("If you are on Windows, ensure the directory containing the webrtc-java native DLLs is added to PATH or set -Djna.library.path to that directory.");
        logger.error("If you are on Linux/Mac, ensure shared libraries (.so/.dylib) are accessible and jna.library.path or java.library.path include their directory.");
        logger.error("You can set an environment variable WEBRTC_NATIVE_DIR pointing to the directory with native libraries and run scripts will pick it up.");
        logger.error("See sdk/agents/GSTREAMER_NATIVE_SETUP.md and sdk/agents/WEBRTC_JAVA_INTEGRATION.md for instructions.");
        logger.error("=== End diagnostics ===");
    }

    /**
     * Load WebRTC configuration from properties file
     */
    private Properties loadWebRtcConfig() {
        Properties props = new Properties();
        try (InputStream input = getClass().getClassLoader().getResourceAsStream("webrtc.properties")) {
            if (input != null) {
                props.load(input);
                logger.info("Loaded WebRTC configuration from webrtc.properties");
                logger.debug("STUN servers: {}", props.getProperty("ice.stun.servers", ""));
                logger.debug("TURN servers: {}", props.getProperty("ice.turn.servers", ""));
            } else {
                logger.warn("webrtc.properties not found, using default configuration");
            }
        } catch (IOException e) {
            logger.warn("Failed to load webrtc.properties: {}", e.getMessage());
        }
        return props;
    }

    /**
     * Configure ICE servers from properties
     */
    private List<RTCIceServer> configureIceServers() {
        List<RTCIceServer> iceServers = new ArrayList<>();

        // Add STUN servers
        String stunServers = webrtcConfig.getProperty("ice.stun.servers", "stun:stun.l.google.com:19302");
        if (!stunServers.isEmpty()) {
            String[] stunUrls = stunServers.split(",");
            for (String url : stunUrls) {
                url = url.trim();
                if (!url.isEmpty()) {
                    RTCIceServer stunServer = new RTCIceServer();
                    stunServer.urls.add(url);
                    iceServers.add(stunServer);
                    logger.debug("Added STUN server: {}", url);
                }
            }
        }

        // Add TURN servers
        String turnServers = webrtcConfig.getProperty("ice.turn.servers", "");
        if (!turnServers.isEmpty()) {
            String[] turnUrls = turnServers.split(",");
            String username = webrtcConfig.getProperty("ice.turn.username", "");
            String credential = webrtcConfig.getProperty("ice.turn.credential", "");

            for (String url : turnUrls) {
                url = url.trim();
                if (!url.isEmpty()) {
                    RTCIceServer turnServer = new RTCIceServer();
                    turnServer.urls.add(url);

                    if (!username.isEmpty()) {
                        turnServer.username = username;
                    }
                    if (!credential.isEmpty()) {
                        turnServer.password = credential;
                    }

                    iceServers.add(turnServer);
                    logger.info("Added TURN server: {} (username: {})", url, username.isEmpty() ? "none" : username);
                }
            }
        }

        if (iceServers.isEmpty()) {
            // Fallback to default STUN server
            RTCIceServer defaultStun = new RTCIceServer();
            defaultStun.urls.add("stun:stun.l.google.com:19302");
            iceServers.add(defaultStun);
            logger.info("Using default STUN server: stun:stun.l.google.com:19302");
        }

        return iceServers;
    }

    @Override
    public String createAnswerForOffer(String streamId, String remoteAgent, String remoteSdp) {
        try {
            logger.debug("Creating answer for stream {} from {}", streamId, remoteAgent);

            // Create peer connection
            NativeWebRtcConnection connection = createPeerConnection(streamId, remoteAgent, false);

            // Set remote description (offer)
            RTCSessionDescription remoteDesc = new RTCSessionDescription(
                    RTCSdpType.OFFER,
                    remoteSdp
            );

            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> answerSdp = new AtomicReference<>();
            AtomicReference<Exception> error = new AtomicReference<>();

            connection.getPeerConnection().setRemoteDescription(remoteDesc, new SetSessionDescriptionObserver() {
                @Override
                public void onSuccess() {
                    logger.debug("Set remote offer for stream {}", streamId);

                    // Create answer
                    RTCAnswerOptions answerOptions = new RTCAnswerOptions();
                    connection.getPeerConnection().createAnswer(answerOptions, new CreateSessionDescriptionObserver() {
                        @Override
                        public void onSuccess(RTCSessionDescription answer) {
                            // Set local description
                            connection.getPeerConnection().setLocalDescription(answer, new SetSessionDescriptionObserver() {
                                @Override
                                public void onSuccess() {
                                    logger.info("Created and set local answer for stream {}", streamId);
                                    answerSdp.set(answer.sdp);
                                    latch.countDown();
                                }

                                @Override
                                public void onFailure(String errorMessage) {
                                    logger.error("Failed to set local answer: {}", errorMessage);
                                    error.set(new RuntimeException("Failed to set local answer: " + errorMessage));
                                    latch.countDown();
                                }
                            });
                        }

                        @Override
                        public void onFailure(String errorMessage) {
                            logger.error("Failed to create answer: {}", errorMessage);
                            error.set(new RuntimeException("Failed to create answer: " + errorMessage));
                            latch.countDown();
                        }
                    });
                }

                @Override
                public void onFailure(String errorMessage) {
                    logger.error("Failed to set remote offer: {}", errorMessage);
                    error.set(new RuntimeException("Failed to set remote offer: " + errorMessage));
                    latch.countDown();
                }
            });

            // Wait for answer creation
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new RuntimeException("Timeout waiting for answer creation");
            }

            if (error.get() != null) {
                throw error.get();
            }

            return answerSdp.get();

        } catch (Exception e) {
            logger.error("Failed to create answer for stream {}: {}", streamId, e.getMessage(), e);
            throw new RuntimeException("Failed to create WebRTC answer", e);
        }
    }

    @Override
    public String createOfferForStream(String streamId, String remoteAgent) {
        try {
            logger.debug("Creating offer for stream {} to {}", streamId, remoteAgent);

            // Create peer connection with media tracks
            NativeWebRtcConnection connection = createPeerConnection(streamId, remoteAgent, true);

            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<String> offerSdp = new AtomicReference<>();
            AtomicReference<Exception> error = new AtomicReference<>();

            // Create offer
            RTCOfferOptions offerOptions = new RTCOfferOptions();
            connection.getPeerConnection().createOffer(offerOptions, new CreateSessionDescriptionObserver() {
                @Override
                public void onSuccess(RTCSessionDescription offer) {
                    // Set local description
                    connection.getPeerConnection().setLocalDescription(offer, new SetSessionDescriptionObserver() {
                        @Override
                        public void onSuccess() {
                            logger.info("Created and set local offer for stream {}", streamId);
                            offerSdp.set(offer.sdp);
                            latch.countDown();
                        }

                        @Override
                        public void onFailure(String errorMessage) {
                            logger.error("Failed to set local offer: {}", errorMessage);
                            error.set(new RuntimeException("Failed to set local offer: " + errorMessage));
                            latch.countDown();
                        }
                    });
                }

                @Override
                public void onFailure(String errorMessage) {
                    logger.error("Failed to create offer: {}", errorMessage);
                    error.set(new RuntimeException("Failed to create offer: " + errorMessage));
                    latch.countDown();
                }
            });

            // Wait for offer creation
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new RuntimeException("Timeout waiting for offer creation");
            }

            if (error.get() != null) {
                throw error.get();
            }

            return offerSdp.get();

        } catch (Exception e) {
            logger.error("Failed to create offer for stream {}: {}", streamId, e.getMessage(), e);
            throw new RuntimeException("Failed to create WebRTC offer", e);
        }
    }

    @Override
    public void handleRemoteAnswer(String streamId, String remoteSdp) {
        try {
            logger.debug("Handling remote answer for stream {}", streamId);

            NativeWebRtcConnection connection = connections.get(streamId);
            if (connection == null) {
                throw new IllegalStateException("No connection found for stream: " + streamId);
            }

            RTCSessionDescription remoteDesc = new RTCSessionDescription(
                    RTCSdpType.ANSWER,
                    remoteSdp
            );

            CountDownLatch latch = new CountDownLatch(1);
            AtomicReference<Exception> error = new AtomicReference<>();

            connection.getPeerConnection().setRemoteDescription(remoteDesc, new SetSessionDescriptionObserver() {
                @Override
                public void onSuccess() {
                    logger.info("Set remote answer for stream {}", streamId);
                    latch.countDown();
                }

                @Override
                public void onFailure(String errorMessage) {
                    logger.error("Failed to set remote answer: {}", errorMessage);
                    error.set(new RuntimeException("Failed to set remote answer: " + errorMessage));
                    latch.countDown();
                }
            });

            // Wait for operation to complete
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new RuntimeException("Timeout waiting to set remote answer");
            }

            if (error.get() != null) {
                throw error.get();
            }

        } catch (Exception e) {
            logger.error("Failed to handle remote answer for stream {}: {}", streamId, e.getMessage(), e);
            throw new RuntimeException("Failed to set remote answer", e);
        }
    }

    @Override
    public void addIceCandidate(String streamId, RtcSignalingMessage.IceCandidate candidate) {
        try {
            logger.debug("Adding ICE candidate for stream {}", streamId);

            NativeWebRtcConnection connection = connections.get(streamId);
            if (connection == null) {
                logger.warn("No connection found for stream {}, cannot add ICE candidate", streamId);
                return;
            }

            RTCIceCandidate rtcCandidate = new RTCIceCandidate(
                    candidate.getSdpMid(),
                    Integer.parseInt(candidate.getSdpMLineIndex()),
                    candidate.getCandidate()
            );

            connection.getPeerConnection().addIceCandidate(rtcCandidate);
            logger.debug("Added ICE candidate for stream {}", streamId);

        } catch (Exception e) {
            logger.error("Failed to add ICE candidate for stream {}: {}", streamId, e.getMessage(), e);
        }
    }

    @Override
    public void closePeerConnection(String streamId) {
        try {
            logger.debug("Closing peer connection for stream {}", streamId);

            NativeWebRtcConnection connection = connections.remove(streamId);
            if (connection != null) {
                connection.close();
                logger.info("Closed peer connection for stream {}", streamId);
            }

        } catch (Exception e) {
            logger.error("Failed to close peer connection for stream {}: {}", streamId, e.getMessage(), e);
        }
    }

    /**
     * Create a new peer connection
     */
    private NativeWebRtcConnection createPeerConnection(String streamId, String remoteAgent, boolean addLocalTracks) {
        try {
            // Configure ICE servers from properties file
            List<RTCIceServer> iceServers = configureIceServers();

            RTCConfiguration config = new RTCConfiguration();
            config.iceServers = iceServers;

            // Create peer connection
            RTCPeerConnection peerConnection = peerConnectionFactory.createPeerConnection(config, new PeerConnectionObserver() {
                @Override
                public void onIceCandidate(RTCIceCandidate candidate) {
                    logger.debug("ICE candidate generated for stream {}", streamId);
                    if (iceCandidateListener != null) {
                        iceCandidateListener.onIceCandidate(streamId, candidate);
                    }
                }

                @Override
                public void onIceConnectionChange(RTCIceConnectionState state) {
                    logger.debug("ICE connection state changed to {} for stream {}", state, streamId);

                    if (state == RTCIceConnectionState.CONNECTED) {
                        logger.debug("ICE connected, attaching sink for stream {}", streamId);
                    }
                }

                @Override
                public void onConnectionChange(RTCPeerConnectionState state) {
                    logger.info("Peer connection state changed to {} for stream {}", state, streamId);
                }

                @Override
                public void onSignalingChange(RTCSignalingState state) {
                    logger.debug("Signaling state changed to {} for stream {}", state, streamId);
                }

                @Override
                public void onTrack(RTCRtpTransceiver transceiver) {
                    logger.info("Remote track received for stream {}", streamId);

                    MediaStreamTrack track = transceiver.getReceiver().getTrack();
                    String kind = track.getKind();

                    if (kind.equals(MediaStreamTrack.VIDEO_TRACK_KIND)) {

                        if (trackEventListener != null)
                        {
                            VideoTrack videoTrack = (VideoTrack) track;
                            trackEventListener.onVideoTrackReceived(streamId, videoTrack);

                        }


                    }
                }
            });

            NativeWebRtcConnection connection = new NativeWebRtcConnection(
                    streamId,
                    remoteAgent,
                    peerConnection
            );

            // Add local media tracks if needed (for sending video/audio)
            if (addLocalTracks) {
                addMediaTracks(connection);
            }

            connections.put(streamId, connection);
            logger.debug("Created peer connection for stream {}", streamId);

            return connection;

        } catch (Exception e) {
            logger.error("Failed to create peer connection: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to create peer connection", e);
        }
    }

    /**
     * Add video and audio tracks to the peer connection
     */
    private void addMediaTracks(NativeWebRtcConnection connection) {
        try {
            RTCPeerConnection pc = connection.getPeerConnection();

            // Get video devices
            List<VideoDevice> videoDevices = MediaDevices.getVideoCaptureDevices();
            if (!videoDevices.isEmpty()) {
                // Use first available camera
                VideoDevice device = videoDevices.get(0);
                logger.info("Using video device: {}", device.getName());

                VideoDeviceSource videoSource = new VideoDeviceSource();
                videoSource.setVideoCaptureDevice(device);

                VideoTrack videoTrack = peerConnectionFactory.createVideoTrack("video-track", videoSource);

                pc.addTrack(videoTrack, List.of("stream"));
                connection.setVideoTrack(videoTrack);

                logger.debug("Added video track to peer connection");
            } else {
                logger.warn("No video capture devices found");
            }

            // Get audio devices
            List<AudioDevice> audioDevices = MediaDevices.getAudioCaptureDevices();
            if (!audioDevices.isEmpty()) {
                // Use first available microphone
                AudioDevice device = audioDevices.get(0);
                logger.info("Using audio device: {}", device.getName());

                AudioTrackSource audioTrackSource = peerConnectionFactory.createAudioSource(new AudioOptions());
                AudioTrack audioTrack = peerConnectionFactory.createAudioTrack("audio-track", audioTrackSource);

                pc.addTrack(audioTrack, List.of("stream"));
                connection.setAudioTrack(audioTrack);

                logger.debug("Added audio track to peer connection");
            } else {
                logger.warn("No audio capture devices found");
            }

        } catch (Exception e) {
            logger.error("Failed to add media tracks: {}", e.getMessage(), e);
            // Don't throw - allow connection to proceed without media
        }
    }

    /**
     * Clean up resources
     */
    public void dispose() {
        logger.info("Disposing WebRTC native factory");

        // Close all connections
        for (NativeWebRtcConnection connection : connections.values()) {
            connection.close();
        }
        connections.clear();

        // Dispose factory
        if (peerConnectionFactory != null) {
            peerConnectionFactory.dispose();
        }

        logger.info("WebRTC native factory disposed");
    }
}
