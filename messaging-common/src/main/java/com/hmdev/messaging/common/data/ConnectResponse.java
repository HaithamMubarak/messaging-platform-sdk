package com.hmdev.messaging.common.data;

import lombok.*;

import java.util.List;


@EqualsAndHashCode(callSuper = true)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ConnectResponse extends SessionRequest {
    private String channelId;
    private long date;

    @Builder.Default
    private ChannelStateDto state = new ChannelStateDto();

    /**
     * ICE servers configuration for WebRTC (STUN/TURN)
     * Provided only after successful channel connection
     */
    private List<IceServerConfig> iceServers;
}
