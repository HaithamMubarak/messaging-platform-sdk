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
// SDK Local Service Configuration
const DEFAULT_SLS_PORT = 8088;
let SLS_PORT = parseInt(localStorage.getItem('sls-port') || DEFAULT_SLS_PORT);
let MLS_URL = `http://localhost:${SLS_PORT}`;
let MLS_WS_URL = `ws://localhost:${SLS_PORT}`;

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

/**
 * Request security token from SLS
 */
async function requestSlsToken() {
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
        showToast('error', 'Authentication Failed', 'Failed to authenticate with SDK Local Service');
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
    // This ensures we always have the saved name, even if SSH connection fetch fails
    const name = dbSession.tabName || (type === 'local' ? `Local (${dbSession.shell || 'CMD'})` : 'SSH');
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
function showToast(type, title, message, duration = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✓', error: '✖', info: 'ℹ', warning: '⚠' };
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || 'ℹ'}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => container.removeChild(toast), 300);
    }, duration);
}

// ========================================
// SLS Health Check
// ========================================
async function checkMlsHealth(showNotification = false) {
    const statusDot = document.getElementById('mlsStatus');
    const statusText = document.getElementById('mlsStatusText');

    statusDot.className = 'status-dot checking';
    statusText.textContent = 'SLS: Checking...';

    try {
        // Health endpoint is public, but we use slsFetch for consistency
        const response = await fetch(`${MLS_URL}/health`);
        if (response.ok) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'SLS: Online';
            if (showNotification) {
                showToast('success', 'SLS Online', 'SDK Local Service is running');
            }
            return true;
        }
        throw new Error('Health check failed');
    } catch (error) {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'SLS: Offline';
        if (showNotification) {
            showToast('error', 'SLS Offline', 'Please start SDK Local Service on localhost:8088');
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

    // Update status
    const session = sessions.get(sessionId);
    if (session) {
        document.getElementById('statusActive').textContent = session.name;

        // Focus terminal and fit
        if (session.terminal) {
            setTimeout(() => {
                if (session.fitAddon) session.fitAddon.fit();
                session.terminal.focus();
            }, 100);
        }
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
}

function updateSessionCount() {
    document.getElementById('statusSessions').textContent = sessions.size;
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

    // Welcome message
    terminal.writeln('\x1b[36m╔══════════════════════════════════════════════╗\x1b[0m');
    terminal.writeln('\x1b[36m║\x1b[0m   \x1b[1;33mSDK Local Service\x1b[0m - Connecting...       \x1b[36m║\x1b[0m');
    terminal.writeln('\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m');
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

    ws.onopen = () => {
        console.log('[WS] Connected for session:', sessionId);
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
        console.error('[WS] Error:', error);
    };

    ws.onclose = (event) => {
        console.log('[WS] Closed:', event.code);
        session.connected = false;
        session.dataSender = null;
        updateTab(sessionId, true);
        showReconnectOverlay(sessionId);
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
    const form = document.getElementById('sshForm');
    form.reset();
    delete form.dataset.editId;
    // Reset modal title
    document.querySelector('#sshModalOverlay .modal-title').textContent = '➕ Add SSH Connection';
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

function switchHelpTab(tabName) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.help-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.help-content').forEach(content => content.classList.remove('active'));

    // Add active class to selected tab and content
    document.getElementById('tab-' + tabName).classList.add('active');
    document.getElementById('content-' + tabName).classList.add('active');
}

window.showAbout = function() {
    const aboutInfo = `
        <div style="text-align: center;">
            <h3 style="color: var(--accent-cyan); margin-bottom: 10px;">🖥️ SDK Local Service Terminal</h3>
            <p style="color: var(--text-secondary); margin-bottom: 8px;">Version 1.0.0</p>
            <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 12px;">Built with xterm.js, Spring Boot & WebSocket</p>
            <div style="border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 12px;">
                <p style="color: var(--text-secondary); font-size: 12px;">Part of Messaging Platform SDK</p>
                <p style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">© 2026 - Open Source Project</p>
            </div>
        </div>
    `;
    showToast('info', 'About', aboutInfo, 6000);
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

    if (shareText) {
        shareText.textContent = session && session.isShared ? 'Unshare Session' : 'Share Session';
    }

    // Disable share option if not connected to cloud
    if (shareMenuItem) {
        if (!cloudConnected || !terminalSharing) {
            shareMenuItem.classList.add('disabled');
            shareMenuItem.title = 'Connect to cloud messaging first';
        } else {
            shareMenuItem.classList.remove('disabled');
            shareMenuItem.title = '';
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
    hideContextMenus();
    const sessionId = tabContextMenuTarget;
    if (!sessionId) return;

    // Check if the action is disabled (e.g., share when not connected)
    if (action === 'toggleShare') {
        const shareMenuItem = document.getElementById('shareMenuItem');
        if (shareMenuItem && shareMenuItem.classList.contains('disabled')) {
            showToast('warning', 'Not Connected', 'Connect to cloud messaging first to share terminals');
            return;
        }
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
            // Check if cloud connected before allowing share/unshare
            if (!cloudConnected || !terminalSharing) {
                showToast('warning', 'Not Connected', 'Connect to cloud messaging first to share terminals');
                return;
            }

            const session = sessions.get(sessionId);
            if (!session) break;
            if (session.isShared) {
                unshareTerminal(sessionId);
            } else {
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
 */
async function checkForAuthUrl() {
    const hash = window.location.hash;
    if (!hash || hash.length < 10) return;

    console.log('[Terminal] Checking for shared link in URL');

    try {
        // Remove # and split by # to get auth and optional channel name
        const parts = hash.substring(1).split('#');
        const authEncoded = parts[0];

        if (!authEncoded) return;

        // Decode the auth
        let decoded;
        if (typeof ChannelAuthUtils !== 'undefined' && ChannelAuthUtils.decode) {
            decoded = ChannelAuthUtils.decode(authEncoded);
        } else if (typeof decodeChannelAuth === 'function') {
            decoded = decodeChannelAuth(authEncoded);
        } else {
            console.error('[Terminal] No decode function available');
            return;
        }

        if (!decoded || !decoded.channelName || !decoded.channelPassword) {
            console.warn('[Terminal] Invalid auth URL');
            return;
        }

        console.log('[Terminal] Valid shared link found');

        // Prompt for agent name with a nice dialog
        const agentName = await promptForAgentName(decoded.channelName);

        if (!agentName) {
            console.log('[Terminal] User cancelled agent name prompt');
            return;
        }

        // Fill in the connection form
        document.getElementById('cloudChannelName').value = decoded.channelName;
        document.getElementById('cloudChannelPassword').value = decoded.channelPassword;
        document.getElementById('cloudAgentName').value = agentName;

        // Auto-connect
        showToast('info', 'Connecting...', `Connecting to shared terminal as ${agentName}`);
        setTimeout(() => {
            connectToCloud();
        }, 500);

    } catch (error) {
        console.error('[Terminal] Failed to process auth URL:', error);
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
function showShareModal() {
    if (!cloudConnected || !terminalSharing) {
        showToast('warning', 'Not Connected', 'Connect to cloud first to share terminals');
        return;
    }

    // Get current connection details
    const channelName = document.getElementById('cloudChannelName').value;
    const channelPassword = document.getElementById('cloudChannelPassword').value;

    if (!channelName || !channelPassword) {
        showToast('error', 'No Connection', 'No active cloud connection found');
        return;
    }

    // Show the share modal
    if (typeof ShareModal !== 'undefined' && ShareModal.show) {
        ShareModal.show(channelName, channelPassword, '');
        console.log('[Terminal] Share modal shown');
    } else {
        showToast('error', 'Share Unavailable', 'Share modal not loaded');
    }
}

// ========================================
// Cloud Panel Functions
// ========================================

function toggleCloudPanel() {
    const panel = document.getElementById('cloudPanel');
    panel.classList.toggle('expanded');
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
 * Load cloud connection config from MLS backend
 */
async function loadCloudConfig() {
    try {
        const response = await slsFetch(`${MLS_URL}/cloud/connection`);
        if (!response.ok) {
            console.log('[Cloud] No saved config found');
            return;
        }

        const data = await response.json();
        const config = JSON.parse(data.config || '{}');

        console.log('[Cloud] Loaded config:', config);

        document.getElementById('cloudChannelName').value = config.channelName || '';
        document.getElementById('cloudChannelPassword').value = config.channelPassword || '';
        document.getElementById('cloudAgentName').value = config.agentName || '';

        // Auto-connect if was previously connected
        if (config.isConnected) {
            setTimeout(() => connectToCloud(), 500);
        }
    } catch (error) {
        console.error('[Cloud] Failed to load config:', error);
    }
}

/**
 * Save cloud connection config to MLS backend
 */
async function saveCloudConfig(isConnected = false) {
    try {
        const config = {
            channelName: document.getElementById('cloudChannelName').value,
            channelPassword: document.getElementById('cloudChannelPassword').value,
            agentName: cloudAgentName || document.getElementById('cloudAgentName').value,
            isConnected: isConnected
        };

        await fetch(`${MLS_URL}/cloud/connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: JSON.stringify(config) })
        });

        console.log('[Cloud] Config saved');
    } catch (error) {
        console.error('[Cloud] Failed to save config:', error);
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

        // Show the horizontal action buttons
        document.getElementById('cloudActionsRow').style.display = 'flex';
        document.getElementById('cloudAgentsSection').style.display = 'block';
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
            statusText.textContent = 'Connected';
            console.log('[Cloud] Status text updated to Connected');
        }

        // Highlight cloud button and show agent name on hover
        const cloudBtn = document.getElementById('cloudToolbarBtn');
        if (cloudBtn) {
            cloudBtn.classList.add('active');
            cloudBtn.title = `Connected as ${agentName}`;
        }

        updateAgentsList();
        updateSharedTerminalsList();
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

    document.getElementById('cloudActionsRow').style.display = 'none';
    document.getElementById('cloudAgentsSection').style.display = 'none';
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
        const title = !isOurs ? 'Click to view this shared terminal' : 'Your shared terminal';

        html += `<div class="cloud-agent-item"
            style="${clickable} ${hoverStyle}"
            title="${title}"
            ${!isOurs ? `onclick="viewSharedTerminal('${session.sessionId}', '${session.owner}')"` : ''}
            ${!isOurs ? `onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'"` : ''}>
            <div class="cloud-agent-dot" style="background: var(--accent-cyan);"></div>
            <span>${icon} ${session.name}${ownerLabel}</span>
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
        owner: ownerAgent  // The agent who owns this terminal
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

    console.log('[Terminal] Created view-only session for shared session:', sessionId, 'from:', ownerAgent);
}

function shareTerminal(sessionId) {
    console.log('[ShareTerminal] Called with sessionId:', sessionId);
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

    console.log('[ShareTerminal] Calling terminalSharing.shareSession...');

    // Share via TerminalSharing
    const success = terminalSharing.shareSession(sessionId, {
        name: session.name,
        shell: session.config?.shell || session.type || 'cmd',
        type: session.type
    });

    console.log('[ShareTerminal] Share result:', success);

    if (success) {
        updateTabSharedIndicator(sessionId, true);  // Show shared badge
        updateAgentsList(); // Refresh agents list
        updateSharedTerminalsList(); // Refresh shared terminals list
        showToast('success', '📤 Terminal Shared', `"${session.name}" is now shared with all agents`);
        console.log('[Terminal] Shared session:', sessionId, session.name);
    } else {
        session.isShared = false;
        session.owner = null;
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

    // Check if there's an active SSH session
    if (!activeSessionId) {
        showToast('warning', 'No Session', 'Please open an SSH session first');
        return;
    }

    const session = sessions.get(activeSessionId);
    if (!session || session.type !== 'ssh') {
        showToast('warning', 'SSH Required', 'SFTP is only available for SSH sessions');
        return;
    }

    // Toggle panel
    if (sftpBrowser.isConnected && sftpBrowser.terminalSessionId === activeSessionId) {
        sftpBrowser.close();
    } else {
        // Get connection info from the session
        const connectionInfo = {
            name: session.config.name || session.name,
            host: session.config.host,
            port: session.config.port,
            username: session.config.username
        };

        sftpBrowser.open(activeSessionId, connectionInfo);
    }
}

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
    // 🔐 Request SLS security token first
    try {
        await requestSlsToken();
        console.log('✅ SLS authentication successful');
    } catch (error) {
        console.error('❌ Failed to authenticate with SLS:', error);
        showToast('error', 'Authentication Failed', 'Failed to authenticate with SDK Local Service. Please ensure it is running.');
        return; // Don't proceed if we can't authenticate
    }

    // Setup modal click-outside-to-close listeners (must be after DOM is loaded)
    document.getElementById('settingsModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'settingsModalOverlay') closeSettingsModal();
    });

    document.getElementById('sshModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'sshModalOverlay') closeSshModal();
    });

    document.getElementById('helpModalOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'helpModalOverlay') closeHelpModal();
    });

    // Now proceed with normal initialization
    await checkMlsHealth();
    await refreshConnections();

    // ✅ Load cloud connection config from backend
    await loadCloudConfig();

    // Initialize share modal
    if (typeof ShareModal !== 'undefined') {
        ShareModal.init();
        console.log('[Terminal] Share modal initialized');
    }

    // Check for auth URL parameters (shared link)
    await checkForAuthUrl();

    // Initialize SFTP browser
    initSftpBrowser();

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

window.addEventListener('beforeunload', () => {
    // Close SFTP browser
    if (sftpBrowser && sftpBrowser.isConnected) {
        try { sftpBrowser.close(); } catch(e) {}
    }

    // Disconnect from cloud
    if (terminalSharing) {
        try { terminalSharing.disconnect(); } catch(e) {}
    }

    // Close all terminal dataSender connections
    sessions.forEach((session) => {
        if (session.dataSender) session.dataSender.close();
    });
});

