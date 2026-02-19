package com.hmdev.sdk.local.dto.auth;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Response DTO for security status endpoint.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SecurityStatusResponse {

    /**
     * Whether security is enabled.
     */
    private Boolean securityEnabled;

    /**
     * Number of currently active tokens.
     */
    private Integer activeTokens;

    /**
     * API version.
     */
    private String version;

    /**
     * Name of the token header to use.
     */
    private String tokenHeader;

    /**
     * Default token expiry in hours.
     */
    private Integer defaultTokenExpiryHours;

    /**
     * Status message.
     */
    private String message;
}

