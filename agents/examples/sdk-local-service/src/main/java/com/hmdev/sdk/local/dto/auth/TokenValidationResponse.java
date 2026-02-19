package com.hmdev.sdk.local.dto.auth;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Response DTO for token validation.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TokenValidationResponse {

    /**
     * Whether the token is valid.
     */
    private Boolean valid;

    /**
     * Message about validation result.
     */
    private String message;

    /**
     * Error message if validation failed.
     */
    private String error;

    /**
     * Create a successful validation response.
     */
    public static TokenValidationResponse success(String message) {
        TokenValidationResponse response = new TokenValidationResponse();
        response.setValid(true);
        response.setMessage(message);
        return response;
    }

    /**
     * Create a failed validation response.
     */
    public static TokenValidationResponse failure(String error) {
        TokenValidationResponse response = new TokenValidationResponse();
        response.setValid(false);
        response.setError(error);
        return response;
    }
}

