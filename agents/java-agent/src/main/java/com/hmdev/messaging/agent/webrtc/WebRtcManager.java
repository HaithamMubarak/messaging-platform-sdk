package com.hmdev.messaging.agent.webrtc;

import com.hmdev.messaging.agent.core.AgentConnection;
import com.hmdev.messaging.agent.core.WebRtcStreamEventHandler;
import com.hmdev.messaging.agent.webrtc.nativ.NativeWebRtcFactory;
import com.hmdev.messaging.common.data.EventMessage;
import com.hmdev.messaging.common.data.RtcSignalingMessage;
import lombok.Setter;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Manages WebRTC peer connections and video stream signaling.
 * Handles SDP offer/answer negotiation and ICE candidate exchange.
 * <p>
 * NOTE: This is a SIGNALING-ONLY implementation. To enable actual peer-to-peer
 * video streaming, you need to integrate a WebRTC library. See build.gradle for options.
 * <p>
 * The signaling infrastructure is complete and works with the messaging channel.
 * Applications should override the handler methods to integrate with their chosen
 * WebRTC implementation (native library, media server, etc).
 */
public class WebRtcManager implements ISignalingMessageHandler {

    private static final Logger logger = LoggerFactory.getLogger(WebRtcManager.class);

    private final Map<String, VideoStreamSession> streamSessions = new ConcurrentHashMap<>();
    private final AgentConnection agentConnection;
    private final TrackEventListener trackEventListener;

    private WebRtcPeerConnectionFactory peerConnectionFactory;

    @Setter
    private WebRtcStreamEventHandler streamEventHandler;

    /**
     * Initialize WebRTC stream manager
     */
    public WebRtcManager(AgentConnection agentConnection, TrackEventListener trackEventListener) {
        this.agentConnection = agentConnection;
        this.trackEventListener = trackEventListener;
    }

    /**
     * Initialize with native WebRTC support (webrtc-java library)
     * This enables full peer-to-peer video streaming capabilities
     */
    public void initializeNativeWebRtc() {
        // Allow runtime override of native library directory via env var
        String nativeDir = System.getenv("WEBRTC_NATIVE_DIR");
        if (nativeDir != null && !nativeDir.isEmpty()) {
            try {
                String existing = System.getProperty("jna.library.path");
                String sep = System.getProperty("path.separator");
                if (existing == null || existing.isEmpty()) {
                    System.setProperty("jna.library.path", nativeDir);
                } else if (!existing.contains(nativeDir)) {
                    System.setProperty("jna.library.path", existing + sep + nativeDir);
                }
                logger.info("Configured jna.library.path to include: {}", nativeDir);
            } catch (Exception e) {
                logger.warn("Failed to set jna.library.path from WEBRTC_NATIVE_DIR: {}", e.getMessage());
            }
        } else {
            logger.info("WEBRTC_NATIVE_DIR not set; using existing java.library.path / jna defaults");
        }

        logger.info("Initializing native WebRTC support using webrtc-java library");

        this.peerConnectionFactory = new NativeWebRtcFactory((streamId, candidate) -> {
            // Send ICE candidate to remote peer via signaling
            sendIceCandidate(streamId, candidate.sdp, String.valueOf(candidate.sdpMLineIndex), candidate.sdpMid);
        }, trackEventListener);

        logger.info("Native WebRTC initialized successfully");
    }

