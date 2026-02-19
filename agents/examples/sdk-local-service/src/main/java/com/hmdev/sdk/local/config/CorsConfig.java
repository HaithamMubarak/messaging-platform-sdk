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
                // Get allowed origins from SecurityProperties
                String[] originPatterns = securityProperties.getAllowedOrigins().stream()
                        .map(origin -> {
                            // Convert simple origins to patterns that support ports
                            if (origin.contains("localhost") || origin.contains("127.0.0.1")) {
                                // Allow any port for localhost
                                return origin.replaceAll(":\\d+$", ":*");
                            }
                            return origin;
                        })
                        .toArray(String[]::new);

                // Get token header name from SecurityProperties
                String tokenHeader = securityProperties.getTokenHeader();

                registry.addMapping("/**")
                        // Use configured origin patterns
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



