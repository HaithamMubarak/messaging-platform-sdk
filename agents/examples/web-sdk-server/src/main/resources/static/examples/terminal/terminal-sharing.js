/**
 * TerminalSharing - Terminal sharing using AgentInteractionBase
 * Same pattern as air-hockey, whiteboard, and other multiplayer apps
 *
 * Single unified class combining all terminal sharing functionality:
 * - Session management (sessionId = terminal session identifier)
 * - Message routing and handling
 * - Input/output communication
 * - Agent tracking
 */
class TerminalSharing extends AgentInteractionBase {
    constructor() {
        super({
            storagePrefix: 'terminal_sharing_',
            customType: 'terminal-sharing',
            usePubKey: false,
            autoCreateDataChannel: false,
            supportsPauseResume: false
        });

        // Shared sessions tracking (sessionId = backend terminal session ID)
        this.sharedSessions = new Map(); // sessionId -> { name, owner, shell, ... }

        // Message handlers registry
        this.messageHandlers = new Map();

        // Callbacks (set by user)
        this.onSharedSessionAdd = null;      // (sessionId, sessionInfo, sourceAgent) => {}
        this.onSharedSessionRemove = null;   // (sessionId, sourceAgent) => {}
        this.onSessionOutput = null;         // (sessionId, data, sourceAgent) => {}
        this.onSessionInput = null;          // (sessionId, data, sourceAgent) => {}
    }

    /**
     * Register a message handler for a specific type
     */
    registerHandler(type, handler) {
        this.messageHandlers.set(type, handler);
    }

    /**
     * Handle incoming messages - routes to registered handlers
     */
    handleMessage(event) {
        const message = event.data;
        const type = message.type;

        console.log('[TerminalSharing] Received:', type, 'from:', event.sourceAgent);

        // Call registered handler if exists
        const handler = this.messageHandlers.get(type);
        if (handler) {
            handler(message, event.sourceAgent);
        } else {
            console.log('[TerminalSharing] No handler for type:', type);
        }
    }

    /**
     * Share a session with all connected agents
     * @param {string} sessionId - Terminal session identifier (from backend)
     * @param {Object} sessionInfo - Session metadata { name, shell, ... }
     */
    shareSession(sessionId, sessionInfo) {
        if (!this.connected) {
            console.warn('[TerminalSharing] Not connected, cannot share session');
            return false;
        }

        if (!sessionId) {
            console.error('[TerminalSharing] Invalid sessionId provided');
            return false;
        }

        if (!sessionInfo || !sessionInfo.name) {
            console.error('[TerminalSharing] Session info must include at least a name');
            return false;
        }

        // Check if already shared
        if (this.sharedSessions.has(sessionId)) {
            console.warn('[TerminalSharing] Session already shared:', sessionId);
            return false;
        }

        // Add to local shared sessions
        this.sharedSessions.set(sessionId, {
            ...sessionInfo,
            owner: this.username
        });

        // Broadcast to all agents using sendData
        this.sendData({
            type: 'session-shared',
            sessionId: sessionId,
            sessionInfo: {
                ...sessionInfo,
                owner: this.username
            }
        });

        console.log('[TerminalSharing] Shared session:', sessionId, sessionInfo.name);
        return true;
    }

    /**
     * Unshare a session
     * @param {string} sessionId - Terminal session identifier
     */
    unshareSession(sessionId) {
        if (!this.sharedSessions.has(sessionId)) return false;

        this.sharedSessions.delete(sessionId);

        if (this.connected) {
            this.sendData({
                type: 'session-unshared',
                sessionId: sessionId,
                owner: this.username
            });
        }

        console.log('[TerminalSharing] Unshared session:', sessionId);
        return true;
    }

    /**
     * Send input to a shared session (for viewers to send commands to owner's terminal)
     * @param {string} sessionId - Terminal session identifier
     * @param {string} data - Input data to send
     * @param {string} targetAgent - Owner agent name (optional, broadcasts if not provided)
     */
    sendInputToSession(sessionId, data, targetAgent) {
        if (!this.connected) {
            console.warn('[TerminalSharing] Not connected, cannot send input');
            return false;
        }

        if (!sessionId || data === undefined || data === null) {
            console.error('[TerminalSharing] Invalid sessionId or data for input');
            return false;
        }

        // Warn if trying to send to non-existent session
        if (!this.sharedSessions.has(sessionId)) {
            console.warn('[TerminalSharing] Session not found in shared sessions:', sessionId);
            // Still allow sending (might be race condition)
        }

        const message = {
            type: 'session-input',
            sessionId: sessionId,
            data: data
        };

        // Send directly using sendData (to specific agent or broadcast)
        this.sendData(message, targetAgent);

        console.log('[TerminalSharing] Sent input to session:', sessionId, targetAgent ? `to: ${targetAgent}` : '(broadcast)');
        return true;
    }

