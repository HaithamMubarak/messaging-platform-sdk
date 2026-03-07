package com.hmdev.sdk.local.terminal.config;

import lombok.Builder;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Unified shell configuration and detection for all supported shells.
 * Used by both terminal creation and shell listing endpoints.
 */
@Slf4j
public class ShellConfig {

    // ========================================
    // OS Type Constants
    // ========================================

    public static final String OS_WINDOWS = "Windows";
    public static final String OS_MACOS = "macOS";
    public static final String OS_LINUX = "Linux";
    public static final String OS_UNKNOWN = "Unknown";

    // ========================================
    // Shell Information
    // ========================================

    /**
     * Shell information
     */
    @Data
    @Builder
    public static class ShellInfo {
        private String name;           // Command name (e.g., "bash", "cmd")
        private String label;          // Display label (e.g., "Git Bash", "Command Prompt")
        private String icon;           // Emoji icon for UI
        private boolean available;     // Is this shell available on current system?
        private String[] command;      // Command array to execute
        private boolean manualEcho;    // Does shell need manual echo?
        private String path;           // Full path to executable (optional)
    }

    // ========================================
    // OS Detection (Single Source of Truth)
    // ========================================

    /**
     * Detect the current operating system.
     * This is the ONLY method that calls System.getProperty("os.name").
     * Centralized here for easy testing and mocking.
     *
     * @return OS type constant (OS_WINDOWS, OS_MACOS, OS_LINUX, OS_UNKNOWN)
     */
    private static String detectOS() {
        String osName = System.getProperty("os.name").toLowerCase();

        if (osName.contains("win")) {
            return OS_WINDOWS;
        } else if (osName.contains("mac")) {
            return OS_MACOS;
        } else if (osName.contains("nix") || osName.contains("nux") || osName.contains("aix")) {
            return OS_LINUX;
        } else {
            return OS_UNKNOWN;
        }
    }

    /**
     * Get the current OS type.
     * Uses centralized detection method.
     *
     * @return OS type constant
     */
    public static String getOSType() {
        return detectOS();
    }

    // ========================================
    // Public API Methods
    // ========================================

    /**
     * Get all available shells for the current OS
     */
    public static List<ShellInfo> getAvailableShells() {
        String osType = detectOS();
        List<ShellInfo> shells = new ArrayList<>();

        switch (osType) {
            case OS_WINDOWS:
                shells.addAll(getWindowsShells());
                break;
            case OS_MACOS:
                shells.addAll(getMacOSShells());
                break;
            case OS_LINUX:
                shells.addAll(getLinuxShells());
                break;
            default:
                // Unknown OS - fallback to bash
                shells.addAll(getLinuxShells());
                log.warn("Unknown OS type: {}. Defaulting to Linux shells.", osType);
                break;
        }

        return shells;
    }

    /**
     * Get default shell for current OS
     */
    public static String getDefaultShell() {
        String osType = detectOS();

        switch (osType) {
            case OS_WINDOWS:
                return "cmd";
            case OS_MACOS:
                return "zsh";
            case OS_LINUX:
            default:
                return "bash";
        }
    }

    /**
     * Get OS name for display purposes
     */
    public static String getOSName() {
        return detectOS();
    }

    /**
     * Get shell info by name (for terminal creation)
     */
    public static ShellInfo getShellInfo(String shellName) {
        List<ShellInfo> shells = getAvailableShells();
        return shells.stream()
                .filter(s -> s.getName().equals(shellName))
                .findFirst()
                .orElse(null);
    }

