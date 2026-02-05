package com.hmdev.messaging.common.data;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Relay Connect Request model
 * Used when creating a relay agent session
 * Similar structure to ConnectResponse but for system relay agents
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class RelayConnectRequest {

    private String sessionId;

    private String channelId;

    private String relayAgentName;

    private long timestamp;

    @JsonProperty("metadata")
    private ChannelStateDto metadata;
}

