package com.hmdev.messaging.sdk.base;

import com.hmdev.messaging.sdk.dto.ApiConfigResponse;

/**
 * Interface for communicating with the messaging service API.
 * Implementations handle temporary API key creation and service communication.
 *
 * This interface allows different web applications to provide their own
 * implementation while maintaining consistent controller logic.
 */
public interface MessagingServiceClientInterface {

    /**
     * Get API access details with a temporary key.
     *
     * @param ttlSeconds Time-to-live in seconds (null for default)
     * @param singleUse If true, key can only be used once
     * @return API configuration response with temporary key
     * @throws RuntimeException if the request fails
     */
    ApiConfigResponse getApiAccessDetails(Integer ttlSeconds, Boolean singleUse);

    /**
     * Check if messaging service is available.
     *
     * @return true if service is up, false otherwise
     */
    default boolean isMessagingServiceAvailable() {
        return true;  // Default implementation
    }
}

