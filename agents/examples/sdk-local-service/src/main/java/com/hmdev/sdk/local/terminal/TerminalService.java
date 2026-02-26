package com.hmdev.sdk.local.terminal;

import com.hmdev.messaging.common.CommonUtils;
import com.hmdev.sdk.local.dto.SshTestResponse;
import com.hmdev.sdk.local.model.SshConnection;
import com.hmdev.sdk.local.model.TerminalSession;
import com.hmdev.sdk.local.repository.SshConnectionRepository;
import com.hmdev.sdk.local.repository.TerminalSessionRepository;
import com.hmdev.sdk.local.terminal.util.TerminalStringUtils;
import com.jcraft.jsch.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.*;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
@RequiredArgsConstructor
public class TerminalService {

    // Unified session storage using ITerminalSession interface
    private final Map<String, ITerminalSession> sessions = new ConcurrentHashMap<>();

    // Track shell type per session for output cleaning decisions
    private final Map<String, String> sessionShells = new ConcurrentHashMap<>();

    // Repository dependencies
    private final TerminalSessionRepository sessionRepository;
    private final SshConnectionRepository sshConnectionRepository;

    /**
     * Create local terminal session using ProcessBuilder
     *
     * @param sessionId Unique session identifier
     * @param shell     Shell to spawn (cmd, powershell, bash, etc.)
     * @return
     * @throws IOException if terminal cannot be started
     */
    public Map<String, Object> createLocalTerminalSession(String sessionId, String shell) throws IOException {
        LocalTerminalSession session = new LocalTerminalSession(sessionId, shell);

        // Open the session (already opened in constructor, but call for consistency)
        if (!session.open()) {
            throw new IOException("Failed to open local terminal session");
        }

        sessions.put(sessionId, session);
        sessionShells.put(sessionId, shell);  // Track shell type for output cleaning

        // Save to database
        TerminalSession dbSession = new TerminalSession();
        dbSession.setSessionId(sessionId);
        dbSession.setType("local");
        dbSession.setShell(shell);
        dbSession.setStatus("active");
        dbSession.setCreatedAt(LocalDateTime.now());

        // Set default tab metadata
        dbSession.setTabName("Local (" + shell.toUpperCase() + ")");
        dbSession.setTabIcon(getIconForShell(shell));
        dbSession.setAutoRestore(true);

        sessionRepository.save(dbSession);
        
        log.info("[TerminalService] Local terminal session created: {} (shell: {})", sessionId, shell);

        return Map.of(
                "sessionId", sessionId,
                "type", "local",
                "shell", shell,
                "status", "active"
        );
    }

    /**
     * Create SSH terminal session
     *
     * @param sessionId Unique session identifier
     * @param host SSH host
     * @param port SSH port
     * @param username SSH username
     * @param password SSH password (optional if using key)
     * @param privateKey SSH private key (optional if using password)
     * @param sshConnectionId SSH connection ID (for tracking)
     * @throws JSchException if SSH connection fails
     * @throws IOException if channel setup fails
     */
    public void createSshTerminalSession(String sessionId, String host, int port,
                          String username, String password, String privateKey, Long sshConnectionId) 
                          throws JSchException, IOException {
        SshTerminalSession session = new SshTerminalSession(sessionId, host, port, username, password, privateKey);

        // Open the session
        if (!session.open()) {
            throw new IOException("Failed to open SSH terminal session");
        }

        sessions.put(sessionId, session);
        
        // Save to database
        TerminalSession dbSession = new TerminalSession();
        dbSession.setSessionId(sessionId);
        dbSession.setType("ssh");
        dbSession.setSshConnectionId(sshConnectionId);
        dbSession.setStatus("active");
        dbSession.setCreatedAt(LocalDateTime.now());

        // Set default tab metadata (will be updated by frontend with connection name)
        dbSession.setTabName(username + "@" + host);  // ✅ Set default SSH tab name
        dbSession.setTabIcon("🌐");
        dbSession.setAutoRestore(true);

        sessionRepository.save(dbSession);
        
        // Update SSH connection last used time
        if (sshConnectionId != null) {
            sshConnectionRepository.findById(sshConnectionId).ifPresent(conn -> {
                conn.setLastUsedAt(LocalDateTime.now());
                sshConnectionRepository.save(conn);
            });
        }
        
        log.info("[TerminalService] SSH terminal session created: {} ({}@{}:{})", sessionId, username, host, port);
    }
    
