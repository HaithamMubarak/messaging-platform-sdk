package com.hmdev.messaging.sdk.controller;

import com.hmdev.messaging.sdk.config.WebDemosProperties;
import com.hmdev.messaging.sdk.service.MessagingServiceClient;
import com.hmdev.messaging.sdk.base.BaseApiConfigController;
import com.hmdev.messaging.sdk.dto.JsonResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
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

    private final WebDemosProperties properties;

    public ApiController(MessagingServiceClient messagingServiceClient, WebDemosProperties properties) {
        super(messagingServiceClient);
        this.properties = properties;
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
     * Get list of available games
     *
     * @return List of games with metadata
     */
    @GetMapping(value = "/games", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonResponse> listGames() {
        Map<String, Object> games = new HashMap<>();


        games.put("quiz-battle", Map.of(
                "name", "Quiz Battle",
                "description", "Answer trivia questions faster than your opponents!",
                "url", "/quiz-battle/",
                "players", "2-10",
                "duration", "3-5 minutes",
                "difficulty", "Easy",
                "icon", "🧠"
        ));

        games.put("whiteboard", Map.of(
                "name", "Real-Time Whiteboard",
                "description", "Draw together in real-time with friends!",
                "url", "/whiteboard/",
                "players", "2-20",
                "duration", "Unlimited",
                "difficulty", "Easy",
                "icon", "🎨"
        ));

        return ResponseEntity.ok(JsonResponse.success(games));
    }

    /**
     * Health check endpoint
     *
     * @return Service health status
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> response = new HashMap<>();
        response.put("status", "UP");
        response.put("service", "web-demos-server");
        response.put("version", "1.0.0");

        // Check messaging service availability
        boolean messagingAvailable = messagingServiceClient.isMessagingServiceAvailable();
        response.put("messagingService", messagingAvailable ? "UP" : "DOWN");
        response.put("messagingServiceUrl", properties.getMessagingServiceUrl());

        return ResponseEntity.ok(response);
    }
}

