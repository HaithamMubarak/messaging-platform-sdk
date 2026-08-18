package com.hmdev.messaging.sdk.config;

import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import javax.servlet.*;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

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
            // The property is a single comma-separated string, so it has to be
            // split — passing it whole made Spring compare the entire blob
            // against the Origin header and reject everything.
            String[] origins = java.util.Arrays.stream(
                            properties.getCorsAllowedOrigins().split(","))
                    .map(String::trim)
                    .filter(o -> !o.isEmpty())
                    .toArray(String[]::new);

            registry.addMapping("/**")
                    .allowedOrigins(origins)
                    .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                    .allowedHeaders("*")
                    .allowCredentials(false)
                    .maxAge(3600);
        }
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Assets that only change when the file itself is replaced. Each needs
        // its own location: the part of the path matched by ** is resolved
        // relative to the location, so "/images/**" -> "classpath:/static/"
        // would look for static/<file>, not static/images/<file>.
        registry.addResourceHandler("/images/**")
                .addResourceLocations("classpath:/static/images/")
                .setCacheControl(CacheControl.maxAge(7, TimeUnit.DAYS).cachePublic());

        registry.addResourceHandler("/lib/**")
                .addResourceLocations("classpath:/static/lib/")
                .setCacheControl(CacheControl.maxAge(7, TimeUnit.DAYS).cachePublic());

        // Everything else — HTML, CSS, JS — is served unversioned, so a long
        // max-age would pin browsers to a stale deploy. no-cache means "you may
        // keep it, but revalidate", which combined with the ETag filter below
        // turns repeat visits into 304s instead of full re-downloads. The
        // previous setCachePeriod(0) sent no-store, which forbade even that.
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/", "classpath:/generated/")
                .setCacheControl(CacheControl.noCache());
    }

    /**
     * Baseline response headers. No CSP here on purpose: many of the bundled
     * demo pages still carry inline scripts, and a policy strict enough to be
     * worth having would break them. The consoles were externalised and can
     * take one later.
     */
    @Bean
    public Filter securityHeadersFilter() {
        return (request, response, chain) -> {
            HttpServletResponse http = (HttpServletResponse) response;
            http.setHeader("X-Content-Type-Options", "nosniff");
            http.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
            http.setHeader("X-Frame-Options", "SAMEORIGIN");
            http.setHeader("Permissions-Policy", "geolocation=(), payment=(), usb=()");
            chain.doFilter(request, response);
        };
    }


    /**
     * Create a RestTemplate bean for making HTTP requests to the messaging service.
     */
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    /**
     * Redirect filter to handle /examples/** to /apps/** redirects
     * This provides backward compatibility when the examples folder was renamed to apps
     */
    @Bean
    public Filter examplesRedirectFilter() {
        return (request, response, chain) -> {
            HttpServletRequest httpRequest = (HttpServletRequest) request;
            HttpServletResponse httpResponse = (HttpServletResponse) response;

            String requestUri = httpRequest.getRequestURI();

            // Redirect /examples/** to /apps/**
            if (requestUri.startsWith("/examples/")) {
                String newUri = requestUri.replace("/examples/", "/apps/");
                String queryString = httpRequest.getQueryString();
                String redirectUrl = queryString != null ? newUri + "?" + queryString : newUri;

                httpResponse.setStatus(HttpServletResponse.SC_MOVED_PERMANENTLY); // 301 Permanent Redirect
                httpResponse.setHeader("Location", redirectUrl);
                return;
            }

            chain.doFilter(request, response);
        };
    }
}

