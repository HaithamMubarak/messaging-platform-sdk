package com.hmdev.messaging.agent.webrtc;

import com.hmdev.messaging.common.data.RtcSignalingMessage;

/**
 * Factory interface for creating WebRTC peer connections
 * Implement this to integrate with your chosen WebRTC library
 */
public interface WebRtcPeerConnectionFactory {
    /**
     * Create a peer connection for receiving a stream (answer mode)
     *
     * @param streamId    stream identifier
     * @param remoteAgent remote agent name
     * @param remoteSdp   the SDP offer from remote peer
     * @return SDP answer
     */
    String createAnswerForOffer(String streamId, String remoteAgent, String remoteSdp);

    /**
     * Create a peer connection for sending a stream (offer mode)
     *
     * @param streamId    stream identifier
     * @param remoteAgent remote agent name
     * @return SDP offer
     */
    String createOfferForStream(String streamId, String remoteAgent);

    /**
     * Handle remote SDP answer
     *
     * @param streamId  stream identifier
     * @param remoteSdp the SDP answer
     */
    void handleRemoteAnswer(String streamId, String remoteSdp);

    /**
     * Add ICE candidate to peer connection
     *
     * @param streamId  stream identifier
     * @param candidate ICE candidate
     */
    void addIceCandidate(String streamId, RtcSignalingMessage.IceCandidate candidate);

    /**
     * Close a peer connection
     *
     * @param streamId stream identifier
     */
    void closePeerConnection(String streamId);
}
