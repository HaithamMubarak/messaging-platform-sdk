package com.hmdev.sdk.local.security;

import com.hmdev.sdk.local.config.SecurityProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * Security filter that validates tokens on all protected endpoints.
 *
 * Security measures:
 * 1. Validates Origin header to prevent unauthorized access
 * 2. Requires X-SLS-Token header for API endpoints
 * 3. Logs suspicious activity
 * 4. Blocks requests without proper authentication
 *
 * All configuration is loaded from application.properties via SecurityProperties
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SecurityFilter extends OncePerRequestFilter {

    private final SecurityService securityService;
    private final SecurityProperties securityProperties;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        String path = request.getRequestURI();
        String origin = request.getHeader("Origin");
        String referer = request.getHeader("Referer");

        // Allow OPTIONS requests for CORS preflight
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }

        // Skip security for public endpoints
        if (isPublicEndpoint(path)) {
            filterChain.doFilter(request, response);
            return;
        }

        // Skip security for static resources
        if (isStaticResource(path)) {
            filterChain.doFilter(request, response);
            return;
        }

        // If security is disabled (for development), allow all
        if (!securityProperties.isEnabled()) {
            if (securityProperties.isEnableLogging()) {
                log.debug("[Security] Disabled - allowing request to: {}", path);
            }
            filterChain.doFilter(request, response);
            return;
        }

        // Validate Origin header
        if (!isValidOrigin(origin, referer)) {
            if (securityProperties.isEnableLogging()) {
                log.warn("[Security] Blocked request with invalid origin. Path: {}, Origin: {}, IP: {}",
                         path, origin, request.getRemoteAddr());
            }
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Invalid origin\",\"code\":\"INVALID_ORIGIN\"}");
            return;
        }

        // Validate token (header only)
        String token = request.getHeader(securityProperties.getTokenHeader());

        if (token == null || !securityService.validateToken(token, origin)) {
            if (securityProperties.isEnableLogging()) {
                log.warn("[Security] Blocked request with invalid/missing token. Path: {}, Origin: {}, IP: {}",
                         path, origin != null ? origin : "null", request.getRemoteAddr());
            }
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Invalid or missing token\",\"code\":\"UNAUTHORIZED\"}");
            return;
        }

        // Token is valid, proceed
        if (securityProperties.isEnableLogging()) {
            log.debug("[Security] Check passed for: {}", path);
        }
        filterChain.doFilter(request, response);
    }

    /**
     * Check if endpoint is public (doesn't require token)
     */
    private boolean isPublicEndpoint(String path) {
        return SecurityProperties.PUBLIC_ENDPOINTS.stream()
                .anyMatch(path::startsWith);
    }

    /**
     * Check if request is for static resource
     */
    private boolean isStaticResource(String path) {
        return SecurityProperties.STATIC_EXTENSIONS.stream()
                .anyMatch(path::endsWith);
    }

    /**
     * Validate origin is from localhost or allowed domain
     * Uses configured allowed origins from SecurityProperties
     */
    private boolean isValidOrigin(String origin, String referer) {
        // If no origin/referer, it might be a direct request (curl, etc) - allow for localhost
        if (origin == null && referer == null) {
            return true; // Direct requests allowed (will still need token)
        }

        String checkOrigin = origin != null ? origin : referer;

        // Check against configured allowed origins
        for (String allowedOrigin : securityProperties.getAllowedOrigins()) {
            if (originMatches(checkOrigin, allowedOrigin)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if origin matches allowed origin pattern
     * Supports wildcards and localhost with any port
     */
    private boolean originMatches(String origin, String allowedOrigin) {
        if ("*".equals(allowedOrigin)) {
            return true;
        }

        // Normalize origins (remove trailing slash)
        String normalizedOrigin = origin.replaceAll("/$", "");
        String normalizedAllowed = allowedOrigin.replaceAll("/$", "");

        // Exact match
        if (normalizedOrigin.equals(normalizedAllowed)) {
            return true;
        }

        // Support localhost/127.0.0.1 with any port
        // Extract protocol and hostname from allowed origin (e.g., "http://localhost" -> ["http", "localhost"])
        String[] allowedParts = normalizedAllowed.split("://");
        if (allowedParts.length == 2) {
            String protocol = allowedParts[0];
            String hostname = allowedParts[1].split(":")[0]; // Remove port if exists

            // Check if allowed origin is localhost or 127.0.0.1
            if ("localhost".equals(hostname) || "127.0.0.1".equals(hostname)) {
                String originPrefix = protocol + "://" + hostname;
                return normalizedOrigin.startsWith(originPrefix + ":") ||
                       normalizedOrigin.equals(originPrefix);
            }
        }

        return false;
    }
}





