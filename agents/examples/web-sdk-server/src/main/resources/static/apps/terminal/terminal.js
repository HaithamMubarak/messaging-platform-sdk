/**
 * Terminal.js - Messaging Platform Shared Terminal
 *
 * A modern web-based terminal emulator with advanced features:
 * - Local terminals (CMD, Bash, PowerShell)
 * - SSH connections with saved profiles
 * - Real-time terminal sharing via Messaging Platform (multi-user collaboration)
 * - SFTP file browser integration
 * - Session persistence and auto-restore
 * - Real-time synchronization
 *
 * TABLE OF CONTENTS:
 * 1. Configuration & Constants
 * 2. Security & Authentication
 * 3. TerminalDataSender (Unified Transport)
 * 4. State Management
 * 5. Session Persistence
 * 6. SSH Connection Management
 * 7. Health Check & Initialization
 * 8. Terminal Creation & Setup
 * 9. WebSocket Management
 * 10. Session Lifecycle
 * 11. Tab Management
 * 12. Cloud Sharing & Collaboration
 * 13. Context Menus
 * 14. Modal Dialogs
 * 15. SSH CRUD Operations
 * 16. UI Helpers & Utilities
 * 17. Event Listeners & Cleanup
 */

// ========================================
// SECTION 1: CONFIGURATION & CONSTANTS
// ========================================
// TEST MODE: Set to true to disable SLS service (for testing viewer-only mode)
// When enabled, terminal will only connect to cloud and view shared sessions
// without creating local terminal sessions (no backend required)
const TEST_MODE_NO_SLS = localStorage.getItem('test_mode_no_sls') === 'true';

// SDK Local Service Configuration
const DEFAULT_SLS_PORT = 8088;
let SLS_PORT = parseInt(localStorage.getItem('sls-port') || DEFAULT_SLS_PORT);
let MLS_URL = `http://localhost:${SLS_PORT}`;
let MLS_WS_URL = `ws://localhost:${SLS_PORT}`;

if (TEST_MODE_NO_SLS) {
    console.warn('🧪 TEST MODE: SLS service disabled - viewer-only mode (shared sessions only)');
}

// UI & Timing Constants
const TOAST_DURATION = 5000;
const HEALTH_CHECK_INTERVAL = 30000;

// Terminal control banners - must match Java backend constants
// Format: <<BANNER_NAME>> to avoid conflicts with normal terminal output
const BANNER_SSH_DISCONNECTED = '<<SSH_DISCONNECTED>>';
const BANNER_STREAM_CLOSED = '<<STREAM_CLOSED>>';

// Toast icons for different message types
const TOAST_ICONS = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
};

// ========================================
// SECTION 2: STATE VARIABLES
// ========================================
// Security & Authentication
let slsSecurityToken = null;

// SLS state tracking: null (initial), 'online', or 'offline'
let slsCurrentState = null;

// ========================================
// SECTION 3: CLASSES
// ========================================
// TabSessionManager - Centralized Tab & Session Management
/**
 * TabSessionManager - Manages all tab switching and session tracking
 * Provides better encapsulation for tab/session operations
 */
class TabSessionManager {
    constructor() {
        this.activeSessionId = null;
        this.sessions = new Map();
        this.notes = new Map();
    }

    /**
     * Switch to a session (terminal or note)
     * @param {string} sessionId - The session/tab ID to switch to
     */
    switchTo(sessionId) {
        // Deactivate all tabs
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

        // Activate target tab
        const tab = document.getElementById(`tab-${sessionId}`);
        if (tab) {
            tab.classList.add('active');
        }

        // Deactivate all panels
        document.querySelectorAll('.terminal-panel').forEach(p => p.classList.remove('active'));

        // Activate target panel
        const panel = document.getElementById(`panel-${sessionId}`);
        if (panel) {
            panel.classList.add('active');
        }

        // Update active session
        this.activeSessionId = sessionId;

        // Persist last active tab so it can be restored on page refresh
        try { localStorage.setItem('terminal_last_active_tab', sessionId); } catch (e) { /* ignore */ }

        // Handle session-specific logic
        if (sessionId.startsWith('note-')) {
            // It's a note - clear terminal-related state
            this.handleNoteSwitch(sessionId);
        } else {
            // It's a terminal session
            this.handleTerminalSwitch(sessionId);
        }

        return this;
    }

    /**
     * Handle switching to a note tab
     */
    handleNoteSwitch(sessionId) {
        const noteId = sessionId.substring(5); // Remove 'note-' prefix

        // Focus the textarea
        const textarea = document.getElementById(`note-content-${noteId}`);
        if (textarea) {
            setTimeout(() => textarea.focus(), 100);
        }

        // Highlight active note in sidebar
        document.querySelectorAll('.note-item').forEach(item => {
            item.classList.toggle('active', item.dataset.noteId === noteId);
        });

        // Clear typing indicator (not relevant for notes)
        const statusTyping = document.getElementById('statusTyping');
        if (statusTyping) {
            statusTyping.style.display = 'none';
            statusTyping.textContent = '';
        }

        // Update status bar
        if (typeof updateStatusBar === 'function') {
            updateStatusBar();
        }
    }

    /**
     * Handle switching to a terminal session
     */
    handleTerminalSwitch(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        // Update status bar
        if (typeof updateStatusBar === 'function') {
            updateStatusBar();
        }

        // Clear typing indicator
        const statusTyping = document.getElementById('statusTyping');
        if (statusTyping) {
            statusTyping.style.display = 'none';
            statusTyping.textContent = '';
        }

        // If File Explorer sidebar panel is active, update it to show current session's files
        const filesPanel = document.getElementById('panel-files');
        if (filesPanel && filesPanel.classList.contains('active')) {
            // File Explorer is currently selected in sidebar - update it for new session
            if (sessionSupportsFileExplorer(session)) {
                // New session supports File Explorer - update to show its files
                console.log('[FileExplorer] Auto-updating to show files for session:', sessionId);

                // Initialize if needed
                if (!fileExplorer) {
                    initFileExplorer();
                }

                // Open file browser for the new active session
                openFileBrowserForSession(sessionId);
            } else {
                // New session doesn't support File Explorer - keep panel open but show message
                console.log('[FileExplorer] New session does not support File Explorer');
            }
        }

        // Focus terminal and fit
        if (session.terminal) {
            setTimeout(() => {
                if (session.fitAddon) {
                    session.fitAddon.fit();
                }
                session.terminal.focus();
            }, 100);

            // Mobile: Ensure terminal gets focus (only attach once per element)
            const terminalElement = document.getElementById(`terminal-${sessionId}`);
            if (terminalElement && !terminalElement._focusListenerAttached) {
                const focusTerminal = () => {
                    if (session.terminal) {
                        session.terminal.focus();
                        const textarea = terminalElement.querySelector('.xterm-helper-textarea');
                        if (textarea) {
                            textarea.focus();
                        }
                    }
                };

                // Focus on touch/click - only attach once
                terminalElement.addEventListener('touchstart', focusTerminal, { passive: true });
                terminalElement.addEventListener('click', focusTerminal);
                terminalElement._focusListenerAttached = true;
            }
        }
    }

    /**
     * Get the currently active session ID
     */
    getActiveSessionId() {
        return this.activeSessionId;
    }

    /**
     * Get a session by ID
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    /**
     * Add or update a session
     */
    setSession(sessionId, sessionData) {
        this.sessions.set(sessionId, sessionData);
        return this;
    }

    /**
     * Remove a session
     */
    removeSession(sessionId) {
        this.sessions.delete(sessionId);
        return this;
    }

    /**
     * Get all sessions
     */
    getAllSessions() {
        return this.sessions;
    }

    /**
     * Get a note by ID
     */
    getNote(noteId) {
        return this.notes.get(noteId);
    }

    /**
     * Add or update a note
     */
    setNote(noteId, noteData) {
        this.notes.set(noteId, noteData);
        return this;
    }

    /**
     * Remove a note
     */
    removeNote(noteId) {
        this.notes.delete(noteId);
        return this;
    }

    /**
     * Get all notes
     */
    getAllNotes() {
        return this.notes;
    }

    /**
     * Close mobile sidebar when switching (for mobile UX)
     */
    closeMobileSidebar() {
        if (window.innerWidth <= 480 && typeof closeMobileSidebar === 'function') {
            closeMobileSidebar();
        }
        return this;
    }
}

// Create global instance
const tabSessionManager = new TabSessionManager();

// ========================================
// FUNCTIONS START HERE
// ========================================

// ========================================
// Security & Authentication Functions
// ========================================

/**
 * Enable/disable SLS-dependent toolbar buttons based on SLS state
 * @param {boolean} online - true = SLS is online, false = offline
 */
/**
 * Update all SLS-dependent UI elements based on online/offline state
 * Handles toolbar buttons, menu items, and sidebar tabs
 * @param {boolean} online - True if SLS is online, false if offline
 */
function updateSlsDependentButtons(online) {
    // Update toolbar buttons
    const buttons = document.querySelectorAll('.toolbar-btn.sls-dependent');
    buttons.forEach(btn => {
        if (online) {
            btn.disabled = false;
            btn.classList.remove('sls-disabled');
            // Restore original title (stored on disable)
            if (btn.dataset.originalTitle) {
                btn.title = btn.dataset.originalTitle;
                delete btn.dataset.originalTitle;
            }
        } else {
            // Store original title before overwriting
            if (!btn.dataset.originalTitle) {
                btn.dataset.originalTitle = btn.title;
            }
            btn.disabled = true;
            btn.classList.add('sls-disabled');
            btn.title = 'SDK Local Service is offline - Start SLS to enable this feature';
        }
    });

    // Update menu items
    const menuItems = document.querySelectorAll('.menu-item.sls-dependent');
    menuItems.forEach(item => {
        if (online) {
            item.classList.remove('disabled');
            item.style.pointerEvents = '';
            item.style.opacity = '';
            // Restore original title
            if (item.dataset.originalTitle) {
                item.title = item.dataset.originalTitle;
                delete item.dataset.originalTitle;
            }
        } else {
            // Store original title
            if (!item.dataset.originalTitle) {
                item.dataset.originalTitle = item.title || '';
            }
            item.classList.add('disabled');
            item.style.pointerEvents = 'none';
            item.style.opacity = '0.5';
            item.title = 'SDK Local Service is offline - Start SLS to enable this feature';
        }
    });

    // Update sidebar tabs
    const sidebarTabs = document.querySelectorAll('.sidebar-tab.sls-dependent');
    sidebarTabs.forEach(tab => {
        if (online) {
            tab.disabled = false;
            tab.classList.remove('disabled');
            tab.style.pointerEvents = '';
            tab.style.opacity = '';
            // Restore original title
            if (tab.dataset.originalTitle) {
                tab.title = tab.dataset.originalTitle;
                delete tab.dataset.originalTitle;
            }
        } else {
            // Store original title
            if (!tab.dataset.originalTitle) {
                tab.dataset.originalTitle = tab.title || '';
            }
            tab.disabled = true;
            tab.classList.add('disabled');
            tab.style.pointerEvents = 'none';
            tab.style.opacity = '0.5';
            tab.title = 'SDK Local Service is offline - Start SLS to enable this feature';
        }
    });

    // Dispatch custom event for other components to listen
    window.dispatchEvent(new CustomEvent('sls-status-changed', {
        detail: { online }
    }));

    // Update file explorer button based on active session (independent of SLS for shared sessions)
    if (activeSessionId) {
        const session = sessions.get(activeSessionId);
        if (session) {
            updateFileExplorerButtonState(session);
        }
    }

    console.log(`[SLS] UI updated: ${online ? 'Online' : 'Offline'} - All SLS-dependent elements ${online ? 'enabled' : 'disabled'}`);
}

// File Explorer button state management removed - accessed via sidebar only

/**
 * Check if a session supports File Explorer
 * @param {Object} session - Session object
 * @returns {boolean} - True if session supports File Explorer
 */
function sessionSupportsFileExplorer(session) {
    console.log('[FileExplorer] Checking if session supports File Explorer. Session:', session);
    if (!session) return false;

    // ✅ Session must be alive/connected (except remote sessions which use cloud connection)
    const isAlive = session.connected || (session.type === 'remote' && session.owner);
    if (!isAlive) {
        console.log('[FileExplorer] Session not alive - button disabled');
        return false;
    }

    // SSH sessions support file explorer
    const isSsh = session.type === 'ssh';

    // Local terminals support file explorer
    const isLocalTerminal = session.type === 'local' &&
        session.config && ['cmd', 'bash', 'ps'].includes(session.config.shell);

    // ✅ Remote shared sessions support file explorer ONLY with write permission
    // Read-only viewers cannot access file system (they can only view terminal output)
    const hasWritePermission = session.permission &&
                               (session.permission === 'readwrite' ||
                                session.permission === 'write' ||
                                session.permission.includes('write'));
    const isRemoteShared = session.type === 'remote' && session.owner && hasWritePermission;

    console.log('[FileExplorer] Permission check - type:', session.type, 'owner:', session.owner, 'permission:', session.permission, 'hasWrite:', hasWritePermission);

    return isSsh || isLocalTerminal || isRemoteShared;
}

/**
 * Update file explorer button state based on active session
 * Enables button if current session supports file explorer
 * @param {Object} session - Current session object
 */
function updateFileExplorerButtonState(session) {
    const filesTabBtn = document.getElementById('filesTabBtn');
    if (!filesTabBtn) return;

    const supportsFileExplorer = sessionSupportsFileExplorer(session);

    if (supportsFileExplorer) {
        // ✅ Properly enable button
        filesTabBtn.disabled = false;
        filesTabBtn.removeAttribute('disabled'); // Remove HTML attribute
        filesTabBtn.classList.remove('disabled');
        filesTabBtn.style.removeProperty('pointer-events'); // Remove inline style
        filesTabBtn.style.removeProperty('opacity'); // Remove inline style

        // Update tooltip based on session type
        if (session.type === 'ssh') {
            filesTabBtn.title = 'File Explorer (Remote Files via SFTP)';
        } else if (session.type === 'remote') {
            const hasWriteAccess = session.permission === 'readwrite' || session.permission === 'write';
            filesTabBtn.title = 'File Explorer (Shared Session - ' +
                               (hasWriteAccess ? 'Read-Write' : 'Read-Only') + ')';
        } else {
            filesTabBtn.title = 'File Explorer (Local Files)';
        }

        console.log('[FileExplorer] Button enabled for session:', session.id, 'type:', session.type);
    } else {
        // ✅ Properly disable button
        filesTabBtn.disabled = true;
        filesTabBtn.setAttribute('disabled', 'disabled'); // Set HTML attribute
        filesTabBtn.classList.add('disabled');
        filesTabBtn.style.pointerEvents = 'none';
        filesTabBtn.style.opacity = '0.5';
        filesTabBtn.title = 'File Explorer - Not available for this session type';

        console.log('[FileExplorer] Button disabled for session:', session.id, 'type:', session.type);
    }
}

/**
 * Request security token from SLS
 */
async function requestSlsToken() {
    if (TEST_MODE_NO_SLS) {
        console.log('🧪 TEST MODE: Skipping SLS token request');
        return null;
    }

    try {
        const response = await fetch(`${MLS_URL}/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: window.location.origin,
                expiryHours: 24
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to get token: ${response.status}`);
        }

        const data = await response.json();
        slsSecurityToken = data.token;

        // Store in localStorage for page refresh
        localStorage.setItem('sls-token', slsSecurityToken);
        localStorage.setItem('sls-token-timestamp', Date.now().toString());

        console.log('✅ SLS security token obtained');
        return slsSecurityToken;
    } catch (error) {
        console.error('❌ Failed to get SLS token:', error);
        // Don't show toast here - let the caller handle it to avoid duplicates
        throw error;
    }
}

/**
 * Get security token (from memory or localStorage)
 */
function getSlsToken() {
    if (slsSecurityToken) {
        return slsSecurityToken;
    }

    // Try to restore from localStorage
    const storedToken = localStorage.getItem('sls-token');
    const timestamp = localStorage.getItem('sls-token-timestamp');

    if (storedToken && timestamp) {
        const age = Date.now() - parseInt(timestamp);
        const maxAge = 23 * 60 * 60 * 1000; // 23 hours (refresh before 24h expiry)

        if (age < maxAge) {
            slsSecurityToken = storedToken;
            return slsSecurityToken;
        }
    }

    return null;
}

/**
 * Get headers with security token
 */
function getSlsHeaders(additionalHeaders = {}) {
    const token = getSlsToken();
    return {
        'X-SLS-Token': token,
        ...additionalHeaders
    };
}

/**
 * Fetch with automatic token handling
 */
async function slsFetch(url, options = {}) {
    // Skip all SLS API calls in test mode
    if (TEST_MODE_NO_SLS) {
        console.log('🧪 TEST MODE: Skipping SLS fetch:', url);
        // Return a mock successful response
        return {
            ok: false,
            status: 503,
            statusText: 'Service Unavailable (Test Mode)',
            json: async () => ({ error: 'SLS disabled in test mode' }),
            text: async () => 'SLS disabled in test mode'
        };
    }

    let token = getSlsToken();

    // Request new token if we don't have one
    if (!token) {
        token = await requestSlsToken();
    }

    // Add token to headers
    const headers = {
        'X-SLS-Token': token,
        ...(options.headers || {})
    };

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            signal: options.signal || AbortSignal.timeout(15000) // 15s default timeout
        });

        // If 401, token might be expired - try refreshing once
        if (response.status === 401) {
            console.log('Token expired, refreshing...');
            token = await requestSlsToken();

            // Retry with new token
            return await fetch(url, {
                ...options,
                headers: {
                    'X-SLS-Token': token,
                    ...(options.headers || {})
                },
                signal: options.signal || AbortSignal.timeout(15000)
            });
        }

        return response;
    } catch (error) {
        // Enhance error messages for common failure modes
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            console.error('[slsFetch] Request timed out:', url);
            throw new Error('Request timed out - SDK Local Service may be offline');
        }
        if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
            console.error('[slsFetch] Network error:', url);
            throw new Error('Cannot connect to SDK Local Service - check if it\'s running');
        }
        console.error('[slsFetch] Error:', error);
        throw error;
    }
}

// ========================================
// SECTION 3: TERMINALDATASENDER (Unified Transport)
// ========================================
/**
 * TerminalDataSender - Unified interface for sending data to terminals
 * Provides a consistent interface regardless of the underlying transport:
 * - WebSocketTerminalDataSender: For local/SSH terminals
 * - CloudTerminalDataSender: For remote shared terminals
 */

/**
 * WebSocketTerminalDataSender - Wrapper for WebSocket connections (local/SSH terminals)
 */
class WebSocketTerminalDataSender {
    constructor(webSocket) {
        this.ws = webSocket;
        this.type = 'websocket';
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
            return true;
        }
        console.warn('[TerminalDataSender] WebSocket not ready');
        return false;
    }

    close() {
        if (this.ws) {
            this.ws.close();
        }
    }

    get isReady() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    get readyState() {
        return this.ws ? this.ws.readyState : WebSocket.CLOSED;
    }
}

/**
 * CloudTerminalDataSender - Wrapper for cloud-based terminal sharing (remote terminals)
 */
class CloudTerminalDataSender {
    constructor(terminalSharing, sessionId, ownerAgent) {
        this.terminalSharing = terminalSharing;
        this.sessionId = sessionId;
        this.ownerAgent = ownerAgent;
        this.type = 'cloud';
    }

    send(data) {
        console.log(`[CloudTerminalDataSender] Sending input to session: ${this.sessionId}, owner: ${this.ownerAgent}, connected: ${this.terminalSharing?.connected}`);

        if (!this.terminalSharing || !this.terminalSharing.connected) {
            console.warn('[CloudTerminalDataSender] Not connected to cloud - cannot send input');
            return false;
        }

        const result = this.terminalSharing.sendInputToSession(this.sessionId, data, this.ownerAgent);
        console.log(`[CloudTerminalDataSender] Input sent result:`, result);
        return result;
    }

    close() {
        console.log('[TerminalDataSender] Close requested for cloud session:', this.sessionId);
    }

    get isReady() {
        return this.terminalSharing && this.terminalSharing.connected;
    }

    get readyState() {
        if (this.terminalSharing && this.terminalSharing.connected) {
            return WebSocket.OPEN;
        }
        return WebSocket.CLOSED;
    }
}

// ========================================
// SECTION 4: FUNCTIONS - Configuration & Setup
// ========================================

/**
 * Toggle test mode (disable SLS for testing)
 *
 * Test Mode Purpose:
 * - Simulates SLS (local service) being offline/unavailable
 * - Perfect for testing tab sharing functionality between multiple browser instances
 * - Allows viewing shared sessions from cloud without requiring SLS
 * - Use case: Open 2 browser windows - one with SLS (shares), one in test mode (views)
 *
 * Usage from console:
 *   enableTestMode()  // Enable test mode
 *   disableTestMode() // Disable test mode
 *   toggleTestMode()  // Toggle current state
 */
function toggleTestMode() {
    const newMode = !TEST_MODE_NO_SLS;
    localStorage.setItem('test_mode_no_sls', newMode.toString());
    console.log(`🧪 Test mode ${newMode ? 'ENABLED' : 'DISABLED'} - Reload page to apply`);
    showToast('info', 'Test Mode', `${newMode ? 'Enabled' : 'Disabled'} - Reload page to apply`);

    // Show helpful instructions
    if (newMode) {
        console.log('📌 TEST MODE ENABLED:');
        console.log('  ✓ SLS service disabled (viewer-only mode)');
        console.log('  ✓ Local/SSH terminals disabled');
        console.log('  ✓ Cloud connection enabled (to view shared sessions)');
        console.log('  ✓ Perfect for testing tab sharing!');
        console.log('');
        console.log('💡 TESTING TIP:');
        console.log('  1. Open this page in another browser/tab WITH SLS running');
        console.log('  2. In that window, create terminals and share them');
        console.log('  3. In THIS window (test mode), connect to cloud and view shared sessions');
    } else {
        console.log('✅ TEST MODE DISABLED - Normal operation restored');
        console.log('  ✓ SLS service enabled');
        console.log('  ✓ Local/SSH terminals enabled');
    }

    return newMode;
}

/**
 * Enable test mode (for console usage)
 */
function enableTestMode() {
    if (TEST_MODE_NO_SLS) {
        console.log('🧪 Test mode is already enabled');
        return;
    }
    localStorage.setItem('test_mode_no_sls', 'true');
    console.log('🧪 Test mode ENABLED - Reload page to apply');
    showToast('info', 'Test Mode', 'Test mode enabled - Reload page to apply');
}

/**
 * Disable test mode (for console usage)
 */
function disableTestMode() {
    if (!TEST_MODE_NO_SLS) {
        console.log('✅ Test mode is already disabled');
        return;
    }
    localStorage.setItem('test_mode_no_sls', 'false');
    console.log('✅ Test mode DISABLED - Reload page to apply');
    showToast('info', 'Test Mode', 'Test mode disabled - Reload page to apply');
}

/**
 * Update SLS port configuration
 * @param {number} port - New port number
 */
function updateSlsPort(port) {
    SLS_PORT = port;
    MLS_URL = `http://localhost:${SLS_PORT}`;
    MLS_WS_URL = `ws://localhost:${SLS_PORT}`;
    localStorage.setItem('sls-port', port.toString());
    console.log(`✅ SLS port updated to: ${port}`);
}

/**
 * Factory function to create appropriate TerminalDataSender
 * @param {string} type - 'websocket' or 'cloud'
 * @param {Object} params - Parameters for the sender
 * @returns {WebSocketTerminalDataSender|CloudTerminalDataSender|null}
 */
function createTerminalDataSender(type, params) {
    if (type === 'websocket') {
        const { webSocket } = params;
        return new WebSocketTerminalDataSender(webSocket);
    } else if (type === 'cloud') {
        const { terminalSharing, sessionId, ownerAgent } = params;
        return new CloudTerminalDataSender(terminalSharing, sessionId, ownerAgent);
    }
    return null;
}

// ========================================
// SECTION 5: FUNCTIONS - Permission & UI Helpers
// ========================================

/**
 * Update tab styling based on permission level
 * @param {string} sessionId - Session ID
 * @param {string} permission - 'readonly' or 'readwrite'
 */
function updateTabPermissionStyling(sessionId, permission) {
    const tab = document.getElementById(`tab-${sessionId}`);
    if (!tab) return;

    if (permission === 'readwrite') {
        tab.classList.add('write-access');
        tab.classList.remove('read-only');
    } else {
        tab.classList.add('read-only');
        tab.classList.remove('write-access');
    }
}

/**
 * Update all UI elements for a session permission change
 * Centralizes badge update, tab styling, and list refreshes
 * @param {string} sessionId - Session ID
 * @param {string} permission - 'readonly' or 'readwrite'
 * @param {Object} options - Optional flags for what to update
 */
function updatePermissionUI(sessionId, permission, options = {}) {
    const {
        updateBadge = true,
        updateTabStyling = true,
        updateMyShares = true,
        updateShared = true,
        updateStatus = true
    } = options;

    if (updateBadge) {
        updateSessionBadge(sessionId, permission);
    }

    if (updateTabStyling) {
        updateTabPermissionStyling(sessionId, permission);
    }

    if (updateMyShares) {
        updateMySharesList();
    }

    if (updateShared) {
        updateSharedTerminalsList();
    }

    // ✅ Always refresh the bottom status bar so the permission icon (👁️/✏️) stays in sync
    if (updateStatus && typeof updateStatusBar === 'function') {
        updateStatusBar();
    }
}

// ========================================
// SECTION 5: STATE MANAGEMENT
// ========================================
/**
 * Global state for terminal sessions and cloud sharing
 *
 * Session structure:
 * {
 *   terminal: Terminal,              // xterm.js instance
 *   dataSender: TerminalDataSender,  // WebSocket or Cloud transport
 *   config: Object,                  // Terminal config
 *   type: 'local' | 'ssh' | 'remote',
 *   name: String,                    // Display name
 *   connected: Boolean,
 *   fitAddon: FitAddon,             // Resize addon
 *   isShared: Boolean,              // true if sharing this terminal
 *   owner: String|null              // null = my terminal, "AgentName" = remote
 * }
 */
// Use TabSessionManager for centralized state management
const sessions = tabSessionManager.getAllSessions();

// Compatibility getter/setter for activeSessionId
Object.defineProperty(window, 'activeSessionId', {
    get: () => tabSessionManager.getActiveSessionId(),
    set: (value) => {
        tabSessionManager.activeSessionId = value;
    }
});

// activeSessionId is managed via tabSessionManager (accessed through window.activeSessionId property above)

// ========================================
// SECTION 5: CLOUD SHARING STATE
// ========================================
let terminalSharing = null;    // TerminalSharing instance (like air-hockey airHockeyGame)
let cloudConnected = false;
let cloudAgentName = null;

// File System Sharing (for proxying file system requests through owner)
const pendingFileSystemRequests = new Map(); // requestId → { resolve, timer }
let fsRequestIdCounter = 0;
const FS_REQUEST_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Create a pending file system request with automatic timeout cleanup
 * @param {string} requestId - Unique request identifier
 * @returns {Promise} - Promise that resolves with the response data
 */
function createPendingFsRequest(requestId) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (pendingFileSystemRequests.has(requestId)) {
                pendingFileSystemRequests.delete(requestId);
                reject(new Error('File system request timed out after 30 seconds'));
            }
        }, FS_REQUEST_TIMEOUT_MS);

        pendingFileSystemRequests.set(requestId, {
            resolve: (data) => {
                clearTimeout(timer);
                pendingFileSystemRequests.delete(requestId);
                resolve(data);
            },
            timer
        });
    });
}

// ========================================
// Tab Persistence Functions
// ========================================

/**
 * Save tab metadata to backend for persistence
 */
async function saveTabMetadata(sessionId, tabName, tabIcon, tabOrder) {
    if (!sessionId) return;

    try {
        await fetch(`${MLS_URL}/terminal/${sessionId}/metadata`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tabName: tabName,
                tabIcon: tabIcon,
                tabOrder: tabOrder,
                autoRestore: true
            })
        });

        // Also track in localStorage for page refresh detection
        trackOpenTab(sessionId);
    } catch (e) {
        console.warn('[TabPersistence] Failed to save metadata:', e);
    }
}

/**
 * Track open tabs in localStorage (survives page refresh)
 */
function trackOpenTab(sessionId) {
    try {
        const openTabs = getOpenTabs();
        if (!openTabs.includes(sessionId)) {
            openTabs.push(sessionId);
            localStorage.setItem('terminal_open_tabs', JSON.stringify(openTabs));
        }
    } catch (e) {
        console.warn('[TabPersistence] Failed to track open tab:', e);
    }
}

/**
 * Remove tab from localStorage tracking
 */
function untrackOpenTab(sessionId) {
    try {
        const openTabs = getOpenTabs();
        const filtered = openTabs.filter(id => id !== sessionId);
        localStorage.setItem('terminal_open_tabs', JSON.stringify(filtered));
        // If this was the last active tab, clear that key too
        if (localStorage.getItem('terminal_last_active_tab') === sessionId) {
            localStorage.removeItem('terminal_last_active_tab');
        }
    } catch (e) {
        console.warn('[TabPersistence] Failed to untrack tab:', e);
    }
}

/**
 * Get list of open tabs from localStorage
 */
function getOpenTabs() {
    try {
        const stored = localStorage.getItem('terminal_open_tabs');
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.warn('[TabPersistence] Failed to get open tabs:', e);
        return [];
    }
}

/**
 * Get tab icon for a session
 */
function getTabIcon(sessionId) {
    const tab = document.getElementById(`tab-${sessionId}`);
    if (!tab) return '💻';
    const iconEl = tab.querySelector('.tab-icon');
    return iconEl ? iconEl.textContent.trim() : '💻';
}

/**
 * Get tab title for a session
 */
function getTabTitle(sessionId) {
    const tab = document.getElementById(`tab-${sessionId}`);
    if (!tab) return null;
    const titleEl = tab.querySelector('.tab-title');
    return titleEl ? titleEl.textContent.trim() : null;
}

/**
 * Get tab order for a session
 */
function getTabOrder(sessionId) {
    const tabsContainer = document.getElementById('tabsContainer');
    const allTabs = Array.from(tabsContainer.querySelectorAll('.tab'));
    const tab = document.getElementById(`tab-${sessionId}`);
    return tab ? allTabs.indexOf(tab) : 0;
}

/**
 * Restore tabs from backend on page load
 *
 * Tab Persistence Strategy:
 * - Tabs ALWAYS persist in DB (even after SLS restart or SSH disconnect)
 * - Page refresh: Restore tabs that were open before refresh (from localStorage)
 * - SLS restart / late SLS: Restore ALL tabs; skip any that are already in DOM
 * - Tabs only disappear when user explicitly closes them (clicks X)
 */
async function restoreSavedTabs() {
    try {
        const response = await slsFetch(`${MLS_URL}/terminal/sessions`);
        if (!response.ok) return;

        const savedSessions = await response.json();

        // Get list of tabs that were open before page refresh
        const openTabs = getOpenTabs();
        console.log('[TabPersistence] Tabs open before refresh:', openTabs);

        // Check if this is a page refresh or first load after SLS restart
        const isPageRefresh = openTabs.length > 0;

        // Filter sessions to restore:
        let toRestore;
        if (isPageRefresh) {
            // Page refresh: Only restore tabs that were open before
            toRestore = savedSessions.filter(s => {
                const shouldRestore = openTabs.includes(s.sessionId) &&
                                     s.status === 'active' &&
                                     s.autoRestore !== false;
                if (!shouldRestore && s.status === 'active') {
                    console.log(`[TabPersistence] Skipping session ${s.sessionId} - not in openTabs`);
                }
                return shouldRestore;
            });
            console.log('[TabPersistence] Page refresh detected - restoring', toRestore.length, 'previously open tabs');
        } else {
            // First load or SLS restart: Restore ALL active sessions
            toRestore = savedSessions.filter(s => s.status === 'active' && s.autoRestore !== false);
            console.log('[TabPersistence] First load - restoring', toRestore.length, 'active sessions from DB');
        }

        // Sort by tab order
        toRestore.sort((a, b) => (a.tabOrder || 0) - (b.tabOrder || 0));

        // ✅ DUPLICATE GUARD: Skip sessions that already have a tab in the DOM.
        // This handles the case where:
        //   1. SLS was offline at page load → restoreSavedTabs() silently failed
        //   2. SLS came online later → sls-online fires → restoreSavedTabs() called again
        //   3. Some tabs may have been partially created; skip those already present.
        const toActuallyRestore = toRestore.filter(s => {
            const alreadyInDom = !!document.getElementById(`tab-${s.sessionId}`);
            const alreadyInMap = sessions.has(s.sessionId);
            if (alreadyInDom || alreadyInMap) {
                console.log(`[TabPersistence] Skipping already-open session: ${s.sessionId}`);
                return false;
            }
            return true;
        });

        console.log(`[TabPersistence] Restoring ${toActuallyRestore.length} of ${toRestore.length} sessions (${toRestore.length - toActuallyRestore.length} already open)`);

        for (const dbSession of toActuallyRestore) {
            await restoreTab(dbSession);
        }

        // After all tabs are restored, switch to the last active tab (or first as fallback)
        if (toActuallyRestore.length > 0) {
            const lastActiveId = localStorage.getItem('terminal_last_active_tab');
            const restoredIds = toActuallyRestore.map(s => s.sessionId);
            const targetId = (lastActiveId && restoredIds.includes(lastActiveId))
                ? lastActiveId
                : toActuallyRestore[0].sessionId;
            console.log('[TabPersistence] Switching to last active tab:', targetId);
            setTimeout(() => switchToSession(targetId), 200);
        }

        updateEmptyState();
        updateSessionCount();

    } catch (error) {
        console.warn('[TabPersistence] Failed to restore tabs:', error.message || 'Unknown error');
    }
}

/**
 * Restore a single tab (unified for both local and SSH)
 *
 * NOTE: Tab sessions in DB are persistent and NOT auto-deleted.
 * The backend connection may be dead, but the tab metadata persists
 * until the user explicitly closes the tab.
 */
