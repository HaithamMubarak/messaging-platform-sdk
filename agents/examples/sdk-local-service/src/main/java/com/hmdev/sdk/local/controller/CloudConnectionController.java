package com.hmdev.sdk.local.controller;

import com.hmdev.sdk.local.model.AppConfig;
import com.hmdev.sdk.local.repository.AppConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Cloud connection management endpoint
 * Stores/retrieves cloud messaging platform credentials
 */
@RestController
@RequestMapping("/cloud")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "*")
public class CloudConnectionController {

    private static final String CLOUD_CONNECTION_KEY = "cloud_connection";

    private final AppConfigRepository appConfigRepository;

    /**
     * Get cloud connection configuration
     *
     * GET /cloud/connection
     *
     * Response:
     * {
     *   "channelName": "my-channel",
     *   "channelPassword": "password123",
     *   "agentName": "agent-xyz-123",
     *   "isConnected": true
     * }
     *
     * Returns empty object if no connection configured
     */
    @GetMapping("/connection")
    public ResponseEntity<?> getConnection() {
        try {
            return appConfigRepository.findById(CLOUD_CONNECTION_KEY)
                .map(config -> {
                    log.info("[Cloud] Retrieved cloud connection config");
                    return ResponseEntity.ok(Map.of("config", config.getValue()));
                })
                .orElseGet(() -> {
                    log.info("[Cloud] No cloud connection config found, returning empty");
                    return ResponseEntity.ok(Map.of("config", "{}"));
                });
        } catch (Exception e) {
            log.error("[Cloud] Failed to get connection: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Save/update cloud connection configuration
     *
     * POST /cloud/connection
     * {
     *   "config": {
     *     "channelName": "my-channel",
     *     "channelPassword": "password123",
     *     "agentName": "agent-xyz-123",
     *     "isConnected": true
     *   }
     * }
     */
    @PostMapping("/connection")
    public ResponseEntity<?> saveConnection(@RequestBody Map<String, Object> request) {
        try {
            String configJson = request.containsKey("config")
                ? request.get("config").toString()
                : "{}";

            AppConfig config = appConfigRepository.findById(CLOUD_CONNECTION_KEY)
                .orElse(new AppConfig());

            config.setKey(CLOUD_CONNECTION_KEY);
            config.setValue(configJson);

            appConfigRepository.save(config);

            log.info("[Cloud] Saved cloud connection config");
            return ResponseEntity.ok(Map.of(
                "status", "saved",
                "config", configJson
            ));
        } catch (Exception e) {
            log.error("[Cloud] Failed to save connection: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Delete cloud connection configuration
     *
     * DELETE /cloud/connection
     */
    @DeleteMapping("/connection")
    public ResponseEntity<?> deleteConnection() {
        try {
            appConfigRepository.deleteById(CLOUD_CONNECTION_KEY);
            log.info("[Cloud] Deleted cloud connection config");
            return ResponseEntity.ok(Map.of("status", "deleted"));
        } catch (Exception e) {
            log.error("[Cloud] Failed to delete connection: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getMessage()));
        }
    }
}

