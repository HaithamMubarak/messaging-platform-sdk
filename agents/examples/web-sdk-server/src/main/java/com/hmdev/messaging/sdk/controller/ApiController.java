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
        // LinkedHashMap so the JSON keeps the same order as the mini-games landing page.
        // Experimental, localhost-only demos (e.g. party-physics) are deliberately not listed.
        Map<String, Object> games = new LinkedHashMap<>();

        games.put("blockparty", Map.of(
                "name", "BlockParty",
                "description", "Build a shared 3D voxel world together in real time!",
                "url", "/apps/mini-games/blockparty/index.html",
                "players", "2-20",
                "duration", "Unlimited",
                "difficulty", "Easy",
                "icon", "🧱"
        ));

        games.put("quiz-battle", Map.of(
                "name", "Quiz Battle",
                "description", "Answer trivia questions faster than your opponents!",
                "url", "/apps/mini-games/quiz-battle/index.html",
                "players", "2-10",
                "duration", "3-5 minutes",
                "difficulty", "Easy",
                "icon", "🧠"
        ));

        games.put("find-the-liar", Map.of(
                "name", "Find the Liar",
                "description", "Social deduction party game — spot the players who only got a hint!",
                "url", "/apps/mini-games/find-the-liar/index.html",
                "players", "3-10",
                "duration", "5-10 minutes",
                "difficulty", "Easy",
                "icon", "🤥"
        ));

        games.put("air-hockey", Map.of(
                "name", "Air Hockey",
                "description", "Classic air hockey with a multiplayer twist — score goals and dominate the rink!",
                "url", "/apps/mini-games/air-hockey/index.html",
                "players", "2-4",
                "duration", "3-5 minutes",
                "difficulty", "Easy",
                "icon", "🏒"
        ));

        games.put("reactor", Map.of(
                "name", "4-Player Reactor",
                "description", "Fast-paced reaction game — hit your colour zone the moment it lights up. 10 modes!",
                "url", "/apps/mini-games/reactor/reactor-client.html",
                "players", "2-4",
                "duration", "2-3 minutes",
                "difficulty", "Easy",
                "icon", "⚡"
        ));

        games.put("race-balls", Map.of(
                "name", "Race Balls",
                "description", "3D physics racing through obstacles, boost pads and checkpoints.",
                "url", "/apps/mini-games/race-balls/index.html",
                "players", "2-4",
                "duration", "3-5 minutes",
                "difficulty", "Medium",
                "icon", "🏁"
        ));

        games.put("fall-guys", Map.of(
                "name", "Fall Guys Race",
                "description", "Obstacle course racing — dodge dynamic hazards and race to victory!",
                "url", "/apps/mini-games/fall-guys/index.html",
                "players", "4-20",
                "duration", "5-8 minutes",
                "difficulty", "Medium",
                "icon", "🏃"
        ));

        games.put("whiteboard", Map.of(
                "name", "Real-Time Whiteboard",
                "description", "Draw together in real-time with friends!",
                "url", "/apps/whiteboard/index.html",
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