async function restoreTab(dbSession) {
    const sessionId = dbSession.sessionId;
    const type = dbSession.type;

    console.log('[TabRestore] Restoring tab:', sessionId, 'type:', type, 'tabName:', dbSession.tabName);

    // Prepare default name and icon BEFORE any async operations
    // This ensures we always have a meaningful name, even if SSH connection fetch fails
    let name = dbSession.tabName;
    if (!name) {
        // Fallback: generate a meaningful default name
        if (type === 'local') {
            name = `Local (${(dbSession.shell || 'CMD').toUpperCase()})`;
        } else if (type === 'ssh') {
            // For SSH, try to create a meaningful name from available data
            name = 'SSH Session';  // Ultimate fallback
        } else {
            name = 'Terminal';
        }
    }
    const icon = dbSession.tabIcon || (type === 'local' ? '💻' : '🌐');

    try {
        // Create UI first with the saved name
        createTab(sessionId, name, icon, type);
        createTerminalPanel(sessionId);

        // Prepare session config based on type
        let config = { type };
        if (type === 'local') {
            config.shell = dbSession.shell || 'cmd';
        } else if (type === 'ssh') {
            if (!dbSession.sshConnectionId) {
                throw new Error('No SSH connection ID for SSH session');
            }
            // Get SSH connection details (this might fail for expired connections)
            try {
                const connResponse = await fetch(`${MLS_URL}/terminal/ssh-connections/${dbSession.sshConnectionId}`);
                if (!connResponse.ok) {
                    throw new Error('SSH connection not found');
                }
                const connection = await connResponse.json();
                config.connectionId = dbSession.sshConnectionId;
                config.name = connection.name;
                config.host = connection.host;
                config.port = connection.port;
                config.username = connection.username;
            } catch (sshError) {
                // SSH connection not found (expired or deleted)
                // Keep basic config, we'll show error to user later
                console.warn('[TabRestore] SSH connection not available:', sshError.message);
                config.connectionId = dbSession.sshConnectionId;
                config.error = sshError.message;
            }
        }

        // Create session object FIRST (before initTerminal)
        // so that initTerminal can store fitAddon in the session
        sessions.set(sessionId, {
            terminal: null,  // Will be set by initTerminal
            dataSender: null,  // WebSocket - will be set when connected
            config,
            type,
            name,
            connected: false,
            fitAddon: null,  // Will be set by initTerminal
            isShared: false,  // Runtime only - managed by TerminalSharing
            owner: null       // Runtime only - set when receiving shared tabs from cloud
        });

        // Initialize terminal (this will update the session with terminal and fitAddon)
        const terminal = initTerminal(sessionId);

        // Update session with terminal reference
        const session = sessions.get(sessionId);
        session.terminal = terminal;

        // Ensure terminal is fitted properly after a delay (important for restored sessions)
        setTimeout(() => {
            const currentSession = sessions.get(sessionId);
            if (currentSession && currentSession.fitAddon) {
                currentSession.fitAddon.fit();
                console.log('[TabRestore] Terminal fitted to container');
            }
        }, 200);

        // Check if backend connection is alive (use isAlive field from API)
        const isAlive = dbSession.isAlive === true;

        if (isAlive) {
            // ✅ Backend connection is ALIVE! Auto-reconnect WebSocket
            console.log('[TabRestore] Backend connection alive, auto-connecting WebSocket:', sessionId);
            terminal.clear();
            if (type === 'ssh' && config.host) {
                terminal.writeln(`\x1b[36mHost: ${config.username}@${config.host}:${config.port}\x1b[0m`);
            }

            // Seed detectedPrompt from localStorage (updated live by writeTerminalData)
            const storedPrompt = storageManager.getDetectedPrompt(sessionId);
            if (storedPrompt) {
                const session = sessions.get(sessionId);
                if (session) session.detectedPrompt = storedPrompt;
                terminal.write(storedPrompt);
            }

            setTimeout(() => connectWebSocket(sessionId), 100);
        } else {
            // ❌ Backend connection is DEAD — tab persisted in DB, show simple disconnect hint
            console.log('[TabRestore] Backend connection dead, tab persisted:', sessionId);
            terminal.clear();
            if (type === 'ssh' && config.host) {
                terminal.writeln(`\x1b[2m${config.username}@${config.host}:${config.port}\x1b[0m`);
            }
            terminal.writeln('');
            terminal.writeln('\x1b[1;31m✖ Disconnected\x1b[0m  \x1b[2mPress \x1b[0m\x1b[1;32mR\x1b[0m\x1b[2m to reconnect\x1b[0m');
            terminal.writeln('');
        }
    } catch (error) {
        console.error('[TabRestore] Failed to restore session', sessionId, ':', error);
        // Don't delete from DB! Tab persists until user closes it
        // Just show error in terminal
        const session = sessions.get(sessionId);
        const terminal = session?.terminal;

        if (terminal) {
            terminal.clear();
            terminal.writeln('\x1b[31m✖ Failed to restore tab\x1b[0m');
            terminal.writeln('');
            terminal.writeln(`\x1b[33mError: ${error.message}\x1b[0m`);
            terminal.writeln('');
            terminal.writeln('\x1b[36mYou can close this tab or contact support.\x1b[0m');

            // Ensure terminal is fitted even on error
            setTimeout(() => {
                if (session && session.fitAddon) {
                    session.fitAddon.fit();
                    console.log('[TabRestore] Terminal fitted after error');
                }
            }, 200);
        }
    }
}

/**
 * Update all session references when session ID changes
 */
async function updateSessionReferences(oldSessionId, newSessionId) {
    console.log('[Session] Updating references from', oldSessionId, 'to', newSessionId);

    const session = sessions.get(oldSessionId);
    if (!session) return;

    // Update tab
    const tab = document.getElementById(`tab-${oldSessionId}`);
    if (tab) {
        tab.id = `tab-${newSessionId}`;
        tab.onclick = () => switchToSession(newSessionId);
        const closeBtn = tab.querySelector('.tab-close');
        if (closeBtn) {
            closeBtn.onclick = (e) => { e.stopPropagation(); closeTab(newSessionId); };
        }
    }

    // Update panel
    const panel = document.getElementById(`panel-${oldSessionId}`);
    if (panel) panel.id = `panel-${newSessionId}`;

    // Update terminal div
    const termDiv = document.getElementById(`terminal-${oldSessionId}`);
    if (termDiv) termDiv.id = `terminal-${newSessionId}`;

    // Update overlays
    const connectingDiv = document.getElementById(`connecting-${oldSessionId}`);
    if (connectingDiv) connectingDiv.id = `connecting-${newSessionId}`;

    // Update sessions map
    sessions.delete(oldSessionId);
    sessions.set(newSessionId, session);

    // Update active session if needed
    if (activeSessionId === oldSessionId) {
        activeSessionId = newSessionId;
    }

    // Update backend metadata with new session ID
    try {
        await saveTabMetadata(newSessionId, session.name, getTabIcon(newSessionId), getTabOrder(newSessionId));
    } catch (error) {
        console.warn('[Session] Failed to update backend metadata:', error);
    }
}

// ========================================
// Toast Notifications
// ========================================
// ========================================
// Toast Notification System
// ========================================
const MAX_VISIBLE_TOASTS = 3;
let activeToasts = [];
let toastQueue = [];
let lastToastMessage = null;
let lastToastTime = 0;

function showToast(type, title, message, duration = 4000) {
    // Prevent duplicate toasts within 500ms
    const now = Date.now();
    const toastKey = `${type}-${title}-${message}`;
    if (toastKey === lastToastMessage && (now - lastToastTime) < 500) {
        console.log('[Toast] Ignoring duplicate toast');
        return;
    }
    lastToastMessage = toastKey;
    lastToastTime = now;

    const container = document.getElementById('toastContainer');

    // If we have max visible toasts, add to queue
    if (activeToasts.length >= MAX_VISIBLE_TOASTS) {
        toastQueue.push({ type, title, message, duration });
        updateToastCounter();
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.dataset.toastKey = toastKey;

    // Check if message contains HTML tags
    const isHtml = /<\/?[a-z][\s\S]*>/i.test(message);

    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

    if (isHtml) {
        // Use innerHTML for HTML content
        toast.innerHTML = `<div style="display: flex; align-items: flex-start; gap: 8px;">
            <span style="flex-shrink: 0; font-size: 16px;">${icons[type] || 'ℹ'}</span>
            <div style="flex: 1;">
                ${title ? `<div style="font-weight: 600; margin-bottom: 4px;">${title}</div>` : ''}
                <div>${message}</div>
            </div>
        </div>`;
    } else {
        // Use textContent for plain text (safer)
        toast.textContent = `${icons[type] || 'ℹ'} ${title}: ${message}`;
    }

    container.appendChild(toast);
    activeToasts.push(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
                activeToasts = activeToasts.filter(t => t !== toast);

                // Show next queued toast if any
                if (toastQueue.length > 0) {
                    const next = toastQueue.shift();
                    showToast(next.type, next.title, next.message, next.duration);
                } else {
                    updateToastCounter();
                }
            }
        }, 300);
    }, duration);

    updateToastCounter();
}

function updateToastCounter() {
    const container = document.getElementById('toastContainer');
    let counter = container.querySelector('.toast-counter');

    if (toastQueue.length > 0) {
        if (!counter) {
            counter = document.createElement('div');
            counter.className = 'toast toast-info toast-counter';
            counter.style.cssText = 'cursor: default; opacity: 0.8; font-size: 12px;';
            container.appendChild(counter);
        }
        counter.textContent = `+${toastQueue.length} more`;
    } else {
        if (counter) {
            counter.remove();
        }
    }
}

// ========================================
// SLS Health Check
// ========================================
async function checkMlsHealth(showNotification = false) {
    const statusDot = document.getElementById('mlsStatus');
    const statusText = document.getElementById('mlsStatusText');

    // Helper to update the SLS indicator group tooltip
    const setSlsTitle = (msg) => {
        const grp = document.getElementById('slsIndicatorGroup');
        if (grp) grp.title = msg;
    };

    // In test mode, show special status
    if (TEST_MODE_NO_SLS) {
        if (statusDot) statusDot.className = 'top-status-dot offline';
        if (statusText) statusText.textContent = 'Local';
        setSlsTitle('Test Mode – SLS disabled');
        console.log('🧪 TEST MODE: Skipping SLS health check');
        return false;
    }

    if (statusDot) statusDot.className = 'top-status-dot checking';
    if (statusText) statusText.textContent = 'Local';
    setSlsTitle('Local Service: Checking…');

    try {
        // Health endpoint is public - use regular fetch (no auth needed)
        // Don't use slsFetch to avoid unnecessary token requests for health checks
        const response = await fetch(`${MLS_URL}/health`, {
            method: 'GET',
            // Add timeout to detect offline faster
            signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        if (response.ok) {
            if (statusDot) statusDot.className = 'top-status-dot online';
            if (statusText) statusText.textContent = 'Local';
            setSlsTitle(`Local Service: Online (port ${SLS_PORT})`);

            // Check if state changed: null→online or offline→online
            const previousState = slsCurrentState;
            slsCurrentState = 'online';

            // Dispatch SLS online event (only on state change)
            if (previousState !== 'online') {
                window.dispatchEvent(new CustomEvent('sls-online', {
                    detail: { previousState, currentState: 'online', timestamp: new Date() }
                }));
                console.log('[SLS] 🟢 State changed: ONLINE - Event dispatched');
            }

            updateSlsDependentButtons(true);

            // Show notification only on state change
            if (showNotification && previousState !== 'online') {
                showToast('success', 'Local Service Online', 'SDK Local Service is running');
            }
            return true;
        }

        // Non-OK response (4xx, 5xx)
        throw new Error(`Health check failed with status: ${response.status}`);
    } catch (error) {
        if (statusDot) statusDot.className = 'top-status-dot offline';
        if (statusText) statusText.textContent = 'SLS';
        setSlsTitle(`Local Service: Offline – cannot connect on localhost:${SLS_PORT}`);

        console.warn('[Health] SLS health check failed:', error.message);

        // Check if state changed: null→offline or online→offline
        const previousState = slsCurrentState;
        slsCurrentState = 'offline';

        // Dispatch SLS offline event (only on state change)
        if (previousState !== 'offline') {
            window.dispatchEvent(new CustomEvent('sls-offline', {
                detail: { previousState, currentState: 'offline', timestamp: new Date(), error: error.message }
            }));
            console.log('[SLS] 🔴 State changed: OFFLINE - Event dispatched');
        }

        updateSlsDependentButtons(false);

        // Show notification only on state change
        if (showNotification && previousState !== 'offline') {
            const errorMsg = error.name === 'TimeoutError'
                ? 'Connection timeout - SLS not responding'
                : `Please start SDK Local Service on localhost:${SLS_PORT}`;
            showToast('warning', 'Local Service Offline', errorMsg);
        }
        return false;
    }
}

// ========================================
// Session List (Sidebar)
// ========================================
async function loadSshConnections() {
    try {
        const response = await slsFetch(`${MLS_URL}/terminal/ssh-connections`);
        if (!response.ok) throw new Error('Failed to load');
        return await response.json();
    } catch (error) {
        console.error('Failed to load SSH connections:', error);
        return [];
    }
}

/**
 * Render the sidebar session list (Quick Actions + SSH Connections).
 * Shared between refreshConnections() and the sls-online event handler so
 * the sls-online path never calls checkMlsHealth() again (avoids a loop).
 */
async function _renderSessionList(container) {
    if (!container) return;
    const connections = await loadSshConnections();

    let html = `
        <div class="session-group">
            <div class="session-group-title">Quick Actions</div>
            <div class="session-item" onclick="createLocalTerminal('cmd')">
                <div class="session-icon local">💻</div>
                <div class="session-details">
                    <div class="session-name">CMD Terminal</div>
                    <div class="session-info">Windows Command Prompt</div>
                </div>
            </div>
            <div class="session-item" onclick="createLocalTerminal('bash')">
                <div class="session-icon local" style="background: linear-gradient(135deg, #22d3ee, #059669);">🐧</div>
                <div class="session-details">
                    <div class="session-name">Bash Terminal</div>
                    <div class="session-info">WSL / Git Bash</div>
                </div>
            </div>
            <div class="session-item" onclick="createLocalTerminal('powershell')">
                <div class="session-icon local" style="background: linear-gradient(135deg, #a78bfa, #7c3aed);">⚡</div>
                <div class="session-details">
                    <div class="session-name">PowerShell</div>
                    <div class="session-info">Windows PowerShell</div>
                </div>
            </div>
        </div>
    `;

    if (connections.length > 0) {
        html += `
            <div class="session-group">
                <div class="session-group-title">SSH Connections (${connections.length})</div>
                ${connections.map(conn => `
                    <div class="session-item"
                         onclick="connectToSsh(${conn.id}, '${escapeHtml(conn.name)}', '${escapeHtml(conn.host)}', ${conn.port}, '${escapeHtml(conn.username)}')"
                         oncontextmenu="showSessionContextMenu(event, ${conn.id}, '${escapeHtml(conn.name)}', '${escapeHtml(conn.host)}', ${conn.port}, '${escapeHtml(conn.username)}')"
                         id="conn-${conn.id}"
                         data-connection-id="${conn.id}"
                         data-connection-name="${escapeHtml(conn.name)}"
                         data-host="${escapeHtml(conn.host)}"
                         data-port="${conn.port}"
                         data-username="${escapeHtml(conn.username)}">
                        <div class="session-icon ssh">🌐</div>
                        <div class="session-details">
                            <div class="session-name">${escapeHtml(conn.name)}</div>
                            <div class="session-info">${escapeHtml(conn.username)}@${escapeHtml(conn.host)}:${conn.port}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    container.innerHTML = html;
}

/**
 * Refresh connections sidebar.
 * Always fires a background health check so that if SLS just came online,
 * the sls-online event triggers tab restore automatically.
 * Does NOT await the health check — sidebar renders immediately.
 */
async function refreshConnections() {
    console.log('[Refresh] Refreshing connections sidebar + triggering health check...');

    // Fire health check in background — no await.
    // If SLS just came online this fires sls-online → restoreSavedTabs + _renderSessionList.
    checkMlsHealth(true).catch(() => {});

    // Reload sidebar immediately (returns empty if SLS offline, that's fine)
    const container = document.getElementById('sessionList');
    await _renderSessionList(container);
}

// Make function globally accessible
window.refreshConnections = refreshConnections;

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}

/**
 * Clean terminal output from shells running through a pipe (no real PTY).
 *
 * Bash without a PTY produces extra leading spaces per line because tools
 * can't detect terminal width properly.
 *
 * - Strips leading whitespace from each line only
 * - NEVER modifies \r, \n, or \r\n — bash manages its own line endings
 *
 * Equivalent Java (TerminalStringUtils.cleanOutput):
 *   String[] lines = output.split("(?<=\n)");
 *   for (String line : lines) sb.append(line.stripLeading());
 *
 * @param {string} data  Raw output from the terminal WebSocket
 * @param {string} shell Shell type ('bash', 'cmd', etc.)
 * @returns {string} Cleaned output with leading whitespace stripped per line
 */
function cleanOutput(data, shell) {
    if (!data) return data;
    // Only clean bash — cmd/powershell manage their own formatting
    if (shell !== 'bash') return data;
    // Normalize all line endings first
    const normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Strip leading spaces from each line, restore CRLF for xterm.js.
    // IMPORTANT: skip trimStart() on the FIRST segment — it may be a mid-line
    // continuation of a previous chunk (e.g. " hi" after "echo"). Only lines
    // that follow a \n are guaranteed to be line-starts.
    const lines = normalized.split('\n');
    return lines
        .map((line, i) => i === 0 ? line : line.trimStart())
        .join('\r\n');
}

// ========================================
// Tab Scrolling
// ========================================
function scrollTabsLeft() {
    const tabBar = document.getElementById('tabBar');
    tabBar.scrollBy({ left: -200, behavior: 'smooth' });
    setTimeout(checkTabOverflow, 300);
}

function scrollTabsRight() {
    const tabBar = document.getElementById('tabBar');
    tabBar.scrollBy({ left: 200, behavior: 'smooth' });
    setTimeout(checkTabOverflow, 300);
}

function checkTabOverflow() {
    const tabBar = document.getElementById('tabBar');
    const leftBtn = document.getElementById('tabScrollLeft');
    const rightBtn = document.getElementById('tabScrollRight');

    const isOverflowing = tabBar.scrollWidth > tabBar.clientWidth;
    const canScrollLeft = tabBar.scrollLeft > 0;
    const canScrollRight = tabBar.scrollLeft < (tabBar.scrollWidth - tabBar.clientWidth - 5);

    if (isOverflowing) {
        if (canScrollLeft) leftBtn.classList.add('visible');
        else leftBtn.classList.remove('visible');

        if (canScrollRight) rightBtn.classList.add('visible');
        else rightBtn.classList.remove('visible');
    } else {
        leftBtn.classList.remove('visible');
        rightBtn.classList.remove('visible');
    }
}

// ========================================
// Tab Management
// ========================================
function createTab(sessionId, title, icon, type) {
    // ✅ Validate and sanitize tab title - never show null/undefined
    if (!title || title === 'null' || title === 'undefined') {
        console.warn(`[createTab] Invalid title "${title}" for session ${sessionId}, using fallback`);
        title = type === 'ssh' ? 'SSH Session' : type === 'local' ? 'Terminal' : 'Session';
    }

    const tabBar = document.getElementById('tabBar');
    const addBtn = tabBar.querySelector('.tab-add');

    const tab = document.createElement('div');
    tab.className = 'tab active';
    tab.id = `tab-${sessionId}`;
    tab.dataset.sessionId = sessionId;
    tab.innerHTML = `
        <span class="tab-icon">${icon}</span>
        <span class="tab-title">${escapeHtml(title)}</span>
        <span class="tab-shared-badge" style="display: none;">📡</span>
        <span class="tab-close" onclick="event.stopPropagation(); closeTab('${sessionId}')">×</span>
    `;
    tab.onclick = () => switchToSession(sessionId);
    tab.oncontextmenu = (e) => showTabContextMenu(e, sessionId);

    tabBar.insertBefore(tab, addBtn);

    // Ensure add button stays at the end
    ensureAddButtonAtEnd();

    // Deactivate other tabs
    tabBar.querySelectorAll('.tab').forEach(t => {
        if (t.id !== `tab-${sessionId}`) t.classList.remove('active');
    });

    // Set as active session and ensure it gets focus
    activeSessionId = sessionId;

    // Check for tab overflow and show/hide scroll buttons
    setTimeout(checkTabOverflow, 100);
}

/**
 * Ensure the Add Tab button is always at the end of the tab bar
 * This prevents it from appearing in the middle when mixing terminal and note tabs
 */
function ensureAddButtonAtEnd() {
    const tabBar = document.getElementById('tabBar') || document.querySelector('.tab-bar');
    const addBtn = tabBar?.querySelector('.tab-add');

    if (tabBar && addBtn) {
        // Move add button to the very end
        tabBar.appendChild(addBtn);
    }
}

function updateTab(sessionId, disconnected = false) {
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) {
        if (disconnected) {
            tab.classList.add('disconnected');
        } else {
            tab.classList.remove('disconnected');
        }
    }
}

/**
 * Update tab shared indicator badge
 */
function updateTabSharedIndicator(sessionId, isShared) {
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) {
        // Toggle the shared class for visual indicator (icon)
        if (isShared) {
            tab.classList.add('shared');
        } else {
            tab.classList.remove('shared');
        }

        // Also update badge if exists
        const badge = tab.querySelector('.tab-shared-badge');
        if (badge) {
            badge.style.display = isShared ? 'inline' : 'none';
        }
    }
}

function removeTab(sessionId) {
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) {
        tab.remove();
        // Check tab overflow after removal
        setTimeout(checkTabOverflow, 100);
    }
}

function switchToSession(sessionId) {
    // Use TabSessionManager for core switching logic
    tabSessionManager.switchTo(sessionId);

    // Mobile: Auto-close sidebar
    if (window.innerWidth <= 480) {
        tabSessionManager.closeMobileSidebar();
    }

    // Update empty state
    updateEmptyState();

    // ✅ Update file explorer button state for the new active session
    const session = sessions.get(sessionId);
    if (session) {
        updateFileExplorerButtonState(session);
    }
}

function closeTab(sessionId) {
    closeSession(sessionId);
}

function closeActiveTab() {
    if (activeSessionId) {
        closeSession(activeSessionId);
    }
}

function updateEmptyState() {
    const emptyState = document.getElementById('emptyState');
    emptyState.style.display = sessions.size === 0 ? 'flex' : 'none';
    updateStatusBar();
}

/**
 * Update the bottom status bar with current session info
 */
function updateStatusBar() {

    // Update session count
    const statusSessions = document.getElementById('statusSessions');
    if (statusSessions) {
        statusSessions.textContent = sessions.size;
    }

    // Update active session info
    const statusActive = document.getElementById('statusActive');
    if (statusActive && activeSessionId) {
        const session = sessions.get(activeSessionId);
        if (session) {
            // Show tab name + type detail
            let activeInfo = session.name || 'Unknown';

            // ✅ Add permission indicator for remote (shared) sessions
            if (session.type === 'remote' && session.permission) {
                const hasWriteAccess = session.permission === 'readwrite' || session.permission === 'write';
                const permIcon = hasWriteAccess ? '✏️' : '👁️';
                activeInfo = `${permIcon} ${activeInfo}`;
            }

            // Note: For remote (shared) sessions, session.name already includes owner in format:
            // "session-name (Owner-Name)" so we don't need to append "via owner" again
            // For SSH sessions, session.name already contains proper format like "root@host (host)"

            statusActive.textContent = activeInfo;
        } else {
            statusActive.textContent = 'None';
        }
    } else if (statusActive) {
        statusActive.textContent = 'None';
    }
}

function updateSessionCount() {
    document.getElementById('statusSessions').textContent = sessions.size;
}

// ========================================
// Sidebar Tab Management
// ========================================

/**
 * Switch between sidebar tabs (sessions, sftp, shared, myshares)
 */
function switchSidebarTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Update panels
    document.querySelectorAll('.sidebar-panel').forEach(panel => {
        if (panel.id === `panel-${tabName}`) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });
}

// Make globally accessible for inline onclick handlers
window.switchSidebarTab = switchSidebarTab;

/**
 * Update sidebar badges (shared count, my shares count)
 */
function updateSidebarBadges() {
    // Count shared sessions (received from others)
    const sharedCount = Array.from(sessions.values()).filter(s => s.owner && s.owner !== cloudAgentName).length;
    const sharedBadge = document.getElementById('sharedBadge');
    if (sharedBadge) {
        if (sharedCount > 0) {
            sharedBadge.textContent = sharedCount;
            sharedBadge.style.display = 'block';
        } else {
            sharedBadge.style.display = 'none';
        }
    }

    // Count my shared sessions
    const mySharesCount = Array.from(sessions.values()).filter(s => s.isShared && !s.owner).length;
    const mysharesBadge = document.getElementById('mysharesBadge');
    if (mysharesBadge) {
        if (mySharesCount > 0) {
            mysharesBadge.textContent = mySharesCount;
            mysharesBadge.style.display = 'block';
        } else {
            mysharesBadge.style.display = 'none';
        }
    }
}

/**
 * Refresh functions for sidebar panels
 */
function refreshSharedSessions() {
    // Refresh shared sessions list
    updateSharedTerminalsList();
}

function refreshMyShares() {
    // Refresh my shares list
    updateMySharesList();
}

function closeSftpPanel() {
    switchSidebarTab('sessions');
}

function closeFileExplorerPanel() {
    switchSidebarTab('sessions');
}

// Make globally accessible for inline onclick handlers
window.refreshSharedSessions = refreshSharedSessions;
window.refreshMyShares = refreshMyShares;
window.closeSftpPanel = closeSftpPanel;
window.closeFileExplorerPanel = closeFileExplorerPanel;

/**
 * Update my shares list in sidebar
 */
function updateMySharesList() {
    const container = document.getElementById('mysharesList');
    if (!container) return;

    // Filter my shared sessions using Map.entries() to get both key and value
    const mySharesEntries = Array.from(sessions.entries())
        .filter(([_, session]) => session.isShared && !session.owner);

    if (mySharesEntries.length === 0) {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 11px;">
                No shared terminals yet.<br>
                Share a terminal to see it here.
            </div>
        `;
        return;
    }

    let html = '';
    mySharesEntries.forEach(([sessionId, session]) => {
        const globalPerm = session.permission || 'readonly';
        const globalPermIcon = globalPerm === 'readwrite' ? '✏️' : '👁️';
        const globalPermLabel = globalPerm === 'readwrite' ? 'Read-Write' : 'Read-Only';

        html += `
            <div class="session-item" style="flex-direction: column; align-items: stretch;">
                <div class="session-item-header" 
                     style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 4px; transition: background 0.15s;"
                     onclick="switchToSession('${sessionId}')"
                     onmouseover="this.style.background='rgba(255,255,255,0.05)'"
                     onmouseout="this.style.background='transparent'"
                     title="Click to switch to this session">
                    <div class="session-icon">📤</div>
                    <div class="session-details" style="flex: 1;">
                        <div class="session-name">${escapeHtml(session.name)}</div>
                        <div class="session-info">${globalPermIcon} Global: ${globalPermLabel}</div>
                    </div>
                </div>`;

        // ✅ Get viewers for THIS specific session (not all connected agents)
        const sessionViewers = (terminalSharing && cloudConnected)
            ? terminalSharing.getSessionViewers(sessionId)
            : [];

        // Show connected viewers with per-agent permissions
        if (sessionViewers.length > 0) {
            html += `<div class="viewer-list">`;
            sessionViewers.forEach(agent => {
                // Per-agent permission (defaults to global)
                const agentPerm = session.agentPermissions?.[agent] || globalPerm;
                const hasCustomPerm = !!session.agentPermissions?.[agent];
                const hasWriteAccess = agentPerm === 'readwrite' || agentPerm === 'write';
                const agentPermIcon = hasWriteAccess ? '✏️' : '👁️';
                const permLabel = hasWriteAccess ? 'Read-Write' : 'Read-Only';
                const customBadge = hasCustomPerm ? ' (custom)' : '';

                html += `
                    <div class="viewer-item" 
                         oncontextmenu="showViewerContextMenu(event, '${sessionId}', '${agent}'); return false;"
                         title="Right-click to change permissions">
                        <div class="viewer-dot"></div>
                        <span class="viewer-name">${escapeHtml(agent)}</span>
                        <span class="viewer-perm-indicator" title="${permLabel}${customBadge}">
                            ${agentPermIcon}
                        </span>
                    </div>`;
            });
            html += `</div>`;
        } else {
            html += `<div style="padding: 2px 8px 4px 20px; font-size: 10px; color: var(--text-muted); font-style: italic;">No viewers connected</div>`;
        }

        html += `</div>`;
    });

    container.innerHTML = html;

    // ✅ Update host indicator whenever the shares list changes
    if (typeof updateCloudHostIndicator === 'function') {
        updateCloudHostIndicator();
    }
}

// ========================================
// Sidebar Resize Handle
// ========================================

let isResizing = false;
let startX = 0;
let startWidth = 0;

function initSidebarResize() {
    const resizeHandle = document.getElementById('resizeHandle');
    const sidebar = document.getElementById('sidebar');

    console.log('[SidebarResize] Initializing...');
    console.log('[SidebarResize] resizeHandle:', resizeHandle);
    console.log('[SidebarResize] sidebar:', sidebar);

    if (!resizeHandle || !sidebar) {
        console.warn('[SidebarResize] Missing elements - resize disabled');
        return;
    }

    console.log('[SidebarResize] ✅ Resize handle initialized');

    resizeHandle.addEventListener('mousedown', (e) => {
        console.log('[SidebarResize] Mouse down - starting resize');
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        resizeHandle.classList.add('resizing');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const diff = e.clientX - startX;
        const newWidth = startWidth + diff;

        // Min 150px, max 50% of window width
        const minWidth = 150;
        const maxWidth = window.innerWidth * 0.5;

        if (newWidth >= minWidth && newWidth <= maxWidth) {
            sidebar.style.width = `${newWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            console.log('[SidebarResize] Mouse up - resize complete');
            isResizing = false;
            resizeHandle.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// ========================================
// Terminal Panel Creation
// ========================================
function createTerminalPanel(sessionId) {
    const wrapper = document.getElementById('terminalWrapper');

    const panel = document.createElement('div');
    panel.className = 'terminal-panel active';
    panel.id = `panel-${sessionId}`;
    panel.innerHTML = `
        <div class="terminal-content" id="terminal-${sessionId}"></div>
        <div class="connecting-overlay" id="connecting-${sessionId}">
            <div class="connecting-spinner"></div>
            <div class="connecting-text">Connecting...</div>
            <div class="connecting-subtext">Establishing connection to remote server</div>
        </div>
    `;

    // Deactivate other panels
    wrapper.querySelectorAll('.terminal-panel').forEach(p => p.classList.remove('active'));
    wrapper.appendChild(panel);

    // Attach right-click context menu after DOM is ready
    setTimeout(() => attachTerminalContextMenu(sessionId), 0);

    return panel;
}

// ========================================
// Create Local Terminal
// ========================================
const MAX_SESSIONS = 20; // Maximum concurrent terminal sessions

async function createLocalTerminal(shell = 'cmd') {
    if (TEST_MODE_NO_SLS) {
        showToast('warning', '🧪 Test Mode', 'Local terminals disabled in test mode. Connect to cloud to view shared sessions.');
        console.warn('🧪 TEST MODE: Local terminal creation disabled');
        return;
    }

    // Guard against too many sessions
    if (sessions.size >= MAX_SESSIONS) {
        showToast('warning', 'Session Limit', `Maximum ${MAX_SESSIONS} concurrent sessions reached. Close some sessions first.`);
        return;
    }

    const healthy = await checkMlsHealth(false, true);
    if (!healthy) {
        showToast('error', 'SLS Unavailable', 'Please start SDK Local Service first');
        return;
    }

    try {
        const response = await slsFetch(`${MLS_URL}/terminal/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'local', shell })
        });

        if (!response.ok) throw new Error('Failed to create terminal');

        const result = await response.json();

        // Check for error in response
        if (result.error) {
            throw new Error(result.error);
        }

        const sessionId = result.sessionId;

        // Determine icon and name based on shell
        let icon = '💻';
        let shellName = shell.toUpperCase();
        if (shell === 'bash') {
            icon = '🐧';
            shellName = 'Bash';
        } else if (shell === 'powershell') {
            icon = '⚡';
            shellName = 'PowerShell';
        } else {
            shellName = 'CMD';
        }

        const name = `Local (${shellName})`;

        // Create UI
        createTab(sessionId, name, icon, 'local');
        createTerminalPanel(sessionId);

        // Initialize terminal
        const terminal = initTerminal(sessionId);

        // Store session
        sessions.set(sessionId, {
            terminal,
            dataSender: null,  // WebSocket - will be set when connected
            config: { type: 'local', shell },
            type: 'local',
            name,
            connected: false,
            isShared: false,  // ✅ Not shared by default
            owner: null  // ✅ null = my local session
        });

        // Save tab metadata for persistence
        const tabOrder = sessions.size;
        await saveTabMetadata(sessionId, name, icon, tabOrder);

        // Connect WebSocket
        await new Promise(resolve => setTimeout(resolve, 200));
        connectWebSocket(sessionId);

        // Switch to the new session (auto-focus)
        switchToSession(sessionId);
        updateEmptyState();
        updateSessionCount();

        showToast('success', 'Terminal Created', `Local ${shellName} terminal started`);

        // ✅ AUTO-CREATE FILE SYSTEM SESSION FOR THIS LOCAL TERMINAL
        // Backend auto-creates on-demand: await createFileSystemSessionForTerminal(sessionId);

    } catch (error) {
        console.error('Failed to create terminal:', error);
        showToast('error', 'Error', error.message);
    }
}

// ========================================
// Connect to SSH
// ========================================
async function connectToSsh(connectionId, name, host, port, username) {
    if (TEST_MODE_NO_SLS) {
        showToast('warning', '🧪 Test Mode', 'SSH terminals disabled in test mode. Connect to cloud to view shared sessions.');
        console.warn('🧪 TEST MODE: SSH connection disabled');
        return;
    }

    const healthy = await checkMlsHealth(false, true);
    if (!healthy) {
        showToast('error', 'SLS Unavailable', 'Please start SDK Local Service first');
        return;
    }

    // Guard against too many sessions
    if (sessions.size >= MAX_SESSIONS) {
        showToast('warning', 'Session Limit', `Maximum ${MAX_SESSIONS} concurrent sessions reached. Close some sessions first.`);
        return;
    }

    // Generate temporary session ID for UI
    const tempSessionId = 'ssh-temp-' + Date.now();
    const displayName = `${name} (${host})`;

    // Create UI immediately with connecting loader
    createTab(tempSessionId, displayName, '🌐', 'ssh');
    createTerminalPanel(tempSessionId);

    // Initialize terminal
    const terminal = initTerminal(tempSessionId);

    // Show connecting overlay
    showConnectingOverlay(tempSessionId);

    // Store temporary session
    sessions.set(tempSessionId, {
        terminal,
        dataSender: null,  // WebSocket - will be set when connected
        config: { type: 'ssh', connectionId, name, host, port, username },
        type: 'ssh',
        name: displayName,
        connected: false,
        isShared: false,  // ✅ Not shared by default
        owner: null  // ✅ null = my local session
    });

    // Switch to the new session immediately
    switchToSession(tempSessionId);
    updateEmptyState();
    updateSessionCount();

    try {
        // Now connect to backend
        const response = await fetch(`${MLS_URL}/terminal/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ssh', connectionId }),
            signal: AbortSignal.timeout(15000) // 15 second timeout for SSH connections
        });

        const result = await response.json();

        if (result.error) {
            // Remove temp session and show error
            closeSession(tempSessionId);
            showToast('error', 'Connection Failed', result.error);
            return;
        }

        const sessionId = result.sessionId;

        // Update session ID (from temp to real)
        const sessionData = sessions.get(tempSessionId);

        // Check if session was closed while connecting (user clicked X during connection)
        if (!sessionData) {
            console.warn(`[SSH] Session ${tempSessionId} was closed during connection`);
            // Clean up the backend session since frontend is gone
            fetch(`${MLS_URL}/terminal/${sessionId}`, { method: 'DELETE' }).catch(() => {});
            showToast('info', 'Connection Cancelled', 'Terminal was closed during connection');
            return;
        }

        // CRITICAL: Dispose old terminal and re-initialize with real session ID
        // This fixes the closure issue where onData captures the wrong sessionId
        if (sessionData.terminal) {
            sessionData.terminal.dispose();
        }

        sessions.delete(tempSessionId);

        // Update DOM IDs FIRST
        const tab = document.getElementById(`tab-${tempSessionId}`);
        if (tab) {
            tab.id = `tab-${sessionId}`;
            tab.dataset.sessionId = sessionId;

            // CRITICAL: Update tab's onclick and close button to use real sessionId
            tab.onclick = () => switchToSession(sessionId);

            // CRITICAL: Update context menu handler to use real sessionId
            tab.oncontextmenu = (e) => showTabContextMenu(e, sessionId);

            // Update close button's onclick handler
            const closeBtn = tab.querySelector('.tab-close');
            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    closeSession(sessionId);  // Use real sessionId!
                };
            }

            console.log(`[SSH] Tab updated: ${tempSessionId} → ${sessionId}`);
        }

        const panel = document.getElementById(`panel-${tempSessionId}`);
        if (panel) {
            panel.id = `panel-${sessionId}`;
            // Update inner element IDs
            const terminalContent = panel.querySelector(`#terminal-${tempSessionId}`);
            if (terminalContent) terminalContent.id = `terminal-${sessionId}`;
            const connectingOverlay = panel.querySelector(`#connecting-${tempSessionId}`);
            if (connectingOverlay) connectingOverlay.id = `connecting-${sessionId}`;
            const reconnectOverlay = panel.querySelector(`#reconnect-${tempSessionId}`);
            if (reconnectOverlay) reconnectOverlay.id = `reconnect-${sessionId}`;
        }

        // Re-initialize terminal with real session ID (fixes input handler closure)
        const newTerminal = initTerminal(sessionId);
        sessionData.terminal = newTerminal;

        // Now store the session with the real ID
        sessions.set(sessionId, sessionData);

        // Update active session ID
        if (activeSessionId === tempSessionId) {
            activeSessionId = sessionId;
        }

        console.log(`[SSH] Session ID updated: ${tempSessionId} → ${sessionId}`);

        // Save tab metadata for persistence
        const tabOrder = sessions.size;
        await saveTabMetadata(sessionId, sessionData.name, '🌐', tabOrder);

        // Connect WebSocket
        await new Promise(resolve => setTimeout(resolve, 200));
        connectWebSocket(sessionId);

        // Hide connecting overlay after WebSocket connects
        setTimeout(() => hideConnectingOverlay(sessionId), 500);

        showToast('success', 'SSH Connected', `Connected to ${host}`);

        // ✅ AUTO-CREATE SFTP SESSION FOR THIS SSH CONNECTION
        await createSftpSessionForSsh(sessionId);

    } catch (error) {
        console.error('[SSH] Connection error:', error);

        // Provide helpful error messages
        let errorMsg = error.message || 'Failed to connect to SSH server';
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            errorMsg = 'Connection timed out - SSH server may be unreachable';
        } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
            errorMsg = 'Cannot reach SDK Local Service - check if it\'s running';
        }

        // Check if temp session still exists (might have been closed)
        const stillExists = sessions.has(tempSessionId);

        if (stillExists) {
            // Session exists, show error and clean up
            closeSession(tempSessionId);
            showToast('error', 'Connection Failed', errorMsg);
        } else {
            // Session was already closed, just log it
            console.log('[SSH] Session was closed during connection attempt');
        }
    }
}

