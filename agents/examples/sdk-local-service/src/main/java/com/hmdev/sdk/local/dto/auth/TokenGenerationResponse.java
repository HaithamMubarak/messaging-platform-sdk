package com.hmdev.sdk.local.dto.auth;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Response DTO for successful token generation.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TokenGenerationResponse {

    /**
     * The generated security token.
     */
    private String token;

    /**
     * Token expiry time in hours.
     */
    private Integer expiresIn;

    /**
     * Success message with usage instructions.
     */
    private String message;
}

