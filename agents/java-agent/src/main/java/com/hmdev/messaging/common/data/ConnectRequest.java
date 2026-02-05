package com.hmdev.messaging.common.data;

import lombok.*;

import java.util.Map;

@EqualsAndHashCode(callSuper = true)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ConnectRequest extends SessionRequest {
    private String channelId; // optional: pre-derived channel id
    private String channelName;
    private String channelPassword;
    private String agentName;

    /**
     * Agent context map (agent metadata)
     * Can include: agentType, descriptor, ipAddress, customEventType, and other custom fields
     *
     * Special key: "customEventType" - comma-separated list of custom types this agent wants to receive.
     *   When set, agent will ONLY receive CUSTOM events matching these types.
     *   When null/empty, agent receives ALL messages (backward compatible).
     *   Examples: "chess", "chess,poker"
     *   Use case: Multiple apps sharing same channel but filtering different event types
     */
    private Map<String, String> agentContext;

    @Builder.Default
    private boolean enableWebrtcRelay = false; // optional: enable WebRTC relay for this channel

    /**
     * API key scope for channel isolation (optional)
     * - "private" (default): Channel ID includes API key, different developers get isolated channels
     * - "public": Channel ID ignores API key, same channel name+password connects all developers
     *
     * Use cases:
     * - private: Production apps need isolated channels per developer
     * - public: Testing/demos where developers want to connect to shared public channels
     */
    @Builder.Default
    private String apiKeyScope = "private"; // default: private (API key-specific channels)
}