// ========================================
// Initialize xterm.js Terminal
// ========================================
function initTerminal(sessionId, options = {}) {
    const savedFontSize = parseInt(localStorage.getItem('terminal_fontSize') || '14', 10);
    const terminal = new Terminal({
        cursorBlink: true,
        fontSize: (savedFontSize >= 8 && savedFontSize <= 28) ? savedFontSize : 14,
        fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
        theme: {
            background: '#0a0a14',
            foreground: '#e0e0e0',
            cursor: '#4a9eff',
            cursorAccent: '#0a0a14',
            selection: 'rgba(74, 158, 255, 0.3)',
            black: '#1a1a2e',
            red: '#f87171',
            green: '#4ade80',
            yellow: '#fbbf24',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#22d3ee',
            white: '#e0e0e0',
            brightBlack: '#4a4a6a',
            brightRed: '#fca5a5',
            brightGreen: '#86efac',
            brightYellow: '#fde047',
            brightBlue: '#93c5fd',
            brightMagenta: '#d8b4fe',
            brightCyan: '#67e8f9',
            brightWhite: '#ffffff'
        }
    });

    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(document.getElementById(`terminal-${sessionId}`));

    // ✅ Disable text suggestions/autocomplete/autocorrect on mobile keyboards
    const xtermTextarea = document.querySelector(`#terminal-${sessionId} .xterm-helper-textarea`);
    applyNoSuggestionAttrs(xtermTextarea);

    // Delay fit to ensure container is rendered properly
    setTimeout(() => {
        fitAddon.fit();
        // If already connected, send the size immediately
        const sess = sessions.get(sessionId);
        if (sess && sess.connected) {
            const cols = terminal.cols;
            const rows = terminal.rows;

            // ✅ Only send resize for LOCAL sessions we own (not remote/shared)
            const isRemoteSession = sess.owner || sess.type === 'remote';

            // Only send if dimensions are reasonable (not 80x2 or similar) AND it's a local session
            if (cols > 0 && rows > 10 && !isRemoteSession) {
                console.log(`[Terminal] Initial fit complete: ${cols}x${rows}`);
                fetch(`${MLS_URL}/terminal/${sessionId}/resize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cols, rows })
                }).catch(err => {
                    console.warn('[Terminal] Initial resize failed (ignored):', err.message);
                });
            } else if (isRemoteSession) {
                console.log(`[Terminal] Skipping initial resize for remote/shared session: ${sessionId}`);
            } else {
                console.warn(`[Terminal] Skipping resize with invalid dimensions: ${cols}x${rows}`);
            }
        }
    }, 150); // Increased from 50ms to 150ms

    // Store fitAddon for resizing
    const session = sessions.get(sessionId);
    if (session) session.fitAddon = fitAddon;

    // Handle input
    terminal.onData(data => {
        // Find the session that owns this terminal (handles session ID changes)
        let foundSessionId = null;
        let foundSession = null;

        for (const [sid, sess] of sessions.entries()) {
            if (sess.terminal === terminal) {
                foundSessionId = sid;
                foundSession = sess;
                break;
            }
        }

        if (!foundSession) {
            console.warn(`[Terminal] No session found for terminal (original sessionId: ${sessionId})`);
            return;
        }

        console.log(`[Terminal] Input for session: ${foundSessionId}, connected: ${foundSession.connected}, dataSender: ${foundSession.dataSender ? foundSession.dataSender.type : 'null'}`);

        if (!foundSession.connected) {
            // Session not connected - check if user pressed 'R' or 'r' to reconnect
            if (data === 'R' || data === 'r') {
                console.log(`[Terminal] User pressed '${data}' - triggering reconnect for session: ${foundSessionId}`);
                reconnectSession(foundSessionId);
                return;
            }

            console.warn(`[Terminal] Session ${foundSessionId} not connected yet (press R to reconnect)`);
            return;
        }

        // ✅ Check permission for remote shared sessions
        if (foundSession.owner && foundSession.permission === 'readonly') {
            console.warn(`[Terminal] Session ${foundSessionId} is read-only`);
            // Show visual feedback (flash the terminal briefly)
            const termDiv = document.getElementById(`terminal-${foundSessionId}`);
            if (termDiv) {
                termDiv.style.opacity = '0.5';
                setTimeout(() => { termDiv.style.opacity = '1'; }, 100);
            }
            return;
        }

        // ✅ Send typing indicator for remote sessions (viewer typing)
        // AND for our own shared sessions (owner typing to notify viewers)
        const shouldSendTyping = terminalSharing && cloudConnected && (
            foundSession.owner ||  // We're viewing someone else's session
            (foundSession.isShared && !foundSession.owner)  // We own this shared session
        );
        if (shouldSendTyping) {
            // Send typing indicator (debounced)
            clearTimeout(foundSession._typingTimeout);
            terminalSharing.sendTypingIndicator(foundSessionId, true);
            foundSession._typingTimeout = setTimeout(() => {
                if (terminalSharing && cloudConnected) {
                    terminalSharing.sendTypingIndicator(foundSessionId, false);
                }
            }, 2000);
        }

        // ✅ Unified routing via dataSender (works for both WebSocket and Cloud)
        if (foundSession.dataSender && foundSession.dataSender.isReady) {
            // CMD and PowerShell need \r\n for Enter
            // Bash and SSH manage their own line endings - send plain \r only
            const shell = foundSession.config?.shell || 'cmd';
            const sessionType = foundSession.config?.type || 'local';

            // For SSH sessions, always send \r only (SSH server handles line endings)
            // For local terminals: cmd/powershell need \r\n, bash needs \r only
            if (data === '\r' && sessionType !== 'ssh' && (shell === 'cmd' || shell === 'powershell')) {
                foundSession.dataSender.send('\r\n');
            } else {
                foundSession.dataSender.send(data);
            }
        } else {
            console.warn(`[Terminal] DataSender not ready for ${foundSessionId}, type: ${foundSession.dataSender ? foundSession.dataSender.type : 'null'}`);
        }
    });

    // Handle resize
    const resizeHandler = () => {
        if (sessions.has(sessionId)) {
            const sess = sessions.get(sessionId);
            if (sess.fitAddon) {
                sess.fitAddon.fit();
                // Notify backend of resize
                if (sess.connected) {
                    fetch(`${MLS_URL}/terminal/${sessionId}/resize`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows })
                    }).catch(() => {});
                }
            }
        }
    };
    window.addEventListener('resize', resizeHandler);
    // Store handler on session for cleanup on close
    if (session) session._resizeHandler = resizeHandler;

    if (options.shared) {
        terminal.writeln('\x1b[1;36mShared Terminal\x1b[0m - Connecting...');
    } else {
        terminal.writeln('\x1b[1;33mSDK Local Service\x1b[0m - Connecting...');
    }
    terminal.writeln('');

    return terminal;
}

// ========================================
// WebSocket Helper Functions
// ========================================

/**
 * Mark session as disconnected and show reconnect UI
 * Centralized function to avoid code duplication
 * @param {string} sessionId - Terminal session ID
 * @param {Object} session - Session object
 * @param {string} toastTitle - Toast notification title
 * @param {string} toastMessage - Toast notification message
 */
function markSessionDisconnected(sessionId, session, toastTitle, toastMessage) {
    session.connected = false;
    session.dataSender = null;
    updateTab(sessionId, true);
    showReconnectOverlay(sessionId);
    showToast('error', toastTitle, toastMessage);
}

/**
 * Handle disconnection banner detection
 * Checks if banner is a real disconnection or false alarm (e.g., cat file.txt)
 * @param {string} sessionId - Terminal session ID
 * @param {Object} session - Session object
 * @returns {Promise<boolean>} - true if real disconnection, false if false alarm
 */
async function handleDisconnectionBanner(sessionId, session) {
    try {
        // Check if session is still alive via API
        const alive = await checkSessionAlive(sessionId);
        console.log('[WS] Session alive check after banner:', alive);

        if (!alive) {
            // REAL DISCONNECTION: Session is dead
            console.warn('⚠️ [WS] Session is NOT alive - real SSH disconnection');
            markSessionDisconnected(sessionId, session, 'SSH Disconnected', 'SSH connection lost. Press R to reconnect.');
            return true;
        }

        // FALSE ALARM: Session is alive - this was just file content
        return false;
    } catch (err) {
        console.warn('⚠️ [WS] Failed to check session alive:', err.message || 'Unknown error');
        // On error, assume disconnection to be safe
        markSessionDisconnected(sessionId, session, 'Connection Error', 'Press R to reconnect.');
        return true;
    }
}

/**
 * Write terminal data to xterm.js terminal
 * Handles data cleaning, filtering, and cloud broadcasting
 * @param {Object} session - Session object with terminal and config
 * @param {string} rawData - Raw data from WebSocket
 * @param {string} sessionId - Terminal session ID (for cloud broadcasting)
 */
// Matches real shell prompts — last line of output chunk wins (handles docker/su/etc)
const PROMPT_RE = /^\[?\S+@\S+[^\]]*\]?[#$%>]\s*$|^PS\s+\S.*>\s*$|^[#$%>]\s*$/;

function writeTerminalData(session, rawData, sessionId) {
    try {
        let data = rawData.replace(/[\x7F]/g, '');
        const shell = session.config?.shell || 'cmd';
        data = cleanOutput(data, shell);
        if (data.length > 0) session.terminal.write(data);

        // Sniff prompt — strip ANSI, scan lines, last match wins
        const plain = rawData.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '');
        const rawLines   = rawData.split(/\r?\n|\r/);
        const plainLines = plain.split(/\r?\n|\r/);
        for (let i = 0; i < plainLines.length; i++) {
            const t = plainLines[i].trim();
            if (t && PROMPT_RE.test(t)) {
                const prompt = rawLines[i] + '\r\n';
                session.detectedPrompt = prompt;
                storageManager.setDetectedPrompt(sessionId, prompt);
            }
        }

        // If shared — broadcast output and keep sharedSessions entry in sync
        if (session.isShared && cloudConnected && terminalSharing) {
            terminalSharing.sendOutputFromSession(sessionId, rawData);
            if (session.detectedPrompt) {
                const shared = terminalSharing.sharedSessions.get(sessionId);
                if (shared) shared.detectedPrompt = session.detectedPrompt;
            }
        }
    } catch (e) {
        console.warn('[Terminal] Write error:', e);
    }
}

/**
 * Handle WebSocket close event with session alive check and auto-reconnect
 * Provides appropriate user feedback based on close reason
 * @param {Object} event - WebSocket CloseEvent
 * @param {string} sessionId - Terminal session ID
 * @param {Object} session - Session object
 */
async function handleWebSocketClose(event, sessionId, session) {
    console.log('[WS] WebSocket closed for session:', sessionId);
    console.log('[WS] Close code:', event.code, 'Reason:', event.reason || 'No reason provided');
    console.log('[WS] Was clean close:', event.wasClean);

    // ✅ If the session is being intentionally closed (user clicked X), ignore this event entirely.
    // closeSession() sets _closing=true before calling dataSender.close() to signal this.
    if (session._closing) {
        console.log('[WS] Intentional close - skipping reconnect logic for session:', sessionId);
        return;
    }

    session.connected = false;
    session.dataSender = null;
    updateTab(sessionId, true);

    // Common WebSocket close codes
    const closeReasons = {
        1000: 'Normal closure',
        1001: 'Going away (SLS shutdown or navigation)',
        1006: 'Abnormal closure (no close frame - SLS offline?)',
        1011: 'Server error',
        1012: 'Service restart',
        1013: 'Try again later',
        1014: 'Bad gateway',
        1015: 'TLS handshake failure'
    };

    const reason = closeReasons[event.code] || `Unknown (code ${event.code})`;
    console.log('[WS] Close reason:', reason);

    // Auto-reconnect for recoverable close codes
    const autoReconnectCodes = [1006, 1012, 1013];
    const shouldAutoReconnect = autoReconnectCodes.includes(event.code) || !event.wasClean;

    if (shouldAutoReconnect && sessions.has(sessionId)) {
        // Initialize retry state if not present
        if (!session._reconnectAttempts) session._reconnectAttempts = 0;

        const MAX_RECONNECT_ATTEMPTS = 5;
        const BASE_DELAY = 1000; // 1 second
        const MAX_DELAY = 30000; // 30 seconds

        if (session._reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            session._reconnectAttempts++;
            const delay = Math.min(BASE_DELAY * Math.pow(2, session._reconnectAttempts - 1), MAX_DELAY);

            console.log(`[WS] Auto-reconnect attempt ${session._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

            session.terminal?.writeln('');
            session.terminal?.writeln(`\x1b[33m⟳ Reconnecting (${session._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\x1b[0m`);

            session._reconnectTimer = setTimeout(async () => {
                // Check if session still exists (user may have closed tab)
                if (!sessions.has(sessionId)) {
                    console.log('[WS] Session closed during reconnect wait, canceling');
                    return;
                }

                try {
                    const alive = await checkSessionAlive(sessionId);
                    if (alive) {
                        console.log('[WS] Session alive, reconnecting WebSocket...');
                        connectWebSocket(sessionId);
                        // Reset retry count on successful reconnection (reset happens in ws.onopen)
                    } else {
                        // Session dead on backend - try to recreate
                        console.log('[WS] Session dead, attempting full reconnect...');
                        reconnectSession(sessionId);
                    }
                } catch (err) {
                    console.warn('⚠️ [WS] Auto-reconnect check failed:', err.message || 'Unknown error');
                    // Will be retried by the next handleWebSocketClose if it fails again
                }
            }, delay);

            return; // Don't show reconnect overlay yet during auto-reconnect
        }

        // Max attempts reached - fall through to manual reconnect
        console.warn(`[WS] Max auto-reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
        session._reconnectAttempts = 0; // Reset for future manual reconnect
    }

    // Check if session is still alive before showing disconnect message
    try {
        const alive = await checkSessionAlive(sessionId);
        console.log('[WS] Session alive check on close:', alive);
        writeDisconnectMessage(sessionId);
        showToast('warning', alive ? 'Connection Closed' : 'Session Disconnected', 'Press R to reconnect.');
    } catch (err) {
        console.warn('⚠️ [WS] Failed to check session alive:', err.message || 'Unknown error');
        writeDisconnectMessage(sessionId);
        showToast('warning', 'Connection Closed', 'Press R to reconnect.');
    }
}

// ========================================
// WebSocket Connection
// ========================================
function connectWebSocket(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    const wsUrl = `${MLS_WS_URL}/terminal/stream/${sessionId}`;
    console.log('[WS] Connecting:', wsUrl);

    const ws = new WebSocket(wsUrl);
    
    // ⏱️ Set connection timeout to detect offline SLS faster
    const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
            console.warn('⚠️ [WS] Connection timeout - SLS not responding');
            ws.close(1000, 'Connection timeout');
            
            session.terminal.clear();
            session.terminal.writeln('\x1b[1;31m✖ Connection timeout\x1b[0m');
            session.terminal.writeln('\x1b[33mSDK Local Service is not responding\x1b[0m');
            session.terminal.writeln('');
            session.terminal.writeln('\x1b[36mPossible causes:\x1b[0m');
            session.terminal.writeln('  • SLS is not running');
            session.terminal.writeln(`  • SLS is not listening on localhost:${SLS_PORT}`);
            session.terminal.writeln('  • Firewall is blocking the connection');
            session.terminal.writeln('');
            session.terminal.writeln('\x1b[33mPress R to retry or close this tab\x1b[0m');
            
            showReconnectOverlay(sessionId);
            showToast('error', 'Connection Timeout', 'Cannot connect to SLS - check if it\'s running');
        }
    }, 10000); // 10 second timeout

    ws.onopen = () => {
        console.log('[WS] Connected for session:', sessionId);
        
        // ✅ Clear connection timeout - we're connected!
        clearTimeout(connectionTimeout);
        
        session.connected = true;
        session._reconnectAttempts = 0; // Reset auto-reconnect counter on success

        // Wrap WebSocket in TerminalDataSender for unified interface
        session.dataSender = createTerminalDataSender('websocket', { webSocket: ws });

        console.log('[WS] Session state updated: connected=true, dataSender set');
        hideReconnectOverlay(sessionId);
        updateTab(sessionId, false);

        // Show connected status in terminal
        const isReconnect = (session._reconnectAttempts ?? 0) > 0 || session._hasConnectedBefore;
        if (!isReconnect) {
            // First connect: replace the "Connecting..." line in-place
            session.terminal.write('\x1b[1A\x1b[2K'); // move up one line, erase it
            session.terminal.writeln('\x1b[1;33mSDK Local Service\x1b[0m - \x1b[1;32mConnected ✓\x1b[0m');
        } else {
            // Reconnect: append success after the "Reconnecting..." line
            session.terminal.writeln('\x1b[1;32m✓ Reconnected\x1b[0m');
        }
        session.terminal.writeln('');
        session._hasConnectedBefore = true;

        console.log('[WS] Terminal should now accept input for session:', sessionId);

        // Send initial terminal size to backend (important for SSH!)
        setTimeout(() => {
            if (session.terminal && session.connected && session.fitAddon) {
                // Ensure terminal is properly sized first
                session.fitAddon.fit();

                const cols = session.terminal.cols;
                const rows = session.terminal.rows;

                // Only send if dimensions are reasonable
                if (cols > 0 && rows > 10) {
                    console.log(`[WS] Sending initial terminal size: ${cols}x${rows}`);
                    fetch(`${MLS_URL}/terminal/${sessionId}/resize`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cols, rows })
                    }).catch(err => console.error('[Resize] Failed:', err));
                } else {
                    console.warn(`[WS] Skipping resize with invalid dimensions: ${cols}x${rows}`);
                    // Retry after a bit more time
                    setTimeout(() => {
                        session.fitAddon.fit();
                        const retryRows = session.terminal.rows;
                        if (retryRows > 10) {
                            fetch(`${MLS_URL}/terminal/${sessionId}/resize`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    cols: session.terminal.cols,
                                    rows: retryRows
                                })
                            }).catch(() => {});
                        }
                    }, 500);
                }
            }
        }, 200);
        // NOTE: We intentionally do NOT send Enter (\r) on connect/reconnect.
        // Sending \r would submit any stale input the backend buffer had from before
        // a page refresh (e.g. user typed "di", refreshed, we'd send "di\n" accidentally).
        // The backend clears its input buffer on WebSocket reconnect instead.
    };

    // WebSocket message handler - processes all terminal output
    ws.onmessage = async (event) => {
        const rawData = event.data;

        // Check for special banners - verify session is still alive to avoid false alarms
        // (e.g., banner might appear in file content like: cat file.txt)
        if (rawData.includes(BANNER_SSH_DISCONNECTED) || rawData.includes(BANNER_STREAM_CLOSED)) {
            const bannerType = rawData.includes(BANNER_SSH_DISCONNECTED) ? 'SSH_DISCONNECTED' : 'STREAM_CLOSED';
            console.warn(`[WS] ${bannerType} banner detected for session:`, sessionId);

            // Verify if this is a real disconnection or just file content
            const isAlive = await checkSessionAlive(sessionId);

            if (!isAlive) {
                // REAL DISCONNECTION: Session is dead
                console.warn('⚠️ [WS] Confirmed: Session is dead');
                session.connected = false;
                session.dataSender = null;
                updateTab(sessionId, true);
                writeDisconnectMessage(sessionId);

                const message = bannerType === 'SSH_DISCONNECTED'
                    ? 'SSH connection lost. Press R to reconnect.'
                    : 'Terminal stream ended. Press R to reconnect.';
                showToast('error', 'Disconnected', message);

                return; // Don't write banner text to terminal
            }

            // FALSE ALARM: Session is alive - banner is just in file content
            console.log('[WS] Banner is false alarm (session still alive), processing as normal output');
            // Fall through to write the data normally
        }

        // Process and display terminal data
        writeTerminalData(session, rawData, sessionId);
    };

    ws.onerror = (error) => {
        // Clear timeout - error already occurred
        clearTimeout(connectionTimeout);
        
        console.warn('⚠️ [WS] WebSocket error for session:', sessionId, error.message || error.type || 'Unknown');

        // Show user-friendly error based on connection state
        if (!session.connected) {
            // Connection never established - likely SLS is offline
            console.warn('⚠️ [WS] Failed to establish connection - SLS may be offline');
            session.terminal.writeln('');
            session.terminal.writeln('\x1b[1;31m✖ Connection failed\x1b[0m');
            session.terminal.writeln('\x1b[33mCannot connect to SDK Local Service\x1b[0m');
            session.terminal.writeln('\x1b[36mPlease ensure SLS is running on localhost:' + SLS_PORT + '\x1b[0m');
        }
    };

    ws.onclose = async (event) => {
        clearTimeout(connectionTimeout);
        await handleWebSocketClose(event, sessionId, session);
    };

    // Note: dataSender is set properly in ws.onopen via createTerminalDataSender
    // Do NOT assign raw ws here - it bypasses the isReady guard
}

// ========================================
// Reconnection
// ========================================
function showConnectingOverlay(sessionId) {
    const overlay = document.getElementById(`connecting-${sessionId}`);
    if (overlay) overlay.classList.add('visible');
}

function hideConnectingOverlay(sessionId) {
    const overlay = document.getElementById(`connecting-${sessionId}`);
    if (overlay) overlay.classList.remove('visible');
}

function showReconnectOverlay(sessionId) {
    // No overlay — write disconnect message directly into terminal
    writeDisconnectMessage(sessionId);
}

function hideReconnectOverlay(sessionId) {
    // No-op — overlay removed; terminal is cleared before reconnecting
}

/**
 * Write disconnection message directly into the terminal (no overlay modal).
 */
function writeDisconnectMessage(sessionId) {
    const session = sessions.get(sessionId);
    const term = session?.terminal;
    if (!term) return;
    term.writeln('');
    term.writeln('\x1b[1;31m✖ Disconnected\x1b[0m  \x1b[2mPress \x1b[0m\x1b[1;32mR\x1b[0m\x1b[2m to reconnect\x1b[0m');
}

/**
 * Check if a terminal session is still alive on the backend
 * @param {string} sessionId - Session ID to check
 * @returns {Promise<boolean>} - True if session is alive, false otherwise
 */
async function checkSessionAlive(sessionId) {
    try {
        const response = await fetch(`${MLS_URL}/terminal/${sessionId}`, {
            signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        return response.ok; // 200 = alive, 404 = not found
    } catch (error) {
        console.warn('⚠️ [CheckAlive] Failed to check session status:', error.message || 'Service unavailable');
        return false;
    }
}

async function reconnectSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Reset auto-reconnect counter on manual reconnect
    session._reconnectAttempts = 0;
    if (session._reconnectTimer) {
        clearTimeout(session._reconnectTimer);
        session._reconnectTimer = null;
    }

    showToast('info', 'Reconnecting...', `Reconnecting ${session.name}`);
    hideReconnectOverlay(sessionId);

    // Close existing dataSender if any
    if (session.dataSender) {
        session.dataSender.close();
    }

    try {
        // First, check if backend session still exists
        const checkResponse = await fetch(`${MLS_URL}/terminal/${sessionId}`, {
            signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        if (checkResponse.ok) {
            // Session exists, just reconnect WebSocket
            session.terminal.clear();
            session.terminal.writeln('\x1b[32m✓ Session found, reconnecting...\x1b[0m');

            await new Promise(resolve => setTimeout(resolve, 100));
            connectWebSocket(sessionId);

            showToast('success', 'Reconnected', `${session.name} reconnected successfully`);

            // ✅ Update file explorer button state after reconnection
            if (activeSessionId === sessionId) {
                updateFileExplorerButtonState(session);
            }

            return;
        }

        // Session doesn't exist, recreate it
        session.terminal.clear();
        session.terminal.writeln('\x1b[33m⟳ Recreating session...\x1b[0m');

        let response;

        if (session.config.type === 'local') {
            response = await fetch(`${MLS_URL}/terminal/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'local',
                    shell: session.config.shell,
                    sessionId: sessionId  // ✅ Preserve session ID!
                })
            });
        } else if (session.config.type === 'ssh') {
            response = await fetch(`${MLS_URL}/terminal/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'ssh',
                    connectionId: session.config.connectionId,
                    sessionId: sessionId  // ✅ Preserve session ID!
                })
            });
        }

        if (!response.ok) throw new Error('Failed to recreate session');

        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        // Session ID should be preserved (we sent sessionId in request)
        console.log(`[Reconnect] Session recreated with ID: ${result.sessionId}`);

        // Clear and show success
        session.terminal.clear();
        session.terminal.writeln('\x1b[1;32m✓ Session recreated!\x1b[0m');
        session.terminal.writeln('');

        // Connect WebSocket
        await new Promise(resolve => setTimeout(resolve, 100));
        connectWebSocket(sessionId);

        showToast('success', 'Reconnected', `${session.name} reconnected successfully`);

        // ✅ Update file explorer button state after session recreation
        if (activeSessionId === sessionId) {
            updateFileExplorerButtonState(session);
        }

    } catch (error) {
        console.warn('⚠️ [Reconnect] Failed:', error.message || 'Unknown error');

        let errorMsg = error.message || 'Unknown error';
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            errorMsg = 'Connection timed out - SDK Local Service may be offline';
        } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
            errorMsg = 'Cannot connect to SDK Local Service';
        }

        session.terminal.clear();
        session.terminal.writeln('\x1b[31m✖ Reconnect failed\x1b[0m');
        session.terminal.writeln(`\x1b[33m${errorMsg}\x1b[0m`);
        session.terminal.writeln('');
        session.terminal.writeln('\x1b[36mTroubleshooting:\x1b[0m');
        session.terminal.writeln('  • Check if SDK Local Service is running');
        session.terminal.writeln(`  • Verify it's listening on localhost:${SLS_PORT}`);
        session.terminal.writeln('');
        session.terminal.writeln('\x1b[33mPress R to retry...\x1b[0m');
        showToast('error', 'Reconnect Failed', errorMsg);
        showReconnectOverlay(sessionId);
    }
}

// ========================================
// Close Session
// ========================================
async function closeSession(sessionId) {
    console.log(`[Close] Closing session: ${sessionId}`);
    const session = sessions.get(sessionId);
    if (!session) {
        console.warn(`[Close] Session not found: ${sessionId}`);
        return;
    }

    console.log(`[Close] Session type: ${session.type}, connected: ${session.connected}`);

    // ✅ If this is a shared session we own, notify viewers before closing
    if (session.isShared && !session.owner && terminalSharing && cloudConnected) {
        console.log(`[Close] Notifying viewers that session is closing: ${sessionId}`);
        terminalSharing.notifyOwnerDisconnect(sessionId);
        terminalSharing.unshareSession(sessionId);
        updateCloudHostIndicator(); // ✅ Update host indicator (might no longer be a host)
    }

    // ✅ If this is a remote session we're viewing, notify owner we're leaving
    if (session.owner && terminalSharing && terminalSharing.connected) {
        console.log(`[Close] Notifying owner that we're leaving session: ${sessionId}`);
        terminalSharing.sendData({
            type: 'session-viewer-leave',
            sessionId: sessionId
        });
    }

    try {
        // Close dataSender (only for local/SSH sessions, not remote shared)
        if (session.dataSender) {
            console.log(`[Close] Closing dataSender for session: ${sessionId}`);
            session._closing = true; // ✅ Flag so ws.onclose knows this is intentional
            session.dataSender.close();
        } else {
            console.log(`[Close] No dataSender to close for session: ${sessionId}`);
        }

        // Call backend to close (only for local/SSH sessions, not remote shared)
        if (session.type !== 'remote') {
            console.log(`[Close] Calling backend DELETE /terminal/${sessionId}`);
            const response = await slsFetch(`${MLS_URL}/terminal/${sessionId}`, { method: 'DELETE' });
            console.log(`[Close] Backend response status: ${response.status}`);
            if (response.ok) {
                const result = await response.json();
                console.log(`[Close] Backend result:`, result);
            } else {
                console.warn(`[Close] Backend returned error status: ${response.status}`);
            }
        } else {
            console.log(`[Close] Skipping backend delete for remote shared session`);
        }
    } catch (e) {
        console.error('[Close] Error closing session:', e);
    }

    // Clean up terminal
    if (session.terminal) {
        console.log(`[Close] Disposing terminal for session: ${sessionId}`);
        session.terminal.dispose();
    }

    // ✅ Clean up mobile event listeners
    if (session._cleanupFunctions) {
        session._cleanupFunctions.forEach(cleanup => cleanup());
        session._cleanupFunctions = [];
    }

    // ✅ Clean up resize handler
    if (session._resizeHandler) {
        window.removeEventListener('resize', session._resizeHandler);
        session._resizeHandler = null;
    }

    // ✅ Clean up typing timeout
    if (session._typingTimeout) {
        clearTimeout(session._typingTimeout);
        session._typingTimeout = null;
    }

    // ✅ Clean up auto-reconnect timer
    if (session._reconnectTimer) {
        clearTimeout(session._reconnectTimer);
        session._reconnectTimer = null;
    }

    // Remove UI elements
    console.log(`[Close] Removing UI elements for session: ${sessionId}`);
    removeTab(sessionId);
    const panel = document.getElementById(`panel-${sessionId}`);
    if (panel) {
        panel.remove();
        console.log(`[Close] Panel removed for session: ${sessionId}`);
    } else {
        console.warn(`[Close] Panel not found for session: ${sessionId}`);
    }

    // Remove from sessions
    sessions.delete(sessionId);
    console.log(`[Close] Session removed from sessions map: ${sessionId}`);

    // Remove from localStorage tracking (so it won't restore on refresh)
    untrackOpenTab(sessionId);
    storageManager.clearDetectedPrompt(sessionId);

    // Switch to another session if this was active
    if (activeSessionId === sessionId) {
        activeSessionId = null;
        const remaining = Array.from(sessions.keys());
        if (remaining.length > 0) {
            switchToSession(remaining[remaining.length - 1]);
            console.log(`[Close] Switched to session: ${remaining[remaining.length - 1]}`);
        } else {
            document.getElementById('statusActive').textContent = 'None';
            console.log(`[Close] No remaining sessions`);
        }
    }

    updateEmptyState();
    updateSessionCount();
}

// ========================================
// Keyboard Handler for Reconnection
// ========================================
document.addEventListener('keydown', (e) => {
    // R to reconnect (when disconnected session is active)
    if (e.key && e.key.toLowerCase() === 'r' && activeSessionId) {
        // Don't trigger if typing in input field
        const activeElement = document.activeElement;
        if (activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable
        )) {
            return;
        }

        const session = sessions.get(activeSessionId);
        if (session && !session.connected) {
            e.preventDefault();
            reconnectSession(activeSessionId);
        }
    }
});

// ========================================
// SSH Modal Functions
// ========================================
function generateSshConnectionName() {
    const prefixes = ['prod', 'dev', 'staging', 'test', 'backup', 'web', 'db', 'api', 'app', 'cache'];
    const types = ['server', 'node', 'host', 'box', 'vm', 'instance', 'machine'];
    const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const randomType = types[Math.floor(Math.random() * types.length)];
    const randomNum = Math.floor(Math.random() * 100);

    const connectionName = `${randomPrefix}-${randomType}-${randomNum}`;
    document.getElementById('sshName').value = connectionName;

    return connectionName;
}

function showSshModal() {
    document.getElementById('sshModalOverlay').classList.add('visible');
    document.getElementById('sshName').focus();
}

function closeSshModal() {
    document.getElementById('sshModalOverlay').classList.remove('visible');
    // Don't reset form - preserve inputs in case user accidentally closed modal
    // Form will be reset only when explicitly saving or canceling
}

window.cancelSshModal = function() {
    // Reset form when user explicitly cancels
    const form = document.getElementById('sshForm');
    form.reset();
    delete form.dataset.editId;
    document.querySelector('#sshModalOverlay .modal-title').textContent = '➕ Add SSH Connection';
    closeSshModal();
}

/**
 * Test SSH connection before saving
 */
async function testSshConnection() {
    const testBtn = document.getElementById('testSshBtn');
    const originalText = testBtn.innerHTML;

    // Validate required fields
    const host = document.getElementById('sshHost').value.trim();
    const username = document.getElementById('sshUsername').value.trim();

    if (!host || !username) {
        showToast('warning', 'Missing Fields', 'Please fill in Host and Username to test connection');
        return;
    }

    const data = {
        host: host,
        port: parseInt(document.getElementById('sshPort').value) || 22,
        username: username,
        password: document.getElementById('sshPassword').value || null,
        privateKey: document.getElementById('sshPrivateKey').value || null
    };

    try {
        // Disable button and show loading state
        testBtn.disabled = true;
        testBtn.innerHTML = '⏳ Testing...';
        testBtn.classList.add('loading');

        const response = await slsFetch(`${MLS_URL}/terminal/ssh-connections/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Connection test failed');
        }

        const result = await response.json();

        if (result.success) {
            showToast('success', '✅ Connection Successful',
                     `Connected to ${data.username}@${data.host}:${data.port}`, 5000);
            testBtn.innerHTML = '✅ Success';
            testBtn.classList.add('success');

            // Reset button after 3 seconds
            setTimeout(() => {
                testBtn.innerHTML = originalText;
                testBtn.disabled = false;
                testBtn.classList.remove('loading', 'success');
            }, 3000);
        } else {
            throw new Error(result.error || 'Connection test failed');
        }

    } catch (error) {
        console.error('[SSH Test] Connection test failed:', error);
        showToast('error', '❌ Connection Failed',
                 error.message || 'Could not connect to SSH server', 8000);

        testBtn.innerHTML = '❌ Failed';
        testBtn.classList.add('error');

        // Reset button after 3 seconds
        setTimeout(() => {
            testBtn.innerHTML = originalText;
            testBtn.disabled = false;
            testBtn.classList.remove('loading', 'error');
        }, 3000);
    }
}

// Make globally accessible
window.testSshConnection = testSshConnection;

async function saveSshConnection(e) {
    e.preventDefault();

    const form = document.getElementById('sshForm');
    const editId = form.dataset.editId;
    const isEdit = !!editId;

    const data = {
        name: document.getElementById('sshName').value,
        host: document.getElementById('sshHost').value,
        port: parseInt(document.getElementById('sshPort').value) || 22,
        username: document.getElementById('sshUsername').value,
        password: document.getElementById('sshPassword').value || null,
        privateKey: document.getElementById('sshPrivateKey').value || null,
        description: document.getElementById('sshDescription').value || null
    };

    try {
        let response;
        if (isEdit) {
            response = await fetch(`${MLS_URL}/terminal/ssh-connections/${editId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            response = await fetch(`${MLS_URL}/terminal/ssh-connections`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        const result = await response.json();

        if (result.error) {
            showToast('error', 'Save Failed', result.error);
            return;
        }

        // Reset form after successful save
        const form = document.getElementById('sshForm');
        form.reset();
        delete form.dataset.editId;
        document.querySelector('#sshModalOverlay .modal-title').textContent = '➕ Add SSH Connection';

        closeSshModal();
        refreshConnections();
        showToast('success', isEdit ? 'Connection Updated' : 'Connection Saved',
                 `"${data.name}" has been ${isEdit ? 'updated' : 'saved'}`);

    } catch (error) {
        console.error('Failed to save:', error);
        showToast('error', 'Save Failed', error.message);
    }
}

// ========================================
// Settings Modal Functions
// ========================================
window.showSettings = function() {
    // Populate current port value
    document.getElementById('slsPortInput').value = SLS_PORT;
    document.getElementById('currentPortDisplay').textContent = SLS_PORT;
    document.getElementById('currentWsPortDisplay').textContent = SLS_PORT;

    document.getElementById('settingsModalOverlay').classList.add('visible');
}

window.closeSettingsModal = function() {
    document.getElementById('settingsModalOverlay').classList.remove('visible');
}

window.resetSlsPort = function() {
    document.getElementById('slsPortInput').value = DEFAULT_SLS_PORT;
}

window.saveSlsPortSettings = async function() {
    const newPort = parseInt(document.getElementById('slsPortInput').value);

    // Validate port
    if (isNaN(newPort) || newPort < 1024 || newPort > 65535) {
        showToast('error', 'Invalid Port', 'Please use a port between 1024 and 65535.');
        return;
    }

    // Check if port actually changed
    if (newPort === SLS_PORT) {
        closeSettingsModal();
        return;
    }

    // Update port configuration
    updateSlsPort(newPort);

    // Clear old token (new service instance might have different tokens)
    slsSecurityToken = null;
    localStorage.removeItem('sls-token');
    localStorage.removeItem('sls-token-timestamp');

    // Close modal
    closeSettingsModal();

    // Show reconnecting message
    showToast('info', 'Connecting', `Connecting to SLS on port ${newPort}...`);

    // Try to connect with new port
    try {
        await requestSlsToken();
        await checkMlsHealth(true);
        await refreshConnections();
        showToast('success', 'Connected', `Successfully connected to SLS on port ${newPort}`);
    } catch (error) {
        showToast('error', 'Connection Failed', `Failed to connect to SLS on port ${newPort}. Please check if the service is running.`);
        console.error('Failed to connect with new port:', error);
    }
}

// ========================================
// Help Modal Functions
// ========================================
window.showInstallGuide = function() {
    document.getElementById('helpModalOverlay').classList.add('visible');
    // Default to Local Service Setup tab
    switchHelpTab('quickstart');
}

// Alias for backward compatibility
window.showHelp = function() {
    showInstallGuide();
}

window.closeHelpModal = function() {
    document.getElementById('helpModalOverlay').classList.remove('visible');
}

window.switchHelpTab = function(tabName) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.help-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.help-content').forEach(content => content.classList.remove('active'));

    // Add active class to selected tab and content
    document.getElementById('tab-' + tabName).classList.add('active');
    document.getElementById('content-' + tabName).classList.add('active');
}

window.switchCloudTab = function(tabName) {
    // Remove active class from all cloud tabs
    document.querySelectorAll('.cloud-tab').forEach(tab => tab.classList.remove('active'));

    // Hide all cloud tab content using inline style to override existing inline styles
    document.querySelectorAll('.cloud-tab-content').forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
    });

    // Add active class to selected tab
    document.getElementById('cloud-tab-' + tabName).classList.add('active');

    // Show selected content using inline style
    const selectedContent = document.getElementById('cloud-content-' + tabName);
    if (selectedContent) {
        selectedContent.style.display = 'block';
        selectedContent.classList.add('active');
    }
}

function enableSharingTab() {
    const sharingTab = document.getElementById('cloud-tab-sharing');
    if (sharingTab) {
        sharingTab.style.opacity = '1';
        sharingTab.style.cursor = 'pointer';
        sharingTab.style.pointerEvents = 'auto';
        sharingTab.title = 'Share your channel link';
    }
}

function disableSharingTab() {
    const sharingTab = document.getElementById('cloud-tab-sharing');
    if (sharingTab) {
        sharingTab.style.opacity = '0.5';
        sharingTab.style.cursor = 'not-allowed';
        sharingTab.style.pointerEvents = 'none';
        sharingTab.title = 'Connect to cloud first to share';

        // Switch back to Connection tab if currently on Sharing tab
        if (sharingTab.classList.contains('active')) {
            window.switchCloudTab('connection');
        }
    }
}

window.showAbout = function() {
    document.getElementById('aboutModalOverlay').classList.add('visible');
}

window.closeAboutModal = function() {
    document.getElementById('aboutModalOverlay').classList.remove('visible');
}


// ========================================
// Context Menu State
// ========================================
let contextMenuTarget = null;    // SSH connection context menu target
let tabContextMenuTarget = null; // Tab context menu target sessionId

function hideContextMenus() {
    document.getElementById('tabContextMenu')?.classList.remove('visible');
    document.getElementById('sessionContextMenu')?.classList.remove('visible');
    document.getElementById('viewerContextMenu')?.classList.remove('visible');
    document.getElementById('terminalContextMenu')?.classList.remove('visible');
}

// ========================================
// Terminal Right-Click Context Menu
// ========================================
let _terminalCtxSessionId = null;

function attachTerminalContextMenu(sessionId) {
    const termEl = document.getElementById(`terminal-${sessionId}`);
    if (!termEl) return;
    termEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _terminalCtxSessionId = sessionId;
        const menu = document.getElementById('terminalContextMenu');
        if (!menu) return;
        // Position — keep inside viewport
        const x = Math.min(e.clientX, window.innerWidth - 180);
        const y = Math.min(e.clientY, window.innerHeight - 250);
        menu.style.left = x + 'px';
        menu.style.top  = y + 'px';
        hideContextMenus();
        menu.classList.add('visible');
    });
}

async function terminalContextMenuAction(action) {
    hideContextMenus();
    const sessionId = _terminalCtxSessionId;
    const session   = sessionId ? sessions.get(sessionId) : null;
    const terminal  = session?.terminal;

    switch (action) {
        case 'copy': {
            const selection = terminal?.getSelection?.();
            if (selection) {
                try { await navigator.clipboard.writeText(selection); } catch (_) {}
            }
            break;
        }
        case 'paste': {
            try {
                const text = await navigator.clipboard.readText();
                if (text && session?.connected && session?.dataSender?.isReady) {
                    session.dataSender.send(text);
                }
            } catch (_) {}
            break;
        }
        case 'selectAll':
            terminal?.selectAll?.();
            break;
        case 'clear':
            terminal?.clear?.();
            break;
        case 'fontIncrease':
        case 'fontDecrease':
        case 'fontReset': {
            const DEFAULT_FONT = 14;
            // Apply to all sessions so it feels global
            sessions.forEach(s => {
                if (!s.terminal) return;
                const cur = s.terminal.options.fontSize || DEFAULT_FONT;
                let next = action === 'fontIncrease' ? Math.min(cur + 1, 28)
                         : action === 'fontDecrease' ? Math.max(cur - 1, 8)
                         : DEFAULT_FONT;
                s.terminal.options.fontSize = next;
                s.fitAddon?.fit();
            });
            // Persist
            try { localStorage.setItem('terminal_fontSize', sessions.values().next().value?.terminal?.options?.fontSize ?? DEFAULT_FONT); } catch (_) {}
            break;
        }
    }
}
window.terminalContextMenuAction = terminalContextMenuAction;

// Dismiss any open context menu on outside click
document.addEventListener('click', () => hideContextMenus());

// ========================================
// Session Context Menu (SSH connections)
// ========================================
function showSessionContextMenu(e, connectionId, name, host, port, username) {
    e.preventDefault();
    e.stopPropagation();

    contextMenuTarget = { connectionId, name, host, port, username };

    const menu = document.getElementById('sessionContextMenu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('visible');

    // Hide tab context menu if open
    document.getElementById('tabContextMenu').classList.remove('visible');
}

function contextMenuAction(action) {
    hideContextMenus();
    if (!contextMenuTarget) return;

    const { connectionId, name, host, port, username } = contextMenuTarget;

    switch (action) {
        case 'open':
        case 'openInNewTab':
            connectToSsh(connectionId, name, host, port, username);
            break;
        case 'openSftp':
            // Open SSH connection first, then open SFTP
            connectToSsh(connectionId, name, host, port, username).then(() => {
                // Wait a bit for session to be created
                setTimeout(() => {
                    if (activeSessionId) {
                        openSftpForSession(activeSessionId);
                    }
                }, 500);
            });
            break;
        case 'edit':
            editSshConnection(connectionId);
            break;
        case 'duplicate':
            duplicateSshConnection(connectionId);
            break;
        case 'delete':
            deleteSshConnection(connectionId, name);
            break;
    }
}

// ========================================
// Tab Context Menu
// ========================================
function showTabContextMenu(e, sessionId) {
    e.preventDefault();
    e.stopPropagation();

    tabContextMenuTarget = sessionId;

    // Update Share menu item label based on current share state
    const session = sessions.get(sessionId);
    const shareMenuItem = document.getElementById('shareMenuItem');
    const shareText = document.getElementById('shareMenuText');
    const permissionMenuItem = document.getElementById('permissionMenuItem');
    const resetPermissionsMenuItem = document.getElementById('resetPermissionsMenuItem');
    const requestPermissionMenuItem = document.getElementById('requestPermissionMenuItem');

    // Check if this is a received shared session (I'm viewing someone else's share)
    const isReceivedShare = session && session.owner && session.owner !== cloudAgentName;
    const isMySharedSession = session && session.isShared && !session.owner;

    if (shareText) {
        // Show "Unshare" only when actually actively shared (connected + isShared)
        // When disconnected, isShared flag is preserved for auto-reconnect but session isn't live
        shareText.textContent = (session && session.isShared && cloudConnected) ? 'Unshare Session' : 'Share Session';
    }

    // Disable share option only for received shares
    if (shareMenuItem) {
        if (isReceivedShare) {
            shareMenuItem.classList.add('disabled');
            shareMenuItem.title = 'Cannot share a received session';
        } else {
            shareMenuItem.classList.remove('disabled');
            shareMenuItem.title = '';
        }
    }

    // Show/hide permission toggle (only for my shared sessions)
    if (permissionMenuItem) {
        if (isMySharedSession && cloudConnected) {
            permissionMenuItem.style.display = 'block';
            const currentPerm = session.permission || 'readonly';
            const permText = permissionMenuItem.querySelector('.permission-text');
            if (permText) {
                permText.textContent = currentPerm === 'readonly' ? 'Enable Write Access' : 'Set Read-Only';
            }
        } else {
            permissionMenuItem.style.display = 'none';
        }
    }

    // Show/hide reset all permissions (only for my shared sessions)
    if (resetPermissionsMenuItem) {
        if (isMySharedSession && cloudConnected) {
            resetPermissionsMenuItem.style.display = 'block';
        } else {
            resetPermissionsMenuItem.style.display = 'none';
        }
    }

    // Show/hide request permission (only for received shares with readonly permission)
    if (requestPermissionMenuItem) {
        if (isReceivedShare && session.permission === 'readonly') {
            requestPermissionMenuItem.style.display = 'block';
        } else {
            requestPermissionMenuItem.style.display = 'none';
        }
    }

    // Position and show the menu (keep it on screen)
    const menu = document.getElementById('tabContextMenu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('visible');

    // Hide session context menu if open
    document.getElementById('sessionContextMenu').classList.remove('visible');
}

function tabContextMenuAction(action) {
    console.log('[TabContextMenu] Action triggered:', action);
    console.log('[TabContextMenu] Target sessionId:', tabContextMenuTarget);

    hideContextMenus();
    const sessionId = tabContextMenuTarget;
    if (!sessionId) {
        console.warn('[TabContextMenu] No sessionId found, aborting');
        return;
    }

    // Check if this is a note tab or terminal tab
    const isNoteTab = sessionId.startsWith('note-');
    const noteId = isNoteTab ? sessionId.substring(5) : null; // Remove 'note-' prefix

    // Check if the action is disabled (e.g., share when not connected)
    if (action === 'toggleShare') {
        console.log('[TabContextMenu] toggleShare action detected');
        console.log('[TabContextMenu] isNoteTab:', isNoteTab);
        console.log('[TabContextMenu] cloudConnected:', cloudConnected);
        console.log('[TabContextMenu] terminalSharing:', terminalSharing);

        const shareMenuItem = document.getElementById('shareMenuItem');
        console.log('[TabContextMenu] shareMenuItem:', shareMenuItem);
        console.log('[TabContextMenu] shareMenuItem.classList:', shareMenuItem?.classList);

        if (shareMenuItem && shareMenuItem.classList.contains('disabled')) {
            console.warn('[TabContextMenu] Share menu is disabled, showing warning');
            showToast('warning', 'Not Connected', 'Connect to cloud messaging first to share');
            return;
        }

        console.log('[TabContextMenu] Share menu is enabled, proceeding...');
    }

    switch (action) {
        case 'rename': {
            if (isNoteTab) {
                // Rename note
                const note = notes.get(noteId);
                const current = note ? note.title : 'Untitled Note';
                const newName = prompt('Rename note:', current);
                if (newName && newName.trim()) {
                    updateNoteTitle(noteId, newName.trim());
                }
            } else {
                // Rename terminal session
                const session = sessions.get(sessionId);
                const current = session ? session.name : sessionId;
                const newName = prompt('Rename tab:', current);
                if (newName && newName.trim()) {
                    const tab = document.getElementById(`tab-${sessionId}`);
                    if (tab) {
                        tab.querySelector('.tab-title').textContent = newName.trim();
                    }
                    if (session) session.name = newName.trim();
                }
            }
            break;
        }
        case 'duplicate': {
            if (isNoteTab) {
                // Duplicate note
                duplicateNote(noteId);
            } else {
                // Duplicate terminal
                const session = sessions.get(sessionId);
                if (session && session.type === 'local') {
                    createLocalTerminal(session.config?.shell || 'bash');
                } else if (session && session.type === 'ssh') {
                    const cfg = session.config || {};
                    connectToSsh(cfg.connectionId, cfg.name, cfg.host, cfg.port, cfg.username);
                }
            }
            break;
        }
        case 'toggleShare': {
            console.log('[TabContextMenu] Inside toggleShare case');
            console.log('[TabContextMenu] sessionId param:', sessionId);
            console.log('[TabContextMenu] isNoteTab:', isNoteTab);

            // Check if cloud connected before allowing share/unshare
            if (!cloudConnected || !terminalSharing) {
                console.warn('[TabContextMenu] Not connected - opening modal with session to share');
                showToast('warning', '🔌 Not Connected', 'Connect to Messaging Platform to share this session');
                // Open the modal to connection tab and pass the session to share
                openMessagingModal(sessionId);
                return;
            }

            if (isNoteTab) {
                // Toggle note sharing
                toggleNoteSharing(noteId);
            } else {
                // Toggle terminal sharing
                const session = sessions.get(sessionId);
                console.log('[TabContextMenu] Session retrieved:', session);

                if (!session) {
                    console.error('[TabContextMenu] Session not found!');
                    showToast('error', 'Session Not Found', 'Could not find the terminal session');
                    break;
                }

                console.log('[TabContextMenu] Session.isShared:', session.isShared);

                if (session.isShared) {
                    console.log('[TabContextMenu] Calling unshareTerminal');
                    unshareTerminal(sessionId);
                } else {
                    console.log('[TabContextMenu] Calling shareTerminal');
                    shareTerminal(sessionId);
                }

                updateTabContextMenu();
            }
            break;
        }
        case 'close':
            if (isNoteTab) {
                closeNoteTab(sessionId);
            } else {
                closeSession(sessionId);
            }
            break;
        case 'closeOthers': {
            const allTabIds = isNoteTab
                ? Array.from(notes.keys()).map(id => `note-${id}`)
                : Array.from(sessions.keys());
            const toClose = allTabIds.filter(id => id !== sessionId);
            toClose.forEach(id => {
                if (id.startsWith('note-')) {
                    closeNoteTab(id);
                } else {
                    closeSession(id);
                }
            });
            break;
        }
        case 'closeToRight': {
            const tabBar = document.getElementById('tabBar');
            const allTabs = Array.from(tabBar.querySelectorAll('.tab'));
            const currentTab = document.getElementById(`tab-${sessionId}`);
            const idx = allTabs.indexOf(currentTab);
            if (idx !== -1) {
                allTabs.slice(idx + 1).forEach(t => {
                    const tabId = t.id.replace('tab-', '');
                    if (tabId.startsWith('note-')) {
                        closeNoteTab(tabId);
                    } else {
                        closeSession(tabId);
                    }
                });
            }
            break;
        }
        case 'closeToLeft': {
            const tabBar = document.getElementById('tabBar');
            const allTabs = Array.from(tabBar.querySelectorAll('.tab'));
            const currentTab = document.getElementById(`tab-${sessionId}`);
            const idx = allTabs.indexOf(currentTab);
            if (idx !== -1) {
                allTabs.slice(0, idx).forEach(t => {
                    const tabId = t.id.replace('tab-', '');
                    if (tabId.startsWith('note-')) {
                        closeNoteTab(tabId);
                    } else {
                        closeSession(tabId);
                    }
                });
            }
            break;
        }
        case 'togglePermission': {
            // Toggle permission between readonly and readwrite (owner only)
            const session = sessions.get(sessionId);
            if (!session || !session.isShared || session.owner) {
                showToast('warning', 'Not Allowed', 'Can only change permission on your shared sessions');
                break;
            }
            const newPerm = session.permission === 'readonly' ? 'readwrite' : 'readonly';
            if (terminalSharing && terminalSharing.updateSessionPermission(sessionId, newPerm)) {
                session.permission = newPerm;
                const permLabel = newPerm === 'readwrite' ? 'Read-Write' : 'Read-Only';
                showToast('success', '🔒 Permission Changed', `Session is now ${permLabel}`);

                // Use common helper to update all UI elements
                updatePermissionUI(sessionId, newPerm);
            }
            break;
        }
        case 'resetPermissions': {
            // Reset all agent permissions to readonly (owner only)
            resetAllPermissions(sessionId);
            break;
        }
        case 'requestPermission': {
            // Request write permission from owner (viewer only)
            requestWritePermission(sessionId);
            break;
        }
        case 'closeAll': {
            const toClose = Array.from(sessions.keys());
            toClose.forEach(id => closeSession(id));
            break;
        }
    }
}

async function editSshConnection(connectionId) {
    try {
        const response = await slsFetch(`${MLS_URL}/terminal/ssh-connections/${connectionId}`);
        if (!response.ok) throw new Error('Failed to load connection');

        const conn = await response.json();

        // Populate modal for editing
        document.getElementById('sshName').value = conn.name || '';
        document.getElementById('sshHost').value = conn.host || '';
        document.getElementById('sshPort').value = conn.port || 22;
        document.getElementById('sshUsername').value = conn.username || '';
        document.getElementById('sshPassword').value = conn.password || '';
        document.getElementById('sshPrivateKey').value = conn.privateKey || '';
        document.getElementById('sshDescription').value = conn.description || '';

        // Store connection ID for update
        document.getElementById('sshForm').dataset.editId = connectionId;

        // Update modal title
        document.querySelector('#sshModalOverlay .modal-title').textContent = '✏️ Edit SSH Connection';

        showSshModal();
    } catch (error) {
        showToast('error', 'Error', 'Failed to load connection details');
    }
}

async function duplicateSshConnection(connectionId) {
    try {
        const response = await slsFetch(`${MLS_URL}/terminal/ssh-connections/${connectionId}`);
        if (!response.ok) throw new Error('Failed to load connection');

        const conn = await response.json();

        // Populate modal with copied data
        document.getElementById('sshName').value = (conn.name || '') + ' (Copy)';
        document.getElementById('sshHost').value = conn.host || '';
        document.getElementById('sshPort').value = conn.port || 22;
        document.getElementById('sshUsername').value = conn.username || '';
        document.getElementById('sshPassword').value = conn.password || '';
        document.getElementById('sshPrivateKey').value = conn.privateKey || '';
        document.getElementById('sshDescription').value = conn.description || '';

        // Clear edit ID so it creates a new one
        delete document.getElementById('sshForm').dataset.editId;

        document.querySelector('#sshModalOverlay .modal-title').textContent = '➕ Add SSH Connection';

        showSshModal();
    } catch (error) {
        showToast('error', 'Error', 'Failed to duplicate connection');
    }
}

async function deleteSshConnection(connectionId, name) {
    if (!confirm(`Delete SSH connection "${name}"?\n\nThis action cannot be undone.`)) {
        return;
    }

    try {
        const response = await slsFetch(`${MLS_URL}/terminal/ssh-connections/${connectionId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete');

        refreshConnections();
        showToast('success', 'Deleted', `"${name}" has been deleted`);
    } catch (error) {
        showToast('error', 'Error', 'Failed to delete connection');
    }
}

// ========================================
// Cloud Messaging Platform Integration
// ========================================

/**
 * Toggle cloud panel visibility
 */
// ========================================
// Share Modal & Auth URL Functions
// ========================================

/**
 * Check for auth URL parameters (shared link) and auto-connect
 * @returns {Promise<boolean>} True if auth URL was processed, false otherwise
 */
async function checkForAuthUrl() {
    const hash = window.location.hash;
    if (!hash || hash.length < 10) return false;

    console.log('[Terminal] Checking for shared link in URL');
    console.log('[Terminal] Full hash:', hash);

    try {
        // Remove first # and split by # to get auth and optional channel identifier
        const hashWithoutFirst = hash.substring(1);
        console.log('[Terminal] Hash without first #:', hashWithoutFirst);

        const parts = hashWithoutFirst.split('#');
        console.log('[Terminal] Split parts:', parts);

        const authEncoded = parts[0];
        console.log('[Terminal] Auth encoded part:', authEncoded);

        if (!authEncoded) {
            console.warn('[Terminal] No auth encoded string found');
            return false;
        }

        // Decode the auth (base64-encoded JSON)
        let decoded;
        try {
            console.log('[Terminal] Decoding base64 auth string...');
            const jsonString = atob(authEncoded);
            console.log('[Terminal] Decoded JSON string:', jsonString);
            decoded = JSON.parse(jsonString);
            console.log('[Terminal] Parsed auth object:', decoded);
        } catch (decodeError) {
            console.error('[Terminal] Failed to decode auth:', decodeError);
            console.error('[Terminal] Auth string was:', authEncoded);
            return false;
        }

        console.log('[Terminal] Decoded result:', decoded);

        // ✅ Support both short (c, p, t) and long (channelName, channelPassword) property names
        // Short names are used for URL brevity (e.g., from share modal encoding)
        const channelName = decoded.channelName || decoded.c;
        const channelPassword = decoded.channelPassword || decoded.p;
        const timestamp = decoded.timestamp || decoded.t;

        if (!decoded || !channelName || !channelPassword) {
            console.warn('[Terminal] Invalid auth URL - decoded:', decoded);
            console.warn('[Terminal] Missing channel name or password');
            console.warn('[Terminal] Expected properties: c/channelName and p/channelPassword');
            return false;
        }

        console.log('[Terminal] Valid shared link found');
        console.log('[Terminal] Channel:', channelName);
        console.log('[Terminal] Timestamp:', timestamp ? new Date(timestamp).toLocaleString() : 'N/A');

        // Prompt for agent name with a nice dialog
        const agentName = await promptForAgentName(channelName);

        if (!agentName) {
            console.log('[Terminal] User cancelled agent name prompt');
            return false;
        }

        // Fill in the connection form with auth URL values
        document.getElementById('cloudChannelName').value = channelName;
        document.getElementById('cloudChannelPassword').value = channelPassword;
        document.getElementById('cloudAgentName').value = agentName;

        console.log('[Terminal] ✅ Auth URL values set:');
        console.log('[Terminal]   Channel:', channelName);
        console.log('[Terminal]   Agent:', agentName);

        // Auto-connect
        showToast('info', 'Connecting...', `Connecting to shared terminal as ${agentName}`);
        setTimeout(() => {
            connectToCloud();
        }, 500);

        return true; // ✅ Auth URL was processed successfully

    } catch (error) {
        console.error('[Terminal] Failed to process auth URL:', error);
        console.error('[Terminal] Error stack:', error.stack);
        return false;
    }
}

/**
 * Prompt user for agent name with a beautiful dialog
 */
function promptForAgentName(channelName) {
    return new Promise((resolve) => {
        // ✅ Check localStorage first - if username exists, auto-connect without showing modal
        const storedUsername = localStorage.getItem('terminal_cloudAgentName');
        if (storedUsername && storedUsername.trim()) {
            console.log('[Terminal] Found stored username, auto-connecting:', storedUsername);

            // Show connecting loader overlay
            const loaderOverlay = document.createElement('div');
            loaderOverlay.id = 'shared-terminal-loader';
            loaderOverlay.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(8px);
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease-out;
            `;

            const loaderContent = document.createElement('div');
            loaderContent.style.cssText = `
                background: var(--bg-panel);
                padding: 40px;
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                text-align: center;
                max-width: 400px;
            `;

            loaderContent.innerHTML = `
                <div style="font-size: 48px; margin-bottom: 20px; animation: pulse 1.5s ease-in-out infinite;">🔗</div>
                <h3 style="margin: 0 0 12px 0; font-size: 20px; color: var(--text-primary); font-weight: 600;">
                    Connecting to Shared Terminal
                </h3>
                <p style="margin: 0; font-size: 14px; color: var(--text-secondary); line-height: 1.6;">
                    Connecting as <strong style="color: var(--accent-cyan);">${storedUsername}</strong>
                    <br>
                    <span style="font-size: 13px; opacity: 0.8;">Channel: <strong style="color: var(--accent-purple);">${channelName}</strong></span>
                </p>
                <div style="margin-top: 20px;">
                    <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                        <div style="width: 100%; height: 100%; background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple)); 
                                    animation: progress 1.5s ease-in-out infinite;"></div>
                    </div>
                </div>
                <style>
                    @keyframes pulse {
                        0%, 100% { transform: scale(1); opacity: 1; }
                        50% { transform: scale(1.1); opacity: 0.8; }
                    }
                    @keyframes progress {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(100%); }
                    }
                </style>
            `;

            loaderOverlay.appendChild(loaderContent);
            document.body.appendChild(loaderOverlay);

            // Auto-remove loader after 10 seconds (in case connection fails)
            setTimeout(() => {
                const loader = document.getElementById('shared-terminal-loader');
                if (loader && document.body.contains(loader)) {
                    loader.style.animation = 'fadeOut 0.2s ease-out';
                    setTimeout(() => document.body.removeChild(loader), 200);
                }
            }, 10000);

            resolve(storedUsername.trim());
            return;
        }

        console.log('[Terminal] No stored username found, showing modal');

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(12px);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.2s ease-out;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: linear-gradient(135deg, var(--bg-panel) 0%, var(--bg-darker) 100%);
            border: 1px solid var(--accent-blue);
            border-radius: 16px;
            padding: 32px;
            max-width: 480px;
            width: calc(100% - 32px);
            box-shadow: 0 20px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(74, 158, 255, 0.1);
            animation: slideUp 0.3s ease-out;
        `;

        const iconStyle = 'font-size: 48px; text-align: center; margin-bottom: 16px; animation: bounce 1s ease-in-out;';

        dialog.innerHTML = `
            <style>
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
            </style>
            <div style="${iconStyle}">🖥️</div>
            <h2 style="margin: 0 0 12px 0; font-size: 24px; color: var(--text-primary); text-align: center; font-weight: 700;">
                Join Shared Terminal
            </h2>
            <p style="margin: 0 0 20px 0; font-size: 14px; color: var(--text-secondary); line-height: 1.7; text-align: center;">
                Enter your name to connect to the shared terminal
                <br>
                <span style="font-size: 13px; opacity: 0.8;">Channel: <strong style="color: var(--accent-cyan); font-weight: 600;">${channelName}</strong></span>
            </p>
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-size: 14px; color: var(--text-primary); font-weight: 600;">
                    Your Name <span style="color: var(--accent-red);">*</span>
                </label>
                <input type="text" id="agent-name-input" placeholder="Enter your name" required
                       style="width: 100%; padding: 14px; border: 2px solid var(--border-color); 
                              border-radius: 8px; background: var(--bg-darker); color: var(--text-primary); 
                              font-size: 15px; box-sizing: border-box; transition: all 0.2s;
                              font-family: 'Consolas', 'Monaco', monospace;"
                       onfocus="this.style.borderColor='var(--accent-blue)'; this.style.boxShadow='0 0 0 3px rgba(74, 158, 255, 0.1)';"
                       onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none';">

            </div>
            <div style="display: flex; gap: 12px; justify-content: stretch;">
                <button id="agent-name-confirm" style="width: 100%; padding: 14px 24px; border: none; border-radius: 8px; 
                                                        background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple)); 
                                                        color: white; cursor: pointer; font-size: 14px; font-weight: 700;
                                                        box-shadow: 0 4px 12px rgba(74, 158, 255, 0.3); transition: all 0.2s;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(74, 158, 255, 0.4)';"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(74, 158, 255, 0.3)';">
                    🔗 Connect
                </button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const input = dialog.querySelector('#agent-name-input');
        const confirmBtn = dialog.querySelector('#agent-name-confirm');

        // ✅ Username field starts EMPTY - user must enter their name
        input.value = '';
        input.focus();

        const cleanup = () => {
            overlay.style.animation = 'fadeOut 0.2s ease-out';
            setTimeout(() => {
                if (document.body.contains(overlay)) {
                    document.body.removeChild(overlay);
                }
            }, 200);
            // NOTE: Do NOT clear the hash — preserve the shared link URL so the
            // user can copy/reshare it, and so page refresh reconnects to the same channel.
        };

        const confirm = () => {
            const name = input.value.trim();
            if (name) {
                // ✅ Save username to localStorage for future auto-connect
                localStorage.setItem('terminal_cloudAgentName', name);
                console.log('[Terminal] Saved username to localStorage:', name);
                cleanup();
                resolve(name);
            } else {
                input.focus();
                input.style.borderColor = 'var(--accent-red)';
                showToast('warning', 'Name Required', 'Please enter your name to connect');
                setTimeout(() => {
                    input.style.borderColor = 'var(--border-color)';
                }, 2000);
            }
        };

        confirmBtn.onclick = confirm;

        // Enter key to confirm
        input.onkeypress = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirm();
            }
        };

        // Prevent closing by clicking outside
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                // Shake animation to indicate it can't be closed
                dialog.style.animation = 'shake 0.5s';
                setTimeout(() => {
                    dialog.style.animation = 'slideUp 0.3s ease-out';
                }, 500);
            }
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') skip();
        };

        // Add shake animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-10px); }
                75% { transform: translateX(10px); }
            }
            @keyframes fadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    });
}

