package com.hmdev.messaging.agent.webrtc.nativ;

import dev.onvoid.webrtc.RTCPeerConnection;
import dev.onvoid.webrtc.media.audio.AudioTrack;
import dev.onvoid.webrtc.media.video.VideoTrack;
import lombok.Getter;
import lombok.Setter;

/**
 * Wrapper for a WebRTC peer connection with associated media tracks
 */
@Getter
public class NativeWebRtcConnection {

    private final String streamId;
    private final String remoteAgent;
    private final RTCPeerConnection peerConnection;

    @Setter
    private VideoTrack videoTrack;

    @Setter
    private AudioTrack audioTrack;

    public NativeWebRtcConnection(String streamId, String remoteAgent, RTCPeerConnection peerConnection) {
        this.streamId = streamId;
        this.remoteAgent = remoteAgent;
        this.peerConnection = peerConnection;
    }

    /**
     * Close the connection and dispose resources
     */
    public void close() {
        if (videoTrack != null) {
            videoTrack.dispose();
        }
        if (audioTrack != null) {
            audioTrack.dispose();
        }
        if (peerConnection != null) {
            peerConnection.close();
        }
    }
}