    /**
     * Windows shells
     */
    private static List<ShellInfo> getWindowsShells() {
        List<ShellInfo> shells = new ArrayList<>();

        // CMD - Always available on Windows
        shells.add(ShellInfo.builder()
                .name("cmd")
                .label("Command Prompt")
                .icon("💻")
                .available(true)
                .command(new String[]{"cmd.exe"})
                .manualEcho(true)  // CMD needs manual echo in pipe mode
                .build());

        // PowerShell - Always available on Windows
        shells.add(ShellInfo.builder()
                .name("powershell")
                .label("PowerShell")
                .icon("⚡")
                .available(true)
                .command(new String[]{"powershell.exe", "-NoLogo", "-NoExit"})
                .manualEcho(false)  // PowerShell handles its own echo
                .build());

        // Git Bash - Check if available
        String bashPath = findBashPath();
        if (bashPath != null) {
            shells.add(ShellInfo.builder()
                    .name("bash")
                    .label("Git Bash")
                    .icon("🐧")
                    .available(true)
                    .command(new String[]{bashPath, "-i"})
                    .manualEcho(false)
                    .path(bashPath)
                    .build());
        }

        // WSL - Check if available
        if (checkWSLAvailable()) {
            shells.add(ShellInfo.builder()
                    .name("wsl")
                    .label("WSL")
                    .icon("🐧")
                    .available(true)
                    .command(new String[]{"wsl.exe"})
                    .manualEcho(false)
                    .build());
        }

        return shells;
    }

    /**
     * macOS shells
     */
    private static List<ShellInfo> getMacOSShells() {
        List<ShellInfo> shells = new ArrayList<>();

        // Zsh - Default on macOS Catalina+
        shells.add(ShellInfo.builder()
                .name("zsh")
                .label("Zsh")
                .icon("🐚")
                .available(true)
                .command(new String[]{"zsh", "-i"})
                .manualEcho(false)
                .build());

        // Bash
        shells.add(ShellInfo.builder()
                .name("bash")
                .label("Bash")
                .icon("🐚")
                .available(true)
                .command(new String[]{"bash", "-i"})
                .manualEcho(false)
                .build());

        return shells;
    }

    /**
     * Linux shells
     */
    private static List<ShellInfo> getLinuxShells() {
        List<ShellInfo> shells = new ArrayList<>();

        // Bash - Most common on Linux
        shells.add(ShellInfo.builder()
                .name("bash")
                .label("Bash")
                .icon("🐚")
                .available(true)
                .command(new String[]{"bash", "-i"})
                .manualEcho(false)
                .build());

        // sh - Bourne shell
        shells.add(ShellInfo.builder()
                .name("sh")
                .label("Shell")
                .icon("🐚")
                .available(true)
                .command(new String[]{"sh", "-i"})
                .manualEcho(false)
                .build());

        // Zsh
        shells.add(ShellInfo.builder()
                .name("zsh")
                .label("Zsh")
                .icon("🐚")
                .available(true)
                .command(new String[]{"zsh", "-i"})
                .manualEcho(false)
                .build());

        return shells;
    }

    /**
     * Find bash.exe on Windows (Git Bash)
     */
    private static String findBashPath() {
        String[] commonPaths = {
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
            System.getenv("PROGRAMFILES") + "\\Git\\bin\\bash.exe",
            System.getenv("PROGRAMFILES(X86)") + "\\Git\\bin\\bash.exe",
            System.getenv("LOCALAPPDATA") + "\\Programs\\Git\\bin\\bash.exe"
        };

        for (String path : commonPaths) {
            if (path != null) {
                File bashFile = new File(path);
                if (bashFile.exists() && bashFile.canExecute()) {
                    log.debug("Git Bash found at: {}", path);
                    return path;
                }
            }
        }

        // Check if bash is in PATH
        try {
            ProcessBuilder pb = new ProcessBuilder("bash", "--version");
            pb.redirectErrorStream(true);
            Process process = pb.start();
            int exitCode = process.waitFor();
            if (exitCode == 0) {
                log.debug("Git Bash found in system PATH");
                return "bash";
            }
        } catch (Exception e) {
            log.debug("Git Bash not found in PATH: {}", e.getMessage());
        }

        return null;
    }

    /**
     * Check if WSL is available on Windows
     */
    private static boolean checkWSLAvailable() {
        try {
            ProcessBuilder pb = new ProcessBuilder("wsl", "--status");
            pb.redirectErrorStream(true);
            Process process = pb.start();
            int exitCode = process.waitFor();
            if (exitCode == 0) {
                log.debug("WSL detected and available");
                return true;
            }
        } catch (Exception e) {
            log.debug("WSL not found: {}", e.getMessage());
        }
        return false;
    }
}