    /**
     * Create SSH terminal session from saved connection
     *
     * @param sessionId Unique session identifier
     * @param connectionId SSH connection ID (optional)
     * @param connectionName SSH connection name (optional)
     * @return Map containing session info
     * @throws Exception if connection not found or session creation fails
     */
    public Map<String, Object> createSshTerminalSession(String sessionId, Long connectionId, String connectionName) throws Exception {
        // Get SSH connection from database
        Optional<SshConnection> sshConnection = connectionId != null ?
                sshConnectionRepository.findById(connectionId) :
                sshConnectionRepository.findByName(connectionName);

        if (sshConnection.isEmpty()) {
            throw new IllegalArgumentException("SSH connection not found");
        }

        SshConnection conn = sshConnection.get();

        // Create SSH terminal session
        createSshTerminalSession(sessionId, conn.getHost(), conn.getPort(),
                                conn.getUsername(), conn.getPassword(), conn.getPrivateKey(), conn.getId());

        // Return session info
        return Map.of(
            "sessionId", sessionId,
            "type", "ssh",
            "connectionName", conn.getName(),
            "host", conn.getHost(),
            "status", "active"
        );
    }

    /**
     * Send input to terminal (unified for both local and SSH)
     *
     * @param sessionId Session identifier
     * @param data Input data to send
     * @throws IOException if input cannot be sent
     */
    public void sendInput(String sessionId, String data) throws IOException {
        ITerminalSession session = sessions.get(sessionId);
        if (session == null) {
            throw new IOException("Session not found: " + sessionId);
        }

        log.debug("[SendInput] Session: {}, Data: {}",
                  sessionId,
                  TerminalStringUtils.formatForLogging(data));

        session.sendInput(data);
    }

    /**
     * Resize terminal (unified for both local and SSH)
     * Note: Local terminal resizing is not supported with ProcessBuilder (needs PTY)
     *
     * @param sessionId Session identifier
     * @param cols Terminal width in columns
     * @param rows Terminal height in rows
     */
    public void resize(String sessionId, int cols, int rows) {
        ITerminalSession session = sessions.get(sessionId);
        if (session != null) {
            session.onResize(cols, rows);
            log.debug("[Resize] Session: {} resized to {}x{}", sessionId, cols, rows);
        } else {
            log.warn("[Resize] Session not found: {}", sessionId);
        }
    }

    /**
     * Get terminal output stream (for reading output FROM the terminal)
     *
     * @param sessionId Session identifier
     * @return InputStream to read terminal output
     * @throws IOException if session not found or stream cannot be obtained
     */
    public InputStream getTerminalOutputStream(String sessionId) throws IOException {
        ITerminalSession session = sessions.get(sessionId);
        if (session == null) {
            throw new IOException("Session not found: " + sessionId);
        }

        return session.getInputStream();
    }

    /**
     * Check if session is active (unified for both local and SSH)
     *
     * @param sessionId Session identifier
     * @return true if session exists and is active
     */
    public boolean isSessionActive(String sessionId) {
        ITerminalSession session = sessions.get(sessionId);
        if (session == null) {
            return false;
        }

        // Use polymorphic isAlive() method
        return session.isAlive();
    }

    /**
     * Check if session needs manual echo (Windows CMD via ProcessBuilder doesn't echo)
     *
     * @param sessionId Session identifier
     * @return true if session needs manual echo
     */
    public boolean needsManualEcho(String sessionId) {
        ITerminalSession session = sessions.get(sessionId);
        if (session == null) {
            return false;
        }

        // Use polymorphic needsManualEcho() method
        return session.needsManualEcho();
    }

    /**
     * Get the shell type for a session (cmd, powershell, bash, ssh, etc.)
     */
    public String getSessionType(String sessionId) {
        return sessionShells.get(sessionId);
    }

    /**
     * Send Ctrl+C interrupt to terminal session.
     */
    public void sendCtrlC(String sessionId) {
        ITerminalSession session = sessions.get(sessionId);
        if (session != null) {
            session.sendCtrlC();
            log.info("[TerminalService] Sent Ctrl+C to session: {}", sessionId);
        }
    }

    /**
     * Get the echo response for a given input (for manual echo sessions)
     * This simulates terminal echo behavior
     *
     * @param sessionId Session identifier
     * @param input Input character/string
     * @return Echo response string, or null if no echo needed
     */
    public String getEchoResponse(String sessionId, String input) {
        if (!needsManualEcho(sessionId)) {
            return null;  // No manual echo needed
        }

        // Handle special characters
        if (TerminalStringUtils.isNewline(input)) {
            return "\r\n";  // Enter key - echo newline
        } else if (TerminalStringUtils.isTab(input)) {
            // Tab - DON'T echo, let CMD handle auto-completion
            return null;
        } else if (TerminalStringUtils.isBackspace(input)) {
            // Backspace - DON'T echo manually, CMD will handle it
            // This prevents deleting the prompt
            return null;
        } else if (input.equals("\u0003")) {
            return null;  // Ctrl+C - no echo, let CMD handle it
        } else if (input.length() == 1 && Character.isISOControl(input.charAt(0))) {
            // Other control characters - don't echo
            return null;
        } else {
            // Regular character - echo it back
            return input;
        }
    }

