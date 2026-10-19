package com.hmdev.messaging.sdk.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for creating API access (temporary keys).
 * Used by web-based applications to request temporary keys with specific parameters.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
// The same object is the body sent on to messaging-service, which knows no
// tenant: an empty one is left out of the JSON.
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiAccessRequest {

    /**
     * Time-to-live in seconds for the temporary key.
     * If null, server will use default value.
     */
    private Integer ttlSeconds;

    /**
     * Whether the key should be single-use only.
     * Single-use keys are deleted after first use.
     */
    private Boolean singleUse;

    /**
     * Whose account the key is minted from. Empty means the site's own (the SDK
     * demos); "games" means the Games tenant, so a game's rooms count against
     * the games' allowance and not the demos' 50 channels. An unknown tenant,
     * or one this server has no key for, gets the site's own key.
     */
    private String tenant;

    public ApiAccessRequest(Integer ttlSeconds, Boolean singleUse) {
        this(ttlSeconds, singleUse, null);
    }
}
