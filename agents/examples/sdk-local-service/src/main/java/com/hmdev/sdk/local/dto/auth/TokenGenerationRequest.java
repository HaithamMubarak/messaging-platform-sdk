package com.hmdev.sdk.local.dto.auth;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for token generation.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TokenGenerationRequest {

    /**
     * Origin URL that will be allowed to use this token.
     * If not specified, defaults to first allowed origin from configuration.
     */
    private String origin;

    /**
     * Token expiry time in hours.
     * If not specified, defaults to configured default (24 hours).
     */
    private Integer expiryHours;
}