    /**
     * Send output from a shared session (for owner to broadcast terminal output)
     * @param {string} sessionId - Terminal session identifier
     * @param {string} data - Output data to broadcast
     */
    sendOutputFromSession(sessionId, data) {
        if (!this.connected) {
            console.warn('[TerminalSharing] Not connected, cannot send output');
            return false;
        }

        if (!this.sharedSessions.has(sessionId)) {
            console.warn('[TerminalSharing] Session not shared:', sessionId);
            return false;
        }

        this.sendData({
            type: 'session-output',
            sessionId: sessionId,
            data: data
        });

        return true;
    }

    /**
     * Handle session-shared message
     */
    handleSessionShared(message, sourceAgent) {
        const { sessionId, sessionInfo } = message;

        // Don't track our own shares
        if (sourceAgent === this.username) return;

        // Add to remote shared sessions
        this.sharedSessions.set(sessionId, {
            ...sessionInfo,
            owner: sourceAgent
        });

        console.log('[TerminalSharing] Remote agent shared session:', sessionId, 'from:', sourceAgent);

        // Call callback if registered
        if (typeof this.onSharedSessionAdd === 'function') {
            this.onSharedSessionAdd(sessionId, sessionInfo, sourceAgent);
        }
    }

    /**
     * Handle session-unshared message
     */
    handleSessionUnshared(message, sourceAgent) {
        const { sessionId } = message;

        // Remove from shared sessions
        this.sharedSessions.delete(sessionId);

        console.log('[TerminalSharing] Remote agent unshared session:', sessionId);

        // Call callback if registered
        if (typeof this.onSharedSessionRemove === 'function') {
            this.onSharedSessionRemove(sessionId, sourceAgent);
        }
    }

    /**
     * Handle session-input message
     */
    handleSessionInput(message, sourceAgent) {
        const { sessionId, data } = message;

        console.log('[TerminalSharing] Received input for session:', sessionId, 'from:', sourceAgent);

        // Call callback if registered
        if (typeof this.onSessionInput === 'function') {
            this.onSessionInput(sessionId, data, sourceAgent);
        }
    }

    /**
     * Handle session-output message
     */
    handleSessionOutput(message, sourceAgent) {
        const { sessionId, data } = message;

        // Call callback if registered
        if (typeof this.onSessionOutput === 'function') {
            this.onSessionOutput(sessionId, data, sourceAgent);
        }
    }

    /**
     * Get all shared sessions
     * @returns {Array} Array of { sessionId, ...sessionInfo }
     */
    getSharedSessions() {
        return Array.from(this.sharedSessions.entries()).map(([id, info]) => ({
            sessionId: id,
            ...info
        }));
    }

    /**
     * Get a specific shared session by ID
     * @param {string} sessionId - Session identifier
     * @returns {Object|null} Session info or null if not found
     */
    getSharedSessionById(sessionId) {
        const sessionInfo = this.sharedSessions.get(sessionId);
        if (!sessionInfo) return null;
        return { sessionId, ...sessionInfo };
    }

    /**
     * Check if a session is currently shared
     * @param {string} sessionId - Session identifier
     * @returns {boolean} True if session is shared
     */
    isSessionShared(sessionId) {
        return this.sharedSessions.has(sessionId);
    }

    /**
     * Check if we own a shared session
     * @param {string} sessionId - Session identifier
     * @returns {boolean} True if we own this session
     */
    isSessionOwnedByUs(sessionId) {
        const session = this.sharedSessions.get(sessionId);
        return session && session.owner === this.username;
    }

    /**
     * Get only sessions we own
     * @returns {Array} Array of our shared sessions
     */
    getOurSharedSessions() {
        return this.getSharedSessions().filter(session => session.owner === this.username);
    }

    /**
     * Get only remote shared sessions (owned by others)
     * @returns {Array} Array of remote shared sessions
     */
    getRemoteSharedSessions() {
        return this.getSharedSessions().filter(session => session.owner !== this.username);
    }

    /**
     * Share multiple sessions at once
     * @param {Array} sessions - Array of { sessionId, sessionInfo } objects
     * @returns {Object} { succeeded: [], failed: [] }
     */
    shareMultipleSessions(sessions) {
        const result = { succeeded: [], failed: [] };

        sessions.forEach(({ sessionId, sessionInfo }) => {
            if (this.shareSession(sessionId, sessionInfo)) {
                result.succeeded.push(sessionId);
            } else {
                result.failed.push(sessionId);
            }
        });

        return result;
    }

