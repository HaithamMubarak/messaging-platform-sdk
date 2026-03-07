package com.hmdev.sdk.local.security;

import com.hmdev.sdk.local.config.SecurityProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Optional;

/**
 * Security service for managing access tokens.
 * Implements secure token generation and validation for local service access.
 *
 * All configuration loaded from application.properties via SecurityProperties
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SecurityService {

    private final SecurityTokenRepository tokenRepository;
    private final SecurityProperties securityProperties;
    private final SecureRandom secureRandom = new SecureRandom();

    /**
     * Generate a new secure random token
     * @param allowedOrigin The origin that is allowed to use this token
     * @param expiryHours Token expiry in hours (default from config)
     * @return Generated token string
     */
    @Transactional
    public String generateToken(String allowedOrigin, Integer expiryHours) {
        // Generate 48-byte random token (base64 encoded = 64 characters)
        byte[] randomBytes = new byte[48];
        secureRandom.nextBytes(randomBytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);

        // Use configured default if not specified
        int actualExpiryHours = expiryHours != null ? expiryHours : securityProperties.getDefaultTokenExpiryHours();

        // Create and save token
        SecurityToken securityToken = new SecurityToken();
        securityToken.setToken(token);
        // Default to first allowed origin if not specified
        String defaultOrigin = allowedOrigin != null ? allowedOrigin :
                (!securityProperties.getAllowedOrigins().isEmpty() ?
                    securityProperties.getAllowedOrigins().get(0) : "*");
        securityToken.setAllowedOrigin(defaultOrigin);
        securityToken.setCreatedAt(LocalDateTime.now());
        securityToken.setExpiresAt(LocalDateTime.now().plusHours(actualExpiryHours));
        securityToken.setActive(true);

        tokenRepository.save(securityToken);

        log.info("[Token] Generated new security token (expires in {} hours) for origin: {}",
                 actualExpiryHours, allowedOrigin);

        return token;
    }

    /**
     * Validate a token
     * @param token Token to validate
     * @param origin Origin making the request
     * @return true if token is valid and not expired
     */
    public boolean validateToken(String token, String origin) {
        if (token == null || token.trim().isEmpty()) {
            log.warn("[Token] Validation failed: Empty token");
            return false;
        }

        Optional<SecurityToken> tokenOpt = tokenRepository.findByTokenAndActiveTrue(token);

        if (tokenOpt.isEmpty()) {
            log.warn("[Token] Validation failed: Token not found or inactive");
            return false;
        }

        SecurityToken securityToken = tokenOpt.get();

        // Check expiry
        if (LocalDateTime.now().isAfter(securityToken.getExpiresAt())) {
            log.warn("[Token] Validation failed: Token expired at {}", securityToken.getExpiresAt());
            deactivateToken(token);
            return false;
        }

        // Check origin (if specified)
        if (origin != null && securityToken.getAllowedOrigin() != null) {
            if (!originMatches(origin, securityToken.getAllowedOrigin())) {
                log.warn("[Token] Validation failed: Origin mismatch. Expected: {}, Got: {}",
                         securityToken.getAllowedOrigin(), origin);
                return false;
            }
        }

        return true;
    }

    /**
     * Check if origin matches allowed origin (supports wildcards and localhost with any port)
     */
    private boolean originMatches(String origin, String allowedOrigin) {
        if ("*".equals(allowedOrigin)) {
            return true;
        }

        // Normalize origins (remove trailing slash)
        String normalizedOrigin = origin != null ? origin.replaceAll("/$", "") : "";
        String normalizedAllowed = allowedOrigin.replaceAll("/$", "");

        // Exact match
        if (normalizedOrigin.equals(normalizedAllowed)) {
            return true;
        }

        // Support localhost/127.0.0.1 with any port
        // Extract hostname from allowed origin
        String[] allowedParts = normalizedAllowed.split("://");
        if (allowedParts.length == 2) {
            String hostname = allowedParts[1].split(":")[0]; // Remove port if exists

            // Check if allowed origin is localhost or 127.0.0.1
            if ("localhost".equals(hostname) || "127.0.0.1".equals(hostname)) {
                // Check if the incoming origin has the same hostname (ignoring port)
                return normalizedOrigin.contains("://" + hostname + ":") ||
                       normalizedOrigin.endsWith("://" + hostname);
            }
        }

        return false;
    }

    /**
     * Deactivate a token
     */
    @Transactional
    public void deactivateToken(String token) {
        tokenRepository.findByTokenAndActiveTrue(token).ifPresent(t -> {
            t.setActive(false);
            tokenRepository.save(t);
            log.info("[Token] Deactivated token");
        });
    }

    /**
     * Clean up expired tokens (run periodically)
     */
    @Transactional
    public void cleanupExpiredTokens() {
        tokenRepository.deleteByExpiresAtBefore(LocalDateTime.now());
        log.info("[Token] Cleaned up expired tokens");
    }

    /**
     * Get total active tokens count
     */
    public long getActiveTokensCount() {
        return tokenRepository.findAll().stream()
            .filter(SecurityToken::isActive)
            .filter(t -> LocalDateTime.now().isBefore(t.getExpiresAt()))
            .count();
    }
}







