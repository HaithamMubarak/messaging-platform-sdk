package com.hmdev.messaging.sdk.dto;

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
}
