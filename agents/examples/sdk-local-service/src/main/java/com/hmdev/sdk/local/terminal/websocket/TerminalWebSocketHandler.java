package com.hmdev.sdk.local.terminal.websocket;

import com.hmdev.sdk.local.config.SecurityProperties;
import com.hmdev.sdk.local.terminal.TerminalService;
import com.hmdev.sdk.local.terminal.TerminalTicketService;
import com.hmdev.sdk.local.terminal.util.TerminalStringUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
@RequiredArgsConstructor
@Slf4j
public class TerminalWebSocketHandler extends TextWebSocketHandler {

    // Terminal control banners - used to signal special events to frontend
    // Format: <<BANNER_NAME>> to avoid conflicts with normal terminal output
    // These must match the JavaScript constants in terminal.js
    public static final String BANNER_SSH_DISCONNECTED = "<<SSH_DISCONNECTED>>";
    public static final String BANNER_STREAM_CLOSED = "<<STREAM_CLOSED>>";

    private final TerminalService terminalService;
    private final TerminalTicketService terminalTicketService;
    private final SecurityProperties securityProperties;
    private final Map<String, Set<WebSocketSession>> sessionClients = new ConcurrentHashMap<>();
    private final Map<String, Boolean> streamingThreads = new ConcurrentHashMap<>();

    // Per-WebSocket-client input buffer (keyed by wsSession.getId()).
    // Each browser tab has its own buffer — reconnecting one tab never corrupts another.
    private final Map<String, StringBuilder> inputBuffers = new ConcurrentHashMap<>();

    // Per-terminal-session last partial input (keyed by terminal sessionId).
    // Tracks what was being typed but not yet submitted (not Enter'd yet).
    // Sent to a reconnecting client so they see their in-progress text restored.
    // Cleared on Enter, Ctrl+C, or when the session is deleted.
    private final Map<String, String> lastSessionInput = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String sessionId = extractSessionId(session);

        // The session id in the path is an identifier, not a credential. The
        // ticket is the credential: issued to an authenticated caller, bound to
        // this session, valid for seconds, and spendable once.
        if (sessionId != null && !terminalTicketService.redeem(extractTicket(session), sessionId)) {
            log.warn("[WebSocket] Refused a stream connection with no valid ticket for session {}", sessionId);
            session.close(CloseStatus.POLICY_VIOLATION.withReason("A valid stream ticket is required"));
            return;
        }

        if (sessionId == null) {
            log.warn("WebSocket connection without sessionId");
            session.close(CloseStatus.BAD_DATA);
            return;
        }

        sessionClients.computeIfAbsent(sessionId, k -> ConcurrentHashMap.newKeySet()).add(session);

        log.info("WebSocket connected: {} -> terminal session: {}", session.getId(), sessionId);