    /**
     * Handle incoming WebRTC signaling messages
     *
     * @param event the VIDEO_STREAM_SIGNALING event
     */
    @Override
    public void handleSignalingMessage(EventMessage event) {
        try {
            JSONObject msgJson = new JSONObject(event.getContent());
            String type = msgJson.optString("type");
            String streamId = msgJson.optString("streamSessionId");
            String remoteAgent = event.getFrom();

            logger.debug("Received WebRTC signaling message type {} for stream {} from {}", type, streamId, remoteAgent);

            switch (type) {
                case "offer":
                    String offerSdp = msgJson.optString("sdp");
                    this.handleSdpOffer(remoteAgent, offerSdp, streamId);
                    // Invoke user callback
                    if (streamEventHandler != null) {
                        streamEventHandler.onStreamOfferReceived(streamId, remoteAgent, offerSdp);
                    }
                    break;

                case "answer":
                    String answerSdp = msgJson.optString("sdp");
                    this.handleSdpAnswer(remoteAgent, answerSdp, streamId);
                    // Invoke user callback
                    if (streamEventHandler != null) {
                        streamEventHandler.onStreamAnswerReceived(streamId, remoteAgent, answerSdp);
                    }
                    break;

                case "ice-candidate":
                    JSONObject candidateJson = msgJson.optJSONObject("candidate");
                    if (candidateJson != null) {
                        RtcSignalingMessage.IceCandidate candidate = new RtcSignalingMessage.IceCandidate(
                                candidateJson.optString("candidate"),
                                candidateJson.optString("sdpMLineIndex"),
                                candidateJson.optString("sdpMid")
                        );
                        this.handleIceCandidate(remoteAgent, candidate, streamId);
                        // Invoke user callback
                        if (streamEventHandler != null) {
                            streamEventHandler.onIceCandidateReceived(streamId, remoteAgent, candidate);
                        }
                    }
                    break;

                default:
                    logger.warn("Unknown WebRTC signaling message type: {}", type);
            }
        } catch (Exception ex) {
            logger.error("Error handling WebRTC signaling message: {}", ex.getMessage());
        }
    }

    /**
     * Handle an incoming SDP offer from a remote peer
     *
     * @param remoteAgent source agent
     * @param sdp         the SDP offer
     * @param streamId    stream session ID
     */
    public void handleSdpOffer(String remoteAgent, String sdp, String streamId) {
        logger.debug("Received SDP offer from {} for stream {}", remoteAgent, streamId);

        VideoStreamSession session = streamSessions.get(streamId);
        if (session == null) {
            session = new VideoStreamSession(streamId, remoteAgent, "answer");
            streamSessions.put(streamId, session);
        }

        session.setRemoteSdp(sdp);
        session.setState("offer-received");

        try {
            String answerSdp = peerConnectionFactory.createAnswerForOffer(streamId, remoteAgent, sdp);
            session.setLocalSdp(answerSdp);
            session.setState("answer-created");

            RtcSignalingMessage msg = RtcSignalingMessage.createAnswer(answerSdp, streamId);
            sendSignalingMessage(remoteAgent, msg);

            logger.info("Created and sent SDP answer for stream {}", streamId);

        } catch (Exception e) {
            logger.error("Error handling SDP offer for stream {}: {}", streamId, e.getMessage(), e);
            if (streamEventHandler != null) {
                streamEventHandler.onPeerConnectionError(streamId, e.getMessage());
            }
        }
    }

    /**
     * Handle an incoming SDP answer from a remote peer
     *
     * @param remoteAgent source agent
     * @param sdp         the SDP answer
     * @param streamId    stream session ID
     */
    public void handleSdpAnswer(String remoteAgent, String sdp, String streamId) {
        logger.debug("Received SDP answer from {} for stream {}", remoteAgent, streamId);

        VideoStreamSession session = streamSessions.get(streamId);
        if (session != null) {
            session.setRemoteSdp(sdp);
            session.setState("answer-received");

            try {
                peerConnectionFactory.handleRemoteAnswer(streamId, sdp);
                session.setState("connected");

                if (streamEventHandler != null) {
                    streamEventHandler.onRemoteStreamReady(streamId, remoteAgent);
                }
                logger.info("Set remote answer for stream {}, connection established", streamId);
            } catch (Exception e) {
                logger.error("Failed to set remote answer: {}", e.getMessage());
                if (streamEventHandler != null) {
                    streamEventHandler.onPeerConnectionError(streamId, e.getMessage());
                }
            }
        }
    }

