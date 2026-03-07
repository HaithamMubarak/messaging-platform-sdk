package com.hmdev.sdk.local.terminal;

import java.io.InputStream;

public interface ITerminalSession {

    boolean open();

    InputStream getInputStream();

    void sendInput(String data);

    /**
     * Send Ctrl+C interrupt signal to the terminal process.
     * Default implementation sends raw \u0003 byte - override for OS-specific behavior.
     */
    default void sendCtrlC() {
        sendInput("\u0003");
    }

    void onResize(int cols, int rows);

    boolean close();

    /**
     * Get the session ID
     * @return unique session identifier
     */
    String getSessionId();

    /**
     * Check if session is still alive/active
     * @return true if session is alive
     */
    boolean isAlive();

    /**
     * Check if session needs manual echo (e.g., Windows CMD without PTY)
     * @return true if manual echo is needed
     */
    boolean needsManualEcho();
}
