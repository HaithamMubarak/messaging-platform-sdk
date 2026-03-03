/**
 * TerminalSharing - Terminal sharing using UserConnectionBase
 * Same pattern as air-hockey, whiteboard, and other multiplayer apps
 *
 * Single unified class combining all terminal sharing functionality:
 * - Session management (sessionId = terminal session identifier)
 * - Message routing and handling
 * - Input/output communication
 * - Agent tracking
 * - Read/Write permissions
 * - Typing indicators
 * - Permission request/grant workflow
 */
class TerminalSharing extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'terminal_sharing_',
            customType: 'terminal-sharing',
            usePubKey: false,
            autoCreateDataChannel: true,
            supportsPauseResume: false
        });

        // Shared sessions tracking (sessionId = backend terminal session ID)
        // Structure: { name, owner, shell, permission: 'readonly'|'readwrite', ... }
        this.sharedSessions = new Map();

        // ✅ Per-session viewer tracking: sessionId → Set<agentName>
        // Tracks which agents are actively viewing which shared sessions
        this.sessionViewers = new Map();

        // Message handlers registry
        this.messageHandlers = new Map();

        // Pending permission requests (sessionId -> { requester, timestamp })
        this.pendingPermissionRequests = new Map();

        // ✅ Register built-in message handlers IMMEDIATELY in constructor
        // (so they're ready before any messages arrive)
        this.registerHandler('session-shared', (msg, src) => this.handleSessionShared(msg, src));
        this.registerHandler('session-unshared', (msg, src) => this.handleSessionUnshared(msg, src));
        this.registerHandler('session-viewer-join', (msg, src) => this.handleSessionViewerJoin(msg, src));
        this.registerHandler('session-viewer-leave', (msg, src) => this.handleSessionViewerLeave(msg, src));
        this.registerHandler('session-input', (msg, src) => this.handleSessionInput(msg, src));
        this.registerHandler('session-output', (msg, src) => this.handleSessionOutput(msg, src));
        this.registerHandler('sync-sessions', (msg, src) => this.handleSyncSessions(msg, src));
        this.registerHandler('request-sync', (msg, src) => this.handleRequestSync(msg, src));
        this.registerHandler('typing-indicator', (msg, src) => this.handleTypingIndicator(msg, src));
        this.registerHandler('permission-request', (msg, src) => this.handlePermissionRequest(msg, src));
        this.registerHandler('permission-response', (msg, src) => this.handlePermissionResponse(msg, src));
        this.registerHandler('permission-update', (msg, src) => this.handlePermissionUpdate(msg, src));
        this.registerHandler('owner-disconnect', (msg, src) => this.handleOwnerDisconnect(msg, src));

        // SFTP message handlers for remote SFTP operations
        this.registerHandler('sftp-request', (msg, src) => this.handleSftpRequest(msg, src));
        this.registerHandler('sftp-response', (msg, src) => this.handleSftpResponse(msg, src));
        this.registerHandler('sftp-navigate', (msg, src) => this.handleSftpNavigate(msg, src));

        // File System message handlers (unified file system - local + SFTP)
        this.registerHandler('fs-request', (msg, src) => this.handleFileSystemRequest(msg, src));
        this.registerHandler('fs-response', (msg, src) => this.handleFileSystemResponse(msg, src));

        // Callbacks (set by user)
        this.onSharedSessionAdd = null;      // (sessionId, sessionInfo, sourceAgent) => {}
        this.onSharedSessionRemove = null;   // (sessionId, sourceAgent) => {}
        this.onViewerJoin = null;            // ✅ (sessionId, agentName) => {}
        this.onViewerLeave = null;           // ✅ (sessionId, agentName) => {}
        this.onSessionOutput = null;         // (sessionId, data, sourceAgent) => {}
        this.onSessionInput = null;          // (sessionId, data, sourceAgent) => {}
        this.onTypingIndicator = null;       // (sessionId, agentName, isTyping) => {}
        this.onPermissionRequest = null;     // (sessionId, requester) => {}
        this.onPermissionResponse = null;    // (sessionId, granted, owner) => {}
        this.onPermissionUpdate = null;      // (sessionId, newPermission) => {}
        this.onOwnerDisconnect = null;       // (sessionId, owner) => {}
        this.onConnectionError = null;       // (sessionId, error) => {}
        this.onDisconnect = null;            // (reason) => {} - called when cloud connection is lost
        this.onFileSystemRequest = null;     // (sessionId, operation, params, sourceAgent, requestId) => {}
        this.onFileSystemResponse = null;    // (sessionId, requestId, data, sourceAgent) => {}
    }

    /**
     * Register a message handler for a specific type
     */
    registerHandler(type, handler) {
        this.messageHandlers.set(type, handler);
    }

    /**
     * Override onDataChannelMessage - called when data is received via WebRTC or WebSocket
     * Routes messages to handleMessage for processing
     */
    onDataChannelMessage(sourceAgent, message) {
        const { type } = message;

        console.log('[TerminalSharing] Received:', type, 'from:', sourceAgent);

        // Call registered handler if exists
        const handler = this.messageHandlers.get(type);
        if (handler) {
            handler(message, sourceAgent);
        } else {
            console.log('[TerminalSharing] No handler for type:', type);
        }
    }

    /**
     * ✅ Add a viewer to a session
     * @param {string} sessionId - Session ID
     * @param {string} agentName - Agent viewing the session
     */
    addViewer(sessionId, agentName) {
        if (!this.sessionViewers.has(sessionId)) {
            this.sessionViewers.set(sessionId, new Set());
        }
        this.sessionViewers.get(sessionId).add(agentName);
        console.log('[TerminalSharing] Added viewer:', agentName, 'to session:', sessionId);
    }

    /**
     * ✅ Remove a viewer from a session
     * @param {string} sessionId - Session ID
     * @param {string} agentName - Agent name
     */
    removeViewer(sessionId, agentName) {
        if (this.sessionViewers.has(sessionId)) {
            this.sessionViewers.get(sessionId).delete(agentName);
            if (this.sessionViewers.get(sessionId).size === 0) {
                this.sessionViewers.delete(sessionId);
            }
            console.log('[TerminalSharing] Removed viewer:', agentName, 'from session:', sessionId);
        }
    }

    /**
     * ✅ Remove a viewer from ALL sessions (called when agent disconnects)
     * @param {string} agentName - Agent name
     */
    removeViewerFromAllSessions(agentName) {
        this.sessionViewers.forEach((viewers, sessionId) => {
            if (viewers.has(agentName)) {
                viewers.delete(agentName);
                console.log('[TerminalSharing] Removed disconnected viewer:', agentName, 'from session:', sessionId);
                if (viewers.size === 0) {
                    this.sessionViewers.delete(sessionId);
                }
            }
        });
    }

    /**
     * ✅ Get viewers for a specific session
     * @param {string} sessionId - Session ID
     * @returns {string[]} Array of agent names viewing this session
     */
    getSessionViewers(sessionId) {
        const viewers = this.sessionViewers.get(sessionId);
        return viewers ? Array.from(viewers) : [];
    }

    /**
     * Share a session with all connected agents
     * @param {string} sessionId - Terminal session identifier (from backend)
     * @param {Object} sessionInfo - Session metadata { name, shell, permission, ... }
     * @param {string} sessionInfo.permission - 'readonly' or 'readwrite' (default: 'readonly')
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

        // Default permission is readonly
        const permission = sessionInfo.permission || 'readonly';

        // Add to local shared sessions
        this.sharedSessions.set(sessionId, {
            ...sessionInfo,
            owner: this.username,
            permission: permission
        });

        // Broadcast to all agents using sendData
        this.sendData({
            type: 'session-shared',
            sessionId: sessionId,
            sessionInfo: {
                ...sessionInfo,
                owner: this.username,
                permission: permission
            }
        });

        console.log('[TerminalSharing] Shared session:', sessionId, sessionInfo.name, 'permission:', permission);
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
    handleSessionShared(msg, src) {
        const { sessionId, sessionInfo } = msg;

        // Don't track our own shares
        if (src === this.username) return;

        // Add to remote shared sessions with permission
        this.sharedSessions.set(sessionId, {
            ...sessionInfo,
            owner: src,
            permission: sessionInfo.permission || 'readonly'
        });

        console.log('[TerminalSharing] Remote agent shared session:', sessionId, 'from:', src, 'permission:', sessionInfo.permission);

        // Call callback if registered
        if (typeof this.onSharedSessionAdd === 'function') {
            this.onSharedSessionAdd(sessionId, sessionInfo, src);
        }
    }

    /**
     * Handle session-unshared message
     */
    handleSessionUnshared(msg, src) {
        const { sessionId } = msg;

        // Remove from shared sessions
        this.sharedSessions.delete(sessionId);

        // Remove all viewers for this session
        this.sessionViewers.delete(sessionId);

        console.log('[TerminalSharing] Remote agent unshared session:', sessionId);

        // Call callback if registered
        if (typeof this.onSharedSessionRemove === 'function') {
            this.onSharedSessionRemove(sessionId, src);
        }
    }

    /**
     * ✅ Handle session-viewer-join message
     * Sent by viewer when they open a shared session
     */
    handleSessionViewerJoin(msg, src) {
        const { sessionId } = msg;
        console.log('[TerminalSharing] Viewer joined:', src, 'session:', sessionId);

        // Add viewer to tracking
        this.addViewer(sessionId, src);

        // Notify UI if callback registered (update viewers list)
        if (typeof this.onViewerJoin === 'function') {
            this.onViewerJoin(sessionId, src);
        }
    }

    /**
     * ✅ Handle session-viewer-leave message
     * Sent by viewer when they close a shared session
     */
    handleSessionViewerLeave(msg, src) {
        const { sessionId } = msg;
        console.log('[TerminalSharing] Viewer left:', src, 'session:', sessionId);

        // Remove viewer from tracking
        this.removeViewer(sessionId, src);

        // Notify UI if callback registered (update viewers list)
        if (typeof this.onViewerLeave === 'function') {
            this.onViewerLeave(sessionId, src);
        }
    }

    /**
     * Handle session-input message
     */
    handleSessionInput(msg, src) {
        const { sessionId, data } = msg;

        console.log('[TerminalSharing] Received input for session:', sessionId, 'from:', src);

        // Call callback if registered
        if (typeof this.onSessionInput === 'function') {
            this.onSessionInput(sessionId, data, src);
        }
    }

    /**
     * Handle session-output message
     */
    handleSessionOutput(msg, src) {
        const { sessionId, data } = msg;

        // Call callback if registered
        if (typeof this.onSessionOutput === 'function') {
            this.onSessionOutput(sessionId, data, src);
        }
    }

    /**
     * Handle typing-indicator message
     */
    handleTypingIndicator(msg, src) {
        const { sessionId, isTyping } = msg;

        console.log('[TerminalSharing] Typing indicator from:', src, 'session:', sessionId, 'typing:', isTyping);

        if (typeof this.onTypingIndicator === 'function') {
            this.onTypingIndicator(sessionId, src, isTyping);
        }
    }

    /**
     * Handle permission-request message (viewer wants write access)
     */
    handlePermissionRequest(msg, src) {
        const { sessionId } = msg;

        console.log('[TerminalSharing] Permission request from:', src, 'for session:', sessionId);

        // Store the pending request
        this.pendingPermissionRequests.set(sessionId, {
            requester: src,
            timestamp: Date.now()
        });

        if (typeof this.onPermissionRequest === 'function') {
            this.onPermissionRequest(sessionId, src);
        }
    }

    /**
     * Handle permission-response message (owner grants/denies)
     */
    handlePermissionResponse(msg, src) {
        const { sessionId, granted, newPermission } = msg;

        console.log('[TerminalSharing] Permission response from:', src, 'session:', sessionId, 'granted:', granted);

        // Update local session permission if granted
        if (granted && this.sharedSessions.has(sessionId)) {
            const session = this.sharedSessions.get(sessionId);
            session.permission = newPermission || 'readwrite';
        }

        if (typeof this.onPermissionResponse === 'function') {
            this.onPermissionResponse(sessionId, granted, src);
        }
    }

    /**
     * Handle permission-update message (owner changed permission)
     */
    handlePermissionUpdate(msg, src) {
        const { sessionId, permission } = msg;

        console.log('[TerminalSharing] Permission update from:', src, 'session:', sessionId, 'new permission:', permission);

        // Update local session permission
        if (this.sharedSessions.has(sessionId)) {
            const session = this.sharedSessions.get(sessionId);
            session.permission = permission;
        }

        if (typeof this.onPermissionUpdate === 'function') {
            this.onPermissionUpdate(sessionId, permission);
        }
    }

    /**
     * Handle owner-disconnect message (owner closed the session)
     */
    handleOwnerDisconnect(msg, src) {
        const { sessionId } = msg;

        console.log('[TerminalSharing] Owner disconnect from:', src, 'session:', sessionId);

        // Remove the session from our map
        this.sharedSessions.delete(sessionId);

        if (typeof this.onOwnerDisconnect === 'function') {
            this.onOwnerDisconnect(sessionId, src);
        }
    }

    /**
     * Send typing indicator
     * @param {string} sessionId - Session to indicate typing on
     * @param {boolean} isTyping - True if typing, false if stopped
     */
    sendTypingIndicator(sessionId, isTyping) {
        if (!this.connected) return;

        this.sendData({
            type: 'typing-indicator',
            sessionId: sessionId,
            isTyping: isTyping
        });
    }

    /**
     * Request write permission for a session
     * @param {string} sessionId - Session to request permission for
     */
    requestWritePermission(sessionId) {
        if (!this.connected) return false;

        const session = this.sharedSessions.get(sessionId);
        if (!session || !session.owner) {
            console.warn('[TerminalSharing] Cannot request permission - session not found');
            return false;
        }

        this.sendData({
            type: 'permission-request',
            sessionId: sessionId
        }, session.owner);

        console.log('[TerminalSharing] Requested write permission for:', sessionId);
        return true;
    }

    /**
     * Respond to permission request (as owner)
     * @param {string} sessionId - Session the request is for
     * @param {boolean} granted - True to grant, false to deny
     * @param {string} requester - Agent who requested
     */
    respondToPermissionRequest(sessionId, granted, requester) {
        if (!this.connected) return;

        const newPermission = granted ? 'readwrite' : 'readonly';

        // Update local session
        if (granted && this.sharedSessions.has(sessionId)) {
            const session = this.sharedSessions.get(sessionId);
            session.permission = newPermission;
        }

        // Clear pending request
        this.pendingPermissionRequests.delete(sessionId);

        // Send response to requester
        this.sendData({
            type: 'permission-response',
            sessionId: sessionId,
            granted: granted,
            newPermission: newPermission
        }, requester);

        // If granted, broadcast update to all
        if (granted) {
            this.sendData({
                type: 'permission-update',
                sessionId: sessionId,
                permission: newPermission
            });
        }

        console.log('[TerminalSharing] Responded to permission request:', sessionId, 'granted:', granted);
    }

    /**
     * Update session permission (as owner)
     * @param {string} sessionId - Session to update
     * @param {string} permission - 'readonly' or 'readwrite'
     */
    updateSessionPermission(sessionId, permission) {
        if (!this.connected) return false;

        if (!this.sharedSessions.has(sessionId)) return false;

        const session = this.sharedSessions.get(sessionId);
        if (session.owner !== this.username) {
            console.warn('[TerminalSharing] Cannot update permission - not the owner');
            return false;
        }

        session.permission = permission;

        // Broadcast update to all agents
        this.sendData({
            type: 'permission-update',
            sessionId: sessionId,
            permission: permission
        });

        console.log('[TerminalSharing] Updated session permission:', sessionId, 'to:', permission);
        return true;
    }

    /**
     * Notify viewers that owner is disconnecting/closing a session
     * @param {string} sessionId - Session being closed
     */
    notifyOwnerDisconnect(sessionId) {
        if (!this.connected) return;

        this.sendData({
            type: 'owner-disconnect',
            sessionId: sessionId
        });

        console.log('[TerminalSharing] Notified owner disconnect for:', sessionId);
    }

    /**
     * Get session permission
     * @param {string} sessionId - Session identifier
     * @returns {string} 'readonly' or 'readwrite'
     */
    getSessionPermission(sessionId) {
        const session = this.sharedSessions.get(sessionId);
        return session?.permission || 'readonly';
    }

    /**
     * Check if we have write permission for a session
     * @param {string} sessionId - Session identifier
     * @returns {boolean} True if we have write permission
     */
    hasWritePermission(sessionId) {
        return this.getSessionPermission(sessionId) === 'readwrite';
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
     * Override onStart - called when connection is established
     */
    onStart() {
        console.log('[TerminalSharing] Connected and ready');


        // Request sync from existing agents
        this.requestSyncFromPeers();
    }

    /**
     * Override onUserJoin - called when a new agent joins
     * Send all our shared sessions to the new agent
     */
    onUserJoin(event) {
        const { agentName } = event;
        console.log('[TerminalSharing] New agent joined:', agentName);

        // Send all our shared sessions to the new agent
        this.sendSharedSessionsToAgent(agentName);
    }

    /**
     * Send all our shared sessions to a specific agent
     */
    sendSharedSessionsToAgent(targetAgent) {
        console.log('[TerminalSharing] sendSharedSessionsToAgent called for:', targetAgent);
        console.log('[TerminalSharing] All shared sessions:', Array.from(this.sharedSessions.keys()));
        console.log('[TerminalSharing] Our username:', this.username);

        const ourSessions = this.getOurSharedSessions();
        console.log('[TerminalSharing] Our shared sessions count:', ourSessions.length);

        if (ourSessions.length === 0) {
            console.log('[TerminalSharing] No sessions to sync to', targetAgent);
            return;
        }

        console.log('[TerminalSharing] Sending', ourSessions.length, 'shared sessions to', targetAgent);
        console.log('[TerminalSharing] Sessions being sent:', ourSessions.map(s => ({ id: s.sessionId, name: s.name, owner: s.owner })));

        this.sendData({
            type: 'sync-sessions',
            sessions: ourSessions.map(session => ({
                sessionId: session.sessionId,
                sessionInfo: {
                    name: session.name,
                    shell: session.shell,
                    type: session.type,
                    owner: this.username,
                    permission: session.permission || 'readonly'
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
    handleRequestSync(msg, src) {
        console.log('[TerminalSharing] Received sync request from:', src);
        this.sendSharedSessionsToAgent(src);
    }

    /**
     * Handle sync-sessions message - receive multiple shared sessions at once
     */
    handleSyncSessions(msg, src) {
        const { sessions } = msg;
        if (!sessions || !Array.isArray(sessions)) return;

        console.log('[TerminalSharing] Received', sessions.length, 'sessions from:', src);

        sessions.forEach(({ sessionId, sessionInfo }) => {
            // Don't track our own sessions
            if (src === this.username) return;

            // Add to shared sessions if not already present
            if (!this.sharedSessions.has(sessionId)) {
                this.sharedSessions.set(sessionId, {
                    ...sessionInfo,
                    owner: src,
                    permission: sessionInfo.permission || 'readonly'
                });

                // Fire callback for each new session
                if (typeof this.onSharedSessionAdd === 'function') {
                    this.onSharedSessionAdd(sessionId, sessionInfo, src);
                }
            }
        });
    }

    /**
     * Override onStop - called when disconnecting
     * Broadcasts owner-disconnect for all our sessions before clearing
     */
    onStop() {
        // Broadcast owner-disconnect for all our sessions before unsharing
        const ourSessions = Array.from(this.sharedSessions.keys());
        ourSessions.forEach(sessionId => {
            const session = this.sharedSessions.get(sessionId);
            if (session && session.owner === this.username) {
                // Notify viewers that owner is leaving
                try {
                    this.notifyOwnerDisconnect(sessionId);
                } catch(e) {
                    console.warn('[TerminalSharing] Failed to notify disconnect for:', sessionId, e);
                }
                this.unshareSession(sessionId);
            }
        });

        this.sharedSessions.clear();
        console.log('[TerminalSharing] Stopped');

        // Fire onDisconnect callback for the UI to handle
        if (typeof this.onDisconnect === 'function') {
            this.onDisconnect();
        }
    }

    /**
     * Override onConnectionLost - called when WebRTC/WebSocket connection drops unexpectedly
     * This is different from intentional disconnect (onStop)
     */
    onConnectionLost(reason) {
        console.warn('[TerminalSharing] Connection lost:', reason);

        // Fire onDisconnect callback
        if (typeof this.onDisconnect === 'function') {
            this.onDisconnect(reason);
        }
    }

    // ========================================
    // SFTP Remote Operations
    // ========================================

    /**
     * Send SFTP request to session owner
     * Used by viewers to request SFTP operations on the owner's session
     */
    sendSftpRequest(sessionId, operation, params, requestId) {
        const sessionInfo = this.sharedSessions.get(sessionId);
        if (!sessionInfo || !sessionInfo.owner) {
            console.error('[TerminalSharing] Cannot send SFTP request - session not found or no owner');
            return;
        }

        const owner = sessionInfo.owner;
        console.log(`[TerminalSharing] Sending SFTP request to ${owner}:`, operation, params);

        this.sendData({
            type: 'sftp-request',
            sessionId: sessionId,
            operation: operation,
            params: params,
            requestId: requestId
        }, owner);
    }

    /**
     * Handle incoming SFTP request (owner receives this from viewers)
     */
    async handleSftpRequest(msg, src) {
        console.log('[TerminalSharing] Received SFTP request from:', src, msg);

        const { sessionId, operation, params, requestId } = msg;

        // Verify this is our session
        const sessionInfo = this.sharedSessions.get(sessionId);
        if (!sessionInfo || sessionInfo.owner !== this.username) {
            console.error('[TerminalSharing] SFTP request for session we don\'t own');
            this.sendSftpResponse(sessionId, requestId, { error: 'Unauthorized' }, src);
            return;
        }

        // Check permission
        const permission = sessionInfo.agentPermissions?.[src] || sessionInfo.permission || 'readonly';
        if (permission === 'readonly' && ['upload', 'delete', 'rename', 'mkdir'].includes(operation)) {
            console.warn('[TerminalSharing] SFTP write operation denied - readonly permission');
            this.sendSftpResponse(sessionId, requestId, { error: 'Permission denied' }, src);
            return;
        }

        try {
            // Execute SFTP operation via local SLS
            const response = await this.executeSftpOperation(sessionId, operation, params);
            this.sendSftpResponse(sessionId, requestId, response, src);
        } catch (error) {
            console.error('[TerminalSharing] SFTP operation failed:', error);
            this.sendSftpResponse(sessionId, requestId, { error: error.message }, src);
        }
    }

    /**
     * Execute SFTP operation locally (called by session owner)
     * NEW LOGIC: Use auto-created SFTP session (created when SSH connects)
     */
    async executeSftpOperation(sessionId, operation, params) {
        console.log('[TerminalSharing] Executing SFTP operation:', operation, params);

        const MLS_URL = window.MLS_URL || `http://localhost:${window.SLS_PORT || 8088}`;

        // Use the auto-created SFTP session
        const sftpSessionId = `sftp-${sessionId}`;

        try {
            // Execute the requested operation using the SFTP session
            switch (operation) {
                case 'list':
                    // List directory
                    let listResponse = await fetch(`${MLS_URL}/sftp/${sftpSessionId}/list`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: params.path || '/' })
                    });

                    // If session not found, try to recreate it
                    if (!listResponse.ok && (listResponse.status === 404 || listResponse.status === 500)) {
                        console.warn('[TerminalSharing] SFTP session error - attempting refresh');
                        if (window.createSftpSessionForSsh) {
                            await window.createSftpSessionForSsh(sessionId);
                            // Retry
                            listResponse = await fetch(`${MLS_URL}/sftp/${sftpSessionId}/list`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ path: params.path || '/' })
                            });
                        }
                    }

                    if (!listResponse.ok) {
                        throw new Error(`SFTP list failed: ${listResponse.statusText}`);
                    }

                    const listResult = await listResponse.json();

                    // ✅ Share navigation state with all viewers
                    this.shareSftpNavigation(sessionId, params.path || '/', listResult.files || []);

                    return listResult;

                case 'download':
                    const downloadResponse = await fetch(`${MLS_URL}/sftp/${sftpSessionId}/download`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: params.path })
                    });
                    if (!downloadResponse.ok) {
                        throw new Error(`SFTP download failed: ${downloadResponse.statusText}`);
                    }
                    return await downloadResponse.json();

                case 'upload':
                    const uploadResponse = await fetch(`${MLS_URL}/sftp/${sftpSessionId}/upload`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: params.path,
                            content: params.content
                        })
                    });
                    if (!uploadResponse.ok) {
                        throw new Error(`SFTP upload failed: ${uploadResponse.statusText}`);
                    }
                    return await uploadResponse.json();

                case 'delete':
                    const deleteResponse = await fetch(`${MLS_URL}/sftp/${sftpSessionId}/delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: params.path })
                    });
                    if (!deleteResponse.ok) {
                        throw new Error(`SFTP delete failed: ${deleteResponse.statusText}`);
                    }
                    return await deleteResponse.json();

                case 'rename':
                    const renameResponse = await fetch(`${MLS_URL}/sftp/${sftpSessionId}/rename`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            oldPath: params.oldPath,
                            newPath: params.newPath
                        })
                    });
                    if (!renameResponse.ok) {
                        throw new Error(`SFTP rename failed: ${renameResponse.statusText}`);
                    }
                    return await renameResponse.json();

                case 'mkdir':
                    const mkdirResponse = await fetch(`${MLS_URL}/sftp/${sftpSessionId}/mkdir`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: params.path })
                    });
                    if (!mkdirResponse.ok) {
                        throw new Error(`SFTP mkdir failed: ${mkdirResponse.statusText}`);
                    }
                    return await mkdirResponse.json();

                default:
                    throw new Error(`Unknown SFTP operation: ${operation}`);
            }
        } catch (error) {
            console.error('[TerminalSharing] SFTP operation error:', error);
            throw error;
        }
    }

    /**
     * Send SFTP response back to requester
     */
    sendSftpResponse(sessionId, requestId, data, targetAgent) {
        console.log(`[TerminalSharing] Sending SFTP response to ${targetAgent}:`, requestId);

        this.sendData({
            type: 'sftp-response',
            sessionId: sessionId,
            requestId: requestId,
            data: data
        }, targetAgent);
    }

    /**
     * Handle incoming SFTP response (viewer receives this from owner)
     */
    handleSftpResponse(msg, src) {
        console.log('[TerminalSharing] Received SFTP response from:', src, msg);

        const { requestId, data } = msg;

        // TODO: SFTP remote sharing not implemented yet
        // File Explorer doesn't have handleRemoteResponse method
        console.warn('[TerminalSharing] SFTP response received but File Explorer remote operations not implemented');
    }

    // ========================================
    // SFTP Navigation Sharing (NEW)
    // ========================================

    /**
     * Share SFTP navigation state with all viewers
     * Called when owner navigates to a different directory
     */
    shareSftpNavigation(sessionId, path, files) {
        console.log(`[TerminalSharing] Sharing SFTP navigation for session ${sessionId}:`, path);

        // Broadcast to all connected agents
        this.sendData({
            type: 'sftp-navigate',
            sessionId: sessionId,
            path: path,
            files: files,
            timestamp: Date.now()
        }); // No target = broadcast to all
    }

    /**
     * Handle incoming SFTP navigation update
     * Viewers receive this when owner navigates
     */
    handleSftpNavigate(msg, src) {
        console.log('[TerminalSharing] Received SFTP navigation from:', src, msg);

        const { sessionId, path, files } = msg;

        // Check if this is a shared session we're viewing
        const sessionInfo = this.sharedSessions.get(sessionId);
        if (!sessionInfo || sessionInfo.owner === this.username) {
            // Ignore if it's our own session or session not found
            console.log('[TerminalSharing] Ignoring SFTP navigate - not viewing this session or it\'s our own');
            return;
        }

        // TODO: SFTP navigation sharing not implemented yet
        // File Explorer doesn't have updateNavigationState method
        console.log('[TerminalSharing] SFTP navigation received but File Explorer sync not implemented');
    }

    // ========================================
    // FILE SYSTEM SHARING (Unified - Local + SFTP)
    // ========================================

    /**
     * Send file system request to owner (viewer → owner)
     * @param {string} sessionId - Terminal session ID
     * @param {string} operation - Operation name (list, read, write, etc.)
     * @param {object} params - Operation parameters
     * @param {string} targetAgent - Owner agent name
     * @param {string} requestId - Unique request identifier
     */
    sendFileSystemRequest(sessionId, operation, params, targetAgent, requestId) {
        if (!this.connected) {
            console.warn('[TerminalSharing] Not connected, cannot send file system request');
            return false;
        }

        const message = {
            type: 'fs-request',
            sessionId,
            operation,
            params,
            requestId
        };

        console.log('[TerminalSharing] Sending FS request:', operation, 'to:', targetAgent, 'requestId:', requestId);
        this.sendData(message, targetAgent);
        return true;
    }

    /**
     * Send file system response to viewer (owner → viewer)
     * @param {string} sessionId - Terminal session ID
     * @param {string} requestId - Request identifier to match
     * @param {object} data - Response data
     * @param {string} targetAgent - Viewer agent name
     */
    sendFileSystemResponse(sessionId, requestId, data, targetAgent) {
        if (!this.connected) {
            console.warn('[TerminalSharing] Not connected, cannot send file system response');
            return false;
        }

        const message = {
            type: 'fs-response',
            sessionId,
            requestId,
            data
        };

        console.log('[TerminalSharing] Sending FS response to:', targetAgent, 'requestId:', requestId);
        this.sendData(message, targetAgent);
        return true;
    }

    /**
     * Handle incoming file system request (owner receives from viewer)
     */
    handleFileSystemRequest(msg, src) {
        console.log('[TerminalSharing] Received FS request from:', src, msg);

        const { sessionId, operation, params, requestId } = msg;

        // Call user-defined callback
        if (this.onFileSystemRequest) {
            this.onFileSystemRequest(sessionId, operation, params, src, requestId);
        } else {
            console.warn('[TerminalSharing] No onFileSystemRequest handler defined');
        }
    }

    /**
     * Handle incoming file system response (viewer receives from owner)
     */
    handleFileSystemResponse(msg, src) {
        console.log('[TerminalSharing] Received FS response from:', src, msg);

        const { sessionId, requestId, data } = msg;

        // Call user-defined callback
        if (this.onFileSystemResponse) {
            this.onFileSystemResponse(sessionId, requestId, data, src);
        } else {
            console.warn('[TerminalSharing] No onFileSystemResponse handler defined');
        }
    }
}

// Export to global scope
window.TerminalSharing = TerminalSharing;