    /**
     * Close terminal session (unified for both local and SSH)
     *
     * @param sessionId Session identifier
     */
    public void closeSession(String sessionId) {
        log.info("[TerminalService] Closing session: {}", sessionId);

        ITerminalSession session = sessions.remove(sessionId);
        sessionShells.remove(sessionId);  // Clean up shell type tracking
        if (session != null) {
            log.info("[TerminalService] Found session {}, type: {}", sessionId, session.getClass().getSimpleName());
            boolean closed = session.close();
            if (closed) {
                log.info("[TerminalService] Successfully closed session: {}", sessionId);
            } else {
                log.warn("[TerminalService] Failed to fully close session: {}", sessionId);
            }
        } else {
            log.warn("[TerminalService] Session not found in memory: {}", sessionId);
        }
        
        // Update database
        sessionRepository.findById(sessionId).ifPresentOrElse(
            dbSession -> {
                log.info("[TerminalService] Updating database for session: {}", sessionId);
                dbSession.setStatus("closed");
                dbSession.setClosedAt(LocalDateTime.now());
                sessionRepository.save(dbSession);
                log.info("[TerminalService] Database updated for session: {}", sessionId);
            },
            () -> log.warn("[TerminalService] Session {} not found in database", sessionId)
        );

        log.info("[TerminalService] Close operation completed for session: {}", sessionId);
    }
    
    /**
     * Get all active terminal sessions (only returns sessions that are ALIVE in memory)
     *
     * This prevents restoring tabs for dead SSH connections that are still marked
     * as 'active' in the database. If a session exists in DB but not in memory,
     * it gets marked as 'closed' automatically.
     *
     * @return List of active sessions that are actually running
     */
    public List<TerminalSession> getAllActiveSessions() {
        List<TerminalSession> dbSessions = sessionRepository.findByStatus("active");

        // Filter out sessions that are NOT alive in memory
        List<TerminalSession> aliveSessions = dbSessions.stream()
            .filter(dbSession -> {
                String sessionId = dbSession.getSessionId();
                boolean isAlive = sessions.containsKey(sessionId);

                if (!isAlive) {
                    // Session is in DB but NOT in memory - mark it as closed
                    log.info("[GetActiveSessions] Session {} is dead (not in memory), marking as closed", sessionId);
                    dbSession.setStatus("closed");
                    dbSession.setClosedAt(LocalDateTime.now());
                    sessionRepository.save(dbSession);
                }

                return isAlive;
            })
            .collect(java.util.stream.Collectors.toList());

        log.debug("[GetActiveSessions] Found {} alive sessions out of {} in DB", aliveSessions.size(), dbSessions.size());
        return aliveSessions;
    }
    
    /**
     * Get terminal session by ID
     *
     * @param sessionId Session identifier
     * @return Optional containing session if found
     */
    public Optional<TerminalSession> getSessionById(String sessionId) {
        return sessionRepository.findById(sessionId);
    }

    /**
     * Get the active ITerminalSession by ID
     *
     * @param sessionId Session identifier
     * @return ITerminalSession or null if not found
     */
    public ITerminalSession getSession(String sessionId) {
        return sessions.get(sessionId);
    }

    /**
     * Update tab metadata for session persistence
     *
     * @param sessionId Session identifier
     * @param metadata Map containing tabName, tabIcon, tabOrder, autoRestore
     */
    public void updateTabMetadata(String sessionId, Map<String, Object> metadata) {
        TerminalSession session = sessionRepository.findById(sessionId)
            .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        String tabName =
                CommonUtils.checkMapKey(metadata, "tabName", String.class);
        if (tabName != null) {
            session.setTabName(tabName);
        }

        String tabIcon =
                CommonUtils.checkMapKey(metadata, "tabIcon", String.class);
        if (tabIcon != null) {
            session.setTabIcon(tabIcon);
        }

        Number tabOrder =
                CommonUtils.checkMapKey(metadata, "tabIcon", Number.class);
        if (tabOrder != null) {
            session.setTabOrder(tabOrder.intValue());
        }

        Boolean autoRestore =
                CommonUtils.checkMapKey(metadata, "autoRestore", Boolean.class);
        if (autoRestore != null) {
            session.setAutoRestore(autoRestore);
        }

        sessionRepository.save(session);
        log.info("[TerminalService] Updated tab metadata for session: {}", sessionId);
    }

