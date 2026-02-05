package com.hmdev.messaging.common.data;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Channel state DTO containing runtime configuration and offset tracking.
 * Represents the current operational state of a channel.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ChannelStateDto {
    private String topicName;
    private String channelId;
    private String channelName;
    private String channelPassword;

    private Long globalOffset;
    private Long localOffset;

    // Original offsets at channel creation time (for message recovery)
    private Long originalGlobalOffset;
    private Long originalLocalOffset;

    private boolean publicChannel = false;
    private List<String> allowedAgentsNames = new ArrayList<>();

    private Long ageMs = 86400000L;

    // Backwards-compatible constructor
    public ChannelStateDto(String topicName, String channelId) {
        this.topicName = topicName;
        this.channelId = channelId;
        this.channelName = null;
        this.channelPassword = null;
        this.globalOffset = null;
        this.localOffset = null;
        this.ageMs = 86400000L;
    }
}

