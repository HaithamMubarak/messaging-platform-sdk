package com.hmdev.messaging.sdk.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Response DTO for API configuration endpoints.
 * Contains temporary authentication token, service URLs, and configuration details.
 *
 * Used by both web-agent and mini-games-server for consistent API responses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiConfigResponse {

    /**
     * Messaging service API URL
     */
    private String messagingServiceUrl;

    /**
     * File service URL (optional)
     */
    private String fileServiceUrl;

    /**
     * Temporary API key for client use.
     * Note: Serialized as "apiKey" in JSON for client-side consistency.
     */
    @JsonProperty("apiKey")
    private String temporaryKey;

    /**
     * Time to live in seconds
     */
    private Integer ttlSeconds;

    /**
     * Whether this key is single-use only
     */
    private Boolean singleUse;

    /**
     * When the key expires (Unix timestamp in milliseconds or ISO 8601 format)
     */
    private Object expiresAt;

    /**
     * Additional service-specific URL (for extensibility)
     */
    private String apiUrl;
}

