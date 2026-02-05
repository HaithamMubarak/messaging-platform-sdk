package com.hmdev.messaging.agent.webrtc;

public interface TrackEventListener<V> {
    void onVideoTrackReceived(String streamId, V track);
}
