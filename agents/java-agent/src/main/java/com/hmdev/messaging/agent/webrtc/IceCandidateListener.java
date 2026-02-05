package com.hmdev.messaging.agent.webrtc;

public interface IceCandidateListener<C> {
    void onIceCandidate(String streamId, C candidate);
}
