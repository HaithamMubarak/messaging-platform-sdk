package com.hmdev.sdk.local.controller;

import com.hmdev.sdk.local.dto.SshTestRequest;
import com.hmdev.sdk.local.dto.SshTestResponse;
import com.hmdev.sdk.local.model.SshConnection;
import com.hmdev.sdk.local.model.TerminalSession;
import com.hmdev.sdk.local.terminal.TerminalService;
import com.hmdev.sdk.local.terminal.util.TerminalStringUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/terminal")
@RequiredArgsConstructor
@Slf4j
public class TerminalController {

    private final TerminalService terminalService;

    /**
     * Create terminal session (local or SSH)
     *
     * POST /terminal/create
     *
     * For local terminal:
     * {
     *   "type": "local",
     *   "shell": "cmd",  // or "bash", "powershell", etc.
     *   "sessionId": "optional-custom-id"  // Optional: reuse existing session ID
     * }
     *
     * For SSH terminal:
     * {
     *   "type": "ssh",
     *   "connectionId": 1,  // or "connectionName": "prod-server"
     *   "sessionId": "optional-custom-id"  // Optional: reuse existing session ID
     * }
     */
    @PostMapping("/create")
    public ResponseEntity<?> createTerminal(@RequestBody Map<String, Object> terminalCreateRequest) {
        // Allow optional sessionId in terminalCreateRequest (for session restore)
        String sessionId = terminalCreateRequest.containsKey("sessionId") ?
            (String) terminalCreateRequest.get("sessionId") : UUID.randomUUID().toString();

        String type = (String) terminalCreateRequest.getOrDefault("type", "local");

        try {
            if ("ssh".equalsIgnoreCase(type)) {
                // SSH terminal creation
                Long connectionId = terminalCreateRequest.containsKey("connectionId") ?
                    ((Number)terminalCreateRequest.get("connectionId")).longValue() : null;
                String connectionName = (String)terminalCreateRequest.get("connectionName");

                Map<String, Object> sessionInfo = terminalService.createSshTerminalSession(
                    sessionId, connectionId, connectionName
                );

                log.info("Created SSH terminal session: {} ({})", sessionId, sessionInfo.get("host"));
                return ResponseEntity.ok(sessionInfo);

            } else {
                // Local terminal creation
                String shell = (String) terminalCreateRequest.getOrDefault("shell", "bash");
                Map<String, Object> sessionInfo  = terminalService.createLocalTerminalSession(sessionId, shell);

                log.info("Created local terminal session: {} (shell: {})", sessionId, shell);

                return ResponseEntity.ok(sessionInfo);
            }

        } catch (Exception e) {
            log.error("Failed to create terminal (type={}): {}", type, e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Send input to terminal session
     *
     * POST /terminal/{sessionId}/input
     * {
     *   "data": "ls -la\n"
     * }
     */
    @PostMapping("/{sessionId}/input")
    public ResponseEntity<?> sendInput(@PathVariable String sessionId,
                                       @RequestBody Map<String, String> request) {
        String data = request.get("data");

        log.info("[Input] Session: {}, Data: {}",
                 sessionId,
                 TerminalStringUtils.formatForLogging(data));

        if (!terminalService.isSessionActive(sessionId)) {
            log.warn("[Input] Session {} not active", sessionId);
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Session not found or not active"));
        }

        try {
            terminalService.sendInput(sessionId, data);
            log.debug("[Input] Successfully sent to session {}", sessionId);
            return ResponseEntity.ok(Map.of("status", "sent"));
        } catch (Exception e) {
            log.error("Failed to send input to session {}: {}", sessionId, e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Resize terminal
     *
     * POST /terminal/{sessionId}/resize
     * {
     *   "cols": 120,
     *   "rows": 40
     * }
     */
    @PostMapping("/{sessionId}/resize")
    public ResponseEntity<?> resizeTerminal(@PathVariable String sessionId,
                                            @RequestBody Map<String, Object> request) {
        // Safely extract cols and rows (they might be Integer, Long, or Double from JSON)
        Object colsObj = request.get("cols");
        Object rowsObj = request.get("rows");

        if (colsObj == null || rowsObj == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "cols and rows are required"));
        }

        int cols = ((Number) colsObj).intValue();
        int rows = ((Number) rowsObj).intValue();

        if (!terminalService.isSessionActive(sessionId)) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Session not found or not active"));
        }

        try {
            terminalService.resize(sessionId, cols, rows);
            log.debug("[Resize] Session {} resized to {}x{}", sessionId, cols, rows);
            return ResponseEntity.ok(Map.of("status", "resized", "cols", cols, "rows", rows));
        } catch (Exception e) {
            log.error("Failed to resize terminal {}: {}", sessionId, e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Close terminal session
     *
     * DELETE /terminal/{sessionId}
     */
    @DeleteMapping("/{sessionId}")
    public ResponseEntity<?> closeSession(@PathVariable String sessionId) {
        log.info("[Controller] Received close request for session: {}", sessionId);

        try {
            // Service handles both session closure and database update
            terminalService.closeSession(sessionId);

            log.info("[Controller] Successfully closed terminal session: {}", sessionId);

            return ResponseEntity.ok(Map.of("status", "closed", "sessionId", sessionId));
        } catch (Exception e) {
            log.error("[Controller] Failed to close session {}: {}", sessionId, e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getMessage(), "sessionId", sessionId));
        }
    }

    /**
     * Get all active sessions
     *
     * GET /terminal/sessions
     */
    @GetMapping("/sessions")
    public ResponseEntity<List<TerminalSession>> getAllSessions() {
        return ResponseEntity.ok(terminalService.getAllActiveSessions());
    }

    /**
     * Get session info
     *
     * GET /terminal/{sessionId}
     *
     * Returns session info only if it's ACTIVE IN MEMORY.
     * If session exists in DB but not in memory (e.g., after backend restart),
     * marks it as closed in DB and returns 404.
     */
    @GetMapping("/{sessionId}")
    public ResponseEntity<?> getSession(@PathVariable String sessionId) {
        // Check if session is active in memory
        if (!terminalService.isSessionActive(sessionId)) {
            log.debug("[GetSession] Session {} not active in memory, checking DB...", sessionId);

            // Session not in memory - check if it's stale in DB
            terminalService.getSessionById(sessionId).ifPresent(dbSession -> {
                if ("active".equals(dbSession.getStatus())) {
                    // Stale session - mark as closed in DB
                    log.info("[GetSession] Marking stale session {} as closed in DB", sessionId);
                    dbSession.setStatus("closed");
                    dbSession.setClosedAt(java.time.LocalDateTime.now());
                    terminalService.updateSession(dbSession);
                }
            });

            return ResponseEntity.notFound().build();
        }

        // Session is active in memory - return DB info
        return terminalService.getSessionById(sessionId)
            .map(session -> ResponseEntity.ok((Object)session))
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Update tab metadata (name, icon, order) for session persistence
     *
     * PATCH /terminal/{sessionId}/metadata
     * {
     *   "tabName": "Production Server",
     *   "tabIcon": "🌐",
     *   "tabOrder": 1,
     *   "autoRestore": true
     * }
     */
    @PatchMapping("/{sessionId}/metadata")
    public ResponseEntity<?> updateTabMetadata(@PathVariable String sessionId,
                                                @RequestBody Map<String, Object> metadata) {
        try {
            terminalService.updateTabMetadata(sessionId, metadata);
            return ResponseEntity.ok(Map.of("status", "updated", "sessionId", sessionId));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Failed to update tab metadata for session {}: {}", sessionId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ========== Terminal Sharing ==========

    /**
     * Share a terminal session
     *
     * POST /terminal/{sessionId}/share
     * {
     *   "source": "agent-xyz-123"  // Optional: agent name sharing this terminal
     * }
     */
    @PostMapping("/{sessionId}/share")
    public ResponseEntity<?> shareTerminal(@PathVariable String sessionId,
                                           @RequestBody(required = false) Map<String, String> request) {
        try {
            String source = request != null ? request.get("source") : null;
            terminalService.shareTerminal(sessionId, source);
            log.info("[Share] Terminal session {} is now shared (source: {})", sessionId, source);
            return ResponseEntity.ok(Map.of(
                "status", "shared",
                "sessionId", sessionId,
                "source", source != null ? source : ""
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("[Share] Failed to share terminal {}: {}", sessionId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Unshare a terminal session
     *
     * DELETE /terminal/{sessionId}/share
     */
    @DeleteMapping("/{sessionId}/share")
    public ResponseEntity<?> unshareTerminal(@PathVariable String sessionId) {
        try {
            terminalService.unshareTerminal(sessionId);
            log.info("[Share] Terminal session {} is no longer shared", sessionId);
            return ResponseEntity.ok(Map.of(
                "status", "unshared",
                "sessionId", sessionId
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("[Share] Failed to unshare terminal {}: {}", sessionId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ========== SSH Connection Management ==========

    /**
     * Get all SSH connections
     *
     * GET /terminal/ssh-connections
     * GET /terminal/ssh-connections?includeCredentials=true  (for export/backup)
     *
     * @param includeCredentials If true, includes passwords and private keys (for export only)
     */
    @GetMapping("/ssh-connections")
    public ResponseEntity<?> getAllSshConnections(
            @RequestParam(value = "includeCredentials", required = false, defaultValue = "false") boolean includeCredentials) {

        if (includeCredentials) {
            log.warn("[SSH] Retrieving SSH connections WITH credentials (export mode)");
            return ResponseEntity.ok(terminalService.getAllSshConnectionsWithCredentials());
        } else {
            return ResponseEntity.ok(terminalService.getAllSshConnections());
        }
    }

    /**
     * Get SSH connection by ID
     *
     * GET /terminal/ssh-connections/{id}
     */
    @GetMapping("/ssh-connections/{id}")
    public ResponseEntity<?> getSshConnection(@PathVariable Long id) {
        return terminalService.getSshConnectionById(id)
            .map(conn -> ResponseEntity.ok((Object)conn))
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get SSH connection by name
     *
     * GET /terminal/ssh-connections/by-name/{name}
     */
    @GetMapping("/ssh-connections/by-name/{name}")
    public ResponseEntity<?> getSshConnectionByName(@PathVariable String name) {
        return terminalService.getSshConnectionByName(name)
            .map(conn -> ResponseEntity.ok((Object)conn))
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Create SSH connection
     *
     * POST /terminal/ssh-connections
     */
    @PostMapping("/ssh-connections")
    public ResponseEntity<?> createSshConnection(@RequestBody SshConnection connection) {
        try {
            SshConnection saved = terminalService.createSshConnection(connection);
            return ResponseEntity.ok(saved);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to create SSH connection: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Update SSH connection
     *
     * PUT /terminal/ssh-connections/{id}
     */
    @PutMapping("/ssh-connections/{id}")
    public ResponseEntity<?> updateSshConnection(@PathVariable Long id,
                                                  @RequestBody SshConnection connection) {
        try {
            SshConnection updated = terminalService.updateSshConnection(id, connection);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Failed to update SSH connection: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Delete SSH connection
     *
     * DELETE /terminal/ssh-connections/{id}
     */
    @DeleteMapping("/ssh-connections/{id}")
    public ResponseEntity<?> deleteSshConnection(@PathVariable Long id) {
        try {
            terminalService.deleteSshConnection(id);
            return ResponseEntity.ok(Map.of("status", "deleted"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Failed to delete SSH connection: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Test SSH connection credentials
     *
     * POST /terminal/ssh-connections/test
     * {
     *   "host": "example.com",
     *   "port": 22,
     *   "username": "admin",
     *   "password": "secret",
     *   "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n..."
     * }
     */
    @PostMapping("/ssh-connections/test")
    public ResponseEntity<SshTestResponse> testSshConnection(@RequestBody SshTestRequest request) {
        try {
            log.info("[SSH Test] Testing connection to {}@{}:{}",
                     request.getUsername(), request.getHost(), request.getPort());

            SshTestResponse response = terminalService.testSshConnection(
                request.getHost(),
                request.getPort(),
                request.getUsername(),
                request.getPassword(),
                request.getPrivateKey()
            );

            if (response.isSuccess()) {
                log.info("[SSH Test] Connection successful: {}@{}:{}",
                         request.getUsername(), request.getHost(), request.getPort());
                return ResponseEntity.ok(response);
            } else {
                log.warn("[SSH Test] Connection failed: {}", response.getError());
                return ResponseEntity.badRequest().body(response);
            }

        } catch (Exception e) {
            log.error("[SSH Test] Unexpected error: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(SshTestResponse.failure("Unexpected error: " + e.getMessage()));
        }
    }
}

