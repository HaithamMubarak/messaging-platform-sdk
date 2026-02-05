package com.hmdev.messaging.agent.example;

import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.ConnectConfig;
import com.hmdev.messaging.agent.core.WebRtcStreamEventHandler;
import com.hmdev.messaging.agent.webrtc.TrackEventListener;
import com.hmdev.messaging.agent.webrtc.WebRtcManager;
import com.hmdev.messaging.common.data.RtcSignalingMessage;
import dev.onvoid.webrtc.media.video.VideoTrack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.swing.*;
import java.awt.*;


/**
 * Complete Example: Receive WebRTC Video Stream from Web Agent
 * <p>
 * This example demonstrates how to:
 * 1. Create a Java agent that receives WebRTC video
 * 2. Handle WebRTC signaling (SDP, ICE candidates)
 * 3. Process incoming video streams
 * 4. Display or record the video
 * <p>
 * Prerequisites:
 * - Messaging service running
 * - webrtc-java native library installed
 * - Web agent sending video stream
 * <p>
 * Usage:
 * gradlew run -PmainClass=com.hmdev.messaging.agent.examples.WebRtcReceiverComplete
 */
public class ReceiveWebRtcVideoExample {

    private static final Logger logger = LoggerFactory.getLogger(ReceiveWebRtcVideoExample.class);

    // Configuration - modify these for your setup
    private static final String API_URL = "https://hmdevonline.com/messaging-platform/api/v1/messaging-service";
    private static final String WEBRTC_EXAMPLE_URL = "https://hmdevonline.com/messaging-platform/web-agent/examples/webrtc.html";

    // IMPORTANT: Set your API key via environment variable or replace this placeholder
    // Get your API key from: https://hmdevonline.com/messaging-platform/dashboard
    private static final String API_KEY = System.getenv("MESSAGING_API_KEY") != null
            ? System.getenv("MESSAGING_API_KEY")
            : "your-api-key-here";
    private static final String CHANNEL_NAME = "demo-webrtc";
    private static final String CHANNEL_PASSWORD = "demo123";
    private static final String AGENT_NAME = "java-video-receiver";

    private static final BasicVideoRenderer remoteVideoSink = new BasicVideoRenderer();

