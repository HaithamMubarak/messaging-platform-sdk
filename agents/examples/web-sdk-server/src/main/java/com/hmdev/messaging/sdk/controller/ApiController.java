package com.hmdev.messaging.sdk.controller;

import com.hmdev.messaging.sdk.service.MessagingServiceClient;
import com.hmdev.messaging.sdk.base.BaseApiConfigController;
import com.hmdev.messaging.sdk.dto.JsonResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
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
     * Get list of available games
     *
     * @return List of games with metadata
     */
    @GetMapping(value = "/games", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonResponse> listGames() {
        // LinkedHashMap so the JSON keeps the same order as the playground page.
        // Fall Guys, Party Physics and Race Balls were removed from the site;
        // this list is what the playground shows, so they are gone from here too.
        // URLs are RELATIVE to the site root on purpose: this site is served from
        // /messaging-platform/sdk/, not the domain root, so a leading slash would
        // point a caller at a path that does not exist.
        Map<String, Object> games = new LinkedHashMap<>();

        games.put("blockparty", game("BlockParty", "\uD83E\uDDF1",
                "Build a shared 3D voxel world together in real time, anywhere on Earth.",
                "apps/mini-games/blockparty/index.html", "2-20", "Unlimited", "Easy"));

        games.put("air-hockey", game("Air Hockey", "\uD83C\uDFD2",
                "Classic air hockey with a multiplayer twist \u2014 score goals and dominate the rink.",
                "apps/mini-games/air-hockey/index.html", "2-4", "3-5 minutes", "Easy"));

        games.put("find-the-liar", game("Find the Liar", "\uD83E\uDD25",
                "Social deduction \u2014 spot the players who only got a hint.",
                "apps/mini-games/find-the-liar/index.html", "3-10", "5-10 minutes", "Easy"));

        games.put("reactor", game("4-Player Reactor", "\u26A1",
                "Fast-paced reaction game \u2014 hit your colour zone the moment it lights up.",
                "apps/mini-games/reactor/reactor-client.html", "2-4", "2-3 minutes", "Easy"));

        games.put("pictionary", game("Pictionary", "\uD83C\uDFA8",
                "One player draws, everyone else races to guess.",
                "apps/pictionary/index.html", "3-10", "5-10 minutes", "Easy"));

        games.put("chess", game("Chess", "\u265F",
                "Two-player chess with full rules and a board that survives a refresh.",
                "apps/chess/index.html", "2", "Unlimited", "Medium"));

        games.put("whiteboard", game("Real-Time Whiteboard", "\uD83D\uDD8C",
                "Draw together in real time with pan, zoom and undo.",
                "apps/whiteboard/index.html", "2-20", "Unlimited", "Easy"));

        return ResponseEntity.ok(JsonResponse.success(games));
    }

    private static Map<String, Object> game(String name, String icon, String description,
                                            String url, String players, String duration,
                                            String difficulty) {
        Map<String, Object> game = new LinkedHashMap<>();
        game.put("name", name);
        game.put("icon", icon);
        game.put("description", description);
        game.put("url", url);
        game.put("players", players);
        game.put("duration", duration);
        game.put("difficulty", difficulty);
        return game;
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
