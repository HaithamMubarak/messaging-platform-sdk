package com.hmdev.messaging.sdk.controller;

import com.hmdev.messaging.sdk.service.MessagingServiceClient;
import com.hmdev.messaging.sdk.base.BaseApiConfigController;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * API Controller for Mini Games.
 * Extends BaseApiConfigController from web-agent for common /config endpoint logic.
 *
 * Provides endpoints for:
 * - API configuration with temporary keys (inherited from base)
 * - Health checks
 * - Game listing
 */
@RestController
@RequestMapping("/app/api")
@Slf4j
public class ApiController extends BaseApiConfigController {

    public ApiController(MessagingServiceClient messagingServiceClient) {
        super(messagingServiceClient);
    }

    /**
     * /config endpoint is inherited from BaseApiConfigController
     */

    @Override
    protected String getServiceName() {
        // Return "web-demos" as service name (used for temporary keys and logging)
        // When deployed as web-agent-service Docker container, this JAR serves web demos
        return "web-demos";
    }

    /**
     * Health check endpoint.
     *
     * <p>This is public and unauthenticated, so it reports only whether the
     * backend is reachable — never which backend. The configured messaging
     * service URL is deployment detail (and is often an internal hostname), and
     * this site is meant to be a black box over the platform.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "UP");
        response.put("service", "web-demos-server");
        response.put("version", version());

        boolean messagingAvailable = messagingServiceClient.isMessagingServiceAvailable();
        response.put("messagingService", messagingAvailable ? "UP" : "DOWN");

        return ResponseEntity.ok(response);
    }

    /** Version stamped into the jar manifest at build time, when there is one. */
    private String version() {
        String implVersion = ApiController.class.getPackage().getImplementationVersion();
        return implVersion != null ? implVersion : "dev";
    }
}
