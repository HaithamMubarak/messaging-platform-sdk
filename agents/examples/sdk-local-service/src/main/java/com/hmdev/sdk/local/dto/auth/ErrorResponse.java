package com.hmdev.sdk.local.dto.auth;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Generic error response DTO for authentication endpoints.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ErrorResponse {

    /**
     * Error message.
     */
    private String error;

    /**
     * Create an error response.
     */
    public static ErrorResponse of(String error) {
        return new ErrorResponse(error);
    }
}