    public static void main(String[] args) {
        logger.info("==============================================");
        logger.info("  WebRTC Video Receiver - Complete Example");
        logger.info("==============================================");
        logger.info("");

        try {
            // Step 1: Create agent connection
            logger.info("Step 1: Creating agent connection...");
            AgentConnection connection = new AgentConnection(API_URL, API_KEY);

            WebRtcManager webRtcManager = new WebRtcManager(connection, new TrackEventListener<VideoTrack>() {
                @Override
                public void onVideoTrackReceived(String streamId, VideoTrack videoTrack) {
                    videoTrack.addSink(remoteVideoSink);

                    SwingUtilities.invokeLater(() -> {
                        JFrame frame = new JFrame("Remote Video");
                        frame.setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
                        frame.add(remoteVideoSink);
                        frame.pack();
                        frame.setVisible(true);
                    });
                }
            });
            connection.setWebRtcHandler(webRtcManager);

            logger.info("✅ Agent connection created");

            // Step 2: Initialize Native WebRTC factory
            logger.info("");
            logger.info("Step 2: Initializing WebRTC factory...");

            // Initialize native WebRTC using webrtc-java library
            try {
                webRtcManager.initializeNativeWebRtc();
                logger.info("✅ WebRTC factory initialized and registered");
                logger.info("   Mode: Full WebRTC with native library (webrtc-java)");
            } catch (Exception e) {
                logger.error("Failed to initialize WebRTC factory: {}", e.getMessage(), e);
                logger.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                logger.warn("⚠️  WebRTC native library initialization failed");
                logger.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                logger.warn("You may need to install platform-specific WebRTC natives");
                logger.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                throw e;
            }

            // Step 3: Set up WebRTC event handlers
            logger.info("");
            logger.info("Step 3: Setting up WebRTC event handlers...");
            webRtcManager.setStreamEventHandler(new WebRtcStreamEventHandler() {

                @Override
                public void onStreamReady(String streamId, String remoteAgent) {
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    logger.info("✅ VIDEO STREAM READY!");
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    logger.info("Stream ID: {}", streamId);
                    logger.info("Remote Agent: {}", remoteAgent);
                    logger.info("Status: Connected and receiving video");
                    logger.info("");
                    logger.info("👀 Video should now be displayed");
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                }

                @Override
                public void onStreamError(String streamId, String errorMessage) {
                    logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    logger.error("❌ STREAM ERROR");
                    logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    logger.error("Stream ID: {}", streamId);
                    logger.error("Error: {}", errorMessage);
                    logger.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                }

                @Override
                public void onStreamOfferReceived(String streamId, String remoteAgent, String sdp) {
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    logger.info("📥 RECEIVED SDP OFFER");
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    logger.info("From: {}", remoteAgent);
                    logger.info("Stream ID: {}", streamId);
                    logger.info("SDP Length: {} bytes", sdp.length());
                    logger.info("");
                    logger.info("SDP Offer Details:");
                    printSdpSummary(sdp);
                    logger.info("");
                    logger.info("⏳ Creating SDP answer...");
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                }

                @Override
                public void onStreamAnswerReceived(String streamId, String remoteAgent, String sdp) {
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    logger.info("📥 RECEIVED SDP ANSWER");
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    logger.info("From: {}", remoteAgent);
                    logger.info("Stream ID: {}", streamId);
                    logger.info("SDP Length: {} bytes", sdp.length());
                    logger.info("");
                    logger.info("SDP Answer Details:");
                    printSdpSummary(sdp);
                    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                }

                @Override
                public void onIceCandidateReceived(String streamId, String remoteAgent,
                                                   RtcSignalingMessage.IceCandidate candidate) {
                    logger.debug("📥 ICE Candidate from {}", remoteAgent);
                    logger.debug("   Candidate: {}", candidate.getCandidate());
                    logger.debug("   MLine: {}, Mid: {}",
                            candidate.getSdpMLineIndex(), candidate.getSdpMid());
                }

                @Override
                public void onRemoteStreamReady(String streamId, String remoteAgent) {
                    logger.info("✅ Remote stream is ready: {} from {}", streamId, remoteAgent);
                }

                @Override
                public void onPeerConnectionError(String streamId, String error) {
                    logger.info("❌ Peer connection error on stream {}: {}", streamId, error);
                }
            });
            logger.info("✅ Event handlers configured");

            // Step 4: Connect to messaging channel
            logger.info("");
            logger.info("Step 4: Connecting to messaging channel...");
            logger.info("Channel: {}", CHANNEL_NAME);
            logger.info("Agent Name: {}", AGENT_NAME);

            connection.connect(ConnectConfig.builder()
                    .channelName(CHANNEL_NAME)
                    .channelPassword(CHANNEL_PASSWORD)
                    .agentName(AGENT_NAME)
                    .build());
            logger.info("✅ Connected to channel");

            // Step 5: Wait for video streams
            logger.info("");
            logger.info("==============================================");
            logger.info("  ✅ READY TO RECEIVE VIDEO STREAMS");
            logger.info("==============================================");
            logger.info("");
            logger.info("📺 Waiting for web agent to send video stream...");
            logger.info("");
            logger.info("Instructions for Web Agent:");
            logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            logger.info("1. Open web-agent in browser:");
            logger.info("   {}" , WEBRTC_EXAMPLE_URL);
            logger.info("");
            logger.info("2. Connect to channel:");
            logger.info("   Channel: {}", CHANNEL_NAME);
            logger.info("   Password: {}", CHANNEL_PASSWORD);
            logger.info("");
            logger.info("3. Start video stream:");
            logger.info("   Target Agent: {}", AGENT_NAME);
            logger.info("   Click 'Start Video Stream' button");
            logger.info("");
            logger.info("💡 Tip: Enable debug logging with -Dorg.slf4j.simpleLogger.defaultLogLevel=debug");
            logger.info("");
            logger.info("Press Ctrl+C to stop");
            logger.info("==============================================");
            logger.info("");

            connection.receiveAsync(messageEvents ->
                    logger.info(messageEvents.toString()), connection.getInitialReceiveConfig());

            // Keep application running
            Thread.currentThread().join();

        } catch (InterruptedException e) {
            logger.info("Application interrupted");
        } catch (Exception e) {
            logger.error("Error in WebRTC receiver: {}", e.getMessage(), e);
            System.exit(1);
        }
    }

    /**
     * Print a summary of SDP content
     */
    private static void printSdpSummary(String sdp) {
        String[] lines = sdp.split("\r\n");

        logger.info("  Video Codecs:");
        for (String line : lines) {
            if (line.startsWith("a=rtpmap:")) {
                String codec = line.substring(9); // Remove "a=rtpmap:"
                logger.info("    - {}", codec);
            }
        }

        logger.info("  Media Streams:");
        for (String line : lines) {
            if (line.startsWith("m=")) {
                String media = line.substring(2); // Remove "m="
                logger.info("    - {}", media);
            }
        }

        logger.info("  ICE Info:");
        for (String line : lines) {
            if (line.startsWith("a=ice-ufrag:")) {
                logger.info("    - ufrag: {}", line.substring(12));
            }
            if (line.startsWith("a=fingerprint:")) {
                logger.info("    - fingerprint: {}", line.substring(14, Math.min(40, line.length())) + "...");
            }
        }
    }
}

