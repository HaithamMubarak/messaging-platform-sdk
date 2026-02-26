package com.hmdev.sdk.local.terminal.websocket;

import com.hmdev.sdk.local.terminal.TerminalService;
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
    private final Map<String, Set<WebSocketSession>> sessionClients = new ConcurrentHashMap<>();
    private final Map<String, Boolean> streamingThreads = new ConcurrentHashMap<>();

    // Track input buffer per session to handle backspace correctly
    private final Map<String, StringBuilder> inputBuffers = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String sessionId = extractSessionId(session);

        if (sessionId == null) {
            log.warn("WebSocket connection without sessionId");
            session.close(CloseStatus.BAD_DATA);
            return;
        }

        // Add client to session
        sessionClients.computeIfAbsent(sessionId, k -> ConcurrentHashMap.newKeySet()).add(session);

        log.info("WebSocket connected: {} -> terminal session: {}", session.getId(), sessionId);

        // Start streaming output (only once per session)
        if (streamingThreads.putIfAbsent(sessionId, true) == null) {
            log.info("Starting output streaming for session: {}", sessionId);
            startOutputStreaming(sessionId);
        } else {
            log.info("Output streaming already active for session: {}", sessionId);
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
        log.debug("[WebSocket-Input] Session: {}, Data: {}",
                 sessionId,
                 TerminalStringUtils.formatForLogging(data));

        try {
            // Check if terminal needs manual echo (Windows CMD in pipe mode)
            boolean needsEcho = terminalService.needsManualEcho(sessionId);

            // Get or create input buffer for this session
            StringBuilder inputBuffer = inputBuffers.computeIfAbsent(sessionId, k -> new StringBuilder());

            if (needsEcho) {
                // Manual echo for Windows CMD
                if (TerminalStringUtils.isCtrlC(data)) {
                    // Ctrl+C - interrupt running process
                    inputBuffer.setLength(0);  // Clear input buffer
                    broadcast(sessionId, "^C\r\n");
                    terminalService.sendCtrlC(sessionId);
                    return;
                } else if (TerminalStringUtils.isBackspace(data)) {
                    // Backspace - only process if we have characters to delete
                    if (inputBuffer.length() > 0) {
                        inputBuffer.deleteCharAt(inputBuffer.length() - 1);
                        // Echo backspace visually
                        broadcast(sessionId, "\b \b");
                        // Send actual backspace to CMD to delete the character from its input
                        terminalService.sendInput(sessionId, "\b");
                    }
                    // If buffer is empty, don't do anything (prevents deleting prompt)
                    return; // Don't send backspace again below
                } else if (TerminalStringUtils.isNewline(data)) {
                    // Enter key - log the complete command, then send to CMD
                    String command = inputBuffer.toString().trim();
                    log.info("[COMMAND] Session: {}, Command: '{}'", sessionId, command);

                    // Handle CLS command manually for Windows CMD
                    if (TerminalStringUtils.isClearScreenCommand(command)) {
                        // Clear the buffer
                        inputBuffer.setLength(0);
                        // Send ANSI clear screen sequence
                        broadcast(sessionId, TerminalStringUtils.getClearScreenSequence());
                        // Don't send to CMD - we handled it
                        return;
                    }

                    // Clear the buffer for next command
                    inputBuffer.setLength(0);
                    // Echo newline
                    broadcast(sessionId, "\r\n");
                } else if (TerminalStringUtils.isTab(data)) {
                    // Tab - DON'T echo, let CMD handle auto-completion via output
                    // Don't add to buffer - tab completion is handled by CMD
                } else if (TerminalStringUtils.isSinglePrintableChar(data)) {
                    // Printable ASCII character - add to buffer and echo
                    inputBuffer.append(data);
                    broadcast(sessionId, data);
                }
                // For all other control characters, don't echo or buffer
            } else {
                // For non-manual-echo sessions (SSH, PowerShell, Bash), just track for logging
                if (TerminalStringUtils.isCtrlC(data)) {
                    // Ctrl+C - interrupt running process, clear buffer
                    inputBuffer.setLength(0);
                    terminalService.sendCtrlC(sessionId);
                    return;
                } else if (TerminalStringUtils.isNewline(data)) {
                    String command = inputBuffer.toString();
                    if (!command.isEmpty()) {
                        log.info("[COMMAND] Session: {}, Command: '{}'", sessionId, command);
                    }
                    inputBuffer.setLength(0);
                } else if (TerminalStringUtils.isBackspace(data)) {
                    if (inputBuffer.length() > 0) {
                        inputBuffer.deleteCharAt(inputBuffer.length() - 1);
                    }
                } else if (data.length() == 1 && data.charAt(0) >= 32) {
                    inputBuffer.append(data);
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
                    log.info("[WebSocket] All clients disconnected for session: {}, closing terminal session", sessionId);

                    // Clean up resources
                    sessionClients.remove(sessionId);
                    inputBuffers.remove(sessionId);
                    streamingThreads.remove(sessionId);

                    // Close the terminal session (SSH or local)
                    try {
                        terminalService.closeSession(sessionId);
                        log.info("[WebSocket] Terminal session closed: {}", sessionId);
                    } catch (Exception e) {
                        log.error("[WebSocket] Failed to close terminal session {}: {}", sessionId, e.getMessage());
                    }
                } else {
                    log.info("[WebSocket] Client disconnected, {} client(s) remaining for session: {}", clients.size(), sessionId);
                }
            }
        }

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
     * Broadcast terminal output to all clients connected to this session
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
     * Send a control banner to frontend
     * Banners are special markers that frontend can detect to trigger specific actions
     * @param sessionId Terminal session ID
     * @param banner Banner constant (e.g., BANNER_SSH_DISCONNECTED)
     */
    public void sendControlBanner(String sessionId, String banner) {
        log.info("[Control-{}] Sending banner: {}", sessionId, banner);
        broadcast(sessionId, "\r\n" + banner + "\r\n");
    }

    private String extractSessionId(WebSocketSession session) {
        String path = session.getUri().getPath();
        // Path: /terminal/stream/{sessionId}
        String[] parts = path.split("/");
        return parts.length > 3 ? parts[3] : null;
    }
}