    /**
     * Handle an incoming ICE candidate from a remote peer
     *
     * @param remoteAgent source agent
     * @param candidate   ICE candidate object
     * @param streamId    stream session ID
     */
    public void handleIceCandidate(String remoteAgent, RtcSignalingMessage.IceCandidate candidate, String streamId) {
        logger.debug("Received ICE candidate from {} for stream {}", remoteAgent, streamId);

        VideoStreamSession session = streamSessions.get(streamId);
        if (session != null) {
            session.addRemoteIceCandidate(candidate);
        }

        try {
            peerConnectionFactory.addIceCandidate(streamId, candidate);
            logger.debug("Added ICE candidate to peer connection for stream {}", streamId);
        } catch (Exception e) {
            logger.error("Failed to add ICE candidate: {}", e.getMessage());
        }
    }

    /**
     * Send an ICE candidate to the remote peer
     *
     * @param streamId      stream session ID
     * @param candidate     ICE candidate
     * @param sdpMLineIndex SDP mline index
     * @param sdpMid        SDP mid
     */
    public void sendIceCandidate(String streamId, String candidate, String sdpMLineIndex, String sdpMid) {
        VideoStreamSession session = streamSessions.get(streamId);
        if (session != null) {
            session.addLocalIceCandidate(new RtcSignalingMessage.IceCandidate(candidate, sdpMLineIndex, sdpMid));

            RtcSignalingMessage msg = RtcSignalingMessage.createIceCandidate(candidate, sdpMLineIndex, sdpMid, streamId);
            sendSignalingMessage(session.getRemoteAgent(), msg);

            logger.debug("Sent ICE candidate for stream {}", streamId);
        }
    }

    /**
     * Close a video stream session
     *
     * @param streamId stream session ID
     */
    public void closeStream(String streamId) {
        VideoStreamSession session = streamSessions.remove(streamId);
        if (session != null) {
            session.setState("closed");
            logger.debug("Closed video stream: {}", streamId);
        }

        // Close the peer connection if factory is configured
        if (peerConnectionFactory != null) {
            try {
                peerConnectionFactory.closePeerConnection(streamId);
                logger.debug("Closed peer connection for stream {}", streamId);
            } catch (Exception e) {
                logger.error("Error closing peer connection: {}", e.getMessage());
            }
        }
    }

    /**
     * Get active stream sessions
     *
     * @return collection of active video stream sessions
     */
    public Collection<VideoStreamSession> getActiveSessions() {
        return streamSessions.values();
    }

    /**
     * Get a specific stream session
     *
     * @param streamId stream session ID
     * @return the session or null
     */
    public VideoStreamSession getSession(String streamId) {
        return streamSessions.get(streamId);
    }


    private void sendSignalingMessage(String remoteAgent, RtcSignalingMessage signalingMsg) {
        try {
            String msgJson = new JSONObject()
                    .put("type", signalingMsg.getType())
                    .put("sdp", signalingMsg.getSdp())
                    .put("candidate", signalingMsg.getCandidate() != null ?
                            new JSONObject()
                                    .put("candidate", signalingMsg.getCandidate().getCandidate())
                                    .put("sdpMLineIndex", signalingMsg.getCandidate().getSdpMLineIndex())
                                    .put("sdpMid", signalingMsg.getCandidate().getSdpMid())
                            : null)
                    .put("streamSessionId", signalingMsg.getStreamSessionId())
                    .toString();

            agentConnection.sendMessage(EventMessage.EventType.WEBRTC_SIGNALING, msgJson, remoteAgent, false);
            logger.debug("Sent WebRTC signaling message to {} for stream {}", remoteAgent, signalingMsg.getStreamSessionId());
        } catch (Exception ex) {
            logger.error("Failed to send WebRTC signaling message: {}", ex.getMessage());
        }
    }

}

