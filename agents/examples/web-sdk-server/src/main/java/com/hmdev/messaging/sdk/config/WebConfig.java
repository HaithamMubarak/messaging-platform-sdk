package com.hmdev.messaging.sdk.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC Configuration
 * Configures CORS, static resources, and other web settings
 */
@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private final WebDemosProperties properties;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        if (properties.getCorsEnabled()) {
            registry.addMapping("/**")
                    .allowedOrigins(properties.getCorsAllowedOrigins())
                    .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                    .allowedHeaders("*")
                    .allowCredentials(false)
                    .maxAge(3600);
        }
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Serve static resources - let Spring Boot handle index.html files automatically
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/", "classpath:/generated/")
                .setCachePeriod(0); // Disable caching for development
    }


    /**
     * Create a RestTemplate bean for making HTTP requests to the messaging service.
     */
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}

