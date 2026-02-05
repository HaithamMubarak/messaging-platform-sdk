package com.hmdev.messaging.sdk.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Standard JSON response wrapper for API endpoints.
 * Provides consistent response format across all web-based applications.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class JsonResponse {

    /**
     * Status of the response: "success" or "error"
     */
    private String status;

    /**
     * Response data (for success responses)
     */
    private Object data;

    /**
     * Error message (for error responses)
     */
    private String message;

    /**
     * Create a success response with data
     */
    public static JsonResponse success(Object data) {
        return new JsonResponse("success", data, null);
    }

    /**
     * Create an error response with message
     */
    public static JsonResponse error(String message) {
        return new JsonResponse("error", null, message);
    }
}