/**
 * Toggle share/unshare for the currently active session
 */
function toggleShareActiveSession() {
    if (!cloudConnected || !terminalSharing) {
        showToast('warning', 'Not Connected', 'Connect to cloud first to share sessions');
        return;
    }

    // Get active session
    const activeTab = document.querySelector('.tab.active');
    if (!activeTab) {
        showToast('warning', 'No Active Session', 'Please select a terminal session first');
        return;
    }

    const sessionId = activeTab.dataset.sessionId;
    const session = sessions.get(sessionId);

    if (!session) {
        showToast('error', 'Session Not Found', 'Active session not found');
        return;
    }

    // Toggle share state
    if (session.isShared) {
        unshareTerminal(sessionId);
    } else {
        shareTerminal(sessionId);
    }

    // Update button text
    updateShareButton();
}

/**
 * Update the share button text based on active session state
 */
function updateShareButton() {
    const shareBtn = document.getElementById('cloudShareSessionBtn');
    if (!shareBtn) return;

    // Get active session
    const activeTab = document.querySelector('.tab.active');
    if (!activeTab) {
        shareBtn.textContent = '📤 Share Session';
        shareBtn.disabled = true;
        shareBtn.title = 'No active session';
        return;
    }

    const sessionId = activeTab.dataset.sessionId;
    const session = sessions.get(sessionId);

    if (!session) {
        shareBtn.textContent = '📤 Share Session';
        shareBtn.disabled = true;
        shareBtn.title = 'Session not found';
        return;
    }

    // Update button based on share state (only show Unshare when actively sharing = connected + isShared)
    if (session.isShared && cloudConnected) {
        shareBtn.textContent = '🛑 Unshare Session';
        shareBtn.disabled = false;
        shareBtn.title = 'Stop sharing this session';
    } else {
        shareBtn.textContent = '📤 Share Session';
        shareBtn.disabled = false;
        shareBtn.title = 'Share this session with connected agents';
    }
}