    /**
     * Update terminal session in database
     *
     * @param session TerminalSession entity to update
     */
    public void updateSession(TerminalSession session) {
        sessionRepository.save(session);
        log.info("[TerminalService] Updated session in database: {}", session.getSessionId());
    }

    // ========== SSH Connection Management ==========

    /**
     * Get all SSH connections (without sensitive data)
     */
    public List<SshConnection> getAllSshConnections() {
        List<SshConnection> connections = sshConnectionRepository.findAll();
        // Remove sensitive data
        connections.forEach(conn -> {
            conn.setPassword(null);
            conn.setPrivateKey(null);
        });
        return connections;
    }

    /**
     * Get SSH connection by ID (without sensitive data)
     */
    public Optional<SshConnection> getSshConnectionById(Long id) {
        return sshConnectionRepository.findById(id)
            .map(conn -> {
                conn.setPassword(null);
                conn.setPrivateKey(null);
                return conn;
            });
    }

    /**
     * Get SSH connection by ID with credentials (for internal use only)
     * WARNING: Contains sensitive data - do not expose via API
     */
    public Optional<SshConnection> getSshConnectionByIdWithCredentials(Long id) {
        return sshConnectionRepository.findById(id);
    }

    /**
     * Get SSH connection by name (without sensitive data)
     */
    public Optional<SshConnection> getSshConnectionByName(String name) {
        return sshConnectionRepository.findByName(name)
            .map(conn -> {
                conn.setPassword(null);
                conn.setPrivateKey(null);
                return conn;
            });
    }

    /**
     * Create new SSH connection
     */
    public SshConnection createSshConnection(SshConnection connection) {
        // Validation
        if (connection.getName() == null || connection.getName().isEmpty()) {
            throw new IllegalArgumentException("Name is required");
        }

        if (sshConnectionRepository.existsByName(connection.getName())) {
            throw new IllegalArgumentException("Connection with this name already exists");
        }

        if (connection.getHost() == null || connection.getHost().isEmpty()) {
            throw new IllegalArgumentException("Host is required");
        }

        if (connection.getUsername() == null || connection.getUsername().isEmpty()) {
            throw new IllegalArgumentException("Username is required");
        }

        // Set defaults
        if (connection.getPort() == null) {
            connection.setPort(22);
        }

        connection.setCreatedAt(LocalDateTime.now());
        connection.setUpdatedAt(LocalDateTime.now());

        SshConnection saved = sshConnectionRepository.save(connection);
        log.info("[TerminalService] Created SSH connection: {} ({}@{}:{})",
                 saved.getName(), saved.getUsername(), saved.getHost(), saved.getPort());

        // Remove sensitive data before returning
        saved.setPassword(null);
        saved.setPrivateKey(null);

        return saved;
    }

    /**
     * Update SSH connection
     */
    public SshConnection updateSshConnection(Long id, SshConnection updated) {
        SshConnection existing = sshConnectionRepository.findById(id)
            .orElseThrow(() -> new IllegalArgumentException("SSH connection not found"));

        // Update fields
        if (updated.getName() != null) {
            if (sshConnectionRepository.existsByName(updated.getName()) &&
                !existing.getName().equals(updated.getName())) {
                throw new IllegalArgumentException("Name already taken");
            }
            existing.setName(updated.getName());
        }

        if (updated.getHost() != null) existing.setHost(updated.getHost());
        if (updated.getPort() != null) existing.setPort(updated.getPort());
        if (updated.getUsername() != null) existing.setUsername(updated.getUsername());
        if (updated.getPassword() != null) existing.setPassword(updated.getPassword());
        if (updated.getPrivateKey() != null) existing.setPrivateKey(updated.getPrivateKey());
        if (updated.getDescription() != null) existing.setDescription(updated.getDescription());

        existing.setUpdatedAt(LocalDateTime.now());

        SshConnection saved = sshConnectionRepository.save(existing);
        log.info("[TerminalService] Updated SSH connection: {}", saved.getName());

        // Remove sensitive data
        saved.setPassword(null);
        saved.setPrivateKey(null);

        return saved;
    }

