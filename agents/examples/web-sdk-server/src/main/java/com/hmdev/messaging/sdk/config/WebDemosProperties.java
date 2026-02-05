package com.hmdev.messaging.sdk.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for Web sdk Server
 */
@Configuration
@ConfigurationProperties(prefix = "sdk")
@Getter
@Setter
public class WebDemosProperties {

    /**
     * URL of the messaging service API
     * Default: http://localhost:8080
     */
    private String messagingServiceUrl = "http://localhost:8080";

    /**
     * Developer API key for accessing messaging service
     * This should be set via environment variable: DEFAULT_API_KEY
     */
    private String apiKey;

    /**
     * Default TTL for temporary keys in seconds
     * Default: 3600 (1 hour)
     */
    private Integer defaultTempKeyTtl = 3600;

    /**
     * Whether to enable CORS for cross-origin requests
     * Default: true
     */
    private Boolean corsEnabled = true;

    /**
     * Allowed origins for CORS
     * Default: * (all origins)
     */
    private String corsAllowedOrigins = "*";
}