/**
 * Show share modal for sharing channel connection (invite link)
 */
// ========================================
// Cloud Panel Functions
// ========================================

// Global variable to store session to share after connection
let pendingSessionToShare = null;

/**
 * Open cloud connection modal
 * @param {string} sessionToShare - Optional session ID to share after connection
 */
function openCloudModal(sessionToShare = null) {
    console.log('[Messaging] Opening messaging platform modal...');

    // Store session to share after connection
    if (sessionToShare) {
        pendingSessionToShare = sessionToShare;
        console.log('[Messaging] Will share session after connection:', sessionToShare);
    }

    const overlay = document.getElementById('cloudModalOverlay');

    if (!overlay) {
        console.error('[Messaging] ❌ cloudModalOverlay element not found!');
        return;
    }

    console.log('[Messaging] Found overlay element, setting display to flex...');
    // Use inline style to override inline display:none (inline styles have higher specificity than classes)
    overlay.style.display = 'flex';

    // Verify it was added
    console.log('[Messaging] Display style:', window.getComputedStyle(overlay).display);

    // Disable Sharing tab if not connected
    if (!cloudConnected) {
        disableSharingTab();
        // Ensure we're on Connection tab
        window.switchCloudTab('connection');
    }

    // Also support old ID for compatibility
    const cloudBtn = document.getElementById('cloudToolbarBtn');
    if (cloudBtn && cloudConnected) {
        cloudBtn.classList.add('active');
    }
}

// Alias for better naming
function openMessagingModal(sessionToShare = null) {
    openCloudModal(sessionToShare);
}

/**
 * Close cloud connection modal
 */
