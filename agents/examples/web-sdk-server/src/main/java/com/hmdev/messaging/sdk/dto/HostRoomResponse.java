package com.hmdev.messaging.sdk.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A room opened for its host. channelName and channelPassword are what the
 * host connects with and puts in its invite; agentKey goes with the host's
 * connect and to nobody else, since anyone holding it can connect as the host.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class HostRoomResponse {
    /** The bare channel name (the page adds `.<app>` on the wire). */
    private String channelName;
    private String channelPassword;
    /** The wire room's id on the messaging service. */
    private String channelId;
    /** The agent name every member is told is the host. */
    private String hostAgent;
    /** The host's key: its connect needs it, because the service reserves the host's name. */
    private String agentKey;
    /** How long the key admits the host's connects, in seconds. */
    private Long agentKeyTtlSeconds;
}