    /**
     * Delete SSH connection
     */
    public void deleteSshConnection(Long id) {
        if (!sshConnectionRepository.existsById(id)) {
            throw new IllegalArgumentException("SSH connection not found");
        }
        sshConnectionRepository.deleteById(id);
        log.info("[TerminalService] Deleted SSH connection: {}", id);
    }

    /**
     * Test SSH connection credentials
     *
     * @param host SSH host
     * @param port SSH port
     * @param username SSH username
     * @param password SSH password (optional)
     * @param privateKey SSH private key (optional)
     * @return SshTestResponse with connection status
     */
    public SshTestResponse testSshConnection(String host, Integer port, String username,
                                             String password, String privateKey) {
        JSch jsch = new JSch();
        Session session = null;

        try {
            log.info("[SSH Test] Attempting to connect to {}@{}:{}", username, host, port);

            // Create JSch session
            session = jsch.getSession(username, host, port != null ? port : 22);

            // Set authentication
            if (privateKey != null && !privateKey.trim().isEmpty()) {
                // Use private key authentication
                try {
                    jsch.addIdentity("key", privateKey.getBytes(), null, null);
                    log.debug("[SSH Test] Using private key authentication");
                } catch (JSchException e) {
                    log.error("[SSH Test] Invalid private key format: {}", e.getMessage());
                    return SshTestResponse.failure("Invalid private key format: " + e.getMessage());
                }
            } else if (password != null && !password.isEmpty()) {
                // Use password authentication
                session.setPassword(password);
                log.debug("[SSH Test] Using password authentication");
            } else {
                return SshTestResponse.failure("Either password or private key is required");
            }

            // Configure session
            session.setConfig("StrictHostKeyChecking", "no");
            session.setConfig("PreferredAuthentications", privateKey != null ? "publickey" : "password");
            session.setTimeout(10000); // 10 second timeout

            // Attempt connection
            session.connect();

            // Get server version
            String serverVersion = session.getServerVersion();
            log.info("[SSH Test] Successfully connected. Server version: {}", serverVersion);

            return SshTestResponse.success(host, port, username, serverVersion);

        } catch (JSchException e) {
            String errorMsg = e.getMessage();
            log.warn("[SSH Test] Connection failed: {}", errorMsg);

            // Provide user-friendly error messages
            if (errorMsg.contains("Auth fail")) {
                return SshTestResponse.failure("Authentication failed: Invalid credentials");
            } else if (errorMsg.contains("timeout") || errorMsg.contains("Connection timed out")) {
                return SshTestResponse.failure("Connection timeout: Unable to reach host");
            } else if (errorMsg.contains("UnknownHostException")) {
                return SshTestResponse.failure("Unknown host: Cannot resolve hostname");
            } else if (errorMsg.contains("Connection refused")) {
                return SshTestResponse.failure("Connection refused: SSH service may not be running");
            } else {
                return SshTestResponse.failure("Connection failed: " + errorMsg);
            }

        } catch (Exception e) {
            log.error("[SSH Test] Unexpected error: {}", e.getMessage(), e);
            return SshTestResponse.failure("Unexpected error: " + e.getMessage());

        } finally {
            // Always disconnect
            if (session != null && session.isConnected()) {
                session.disconnect();
                log.debug("[SSH Test] Session disconnected");
            }
        }
    }

    // ========== Terminal Sharing ==========

    /**
     * Share a terminal session
     *
     * @param sessionId Session identifier
     * @param source Agent name sharing this terminal (optional)
     */
    public void shareTerminal(String sessionId, String source) {
        TerminalSession session = sessionRepository.findById(sessionId)
            .orElseThrow(() -> new IllegalArgumentException("Terminal session not found"));

        session.setIsShared(true);
        session.setSource(source);

        sessionRepository.save(session);
        log.info("[TerminalService] Terminal session {} is now shared (source: {})", sessionId, source);
    }

    /**
     * Unshare a terminal session
     *
     * @param sessionId Session identifier
     */
    public void unshareTerminal(String sessionId) {
        TerminalSession session = sessionRepository.findById(sessionId)
            .orElseThrow(() -> new IllegalArgumentException("Terminal session not found"));

        session.setIsShared(false);
        session.setSource(null);

        sessionRepository.save(session);
        log.info("[TerminalService] Terminal session {} is no longer shared", sessionId);
    }

    /**
     * Get icon emoji for shell type
     */
    private String getIconForShell(String shell) {
        if (shell == null) return "💻";
        switch (shell.toLowerCase()) {
            case "bash":
                return "🐧";
            case "powershell":
                return "⚡";
            case "cmd":
            default:
                return "💻";
        }
    }
}

