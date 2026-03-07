package com.hmdev.sdk.local.config;

import com.hmdev.sdk.local.security.SecurityFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Security configuration for SDK Local Service.
 *
 * Security measures implemented:
 * 1. Token-based authentication for all API endpoints
 * 2. Origin validation to prevent unauthorized access
 * 3. Request logging and suspicious activity detection
 * 4. Secure token generation with expiry
 * 5. CSRF protection through token validation
 */
@Configuration
@RequiredArgsConstructor
public class SecurityConfig {

    private final SecurityFilter securityFilter;

    /**
     * Register security filter to validate all requests
     */
    @Bean
    public FilterRegistrationBean<SecurityFilter> securityFilterRegistration() {
        FilterRegistrationBean<SecurityFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(securityFilter);
        registration.addUrlPatterns("/*");
        registration.setName("securityFilter");
        registration.setOrder(1); // Run first
        return registration;
    }
}

