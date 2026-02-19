package com.hmdev.sdk.local.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * CORS configuration for SDK Local Service.
 *
 * Security measures:
 * 1. Strict origin validation from SecurityProperties
 * 2. Explicit allowed methods (no wildcards)
 * 3. Explicit allowed headers including configurable security token header
 * 4. Credentials support for authenticated requests
 *
 * All configuration comes from SecurityProperties - no hardcoded values!
 */
@Configuration
@RequiredArgsConstructor
public class CorsConfig {

    private final SecurityProperties securityProperties;

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                // Get allowed origins directly from SecurityProperties
                // No transformation - use exact origins from configuration
                String[] originPatterns = securityProperties.getAllowedOrigins()
                        .toArray(new String[0]);

                // Get token header name from SecurityProperties
                String tokenHeader = securityProperties.getTokenHeader();

                registry.addMapping("/**")
                        // Use exact origin patterns from configuration
                        .allowedOriginPatterns(originPatterns)
                        // Only allow necessary HTTP methods
                        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                        // Explicitly allow required headers including configurable security token header
                        .allowedHeaders("Content-Type", tokenHeader, "Origin", "Accept")
                        // Expose security-related headers
                        .exposedHeaders(tokenHeader)
                        // Allow credentials for token-based auth
                        .allowCredentials(true)
                        // Cache preflight for 1 hour
                        .maxAge(3600);
            }
        };
    }
}



