package com.hmdev.sdk.local.terminal;

import lombok.extern.slf4j.Slf4j;

import java.io.*;
import java.nio.charset.StandardCharsets;

/**
 * Local terminal session implementation using ProcessBuilder
 * Handles CMD, PowerShell, bash, etc.
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

        String[] command;
        String os = System.getProperty("os.name").toLowerCase();
        boolean manualEcho = false;

        // Determine shell command based on OS
        if (os.contains("win")) {
            if (shell.equals("powershell")) {
                command = new String[]{"powershell.exe", "-NoLogo", "-NoExit"};
                // PowerShell handles its own echo
                manualEcho = false;
            } else if (shell.equals("bash") || shell.equals("bash.exe")) {
                // Try to find bash - Git Bash or WSL
                String bashPath = findBashPath();
                if (bashPath != null) {
                    command = new String[]{bashPath, "-i"};
                    manualEcho = false;
                } else {
                    throw new IOException("Bash not found. Please install Git Bash or WSL.");
                }
            } else if (shell.equals("wsl")) {
                // WSL default shell
                command = new String[]{"wsl.exe"};
                manualEcho = false;
            } else {
                // Default: CMD
                command = new String[]{"cmd.exe"};
                // Windows CMD in pipe mode doesn't echo - we need manual echo
                manualEcho = true;
            }
        } else {
            command = new String[]{shell, "-i"};  // Interactive shell
            // Unix shells typically echo even in pipe mode
            manualEcho = false;
        }

        this.needsManualEcho = manualEcho;

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(new File(System.getProperty("user.home")));
        pb.redirectErrorStream(true);  // Merge stderr into stdout


        this.process = pb.start();

        // Initialize Windows CMD only (not PowerShell or Bash)
        if (os.contains("win") && shell.equals("cmd")) {
            initializeWindowsCmd();
        }

        log.info("[LocalTerminal-{}] Started shell: {} (manualEcho={})", sessionId, String.join(" ", command), manualEcho);
    }

    /**
     * Find bash executable path on Windows
     * Checks Git Bash and WSL locations
     */
    private String findBashPath() {
        log.info("[LocalTerminal] Searching for bash.exe...");

        // Common bash locations on Windows
        String[] possiblePaths = {
            // Git Bash (default install)
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
            // Git Bash (using environment variables)
            System.getenv("PROGRAMFILES") + "\\Git\\bin\\bash.exe",
            System.getenv("ProgramFiles(x86)") + "\\Git\\bin\\bash.exe",
            System.getenv("LOCALAPPDATA") + "\\Programs\\Git\\bin\\bash.exe",
            // WSL bash
            System.getenv("SYSTEMROOT") + "\\System32\\bash.exe",
            "C:\\Windows\\System32\\bash.exe",
            // Git for Windows (user install)
            System.getenv("USERPROFILE") + "\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
            // Portable Git
            System.getenv("USERPROFILE") + "\\PortableGit\\bin\\bash.exe",
            "C:\\PortableGit\\bin\\bash.exe"
        };

        for (String path : possiblePaths) {
            if (path != null && !path.contains("null")) {
                log.debug("[LocalTerminal] Checking: {}", path);
                File file = new File(path);
                if (file.exists()) {
                    if (file.canExecute()) {
                        log.info("[LocalTerminal] ✓ Found bash at: {}", path);
                        return path;
                    } else {
                        log.debug("[LocalTerminal] Found but not executable: {}", path);
                    }
                }
            }
        }

        // Try to find in PATH
        log.debug("[LocalTerminal] Searching in PATH...");
        try {
            ProcessBuilder pb = new ProcessBuilder("where", "bash.exe");
            pb.redirectErrorStream(true);
            Process p = pb.start();
            BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String line = reader.readLine();
            int exitCode = p.waitFor();

            if (exitCode == 0 && line != null) {
                String bashPath = line.trim();
                File file = new File(bashPath);
                if (file.exists()) {
                    log.info("[LocalTerminal] ✓ Found bash in PATH: {}", bashPath);
                    return bashPath;
                }
            } else {
                log.debug("[LocalTerminal] 'where bash.exe' returned exit code: {}", exitCode);
            }
        } catch (Exception e) {
            log.debug("[LocalTerminal] Could not search PATH: {}", e.getMessage());
        }

        log.warn("[LocalTerminal] ✗ Bash not found. Please install Git Bash from https://git-scm.com/ or enable WSL.");
        return null;
    }

    /**
     * Initialize Windows CMD with proper settings
     */
    private void initializeWindowsCmd() {
        try {
            OutputStream out = process.getOutputStream();
            InputStream in = process.getInputStream();

            // Wait for cmd to be ready
            Thread.sleep(150);

            // Clear any startup output
            while (in.available() > 0) {
                in.read();
            }

            // Send "cd" to show initial prompt
            out.write("cd\r\n".getBytes(StandardCharsets.UTF_8));
            out.flush();

            log.info("[LocalTerminal-{}] Windows CMD initialized", sessionId);
        } catch (Exception e) {
            log.warn("[LocalTerminal-{}] Failed to initialize Windows CMD: {}", sessionId, e.getMessage());
        }
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
            log.error("[LocalTerminal-{}] Failed to send input: {}", sessionId, e.getMessage());
            throw new RuntimeException("Failed to send input", e);
        }
    }

    @Override
    public void onResize(int cols, int rows) {
        // ProcessBuilder doesn't support terminal resizing (would need PTY library like pty4j)
        log.debug("[LocalTerminal-{}] Resize requested ({}x{}) but not supported with ProcessBuilder",
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

