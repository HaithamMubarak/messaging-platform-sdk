package com.hmdev.sdk.local.service;

import com.jcraft.jsch.*;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * SSH terminal session implementation using JSch
 * Handles remote SSH connections with password or key authentication
 */
@Slf4j
public class SshTerminalSession implements ITerminalSession {

    private final String sessionId;
    private final Session jschSession;
    private final ChannelShell channel;
    private InputStream inputStream;
    private OutputStream outputStream;

    /**
     * Create SSH terminal session
     *
     * @param sessionId Session identifier
     * @param host SSH host
     * @param port SSH port
     * @param username SSH username
     * @param password SSH password (optional if using key)
     * @param privateKey SSH private key (optional if using password)
     * @throws JSchException if SSH connection fails
     * @throws IOException if channel setup fails
     */
    public SshTerminalSession(String sessionId, String host, int port, String username,
                              String password, String privateKey) throws JSchException, IOException {
        this.sessionId = sessionId;

        JSch jsch = new JSch();

        // Add private key if provided
        if (privateKey != null && !privateKey.isEmpty()) {
            try {
                jsch.addIdentity("key", privateKey.getBytes(StandardCharsets.UTF_8), null, null);
                log.info("[SshTerminal-{}] Using SSH key authentication", sessionId);
            } catch (JSchException e) {
                log.error("[SshTerminal-{}] Failed to add SSH key: {}", sessionId, e.getMessage());
                throw e;
            }
        }

        // Create session
        this.jschSession = jsch.getSession(username, host, port);

        // Set password if provided
        if (password != null && !password.isEmpty()) {
            jschSession.setPassword(password);
            log.info("[SshTerminal-{}] Using password authentication", sessionId);
        }

        // Skip host key checking (not recommended for production!)
        jschSession.setConfig("StrictHostKeyChecking", "no");

        // Connect session
        jschSession.connect(30000);  // 30 second timeout
        log.info("[SshTerminal-{}] SSH session connected to {}@{}:{}", sessionId, username, host, port);

        // Open shell channel
        this.channel = (ChannelShell) jschSession.openChannel("shell");

        // Set PTY settings for proper terminal emulation
        channel.setPtyType("xterm-256color");
        channel.setPtySize(80, 24, 640, 480);  // Default size: 80x24

        log.info("[SshTerminal-{}] SSH channel created", sessionId);
    }

    @Override
    public boolean open() {
        try {
            if (!channel.isConnected()) {
                // CRITICAL: Get streams BEFORE connecting!
                this.inputStream = channel.getInputStream();
                this.outputStream = channel.getOutputStream();

                // Now connect the channel
                channel.connect(10000);  // 10 second timeout
                log.info("[SshTerminal-{}] SSH channel connected (streams initialized)", sessionId);
            }
            return channel.isConnected();
        } catch (Exception e) {
            log.error("[SshTerminal-{}] Failed to connect channel: {}", sessionId, e.getMessage(), e);
            return false;
        }
    }

    @Override
    public InputStream getInputStream() {
        if (inputStream == null) {
            try {
                // Fallback: get stream if not already obtained
                inputStream = channel.getInputStream();
            } catch (IOException e) {
                log.error("[SshTerminal-{}] Failed to get input stream: {}", sessionId, e.getMessage());
                throw new RuntimeException("Failed to get input stream", e);
            }
        }
        return inputStream;
    }

    @Override
    public void sendInput(String data) {
        try {
            if (outputStream == null) {
                // Fallback: get stream if not already obtained
                log.warn("[SshTerminal-{}] Output stream was null, attempting to get it", sessionId);
                outputStream = channel.getOutputStream();
            }

            if (!channel.isConnected()) {
                log.error("[SshTerminal-{}] Channel is not connected, cannot send input", sessionId);
                throw new RuntimeException("SSH channel is not connected");
            }

            log.debug("[SshTerminal-{}] Sending input: {} bytes: '{}'", sessionId, data.length(),
                     data.replace("\r", "\\r").replace("\n", "\\n"));

            outputStream.write(data.getBytes(StandardCharsets.UTF_8));
            outputStream.flush();

            log.debug("[SshTerminal-{}] Input sent and flushed successfully", sessionId);
        } catch (IOException e) {
            log.error("[SshTerminal-{}] Failed to send input: {}", sessionId, e.getMessage(), e);
            throw new RuntimeException("Failed to send input", e);
        }
    }

    @Override
    public void onResize(int cols, int rows) {
        try {
            channel.setPtySize(cols, rows, cols * 8, rows * 16);
            log.debug("[SshTerminal-{}] Resized to {}x{}", sessionId, cols, rows);
        } catch (Exception e) {
            log.warn("[SshTerminal-{}] Failed to resize: {}", sessionId, e.getMessage());
        }
    }

    @Override
    public boolean close() {
        log.info("[SshTerminal-{}] Starting close operation", sessionId);
        boolean success = true;

        // Disconnect channel
        if (channel != null) {
            if (channel.isConnected()) {
                try {
                    log.info("[SshTerminal-{}] Disconnecting channel...", sessionId);
                    channel.disconnect();
                    log.info("[SshTerminal-{}] Channel disconnected successfully", sessionId);
                } catch (Exception e) {
                    log.error("[SshTerminal-{}] Error disconnecting channel: {}", sessionId, e.getMessage(), e);
                    success = false;
                }
            } else {
                log.info("[SshTerminal-{}] Channel already disconnected", sessionId);
            }
        } else {
            log.warn("[SshTerminal-{}] Channel is null", sessionId);
        }

        // Disconnect session
        if (jschSession != null) {
            if (jschSession.isConnected()) {
                try {
                    log.info("[SshTerminal-{}] Disconnecting session...", sessionId);
                    jschSession.disconnect();
                    log.info("[SshTerminal-{}] Session disconnected successfully", sessionId);
                } catch (Exception e) {
                    log.error("[SshTerminal-{}] Error disconnecting session: {}", sessionId, e.getMessage(), e);
                    success = false;
                }
            } else {
                log.info("[SshTerminal-{}] Session already disconnected", sessionId);
            }
        } else {
            log.warn("[SshTerminal-{}] Session is null", sessionId);
        }

        log.info("[SshTerminal-{}] Close operation completed (success={})", sessionId, success);
        return success;
    }

    /**
     * Check if SSH session needs manual echo (SSH servers handle echo, so NO)
     */
    @Override
    public boolean needsManualEcho() {
        return false;  // SSH servers echo naturally
    }

    /**
     * Check if connection is still alive
     */
    @Override
    public boolean isAlive() {
        return channel != null && channel.isConnected() && jschSession != null && jschSession.isConnected();
    }

    /**
     * Get session ID
     */
    @Override
    public String getSessionId() {
        return sessionId;
    }
}

