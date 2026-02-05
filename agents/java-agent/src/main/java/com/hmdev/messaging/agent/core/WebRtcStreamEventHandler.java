package com.hmdev.messaging.agent.core;

import com.hmdev.messaging.common.data.RtcSignalingMessage;

/**
 * Handler interface for WebRTC video stream events.
 * Implement this interface to receive callbacks when video streams are established or fail.
 */
public interface WebRtcStreamEventHandler {

    /**
     * Called when a remote video stream is ready for display
     *
     * @param streamId the video stream session ID
     * @param remoteAgent the remote agent sending the stream
     */
    void onStreamReady(String streamId, String remoteAgent);

    /**
     * Called when a stream error occurs
     *
     * @param streamId the video stream session ID
     * @param errorMessage the error message
     */
    void onStreamError(String streamId, String errorMessage);

    /**
     * Called when an SDP offer is received from a remote agent
     *
     * @param streamId the video stream session ID
     * @param remoteAgent the agent sending the offer
     * @param sdp the SDP offer
     */
    void onStreamOfferReceived(String streamId, String remoteAgent, String sdp);

    /**
     * Called when an SDP answer is received from a remote agent
     *
     * @param streamId the video stream session ID
     * @param remoteAgent the agent sending the answer
     * @param sdp the SDP answer
     */
    void onStreamAnswerReceived(String streamId, String remoteAgent, String sdp);

    /**
     * Called when an ICE candidate is received from a remote agent
     *
     * @param streamId the video stream session ID
     * @param remoteAgent the agent sending the candidate
     * @param candidate the ICE candidate
     */
    void onIceCandidateReceived(String streamId, String remoteAgent, RtcSignalingMessage.IceCandidate candidate);

    /**
     * Called when a remote video stream is ready
     *
     * @param streamId    stream session ID
     * @param remoteAgent source agent
     */
    void onRemoteStreamReady(String streamId, String remoteAgent);

    /**
     * Called when a peer connection fails
     *
     * @param streamId stream session ID
     * @param error    error message
     */
    void onPeerConnectionError(String streamId, String error);
}

