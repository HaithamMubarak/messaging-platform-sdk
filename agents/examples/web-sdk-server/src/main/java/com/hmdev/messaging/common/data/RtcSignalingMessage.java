package com.hmdev.messaging.common.data;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a WebRTC signaling message containing either an SDP offer/answer or ICE candidate.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class RtcSignalingMessage {

    // Signaling message type: "offer", "answer", or "ice-candidate"
    private String type;

    // For SDP messages: the session description
    private String sdp;

    // For ICE candidates: candidate details
    private IceCandidate candidate;

    // Optional: stream session ID to track which video stream this pertains to
    private String streamSessionId;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class IceCandidate {
        private String candidate;
        private String sdpMLineIndex;
        private String sdpMid;
    }

    /**
     * Create an SDP offer message
     */
    public static RtcSignalingMessage createOffer(String sdp, String streamSessionId) {
        RtcSignalingMessage msg = new RtcSignalingMessage();
        msg.setType("offer");
        msg.setSdp(sdp);
        msg.setStreamSessionId(streamSessionId);
        return msg;
    }

    /**
     * Create an SDP answer message
     */
    public static RtcSignalingMessage createAnswer(String sdp, String streamSessionId) {
        RtcSignalingMessage msg = new RtcSignalingMessage();
        msg.setType("answer");
        msg.setSdp(sdp);
        msg.setStreamSessionId(streamSessionId);
        return msg;
    }

    /**
     * Create an ICE candidate message
     */
    public static RtcSignalingMessage createIceCandidate(String candidate, String sdpMLineIndex,
                                                          String sdpMid, String streamSessionId) {
        RtcSignalingMessage msg = new RtcSignalingMessage();
        msg.setType("ice-candidate");
        msg.setCandidate(new IceCandidate(candidate, sdpMLineIndex, sdpMid));
        msg.setStreamSessionId(streamSessionId);
        return msg;
    }
}

