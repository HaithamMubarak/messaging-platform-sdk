/**
 * LocalStorage Manager
 * Centralized management for all localStorage operations in Terminal app
 * Provides type-safe access, default values, and consistent key naming
 */
class LocalStorageManager {
    constructor(prefix = 'terminal_') {
        this.prefix = prefix;

        // Storage keys (centralized definition)
        this.KEYS = {
            // Test/Debug settings
            TEST_MODE_NO_SLS: 'test_mode_no_sls',
            SLS_PORT: 'sls-port',

            // Security tokens
            SLS_TOKEN: 'sls-token',
            SLS_TOKEN_TIMESTAMP: 'sls-token-timestamp',

            // UI state
            LAST_ACTIVE_TAB: 'terminal_last_active_tab',
            OPEN_TABS: 'terminal_open_tabs',

            // File explorer (per-session)
            FILE_EXPLORER_PATH: (sessionId) => `fileExplorer_path_${sessionId}`
        };
    }

    /**
     * Get item from localStorage with optional default value
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if key doesn't exist
     * @returns {string|null} Stored value or default
     */
    getItem(key, defaultValue = null) {
        try {
            const value = localStorage.getItem(key);
            return value !== null ? value : defaultValue;
        } catch (error) {
            console.warn('[Storage] Failed to get item:', key, error);
            return defaultValue;
        }
    }

    /**
     * Set item in localStorage
     * @param {string} key - Storage key
     * @param {*} value - Value to store (will be converted to string)
     * @returns {boolean} Success status
     */
    setItem(key, value) {
        try {
            localStorage.setItem(key, value.toString());
            return true;
        } catch (error) {
            console.warn('[Storage] Failed to set item:', key, error);
            return false;
        }
    }

    /**
     * Remove item from localStorage
     * @param {string} key - Storage key
     * @returns {boolean} Success status
     */
    removeItem(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.warn('[Storage] Failed to remove item:', key, error);
            return false;
        }
    }

    /**
     * Get boolean value from localStorage
     * @param {string} key - Storage key
     * @param {boolean} defaultValue - Default value
     * @returns {boolean}
     */
    getBoolean(key, defaultValue = false) {
        const value = this.getItem(key);
        if (value === null) return defaultValue;
        return value === 'true';
    }

    /**
     * Get integer value from localStorage
     * @param {string} key - Storage key
     * @param {number} defaultValue - Default value
     * @returns {number}
     */
    getInt(key, defaultValue = 0) {
        const value = this.getItem(key);
        if (value === null) return defaultValue;
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    /**
     * Get JSON value from localStorage
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value
     * @returns {*} Parsed JSON or default value
     */
    getJSON(key, defaultValue = null) {
        try {
            const value = this.getItem(key);
            if (value === null) return defaultValue;
            return JSON.parse(value);
        } catch (error) {
            console.warn('[Storage] Failed to parse JSON for key:', key, error);
            return defaultValue;
        }
    }

    /**
     * Set JSON value in localStorage
     * @param {string} key - Storage key
     * @param {*} value - Value to store (will be stringified)
     * @returns {boolean} Success status
     */
    setJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.warn('[Storage] Failed to set JSON for key:', key, error);
            return false;
        }
    }

    // ========================================
    // Convenience Methods for Specific Keys
    // ========================================

    // Test Mode
    isTestModeNoSLS() {
        return this.getBoolean(this.KEYS.TEST_MODE_NO_SLS, false);
    }

    setTestModeNoSLS(enabled) {
        return this.setItem(this.KEYS.TEST_MODE_NO_SLS, enabled);
    }

    // SLS Port
    getSLSPort(defaultPort = 8088) {
        return this.getInt(this.KEYS.SLS_PORT, defaultPort);
    }

    setSLSPort(port) {
        return this.setItem(this.KEYS.SLS_PORT, port);
    }

    // SLS Token
    getSLSToken() {
        return this.getItem(this.KEYS.SLS_TOKEN);
    }

    setSLSToken(token) {
        return this.setItem(this.KEYS.SLS_TOKEN, token);
    }

    getSLSTokenTimestamp() {
        return this.getItem(this.KEYS.SLS_TOKEN_TIMESTAMP);
    }

    setSLSTokenTimestamp(timestamp) {
        return this.setItem(this.KEYS.SLS_TOKEN_TIMESTAMP, timestamp);
    }

    clearSLSToken() {
        this.removeItem(this.KEYS.SLS_TOKEN);
        this.removeItem(this.KEYS.SLS_TOKEN_TIMESTAMP);
    }

    // Last Active Tab
    getLastActiveTab() {
        return this.getItem(this.KEYS.LAST_ACTIVE_TAB);
    }

    setLastActiveTab(sessionId) {
        return this.setItem(this.KEYS.LAST_ACTIVE_TAB, sessionId);
    }

    // Open Tabs
    getOpenTabs() {
        return this.getJSON(this.KEYS.OPEN_TABS, []);
    }

    setOpenTabs(tabs) {
        return this.setJSON(this.KEYS.OPEN_TABS, tabs);
    }

    addOpenTab(sessionId) {
        const tabs = this.getOpenTabs();
        if (!tabs.includes(sessionId)) {
            tabs.push(sessionId);
            this.setOpenTabs(tabs);
        }
    }

    removeOpenTab(sessionId) {
        const tabs = this.getOpenTabs();
        const filtered = tabs.filter(id => id !== sessionId);
        this.setOpenTabs(filtered);

        // Clear last active if it was this tab
        if (this.getLastActiveTab() === sessionId) {
            this.removeItem(this.KEYS.LAST_ACTIVE_TAB);
        }
    }

    // File Explorer Path (per session)
    getFileExplorerPath(sessionId) {
        if (!sessionId) return null;
        return this.getItem(this.KEYS.FILE_EXPLORER_PATH(sessionId));
    }

    setFileExplorerPath(sessionId, path) {
        if (!sessionId) return false;
        return this.setItem(this.KEYS.FILE_EXPLORER_PATH(sessionId), path);
    }

    clearFileExplorerPath(sessionId) {
        if (!sessionId) return false;
        return this.removeItem(this.KEYS.FILE_EXPLORER_PATH(sessionId));
    }

    // Clear all file explorer paths (for cleanup)
    clearAllFileExplorerPaths() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('fileExplorer_path_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => this.removeItem(key));
        return keysToRemove.length;
    }

    /**
     * Clear all terminal-related storage
     * Useful for debugging or "reset to defaults"
     */
    clearAll() {
        const keys = Object.values(this.KEYS).filter(k => typeof k === 'string');
        keys.forEach(key => this.removeItem(key));
        this.clearAllFileExplorerPaths();
        console.log('[Storage] Cleared all terminal storage');
    }

    /**
     * Get storage usage info (for debugging)
     */
    getStorageInfo() {
        const info = {
            total: localStorage.length,
            terminal: 0,
            keys: []
        };

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('terminal_') ||
                        key.startsWith('fileExplorer_') ||
                        key.startsWith('sls-') ||
                        key === 'test_mode_no_sls')) {
                info.terminal++;
                info.keys.push(key);
            }
        }

        return info;
    }
}

// Create global instance
const storageManager = new LocalStorageManager();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LocalStorageManager, storageManager };
}

