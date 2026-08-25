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
     * Public endpoints that don't require token authentication, matched EXACTLY.
     *
     * These are application constants - NOT configurable via properties.
     * They define the core public API surface and rarely change.
     *
     * Exact matching is load-bearing, not a style choice. This list used to be
     * compared with startsWith(), and it contained "/" — and since every HTTP
     * path begins with "/", that made every endpoint in the service public,
     * including the SSH credential APIs. Anything added here opens exactly one
     * path and nothing beneath it; a genuinely public subtree goes in
     * PUBLIC_SUBTREES below, where the wildcard is deliberate and visible.
     */
    public static final List<String> PUBLIC_ENDPOINTS = Arrays.asList(
        "/health",            // Health check
        "/auth/token",        // Token generation
        "/auth/status",       // Security status
        "/auth/validate",     // Token validation
        "/favicon.ico",       // Favicon
        "/",                  // Root — the index page only; NOT a prefix
        "/index.html",        // Index page
        "/terminal/stream",   // WebSocket streaming (ticket-authenticated)
        "/cloud/connection",  // Cloud configuration
        "/terminal/shells"    // List available shells (used by the UI to populate shell options)
    );

    /**
     * Public subtrees: every path beneath these prefixes is public.
     *
     * Keep this list as short as possible and never add a bare "/" — that is
     * the bypass this split exists to prevent.
     */
    public static final List<String> PUBLIC_SUBTREES = Arrays.asList(
        "/h2-console"         // H2 Database Console and its resources (localhost only)
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
     * Record that terminal commands ran (programme name and length only, never
     * the command text or its arguments).
     *
     * Default: false. Terminal input routinely carries secrets — an inline API
     * token, a password typed at a prompt — so nothing about command content is
     * recorded unless an operator turns this on deliberately.
     */
    private boolean auditCommands = false;

    /**
     * Enable security logging
     * Default: true
     */
    private boolean enableLogging = true;
}