    /**
     * Unshare all our sessions
     * @returns {number} Number of sessions unshared
     */
    unshareAllOurSessions() {
        const ourSessions = this.getOurSharedSessions();
        let count = 0;

        ourSessions.forEach(session => {
            if (this.unshareSession(session.sessionId)) {
                count++;
            }
        });

        console.log(`[TerminalSharing] Unshared ${count} session(s)`);
        return count;
    }

    /**
     * Generate random agent name
     */
    generateAgentName() {
        const adjectives = ['swift', 'bright', 'cool', 'dark', 'fast', 'blue', 'red', 'green', 'brave', 'wise', 'bold', 'calm'];
        const nouns = ['hawk', 'wolf', 'eagle', 'lion', 'tiger', 'bear', 'fox', 'owl', 'shark', 'dragon', 'phoenix', 'falcon'];
        const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
        const randomNum = Math.floor(Math.random() * 100);
        return `${randomAdj}-${randomNoun}-${randomNum}`;
    }

    /**
     * Get list of connected users (agents)
     */
    getConnectedUsers() {
        return this.getAgents();
    }

    /**
     * Override onStart - called when connection is established
     */
    onStart() {
        console.log('[TerminalSharing] Connected and ready');

        // Register built-in message handlers
        this.registerHandler('session-shared', (msg, src) => this.handleSessionShared(msg, src));
        this.registerHandler('session-unshared', (msg, src) => this.handleSessionUnshared(msg, src));
        this.registerHandler('session-input', (msg, src) => this.handleSessionInput(msg, src));
        this.registerHandler('session-output', (msg, src) => this.handleSessionOutput(msg, src));
        this.registerHandler('sync-sessions', (msg, src) => this.handleSyncSessions(msg, src));
        this.registerHandler('request-sync', (msg, src) => this.handleRequestSync(msg, src));

        // Request sync from existing agents
        this.requestSyncFromPeers();
    }

    /**
     * Override onPlayerJoin - called when a new agent joins
     * Send all our shared sessions to the new agent
     */
    onPlayerJoin(event) {
        const { agentName } = event;
        console.log('[TerminalSharing] New agent joined:', agentName);

        // Send all our shared sessions to the new agent
        this.sendSharedSessionsToAgent(agentName);
    }

    /**
     * Send all our shared sessions to a specific agent
     */
    sendSharedSessionsToAgent(targetAgent) {
        const ourSessions = this.getOurSharedSessions();
        if (ourSessions.length === 0) {
            console.log('[TerminalSharing] No sessions to sync to', targetAgent);
            return;
        }

        console.log('[TerminalSharing] Sending', ourSessions.length, 'shared sessions to', targetAgent);

        this.sendData({
            type: 'sync-sessions',
            sessions: ourSessions.map(session => ({
                sessionId: session.sessionId,
                sessionInfo: {
                    name: session.name,
                    shell: session.shell,
                    type: session.type,
                    owner: this.username
                }
            }))
        }, targetAgent);
    }

    /**
     * Request sync from all connected peers (when we first join)
     */
    requestSyncFromPeers() {
        console.log('[TerminalSharing] Requesting sync from peers');
        this.sendData({
            type: 'request-sync'
        });
    }

    /**
     * Handle request-sync message - another agent wants our shared sessions
     */
    handleRequestSync(message, sourceAgent) {
        console.log('[TerminalSharing] Received sync request from:', sourceAgent);
        this.sendSharedSessionsToAgent(sourceAgent);
    }

    /**
     * Handle sync-sessions message - receive multiple shared sessions at once
     */
    handleSyncSessions(message, sourceAgent) {
        const { sessions } = message;
        if (!sessions || !Array.isArray(sessions)) return;

        console.log('[TerminalSharing] Received', sessions.length, 'sessions from:', sourceAgent);

        sessions.forEach(({ sessionId, sessionInfo }) => {
            // Don't track our own sessions
            if (sourceAgent === this.username) return;

            // Add to shared sessions if not already present
            if (!this.sharedSessions.has(sessionId)) {
                this.sharedSessions.set(sessionId, {
                    ...sessionInfo,
                    owner: sourceAgent
                });

                // Fire callback for each new session
                if (typeof this.onSharedSessionAdd === 'function') {
                    this.onSharedSessionAdd(sessionId, sessionInfo, sourceAgent);
                }
            }
        });
    }

    /**
     * Override onStop - called when disconnecting
     */
    onStop() {
        // Unshare all our sessions
        const ourSessions = Array.from(this.sharedSessions.keys());
        ourSessions.forEach(sessionId => {
            const session = this.sharedSessions.get(sessionId);
            if (session && session.owner === this.username) {
                this.unshareSession(sessionId);
            }
        });

        this.sharedSessions.clear();
        console.log('[TerminalSharing] Stopped');
    }
}

// Export to global scope
window.TerminalSharing = TerminalSharing;

