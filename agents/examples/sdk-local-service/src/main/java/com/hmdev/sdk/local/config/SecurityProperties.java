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
 * Security settings configured via application.properties.
 * Public endpoints and static extensions are defined as constants (rarely change).
 */
@Configuration
@ConfigurationProperties(prefix = "sls.security")
@Getter
@Setter
public class SecurityProperties {

    /**
     * Public endpoints that don't require token authentication.
     *
     * These are application constants - NOT configurable via properties.
     * They define the core public API surface and rarely change.
     */
    public static final List<String> PUBLIC_ENDPOINTS = Arrays.asList(
        "/health",            // Health check
        "/auth/token",        // Token generation
        "/auth/status",       // Security status
        "/auth/validate",     // Token validation
        "/favicon.ico",       // Favicon
        "/",                  // Root
        "/index.html",        // Index page
        "/terminal/stream",   // WebSocket streaming (sessionId auth)
        "/cloud/connection"   // Cloud configuration
    );

    /**
     * Static resource file extensions that don't require authentication.
     *
     * These are application constants - NOT configurable via properties.
     * They define what file types are served as static content.
     */
    public static final List<String> STATIC_EXTENSIONS = Arrays.asList(
        ".html", ".css", ".js", ".json",
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
        ".woff", ".woff2", ".ttf", ".eot",
        ".map", ".txt", ".md"
    );

    /**
     * Enable/disable security (token validation)
     * Default: true (enabled)
     * Set to false only for development/testing
     */
    private boolean enabled = true;

    /**
     * Allowed origins for CORS and origin validation
     * Specific origins only - no wildcards
     * Configured via application.properties: sls.security.allowed-origins
     */
    private List<String> allowedOrigins = Arrays.asList(
        "https://hmdevonline.com",
        "http://localhost:8084",
        "http://127.0.0.1:8084",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
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