function closeCloudModal() {
    const overlay = document.getElementById('cloudModalOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

/**
 * Toggle share section visibility within cloud modal
 */
function toggleShareSection() {
    const content = document.getElementById('shareContent');
    const btn = document.getElementById('shareToggleBtn');

    if (content && btn) {
        const isVisible = content.style.display !== 'none';

        if (isVisible) {
            // Collapse
            content.style.display = 'none';
            btn.classList.remove('expanded');
        } else {
            // Expand
            content.style.display = 'block';
            btn.classList.add('expanded');
            // Generate share URL and QR code when opening
            generateShareUrl();
        }
    }
}

/**
 * Generate share URL for the current channel
 */
/**
 * Update cloud host indicator visibility based on actual host status
 * Shows indicator only when user has shared sessions (is actually a host)
 */
function updateCloudHostIndicator() {
    const hostIndicator = document.getElementById('cloudHostIndicator');
    if (!hostIndicator) return;

    // Show indicator only if we're connected AND have shared sessions
    const isHost = terminalSharing && cloudConnected && terminalSharing.isHost();

    if (isHost) {
        hostIndicator.style.display = 'flex';
        console.log('[Messaging] Host indicator shown - user has shared sessions');
    } else {
        hostIndicator.style.display = 'none';
        console.log('[Messaging] Host indicator hidden - no shared sessions');
    }
}

function generateShareUrl() {
    const channelName = document.getElementById('cloudChannelName').value.trim();
    const channelPassword = document.getElementById('cloudChannelPassword').value.trim();

    if (!channelName || !channelPassword) {
        showToast('warning', 'Missing Info', 'Please connect to cloud first');
        return;
    }

    // Create auth object (same as whiteboard)
    const auth = {
        c: channelName,
        p: channelPassword,
        t: Date.now()
    };

    // Encode to base64
    const authEncoded = btoa(JSON.stringify(auth));

    // Build share URL with hash
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}#${authEncoded}#${channelName}`;

    // Update input
    const input = document.getElementById('shareUrlInput');
    if (input) {
        input.value = shareUrl;
    }

    // Pre-generate QR code but keep it hidden
    const qrContainer = document.getElementById('shareQrCode');
    if (qrContainer && typeof QRCode !== 'undefined') {
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, {
            text: shareUrl,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    }
}

/**
 * Toggle QR code visibility
 */
function toggleQrCode() {
    const qrContainer = document.getElementById('shareQrCode');
    const toggleBtn = document.getElementById('qrToggleBtn');
    const toggleIcon = document.getElementById('qrToggleIcon');
    const toggleText = document.getElementById('qrToggleText');

    if (qrContainer && toggleBtn) {
        const isVisible = qrContainer.style.display !== 'none';

        if (isVisible) {
            // Hide QR code
            qrContainer.style.display = 'none';
            toggleIcon.textContent = '📱';
            toggleText.textContent = 'Show QR Code';
        } else {
            // Show QR code
            qrContainer.style.display = 'block';
            toggleIcon.textContent = '✖️';
            toggleText.textContent = 'Hide QR Code';
        }
    }
}

/**
 * Copy share URL to clipboard
 */
function copyShareUrl() {
    const input = document.getElementById('shareUrlInput');
    if (input && input.value) {
        input.select();
        document.execCommand('copy');
        showToast('success', 'Copied', 'Share link copied to clipboard');
    }
}

/**
 * Generate random agent name (guaranteed unique with timestamp)
 */
function generateAgentName() {
    const adjectives = ['Swift', 'Bright', 'Noble', 'Brave', 'Wise', 'Quick', 'Bold', 'Epic', 'Smart', 'Cool'];
    const nouns = ['Tiger', 'Eagle', 'Wolf', 'Hawk', 'Lion', 'Bear', 'Fox', 'Owl', 'Dragon', 'Phoenix'];

    // Use timestamp for guaranteed uniqueness
    const timestamp = Date.now() % 10000; // Last 4 digits
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const name = `${adj}-${noun}-${timestamp}`;

    // Only set if field is empty (don't override saved name)
    const agentNameInput = document.getElementById('cloudAgentName');
    if (agentNameInput && (!agentNameInput.value || agentNameInput.value.trim() === '')) {
        agentNameInput.value = name;
    }

    return name;
}

/**
 * Regenerate agent name (only if empty or not from DB)
 */
function regenerateAgentName() {
    const agentNameInput = document.getElementById('cloudAgentName');

    // Only regenerate if empty
    if (!agentNameInput.value || agentNameInput.value.trim() === '') {
        const newName = generateAgentName();
        showToast('success', 'Name Generated', `New agent name: ${newName}`);
    } else {
        // Ask user if they want to replace existing name
        if (confirm('Current name will be replaced. Continue?')) {
            agentNameInput.value = '';
            const newName = generateAgentName();
            showToast('success', 'Name Regenerated', `New agent name: ${newName}`);
        }
    }
}

/**
 * Toggle Channel Password visibility
 */
function toggleCloudPasswordVisibility() {
    const passwordInput = document.getElementById('cloudChannelPassword');
    const toggleButton = document.getElementById('cloudPasswordToggle');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleButton.textContent = '🙈'; // closed eye
        toggleButton.title = 'Hide password';
    } else {
        passwordInput.type = 'password';
        toggleButton.textContent = '👁️'; // open eye
        toggleButton.title = 'Show password';
    }
}

/**
 * Regenerate connection (channel name, password, and optionally agent name)
 * Same pattern as whiteboard regenerate
 */
function regenerateConnection() {
    const channelNameInput = document.getElementById('cloudChannelName');
    const passwordInput = document.getElementById('cloudChannelPassword');
    const agentNameInput = document.getElementById('cloudAgentName');

    // Generate random channel name (terminal-XXXXXXXX)
    const randomDigits = () => Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
    const newChannelName = `terminal-${randomDigits()}`;

    // Generate random password (8 characters: 4 letters + 4 digits)
    const randomLowercase = (n) => {
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        let s = '';
        for (let i = 0; i < n; i++) {
            s += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        return s;
    };
    const randomNumbers = (n) => {
        let s = '';
        for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
        return s;
    };
    const newPassword = randomLowercase(4) + randomNumbers(4);

    // Update channel and password
    channelNameInput.value = newChannelName;
    passwordInput.value = newPassword;

    // Only regenerate agent name if it's not saved in localStorage
    const savedAgentName = localStorage.getItem('cloud_agent_name');
    if (!savedAgentName || savedAgentName.trim() === '') {
        if (!agentNameInput.value || agentNameInput.value.trim() === '') {
            const newName = generateAgentName();
            agentNameInput.value = newName;
        }
    }

    showToast('success', '🔄 Regenerated', 'New channel name and password generated');

    // Save to localStorage
    saveCloudConfig();
}

/**
 * Load cloud connection config from MLS backend
 */
/**
 * Load cloud config from backend (SLS)
 * @returns {Object|null} Backend config or null if unavailable
 */
async function loadBackendCloudConfig() {
    // Test mode: Skip backend loading (SLS disabled)
    if (TEST_MODE_NO_SLS) {
        console.log('[Cloud] ⚠️ Backend disabled (test mode)');
        return null;
    }

    try {
        const response = await slsFetch(`${MLS_URL}/cloud/connection`);
        if (response.ok) {
            const data = await response.json();
            const config = JSON.parse(data.config || '{}');
            console.log('[Cloud] ✅ Loaded from backend');
            return config;
        }
    } catch (backendError) {
        console.log('[Cloud] ⚠️ Backend unavailable (SLS offline)');
    }

    return null;
}

async function loadCloudConfig() {
    try {
        // ✅ LAYER 1: Load from localStorage (always available)
        const localConfigStr = localStorage.getItem('terminal_cloud_config');
        const localStorageConfig = localConfigStr ? JSON.parse(localConfigStr) : null;
        if (localStorageConfig) {
            console.log('[Cloud] ✅ Loaded from localStorage');
        }

        // ✅ LAYER 2: Load from backend (if SLS is available and not in test mode)
        const backendConfig = await loadBackendCloudConfig();

        // ✅ DECIDE: Which config to use and sync if needed
        const config = await decideAndSyncConfig(localStorageConfig, backendConfig);

        if (!config) {
            console.log('[Cloud] ℹ️ No saved config found');
            return;
        }

        // ✅ POPULATE: Fill in the form
        populateCloudForm(config);

        // ❌ REMOVED AUTO-CONNECT: User must manually connect
        // Connection should be done manually by clicking the Connect button
        console.log('[Cloud] ℹ️ Config loaded. Click "Connect" to connect to cloud.');
    } catch (error) {
        console.error('[Cloud] ❌ Failed to load config:', error);
    }
}

/**
 * Decide which config to use and sync layers if needed
 * @returns {Object|null} The config to use
 */
async function decideAndSyncConfig(localStorageConfig, backendConfig) {
    const hasLocal = localStorageConfig?.channelName;
    const hasBackend = backendConfig?.channelName;

    // Case 1: Both exist → prefer backend, sync localStorage
    if (hasBackend) {
        console.log('[Cloud] 📋 Using backend config (source of truth)');

        // Sync localStorage if different
        if (JSON.stringify(localStorageConfig) !== JSON.stringify(backendConfig)) {
            localStorage.setItem('terminal_cloud_config', JSON.stringify(backendConfig));
            console.log('[Cloud] 🔄 Synced localStorage ← backend');
        }

        return backendConfig;
    }

    // Case 2: Only localStorage exists → use it, try to sync backend
    if (hasLocal) {
        console.log('[Cloud] 📋 Using localStorage config (backend unavailable)');

        // Try to sync backend if it responded but was empty (null means it responded)
        if (backendConfig !== null) {
            const saved = await saveBackendCloudConfig(localStorageConfig);
            if (saved) {
                console.log('[Cloud] 🔄 Synced backend ← localStorage');
            }
        }

        return localStorageConfig;
    }

    // Case 3: Neither exists
    return null;
}

/**
 * Populate cloud connection form with config
 */
function populateCloudForm(config) {
    document.getElementById('cloudChannelName').value = config.channelName || '';
    document.getElementById('cloudChannelPassword').value = config.channelPassword || '';
    document.getElementById('cloudAgentName').value = config.agentName || '';
    console.log('[Cloud] ✅ Form populated');
}

/**
 * Save cloud config to backend (SLS)
 * @param {Object} config - Config object to save
 * @returns {Promise<boolean>} True if saved successfully
 */
async function saveBackendCloudConfig(config) {
    // Test mode: Skip backend saving (SLS disabled)
    if (TEST_MODE_NO_SLS) {
        console.log('[Cloud] ⚠️ Backend save disabled (test mode)');
        return false;
    }

    try {
        await fetch(`${MLS_URL}/cloud/connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: JSON.stringify(config) })
        });
        console.log('[Cloud] ✅ Config saved to backend (both layers synced)');
        return true;
    } catch (backendError) {
        // Check if this is a CORS/network error
        if (backendError.message && backendError.message.includes('CORS')) {
            console.warn('[Cloud] ⚠️ CORS error - SLS must run on same origin or localhost');
        } else if (backendError.message && backendError.message.includes('Failed to fetch')) {
            console.warn('[Cloud] ⚠️ Network error - SLS not reachable (offline or CORS blocked)');
        } else {
            console.log('[Cloud] ⚠️ Backend save failed (SLS offline):', backendError.message);
        }
        return false;
    }
}

/**
 * Save cloud connection config to both layers
 */
async function saveCloudConfig(isConnected = false) {
    try {
        const config = {
            channelName: document.getElementById('cloudChannelName').value,
            channelPassword: document.getElementById('cloudChannelPassword').value,
            agentName: cloudAgentName || document.getElementById('cloudAgentName').value,
            isConnected: isConnected
        };

        // ✅ LAYER 1: Save to localStorage (always works, even without SLS)
        localStorage.setItem('terminal_cloud_config', JSON.stringify(config));
        console.log('[Cloud] ✅ Config saved to localStorage');

        // ✅ LAYER 2: Save to backend (keep both layers in sync when SLS is available)
        await saveBackendCloudConfig(config);
    } catch (error) {
        console.error('[Cloud] ❌ Failed to save config:', error);
    }
}

/**
 * Connect to cloud using UserConnectionBase (same pattern as air-hockey)
 */
async function connectToCloud() {
    const channelName = document.getElementById('cloudChannelName').value.trim();
    const channelPassword = document.getElementById('cloudChannelPassword').value.trim();
    let agentName = document.getElementById('cloudAgentName').value.trim();

    if (!channelName || !channelPassword) {
        showToast('warning', 'Missing Info', 'Please enter channel name and password');
        return;
    }

    if (!agentName) {
        agentName = generateAgentName();
        document.getElementById('cloudAgentName').value = agentName;
    }

    const connectBtn = document.getElementById('cloudConnectBtn');
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    try {
        terminalSharing = new TerminalSharing();
        window.terminalSharing = terminalSharing;

        // Set up TerminalShareManager callbacks

        // Called when a remote agent shares a session
        terminalSharing.onSharedSessionAdd = (sessionId, sessionInfo, sourceAgent) => {
            console.log('[Terminal] Remote session shared:', sessionId, sessionInfo, 'from:', sourceAgent);

            const permIcon = sessionInfo.permission === 'readwrite' ? '✏️' : '👁️';
            const permLabel = sessionInfo.permission === 'readwrite' ? 'Read-Write' : 'Read-Only';
            showToast('success', '📤 New Session Shared',
                `${sourceAgent} shared "${sessionInfo.name}" (${permLabel})`, 6000);

            // Create a view-only terminal session for this shared session
            createSharedTerminalSession(sessionId, sessionInfo, sourceAgent);

            updateAgentsList();
            updateSharedTerminalsList();
        };

        // Called when a remote agent unshares a session
        terminalSharing.onSharedSessionRemove = (sessionId, sourceAgent) => {
            console.log('[Terminal] Remote session unshared:', sessionId, 'from:', sourceAgent);

            const session = sessions.get(sessionId);
            const sessionName = session?.name || 'Terminal';
            showToast('warning', '🛑 Session Unshared',
                `${sourceAgent} stopped sharing "${sessionName}"`, 5000);

            // Close the view-only session if it exists
            if (sessions.has(sessionId)) {
                closeSession(sessionId);
            }

            updateAgentsList();
            updateSharedTerminalsList();
        };

        // Called when receiving terminal output from a shared session
        terminalSharing.onSessionOutput = (sessionId, data, sourceAgent) => {
            console.log('[Terminal] Received output from:', sourceAgent, 'session:', sessionId, 'bytes:', data.length);

            // Write to the specific shared session terminal
            const session = sessions.get(sessionId);
            if (session && session.terminal && session.owner === sourceAgent) {
                session.terminal.write(data);
            } else {
                console.warn('[Terminal] No matching session found for session:', sessionId, 'from:', sourceAgent);
            }
        };

        // Called when receiving input for our shared session (from viewer to owner)
        terminalSharing.onSessionInput = (sessionId, data, sourceAgent) => {
            console.log('[Terminal] ========================================');
            console.log('[Terminal] Received input from:', sourceAgent, 'for session:', sessionId);
            console.log('[Terminal] Data length:', data?.length, 'bytes');

            // If we own this session (no owner = local) and it's shared, send input to local terminal
            const session = sessions.get(sessionId);
            console.log('[Terminal] Session exists:', !!session);
            console.log('[Terminal] Session.isShared:', session?.isShared);
            console.log('[Terminal] Session.owner:', session?.owner);
            console.log('[Terminal] Session.dataSender:', !!session?.dataSender);
            console.log('[Terminal] Session.permission (global):', session?.permission);
            console.log('[Terminal] Session.agentPermissions:', session?.agentPermissions);

            if (session && session.isShared && !session.owner && session.dataSender) {
                // ✅ Check per-agent permission first, then fall back to global permission
                const agentPerm = session.agentPermissions?.[sourceAgent];
                const effectivePerm = agentPerm || session.permission || 'readonly';

                console.log('[Terminal] Agent-specific permission:', agentPerm);
                console.log('[Terminal] Effective permission:', effectivePerm);

                if (effectivePerm !== 'readwrite') {
                    console.warn('[Terminal] ❌ BLOCKED input from', sourceAgent, '- permission:', effectivePerm);
                    console.warn('[Terminal] Required permission: readwrite, Got:', effectivePerm);
                    return;
                }

                console.log('[Terminal] ✅ ALLOWED - Forwarding input to local terminal dataSender');
                session.dataSender.send(data);
            } else {
                console.warn('[Terminal] Received input for non-owned or non-shared session:', sessionId);
                console.log('[Terminal] Conditions: isShared:', session?.isShared, 'owner:', session?.owner, 'dataSender:', !!session?.dataSender);
            }
            console.log('[Terminal] ========================================');
        };

        // ========================================
        // FILE SYSTEM SHARING HANDLERS
        // ========================================

        /**
         * Handle file system requests from viewers (viewers → owner)
         * Owner acts as proxy to their local file system
         */
terminalSharing.onFileSystemRequest = async (sessionId, operation, params, sourceAgent, requestId) => {
    console.log('[FileSystem] Received request from:', sourceAgent, 'session:', sessionId, 'op:', operation);

    const session = sessions.get(sessionId);
    if (!session || !session.isShared || session.owner) {
        console.warn('[FileSystem] Rejecting request - not the owner or session not shared');
        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
            success: false,
            error: 'Not authorized - not the session owner'
        }, sourceAgent);
        return;
    }

    // ✅ SECURITY: Validate permission for the requester
    // Get the permission for this specific agent (or use session default)
    const requesterPermission = session.agentPermissions?.[sourceAgent] || session.permission;

    console.log('[FileSystem] Requester:', sourceAgent, 'permission:', requesterPermission);

    // ✅ SECURITY: Define which operations require write permission
    const WRITE_OPERATIONS = ['write', 'delete', 'mkdir', 'rename', 'copy', 'append', 'write-at', 'upload', 'upload-init', 'upload-chunk', 'upload-finalize', 'upload-cancel'];
    const READ_OPERATIONS = ['list', 'read', 'info', 'status', 'read-binary', 'read-range', 'download', 'download-chunk'];

    // ✅ SECURITY: Block write operations if requester only has readonly permission
    if (WRITE_OPERATIONS.includes(operation) && requesterPermission === 'readonly') {
        console.warn('[FileSystem] ❌ BLOCKED: Write operation denied for readonly user:', sourceAgent, 'op:', operation);
        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
            success: false,
            error: 'Permission denied - you only have read-only access',
            errorCode: 'PERMISSION_DENIED'
        }, sourceAgent);

        // ✅ Notify owner about blocked attempt
        showToast('warning', '🚫 Blocked Request',
            `${sourceAgent} tried to perform write operation "${operation}" with readonly permission`, 5000);
        return;
    }

    // ✅ Validate operation is known
    if (!WRITE_OPERATIONS.includes(operation) && !READ_OPERATIONS.includes(operation)) {
        console.warn('[FileSystem] ❌ Unknown operation:', operation);
        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
            success: false,
            error: 'Unknown operation: ' + operation,
            errorCode: 'INVALID_OPERATION'
        }, sourceAgent);
        return;
    }

    console.log('[FileSystem] ✅ Permission validated - proceeding with operation:', operation);

    // Get file system session ID (may not be explicitly set, so use terminal session ID as fallback)
    // Backend auto-creates file system sessions using terminal session ID
    const fsSessionId = session.fileSystemSessionId || sessionId;
    console.log('[FileSystem] Using FS session ID:', fsSessionId, 'for terminal session:', sessionId);

    try {
        let result;

                // Execute the requested operation on owner's file system
                switch (operation) {
                    case 'list':
                        result = await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}/list?path=${encodeURIComponent(params.path || '.')}`);
                        break;
                    case 'read':
                        result = await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}/read?path=${encodeURIComponent(params.path)}`);
                        // ✅ Notify owner that viewer opened a file
                        if (result.ok) {
                            const fileName = params.path.split('/').pop() || params.path;
                            showToast('info', `📂 ${sourceAgent}`, `Opened file: ${fileName}`);
                        }
                        break;
                    case 'info':
                        result = await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}/info?path=${encodeURIComponent(params.path)}`);
                        break;
                    case 'write':
                        result = await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}/write`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(params)
                        });
                        // ✅ Notify owner that viewer saved a file
                        if (result.ok) {
                            const fileName = params.path.split('/').pop() || params.path;
                            showToast('success', `💾 ${sourceAgent}`, `Saved file: ${fileName}`);
                        }
                        break;
                    case 'delete':
                        result = await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}/delete?path=${encodeURIComponent(params.path)}&recursive=${params.recursive || false}`, {
                            method: 'DELETE'
                        });
                        // ✅ Notify owner that viewer deleted a file
                        if (result.ok) {
                            const fileName = params.path.split('/').pop() || params.path;
                            showToast('warning', `🗑️ ${sourceAgent}`, `Deleted: ${fileName}`);
                        }
                        break;
                    case 'mkdir':
                        result = await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}/mkdir?path=${encodeURIComponent(params.path)}`, {
                            method: 'POST'
                        });
                        // ✅ Notify owner that viewer created a folder
                        if (result.ok) {
                            const folderName = params.path.split('/').pop() || params.path;
                            showToast('info', `📁 ${sourceAgent}`, `Created folder: ${folderName}`);
                        }
                        break;
                    case 'rename':
                        result = await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}/rename?oldPath=${encodeURIComponent(params.oldPath)}&newPath=${encodeURIComponent(params.newPath)}`, {
                            method: 'POST'
                        });
                        // ✅ Notify owner that viewer renamed a file
                        if (result.ok) {
                            const oldName = params.oldPath.split('/').pop() || params.oldPath;
                            const newName = params.newPath.split('/').pop() || params.newPath;
                            showToast('info', `✏️ ${sourceAgent}`, `Renamed: ${oldName} → ${newName}`);
                        }
                        break;
                    case 'upload':
                        // ✅ Handle file upload from remote viewer
                        console.log('[FileSystem] Processing upload request from:', sourceAgent, 'file:', params.fileName);

                        // Decode Base64 file data
                        const binaryString = atob(params.fileData);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        const blob = new Blob([bytes], { type: 'application/octet-stream' });

                        // Create FormData for backend upload
                        const formData = new FormData();
                        formData.append('file', blob, params.fileName);

                        // Upload to backend
                        result = await fetch(
                            `${MLS_URL}/filesystem/${encodeURIComponent(fsSessionId)}/upload?path=${encodeURIComponent(params.path)}`,
                            {
                                method: 'POST',
                                headers: getSlsHeaders(),
                                body: formData
                            }
                        );

                        // ✅ Notify owner that viewer uploaded a file
                        if (result.ok) {
                            const fileName = params.fileName;
                            const fileSize = params.fileSize ? `(${(params.fileSize / 1024).toFixed(1)} KB)` : '';
                            showToast('success', `📤 ${sourceAgent}`, `Uploaded: ${fileName} ${fileSize}`);
                        }
                        break;
                    case 'download':
                        // ✅ Handle file download from remote viewer
                        console.log('[FileSystem] Processing download request from:', sourceAgent, 'path:', params.path);

                        // Fetch file from backend
                        const downloadUrl = `${MLS_URL}/filesystem/${encodeURIComponent(fsSessionId)}/download?path=${encodeURIComponent(params.path)}`;
                        const downloadResponse = await fetch(downloadUrl, {
                            headers: getSlsHeaders()
                        });

                        if (!downloadResponse.ok) {
                            throw new Error(`Download failed: ${downloadResponse.status}`);
                        }

                        // Read file as binary
                        const fileBlob = await downloadResponse.blob();
                        const arrayBuffer = await fileBlob.arrayBuffer();
                        const uint8Array = new Uint8Array(arrayBuffer);

                        // Convert to Base64 for transmission via WebRTC
                        let binaryStr = '';
                        for (let i = 0; i < uint8Array.length; i++) {
                            binaryStr += String.fromCharCode(uint8Array[i]);
                        }
                        const base64Data = btoa(binaryStr);

                        // Send response with Base64 data
                        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
                            success: true,
                            fileData: base64Data
                        }, sourceAgent);

                        // ✅ Notify owner that viewer downloaded a file
                        const downloadFileName = params.path.split('/').pop() || params.path;
                        showToast('info', `📥 ${sourceAgent}`, `Downloaded: ${downloadFileName}`);

                        // Return early since we already sent the response
                        return;

                    // ========== CHUNKED UPLOAD OPERATIONS ==========
                    case 'upload-init':
                        // Initialize chunked upload
                        console.log('[FileSystem] Initializing chunked upload:', params.uploadId, 'file:', params.fileName,
                                    `size: ${(params.fileSize / 1024 / 1024).toFixed(2)} MB, chunks: ${params.totalChunks}`);

                        if (!window.activeUploads) {
                            window.activeUploads = new Map();
                        }

                        window.activeUploads.set(params.uploadId, {
                            fileName: params.fileName,
                            filePath: params.filePath,
                            fileSize: params.fileSize,
                            totalChunks: params.totalChunks,
                            chunkSize: params.chunkSize,
                            chunks: new Map(),
                            startTime: Date.now()
                        });

                        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
                            success: true,
                            message: 'Upload initialized'
                        }, sourceAgent);

                        showToast('info', `📤 ${sourceAgent}`, `Starting upload: ${params.fileName}`);
                        return;

                    case 'upload-chunk':
                        // Receive and store chunk
                        console.log('[FileSystem] Receiving chunk:', params.chunkIndex, 'for upload:', params.uploadId);

                        if (!window.activeUploads || !window.activeUploads.has(params.uploadId)) {
                            throw new Error('Upload session not found - please restart upload');
                        }

                        const upload = window.activeUploads.get(params.uploadId);

                        // Store chunk data
                        upload.chunks.set(params.chunkIndex, params.chunkData);

                        const progress = Math.round((upload.chunks.size / upload.totalChunks) * 100);
                        console.log(`[FileSystem] Chunk ${params.chunkIndex + 1}/${upload.totalChunks} received (${progress}%)`);

                        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
                            success: true,
                            chunksReceived: upload.chunks.size,
                            totalChunks: upload.totalChunks,
                            progress: progress
                        }, sourceAgent);
                        return;

                    case 'upload-finalize':
                        // Assemble chunks and upload to backend
                        console.log('[FileSystem] Finalizing chunked upload:', params.uploadId);

                        if (!window.activeUploads || !window.activeUploads.has(params.uploadId)) {
                            throw new Error('Upload session not found');
                        }

                        const finalUpload = window.activeUploads.get(params.uploadId);

                        // Verify all chunks received
                        if (finalUpload.chunks.size !== finalUpload.totalChunks) {
                            throw new Error(`Missing chunks: received ${finalUpload.chunks.size}/${finalUpload.totalChunks}`);
                        }

                        // Assemble all chunks in order
                        const allChunks = [];
                        for (let i = 0; i < finalUpload.totalChunks; i++) {
                            if (!finalUpload.chunks.has(i)) {
                                throw new Error(`Missing chunk ${i}`);
                            }
                            allChunks.push(finalUpload.chunks.get(i));
                        }

                        // Decode all Base64 chunks and combine
                        const binaryChunks = allChunks.map(base64Chunk => {
                            const binaryString = atob(base64Chunk);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }
                            return bytes;
                        });

                        // Combine all binary chunks
                        const combinedBlob = new Blob(binaryChunks, { type: 'application/octet-stream' });

                        // Upload to backend
                        const uploadFormData = new FormData();
                        uploadFormData.append('file', combinedBlob, finalUpload.fileName);

                        const uploadResponse = await fetch(
                            `${MLS_URL}/filesystem/${encodeURIComponent(fsSessionId)}/upload?path=${encodeURIComponent(finalUpload.filePath)}`,
                            {
                                method: 'POST',
                                headers: getSlsHeaders(),
                                body: uploadFormData
                            }
                        );

                        if (!uploadResponse.ok) {
                            throw new Error(`Backend upload failed: ${uploadResponse.status}`);
                        }

                        const uploadResult = await uploadResponse.json();

                        // Cleanup
                        window.activeUploads.delete(params.uploadId);

                        const duration = ((Date.now() - finalUpload.startTime) / 1000).toFixed(1);
                        const fileSize = (finalUpload.fileSize / 1024 / 1024).toFixed(2);

                        console.log(`[FileSystem] Upload completed in ${duration}s: ${finalUpload.fileName} (${fileSize} MB)`);

                        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
                            success: true,
                            message: 'Upload completed',
                            duration: duration,
                            fileSize: finalUpload.fileSize
                        }, sourceAgent);

                        showToast('success', `📤 ${sourceAgent}`, `Uploaded: ${finalUpload.fileName} (${fileSize} MB in ${duration}s)`);
                        return;

                    case 'upload-cancel':
                        // Cancel and cleanup upload
                        console.log('[FileSystem] Cancelling upload:', params.uploadId);

                        if (window.activeUploads) {
                            window.activeUploads.delete(params.uploadId);
                        }

                        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
                            success: true,
                            message: 'Upload cancelled'
                        }, sourceAgent);
                        return;

                    // ========== CHUNKED DOWNLOAD OPERATIONS ==========
                    case 'download-chunk':
                        // Download file chunk
                        console.log('[FileSystem] Downloading chunk from:', params.start, 'to:', params.end, 'path:', params.path);

                        // Fetch full file from backend
                        const chunkDownloadUrl = `${MLS_URL}/filesystem/${encodeURIComponent(fsSessionId)}/download?path=${encodeURIComponent(params.path)}`;
                        const chunkDownloadResponse = await fetch(chunkDownloadUrl, {
                            headers: getSlsHeaders()
                        });

                        if (!chunkDownloadResponse.ok) {
                            throw new Error(`Download failed: ${chunkDownloadResponse.status}`);
                        }

                        // Read file as binary
                        const chunkFileBlob = await chunkDownloadResponse.blob();
                        const chunkArrayBuffer = await chunkFileBlob.arrayBuffer();
                        const chunkUint8Array = new Uint8Array(chunkArrayBuffer);

                        // Extract requested chunk
                        const chunkSlice = chunkUint8Array.slice(params.start, params.end);

                        // Convert to Base64
                        let chunkBinaryStr = '';
                        for (let i = 0; i < chunkSlice.length; i++) {
                            chunkBinaryStr += String.fromCharCode(chunkSlice[i]);
                        }
                        const chunkBase64Data = btoa(chunkBinaryStr);

                        console.log(`[FileSystem] Sending chunk: ${params.start}-${params.end} (${chunkSlice.length} bytes)`);

                        terminalSharing.sendFileSystemResponse(sessionId, requestId, {
                            success: true,
                            chunkData: chunkBase64Data,
                            start: params.start,
                            end: params.end,
                            chunkSize: chunkSlice.length
                        }, sourceAgent);
                        return;

                    case 'status':
                        result = await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}/status`);
                        break;
                    default:
                        throw new Error('Unknown operation: ' + operation);
                }

                const data = await result.json();
                terminalSharing.sendFileSystemResponse(sessionId, requestId, data, sourceAgent);

                // ✅ After successful write operation, broadcast notification to ALL users
                // This notifies everyone (including owner) that the file was saved
                if (operation === 'write' && result.ok) {
                    console.log('[FileSystem] Broadcasting write notification to all users after save');

                    const notificationDetails = {
                        path: params.path,
                        name: params.path.split('/').pop() || params.path,
                        savedBy: sourceAgent
                    };

                    // Broadcast to other users
                    terminalSharing.sendFileSystemNotification(
                        sessionId,
                        'write',
                        notificationDetails
                        // No targetAgent = broadcast to all
                    );

                    // ✅ Also trigger notification handler locally for the host/owner
                    // The host doesn't receive their own broadcast, so we call the handler directly
                    console.log('[FileSystem] Triggering local notification handler for host/owner');
                    if (terminalSharing.onFileSystemNotification) {
                        terminalSharing.onFileSystemNotification(sessionId, 'write', notificationDetails, sourceAgent);
                    }
                }

            } catch (error) {
                console.error('[FileSystem] Error handling request:', error);
                terminalSharing.sendFileSystemResponse(sessionId, requestId, {
                    success: false,
                    error: error.message
                }, sourceAgent);
            }
        };

/**
 * Handle file system responses from owner (owner → viewer)
 * Viewer receives results from owner's proxy requests
 */
terminalSharing.onFileSystemResponse = (sessionId, requestId, data, sourceAgent) => {
    console.log('[FileSystem] Received response from:', sourceAgent, 'requestId:', requestId);

    // Resolve the pending promise for this request
    const resolve = pendingFileSystemRequests.get(requestId);
    if (resolve) {
        pendingFileSystemRequests.delete(requestId); // Clear the pending request
        resolve(data); // Resolve the promise with the data
    } else {
        console.warn('[FileSystem] No pending callback for requestId:', requestId);
    }
};

/**
 * Handle file system navigation from viewer (viewer navigates, owner sees update)
 * Owner receives navigation updates from viewers
 */
terminalSharing.onFileSystemNavigate = (sessionId, path, sourceAgent) => {
    console.log('[FileSystem] Viewer navigated:', sourceAgent, 'session:', sessionId, 'path:', path);

    // If file explorer is currently showing this session, sync the navigation
    if (fileExplorer && fileExplorer.terminalSessionId === sessionId) {
        console.log('[FileSystem] Syncing navigation from viewer to owner');
        // Update file explorer to show the same path (without triggering another sync)
        fileExplorer.navigateTo(path, false); // false = don't trigger sync event

        // Show subtle notification
        showToast('info', '📁 Viewer Navigating', `${sourceAgent} → ${path}`, 3000);
    }
};

/**
 * Handle file system notifications from viewer (viewer performs action, owner gets notified)
 * Owner receives notifications when viewers perform file operations
 */
terminalSharing.onFileSystemNotification = (sessionId, operation, details, sourceAgent) => {
    console.log('[FileSystem] Received notification from:', sourceAgent, 'op:', operation, 'details:', details);

    const session = sessions.get(sessionId);
    const sessionName = session?.name || 'Terminal';

    // Map operations to user-friendly messages
    const messages = {
        'read': `📄 ${sourceAgent} opened: ${details.path}`,
        'write': `💾 ${sourceAgent} saved: ${details.path}`,
        'delete': `🗑️ ${sourceAgent} deleted: ${details.path}`,
        'mkdir': `📁 ${sourceAgent} created folder: ${details.path}`,
        'rename': `✏️ ${sourceAgent} renamed: ${details.oldPath} → ${details.newPath}`,
        'navigate': `📂 ${sourceAgent} browsing: ${details.path}`
    };

    const message = messages[operation] || `${sourceAgent} performed ${operation}`;

    // Show notification to owner
    showToast('info', `🔔 File System Activity`, message, 4000);

    // ✅ If someone ELSE saved a file, check if we have it open in file editor
    // Don't show reload button if we are the one who saved it
    // Use details.savedBy (actual saver) instead of sourceAgent (message relayer/owner)
    const actualSaver = details.savedBy || sourceAgent;
    const isOurAction = actualSaver === window.cloudAgentName || actualSaver === terminalSharing.username;

    if (operation === 'write' && window.fileEditor && details.path && !isOurAction) {
        console.log('[FileSystem] File saved by another user - triggering reload check');
        console.log('[FileSystem] Details:', {
            sessionId,
            path: details.path,
            name: details.name,
            actualSaver: actualSaver,
            sourceAgent: sourceAgent,
            ourUsername: terminalSharing.username,
            isOurAction: isOurAction,
            fullDetails: details
        });
        console.log('[FileSystem] Calling fileEditor.showReloadNotification with:', sessionId, details.path, actualSaver);
        window.fileEditor.showReloadNotification(sessionId, details.path, actualSaver);
    } else if (operation === 'write' && isOurAction) {
        console.log('[FileSystem] Skipping reload notification - we saved the file ourselves');
        console.log('[FileSystem] actualSaver:', actualSaver, 'ourUsername:', terminalSharing.username);
    }

    // If file explorer is open for this session, refresh the view
    // ✅ IMPORTANT: For remote/shared sessions, only the OWNER should refresh!
    // Viewer (Host B) should NOT call refresh() directly - it would hit backend directly instead of proxy!
    //
    // How it works:
    // 1. Host A (owner) refreshes file explorer after file save ✅
    // 2. Host A broadcasts navigation via shareFileSystemNavigation() ✅
    // 3. Host B receives 'fs-navigate' message ✅
    // 4. Host B's onFileSystemNavigate handler updates file explorer ✅
    // 5. Both hosts see the same view, but only Host A called backend!
    if (fileExplorer && fileExplorer.terminalSessionId === sessionId && operation !== 'read' && operation !== 'navigate') {
        const isRemoteSession = window.isRemoteFileSystem && window.isRemoteFileSystem(sessionId);

        if (isRemoteSession) {
            console.log('[FileSystem] Skipping refresh for remote session - viewer will receive navigation event from owner');
            // Host B (viewer) waits for 'fs-navigate' event from Host A
            // This prevents duplicate backend calls and SSH session issues
        } else {
            // Host A (owner) refreshes and broadcasts navigation
            console.log('[FileSystem] Refreshing file explorer after owner action');
            setTimeout(() => {
                fileExplorer.refresh(); // This will trigger shareFileSystemNavigation()
            }, 500);
        }
    }
};

        // Listen for agent connection events to update agents list
        terminalSharing.onUserJoining = (event) => {
            console.log('[Terminal] Agent joining:', event.agentName);
            showToast('info', '👋 Agent Joining', `${event.agentName} is connecting...`);
            updateAgentsList();
            updateSharedTerminalsList();
            updateMySharesList();
        };

        terminalSharing.onUserJoin = (event) => {
            console.log('[Terminal] Agent joined:', event.agentName);

            // Check if I have any shared sessions
            const mySharesCount = Array.from(sessions.values()).filter(s => s.isShared && !s.owner).length;
            const toastMsg = mySharesCount > 0
                ? `${event.agentName} connected (can view your ${mySharesCount} shared session${mySharesCount > 1 ? 's' : ''})`
                : `${event.agentName} connected`;

            showToast('success', '✅ Agent Joined', toastMsg, 4000);

            // ✅ CRITICAL: Call parent class method to send our shared sessions to new agent
            if (terminalSharing.sendSharedSessionsToAgent) {
                terminalSharing.sendSharedSessionsToAgent(event.agentName);
            }

            updateAgentsList();
            updateSharedTerminalsList();
            updateMySharesList();
        };

        terminalSharing.onUserLeave = (event) => {
            console.log('[Terminal] Agent left:', event.agentName);

            // ✅ Remove this agent from all session viewers
            if (terminalSharing) {
                terminalSharing.removeViewerFromAllSessions(event.agentName);
            }

            // ✅ Clear any custom permissions for this agent from all shared sessions
            sessions.forEach((session, sessionId) => {
                if (session.isShared && !session.owner && session.agentPermissions) {
                    if (session.agentPermissions[event.agentName]) {
                        delete session.agentPermissions[event.agentName];
                        console.log('[Terminal] Cleared permissions for disconnected agent:', event.agentName, 'from session:', sessionId);
                    }
                }
            });

            // Check if I have any shared sessions
            const mySharesCount = Array.from(sessions.values()).filter(s => s.isShared && !s.owner).length;
            const toastMsg = mySharesCount > 0
                ? `${event.agentName} disconnected (was viewing your shares)`
                : `${event.agentName} disconnected`;

            showToast('info', '👋 Agent Left', toastMsg, 4000);

            updateAgentsList();
            updateSharedTerminalsList();
            updateMySharesList();
            updateSidebarBadges();
        };

        // ✅ Called when a viewer joins a shared session
        terminalSharing.onViewerJoin = (sessionId, agentName) => {
            console.log('[Terminal] Viewer joined:', agentName, 'session:', sessionId);
            updateMySharesList();
        };

        // ✅ Called when a viewer leaves a shared session
        terminalSharing.onViewerLeave = (sessionId, agentName) => {
            console.log('[Terminal] Viewer left:', agentName, 'session:', sessionId);
            updateMySharesList();
        };

        // Called when someone is typing in a shared terminal
        terminalSharing.onTypingIndicator = (sessionId, agentName, isTyping) => {
            updateTypingIndicator(sessionId, agentName, isTyping);
        };

        // Called when a viewer requests write permission
        terminalSharing.onPermissionRequest = (sessionId, requester) => {
            console.log('[Terminal] Permission request from:', requester, 'for session:', sessionId);
            showPermissionRequestNotification(sessionId, requester);
        };

        // Called when owner responds to our permission request
        terminalSharing.onPermissionResponse = (sessionId, granted, owner) => {
            console.log('[Terminal] Permission response:', granted ? 'GRANTED' : 'DENIED', 'from:', owner);
            if (granted) {
                showToast('success', '✅ Permission Granted', `${owner} granted you write access`);
                updateSessionPermissionUI(sessionId, 'readwrite');

                // ✅ Update file explorer button immediately if this session is active
                if (activeSessionId === sessionId) {
                    const session = sessions.get(sessionId);
                    if (session && window.updateFileExplorerButtonState) {
                        console.log('[Terminal] Updating file explorer button after permission grant');
                        window.updateFileExplorerButtonState(session);
                    }
                }
            } else {
                showToast('warning', '❌ Permission Denied', `${owner} denied your write request`);
            }
        };

        // Called when session permission is updated
        terminalSharing.onPermissionUpdate = (sessionId, newPermission) => {
            console.log('[Terminal] Permission update for session:', sessionId, 'new permission:', newPermission);

            const session = sessions.get(sessionId);
            const sessionName = session?.name || 'Terminal';
            const permIcon = newPermission === 'readwrite' ? '✏️' : '👁️';
            const permLabel = newPermission === 'readwrite' ? 'Read-Write' : 'Read-Only';
            const toastType = newPermission === 'readwrite' ? 'success' : 'info';

            showToast(toastType, '🔒 Permission Changed',
                `"${sessionName}" is now ${permLabel}`, 5000);

            updateSessionPermissionUI(sessionId, newPermission);

            // ✅ Update file explorer button immediately if this session is active
            if (activeSessionId === sessionId) {
                if (session && window.updateFileExplorerButtonState) {
                    console.log('[Terminal] Updating file explorer button after permission update');
                    window.updateFileExplorerButtonState(session);
                }

                // ✅ Close file explorer if permission changed to readonly
                // Read-only viewers cannot access file system
                if (newPermission === 'readonly' && fileExplorer && fileExplorer.isConnected &&
                    fileExplorer.terminalSessionId === sessionId) {
                    console.log('[Terminal] Closing file explorer - permission changed to readonly');
                    fileExplorer.close();
                    showToast('info', '📁 File Explorer Closed',
                        'File system access requires write permission', 3000);
                }
            }
        };

        // Called when owner disconnects/closes a shared session
        terminalSharing.onOwnerDisconnect = (sessionId, owner) => {
            console.log('[Terminal] Owner disconnected:', owner, 'session:', sessionId);

            const session = sessions.get(sessionId);
            const sessionName = session?.name || 'Terminal';
            showToast('warning', '⚠️ Session Ended',
                `${owner} closed "${sessionName}"`, 5000);

            // Close the view-only session
            if (sessions.has(sessionId)) {
                closeSession(sessionId);
            }
            updateSharedTerminalsList();
        };

        // Called when cloud connection is lost unexpectedly
        terminalSharing.onDisconnect = (reason) => {
            console.warn('[Terminal] Cloud connection lost:', reason);

            cloudConnected = false;

            // Update UI to show disconnected state
            const statusDot = document.getElementById('cloudStatus');
            const statusText = document.getElementById('cloudStatusText');
            const hostIndicator = document.getElementById('cloudHostIndicator');

            if (statusDot) statusDot.className = 'status-dot offline';
            if (statusText) statusText.textContent = 'Disconnected (connection lost)';
            if (hostIndicator) hostIndicator.style.display = 'none';

            const connectBtn = document.getElementById('cloudConnectBtn');
            if (connectBtn) {
                connectBtn.textContent = 'Reconnect';
                connectBtn.classList.remove('active');
                connectBtn.disabled = false;
            }

            // Reset toolbar button title + status dot
            const messagingBtn = document.getElementById('messagingToolbarBtn');
            if (messagingBtn) messagingBtn.title = 'Connect to Messaging Platform for Terminal Sharing';
            const cloudStatusDotDisc = document.getElementById('cloudStatusDot');
            if (cloudStatusDotDisc) cloudStatusDotDisc.className = 'top-status-dot offline';
            const cloudIndicatorGrpLost = document.getElementById('cloudIndicatorGroup');
            if (cloudIndicatorGrpLost) cloudIndicatorGrpLost.title = 'Remote Share – Connection lost';

            // Mark all remote sessions as disconnected
            sessions.forEach((session, sid) => {
                if (session.owner) {
                    session.terminal?.writeln('');
                    session.terminal?.writeln('\x1b[1;31m⚠ Cloud connection lost - owner unreachable\x1b[0m');
                }
            });

            // Unshare our local sessions (flags only, connection is already gone)
            sessions.forEach((session, sid) => {
                if (session.isShared && !session.owner) {
                    session.isShared = false;
                    updateTabSharedIndicator(sid, false);
                }
            });

            disableSharingTab();
            updateAgentsList();
            updateSharedTerminalsList();
            updateMySharesList();

            showToast('error', '⚠️ Cloud Disconnected',
                'Connection to Messaging Platform lost. Click Reconnect to try again.', 8000);

            // Auto-reconnect attempt after 5 seconds
            setTimeout(async () => {
                if (!cloudConnected && terminalSharing && channelName && channelPassword) {
                    console.log('[Terminal] Attempting cloud auto-reconnect...');
                    showToast('info', '🔄 Reconnecting...', 'Attempting to reconnect to cloud...');
                    try {
                        await connectToCloud();
                    } catch (e) {
                        console.error('[Terminal] Cloud auto-reconnect failed:', e);
                    }
                }
            }, 5000);
        };

        await terminalSharing.connect({
            username: agentName,
            channelName: channelName,
            channelPassword: channelPassword
        });

        cloudConnected = true;
        cloudAgentName = agentName;

        // Remove shared terminal loader if it exists
        const loader = document.getElementById('shared-terminal-loader');
        if (loader && document.body.contains(loader)) {
            loader.style.animation = 'fadeOut 0.2s ease-out';
            setTimeout(() => {
                if (document.body.contains(loader)) {
                    document.body.removeChild(loader);
                }
            }, 200);
        }

        connectBtn.textContent = 'Connected';
        connectBtn.classList.add('active');
        connectBtn.disabled = true;
        connectBtn.title = `Connected as ${agentName}`;

        // Highlight the messaging toolbar button + update status dot
        const messagingBtn = document.getElementById('messagingToolbarBtn');
        if (messagingBtn) {
            messagingBtn.title = `Messaging Platform Connected as ${agentName}`;
        }
        const cloudStatusDot = document.getElementById('cloudStatusDot');
        if (cloudStatusDot) cloudStatusDot.className = 'top-status-dot online';
        const cloudStatusLabel = document.getElementById('cloudStatusLabel');
        if (cloudStatusLabel) cloudStatusLabel.textContent = 'Remote';
        const cloudIndicatorGroup = document.getElementById('cloudIndicatorGroup');
        if (cloudIndicatorGroup) cloudIndicatorGroup.title = `Remote Share: Connected as ${agentName}`;
        // Also support old ID for compatibility
        let cloudBtn = document.getElementById('cloudToolbarBtn');
        if (cloudBtn) {
            cloudBtn.classList.add('active');
            cloudBtn.title = `Messaging Platform Connected as ${agentName}`;
        }

        // Disable regenerate button when connected
        const regenBtn = document.getElementById('cloudRegenBtn');
        if (regenBtn) {
            regenBtn.disabled = true;
            regenBtn.title = 'Disconnect to regenerate';
        }

        // Show the horizontal action buttons
        document.getElementById('cloudActionsRow').style.display = 'flex';
        document.getElementById('cloudAgentsSection').style.display = 'block';

        // Show share section when connected
        const shareSection = document.getElementById('cloudShareSection');
        if (shareSection) {
            shareSection.style.display = 'block';
        }

        document.getElementById('cloudChannelName').disabled = true;
        document.getElementById('cloudChannelPassword').disabled = true;
        document.getElementById('cloudAgentName').disabled = true;

        // Update status display
        const statusDot = document.getElementById('cloudStatus');
        const statusText = document.getElementById('cloudStatusText');
        const hostIndicator = document.getElementById('cloudHostIndicator');

        if (statusDot) {
            statusDot.className = 'status-dot online';
            console.log('[Messaging] Status dot updated to online');
        }
        if (statusText) {
            statusText.textContent = `Connected as ${agentName}`;
            console.log('[Messaging] Status text updated to Connected');
        }

        // ✅ Update host indicator based on actual host status (not just connection)
        updateCloudHostIndicator();

        updateAgentsList();
        updateSharedTerminalsList();

        // Generate share URL for the sharing tab
        generateShareUrl();

        // Enable the Sharing tab
        enableSharingTab();

        // ✅ Share pending session if user tried to share before connecting
        if (pendingSessionToShare) {
            const pendingSession = sessions.get(pendingSessionToShare);
            if (pendingSession) {
                // Clean the session state before sharing (in case it was marked from a previous attempt)
                pendingSession.isShared = false;
                pendingSession.owner = null;
                pendingSession.permission = null;

                console.log('[Terminal] Sharing pending session:', pendingSessionToShare, pendingSession.name);
                shareTerminal(pendingSessionToShare);
            } else {
                console.warn('[Terminal] Pending session not found:', pendingSessionToShare);
            }
            // Clear the pending session
            pendingSessionToShare = null;
        }

        // ✅ Auto-share: Re-share sessions that were previously shared before disconnection
        let autoSharedCount = 0;
        sessions.forEach((session, sessionId) => {
            // Only re-share sessions that were marked as shared
            if (session.isShared && !session.owner && session.type !== 'remote') {
                // Skip sessions already registered in sharedSessions (e.g. just shared via pendingSessionToShare)
                if (terminalSharing && terminalSharing.isSessionShared(sessionId)) {
                    console.log('[Terminal] Auto-share: skipping already-shared session:', sessionId);
                    return;
                }
                console.log('[Terminal] Auto-sharing session:', sessionId, session.name);
                shareTerminal(sessionId);
                autoSharedCount++;
            }
        });

        if (autoSharedCount > 0) {
            console.log(`[Terminal] Auto-shared ${autoSharedCount} session(s)`);
        }

        // Automatically switch to Sharing tab after successful connection
        window.switchCloudTab('sharing');

        saveCloudConfig(true);
        showToast('success', 'Messaging Platform Connected', `Connected as ${agentName}`);
        console.log('[Terminal] Connected as:', agentName);

    } catch (error) {
        console.error('[Terminal] Connection failed:', error);

        // Remove shared terminal loader if it exists
        const loader = document.getElementById('shared-terminal-loader');
        if (loader && document.body.contains(loader)) {
            loader.style.animation = 'fadeOut 0.2s ease-out';
            setTimeout(() => {
                if (document.body.contains(loader)) {
                    document.body.removeChild(loader);
                }
            }, 200);
        }

        showToast('error', 'Connection Failed', error.message);
        terminalSharing = null;
        cloudConnected = false;
        pendingSessionToShare = null; // Clear pending session on error
        connectBtn.textContent = 'Connect to Cloud';
        connectBtn.disabled = false;
    }
}

function disconnectFromCloud() {
    // Clear pending session to share
    pendingSessionToShare = null;

    // Unshare all currently shared sessions before disconnecting
    // ✅ Keep session.isShared = true so the auto-share loop can restore them on reconnect
    if (terminalSharing && cloudConnected) {
        console.log('[Messaging] Unsharing all sessions before disconnect (preserving isShared flag for reconnect)...');
        sessions.forEach((session, sessionId) => {
            if (session.isShared && !session.owner) {
                // Remove from messaging layer but keep isShared=true so we can re-share on reconnect
                console.log('[Messaging] Unsharing session (will re-share on reconnect):', sessionId);
                terminalSharing.unshareSession(sessionId);
                // ✅ Do NOT set session.isShared = false here — auto-share needs it on reconnect
                updateTabSharedIndicator(sessionId, false);
            }
        });
        updateCloudHostIndicator(); // ✅ Update host indicator (no longer a host after disconnecting)
    }

    if (terminalSharing) {
        terminalSharing.disconnect();
    }
    terminalSharing = null;
    cloudConnected = false;
    cloudAgentName = null;

    const connectBtn = document.getElementById('cloudConnectBtn');
    connectBtn.textContent = 'Connect';
    connectBtn.classList.remove('disconnect', 'active');
    connectBtn.disabled = false;
    connectBtn.title = 'Connect to Messaging Platform';

    // Reset messaging toolbar button + status dot
    const messagingBtn = document.getElementById('messagingToolbarBtn');
    if (messagingBtn) {
        messagingBtn.title = 'Connect to Messaging Platform for Terminal Sharing';
    }
    const cloudStatusDotManual = document.getElementById('cloudStatusDot');
    if (cloudStatusDotManual) cloudStatusDotManual.className = 'top-status-dot'; // grey = not connected
    const cloudStatusLabelDisc = document.getElementById('cloudStatusLabel');
    if (cloudStatusLabelDisc) cloudStatusLabelDisc.textContent = 'Remote';
    const cloudIndicatorGrpDisc = document.getElementById('cloudIndicatorGroup');
    if (cloudIndicatorGrpDisc) cloudIndicatorGrpDisc.title = 'Remote Share – Disconnected';

    // Re-enable regenerate button when disconnected
    const regenBtn = document.getElementById('cloudRegenBtn');
    if (regenBtn) {
        regenBtn.disabled = false;
        regenBtn.title = 'Regenerate channel name and password';
    }

    document.getElementById('cloudActionsRow').style.display = 'none';
    document.getElementById('cloudAgentsSection').style.display = 'none';
    _updateAgentCountBadge(0);

    // Hide host indicator
    const hostIndicator = document.getElementById('cloudHostIndicator');
    if (hostIndicator) {
        hostIndicator.style.display = 'none';
    }

    // Disable the Sharing tab
    disableSharingTab();

    // Hide share section
    const shareSection = document.getElementById('cloudShareSection');
    if (shareSection) {
        shareSection.style.display = 'none';
    }

    document.getElementById('cloudChannelName').disabled = false;
    document.getElementById('cloudChannelPassword').disabled = false;
    document.getElementById('cloudAgentName').disabled = false;
    document.getElementById('cloudStatus').className = 'status-dot offline';
    document.getElementById('cloudStatusText').textContent = 'Disconnected';


    updateAgentsList();
    updateSharedTerminalsList();
    saveCloudConfig(false);

    // Clear the shared link hash from URL so the auth credentials are not exposed
    if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    showToast('info', 'Disconnected', 'Disconnected from Messaging Platform');
}

function updateAgentsList() {
    const agentsList = document.getElementById('cloudAgentsList');
    if (!agentsList) return;

    if (!terminalSharing || !cloudConnected) {
        agentsList.innerHTML = '<div class="cloud-agent-item">No other agents connected</div>';
        _updateAgentCountBadge(0);
        return;
    }

    const agents = terminalSharing.getConnectedUsers();
    // Filter out ourselves
    const otherAgents = agents.filter(a => a !== cloudAgentName);

    console.log('[AgentsList] Connected agents:', agents);
    console.log('[AgentsList] My agent name:', cloudAgentName);

    // Update toolbar badge
    _updateAgentCountBadge(otherAgents.length);

    if (otherAgents.length === 0) {
        agentsList.innerHTML = '<div class="cloud-agent-item">No other agents connected</div>';
        return;
    }

    let html = '';
    otherAgents.forEach(agentName => {
        html += `<div class="cloud-agent-item">
            <div class="cloud-agent-dot"></div>
            <span>${agentName}</span>
        </div>`;
    });

    agentsList.innerHTML = html;
}

function _updateAgentCountBadge(count) {
    const badge = document.getElementById('agentCountBadge');
    const btn   = document.getElementById('messagingToolbarBtn');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'block';
        if (btn) btn.title = `Remote Share — ${count} agent${count !== 1 ? 's' : ''} connected`;
    } else {
        badge.style.display = 'none';
        if (btn) btn.title = 'Connect to Messaging Platform for Terminal Sharing';
    }
}

/**
 * Update the shared terminals list (right panel)
 */
function updateSharedTerminalsList() {
    const sharedList = document.getElementById('sharedSessionList');
    if (!sharedList) return;

    if (!terminalSharing || !cloudConnected) {
        sharedList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 11px;">
            No shared terminals yet.<br>
            Connect to cloud to see shared sessions.
        </div>`;
        return;
    }

    const sharedSessions = terminalSharing.getRemoteSharedSessions();

    console.log('[SharedTerminals] Remote shared sessions:', sharedSessions);

    if (sharedSessions.length === 0) {
        sharedList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 11px;">
            No shared terminals yet.<br>
            Right-click a tab and select "Share Session" to share.
        </div>`;
        return;
    }

    let html = '';

    // Show shared sessions (clickable to view)
    // Show remote shared sessions (clickable to view)
    sharedSessions.forEach(sharedSession => {
        const icon = sharedSession.shell === 'bash' ? '🐧' : sharedSession.shell === 'powershell' ? '⚡' : '💻';

        // ✅ Get actual permission from local session if it exists (reflects per-agent overrides)
        // Otherwise fall back to the shared session's global permission
        const localSession = sessions.get(sharedSession.sessionId);
        const effectivePerm = localSession?.permission || sharedSession.permission || 'readonly';

        const permIcon = effectivePerm === 'readwrite' ? '✏️' : '👁️';
        const permTitle = effectivePerm === 'readwrite' ? 'Read-Write' : 'Read-Only';

        html += `<div class="cloud-agent-item"
            style="cursor: pointer; transition: opacity 0.2s;"
            title="Click to view (${permTitle}) — shared by ${sharedSession.owner}"
            onclick="viewSharedTerminal('${sharedSession.sessionId}', '${sharedSession.owner}')"
            onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">
            <div class="cloud-agent-dot" style="background: var(--accent-cyan);"></div>
            <span>${icon} ${sharedSession.name} (${sharedSession.owner})</span>
            <span style="margin-left: auto; font-size: 10px; opacity: 0.7;">${permIcon}</span>
        </div>`;
    });

    sharedList.innerHTML = html;
}

/**
 * View a shared terminal from another agent
 */
function viewSharedTerminal(sessionId, ownerAgent) {
    console.log('[Terminal] Viewing shared terminal:', sessionId, 'from:', ownerAgent);

    // Switch to this session if it already exists
    if (sessions.has(sessionId)) {
        switchToSession(sessionId);
        showToast('info', '👀 Viewing Shared Terminal', `Now viewing terminal from ${ownerAgent}`);
    } else {
        showToast('warning', 'Session Not Found', 'Shared terminal session not available');
    }
}

/**
 * Create a view-only terminal session for a shared session from a remote agent
 */
function createSharedTerminalSession(sessionId, sessionInfo, ownerAgent) {
    // Check if already exists
    if (sessions.has(sessionId)) {
        console.log('[Terminal] Shared session already exists:', sessionId);
        return;
    }

    const icon = sessionInfo.shell === 'bash' ? '🐧' : sessionInfo.shell === 'powershell' ? '⚡' : '💻';
    const name = `${sessionInfo.name} (${ownerAgent})`;
    const permission = sessionInfo.permission || 'readonly';

    // Create UI
    createTab(sessionId, name, icon, sessionInfo.type || 'remote');
    createTerminalPanel(sessionId);

    // Initialize terminal (view-only)
    const terminal = initTerminal(sessionId, { shared: true });

    // Store session with CloudTerminalDataSender wrapper
    sessions.set(sessionId, {
        terminal,
        dataSender: createTerminalDataSender('cloud', {
            terminalSharing,
            sessionId: sessionId,
            ownerAgent
        }),
        config: { type: 'remote', shell: sessionInfo.shell },
        type: 'remote',
        name,
        connected: true,  // Connected via cloud
        fitAddon: null,
        isShared: false,  // Not shared by me (I'm viewing someone else's share)
        owner: ownerAgent,  // The agent who owns this terminal
        permission: permission  // Read/write permission from owner
    });

    // Update fitAddon reference
    const session = sessions.get(sessionId);
    if (session && session.terminal) {
        setTimeout(() => {
            if (session.fitAddon) session.fitAddon.fit();
        }, 100);
    }

    // Remote shared sessions connect via cloud messaging (not WebSocket),
    // so the "Connecting..." overlay must be hidden immediately — it will never
    // be hidden by ws.onopen since there is no WebSocket for these sessions.
    hideConnectingOverlay(sessionId);

    // Replace "Shared Terminal - Connecting..." with connected success message
    terminal.write('\x1b[1A\x1b[2K'); // erase the "Shared Terminal - Connecting..." line
    terminal.writeln(`\x1b[1;36mShared Terminal\x1b[0m - \x1b[1;32mConnected ✓\x1b[0m`);
    terminal.writeln('');

    // Show last known prompt immediately so the terminal isn't blank
    if (sessionInfo.detectedPrompt) {
        terminal.write(sessionInfo.detectedPrompt);
    }

    updateEmptyState();
    updateSessionCount();

    // Mark tab as received share (different styling)
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) {
        tab.classList.add('received-share');
    }

    // Add session badge showing permission mode
    updateSessionBadge(sessionId, sessionInfo.permission || 'readonly');

    // ✅ Refresh status bar so bottom permission icon (👁️/✏️) reflects initial permission
    if (typeof updateStatusBar === 'function') updateStatusBar();

    // ✅ Notify owner that we're viewing this session
    if (terminalSharing && terminalSharing.connected) {
        terminalSharing.sendData({
            type: 'session-viewer-join',
            sessionId: sessionId
        });
        console.log('[Terminal] Notified owner that we joined session:', sessionId);
    }

    // Update file explorer button if this is the active session
    if (activeSessionId === sessionId) {
        const session = sessions.get(sessionId);
        if (session) {
            updateFileExplorerButtonState(session);
        }
    }

    console.log('[Terminal] Created view-only session for shared session:', sessionId, 'from:', ownerAgent);
}

// ========================================
// Typing Indicator & Permission UI
// ========================================

/**
 * Update typing indicator for a session
 * @param {string} sessionId - Session ID
 * @param {string} agentName - Agent who is typing
 * @param {boolean} isTyping - True if typing, false if stopped
 */
function updateTypingIndicator(sessionId, agentName, isTyping) {
    // ✅ Only update the status bar typing indicator (visible for active session)
    if (sessionId === activeSessionId) {
        const statusTyping = document.getElementById('statusTyping');
        if (statusTyping) {
            if (isTyping) {
                statusTyping.textContent = `✏️ ${agentName} is typing...`;
                statusTyping.style.display = 'inline';
            } else {
                statusTyping.style.display = 'none';
                statusTyping.textContent = '';
            }
        }
    }
}

/**
 * Show permission request notification (for session owner)
 * @param {string} sessionId - Session ID
 * @param {string} requester - Agent requesting permission
 */
function showPermissionRequestNotification(sessionId, requester) {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'permission-request-notification';
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, var(--bg-panel) 0%, var(--bg-darker) 100%);
        border: 1px solid var(--accent-purple);
        border-radius: 12px;
        padding: 16px 20px;
        max-width: 320px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 100000;
        animation: slideIn 0.3s ease-out;
    `;
    notification.innerHTML = `
        <style>
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        </style>
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <span style="font-size: 24px;">✋</span>
            <div>
                <div style="font-weight: 600; color: var(--text-primary);">Permission Request</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${requester} wants write access</div>
            </div>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">
            Session: ${session.name}
        </div>
        <div style="display: flex; gap: 8px;">
            <button onclick="respondToPermission('${sessionId}', true, '${requester}', this.parentElement.parentElement)" 
                    style="flex: 1; padding: 8px 12px; background: var(--accent-green); border: none; 
                           border-radius: 6px; color: white; cursor: pointer; font-weight: 600; font-size: 12px;">
                ✓ Grant
            </button>
            <button onclick="respondToPermission('${sessionId}', false, '${requester}', this.parentElement.parentElement)" 
                    style="flex: 1; padding: 8px 12px; background: var(--accent-red); border: none; 
                           border-radius: 6px; color: white; cursor: pointer; font-weight: 600; font-size: 12px;">
                ✕ Deny
            </button>
        </div>
    `;
    document.body.appendChild(notification);

    // Auto-dismiss after 30 seconds
    setTimeout(() => {
        if (document.body.contains(notification)) {
            notification.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => notification.remove(), 300);
        }
    }, 30000);
}

/**
 * Respond to a permission request
 */
window.respondToPermission = function respondToPermission(sessionId, granted, requester, notificationElement) {
    if (terminalSharing) {
        terminalSharing.respondToPermissionRequest(sessionId, granted, requester);
    }

    // Remove the notification
    if (notificationElement) {
        notificationElement.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => notificationElement.remove(), 300);
    }

    showToast(
        granted ? 'success' : 'info',
        granted ? '✓ Permission Granted' : '✕ Permission Denied',
        `${granted ? 'Granted' : 'Denied'} write access to ${requester}`
    );
};

/**
 * Update session permission UI
 * @param {string} sessionId - Session ID
 * @param {string} permission - 'readonly' or 'readwrite'
 */
function updateSessionPermissionUI(sessionId, permission) {
    console.log('[updateSessionPermissionUI] sessionId:', sessionId, 'permission:', permission);

    const session = sessions.get(sessionId);
    if (session) {
        console.log('[updateSessionPermissionUI] Before update - session.permission:', session.permission);
        session.permission = permission;
        console.log('[updateSessionPermissionUI] After update - session.permission:', session.permission);
    } else {
        console.warn('[updateSessionPermissionUI] Session not found:', sessionId);
    }

    // Use common helper to update all UI (badge, styling, lists)
    updatePermissionUI(sessionId, permission);
}

/**
 * Update session badge showing permission mode
 * @param {string} sessionId - Session ID
 * @param {string} permission - 'readonly' or 'readwrite'
 */
function updateSessionBadge(sessionId, permission) {
    // ✅ Badge removed - permission is now shown in the footer status bar
    // This function is kept for compatibility but does nothing
    return;
}

/**
 * Request write permission for a shared session
 * @param {string} sessionId - Session ID
 */
function requestWritePermission(sessionId) {
    if (!terminalSharing || !cloudConnected) {
        showToast('warning', 'Not Connected', 'Connect to cloud first');
        return;
    }

    const session = sessions.get(sessionId);
    if (!session || !session.owner) {
        showToast('error', 'Error', 'Cannot request permission for this session');
        return;
    }

    if (terminalSharing.requestWritePermission(sessionId)) {
        showToast('info', '📨 Request Sent', `Requesting write access from ${session.owner}`);
    } else {
        showToast('error', 'Error', 'Failed to send permission request');
    }
}

/**
 * Toggle global permission for a shared session (owner only)
 * Affects all agents that don't have a custom per-agent permission
 * @param {string} sessionId - Session ID
 */
function toggleGlobalPermission(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || !session.isShared || session.owner) return;

    const newPerm = session.permission === 'readwrite' ? 'readonly' : 'readwrite';
    session.permission = newPerm;

    if (terminalSharing) {
        terminalSharing.updateSessionPermission(sessionId, newPerm);
    }

    const permLabel = newPerm === 'readwrite' ? 'Read-Write' : 'Read-Only';
    showToast('success', '🔒 Permission Changed', `Global permission set to ${permLabel}`);

    // Use common helper to update all UI elements
    updatePermissionUI(sessionId, newPerm);
}
window.toggleGlobalPermission = toggleGlobalPermission;

/**
 * Toggle per-agent permission for a shared session (owner only)
 * Sets a custom permission for a specific agent, overriding the global default
 * @param {string} sessionId - Session ID
 * @param {string} agentName - Agent to toggle permission for
 */
function toggleAgentPermission(sessionId, agentName) {
    const session = sessions.get(sessionId);
    if (!session || !session.isShared || session.owner) return;

    // Initialize agentPermissions map if not exists
    if (!session.agentPermissions) {
        session.agentPermissions = {};
    }

    const currentPerm = session.agentPermissions[agentName] || session.permission || 'readonly';
    const newPerm = currentPerm === 'readwrite' ? 'readonly' : 'readwrite';
    session.agentPermissions[agentName] = newPerm;

    // Broadcast permission update to the specific agent
    if (terminalSharing && cloudConnected) {
        terminalSharing.sendData({
            type: 'permission-update',
            sessionId: sessionId,
            permission: newPerm,
            targetAgent: agentName
        }, agentName);
    }

    const permLabel = newPerm === 'readwrite' ? 'Read-Write' : 'Read-Only';
    showToast('success', '🔒 Permission Changed', `${agentName} is now ${permLabel}`);
    updateMySharesList();
}
window.toggleAgentPermission = toggleAgentPermission;

// ========================================
// Viewer Context Menu (for agent permissions)
// ========================================
let viewerContextMenuTarget = { sessionId: null, agentName: null };

function showViewerContextMenu(event, sessionId, agentName) {
    event.preventDefault();
    event.stopPropagation();

    viewerContextMenuTarget = { sessionId, agentName };

    const menu = document.getElementById('viewerContextMenu');
    if (!menu) return;

    // Position menu at cursor
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;
    menu.classList.add('visible');

    console.log('[ViewerContextMenu] Opened for:', agentName, 'session:', sessionId);
}
window.showViewerContextMenu = showViewerContextMenu;

function viewerContextMenuAction(action) {
    const { sessionId, agentName } = viewerContextMenuTarget;
    hideContextMenus();

    if (!sessionId || !agentName) {
        console.warn('[ViewerContextMenu] No target set');
        return;
    }

    const session = sessions.get(sessionId);
    if (!session || !session.isShared || session.owner) {
        console.warn('[ViewerContextMenu] Invalid session for permission change');
        return;
    }

    switch (action) {
        case 'readonly':
            setAgentPermission(sessionId, agentName, 'readonly');
            break;
        case 'readwrite':
            setAgentPermission(sessionId, agentName, 'readwrite');
            break;
        case 'reset':
            resetAgentPermission(sessionId, agentName);
            break;
    }
}
window.viewerContextMenuAction = viewerContextMenuAction;

function setAgentPermission(sessionId, agentName, permission) {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Initialize agentPermissions map if not exists
    if (!session.agentPermissions) {
        session.agentPermissions = {};
    }

    session.agentPermissions[agentName] = permission;

    // Broadcast permission update to the specific agent
    if (terminalSharing && cloudConnected) {
        terminalSharing.sendData({
            type: 'permission-update',
            sessionId: sessionId,
            permission: permission,
            targetAgent: agentName
        }, agentName);
    }

    const permLabel = permission === 'readwrite' ? 'Read-Write' : 'Read-Only';
    showToast('success', '🔒 Permission Set', `${agentName} → ${permLabel}`);
    updateMySharesList();
}

function resetAgentPermission(sessionId, agentName) {
    const session = sessions.get(sessionId);
    if (!session || !session.agentPermissions) return;

    delete session.agentPermissions[agentName];

    // Notify agent to use global permission
    if (terminalSharing && cloudConnected) {
        const globalPerm = session.permission || 'readonly';
        terminalSharing.sendData({
            type: 'permission-update',
            sessionId: sessionId,
            permission: globalPerm,
            targetAgent: agentName
        }, agentName);
    }

    showToast('info', '🔄 Permission Reset', `${agentName} → Using global permission`);
    updateMySharesList();
}

/**
 * Reset all permissions (global + all agent overrides) to readonly
 * @param {string} sessionId - Session ID
 */
function resetAllPermissions(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || !session.isShared || session.owner) {
        showToast('warning', 'Not Allowed', 'Can only reset permissions on your shared sessions');
        return;
    }

    // Reset global permission to readonly
    session.permission = 'readonly';

    // Clear all agent-specific permissions
    if (session.agentPermissions) {
        session.agentPermissions = {};
    }

    // Broadcast global permission update to all agents
    if (terminalSharing && cloudConnected) {
        terminalSharing.updateSessionPermission(sessionId, 'readonly');
    }

    showToast('success', '🔄 All Permissions Reset', 'All permissions set to Read-Only');

    // Use common helper to update all UI elements
    updatePermissionUI(sessionId, 'readonly');
}
window.resetAllPermissions = resetAllPermissions;

