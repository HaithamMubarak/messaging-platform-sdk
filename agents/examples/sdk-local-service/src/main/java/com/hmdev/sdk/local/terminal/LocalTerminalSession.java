package com.hmdev.sdk.local.terminal;

import com.hmdev.sdk.local.terminal.config.ShellConfig;
import lombok.extern.slf4j.Slf4j;

import java.io.*;
import java.nio.charset.StandardCharsets;

/**
 * Local terminal session implementation using ProcessBuilder
 * Handles CMD, PowerShell, bash, etc.
 * Uses unified ShellConfig for consistency
 */
@Slf4j
public class LocalTerminalSession implements ITerminalSession {

    private final String sessionId;
    private final Process process;
    private final boolean needsManualEcho;  // Windows CMD in pipe mode DOES NOT echo!

    /**
     * Create a local terminal session
     *
     * @param sessionId Session identifier
     * @param shell Shell to spawn (cmd, powershell, bash, etc.)
     * @throws IOException if process cannot be started
     */
    public LocalTerminalSession(String sessionId, String shell) throws IOException {
        this.sessionId = sessionId;

        // Get shell configuration from unified ShellConfig
        ShellConfig.ShellInfo shellInfo = ShellConfig.getShellInfo(shell);
        String[] command;
        boolean manualEcho;

        if (shellInfo != null && shellInfo.isAvailable()) {
            // Use shell config from unified configuration
            command = shellInfo.getCommand();
            manualEcho = shellInfo.isManualEcho();
            log.info("[LocalTerminal-{}] Using ShellConfig for '{}': command={}, manualEcho={}",
                     sessionId, shell, String.join(" ", command), manualEcho);
        } else {
            // Fallback: use default shell for current OS
            log.warn("[LocalTerminal-{}] Shell '{}' not found in ShellConfig, using default shell for OS",
                     sessionId, shell);

            String defaultShell = ShellConfig.getDefaultShell();
            ShellConfig.ShellInfo defaultShellInfo = ShellConfig.getShellInfo(defaultShell);

            if (defaultShellInfo != null && defaultShellInfo.isAvailable()) {
                command = defaultShellInfo.getCommand();
                manualEcho = defaultShellInfo.isManualEcho();
                log.info("[LocalTerminal-{}] Using default shell '{}' as fallback", sessionId, defaultShell);
            } else {
                // Ultimate fallback - should never happen if ShellConfig is correct
                throw new IOException("No available shell found for OS: " + ShellConfig.getOSName());
            }
        }

        this.needsManualEcho = manualEcho;

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(new File(System.getProperty("user.home")));
        pb.redirectErrorStream(true);  // Merge stderr into stdout

        this.process = pb.start();

        // Initialize Windows CMD only (not PowerShell or Bash)
        if (ShellConfig.OS_WINDOWS.equals(ShellConfig.getOSType()) && shell.equals("cmd")) {
            initializeWindowsCmd();
        }

        log.info("[LocalTerminal-{}] Started shell: {} (manualEcho={})", sessionId, String.join(" ", command), manualEcho);
    }

    /**
     * Initialize Windows CMD.
     * NOTE: Do NOT clear startup output or send extra commands here!
     * Let CMD start naturally - the initial prompt (e.g. C:\Users\admin>)
     * will be streamed directly to the WebSocket client via the output streaming thread.
     *
     * Previous approach of clearing output + sending 'cd' caused garbled/truncated prompts
     * because it raced with the WebSocket connection and partial output was consumed.
     */
    private void initializeWindowsCmd() {
        // Nothing to do - let CMD start naturally
        // The first prompt will appear via the streaming thread
        log.info("[LocalTerminal-{}] Windows CMD initialized (natural startup)", sessionId);
    }

    @Override
    public boolean open() {
        // Process is already started in constructor
        return process != null && process.isAlive();
    }

    @Override
    public InputStream getInputStream() {
        // Return process output stream (what the terminal produces)
        return process.getInputStream();
    }

    @Override
    public void sendInput(String data) {
        try {
            OutputStream out = process.getOutputStream();
            out.write(data.getBytes(StandardCharsets.UTF_8));
            out.flush();
            log.debug("[LocalTerminal-{}] Sent input: {} bytes", sessionId, data.length());
        } catch (IOException e) {
            // Broken pipe can happen briefly after Ctrl+C - log warn, don't throw
            log.warn("[LocalTerminal-{}] Failed to send input (process may be restarting): {}", sessionId, e.getMessage());
            throw new RuntimeException("Failed to send input", e);
        }
    }

    @Override
    public void sendCtrlC() {
        try {
            // Send raw ETX byte (0x03) - interrupt signal
            // Works for bash natively
            // For CMD: interrupts the currently running child command
            OutputStream out = process.getOutputStream();
            out.write(0x03);
            out.write('\r');  // Follow with Enter so CMD shows new prompt
            out.flush();
            log.debug("[LocalTerminal-{}] Sent Ctrl+C (0x03)", sessionId);
        } catch (IOException e) {
            log.warn("[LocalTerminal-{}] Failed to send Ctrl+C: {}", sessionId, e.getMessage());
        }
    }

    @Override
    public void onResize(int cols, int rows) {
        // ProcessBuilder creates pipe-based processes without a real PTY.
        // CMD in pipe mode doesn't have an attached console, so 'mode con' won't work.
        // For true terminal resize support, a PTY library (e.g., pty4j) would be needed.
        //
        // Note: The truncated prompt issue (e.g. "C:\Users\admi>") was caused by
        // initializeWindowsCmd() consuming bytes from the output stream, NOT by column width.
        // That issue is now fixed by letting CMD start naturally without byte consumption.
        log.debug("[LocalTerminal-{}] Resize requested ({}x{}) - not supported in pipe mode",
                sessionId, cols, rows);
    }

    @Override
    public boolean close() {
        if (process != null && process.isAlive()) {
            try {
                process.destroy();
                process.waitFor();
                log.info("[LocalTerminal-{}] Process terminated", sessionId);
                return true;
            } catch (InterruptedException e) {
                log.warn("[LocalTerminal-{}] Interrupted while waiting for process termination", sessionId);
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return true;
    }

    /**
     * Check if this session needs manual echo (Windows CMD without PTY)
     */
    @Override
    public boolean needsManualEcho() {
        return needsManualEcho;
    }

    /**
     * Check if process is still alive
     */
    @Override
    public boolean isAlive() {
        return process != null && process.isAlive();
    }

    /**
     * Get session ID
     */
    @Override
    public String getSessionId() {
        return sessionId;
    }
}
