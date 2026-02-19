package com.hmdev.sdk.local.terminal.util;

/**
 * Utility class for terminal string operations.
 *
 * Provides helper methods for common terminal character and string operations
 * like detecting special characters (newlines, backspace, tab) and formatting
 * strings for logging.
 */
public final class TerminalStringUtils {

    private TerminalStringUtils() {
        // Prevent instantiation
    }

    // ========================================
    // Terminal Control Characters
    // ========================================

    /** Set to false to disable bash output cleaning (useful for debugging raw output) */
    public static final boolean CLEAN_BASH_OUTPUT = false;

    public static final String NEWLINE_CR = "\r";
    public static final String NEWLINE_LF = "\n";
    public static final String NEWLINE_CRLF = "\r\n";
    public static final String BACKSPACE = "\b";
    public static final String BACKSPACE_DEL = "\u007F";
    public static final String TAB = "\t";
    public static final String CTRL_C = "\u0003";
    public static final String ANSI_CLEAR_SCREEN = "\u001b[2J\u001b[H";

    // ========================================
    // Character Detection
    // ========================================

    /**
     * Check if string is any type of newline character(s).
     * Handles: \r, \n, \r\n
     *
     * @param str String to check
     * @return true if string is a newline sequence
     */
    public static boolean isNewline(String str) {
        return str != null && (
            str.equals(NEWLINE_CR) ||
            str.equals(NEWLINE_LF) ||
            str.equals(NEWLINE_CRLF)
        );
    }

    /**
     * Check if string is a backspace character.
     * Handles: \b (backspace) and \u007F (DEL)
     *
     * @param str String to check
     * @return true if string is a backspace
     */
    public static boolean isBackspace(String str) {
        return str != null && (
            str.equals(BACKSPACE) ||
            str.equals(BACKSPACE_DEL)
        );
    }

    /**
     * Check if string is Ctrl+C (interrupt signal).
     *
     * @param str String to check
     * @return true if string is Ctrl+C
     */
    public static boolean isCtrlC(String str) {
        return CTRL_C.equals(str);
    }

    /**
     * Check if string is a tab character.
     *
     * @param str String to check
     * @return true if string is a tab
     */
    public static boolean isTab(String str) {
        return str != null && str.equals(TAB);
    }

    /**
     * Check if character is printable ASCII (32-126).
     *
     * @param c Character to check
     * @return true if character is printable ASCII
     */
    public static boolean isPrintableAscii(char c) {
        return c >= 32 && c < 127;
    }

    /**
     * Check if string is a single printable ASCII character.
     *
     * @param str String to check
     * @return true if string is one printable ASCII character
     */
    public static boolean isSinglePrintableChar(String str) {
        return str != null &&
               str.length() == 1 &&
               isPrintableAscii(str.charAt(0));
    }

    // ========================================
    // String Formatting for Logging
    // ========================================

    /**
     * Escape control characters for logging.
     * Converts \r to \\r, \n to \\n for readable logs.
     *
     * @param str String to escape
     * @return Escaped string with visible control characters
     */
    public static String escapeControlChars(String str) {
        if (str == null) {
            return null;
        }
        return str.replace("\r", "\\r")
                  .replace("\n", "\\n")
                  .replace("\t", "\\t")
                  .replace("\b", "\\b");
    }

    /**
     * Format string for debug logging with length.
     * Example: "hello\r\n" -> "hello\\r\\n (7 bytes)"
     *
     * @param str String to format
     * @return Formatted string with escaped control chars and length
     */
    public static String formatForLogging(String str) {
        if (str == null) {
            return "null";
        }
        return String.format("%s (%d bytes)", escapeControlChars(str), str.length());
    }

    // ========================================
    // Output Cleaning
    // ========================================

    /**
     * Clean terminal output from shells running through ProcessBuilder (no real PTY).
     *
     * When bash runs as a pipe (not PTY), some output has extra leading spaces
     * on each line because tools can't detect the terminal width properly.
     *
     * Only cleans bash output — cmd/powershell manage their own formatting.
     *
     * This method:
     * - Normalizes all line endings (\r\n, \r → \n)
     * - Strips leading whitespace from each line
     * - Restores CRLF (\r\n) for xterm.js
     *
     * Equivalent JS (index.html cleanOutput function):
     *   const normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
     *   return normalized.split('\n').map(line =&gt; line.trimStart()).join('\r\n');
     *
     * @param output Raw output from terminal
     * @param shell  Shell type (e.g. "bash", "cmd", "powershell")
     * @return Cleaned output with leading whitespace stripped per line (bash only)
     */
    public static String cleanOutput(String output, String shell) {
        if (output == null || output.isEmpty()) {
            return output;
        }

        // Only clean bash — cmd/powershell manage their own formatting
        // Set CLEAN_BASH_OUTPUT = false to disable for testing/debugging
        if (!CLEAN_BASH_OUTPUT || !"bash".equalsIgnoreCase(shell)) {
            return output;
        }

        // Normalize all line endings first
        String normalized = output
                .replace("\r\n", "\n")
                .replace("\r", "\n");

        // Strip leading spaces from each line, restore CRLF for xterm.js.
        // IMPORTANT: skip stripLeading() on the FIRST segment — it may be a mid-line
        // continuation of a previous chunk (e.g. " hi" after "echo"). Only lines that
        // follow a \n are guaranteed to be line-starts.
        String[] lines = normalized.split("\n", -1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            sb.append(i == 0 ? lines[i] : lines[i].stripLeading());
            if (i < lines.length - 1) {
                sb.append("\r\n");
            }
        }
        return sb.toString();
    }

    /**
     * Check if command is a clear screen command.
     * Handles: cls, clear
     *
     * @param command Command string (trimmed)
     * @return true if command clears screen
     */
    public static boolean isClearScreenCommand(String command) {
        if (command == null) {
            return false;
        }
        String trimmed = command.trim().toLowerCase();
        return trimmed.equals("cls") || trimmed.equals("clear");
    }

    /**
     * Get ANSI clear screen sequence.
     *
     * @return ANSI escape sequence to clear screen and move cursor to home
     */
    public static String getClearScreenSequence() {
        return ANSI_CLEAR_SCREEN;
    }
}