function shareTerminal(sessionId, permission = 'readonly') {
    console.log('[ShareTerminal] Called with sessionId:', sessionId, 'permission:', permission);
    console.log('[ShareTerminal] cloudConnected:', cloudConnected);
    console.log('[ShareTerminal] terminalSharing:', terminalSharing);

    if (!cloudConnected || !terminalSharing) {
        showToast('warning', 'Not Connected', 'Connect to cloud messaging first to share terminals');
        console.warn('[ShareTerminal] Not connected to cloud or terminalSharing is null');
        return;
    }

    const session = sessions.get(sessionId);
    console.log('[ShareTerminal] Session found:', session);

    if (!session) {
        console.error('[Terminal] Cannot share - session not found:', sessionId);
        return;
    }

    // Mark session as shared locally (owner = null means I own it)
    session.isShared = true;
    session.owner = null;  // null = I'm the owner of this local session
    session.permission = permission;

    console.log('[ShareTerminal] Calling terminalSharing.shareSession...');

    // Get session name with fallback to tab title or default
    const sessionName = session.name || getTabTitle(sessionId) || 'Terminal Session';

    // Share via TerminalSharing
    const storedPrompt = storageManager.getDetectedPrompt(sessionId);
    if (storedPrompt) session.detectedPrompt = storedPrompt;

    const success = terminalSharing.shareSession(sessionId, {
        name: sessionName,
        shell: session.config?.shell || session.type || 'cmd',
        type: session.type,
        permission: permission,
        detectedPrompt: session.detectedPrompt || null
    });

    console.log('[ShareTerminal] Share result:', success);

    if (success || terminalSharing.isSessionShared(sessionId)) {
        // Session is shared (either just now, or was already in sharedSessions)
        session.isShared = true;
        session.owner = null;
        session.permission = permission;

        updateTabSharedIndicator(sessionId, true);  // Show shared badge
        updateAgentsList(); // Refresh agents list
        updateSharedTerminalsList(); // Refresh shared terminals list
        updateSidebarBadges(); // Update sidebar badges
        updateCloudHostIndicator(); // ✅ Update host indicator (now we're a host)
        updateMySharesList(); // Update my shares list

        if (success) {
            const permLabel = permission === 'readwrite' ? 'Read-Write' : 'Read-Only';
            const connectedCount = (terminalSharing && cloudConnected)
                ? terminalSharing.getConnectedUsers().filter(a => a !== cloudAgentName).length
                : 0;
            const viewersMsg = connectedCount > 0
                ? ` — ${connectedCount} viewer${connectedCount > 1 ? 's' : ''} connected`
                : ' — No viewers yet';

            showToast('success', '📤 Terminal Shared',
                `"${session.name}" is now shared (${permLabel})${viewersMsg}`, 5000);
            console.log('[Terminal] Shared session:', sessionId, session.name);
        } else {
            console.log('[Terminal] Session already shared (skipped duplicate):', sessionId);
        }
    } else {
        session.isShared = false;
        session.owner = null;
        session.permission = null;
        showToast('error', 'Share Failed', 'Failed to share terminal');
    }
}

function unshareTerminal(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        console.error('[Terminal] Cannot unshare - session not found:', sessionId);
        return;
    }

    const sessionName = session.name || 'Terminal';

    // Unmark session locally
    session.isShared = false;
    session.owner = null;
    session.permission = null;  // ✅ Clear global permission

    // ✅ Clear all agent-specific permissions
    if (session.agentPermissions) {
        session.agentPermissions = {};
    }

    // Unshare via TerminalSharing
    if (terminalSharing) {
        terminalSharing.unshareSession(sessionId);
        updateAgentsList(); // Refresh agents list
        updateSharedTerminalsList(); // Refresh shared terminals list
        updateSidebarBadges(); // Update sidebar badges
        updateMySharesList(); // Update my shares list
        updateCloudHostIndicator(); // ✅ Update host indicator (might no longer be a host)
    }

    updateTabSharedIndicator(sessionId, false);  // Hide shared badge
    showToast('success', '🛑 Sharing Stopped', `"${sessionName}" is no longer shared`, 4000);
    console.log('[Terminal] Unshared session:', sessionId, '— permissions cleared');
}

/**
 * Send input to a remote terminal via cloud connection
 */
function sendTerminalInputViaCloud(sessionId, data) {
    if (!terminalSharing || !cloudConnected) {
        console.warn('[Terminal] Cannot send input - not connected to cloud');
        return;
    }

    const session = sessions.get(sessionId);
    if (!session || !session.owner) {
        console.warn('[Terminal] Cannot send input - no owner for session:', sessionId);
        return;
    }

    // Send input to the owning agent
    terminalSharing.sendInputToSession(sessionId, data, session.owner);
    console.log('[Terminal] Sent input to remote session:', sessionId, 'owner:', session.owner);
}

// ========================================
// Share Modal Functions
// ========================================

// ========================================
// Notes Management
// ========================================
// Use TabSessionManager for centralized notes management
const notes = tabSessionManager.getAllNotes(); // noteId -> note object
let activeNoteId = null;

// Generate UUID for notes
function generateNoteUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback UUID v4 generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Load notes from backend (filesystem)
async function loadNotes() {
    try {
        // List all note files from filesystem
        const response = await fetch(`${MLS_URL}/filesystem/notes/list?path=.`, {
            headers: { 'X-SLS-Token': localStorage.getItem('sls-token') }
        });

        if (!response.ok) {
            console.error('[Notes] Failed to load notes list');
            return;
        }

        const result = await response.json();

        if (result.success && result.files) {
            notes.clear();

            // Load each note file to get title and preview
            const loadPromises = result.files.map(async (fileInfo) => {
                try {
                    // Extract noteId from path (note://abc-123 → abc-123)
                    const noteId = fileInfo.path.replace('note://', '');

                    // Read file content to extract title
                    const readResponse = await fetch(
                        `${MLS_URL}/filesystem/notes/read?path=note://${noteId}`,
                        { headers: { 'X-SLS-Token': localStorage.getItem('sls-token') } }
                    );

                    let title = 'Untitled Note';
                    let content = '';

                    if (readResponse.ok) {
                        const readResult = await readResponse.json();
                        content = readResult.content || '';

                        // Extract title from first line if present
                        const lines = content.split('\n');
                        if (lines[0] && lines[0].startsWith('# TITLE: ')) {
                            title = lines[0].substring(9); // Remove "# TITLE: "
                        }
                    }

                    const note = {
                        id: noteId,
                        title: title,
                        content: content,
                        shared: false,
                        createdAt: fileInfo.lastModified || new Date().toISOString(),
                        updatedAt: fileInfo.lastModified || new Date().toISOString()
                    };

                    notes.set(note.id, note);
                } catch (error) {
                    console.warn('[Notes] Failed to load note:', fileInfo.path, error);
                }
            });

            await Promise.all(loadPromises);

            updateNotesList();
            updateNotesBadge();

            // Set up context menu event delegation (one-time setup)
            setupNotesContextMenu();

            console.log('[Notes] Loaded notes from filesystem:', notes.size);
        }
    } catch (error) {
        console.error('[Notes] Failed to load notes:', error);
    }
}

// Create a new note
async function createNewNote() {
    try {
        // Generate new note ID
        const noteId = generateNoteUUID();
        const timestamp = new Date().toISOString();
        const title = 'Untitled Note';

        // Create note object in memory
        const note = {
            id: noteId,
            title: title,
            content: '',
            shared: false,
            createdAt: timestamp,
            updatedAt: timestamp
        };

        // Create file with title as first line via filesystem API
        const initialContent = `# TITLE: ${title}\n`;

        const response = await fetch(`${MLS_URL}/filesystem/notes/write`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-SLS-Token': localStorage.getItem('sls-token')
            },
            body: JSON.stringify({
                path: `note://${noteId}`,
                content: initialContent
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Notes] Failed to create note file:', errorText);
            throw new Error('Failed to create note file');
        }

        const result = await response.json();
        if (!result.success) {
            console.error('[Notes] Note creation failed:', result.error);
            throw new Error(result.error || 'Failed to create note file');
        }

        console.log('[Notes] Note file created successfully:', noteId);

        // Add to notes collection
        notes.set(note.id, note);
        updateNotesList();
        updateNotesBadge();

        // Open in editor (file now exists!)
        openNote(note.id);

        showToast('success', '📝 Note Created', 'New note created successfully');
    } catch (error) {
        console.error('[Notes] Failed to create note:', error);
        showToast('error', 'Create Failed', 'Failed to create note');
    }
}

// Open a note in editor (popup/pinned mode - NO TABS!)
function openNote(noteId) {
    const note = notes.get(noteId);
    if (!note) return;

    activeNoteId = noteId;

    // ✅ NEW: Open in file editor (same as files) - unified editing experience
    if (window.fileEditor) {
        // Use note title as display name in the path for better tab labels
        const noteTitle = note.title || 'Untitled Note';
        // Use format: note://{title}/{noteId} so getFileName extracts the title
        fileEditor.openFile(
            'notes',  // Special session ID for notes
            'Notes',  // Session name
            `note://${noteTitle}/${noteId}`  // Virtual file path with title for display
        );
    } else {
        console.error('[Notes] File editor not initialized');
        showToast('error', 'Editor Error', 'File editor not available');
    }

    // Highlight active note in list
    document.querySelectorAll('.note-item').forEach(item => {
        item.classList.toggle('active', item.dataset.noteId === noteId);
    });
}

// OLD TAB-BASED NOTE EDITING - REMOVED
// Notes now open in popup/pinned editor instead of tabs
// This keeps tab bar clean (terminals only)
/*
function createNoteTab(noteId, note) {
    // ...old code removed...
    // Notes are no longer tabs!
}
*/

// Update note title (saved as first line in file with marker)
async function updateNoteTitle(noteId, newTitle) {
    const note = notes.get(noteId);
    if (!note) return;

    note.title = newTitle;
    note.updatedAt = new Date().toISOString();

    // Update sidebar list
    notes.set(noteId, note);
    updateNotesList();

    try {
        // Read current content
        const readResponse = await fetch(
            `${MLS_URL}/filesystem/notes/read?path=note://${noteId}`,
            { headers: { 'X-SLS-Token': localStorage.getItem('sls-token') } }
        );

        if (readResponse.ok) {
            const readResult = await readResponse.json();
            let content = readResult.content || '';

            // Remove old title line if exists
            const lines = content.split('\n');
            if (lines[0] && lines[0].startsWith('# TITLE: ')) {
                lines.shift(); // Remove old title
            }

            // Add new title as first line
            const newContent = `# TITLE: ${newTitle}\n${lines.join('\n')}`;

            // Write back
            await fetch(`${MLS_URL}/filesystem/notes/write`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-SLS-Token': localStorage.getItem('sls-token')
                },
                body: JSON.stringify({
                    path: `note://${noteId}`,
                    content: newContent
                })
            });
        }
    } catch (error) {
        console.error('[Notes] Failed to save title to file:', error);
    }

    console.log('[Notes] Note title updated:', noteId, newTitle);
}

// Rename note via prompt (for sidebar context menu)
function renameNotePrompt(noteId) {
    const note = notes.get(noteId);
    if (!note) return;

    const newTitle = prompt('Rename note:', note.title || 'Untitled Note');
    if (newTitle && newTitle.trim() && newTitle.trim() !== note.title) {
        updateNoteTitle(noteId, newTitle.trim());
    }
}

// Toggle note sharing (REMOVED - notes are local files, no sharing)
// Notes don't support sharing since they're file-based
function toggleNoteSharing(noteId) {
    console.log('[Notes] Sharing not supported for file-based notes');
    showToast('info', 'Not Supported', 'Note sharing is not available for file-based notes');
}

// OLD: Save note from tab - NO LONGER NEEDED
// Note editor handles saving internally now!
/*
async function saveNote(noteId) {
    // ...old save logic for tabs removed...
    // Note editor has its own save() method!
}
*/

// Delete note
async function deleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this note?')) return;

    try {
        // Delete via filesystem API
        const response = await fetch(`${MLS_URL}/filesystem/notes/delete?path=note://${noteId}`, {
            method: 'DELETE',
            headers: { 'X-SLS-Token': localStorage.getItem('sls-token') }
        });

        if (!response.ok) {
            throw new Error('Failed to delete note file');
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to delete note');
        }

        // Remove from memory
        notes.delete(noteId);

        // Close editor if this note is currently open
        if (window.fileEditor) {
            // Close any tabs for this note (check both filePath and backendPath)
            const tabsToClose = window.fileEditor.tabs.filter(tab => {
                if (tab.terminalId !== 'notes') return false;
                // Check if filePath contains noteId (format: note://{title}/{noteId})
                if (tab.filePath && tab.filePath.includes(noteId)) return true;
                // Check backendPath (format: note://{noteId})
                if (tab.backendPath && tab.backendPath === `note://${noteId}`) return true;
                return false;
            });
            tabsToClose.forEach(tab => window.fileEditor.closeTab(tab.id));
        }

        updateNotesList();
        updateNotesBadge();
        showToast('success', '🗑️ Deleted', 'Note deleted successfully');

        console.log('[Notes] Note deleted:', noteId);
    } catch (error) {
        console.error('[Notes] Failed to delete note:', error);
        showToast('error', 'Delete Failed', 'Failed to delete note');
    }
}

// OLD: Close note tab - NO LONGER NEEDED (notes use popup/pinned editor)
// Notes don't have tabs anymore!
/*
function closeNoteTab(tabId, event) {
    // ...old tab closing logic removed...
}
*/

// Set up context menu event delegation for notes (call once on init)
let notesContextMenuSetup = false;
function setupNotesContextMenu() {
    console.log('[Notes] setupNotesContextMenu called, already setup:', notesContextMenuSetup);

    if (notesContextMenuSetup) return;  // Only set up once

    const notesList = document.getElementById('notesList');
    if (!notesList) {
        console.error('[Notes] notesList element not found!');
        return;
    }

    console.log('[Notes] Setting up context menu on notesList:', notesList);

    // Use event delegation - listen on parent container
    notesList.addEventListener('contextmenu', (e) => {
        console.log('[Notes] Context menu event fired on:', e.target);

        // Find the closest .note-item ancestor
        const noteItem = e.target.closest('.note-item');
        console.log('[Notes] Found note-item:', noteItem);

        if (!noteItem) return;

        e.preventDefault();
        e.stopPropagation();

        const noteId = noteItem.getAttribute('data-note-id');
        console.log('[Notes] Note ID:', noteId);

        if (noteId) {
            showNoteContextMenu(e, noteId);
        }
    });

    notesContextMenuSetup = true;
    console.log('[Notes] ✅ Context menu event delegation set up successfully');
}

// Update notes list in sidebar
function updateNotesList() {
    const notesList = document.getElementById('notesList');
    if (!notesList) return;

    if (notes.size === 0) {
        notesList.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px;">
                <div style="font-size: 32px; margin-bottom: 8px;">📝</div>
                <div>No notes yet</div>
                <div style="margin-top: 8px; font-size: 11px;">Click ➕ to create a new note</div>
            </div>
        `;
        return;
    }

    const sortedNotes = Array.from(notes.values()).sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt || 0);
        const dateB = new Date(b.updatedAt || b.createdAt || 0);
        return dateB - dateA; // Most recent first
    });

    notesList.innerHTML = sortedNotes.map(note => {
        const preview = (note.content || '').substring(0, 50);
        const updatedDate = note.updatedAt ? new Date(note.updatedAt) : null;
        const timeStr = updatedDate ? updatedDate.toLocaleDateString() : '';

        return `
            <div class="note-item" 
                 data-note-id="${note.id}" 
                 onclick="openNote('${note.id.replace(/'/g, "\\'")}')">
                <div class="note-icon">📝</div>
                <div class="note-details">
                    <div class="note-title">${note.title || 'Untitled Note'}</div>
                    <div class="note-preview">${preview}${preview.length >= 50 ? '...' : ''}</div>
                    <div class="note-meta">${timeStr}</div>
                </div>
            </div>
        `;
    }).join('');
}

// Update notes badge count
function updateNotesBadge() {
    const badge = document.getElementById('notesBadge');
    if (!badge) return;

    const count = notes.size;
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
}

// Show note context menu
function showNoteContextMenu(event, noteId) {
    console.log('[Notes] showNoteContextMenu called with noteId:', noteId, 'event:', event);

    event.preventDefault();
    event.stopPropagation();

    const note = notes.get(noteId);
    console.log('[Notes] Found note:', note);
    if (!note) {
        console.error('[Notes] Note not found in notes map!');
        return;
    }

    // Remove existing context menu
    const existingMenu = document.querySelector('.note-context-menu');
    if (existingMenu) {
        console.log('[Notes] Removing existing menu:', existingMenu);
        existingMenu.remove();
    }

    console.log('[Notes] Creating menu at position:', event.clientX, event.clientY);
    const menu = document.createElement('div');
    menu.className = 'note-context-menu context-menu visible';  // ✅ Add 'visible' class!
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.style.zIndex = '10000';

    menu.innerHTML = `
        <div class="context-menu-item" onclick="openNote('${noteId}'); this.parentElement.remove();">
            📝 Open Note
        </div>
        <div class="context-menu-item" onclick="renameNotePrompt('${noteId}'); this.parentElement.remove();">
            ✏️ Rename
        </div>
        <div class="context-menu-item" onclick="duplicateNote('${noteId}'); this.parentElement.remove();">
            📋 Duplicate
        </div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item danger" onclick="deleteNote('${noteId}'); this.parentElement.remove();">
            🗑️ Delete Note
        </div>
    `;

    console.log('[Notes] Appending menu to body:', menu);
    document.body.appendChild(menu);
    console.log('[Notes] Menu appended, checking if visible...');
    console.log('[Notes] Menu element:', menu);
    console.log('[Notes] Menu computed style:', window.getComputedStyle(menu).display, window.getComputedStyle(menu).visibility);

    // Remove on click outside
    setTimeout(() => {
        document.addEventListener('click', function removeMenu() {
            menu.remove();
            document.removeEventListener('click', removeMenu);
        });
    }, 100);
}

// Show note tab context menu
function showNoteTabContextMenu(event, noteId, tabId) {
    const note = notes.get(noteId);
    if (!note) return;

    // Reuse existing context menu system
    showNoteContextMenu(event, noteId);
}

// Duplicate note
async function duplicateNote(noteId) {
    const original = notes.get(noteId);
    if (!original) return;

    try {
        // Read original note content from filesystem
        const readResponse = await fetch(
            `${MLS_URL}/filesystem/notes/read?path=note://${noteId}`,
            { headers: { 'X-SLS-Token': localStorage.getItem('sls-token') } }
        );

        if (!readResponse.ok) {
            throw new Error('Failed to read original note');
        }

        const readResult = await readResponse.json();
        if (!readResult.success) {
            throw new Error('Failed to read original note content');
        }

        // Generate new note ID
        const newNoteId = generateNoteUUID();
        const timestamp = new Date().toISOString();

        // Create new note object
        const newNote = {
            id: newNoteId,
            title: `${original.title} (Copy)`,
            content: readResult.content,
            shared: false,
            createdAt: timestamp,
            updatedAt: timestamp
        };

        // Write new note file via filesystem API
        const writeResponse = await fetch(`${MLS_URL}/filesystem/notes/write`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-SLS-Token': localStorage.getItem('sls-token')
            },
            body: JSON.stringify({
                path: `note://${newNoteId}`,
                content: readResult.content
            })
        });

        if (!writeResponse.ok) {
            throw new Error('Failed to create duplicate note file');
        }

        const writeResult = await writeResponse.json();
        if (!writeResult.success) {
            throw new Error('Failed to write duplicate note');
        }

        // Add to memory
        notes.set(newNote.id, newNote);
        updateNotesList();
        updateNotesBadge();

        showToast('success', '📋 Duplicated', 'Note duplicated successfully');
        console.log('[Notes] Note duplicated:', noteId, '→', newNoteId);
    } catch (error) {
        console.error('[Notes] Failed to duplicate note:', error);
        showToast('error', 'Duplicate Failed', 'Failed to duplicate note');
    }
}

// Initialize notes on page load (only when SLS comes online)
// NOTE: loadNotes() is now called via sls-online event listener below
// This prevents errors when SLS is offline on initial page load
window.addEventListener('DOMContentLoaded', () => {

    // Set up notes context menu (fallback in case loadNotes fails)
    // This ensures context menu works even if notes list is empty or fails to load
    setTimeout(() => {
        setupNotesContextMenu();
    }, 1000);
});

// ========================================
// File Browser Integration (Universal)
// Supports both SSH (SFTP) and Local (LocalFileSystem)
// ========================================
let fileExplorer = null;

function initFileExplorer() {
    if (fileExplorer) return;

    fileExplorer = new FileExplorer({
        mlsUrl: MLS_URL,
        onToast: showToast
    });

    // Mount to container
    const container = document.getElementById('fileExplorerPanelContainer');
    fileExplorer.mount(container);
}

/**
 * Toggle file browser panel
 * Works for both SSH sessions (SFTP) and local terminals (LocalFileSystem)
 */
function toggleFileExplorerPanel() {
    // Check if active session supports file browser
    if (!activeSessionId) {
        showToast('warning', 'No Active Session', 'Open a terminal session first to use File Explorer.');
        return;
    }

    const session = sessions.get(activeSessionId);
    if (!session) {
        showToast('warning', 'No Active Session', 'Open a terminal session first.');
        return;
    }

    if (!sessionSupportsFileExplorer(session)) {
        showToast('warning', 'File Explorer Unavailable',
            'File Explorer requires an SSH, local terminal, or remote shared session.');
        return;
    }

    // Initialize file browser if not done
    if (!fileExplorer) {
        initFileExplorer();
    }

    // Switch to file browser tab in sidebar
    switchSidebarTab('sftp');

    // Open file browser for the active session
    openFileBrowserForSession(activeSessionId);
}

// Make globally accessible for toolbar button
window.toggleSftpPanel = toggleFileExplorerPanel;
window.toggleFileExplorerPanel = toggleFileExplorerPanel;

// Track last click time to prevent rapid clicks
let lastFileExplorerClickTime = 0;

/**
 * Open File Explorer for the currently active tab (called from left sidebar button)
 * Opens on demand and keeps consistent with active session
 */
function openFileExplorerForActiveTab() {
    // Debounce: Prevent multiple rapid clicks (300ms cooldown)
    const now = Date.now();
    if (now - lastFileExplorerClickTime < 300) {
        console.log('[FileExplorer] Click ignored - too fast (debounced)');
        return;
    }
    lastFileExplorerClickTime = now;

    console.log('[FileExplorer] Button clicked - activeSessionId:', activeSessionId);

    if (!activeSessionId) {
        showToast('warning', 'No Active Session', 'Open a terminal session first to use File Explorer.');
        return;
    }

    const session = sessions.get(activeSessionId);
    if (!session) {
        showToast('warning', 'Session Not Found', 'Active session no longer exists.');
        return;
    }

    if (!sessionSupportsFileExplorer(session)) {
        showToast('warning', 'File Explorer Unavailable',
            'File Explorer requires an SSH, local terminal, or remote shared session.');
        return;
    }

    // Initialize file browser if not done
    if (!fileExplorer) {
        initFileExplorer();
    }

    // Switch to file browser tab in sidebar
    switchSidebarTab('files');

    // ✅ Smart refresh logic:
    // - If already open for SAME session AND connected → Just refresh (light operation)
    // - If different session OR not connected → Full reopen (triggers backend check)
    const isAlreadyOpenForThisSession = fileExplorer.terminalSessionId === activeSessionId;
    const isConnected = fileExplorer.isConnected;

    if (isAlreadyOpenForThisSession && isConnected) {
        console.log('[FileExplorer] Already open for this session - refreshing file list');
        // Just refresh the current directory (will check backend/owner for updates)
        // This will trigger backend call which will auto-recreate crashed SFTP if needed
        fileExplorer.refresh();
    } else {
        console.log('[FileExplorer] Opening file browser for session:', activeSessionId);
        // Full reopen - session changed or not connected
        // This will communicate with backend/owner to get fresh file list
        openFileBrowserForSession(activeSessionId);
    }
}

// Make globally accessible
window.openFileExplorerForActiveTab = openFileExplorerForActiveTab;

/**
 * DEPRECATED: File system sessions are now auto-created by backend on first access!
 * No need to manually create them anymore.
 *
 * This function is kept for reference but does nothing.
 * Backend's getOrCreateFileSystem() handles everything automatically.
 */
async function createFileSystemSessionForTerminal(terminalSessionId) {
    console.log('[FileSystem] Auto-creation handled by backend - no action needed');
    // Backend auto-creates file system session on first /filesystem/{terminalId}/list call
    // No manual creation needed anymore! ✅
}

/**
 * Auto-create SFTP session when SSH session is created (LEGACY - redirects to new function)
/**
 * Auto-create SFTP session when SSH session is created (LEGACY - redirects to new function)
 * NEW LOGIC: File system session is created automatically for all terminals
 */
async function createSftpSessionForSsh(sshSessionId) {
    // Redirect to unified function
    return createFileSystemSessionForTerminal(sshSessionId);
}

/**
 * Refresh file system session (recreate if idle/timeout)
 * Called from refresh button in file browser
 */
async function refreshFileSystemSession(terminalSessionId) {
    const session = sessions.get(terminalSessionId);
    if (!session) {
        showToast('error', 'Refresh Failed', 'Terminal session not found');
        return;
    }

    const fsSessionId = session.fileSystemSessionId || `fs-${terminalSessionId}`;

    try {
        console.log(`[FileSystem] Refreshing file system session: ${fsSessionId}`);

        // Delete existing file system session
        await slsFetch(`${MLS_URL}/filesystem/${fsSessionId}`, {
            method: 'DELETE'
        }).catch(() => {}); // Ignore errors if session doesn't exist

        // Recreate file system session
        // Backend auto-creates on-demand: await createFileSystemSessionForTerminal(terminalSessionId);

        // If file browser is open, refresh it
        if (fileExplorer && fileExplorer.currentSessionId === fsSessionId) {
            fileExplorer.refresh();
        }

        showToast('success', '🔄 File Browser Refreshed', 'File system connection recreated successfully');
    } catch (error) {
        console.error('[FileSystem] Error refreshing file system session:', error);
        showToast('error', 'Refresh Failed', 'Failed to refresh file system connection');
    }
}

