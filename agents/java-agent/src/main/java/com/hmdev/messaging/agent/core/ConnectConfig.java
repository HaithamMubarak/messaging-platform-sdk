package com.hmdev.messaging.agent.core;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

/**
 * Configuration object for agent connection parameters.
 * Provides a clean, object-based API for connecting to channels.
 */
@Getter
@Setter
@Builder
public class ConnectConfig {

    /**
     * Channel name (required unless using channelId)
     */
    private String channelName;

    /**
     * Channel password (required unless using channelId)
     */
    private String channelPassword;

    /**
     * Agent name - identifier for this agent in the channel (required)
     */
    private String agentName;

    /**
     * Pre-existing session ID for reconnection (optional)
     */
    private String sessionId;

    /**
     * Pre-computed channel ID (optional, alternative to channelName/password)
     */
    private String channelId;

    /**
     * Enable WebRTC relay creation when connecting (default: false)
     */
    @Builder.Default
    private boolean enableWebrtcRelay = false;

    /**
     * API key scope for channel isolation:
     * - "private" (default): Each API key gets isolated channels
     * - "public": Same channel name/password shared across API keys (useful for testing)
     */
    @Builder.Default
    private String apiKeyScope = "private";

    /**
     * Check and restore last session if available (default: true)
     */
    @Builder.Default
    private boolean checkLastSession = true;

    /**
     * Create a basic config with required fields
     */
    public static ConnectConfig of(String channelName, String channelPassword, String agentName) {
        return ConnectConfig.builder()
                .channelName(channelName)
                .channelPassword(channelPassword)
                .agentName(agentName)
                .build();
    }

    /**
     * Create a config for channel ID based connection
     */
    public static ConnectConfig withChannelId(String channelId, String agentName) {
        return ConnectConfig.builder()
                .channelId(channelId)
                .agentName(agentName)
                .build();
    }
}

