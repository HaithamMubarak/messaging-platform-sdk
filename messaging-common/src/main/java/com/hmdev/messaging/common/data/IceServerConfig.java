package com.hmdev.messaging.common.data;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * ICE server configuration for WebRTC NAT traversal.
 * Represents a STUN or TURN server with optional authentication.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class IceServerConfig {

    /**
     * STUN/TURN server URLs.
     * Can be a single URL or multiple URLs for the same server.
     * Examples:
     * - "stun:stun.example.com:3478"
     * - ["stun:example.com:3478", "turn:example.com:3478"]
     */
    private List<String> urls;

    /**
     * Username for TURN server authentication (optional, only needed for TURN)
     */
    private String username;

    /**
     * Password/credential for TURN server authentication (optional, only needed for TURN)
     */
    private String credential;
}
