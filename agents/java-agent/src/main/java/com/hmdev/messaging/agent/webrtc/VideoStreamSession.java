package com.hmdev.messaging.agent.webrtc;

import com.hmdev.messaging.common.data.RtcSignalingMessage;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * Represents a WebRTC video stream session
 */
@Getter
public class VideoStreamSession {
    // Getters and setters
    private final String streamId;
    private final String remoteAgent;
    private final String roleType; // "offer" or "answer"
    @Setter
    private String state; // "pending", "offer-sent", "offer-received", "answer-sent", "answer-received", "connected", "failed", "closed"
    @Setter
    private String localSdp;
    @Setter
    private String remoteSdp;
    private final List<RtcSignalingMessage.IceCandidate> localCandidates = new ArrayList<>();
    private final List<RtcSignalingMessage.IceCandidate> remoteCandidates = new ArrayList<>();
    private final long createdAt;

    public VideoStreamSession(String streamId, String remoteAgent, String roleType) {
        this.streamId = streamId;
        this.remoteAgent = remoteAgent;
        this.roleType = roleType;
        this.state = "pending";
        this.createdAt = System.currentTimeMillis();
    }

    public void addLocalIceCandidate(RtcSignalingMessage.IceCandidate candidate) {
        localCandidates.add(candidate);
    }

    public void addRemoteIceCandidate(RtcSignalingMessage.IceCandidate candidate) {
        remoteCandidates.add(candidate);
    }

    @Override
    public String toString() {
        return "VideoStreamSession{" +
                "streamId='" + streamId + '\'' +
                ", remoteAgent='" + remoteAgent + '\'' +
                ", state='" + state + '\'' +
                ", roleType='" + roleType + '\'' +
                '}';
    }
}