/**
 * Refresh SFTP session (LEGACY - redirects to new function)
 */
async function refreshSftpSession(sshSessionId) {
    return refreshFileSystemSession(sshSessionId);
}

// Make globally accessible
window.createFileSystemSessionForTerminal = createFileSystemSessionForTerminal;
window.createSftpSessionForSsh = createSftpSessionForSsh;
window.refreshFileSystemSession = refreshFileSystemSession;
window.refreshSftpSession = refreshSftpSession;

/**
 * Refresh current file browser connection (called from file browser toolbar)
 */
function refreshCurrentFileExplorer() {
    if (!fileExplorer || !fileExplorer.currentSessionId) {
        showToast('error', 'No File Browser Session', 'No active file browser session to refresh');
        return;
    }

    // Extract terminal session ID from file system session ID (format: fs-{terminalId})
    const terminalSessionId = fileExplorer.currentSessionId.replace('fs-', '').replace('sftp-', '');

    console.log('[FileSystem] Refreshing current file browser for terminal session:', terminalSessionId);
    refreshFileSystemSession(terminalSessionId);
}

window.refreshCurrentSftp = refreshCurrentFileExplorer;
window.refreshCurrentFileExplorer = refreshCurrentFileExplorer;

/**
 * Open file browser for a terminal session
 * Handles both SSH (SFTP) and local terminals (LocalFileSystem)
 * ✅ For Host B (viewer): Sends proxy request to get initial file list
 * ✅ For Host A (owner): Opens normally (backend auto-creates session if crashed)
 */
async function openFileBrowserForSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    if (!sessionSupportsFileExplorer(session)) return;

    if (!fileExplorer) {
        initFileExplorer();
    }

    // Check if this is a remote/shared session (Host B - viewer)
    const isRemote = session.owner && session.owner !== cloudAgentName;

    // Prepare connection info for File Explorer
    const connectionInfo = {
        name: session.config?.name || session.name,
        host: session.config?.host || 'localhost',
        port: session.config?.port,
        username: session.config?.username,
        isRemote: isRemote,
        remoteOwner: isRemote ? session.owner : null
    };

    // ✅ For remote sessions (Host B - viewer):
    // Send proxy request first to get initial file list from owner
    if (isRemote) {
        console.log('[FileSystem] Remote session detected - sending proxy request for initial file list');
        try {
            // Open file explorer first (will show loading state)
            fileExplorer.open(sessionId, connectionInfo);

            // Send proxy request to get initial file list
            // This will trigger the owner to create/check backend session
            const result = await proxyFileSystemRequest(sessionId, 'list', { path: '.' });

            if (result.success) {
                console.log('[FileSystem] Received initial file list from owner:', result.files?.length || 0, 'files');
                // File explorer will receive and display the files automatically
            } else {
                showToast('error', 'File System Error', result.error || 'Failed to load files from owner');
            }
        } catch (error) {
            console.error('[FileSystem] Failed to get initial file list from owner:', error);
            showToast('error', 'Connection Error', 'Failed to connect to owner\'s file system');
        }
        return;
    }

    // ✅ For local/owner sessions (Host A):
    // Open file browser normally - backend will auto-create session if needed
    // When fileExplorer.open() calls loadDirectory(), it will hit backend endpoint:
    // GET /filesystem/{terminalSessionId}/list?path=.
    // Backend's getOrCreateFileSystem() will auto-create SFTP session if crashed!
    console.log('[FileSystem] Opening file browser for local/owner session:', sessionId);
    fileExplorer.open(sessionId, connectionInfo);

    console.log('[FileSystem] Opened file browser for session:', sessionId);
}

/**
 * Open SFTP for session (LEGACY - redirects to new function)
 */
function openSftpForSession(sessionId) {
    return openFileBrowserForSession(sessionId);
}



// ========================================
// FILE SYSTEM PROXY (for remote/shared sessions)
// ========================================

/**
 * Make a file system request to a remote session owner (viewer → owner proxy)
 * @param {string} sessionId - Terminal session ID
 * @param {string} operation - Operation name (list, read, write, etc.)
 * @param {object} params - Operation parameters
 * @returns {Promise<object>} - Operation result
 */
async function proxyFileSystemRequest(sessionId, operation, params) {
    const session = sessions.get(sessionId);

    // If it's not a remote session, use local API directly
    if (!session || !session.owner) {
        throw new Error('Not a remote session');
    }

    const requestId = `fs-${++fsRequestIdCounter}`;
    const owner = session.owner;

    console.log('[FileSystem] Proxying request to owner:', owner, 'op:', operation, 'requestId:', requestId);

    // Create a promise that will be resolved when we get the response
    const resultPromise = new Promise((resolve, reject) => {
        // Store the resolve callback
        pendingFileSystemRequests.set(requestId, resolve);

        // Timeout after 30 seconds
        setTimeout(() => {
            if (pendingFileSystemRequests.has(requestId)) {
                pendingFileSystemRequests.delete(requestId);
                reject(new Error('File system request timeout'));
            }
        }, 30000);
    });

    // Send request to owner via terminal sharing
    if (terminalSharing) {
        terminalSharing.sendFileSystemRequest(sessionId, operation, params, owner, requestId);
    } else {
        pendingFileSystemRequests.delete(requestId);
        throw new Error('Terminal sharing not initialized');
    }

    return resultPromise;
}

/**
 * Check if a session uses remote file system (needs proxy)
 */
function isRemoteFileSystem(sessionId) {
    const session = sessions.get(sessionId);
    return session && session.owner && session.owner !== cloudAgentName;
}

// Make functions globally accessible
window.proxyFileSystemRequest = proxyFileSystemRequest;
window.isRemoteFileSystem = isRemoteFileSystem;

// ========================================
// Initialize
// ========================================
window.addEventListener('load', async () => {
    // 🧪 Show test mode banner if enabled
    if (TEST_MODE_NO_SLS) {
        showToast('info', '🧪 Test Mode Active', 'SLS service disabled - Viewer-only mode (shared sessions only)', 10000);

        // Add visual indicator to UI
        const testBanner = document.createElement('div');
        testBanner.id = 'testModeBanner';
        testBanner.style.cssText = `
            position: fixed;
            top: 8px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(90deg, #f97316, #ea580c);
            color: white;
            padding: 5px 14px;
            text-align: center;
            font-size: 12px;
            font-weight: 600;
            z-index: 9998;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            border-radius: 20px;
            white-space: nowrap;
            pointer-events: auto;
        `;
        testBanner.innerHTML = `
            🧪 TEST MODE: SLS Disabled - Viewer Only
            <button onclick="toggleTestMode()" style="margin-left: 10px; padding: 2px 10px; border: 1px solid white; 
                    border-radius: 10px; background: rgba(255,255,255,0.2); color: white; cursor: pointer; font-size: 10px;">
                Disable Test Mode
            </button>
        `;
        document.body.prepend(testBanner);

        // No padding push needed — banner is floating/centered, not full-width
        const wrapper = document.getElementById('terminalWrapper');
        if (wrapper) wrapper.style.paddingTop = '';

        // Disable SLS-dependent buttons in test mode
        updateSlsDependentButtons(false);
    }

    // ========================================
    // Setup UI Event Listeners (BEFORE SLS check so they work even when SLS is offline)
    // ========================================

    // Track mousedown location for proper modal close behavior
    let mouseDownTarget = null;

    // Add global mousedown tracker
    document.addEventListener('mousedown', (e) => {
        mouseDownTarget = e.target;
    });

    // Setup modal click-outside-to-close listeners
    // Only close if BOTH mousedown AND mouseup happen on the overlay (not inside modal)
    document.getElementById('settingsModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'settingsModalOverlay' && mouseDownTarget?.id === 'settingsModalOverlay') {
            closeSettingsModal();
        }
    });

    document.getElementById('sshModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'sshModalOverlay' && mouseDownTarget?.id === 'sshModalOverlay') {
            closeSshModal();
        }
    });

    document.getElementById('helpModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'helpModalOverlay' && mouseDownTarget?.id === 'helpModalOverlay') {
            closeHelpModal();
        }
    });

    document.getElementById('cloudModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'cloudModalOverlay' && mouseDownTarget?.id === 'cloudModalOverlay') {
            closeCloudModal();
        }
    });

    document.getElementById('aboutModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'aboutModalOverlay' && mouseDownTarget?.id === 'aboutModalOverlay') {
            closeAboutModal();
        }
    });

    // Global Escape key handler to close any open modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
            // Check which modal is open and close it
            if (document.getElementById('settingsModalOverlay')?.classList.contains('visible')) {
                closeSettingsModal();
            } else if (document.getElementById('sshModalOverlay')?.classList.contains('visible')) {
                closeSshModal();
            } else if (document.getElementById('helpModalOverlay')?.classList.contains('visible')) {
                closeHelpModal();
            } else if (document.getElementById('aboutModalOverlay')?.classList.contains('visible')) {
                closeAboutModal();
            } else if (document.getElementById('cloudModalOverlay')?.classList.contains('visible')) {
                closeCloudModal();
            }
        }
    });

    // ========================================
    // SLS Authentication
    // ========================================

    // 🔐 Request SLS security token first (skip in test mode)
    if (!TEST_MODE_NO_SLS) {
        try {
            await requestSlsToken();
            console.log('✅ SLS authentication successful');

            // Set state to online on successful authentication
            slsCurrentState = 'online';

            // Dispatch SLS online event (initial state)
            window.dispatchEvent(new CustomEvent('sls-online', {
                detail: { previousState: null, currentState: 'online', timestamp: new Date() }
            }));
            console.log('[SLS] 🟢 Initial state: ONLINE - Event dispatched');

            // ✅ Load notes immediately on initial page load (before event listener is set up)
            // This fixes the race condition where notes wouldn't load on first page load
            console.log('[SLS] Loading notes on initial page load');
            loadNotes().catch(err => console.warn('[Notes] Failed to load notes on initial load:', err));

            updateSlsDependentButtons(true);
        } catch (error) {
            console.warn('⚠️ SLS is offline');

            // Set state to offline
            const previousState = slsCurrentState;
            slsCurrentState = 'offline';

            // Dispatch SLS offline event (initial state)
            window.dispatchEvent(new CustomEvent('sls-offline', {
                detail: { previousState: null, currentState: 'offline', timestamp: new Date(), error: error.message }
            }));
            console.log('[SLS] 🔴 Initial state: OFFLINE - Event dispatched');

            updateSlsDependentButtons(false);

            // Show notification only on state change (null→offline means first time)
            if (previousState !== 'offline') {
                showToast('warning', 'Local Service Offline', 'SDK Local Service is not running. Local and SSH terminals are disabled.');
            }

            // Continue initialization - Cloud messaging still works
        }
    }

    // ✅ CRITICAL: Check for auth URL FIRST (before loadCloudConfig)
    // This ensures auth URL values take precedence over saved config
    const hasAuthUrl = await checkForAuthUrl();

    // Now proceed with normal initialization (skip SLS checks in test mode)
    if (!TEST_MODE_NO_SLS) {
        await checkMlsHealth(false, true);
        await refreshConnections();
    } else {
        console.log('🧪 TEST MODE: Skipping SLS health check and connection refresh');
    }

    // Load cloud connection config (works in both normal and test mode via localStorage)
    // Only skip if auth URL was provided
    if (!hasAuthUrl) {
        await loadCloudConfig();
    } else {
        console.log('[Terminal] Skipping loadCloudConfig - using auth URL values');
    }


    // Initialize File Explorer
    initFileExplorer();

    // Initialize Note Editor
    console.log('[Terminal] Initializing Note Editor');
    window.noteEditor = new NoteEditor({
        mlsUrl: MLS_URL,
        onToast: showToast
    });

    // Initialize File Editor (Multi-Tab)
    console.log('[Terminal] Initializing File Editor');
    window.fileEditor = new FileEditor({
        mlsUrl: MLS_URL,
        onToast: showToast
    });

    // Initialize sidebar resize handle
    initSidebarResize();

    // Restore saved tabs from previous session
    await restoreSavedTabs();

    // Check tab overflow after restore
    checkTabOverflow();

    // ========================================
    // SLS Event Listeners Setup
    // ========================================
    // Guard: prevents sls-online → refreshConnections → checkMlsHealth → sls-online loop
    let _slsOnlineRestoring = false;

    // Listen for SLS online event
    window.addEventListener('sls-online', (event) => {
        console.log('[SLS Event] 🟢 SLS is now ONLINE', event.detail);

        // Re-enable terminal creation buttons
        updateSlsDependentButtons(true);

        // ✅ Load notes when SLS comes online
        const { previousState } = event.detail;
        if (previousState !== 'online') {
            console.log('[SLS Event] Loading notes after SLS came online');
            loadNotes().catch(err => console.warn('[Notes] Failed to load notes:', err));
        }

        // When SLS just came online (from offline/null), restore tabs that weren't
        // loaded yet and reload the sidebar. Guard against re-entrant calls.
        if (previousState !== 'online' && !_slsOnlineRestoring) {
            _slsOnlineRestoring = true;
            console.log('[SLS Event] SLS came online from:', previousState, '— restoring tabs + sidebar');

            restoreSavedTabs()
                .then(async () => {
                    checkTabOverflow();
                    updateEmptyState();
                    // Reload sidebar SSH list directly — do NOT call refreshConnections()
                    // which would call checkMlsHealth() again → infinite loop
                    const container = document.getElementById('sessionList');
                    await _renderSessionList(container);
                })
                .catch(e => console.error('[SLS Event] Restore failed:', e))
                .finally(() => { _slsOnlineRestoring = false; });
        }

        // Notify disconnected sessions that SLS is back
        sessions.forEach((session, sessionId) => {
            if (!session.connected && session.type !== 'remote') {
                if (session.terminal) {
                    session.terminal.writeln('');
                    session.terminal.writeln('\x1b[1;32m✓ SDK Local Service is back online\x1b[0m');
                    session.terminal.writeln('\x1b[33mPress R to reconnect this session\x1b[0m');
                }
            }
        });
    });

    // Listen for SLS offline event
    window.addEventListener('sls-offline', (event) => {
        console.log('[SLS Event] 🔴 SLS is now OFFLINE', event.detail);

        // Disable terminal creation buttons
        updateSlsDependentButtons(false);

        // Mark all local/SSH sessions as potentially disconnected
        sessions.forEach((session, sessionId) => {
            if (session.connected && session.type !== 'remote') {
                // Don't immediately disconnect - WebSocket close handler will do that
                // But warn the user
                if (session.terminal) {
                    session.terminal.writeln('');
                    session.terminal.writeln('\x1b[1;33m⚠ SDK Local Service went offline\x1b[0m');
                }
            }
        });
    });

    console.log('[SLS] Event-based status system initialized');

    // Disable Sharing tab initially (will be enabled on connection)
    if (!cloudConnected) {
        disableSharingTab();
    }

    // Start health check interval — silent=true so it never flashes "Checking..."
    setInterval(() => checkMlsHealth(false, true), 30000);

    // Refresh token every 23 hours (before 24h expiry)
    setInterval(() => {
        requestSlsToken().catch(err => {
            console.error('Failed to refresh SLS token:', err);
        });
    }, 23 * 60 * 60 * 1000);
});

window.addEventListener('resize', () => {
    // Check tab overflow on window resize
    checkTabOverflow();
});

// ========================================
// CLEANUP ON PAGE UNLOAD
// ========================================
// Warn before closing page and cleanup active sessions
window.addEventListener('beforeunload', (e) => {
    // Clean up File Explorer
    if (fileExplorer && fileExplorer.isConnected) {
        try {
            fileExplorer.close();
        } catch(err) {
            console.error('[Cleanup] Error closing File Explorer:', err);
        }
    }

    // Clean up all terminal sessions
    sessions.forEach((session) => {
        // Clear any pending timers
        if (session._reconnectTimer) clearTimeout(session._reconnectTimer);
        if (session._typingTimeout) clearTimeout(session._typingTimeout);
        if (session._resizeHandler) window.removeEventListener('resize', session._resizeHandler);
        // Close dataSender connections
        if (session.dataSender) {
            try {
                session.dataSender.close();
            } catch(err) {
                console.error('[Cleanup] Error closing terminal session:', err);
            }
        }
    });

    // Clean up pending file system requests
    pendingFileSystemRequests.forEach((pending) => {
        if (pending.timer) clearTimeout(pending.timer);
    });
    pendingFileSystemRequests.clear();

    console.log('[Terminal] Cleanup complete');

    // Warn user about active sessions
    if (sessions.size > 0) {
        const message = `You have ${sessions.size} active session(s). Are you sure you want to leave?`;
        e.returnValue = message;
        return message;
    }
});

// ========================================
// GLOBAL EXPORTS FOR TESTING
// ========================================
// Make test mode functions globally accessible from browser console
window.toggleTestMode = toggleTestMode;
window.enableTestMode = enableTestMode;
window.disableTestMode = disableTestMode;

// Keyboard shortcut for test mode (Ctrl+Shift+T)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        toggleTestMode();
    }
});

// Log test mode instructions on console
if (TEST_MODE_NO_SLS) {
    console.log('%c🧪 TEST MODE ACTIVE', 'background: #f97316; color: white; padding: 8px 16px; font-size: 14px; font-weight: bold; border-radius: 4px;');
    console.log('%c📋 TEST MODE INFO:', 'color: #f97316; font-weight: bold;');
    console.log('  ✓ SLS service disabled (viewer-only mode)');
    console.log('  ✓ Local/SSH terminals disabled');
    console.log('  ✓ Cloud connection enabled (to view shared sessions)');
    console.log('  ✓ Perfect for testing tab sharing!');
    console.log('');
    console.log('%c💡 TESTING WORKFLOW:', 'color: #22d3ee; font-weight: bold;');
    console.log('  1️⃣  Open terminal in another browser/tab WITH SLS running (normal mode)');
    console.log('  2️⃣  In normal mode: Create terminals, connect to cloud, and share sessions');
    console.log('  3️⃣  In THIS window (test mode): Connect to same cloud channel');
    console.log('  4️⃣  View and interact with shared sessions from the other window');
    console.log('');
    console.log('%c🎮 QUICK COMMANDS:', 'color: #4ade80; font-weight: bold;');
    console.log('  disableTestMode()  - Exit test mode and enable SLS');
    console.log('  Ctrl+Shift+T       - Toggle test mode (requires reload)');
    console.log('');
} else {
    console.log('%c💡 TIP: Enable Test Mode for Tab Sharing Testing', 'color: #22d3ee; font-weight: bold;');
    console.log('  enableTestMode()   - Enable viewer-only mode (no SLS required)');
    console.log('  Ctrl+Shift+T       - Quick toggle test mode');
    console.log('');
}

// ========================================
// Mobile Responsiveness
// ========================================

/**
 * Toggle mobile sidebar visibility
 */
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const body = document.body;

    if (sidebar.classList.contains('mobile-visible')) {
        // Hide sidebar
        sidebar.classList.remove('mobile-visible');
        body.classList.remove('sidebar-open');
    } else {
        // Show sidebar
        sidebar.classList.add('mobile-visible');
        body.classList.add('sidebar-open');
    }
}

/**
 * Close mobile sidebar
 */
function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const body = document.body;
    sidebar.classList.remove('mobile-visible');
    body.classList.remove('sidebar-open');
}

/**
 * Handle mobile back button
 * Priority:
 * 1. Close any open modal
 * 2. Close mobile sidebar if open
 * 3. Ask confirmation before leaving if there are active sessions
 */
function handleMobileBackButton(event) {
    // Check for open modals
    const modals = [
        'cloudModalOverlay',
        'sshModalOverlay',
        'settingsModalOverlay',
        'helpModalOverlay'
    ];

    for (const modalId of modals) {
        const modal = document.getElementById(modalId);
        if (modal && modal.style.display !== 'none') {
            event.preventDefault();
            modal.style.display = 'none';
            // Push a new state so back button works again
            window.history.pushState({ modal: 'closed' }, '');
            return;
        }
    }

    // Check if mobile sidebar is open
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('mobile-visible')) {
        event.preventDefault();
        closeMobileSidebar();
        window.history.pushState({ sidebar: 'closed' }, '');
        return;
    }

    // Check for active sessions and warn before leaving
    if (sessions.size > 0) {
        const message = `You have ${sessions.size} active session(s). Are you sure you want to leave?`;
        event.returnValue = message; // For Chrome
        return message; // For Firefox
    }
}

/**
 * Apply no-suggestion attributes to a textarea element
 * Used to prevent mobile keyboards from showing autocomplete/autocorrect
 */
function applyNoSuggestionAttrs(el) {
    if (!el) return;
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    el.setAttribute('data-gramm', 'false');
    el.setAttribute('data-gramm_editor', 'false');
    el.setAttribute('data-enable-grammarly', 'false');
    el.setAttribute('inputmode', 'text');
}

/**
 * Disable text suggestions on all existing xterm helper textareas
 */
function disableMobileTextSuggestions() {
    document.querySelectorAll('.xterm-helper-textarea').forEach(ta => {
        applyNoSuggestionAttrs(ta);
    });
}

/**
 * Initialize mobile features
 */
function initMobileFeatures() {
    // Handle back button
    window.addEventListener('popstate', handleMobileBackButton);

    // Add initial history state
    window.history.pushState({ initial: true }, '');

    // ✅ Setup modal overlay click handlers to close modals
    setupModalOverlayHandlers();

    // ✅ Disable text suggestions on all existing xterm textareas
    disableMobileTextSuggestions();

    // ✅ Watch for new xterm textareas and disable suggestions on them too
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    const textareas = node.querySelectorAll ? node.querySelectorAll('.xterm-helper-textarea') : [];
                    textareas.forEach(ta => applyNoSuggestionAttrs(ta));
                    if (node.classList && node.classList.contains('xterm-helper-textarea')) {
                        applyNoSuggestionAttrs(node);
                    }
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Close sidebar when clicking overlay (on body::before)
    document.body.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('mobile-visible')) {
            // Check if click is outside sidebar
            const rect = sidebar.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom) {
                closeMobileSidebar();
            }
        }
    });

    // Prevent zoom on double-tap for better mobile UX
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, false);

    // Auto-close sidebar when switching to a terminal tab (mobile only)
    if (window.innerWidth <= 480) {
        // Override switchToSession to auto-close sidebar on mobile
        const originalSwitchToSession = window.switchToSession;
        window.switchToSession = function(sessionId) {
            originalSwitchToSession.call(this, sessionId);
            closeMobileSidebar();
        };
    }
}

/**
 * Setup click handlers for modal overlays to close on outside click
 * Fixed: Prevent closing when user drags text selection from modal to overlay
 */
function setupModalOverlayHandlers() {
    const modalConfigs = [
        { overlayId: 'cloudModalOverlay', modalId: 'cloudModal', closeFunc: closeCloudModal },
        { overlayId: 'sshModalOverlay', modalId: null, closeFunc: closeSshModal },
        { overlayId: 'settingsModalOverlay', modalId: null, closeFunc: closeSettingsModal },
        { overlayId: 'helpModalOverlay', modalId: null, closeFunc: closeHelpModal },
        { overlayId: 'aboutModalOverlay', modalId: null, closeFunc: closeAboutModal }
    ];

    modalConfigs.forEach(config => {
        const overlay = document.getElementById(config.overlayId);
        if (overlay) {
            let mouseDownOnOverlay = false;

            // Track where mousedown started
            overlay.addEventListener('mousedown', (e) => {
                // Only set flag if mousedown is directly on overlay (not bubbled from modal)
                mouseDownOnOverlay = (e.target === overlay);
            });

            // Only close if both mousedown and mouseup were on overlay
            overlay.addEventListener('click', (e) => {
                // Close only if:
                // 1. Click target is overlay (not modal content)
                // 2. Mousedown was also on overlay (not dragged from modal)
                if (e.target === overlay && mouseDownOnOverlay) {
                    config.closeFunc();
                }
                // Reset flag
                mouseDownOnOverlay = false;
            });
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
//  Configuration Import/Export Functions
// ═══════════════════════════════════════════════════════════════════

/**
 * Export configuration as password-protected ZIP file
 */
async function exportConfiguration() {
    try {
        // Get selected options
        const exportSSH = document.getElementById('exportSSH').checked;
        const exportNotes = document.getElementById('exportNotes').checked;
        const exportSettings = document.getElementById('exportSettings').checked;
        const password = document.getElementById('exportPassword').value;

        if (!exportSSH && !exportNotes && !exportSettings) {
            showToast('warning', 'No Selection', 'Please select at least one option to export');
            return;
        }

        showToast('info', 'Exporting...', 'Creating backup file...');

        // Build configuration object
        const config = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            data: {}
        };

        // Export SSH connections
        if (exportSSH) {
            // Get from backend WITH credentials for backup (includeCredentials=true)
            const response = await slsFetch(`${MLS_URL}/terminal/ssh-connections?includeCredentials=true`);
            if (response.ok) {
                const data = await response.json();
                config.data.sshConnections = data;
            }
        }

        // Export notes
        if (exportNotes) {
            const notesArray = [];
            for (const [id, note] of notes) {
                notesArray.push({
                    id: id,
                    title: note.title,
                    content: note.content,
                    createdAt: note.createdAt,
                    updatedAt: note.updatedAt
                });
            }
            config.data.notes = notesArray;
        }

        // Export settings
        if (exportSettings) {
            config.data.settings = {
                mlsUrl: MLS_URL,
                theme: document.body.classList.contains('dark-theme') ? 'dark' : 'light',
                // Add more settings as needed
            };
        }

        // Convert to XML format
        const xmlContent = convertToXML(config);

        // Create blob and download
        const blob = new Blob([xmlContent], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `messaging-platform-backup-${new Date().toISOString().split('T')[0]}.xml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('success', 'Export Complete', 'Configuration exported successfully');

        // TODO: If password provided, create ZIP with password protection
        // This requires a library like JSZip with encryption support

    } catch (error) {
        console.error('[Export] Error:', error);
        showToast('error', 'Export Failed', error.message);
    }
}

/**
 * Handle import file selection
 */
function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Show password section if file is selected
    document.getElementById('importPasswordSection').style.display = 'block';

    // Store file for import
    window.selectedImportFile = file;

    showToast('info', 'File Selected', `Ready to import: ${file.name}`);
}

/**
 * Import configuration from backup file
 */
async function importConfiguration() {
    const file = window.selectedImportFile;
    if (!file) {
        showToast('warning', 'No File', 'Please select a backup file first');
        return;
    }

    const password = document.getElementById('importPassword').value;

    try {
        showToast('info', 'Importing...', 'Reading backup file...');

        // Read file
        const text = await file.text();

        // Parse XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        // Check for parse errors
        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) {
            throw new Error('Invalid XML format');
        }

        // Extract configuration
        const config = parseXMLConfig(xmlDoc);

        // Confirm import
        const confirmMsg = `Import configuration?\n\n` +
            `- SSH Connections: ${config.data.sshConnections ? config.data.sshConnections.length : 0}\n` +
            `- Notes: ${config.data.notes ? config.data.notes.length : 0}\n` +
            `- Settings: ${config.data.settings ? 'Yes' : 'No'}\n\n` +
            `This will merge with existing data.`;

        if (!confirm(confirmMsg)) {
            return;
        }

        // Import SSH connections
        if (config.data.sshConnections) {
            showToast('info', 'Importing', `Importing ${config.data.sshConnections.length} SSH connections...`);

            for (const conn of config.data.sshConnections) {
                try {
                    // Create SSH connection via API
                    const response = await slsFetch(`${MLS_URL}/terminal/ssh-connections`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: conn.name,
                            host: conn.host,
                            port: conn.port,
                            username: conn.username,
                            password: conn.password || null,
                            privateKey: conn.privateKey || null,
                            description: conn.description || null
                        })
                    });

                    if (response.ok) {
                        console.log('[Import] Successfully imported SSH connection:', conn.name);
                    } else {
                        const error = await response.text();
                        console.warn('[Import] Failed to import SSH connection:', conn.name, error);
                        // Continue with other connections even if one fails
                    }
                } catch (error) {
                    console.error('[Import] Error importing SSH connection:', conn.name, error);
                }
            }
        }

        // Import notes
        if (config.data.notes) {
            for (const note of config.data.notes) {
                await createNote(note.title, note.content);
            }
        }

        // Import settings
        if (config.data.settings) {
            // Apply settings
            if (config.data.settings.theme) {
                // Apply theme
            }
        }

        showToast('success', 'Import Complete', 'Configuration imported successfully');

        // Reset import UI
        document.getElementById('importFileInput').value = '';
        document.getElementById('importPassword').value = '';
        document.getElementById('importPasswordSection').style.display = 'none';
        window.selectedImportFile = null;

        // Refresh data
        await loadNotes();
        refreshConnections();

    } catch (error) {
        console.error('[Import] Error:', error);
        showToast('error', 'Import Failed', error.message);
    }
}

/**
 * Convert configuration object to XML
 */
function convertToXML(config) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<MessagingPlatformBackup>\n';
    xml += `  <Version>${config.version}</Version>\n`;
    xml += `  <ExportDate>${config.exportDate}</ExportDate>\n`;
    xml += '  <Data>\n';

    // SSH Connections
    if (config.data.sshConnections) {
        xml += '    <SSHConnections>\n';
        for (const conn of config.data.sshConnections) {
            xml += '      <Connection>\n';
            xml += `        <ID>${conn.id}</ID>\n`;
            xml += `        <Name>${escapeXML(conn.name)}</Name>\n`;
            xml += `        <Host>${escapeXML(conn.host)}</Host>\n`;
            xml += `        <Port>${conn.port}</Port>\n`;
            xml += `        <Username>${escapeXML(conn.username)}</Username>\n`;

            // Include password if present
            if (conn.password) {
                xml += `        <Password><![CDATA[${conn.password}]]></Password>\n`;
            }

            // Include private key if present
            if (conn.privateKey) {
                xml += `        <PrivateKey><![CDATA[${conn.privateKey}]]></PrivateKey>\n`;
            }

            // Include description if present
            if (conn.description) {
                xml += `        <Description>${escapeXML(conn.description)}</Description>\n`;
            }

            // Timestamps
            if (conn.createdAt) {
                xml += `        <CreatedAt>${conn.createdAt}</CreatedAt>\n`;
            }
            if (conn.updatedAt) {
                xml += `        <UpdatedAt>${conn.updatedAt}</UpdatedAt>\n`;
            }
            if (conn.lastUsedAt) {
                xml += `        <LastUsedAt>${conn.lastUsedAt}</LastUsedAt>\n`;
            }

            xml += '      </Connection>\n';
        }
        xml += '    </SSHConnections>\n';
    }

    // Notes
    if (config.data.notes) {
        xml += '    <Notes>\n';
        for (const note of config.data.notes) {
            xml += '      <Note>\n';
            xml += `        <ID>${note.id}</ID>\n`;
            xml += `        <Title>${escapeXML(note.title)}</Title>\n`;
            xml += `        <Content><![CDATA[${note.content}]]></Content>\n`;
            xml += `        <CreatedAt>${note.createdAt}</CreatedAt>\n`;
            xml += `        <UpdatedAt>${note.updatedAt}</UpdatedAt>\n`;
            xml += '      </Note>\n';
        }
        xml += '    </Notes>\n';
    }

    // Settings
    if (config.data.settings) {
        xml += '    <Settings>\n';
        xml += `      <Theme>${config.data.settings.theme}</Theme>\n`;
        xml += '    </Settings>\n';
    }

    xml += '  </Data>\n';
    xml += '</MessagingPlatformBackup>';

    return xml;
}

/**
 * Parse XML configuration
 */
function parseXMLConfig(xmlDoc) {
    const config = {
        version: xmlDoc.getElementsByTagName('Version')[0]?.textContent,
        exportDate: xmlDoc.getElementsByTagName('ExportDate')[0]?.textContent,
        data: {}
    };

    // Parse SSH Connections
    const sshConnections = xmlDoc.getElementsByTagName('Connection');
    if (sshConnections.length > 0) {
        config.data.sshConnections = [];
        for (const conn of sshConnections) {
            const connectionData = {
                name: conn.getElementsByTagName('Name')[0]?.textContent,
                host: conn.getElementsByTagName('Host')[0]?.textContent,
                port: parseInt(conn.getElementsByTagName('Port')[0]?.textContent),
                username: conn.getElementsByTagName('Username')[0]?.textContent
            };

            // Include password if present
            const passwordElement = conn.getElementsByTagName('Password')[0];
            if (passwordElement) {
                connectionData.password = passwordElement.textContent;
            }

            // Include private key if present
            const privateKeyElement = conn.getElementsByTagName('PrivateKey')[0];
            if (privateKeyElement) {
                connectionData.privateKey = privateKeyElement.textContent;
            }

            // Include description if present
            const descriptionElement = conn.getElementsByTagName('Description')[0];
            if (descriptionElement) {
                connectionData.description = descriptionElement.textContent;
            }

            config.data.sshConnections.push(connectionData);
        }
    }

    // Parse Notes
    const noteElements = xmlDoc.getElementsByTagName('Note');
    if (noteElements.length > 0) {
        config.data.notes = [];
        for (const note of noteElements) {
            config.data.notes.push({
                id: note.getElementsByTagName('ID')[0]?.textContent,
                title: note.getElementsByTagName('Title')[0]?.textContent,
                content: note.getElementsByTagName('Content')[0]?.textContent,
                createdAt: note.getElementsByTagName('CreatedAt')[0]?.textContent,
                updatedAt: note.getElementsByTagName('UpdatedAt')[0]?.textContent
            });
        }
    }

    // Parse Settings
    const themeElement = xmlDoc.getElementsByTagName('Theme')[0];
    if (themeElement) {
        config.data.settings = {
            theme: themeElement.textContent
        };
    }

    return config;
}

/**
 * Escape XML special characters
 */
function escapeXML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Initialize mobile features on load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', initMobileFeatures);
}

// Note: beforeunload handler is already registered in the cleanup section above

