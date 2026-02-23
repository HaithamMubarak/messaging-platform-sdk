/**
 * Terminal.js - SDK Local Service Terminal
 *
 * A modern web-based terminal emulator with advanced features:
 * - Local terminals (CMD, Bash, PowerShell)
 * - SSH connections with saved profiles
 * - Cloud-based terminal sharing (multi-user collaboration)
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

// UI & Timing Constants
const TOAST_DURATION = 5000;
const HEALTH_CHECK_INTERVAL = 30000;
const TERMINAL_RESIZE_DELAY = 100;
const TOKEN_MAX_AGE_HOURS = 23;

// Icons
const SHELL_ICONS = {
    cmd: '💻',
    bash: '🐧',
    powershell: '⚡',
    ssh: '🌐',
    remote: '📡',
    default: '💻'
};

const TOAST_ICONS = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
};

// ========================================
// SECTION 2: SECURITY & AUTHENTICATION
// ========================================
let slsSecurityToken = null;

// SLS state tracking: null (initial), 'online', or 'offline'
let slsCurrentState = null;

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
            headers
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
                }
            });
        }

        return response;
    } catch (error) {
        console.error('SLS fetch error:', error);
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
        if (!this.terminalSharing || !this.terminalSharing.connected) {
            console.warn('[TerminalDataSender] Not connected to cloud');
            return false;
        }
        return this.terminalSharing.sendInputToSession(this.sessionId, data, this.ownerAgent);
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
// SECTION 4: STATE MANAGEMENT
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
const sessions = new Map();
let activeSessionId = null;

// ========================================
// SECTION 5: CLOUD SHARING STATE
// ========================================
let terminalSharing = null;    // TerminalSharing instance (like air-hockey airHockeyGame)
let cloudConnected = false;
let cloudAgentName = null;

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
    } catch (e) {
        console.warn('[TabPersistence] Failed to save metadata:', e);
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
 */
