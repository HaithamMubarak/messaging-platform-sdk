package com.hmdev.sdk.local.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.Arrays;
import java.util.List;

/**
 * Configuration properties for SDK Local Service security.
 *
 * All security settings can be configured via application.properties
 */
@Configuration
@ConfigurationProperties(prefix = "sls.security")
@Getter
@Setter
public class SecurityProperties {

    /**
     * Enable/disable security (token validation)
     * Default: true (enabled)
     * Set to false only for development/testing
     */
    private boolean enabled = true;

    /**
     * Allowed origins for CORS and origin validation
     * Comma-separated list
     * Example: https://hmdevonline.com,http://localhost,http://127.0.0.1
     */
    private List<String> allowedOrigins = Arrays.asList(
        "https://hmdevonline.com",
        "http://localhost",
        "http://127.0.0.1"
    );

    /**
     * Public endpoints that don't require token authentication
     * These are accessible without X-SLS-Token header
     *
     * Note: H2 console is NOT included - it has its own security
     */
    private List<String> publicEndpoints = Arrays.asList(
        "/health",
        "/auth/token",
        "/auth/status",
        "/auth/validate",
        "/favicon.ico",
        "/",
        "/index.html",
        "/terminal/stream" // WebSocket endpoint (sessionId provides access control)
    );

    /**
     * Static resource file extensions
     * These are served without token validation
     */
    private List<String> staticExtensions = Arrays.asList(
        ".html", ".css", ".js", ".json",
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
        ".woff", ".woff2", ".ttf", ".eot",
        ".map", ".txt", ".md"
    );

    /**
     * Token header name
     * Default: X-SLS-Token
     */
    private String tokenHeader = "X-SLS-Token";

    /**
     * Default token expiry in hours
     * Default: 24
     */
    private Integer defaultTokenExpiryHours = 24;

    /**
     * Enable security logging
     * Default: true
     */
    private boolean enableLogging = true;
}


