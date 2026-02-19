package com.hmdev.sdk.local.controller;

import com.hmdev.sdk.local.config.SecurityProperties;
import com.hmdev.sdk.local.dto.auth.*;
import com.hmdev.sdk.local.security.SecurityService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Authentication controller for token management.
 * Provides endpoints for generating and validating security tokens.
 */
@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
@Slf4j
public class AuthController {

    private final SecurityService securityService;
    private final SecurityProperties securityProperties;

    /**
     * Generate a new security token.
     */
    @PostMapping("/token")
    public ResponseEntity<?> generateToken(@RequestBody(required = false) TokenGenerationRequest request) {
        try {
            String origin = request != null ? request.getOrigin() : null;
            Integer expiryHours = request != null ? request.getExpiryHours() : null;

            String token = securityService.generateToken(origin, expiryHours);

            log.info("✅ Generated new token for origin: {}", origin != null ? origin : "default");

            TokenGenerationResponse response = new TokenGenerationResponse(
                token,
                expiryHours != null ? expiryHours : securityProperties.getDefaultTokenExpiryHours(),
                "Token generated successfully. Include this token in '" +
                    securityProperties.getTokenHeader() + "' header for all requests."
            );

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("❌ Failed to generate token: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(ErrorResponse.of(e.getMessage()));
        }
    }

    /**
     * Validate a token.
     */
    @GetMapping("/validate")
    public ResponseEntity<?> validateToken(
            @RequestHeader(required = false) java.util.Map<String, String> headers,
            @RequestParam(required = false) String token,
            @RequestHeader(value = "Origin", required = false) String origin) {
        try {
            String headerToken = headers != null ?
                headers.get(securityProperties.getTokenHeader().toLowerCase()) : null;
            String tokenToValidate = headerToken != null ? headerToken : token;

            if (tokenToValidate == null) {
                return ResponseEntity.badRequest()
                    .body(TokenValidationResponse.failure(
                        "No token provided. Include in '" + securityProperties.getTokenHeader() +
                        "' header or 'token' query parameter."
                    ));
            }

            boolean isValid = securityService.validateToken(tokenToValidate, origin);

            if (isValid) {
                return ResponseEntity.ok(TokenValidationResponse.success("Token is valid"));
            } else {
                return ResponseEntity.status(401)
                    .body(TokenValidationResponse.failure("Token is invalid or expired"));
            }

        } catch (Exception e) {
            log.error("❌ Error validating token: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(ErrorResponse.of(e.getMessage()));
        }
    }

    /**
     * Get security status
     */
    @GetMapping("/status")
    public ResponseEntity<SecurityStatusResponse> getStatus() {
        try {
            long tokenCount = securityService.getActiveTokensCount();

            SecurityStatusResponse response = SecurityStatusResponse.builder()
                .securityEnabled(securityProperties.isEnabled())
                .activeTokens((int) tokenCount)
                .version("1.0.0")
                .tokenHeader(securityProperties.getTokenHeader())
                .defaultTokenExpiryHours(securityProperties.getDefaultTokenExpiryHours())
                .message(securityProperties.isEnabled() ?
                    "Security is enabled. Token required for API access." :
                    "Security is disabled (development mode).")
                .build();

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("❌ Error getting security status: {}", e.getMessage(), e);
            SecurityStatusResponse errorResponse = SecurityStatusResponse.builder()
                .message("Error: " + e.getMessage())
                .build();
            return ResponseEntity.internalServerError().body(errorResponse);
        }
    }
}