async function restoreSavedTabs() {
    try {
        const response = await slsFetch(`${MLS_URL}/terminal/sessions`);
        if (!response.ok) return;

        const savedSessions = await response.json();

        // Filter active sessions that should be restored
        const toRestore = savedSessions
            .filter(s => s.status === 'active' && s.autoRestore !== false)
            .sort((a, b) => (a.tabOrder || 0) - (b.tabOrder || 0));

        console.log('[TabPersistence] Found', toRestore.length, 'sessions to restore');

        for (const dbSession of toRestore) {
            await restoreTab(dbSession);
        }

        // After all tabs are restored, switch to the first one to give it focus
        if (toRestore.length > 0) {
            const firstSessionId = toRestore[0].sessionId;
            console.log('[TabPersistence] Switching to first restored tab:', firstSessionId);
            // Use setTimeout to ensure all tabs are fully rendered
            setTimeout(() => {
                switchToSession(firstSessionId);
            }, 200);
        }

        updateEmptyState();
        updateSessionCount();

    } catch (error) {
        console.error('[TabPersistence] Failed to restore tabs:', error);
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
            owner: null  // Runtime only - set when receiving shared tabs from cloud
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

        // Check if backend connection is still alive
        console.log('[TabRestore] Checking if backend connection is alive for:', sessionId);
        const checkResponse = await fetch(`${MLS_URL}/terminal/${sessionId}`);

        if (checkResponse.ok) {
            // ✅ Backend connection is ALIVE! Auto-reconnect WebSocket
            console.log('[TabRestore] Backend connection alive, auto-connecting WebSocket:', sessionId);
            terminal.clear();
            terminal.writeln(`\x1b[32m✓ Connection alive, reconnecting...\x1b[0m`);
            if (type === 'ssh' && config.host) {
                terminal.writeln(`\x1b[36mHost: ${config.username}@${config.host}:${config.port}\x1b[0m`);
            }

            // Auto-connect WebSocket after brief delay
            setTimeout(() => {
                connectWebSocket(sessionId);
            }, 100);
        } else {
            // ❌ Backend connection is DEAD (session not in memory)
            // But tab metadata persists in DB - show reconnect overlay
            console.log('[TabRestore] Backend connection dead, tab persisted. Showing reconnect overlay:', sessionId);
            showReconnectOverlay(sessionId);
            terminal.clear();
            terminal.writeln('\x1b[36m╔══════════════════════════════════════════════╗\x1b[0m');
            terminal.writeln('\x1b[36m║\x1b[0m   \x1b[1;33mTab Restored from Database\x1b[0m             \x1b[36m║\x1b[0m');
            terminal.writeln('\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m');
            terminal.writeln('');
            terminal.writeln(`\x1b[36mTab:\x1b[0m ${name}`);
            if (type === 'ssh' && config.host) {
                terminal.writeln(`\x1b[36mHost:\x1b[0m ${config.username}@${config.host}:${config.port}`);
            } else if (type === 'ssh' && config.error) {
                terminal.writeln(`\x1b[33mWarning:\x1b[0m ${config.error}`);
            }
            terminal.writeln('');
            terminal.writeln('\x1b[33mConnection inactive. Press \x1b[1;32mR\x1b[0m\x1b[33m to reconnect.\x1b[0m');
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

    const reconnectDiv = document.getElementById(`reconnect-${oldSessionId}`);
    if (reconnectDiv) reconnectDiv.id = `reconnect-${newSessionId}`;

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

    // In test mode, show special status
    if (TEST_MODE_NO_SLS) {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'SLS: Test Mode';
        statusText.title = 'Test mode enabled - SLS disabled';
        console.log('🧪 TEST MODE: Skipping SLS health check');
        return false;
    }

    statusDot.className = 'status-dot checking';
    statusText.textContent = 'SLS: Checking...';

    try {
        // Health endpoint is public - use regular fetch (no auth needed)
        // Don't use slsFetch to avoid unnecessary token requests for health checks
        const response = await fetch(`${MLS_URL}/health`, {
            method: 'GET',
            // Add timeout to detect offline faster
            signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        if (response.ok) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'SLS: Online';
            statusText.title = `SDK Local Service running on port ${SLS_PORT}`;

            // Check if state changed: null→online or offline→online
            const previousState = slsCurrentState;
            slsCurrentState = 'online';

            // Show notification only on state change
            if (showNotification && previousState !== 'online') {
                showToast('success', 'SLS Online', 'SDK Local Service is running');
            }
            return true;
        }

        // Non-OK response (4xx, 5xx)
        throw new Error(`Health check failed with status: ${response.status}`);
    } catch (error) {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'SLS: Offline';
        statusText.title = `Cannot connect to SLS on localhost:${SLS_PORT}`;

        console.warn('[Health] SLS health check failed:', error.message);

        // Check if state changed: null→offline or online→offline
        const previousState = slsCurrentState;
        slsCurrentState = 'offline';

        // Show notification only on state change
        if (showNotification && previousState !== 'offline') {
            const errorMsg = error.name === 'TimeoutError'
                ? 'Connection timeout - SLS not responding'
                : `Please start SDK Local Service on localhost:${SLS_PORT}`;
            showToast('warning', 'SLS Offline', errorMsg);
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

async function refreshConnections() {
    const container = document.getElementById('sessionList');
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

    // Deactivate other tabs
    tabBar.querySelectorAll('.tab').forEach(t => {
        if (t.id !== `tab-${sessionId}`) t.classList.remove('active');
    });

    // Set as active session and ensure it gets focus
    activeSessionId = sessionId;

    // Check for tab overflow and show/hide scroll buttons
    setTimeout(checkTabOverflow, 100);
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
    // Update tabs
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) tab.classList.add('active');

    // Update terminal panels
    document.querySelectorAll('.terminal-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`panel-${sessionId}`);
    if (panel) panel.classList.add('active');

    activeSessionId = sessionId;

    // Update status bar with active session
    updateStatusBar();

    // Focus terminal and fit
    const session = sessions.get(sessionId);
    if (session && session.terminal) {
        setTimeout(() => {
            if (session.fitAddon) session.fitAddon.fit();
            session.terminal.focus();
        }, 100);
    }

    updateEmptyState();
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
    // Update MLS info
    const statusMls = document.getElementById('statusMls');
    if (statusMls) {
        statusMls.textContent = `localhost:${SLS_PORT}`;
    }

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
            // Format: user@host or session name
            let activeInfo = session.name || 'Unknown';

            // For SSH sessions, show user@host
            if (session.type === 'ssh' && session.config) {
                const user = session.config.username || 'user';
                const host = session.config.host || 'unknown';
                activeInfo = `${user}@${host}`;
            }

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
    updateSharedSessionsList();
}

function refreshMyShares() {
    // Refresh my shares list
    updateMySharesList();
}

function closeSftpPanel() {
    switchSidebarTab('sessions');
}

// Make globally accessible for inline onclick handlers
window.refreshSharedSessions = refreshSharedSessions;
window.refreshMyShares = refreshMyShares;
window.closeSftpPanel = closeSftpPanel;

/**
 * Update my shares list in sidebar
 */
function updateMySharesList() {
    const container = document.getElementById('mysharesList');
    if (!container) return;

    const myShares = Array.from(sessions.values()).filter(s => s.isShared && !s.owner);

    if (myShares.length === 0) {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 11px;">
                No shared terminals yet.<br>
                Share a terminal to see it here.
            </div>
        `;
        return;
    }

    let html = '';
    myShares.forEach(session => {
        const permission = session.permission || 'readonly';
        const permIcon = permission === 'readwrite' ? '✏️' : '👁️';
        const permLabel = permission === 'readwrite' ? 'Read/Write' : 'Read Only';

        html += `
            <div class="session-item" onclick="switchToSession('${session.id}')" title="${escapeHtml(session.name)} - ${permLabel}">
                <div class="session-icon">📤</div>
                <div class="session-details">
                    <div class="session-name">${escapeHtml(session.name)}</div>
                    <div class="session-info">${permIcon} ${permLabel}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
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
        <div class="reconnect-overlay" id="reconnect-${sessionId}">
            <div class="reconnect-icon">⚠️</div>
            <div class="reconnect-title">Connection Lost</div>
            <div class="reconnect-message">The session has been disconnected.</div>
            <div class="reconnect-hint">
                <span class="reconnect-key">R</span>
                <span class="reconnect-hint-text">Press <strong>R</strong> to reconnect</span>
            </div>
        </div>
    `;

    // Deactivate other panels
    wrapper.querySelectorAll('.terminal-panel').forEach(p => p.classList.remove('active'));
    wrapper.appendChild(panel);

    return panel;
}

// ========================================
// Create Local Terminal
// ========================================
async function createLocalTerminal(shell = 'cmd') {
    if (TEST_MODE_NO_SLS) {
        showToast('warning', '🧪 Test Mode', 'Local terminals disabled in test mode. Connect to cloud to view shared sessions.');
        console.warn('🧪 TEST MODE: Local terminal creation disabled');
        return;
    }

    const healthy = await checkMlsHealth();
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

    const healthy = await checkMlsHealth();
    if (!healthy) {
        showToast('error', 'SLS Unavailable', 'Please start SDK Local Service first');
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
            body: JSON.stringify({ type: 'ssh', connectionId })
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

    } catch (error) {
        console.error('[SSH] Connection error:', error);

        // Check if temp session still exists (might have been closed)
        const stillExists = sessions.has(tempSessionId);

        if (stillExists) {
            // Session exists, show error and clean up
            closeSession(tempSessionId);
            showToast('error', 'Connection Failed', error.message || 'Failed to connect to SSH server');
        } else {
            // Session was already closed, just log it
            console.log('[SSH] Session was closed during connection attempt');
        }
    }
}

// ========================================
// Initialize xterm.js Terminal
// ========================================
function initTerminal(sessionId) {
    const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
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

    // Delay fit to ensure container is rendered properly
    setTimeout(() => {
        fitAddon.fit();
        // If already connected, send the size immediately
        const sess = sessions.get(sessionId);
        if (sess && sess.connected) {
            const cols = terminal.cols;
            const rows = terminal.rows;
            // Only send if dimensions are reasonable (not 80x2 or similar)
            if (cols > 0 && rows > 10) {
                console.log(`[Terminal] Initial fit complete: ${cols}x${rows}`);
                fetch(`${MLS_URL}/terminal/${sessionId}/resize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cols, rows })
                }).catch(() => {});
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

        // ✅ Send typing indicator for remote sessions
        if (foundSession.owner && terminalSharing && cloudConnected) {
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
            // Bash manages its own line endings - send plain \r only
            const shell = foundSession.config?.shell || 'cmd';
            if (data === '\r' && (shell === 'cmd' || shell === 'powershell')) {
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

    // Welcome message - simple and clean
    terminal.writeln('\x1b[1;33mSDK Local Service\x1b[0m - Connecting...');
    terminal.writeln('');

    return terminal;
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
            console.error('[WS] Connection timeout - SLS not responding');
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

        // Wrap WebSocket in TerminalDataSender for unified interface
        session.dataSender = createTerminalDataSender('websocket', { webSocket: ws });

        console.log('[WS] Session state updated: connected=true, dataSender set');
        hideReconnectOverlay(sessionId);
        updateTab(sessionId, false);

        // Clear welcome message and show connected
        session.terminal.clear();
        session.terminal.writeln('\x1b[1;32m✓ Connected\x1b[0m');
        session.terminal.writeln('');

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

        // Send Enter key to trigger prompt display (for restored sessions)
        // This helps show the shell prompt when reconnecting to an alive session
        setTimeout(() => {
            if (session.connected && session.dataSender && session.dataSender.isReady) {
                console.log('[WS] Sending Enter key to trigger prompt for session:', sessionId);
                session.dataSender.send('\r');
            }
        }, 400); // Send after resize completes
    };

    ws.onmessage = (event) => {
        try {
            let data = event.data;

            // Filter out invalid control characters that cause xterm parsing errors
            // Remove DEL (127/0x7F) and other problematic control chars
            // Keep: printable chars, newlines (\n, \r), tabs (\t), and valid ANSI escapes (ESC = 27/0x1B)
            data = data.replace(/[\x7F]/g, ''); // Remove DEL character

            // Clean bash output - strip leading spaces per line
            // Bash running through a pipe (no PTY) produces extra leading spaces
            // because tools can't detect terminal width properly
            const shell = session.config?.shell || 'cmd';
            data = cleanOutput(data, shell);

            // Only write if we have valid data
            if (data.length > 0) {
                session.terminal.write(data);
            }

            // ✅ If this terminal is shared, broadcast the output to other agents
            if (session.isShared && cloudConnected && terminalSharing) {
                const sent = terminalSharing.sendOutputFromSession(sessionId, event.data);
                if (sent) {
                    console.log('[Terminal] Broadcasted output:', sessionId, 'bytes:', event.data.length);
                }
            }
        } catch (e) {
            console.warn('[Terminal] Write error:', e);
        }
    };

    ws.onerror = (error) => {
        // Clear timeout - error already occurred
        clearTimeout(connectionTimeout);
        
        console.error('[WS] WebSocket error for session:', sessionId, error);

        // Show user-friendly error based on connection state
        if (!session.connected) {
            // Connection never established - likely SLS is offline
            console.error('[WS] Failed to establish connection - SLS may be offline');
            session.terminal.writeln('');
            session.terminal.writeln('\x1b[1;31m✖ Connection failed\x1b[0m');
            session.terminal.writeln('\x1b[33mCannot connect to SDK Local Service\x1b[0m');
            session.terminal.writeln('\x1b[36mPlease ensure SLS is running on localhost:' + SLS_PORT + '\x1b[0m');
        }
    };

    ws.onclose = (event) => {
        // Clear timeout - connection closed
        clearTimeout(connectionTimeout);
        
        console.log('[WS] WebSocket closed for session:', sessionId);
        console.log('[WS] Close code:', event.code, 'Reason:', event.reason || 'No reason provided');
        console.log('[WS] Was clean close:', event.wasClean);

        session.connected = false;
        session.dataSender = null;
        updateTab(sessionId, true);
        showReconnectOverlay(sessionId);

        // Provide context-specific messages based on close code
        if (!event.wasClean) {
            console.warn('[WS] Abnormal close - possible SLS crash or network issue');

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

            // If code 1006, it's likely SLS went offline
            if (event.code === 1006) {
                console.error('[WS] Code 1006 - SLS likely went offline or crashed');
                showToast('warning', 'Connection Lost', 'SLS may have stopped. Press R to reconnect.');
            }
        }
    };

    session.dataSender = ws;
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
    const overlay = document.getElementById(`reconnect-${sessionId}`);
    if (overlay) overlay.classList.add('visible');

    const session = sessions.get(sessionId);
    if (session && session.terminal) {
        session.terminal.writeln('');
        session.terminal.writeln('\x1b[1;31m⚠ Connection lost\x1b[0m');
        session.terminal.writeln('\x1b[33mPress R to reconnect...\x1b[0m');
    }
}

function hideReconnectOverlay(sessionId) {
    const overlay = document.getElementById(`reconnect-${sessionId}`);
    if (overlay) overlay.classList.remove('visible');
}

async function reconnectSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    showToast('info', 'Reconnecting...', `Reconnecting ${session.name}`);
    hideReconnectOverlay(sessionId);

    // Close existing dataSender if any
    if (session.dataSender) {
        session.dataSender.close();
    }

    try {
        // First, check if backend session still exists
        const checkResponse = await fetch(`${MLS_URL}/terminal/${sessionId}`);

        if (checkResponse.ok) {
            // Session exists, just reconnect WebSocket
            session.terminal.clear();
            session.terminal.writeln('\x1b[32m✓ Session found, reconnecting...\x1b[0m');

            await new Promise(resolve => setTimeout(resolve, 100));
            connectWebSocket(sessionId);

            showToast('success', 'Reconnected', `${session.name} reconnected successfully`);
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

    } catch (error) {
        console.error('[Reconnect] Failed:', error);
        session.terminal.clear();
        session.terminal.writeln('\x1b[31m✖ Reconnect failed\x1b[0m');
        session.terminal.writeln(`\x1b[33m${error.message}\x1b[0m`);
        session.terminal.writeln('\x1b[33mPress R to retry...\x1b[0m');
        showToast('error', 'Reconnect Failed', error.message);
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
    }

    try {
        // Close dataSender (only for local/SSH sessions, not remote shared)
        if (session.dataSender) {
            console.log(`[Close] Closing dataSender for session: ${sessionId}`);
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
    // R to reconnect (when overlay is visible and terminal not focused for input)
    if (e.key && e.key.toLowerCase() === 'r' && activeSessionId) {
        const session = sessions.get(activeSessionId);
        if (session && !session.connected) {
            const overlay = document.getElementById(`reconnect-${activeSessionId}`);
            if (overlay && overlay.classList.contains('visible')) {
                e.preventDefault();
                reconnectSession(activeSessionId);
            }
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
window.showHelp = function() {
    document.getElementById('helpModalOverlay').classList.add('visible');
    // Default to quickstart tab
    switchHelpTab('quickstart');
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
    const aboutInfo = `
        <div style="text-align: center; color: white;">
            <h3 style="color: #ffffff; margin-bottom: 10px; font-weight: 600;">🖥️ SDK Local Service Terminal</h3>
            <p style="color: #f0f0f0; margin-bottom: 8px; font-size: 14px;">Version 1.0.0</p>
            <p style="color: #d0d0d0; font-size: 12px; margin-bottom: 12px;">Built with xterm.js, Spring Boot & WebSocket</p>
            <div style="border-top: 1px solid rgba(255, 255, 255, 0.3); padding-top: 12px; margin-top: 12px;">
                <p style="color: #e0e0e0; font-size: 12px;">Part of Messaging Platform SDK</p>
                <p style="color: #c0c0c0; font-size: 11px; margin-top: 4px;">© 2026 - Open Source Project</p>
            </div>
        </div>
    `;
    showToast('info', '', aboutInfo, 6000);
}


// ========================================
// Context Menu State
// ========================================
let contextMenuTarget = null;    // SSH connection context menu target
let tabContextMenuTarget = null; // Tab context menu target sessionId

function hideContextMenus() {
    document.getElementById('tabContextMenu').classList.remove('visible');
    document.getElementById('sessionContextMenu').classList.remove('visible');
}

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
    const requestPermissionMenuItem = document.getElementById('requestPermissionMenuItem');

    // Check if this is a received shared session (I'm viewing someone else's share)
    const isReceivedShare = session && session.owner && session.owner !== cloudAgentName;
    const isMySharedSession = session && session.isShared && !session.owner;

    if (shareText) {
        shareText.textContent = session && session.isShared ? 'Unshare Session' : 'Share Session';
    }

    // Disable share option for received shares or if not connected to cloud
    if (shareMenuItem) {
        if (isReceivedShare) {
            shareMenuItem.classList.add('disabled');
            shareMenuItem.title = 'Cannot share a received session';
        } else if (!cloudConnected || !terminalSharing) {
            shareMenuItem.classList.add('disabled');
            shareMenuItem.title = 'Connect to cloud messaging first';
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

    // Check if the action is disabled (e.g., share when not connected)
    if (action === 'toggleShare') {
        console.log('[TabContextMenu] toggleShare action detected');
        console.log('[TabContextMenu] cloudConnected:', cloudConnected);
        console.log('[TabContextMenu] terminalSharing:', terminalSharing);

        const shareMenuItem = document.getElementById('shareMenuItem');
        console.log('[TabContextMenu] shareMenuItem:', shareMenuItem);
        console.log('[TabContextMenu] shareMenuItem.classList:', shareMenuItem?.classList);

        if (shareMenuItem && shareMenuItem.classList.contains('disabled')) {
            console.warn('[TabContextMenu] Share menu is disabled, showing warning');
            showToast('warning', 'Not Connected', 'Connect to cloud messaging first to share terminals');
            return;
        }

        console.log('[TabContextMenu] Share menu is enabled, proceeding...');
    }

    switch (action) {
        // ...existing code...
        case 'rename': {
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
            break;
        }
        case 'duplicate': {
            const session = sessions.get(sessionId);
            if (session && session.type === 'local') {
                createLocalTerminal(session.config?.shell || 'bash');
            } else if (session && session.type === 'ssh') {
                const cfg = session.config || {};
                connectToSsh(cfg.connectionId, cfg.name, cfg.host, cfg.port, cfg.username);
            }
            break;
        }
        case 'toggleShare': {
            console.log('[TabContextMenu] Inside toggleShare case');
            console.log('[TabContextMenu] sessionId param:', sessionId);
            console.log('[TabContextMenu] typeof sessionId:', typeof sessionId);
            console.log('[TabContextMenu] All session keys:', Array.from(sessions.keys()));
            console.log('[TabContextMenu] cloudConnected:', cloudConnected);
            console.log('[TabContextMenu] terminalSharing:', terminalSharing);

            // Check if cloud connected before allowing share/unshare
            if (!cloudConnected || !terminalSharing) {
                console.warn('[TabContextMenu] Not connected - showing toast');
                showToast('warning', 'Not Connected', 'Connect to cloud messaging first to share terminals');
                return;
            }

            const session = sessions.get(sessionId);
            console.log('[TabContextMenu] Session retrieved:', session);

            if (!session) {
                console.error('[TabContextMenu] Session not found!');
                console.error('[TabContextMenu] Looking for:', sessionId);
                console.error('[TabContextMenu] Available sessions:', sessions);
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
            break;
        }
        case 'close':
            closeSession(sessionId);
            break;
        case 'closeOthers': {
            const toClose = Array.from(sessions.keys()).filter(id => id !== sessionId);
            toClose.forEach(id => closeSession(id));
            break;
        }
        case 'closeToRight': {
            const tabBar = document.getElementById('tabBar');
            const allTabs = Array.from(tabBar.querySelectorAll('.tab[data-session-id]'));
            const idx = allTabs.findIndex(t => t.dataset.sessionId === sessionId);
            if (idx !== -1) {
                allTabs.slice(idx + 1).forEach(t => closeSession(t.dataset.sessionId));
            }
            break;
        }
        case 'closeToLeft': {
            const tabBar = document.getElementById('tabBar');
            const allTabs = Array.from(tabBar.querySelectorAll('.tab[data-session-id]'));
            const idx = allTabs.findIndex(t => t.dataset.sessionId === sessionId);
            if (idx !== -1) {
                allTabs.slice(0, idx).forEach(t => closeSession(t.dataset.sessionId));
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

                // Update the shared sessions list to reflect permission change
                updateSharedTerminalsList();
            }
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
            <div style="${iconStyle}">🚀</div>
            <h2 style="margin: 0 0 16px 0; font-size: 24px; color: var(--text-primary); text-align: center; font-weight: 700;">
                Join Shared Channel
            </h2>
            <p style="margin: 0 0 24px 0; font-size: 14px; color: var(--text-secondary); line-height: 1.7; text-align: center;">
                You're joining <strong style="color: var(--accent-cyan); font-weight: 600;">${channelName}</strong>
                <br>
                <span style="font-size: 13px; opacity: 0.8;">Enter your agent name or skip to use terminal offline</span>
            </p>
            <div style="margin-bottom: 24px;">
                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: var(--text-secondary); font-weight: 500;">
                    Your Agent Name
                </label>
                <input type="text" id="agent-name-input" placeholder="e.g., Swift-Tiger-1234" 
                       style="width: 100%; padding: 14px; border: 2px solid var(--border-color); 
                              border-radius: 8px; background: var(--bg-darker); color: var(--text-primary); 
                              font-size: 15px; box-sizing: border-box; transition: all 0.2s;
                              font-family: 'Consolas', 'Monaco', monospace;"
                       onfocus="this.style.borderColor='var(--accent-blue)'; this.style.boxShadow='0 0 0 3px rgba(74, 158, 255, 0.1)';"
                       onblur="this.style.borderColor='var(--border-color)'; this.style.boxShadow='none';">
                <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">
                    💡 A unique name has been generated for you
                </div>
            </div>
            <div style="display: flex; gap: 12px; justify-content: stretch;">
                <button id="agent-name-skip" style="flex: 1; padding: 12px 20px; border: 2px solid var(--border-color); 
                                                      border-radius: 8px; background: transparent; 
                                                      color: var(--text-secondary); cursor: pointer; font-size: 14px;
                                                      font-weight: 600; transition: all 0.2s;"
                        onmouseover="this.style.background='var(--bg-darker)'; this.style.borderColor='var(--accent-blue)';"
                        onmouseout="this.style.background='transparent'; this.style.borderColor='var(--border-color)';">
                    ⏭️ Skip
                </button>
                <button id="agent-name-confirm" style="flex: 2; padding: 12px 24px; border: none; border-radius: 8px; 
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
        const skipBtn = dialog.querySelector('#agent-name-skip');

        // Generate unique default name (guaranteed unique with timestamp)
        const defaultName = generateAgentName();
        input.value = defaultName;
        input.select();
        input.focus();

        const cleanup = () => {
            overlay.style.animation = 'fadeOut 0.2s ease-out';
            setTimeout(() => {
                if (document.body.contains(overlay)) {
                    document.body.removeChild(overlay);
                }
            }, 200);
            // Clear the hash to avoid re-triggering
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        };

        const confirm = () => {
            const name = input.value.trim();
            if (name) {
                cleanup();
                resolve(name);
            } else {
                input.focus();
                input.style.borderColor = 'var(--accent-red)';
                showToast('warning', 'Name Required', 'Please enter your agent name');
                setTimeout(() => {
                    input.style.borderColor = 'var(--border-color)';
                }, 2000);
            }
        };

        const skip = () => {
            cleanup();
            resolve(null);
            showToast('info', '⏭️ Skipped', 'You can connect to cloud manually later');
        };

        confirmBtn.onclick = confirm;
        skipBtn.onclick = skip;

        // Prevent closing by clicking outside (intentional)
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

    // Update button based on share state
    if (session.isShared) {
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

/**
 * Open cloud connection modal
 */
function openCloudModal() {
    console.log('[Cloud] Opening cloud modal...');
    const overlay = document.getElementById('cloudModalOverlay');

    if (!overlay) {
        console.error('[Cloud] ❌ cloudModalOverlay element not found!');
        return;
    }

    console.log('[Cloud] Found overlay element, setting display to flex...');
    // Use inline style to override inline display:none (inline styles have higher specificity than classes)
    overlay.style.display = 'flex';

    // Verify it was added
    console.log('[Cloud] Display style:', window.getComputedStyle(overlay).display);

    // Update cloud toolbar button to indicate it's active (only if connected)
    const cloudBtn = document.getElementById('cloudToolbarBtn');
    if (cloudBtn && cloudConnected) {
        cloudBtn.classList.add('active');
    }

    // Enable or disable Sharing tab based on connection status
    if (cloudConnected) {
        enableSharingTab();
    } else {
        disableSharingTab();
    }

    console.log('[Cloud] ✅ Modal should be visible now');
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
 * Connect to cloud using AgentInteractionBase (same pattern as air-hockey)
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
            showToast('info', '📤 Session Shared', `${sourceAgent} shared "${sessionInfo.name}" (${sessionInfo.shell})`);

            // Create a view-only terminal session for this shared session
            createSharedTerminalSession(sessionId, sessionInfo, sourceAgent);

            updateAgentsList(); // Refresh agents list
            updateSharedTerminalsList(); // Refresh shared terminals list
        };

        // Called when a remote agent unshares a session
        terminalSharing.onSharedSessionRemove = (sessionId, sourceAgent) => {
            console.log('[Terminal] Remote session unshared:', sessionId, 'from:', sourceAgent);
            showToast('info', '🛑 Sharing Stopped', `${sourceAgent} stopped sharing a session`);

            // Close the view-only session if it exists
            if (sessions.has(sessionId)) {
                closeSession(sessionId);
            }

            updateAgentsList(); // Refresh agents list
            updateSharedTerminalsList(); // Refresh shared terminals list
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
            console.log('[Terminal] Received input from:', sourceAgent, 'for session:', sessionId);

            // If we own this session (no owner = local) and it's shared, send input to local terminal
            const session = sessions.get(sessionId);
            if (session && session.isShared && !session.owner && session.dataSender) {
                console.log('[Terminal] Forwarding input to local terminal dataSender');
                session.dataSender.send(data);
            } else {
                console.warn('[Terminal] Received input for non-owned or non-shared session:', sessionId);
            }
        };

        // Listen for agent connection events to update agents list
        terminalSharing.onPlayerJoining = (event) => {
            console.log('[Terminal] Agent joining:', event.agentName);
            showToast('info', '👋 Agent Joining', `${event.agentName} is connecting...`);
            updateAgentsList(); // Update list immediately
            updateSharedTerminalsList();
        };

        terminalSharing.onPlayerJoin = (event) => {
            console.log('[Terminal] Agent joined:', event.agentName);
            showToast('success', '✅ Agent Joined', `${event.agentName} connected`);
            updateAgentsList(); // Update list when fully connected
            updateSharedTerminalsList();
        };

        terminalSharing.onPlayerLeave = (event) => {
            console.log('[Terminal] Agent left:', event.agentName);
            showToast('info', '👋 Agent Left', `${event.agentName} disconnected`);
            updateAgentsList(); // Update list when agent leaves
            updateSharedTerminalsList();
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
            } else {
                showToast('warning', '❌ Permission Denied', `${owner} denied your write request`);
            }
        };

        // Called when session permission is updated
        terminalSharing.onPermissionUpdate = (sessionId, newPermission) => {
            console.log('[Terminal] Permission update for session:', sessionId, 'new permission:', newPermission);
            updateSessionPermissionUI(sessionId, newPermission);
        };

        // Called when owner disconnects/closes a shared session
        terminalSharing.onOwnerDisconnect = (sessionId, owner) => {
            console.log('[Terminal] Owner disconnected:', owner, 'session:', sessionId);
            showToast('warning', '⚠️ Session Ended', `${owner} closed the shared terminal`);

            // Close the view-only session
            if (sessions.has(sessionId)) {
                closeSession(sessionId);
            }
            updateSharedTerminalsList();
        };

        await terminalSharing.connect({
            username: agentName,
            channelName: channelName,
            channelPassword: channelPassword
        });

        cloudConnected = true;
        cloudAgentName = agentName;

        connectBtn.textContent = 'Connected to Cloud';
        connectBtn.classList.add('active');
        connectBtn.disabled = true;
        connectBtn.title = `Connected as ${agentName}`;

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
        if (statusDot) {
            statusDot.className = 'status-dot online';
            console.log('[Cloud] Status dot updated to online');
        }
        if (statusText) {
            statusText.textContent = `Connected as ${agentName}`;
            console.log('[Cloud] Status text updated to Connected');
        }

        // Highlight cloud button and show agent name on hover
        const cloudBtn = document.getElementById('cloudToolbarBtn');
        if (cloudBtn) {
            cloudBtn.classList.add('active');
            cloudBtn.title = `Connected as ${agentName}`;
            cloudBtn.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(52, 211, 153, 0.2))';
            cloudBtn.style.borderColor = 'rgba(16, 185, 129, 0.5)';
        }

        updateAgentsList();
        updateSharedTerminalsList();

        // Generate share URL for the sharing tab
        generateShareUrl();

        // Enable the Sharing tab
        enableSharingTab();

        saveCloudConfig(true);
        showToast('success', 'Cloud Connected', `Connected as ${agentName}`);
        console.log('[Terminal] Connected as:', agentName);

    } catch (error) {
        console.error('[Terminal] Connection failed:', error);
        showToast('error', 'Connection Failed', error.message);
        terminalSharing = null;
        cloudConnected = false;
        connectBtn.textContent = 'Connect to Cloud';
        connectBtn.disabled = false;
    }
}

function disconnectFromCloud() {
    // Unshare all currently shared sessions before disconnecting
    if (terminalSharing && cloudConnected) {
        console.log('[Cloud] Unsharing all sessions before disconnect...');
        sessions.forEach((session, sessionId) => {
            if (session.isShared && !session.owner) {
                // This is our shared session - unshare it
                console.log('[Cloud] Unsharing session:', sessionId);
                terminalSharing.unshareSession(sessionId);
                session.isShared = false;
                updateTabSharedIndicator(sessionId, false);
            }
        });
    }

    if (terminalSharing) {
        terminalSharing.disconnect();
    }
    terminalSharing = null;
    cloudConnected = false;
    cloudAgentName = null;

    const connectBtn = document.getElementById('cloudConnectBtn');
    connectBtn.textContent = 'Connect to Cloud';
    connectBtn.classList.remove('disconnect', 'active');
    connectBtn.disabled = false;
    connectBtn.title = 'Connect to Messaging Platform Cloud';

    // Re-enable regenerate button when disconnected
    const regenBtn = document.getElementById('cloudRegenBtn');
    if (regenBtn) {
        regenBtn.disabled = false;
        regenBtn.title = 'Regenerate channel name and password';
    }

    document.getElementById('cloudActionsRow').style.display = 'none';
    document.getElementById('cloudAgentsSection').style.display = 'none';

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

    // Remove highlight from cloud button and reset tooltip
    const cloudBtn = document.getElementById('cloudToolbarBtn');
    if (cloudBtn) {
        cloudBtn.classList.remove('active');
        cloudBtn.title = 'Connect to Messaging Platform Cloud';
        cloudBtn.style.background = '';
        cloudBtn.style.borderColor = '';
    }

    updateAgentsList();
    updateSharedTerminalsList();
    saveCloudConfig(false);
    showToast('info', 'Disconnected', 'Disconnected from cloud');
}

function updateAgentsList() {
    const agentsList = document.getElementById('cloudAgentsList');
    if (!agentsList) return;

    if (!terminalSharing || !cloudConnected) {
        agentsList.innerHTML = '<div class="cloud-agent-item">No other agents connected</div>';
        return;
    }

    const agents = terminalSharing.getConnectedUsers();

    console.log('[AgentsList] Connected agents:', agents);
    console.log('[AgentsList] My agent name:', cloudAgentName);

    if (agents.length === 0) {
        agentsList.innerHTML = '<div class="cloud-agent-item">No other agents connected</div>';
        return;
    }

    let html = '';

    // Show connected agents only (agents is array of strings)
    agents.forEach(agentName => {
        // Don't show yourself in the list
        if (agentName !== cloudAgentName) {
            html += `<div class="cloud-agent-item">
                <div class="cloud-agent-dot"></div>
                <span>${agentName}</span>
            </div>`;
        }
    });

    agentsList.innerHTML = html || '<div class="cloud-agent-item">No other agents connected</div>';
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

    const sharedSessions = terminalSharing.getSharedSessions();

    console.log('[SharedTerminals] Shared sessions:', sharedSessions);

    if (sharedSessions.length === 0) {
        sharedList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 11px;">
            No shared terminals yet.<br>
            Right-click a tab and select "Share Session" to share.
        </div>`;
        return;
    }

    let html = '';

    // Show shared sessions (clickable to view)
    sharedSessions.forEach(session => {
        const isOurs = session.owner === cloudAgentName;
        const icon = session.shell === 'bash' ? '🐧' : session.shell === 'powershell' ? '⚡' : '💻';
        const ownerLabel = isOurs ? ' (You)' : ` (${session.owner})`;
        const clickable = !isOurs ? 'cursor: pointer;' : '';
        const hoverStyle = !isOurs ? 'transition: opacity 0.2s;' : '';
        const permIcon = session.permission === 'readwrite' ? '✏️' : '👁️';
        const permTitle = session.permission === 'readwrite' ? 'Read-Write' : 'Read-Only';
        const title = !isOurs ? `Click to view (${permTitle})` : `Your shared terminal (${permTitle})`;

        html += `<div class="cloud-agent-item"
            style="${clickable} ${hoverStyle}"
            title="${title}"
            ${!isOurs ? `onclick="viewSharedTerminal('${session.sessionId}', '${session.owner}')"` : ''}
            ${!isOurs ? `onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'"` : ''}>
            <div class="cloud-agent-dot" style="background: var(--accent-cyan);"></div>
            <span>${icon} ${session.name}${ownerLabel}</span>
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
    const terminal = initTerminal(sessionId);

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

    updateEmptyState();
    updateSessionCount();

    // Mark tab as received share (different styling)
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) {
        tab.classList.add('received-share');
    }

    // Add session badge showing permission mode
    updateSessionBadge(sessionId, sessionInfo.permission || 'readonly');

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
    const panel = document.getElementById(`panel-${sessionId}`);
    if (!panel) return;

    // Find or create typing indicator element
    let indicator = panel.querySelector('.typing-indicator');

    if (isTyping) {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'typing-indicator';
            indicator.style.cssText = `
                position: absolute;
                bottom: 8px;
                left: 12px;
                background: rgba(74, 158, 255, 0.9);
                color: white;
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 500;
                z-index: 100;
                animation: pulse 1.5s ease-in-out infinite;
            `;
            panel.appendChild(indicator);
        }
        indicator.textContent = `${agentName} is typing...`;
        indicator.style.display = 'block';
    } else {
        if (indicator) {
            indicator.style.display = 'none';
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
    const session = sessions.get(sessionId);
    if (session) {
        session.permission = permission;
    }

    // Update session badge
    updateSessionBadge(sessionId, permission);

    // Update tab styling
    const tab = document.getElementById(`tab-${sessionId}`);
    if (tab) {
        if (permission === 'readwrite') {
            tab.classList.add('write-access');
            tab.classList.remove('read-only');
        } else {
            tab.classList.add('read-only');
            tab.classList.remove('write-access');
        }
    }
}

/**
 * Update session badge showing permission mode
 * @param {string} sessionId - Session ID
 * @param {string} permission - 'readonly' or 'readwrite'
 */
function updateSessionBadge(sessionId, permission) {
    const panel = document.getElementById(`panel-${sessionId}`);
    if (!panel) return;

    // Find or create badge element
    let badge = panel.querySelector('.session-badge');

    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'session-badge';
        badge.style.cssText = `
            position: absolute;
            top: 8px;
            right: 12px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 600;
            z-index: 100;
            display: flex;
            align-items: center;
            gap: 4px;
        `;
        panel.appendChild(badge);
    }

    if (permission === 'readwrite') {
        badge.style.background = 'rgba(34, 197, 94, 0.2)';
        badge.style.color = 'var(--accent-green)';
        badge.style.border = '1px solid var(--accent-green)';
        badge.innerHTML = '✏️ Read-Write';
    } else {
        badge.style.background = 'rgba(74, 158, 255, 0.2)';
        badge.style.color = 'var(--accent-blue)';
        badge.style.border = '1px solid var(--accent-blue)';
        badge.innerHTML = '👁️ Read-Only';
    }
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
    const success = terminalSharing.shareSession(sessionId, {
        name: sessionName,
        shell: session.config?.shell || session.type || 'cmd',
        type: session.type,
        permission: permission
    });

    console.log('[ShareTerminal] Share result:', success);

    if (success) {
        updateTabSharedIndicator(sessionId, true);  // Show shared badge
        updateAgentsList(); // Refresh agents list
        updateSharedTerminalsList(); // Refresh shared terminals list
        updateSidebarBadges(); // Update sidebar badges
        updateMySharesList(); // Update my shares list
        const permLabel = permission === 'readwrite' ? 'Read-Write' : 'Read-Only';
        showToast('success', '📤 Terminal Shared', `"${session.name}" is now shared (${permLabel})`);
        console.log('[Terminal] Shared session:', sessionId, session.name);
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

    // Unmark session locally
    session.isShared = false;
    session.owner = null;

    // Unshare via TerminalSharing
    if (terminalSharing) {
        terminalSharing.unshareSession(sessionId);
        updateAgentsList(); // Refresh agents list
        updateSharedTerminalsList(); // Refresh shared terminals list
        updateSidebarBadges(); // Update sidebar badges
        updateMySharesList(); // Update my shares list
    }

    updateTabSharedIndicator(sessionId, false);  // Hide shared badge
    showToast('success', '🛑 Sharing Stopped', `"${session.name}" is no longer shared`);
    console.log('[Terminal] Unshared session:', sessionId);
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
// SFTP Browser Integration
// ========================================
let sftpBrowser = null;

function initSftpBrowser() {
    if (sftpBrowser) return;

    sftpBrowser = new SftpBrowser({
        mlsUrl: MLS_URL,
        onToast: showToast
    });

    // Mount to container
    const container = document.getElementById('sftpPanelContainer');
    sftpBrowser.mount(container);
}

function toggleSftpPanel() {
    // Initialize SFTP browser if not done
    if (!sftpBrowser) {
        initSftpBrowser();
    }

    // Switch to SFTP tab in sidebar
    switchSidebarTab('sftp');

    // If there's an active SSH session, open SFTP for it
    if (activeSessionId) {
        const session = sessions.get(activeSessionId);
        if (session && session.type === 'ssh') {
            openSftpForSession(activeSessionId);
        }
    }
}

// Make globally accessible for toolbar button
window.toggleSftpPanel = toggleSftpPanel;

// Auto-open SFTP when SSH session is connected (optional feature)
function openSftpForSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.type !== 'ssh') return;

    if (!sftpBrowser) {
        initSftpBrowser();
    }

    const connectionInfo = {
        name: session.config.name || session.name,
        host: session.config.host,
        port: session.config.port,
        username: session.config.username
    };

    sftpBrowser.open(sessionId, connectionInfo);
}

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
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(90deg, #f97316, #ea580c);
            color: white;
            padding: 8px 16px;
            text-align: center;
            font-size: 13px;
            font-weight: 600;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        testBanner.innerHTML = `
            🧪 TEST MODE: SLS Disabled - Viewer Only 
            <button onclick="toggleTestMode()" style="margin-left: 12px; padding: 4px 12px; border: 1px solid white; 
                    border-radius: 4px; background: rgba(255,255,255,0.2); color: white; cursor: pointer; font-size: 11px;">
                Disable Test Mode
            </button>
        `;
        document.body.prepend(testBanner);

        // Adjust terminal wrapper top margin
        const wrapper = document.getElementById('terminalWrapper');
        if (wrapper) wrapper.style.paddingTop = '40px';
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
        } catch (error) {
            console.warn('⚠️ SLS is offline');

            // Set state to offline
            const previousState = slsCurrentState;
            slsCurrentState = 'offline';

            // Show notification only on state change (null→offline means first time)
            if (previousState !== 'offline') {
                showToast('warning', 'SLS Offline', 'SDK Local Service is not running. Local and SSH terminals are disabled.');
            }

            // Continue initialization - Cloud messaging still works
        }
    }

    // ✅ CRITICAL: Check for auth URL FIRST (before loadCloudConfig)
    // This ensures auth URL values take precedence over saved config
    const hasAuthUrl = await checkForAuthUrl();

    // Now proceed with normal initialization (skip SLS checks in test mode)
    if (!TEST_MODE_NO_SLS) {
        await checkMlsHealth();
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


    // Initialize SFTP browser
    initSftpBrowser();

    // Initialize sidebar resize handle
    initSidebarResize();

    // Restore saved tabs from previous session
    await restoreSavedTabs();

    // Check tab overflow after restore
    checkTabOverflow();

    // Start health check interval
    setInterval(() => checkMlsHealth(), 30000);

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
// Note: Cloud connection cleanup is handled automatically by web-agent.js
// We only need to clean up application-specific resources here
window.addEventListener('beforeunload', () => {
    // Close SFTP browser (application-specific resource)
    if (sftpBrowser && sftpBrowser.isConnected) {
        try {
            sftpBrowser.close();
        } catch(e) {
            console.error('[Cleanup] Error closing SFTP browser:', e);
        }
    }

    // Note: terminalSharing (cloud connection) is automatically disconnected by web-agent.js
    // No need to manually disconnect here!

    // Close all terminal dataSender connections (WebSocket connections to local SLS)
    sessions.forEach((session) => {
        if (session.dataSender) {
            try {
                session.dataSender.close();
            } catch(e) {
                console.error('[Cleanup] Error closing terminal session:', e);
            }
        }
    });

    console.log('[Terminal] Cleanup complete');
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