        boolean alreadyStreaming = streamingThreads.putIfAbsent(sessionId, true) != null;
        if (!alreadyStreaming) {
            log.info("Starting output streaming for session: {}", sessionId);
            startOutputStreaming(sessionId);
        } else {
            log.info("Output streaming already active for session: {}", sessionId);

            // Reconnect replay: send any partial input that was being typed before disconnect.
            String partial = lastSessionInput.get(sessionId);
            if (partial != null && !partial.isEmpty()) {
                log.info("[Reconnect-{}] Replaying partial input ({} chars)", sessionId, partial.length());
                try {
                    session.sendMessage(new TextMessage(partial));
                } catch (Exception e) {
                    log.warn("[Reconnect-{}] Failed to send partial input replay: {}", sessionId, e.getMessage());
                }
            }
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String sessionId = extractSessionId(session);

        if (sessionId == null) {
            log.warn("Received message without sessionId from WebSocket: {}", session.getId());
            return;
        }

        String data = message.getPayload();
        // Deliberately not logged. This is every keystroke of the session,
        // which includes anything typed at a password prompt. Only the fact of
        // input is recorded, never its content.
        log.trace("[WebSocket-Input] Session: {}, {} chars", sessionId, data.length());

        try {
            boolean needsEcho = terminalService.needsManualEcho(sessionId);

            // Buffer keyed by THIS WebSocket client's ID — not the terminal session ID.
            // Each browser tab gets its own independent input tracking buffer.
            StringBuilder inputBuffer = inputBuffers.computeIfAbsent(session.getId(), k -> new StringBuilder());

            if (needsEcho) {
                // Manual echo for Windows CMD
                if (TerminalStringUtils.isCtrlC(data)) {
                    inputBuffer.setLength(0);
                    lastSessionInput.remove(sessionId);   // ← clear cached input
                    broadcast(sessionId, "^C\r\n");
                    terminalService.sendCtrlC(sessionId);
                    return;
                } else if (TerminalStringUtils.isBackspace(data)) {
                    if (inputBuffer.length() > 0) {
                        inputBuffer.deleteCharAt(inputBuffer.length() - 1);
                        lastSessionInput.put(sessionId, inputBuffer.toString());  // ← sync
                        broadcast(sessionId, "\b \b");
                        terminalService.sendInput(sessionId, "\b");
                    }
                    return;
                } else if (TerminalStringUtils.isNewline(data)) {
                    String command = inputBuffer.toString().trim();
                    // The command text is not logged: it routinely carries
                    // secrets (an inline token, a `mysql -p...`). Audit keeps
                    // the shape of the event, not its content.
                    auditCommand(sessionId, command);
                    inputBuffer.setLength(0);
                    lastSessionInput.remove(sessionId);   // ← clear cached input on Enter

                    if (TerminalStringUtils.isClearScreenCommand(command)) {
                        broadcast(sessionId, TerminalStringUtils.getClearScreenSequence());
                        terminalService.sendInput(sessionId, "\r\n");
                        return;
                    }

                    broadcast(sessionId, "\r\n");
                } else if (TerminalStringUtils.isTab(data)) {
                    // Tab — let CMD handle completion, don't update lastSessionInput
                } else if (TerminalStringUtils.isSinglePrintableChar(data)) {
                    inputBuffer.append(data);
                    lastSessionInput.put(sessionId, inputBuffer.toString());  // ← sync
                    broadcast(sessionId, data);
                }
            } else {
                // Non-echo sessions (SSH, PowerShell, Bash) — track for logging + replay
                if (TerminalStringUtils.isCtrlC(data)) {
                    inputBuffer.setLength(0);
                    lastSessionInput.remove(sessionId);   // ← clear
                    terminalService.sendCtrlC(sessionId);
                    return;
                } else if (TerminalStringUtils.isNewline(data)) {
                    String command = inputBuffer.toString().trim();
                    if (!command.isEmpty()) {
                        log.info("[COMMAND] Session: {}, Command: '{}'", sessionId, command);
                    }
                    inputBuffer.setLength(0);
                    lastSessionInput.remove(sessionId);   // ← clear on Enter

                    if (TerminalStringUtils.isClearScreenCommand(command)) {
                        broadcast(sessionId, TerminalStringUtils.getClearScreenSequence());
                        // fall through — let the shell run cls/clear too
                    }
                } else if (TerminalStringUtils.isBackspace(data)) {
                    if (inputBuffer.length() > 0) {
                        inputBuffer.deleteCharAt(inputBuffer.length() - 1);
                        lastSessionInput.put(sessionId, inputBuffer.toString());  // ← sync
                    }
                } else if (data.length() == 1 && data.charAt(0) >= 32) {
                    inputBuffer.append(data);
                    lastSessionInput.put(sessionId, inputBuffer.toString());  // ← sync
                }
            }

            // Send input to process (CMD will process it and output results)
            terminalService.sendInput(sessionId, data);
            log.debug("[WebSocket-Input] Successfully sent to session {}", sessionId);
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";

            // Check for SSH channel disconnection - this is a critical error
            // Send simple banner that frontend can detect
            if (msg.contains("SSH channel is not connected") || msg.contains("channel is not connected")) {
                log.error("[WebSocket-Input] SSH channel disconnected for session {}: {}", sessionId, msg);
                // Send banner to frontend - frontend will check if session is still alive
                // to avoid false alarms (e.g., if banner appears in file content)
                broadcast(sessionId, "\r\n" + BANNER_SSH_DISCONNECTED + "\r\n");
                return;
            }

            // Silently ignore transient errors from Ctrl+C or broken pipe
            if (msg.contains("pipe") || msg.contains("stream") || msg.contains("closed")
                    || msg.contains("Failed to send input")) {
                log.debug("[WebSocket-Input] Suppressed transient error for session {}: {}", sessionId, msg);
                return;
            }

            // Log other errors but don't send control messages - they're not critical
            log.error("[WebSocket-Input] Failed to send input to session {}: {}", sessionId, msg, e);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String sessionId = extractSessionId(session);

        if (sessionId != null) {
            Set<WebSocketSession> clients = sessionClients.get(sessionId);
            if (clients != null) {
                clients.remove(session);
                if (clients.isEmpty()) {
                    log.info("[WebSocket] All clients disconnected for session: {}", sessionId);
                    log.info("[WebSocket] Session {} will remain active until user explicitly closes tab", sessionId);
                    sessionClients.remove(sessionId);
                    // NOTE: lastSessionInput is intentionally kept alive here.
                    // If the user refreshes and reconnects, we replay the partial input.
                    // It is only cleaned up when the terminal session itself is deleted.

                } else {
                    log.info("[WebSocket] Client disconnected, {} client(s) remaining for session: {}", clients.size(), sessionId);
                }
            }
        }

        // ✅ Clean up THIS client's input buffer (keyed by WS client ID)
        inputBuffers.remove(session.getId());

        log.info("WebSocket disconnected: {}", session.getId());
    }

    private void startOutputStreaming(String sessionId) {

        new Thread(() -> {
            try {
                log.info("[Stream-{}] Thread started, getting output stream...", sessionId);
                InputStream in = terminalService.getTerminalOutputStream(sessionId);
                log.info("[Stream-{}] Got output stream, starting read loop...", sessionId);

                byte[] buffer = new byte[1024];  // Buffer for reading
                int totalBytes = 0;

                // BLOCKING READ: This will instantly transmit as soon as data is available
                while (terminalService.isSessionActive(sessionId)) {
                    // Blocking read - will return as soon as ANY data is available
                    int bytesRead = in.read(buffer);

                    if (bytesRead > 0) {
                        totalBytes += bytesRead;
                        String output = new String(buffer, 0, bytesRead, StandardCharsets.UTF_8);
                        log.debug("[Stream-{}] Read {} bytes (total: {}): {}",
                                 sessionId, bytesRead, totalBytes,
                                 TerminalStringUtils.escapeControlChars(output));

                        // Clean bash output - strip leading spaces per line (bash only)
                        // Matches JS: cleanOutput(data, shell) in index.html
                        String shell = terminalService.getSessionType(sessionId);
                        output = TerminalStringUtils.cleanOutput(output, shell);

                        // Broadcast immediately - auto-flush!
                        broadcast(sessionId, output);
                    } else if (bytesRead == -1) {
                        // Stream closed - send banner to frontend
                        log.info("[Stream-{}] Stream closed (EOF)", sessionId);
                        broadcast(sessionId, "\r\n" + BANNER_STREAM_CLOSED + "\r\n");
                        break;
                    }
                }

                log.info("[Stream-{}] Stream ended. Total bytes: {}", sessionId, totalBytes);

            } catch (Exception e) {
                log.error("[Stream-{}] Error streaming terminal output: {}", sessionId, e.getMessage(), e);
            } finally {
                streamingThreads.remove(sessionId);
                log.info("[Stream-{}] Streaming thread terminated", sessionId);
            }
        }, "terminal-output-" + sessionId).start();
    }

    /**
     * Broadcast terminal output to all clients connected to this session.
     */
    public void broadcast(String sessionId, String message) {
        Set<WebSocketSession> clients = sessionClients.get(sessionId);
        if (clients == null || clients.isEmpty()) {
            log.warn("[Broadcast-{}] No clients connected", sessionId);
            return;
        }

        log.debug("[Broadcast-{}] Sending to {} client(s): {} bytes",
                 sessionId, clients.size(), message.length());

        clients.forEach(client -> {
            try {
                if (client.isOpen()) {
                    client.sendMessage(new TextMessage(message));
                    log.debug("[Broadcast-{}] Sent to client: {}", sessionId, client.getId());
                } else {
                    log.warn("[Broadcast-{}] Client not open: {}", sessionId, client.getId());
                }
            } catch (Exception e) {
                log.error("[Broadcast-{}] Error sending message to client {}: {}",
                         sessionId, client.getId(), e.getMessage());
            }
        });
    }

    /**
     * Send a control banner to frontend.
     * Banners are special markers that frontend can detect to trigger specific actions.
     * @param sessionId Terminal session ID
     * @param banner Banner constant (e.g., BANNER_SSH_DISCONNECTED)
     */
    public void sendControlBanner(String sessionId, String banner) {
        log.info("[Control-{}] Sending banner: {}", sessionId, banner);
        broadcast(sessionId, "\r\n" + banner + "\r\n");
    }

    /**
     * Clean up all server-side state for a terminal session.
     * Called when the session is explicitly deleted (user clicks X / DELETE API).
     */
    public void cleanupSession(String sessionId) {
        lastSessionInput.remove(sessionId);
        streamingThreads.remove(sessionId);
        Set<WebSocketSession> clients = sessionClients.remove(sessionId);
        if (clients != null) {
            clients.forEach(client -> {
                try { if (client.isOpen()) client.close(); } catch (Exception ignored) {}
            });
        }
        log.info("[Cleanup-{}] Session state cleared", sessionId);
    }

    /**
     * Record that a command ran, without recording what it was.
     *
     * Off unless sls.security.audit-commands=true is set deliberately, and even
     * then it keeps only the shape of the event: which session, how long the
     * line was, and the first token, which is the program name rather than its
     * arguments. That is enough to answer "was anything run in this session"
     * without turning the log into a transcript of everything typed.
     */
    private void auditCommand(String sessionId, String command) {
        if (!securityProperties.isAuditCommands()) {
            return;
        }
        String program = command.isEmpty() ? "" : command.split("\\s+")[0];
        // A program name can itself be a path into someone's home directory.
        if (program.length() > 32) {
            program = program.substring(0, 32) + "...";
        }
        log.info("[AUDIT] session={} programme={} length={}", sessionId, program, command.length());
    }

    /** The ticket travels as ?ticket=... on the socket URL. */
    private String extractTicket(WebSocketSession session) {
        String query = session.getUri() == null ? null : session.getUri().getQuery();
        if (query == null) {
            return null;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && "ticket".equals(pair.substring(0, eq))) {
                return java.net.URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    private String extractSessionId(WebSocketSession session) {
        String path = session.getUri().getPath();
        // Path: /terminal/stream/{sessionId}
        String[] parts = path.split("/");
        return parts.length > 3 ? parts[3] : null;
    }
}

