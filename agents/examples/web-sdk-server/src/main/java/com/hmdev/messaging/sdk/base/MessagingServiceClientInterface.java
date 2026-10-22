package com.hmdev.messaging.sdk.base;

import com.hmdev.messaging.sdk.dto.ApiConfigResponse;
import com.hmdev.messaging.sdk.dto.HostRoomResponse;

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

    /** The same, minted from a tenant's key (ApiAccessRequest.tenant); by default the site's own. */
    default ApiConfigResponse getApiAccessDetails(String tenant, Integer ttlSeconds, Boolean singleUse) {
        return getApiAccessDetails(ttlSeconds, singleUse);
    }

    /**
     * Open a room whose host is hostAgent: a random name under the app and a random password, created on
     * the messaging service with the real key, with hostAgent named its host. Only a server that holds a
     * real key can do this; the default refuses.
     *
     * @param app the page's customType: the room is created as `<channelName>.<app>`, the room that page joins
     */
    default HostRoomResponse openHostedRoom(String tenant, String app, String hostAgent) {
        throw new UnsupportedOperationException("This server does not open rooms.");
    }

    /**
     * Check if messaging service is available.
     *
     * @return true if service is up, false otherwise
     */
    default boolean isMessagingServiceAvailable() {
        return true;  // Default implementation
    }
}

