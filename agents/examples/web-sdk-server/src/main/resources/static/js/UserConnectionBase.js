/**
 * UserConnectionBase - Abstract base class for real-time multi-user applications
 * Provides common functionality for games, file sharing, collaboration tools, and more
 *
 * Features:
 * - Real-time messaging via WebSocket
 * - Peer-to-peer data channels via WebRTC
 * - Host migration and session management
 * - User/agent management
 * - Pause/resume support
 * - State synchronization
 *
 * This class is generic and can be extended for any real-time interactive application:
 * - Games (air hockey, quiz battle, reactor, fall guys, etc.)
 * - File sharing (QuickShare)
 * - Collaboration tools (whiteboard, terminal sharing)
 * - Chat applications
 * - Any multi-user real-time interaction
 *
 * @class UserConnectionBase
 * @abstract
 */
class UserConnectionBase {
    constructor(options = {}) {
        if (this.constructor === UserConnectionBase) {
            throw new Error('UserConnectionBase is abstract and cannot be instantiated directly');
        }

        this.options = {
            storagePrefix: 'session',
            customType: 'session',
            usePubKey: false,
            autoCreateDataChannel: true,  // Automatically create DataChannel on peer join
            useHostMode: true,             // Use host-based relay (star topology)

            // Relay Mode Configuration
            // Modes: 'p2p-mesh' | 'p2p-host' | 'websocket-relay' | 'datachannel-server' | 'sfu-media'
            relayMode: 'p2p-host',         // Default: P2P with host-based routing
            relayEnabled: false,           // Enable server relay mode (websocket/datachannel/sfu)

            dataChannelName: 'peer-data',
            // Reliable and ordered by DEFAULT.
            //
            // The default used to be fire-and-forget, and drop (file chunks!),
            // chess, collab-doc and mind-map never overrode it — so a dropped
            // packet meant a corrupt file or a lost move with nothing to notice
            // it. The apps that genuinely want lossy — whiteboard strokes,
            // pictionary strokes, pixel-art cursors — already pass their own
            // options, so making the safe case the default costs them nothing.
            dataChannelOptions: {
                ordered: true
            },
            enableHostIndicator: true,           // Show host indicator in UI (subclass must implement updateHostIndicator)

            // Noticing a peer that vanished without a disconnect. See
            // _startRosterReconcile: a crashed tab sends no beacon, and a
            // server-side session expiry publishes no event.
            rosterReconcile: true,
            // A fallback, not the mechanism. The server now announces an agent
            // whose session expired (PresenceSweepService), so a room normally
            // hears about a vanished peer through the ordinary disconnect
            // event. This still runs, because it costs one request every two
            // minutes and it repairs a roster that has drifted for any reason
            // — an older server without the sweep, or an event that was missed.
            rosterReconcileIntervalMs: 120000,

            // Coming back after the connection drops. See _beginReconnect.
            autoReconnect: true,
            reconnectMaxAttempts: 8,
            reconnectBaseDelayMs: 1000,
            reconnectMaxDelayMs: 15000,
            ...options
        };

        // Simple structure like legacy code
        this.channel = null;           // AgentConnection instance
        this.webrtcHelper = null;      // WebRtcHelper instance
        this.username = '';
        this.channelName = '';
        this.channelPassword = '';
        this.connected = false;
        this.connecting = false;       // Prevent duplicate connection requests
        this.reconnecting = false;     // A rejoin is in flight
        this._userDisconnected = false;// They left on purpose; do not drag them back
        this._reconnectAttempt = 0;
        this._deadSessionId = null;    // The session the server still thinks is alive
        this._watchingNetwork = false;

        // Relay mode tracking
        this.relayMode = this.options.relayMode || 'p2p-host';
        this.relayEnabled = this.options.relayEnabled || false;

        // Auto-set useHostMode based on relayMode
        if (this.relayMode === 'p2p-host') {
            this.options.useHostMode = true;
        } else if (this.relayMode === 'p2p-mesh') {
            this.options.useHostMode = false;
        }

        // No need for this.users - use channel.connectedAgents via getConnectedUsers() instead

        // Host tracking for automatic host switching
        this.wasHost = false;          // Track previous host status

        // Host mode tracking
        this.hostMigrationInProgress = false;  // Prevent duplicate host migration
        this.pendingHostConnections = new Set(); // Track pending connections during migration

        // Session pause state (for host migration, connection issues, etc.)
        this.sessionPaused = false;
        this.pauseReason = null;

        // Pause/Resume support flag (some apps like whiteboard don't support pause)
        this.supportsPauseResume = this.options.supportsPauseResume !== false; // Default true

        this.isInitialized = false;
        this.isRunning = false;

        // Event emitter for custom events
        this.eventHandlers = new Map();

        console.log('Created UserConnectionBase instance with options:', this.options);
    }

    // =========================================================================
    // Event Emitter Methods
    // =========================================================================

    /**
     * Subscribe to an event
     * @param {string} eventName - Event name to listen for
     * @param {Function} handler - Callback function
     */
    on(eventName, handler) {
        if (!this.eventHandlers.has(eventName)) {
            this.eventHandlers.set(eventName, []);
        }
        this.eventHandlers.get(eventName).push(handler);
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventName - Event name
     * @param {Function} handler - Handler to remove (optional, removes all if not specified)
     */
    off(eventName, handler) {
        if (!this.eventHandlers.has(eventName)) return;

        if (handler) {
            const handlers = this.eventHandlers.get(eventName);
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        } else {
            this.eventHandlers.delete(eventName);
        }
    }

    /**
     * Emit an event to all subscribers
     * @param {string} eventName - Event name
     * @param {...any} args - Arguments to pass to handlers
     */
    emit(eventName, ...args) {
        if (!this.eventHandlers.has(eventName)) return;

        const handlers = this.eventHandlers.get(eventName);
        for (const handler of handlers) {
            try {
                handler(...args);
            } catch (error) {
                console.error(`[UserConnectionBase] Error in event handler for '${eventName}':`, error);
            }
        }
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    /**
     * Initialize the game
     */
    async initialize() {
        if (this.isInitialized) return;

        console.log('[UserConnectionBase] Initializing...');

        // Auto-connect disabled - users must click Connect button manually
        // (Previously enabled auto-connect for shared links)

        // Call subclass initialization
        if (typeof this.onInitialize === 'function') {
            await this.onInitialize();
        }

        this.isInitialized = true;
        console.log('[UserConnectionBase] Initialized');
    }

    /**
     * Connect to game channel - same as legacy code
     */
    async connect(credentials) {
        const { username, channelName, channelPassword } = credentials;

        // CRITICAL: Cancel auto-connect timer to prevent duplicate connection
        if (window.MiniGameUtils && typeof window.MiniGameUtils._cancelAutoConnect === 'function') {
            window.MiniGameUtils._cancelAutoConnect();
            console.log('[UserConnectionBase] Auto-connect canceled - manual connection started');
        }

        // GUARD: Prevent duplicate connection requests
        if (this.connected) {
            console.warn('[UserConnectionBase] Already connected, ignoring duplicate connect request');
            return;
        }

        if (this.connecting) {
            console.warn('[UserConnectionBase] Connection in progress, ignoring duplicate connect request');
            return;
        }

        if (!username || !channelName) {
            throw new Error('Username and channel name required');
        }

        // Set connecting flag
        this.connecting = true;
        this._userDisconnected = false;
        this._watchNetwork();

        try {
            this.username = username;
            this.channelName = channelName;
            this.channelPassword = channelPassword || '';

            // Get config
            console.log('[UserConnectionBase] Requesting API key...');
            const response = await window.fetchAppConfig(300, false);
            const config = response?.data || response;
            const apiKey = config?.apiKey || null;
            const apiUrl = config?.messagingServiceUrl || config?.messagingApiUrl || null;

            if (!apiUrl) {
                throw new Error('No messagingServiceUrl in config');
            }

            console.log('[UserConnectionBase] Using API URL:', apiUrl);

            // Create connection (same as legacy)
            this.channel = new AgentConnection();

            // Initialize WebRTC helper for DataChannels (same as legacy)
            if (typeof WebRtcHelper !== 'undefined') {
                this.webrtcHelper = new WebRtcHelper(this.channel);
                this._setupWebRtcEvents();
                // A reconnect builds a new helper, so anything a subclass
                // listens for has to be attached here rather than once after
                // the first connect — otherwise the app comes back deaf.
                if (typeof this.onWebrtcHelperReady === 'function') {
                    this.onWebrtcHelperReady(this.webrtcHelper);
                }
            }

            // Setup event listeners
            this._setupChannelEvents();

            // Connect
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Connection timeout')), 8000);

                this.channel.addEventListener('connect', (ev) => {
                    clearTimeout(timeout);
                    const resp = ev.response || {};

                    if (resp.status === 'error') {
                        reject(new Error(resp.statusMessage || 'Connection failed'));
                    } else {
                        this.connected = true;
                        this.connecting = false; // Clear flag on success
                        resolve();
                    }
                });

                // Actually connect
                this.channel.connect({
                    api: apiUrl,
                    apiKey: apiKey,
                    channelName,
                    channelPassword,
                    agentName: username,
                    autoReceive: true,
                    // TRUE = use stored offset (latest) = NEW messages only
                    // not needed anymore since webrtc are ephemeral messages
                    useInitialReceiveConfig: true,
                });
            });

            // The shared helpers in common-utils.js — the agents badge, the
            // agents modal, the disconnect button — look for the live channel
            // at window.channel, because they predate this class. Only chat.html
            // ever set it, so in every app built on this base the agents badge
            // sat at 0 for ever while the list beside it showed people. One
            // line, and they all start working.
            window.channel = this.channel;
            this._syncAgentsBadge();

            console.log('[UserConnectionBase] Connected');

            // Setup automatic cleanup on page unload
            this._setupCleanupOnUnload();
            this._startRosterReconcile();
        } catch (error) {
            // Reset connecting flag on error
            this.connecting = false;
            throw error;
        }
    }

    /**
     * Keep the shared agents badge in step with the roster.
     *
     * common-utils draws that badge and fills it from channel events it
     * subscribes to when it first notices window.channel — which is after the
     * connect event has been and gone, so it never heard the first one and the
     * badge sat at 0 beside a list with people in it. This class knows the
     * roster first-hand, so it says so directly, on joining and on every
     * arrival and departure.
     *
     * @private
     */
    _syncAgentsBadge() {
        try {
            if (window.MiniGameUtils && typeof MiniGameUtils.setAgentsCount === 'function') {
                MiniGameUtils.setAgentsCount(this.getUserCount());
            }
        } catch (e) { /* the badge is decoration; never let it break a join */ }
    }

    /**
     * Setup automatic cleanup when page is unloaded
     * @private
     */
    _setupCleanupOnUnload() {
        if (typeof MiniGameUtils !== 'undefined' && typeof MiniGameUtils.setupCleanupOnUnload === 'function') {
            MiniGameUtils.setupCleanupOnUnload(() => this.channel, this.options.customType || 'Game');
            console.log(`[UserConnectionBase] Cleanup on unload registered for ${this.options.customType}`);
        } else {
            console.warn('[UserConnectionBase] MiniGameUtils not loaded, cleanup may not work properly');
        }
    }

    /**
     * Start the game
     */
    start() {
        if (!this.connected) {
            throw new Error('Must be connected before starting game');
        }

        if (this.isRunning) {
            console.warn('[UserConnectionBase] Already running');
            return;
        }

        console.log('[UserConnectionBase] Starting...');
        this.isRunning = true;

        // Call subclass start
        if (typeof this.onStart === 'function') {
            this.onStart();
        }

        console.log('[UserConnectionBase] Started');
    }

    /**
     * Stop the game
     */
    stop() {
        if (!this.isRunning) return;

        console.log('[UserConnectionBase] Stopping...');
        this.isRunning = false;

        // Call subclass stop
        if (typeof this.onStop === 'function') {
            this.onStop();
        }

        console.log('[UserConnectionBase] Stopped');
    }

    /**
     * Disconnect from game
     */
    disconnect() {
        this.stop();
        this._stopRosterReconcile();

        // Leaving on purpose. Everything below this line exists to tell the
        // difference between that and the floor giving way.
        this._userDisconnected = true;
        this.reconnecting = false;
        this._reconnectAttempt = 0;
        clearTimeout(this._reconnectTimer);

        if (this.channel) {
            this.channel.disconnect();
        }

        this.connected = false;
        if (window.channel === this.channel) window.channel = null;
        console.log('[UserConnectionBase] Disconnected');
    }

    /* ====================================================================
     * Coming back
     *
     * The socket underneath tries a few times on its own and then, until
     * recently, stopped without a word — leaving the page showing "connected"
     * for a session that no longer existed. It now says so, and this is what
     * listens.
     *
     * A reconnect here is a fresh join, not a resumed session. That is the
     * whole trick: peers see an ordinary leave and an ordinary arrival, and
     * every app's existing sync-on-join path is the recovery mechanism. No new
     * message crosses the wire, no offsets are replayed, nothing has to agree
     * on anything new. What was said during the outage is gone, and the apps
     * that care already re-sync state on join.
     * ==================================================================== */

    /**
     * The two moments worth trying again on, neither of which is a timer:
     * the network coming back, and the tab being looked at again. A phone that
     * backgrounded the tab is the common case, and its timers are throttled
     * while it is away, so the attempt counter starts afresh here.
     */
    _watchNetwork() {
        if (this._watchingNetwork || typeof window === 'undefined') return;
        this._watchingNetwork = true;

        const wake = (why) => {
            if (this.connected || this._userDisconnected || !this.options.autoReconnect) return;
            // Deliberately not guarded on this.channel: _rejoin() tears the old
            // one down before building a new one, so a failed attempt leaves it
            // null — and guarding on it here meant that once the ladder of
            // attempts ran out while the network was down, coming back online
            // could never start another one. What matters is that we know which
            // room to return to.
            if (!this.username || !this.channelName) return;
            console.log('[UserConnectionBase] ' + why + ' — trying to rejoin now');
            this._reconnectAttempt = 0;
            clearTimeout(this._reconnectTimer);
            this.reconnecting = false;
            this._beginReconnect(why);
        };

        window.addEventListener('online', () => wake('network came back'));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') wake('tab is visible again');
        });
        window.addEventListener('pagehide', () => { this._userDisconnected = true; });
    }

    /**
     * Rejoin, with a widening gap between tries.
     *
     * The gap is jittered because twenty-three tabs that all lost the same
     * server would otherwise come back at the same instant and knock it over
     * again.
     */
    async _beginReconnect(reason) {
        if (!this.options.autoReconnect) return;
        // Deliberately not guarded on `connected`: at the moment the floor
        // gives way the flag still says true, and that is the state this
        // exists to correct.
        if (this.reconnecting || this._userDisconnected) return;
        if (!this.username || !this.channelName) return;

        this.reconnecting = true;
        this._deadSessionId = this._deadSessionId
            || (this.channel && this.channel.sessionId) || null;

        // The app renders its disconnected state — honestly, rather than
        // pretending the room is still there.
        if (this.connected !== false) {
            this.connected = false;
            if (typeof this.onDisconnect === 'function') {
                try { this.onDisconnect({ reason: reason }); } catch (e) { console.warn(e); }
            }
        }

        while (this._reconnectAttempt < this.options.reconnectMaxAttempts) {
            if (this._userDisconnected) { this.reconnecting = false; return; }
            this._reconnectAttempt++;

            const step = Math.min(
                this.options.reconnectMaxDelayMs,
                this.options.reconnectBaseDelayMs * Math.pow(2, this._reconnectAttempt - 1)
            );
            const wait = Math.round(step * (0.5 + Math.random() / 2));

            if (typeof this.onReconnecting === 'function') {
                try { this.onReconnecting(this._reconnectAttempt, wait, reason); } catch (e) { console.warn(e); }
            }

            await new Promise((r) => { this._reconnectTimer = setTimeout(r, wait); });
            if (this._userDisconnected) { this.reconnecting = false; return; }

            try {
                await this._rejoin();
                this.reconnecting = false;
                this._reconnectAttempt = 0;
                this._deadSessionId = null;
                console.log('[UserConnectionBase] Back in ' + this.channelName);
                if (typeof this.onReconnected === 'function') {
                    try { this.onReconnected(); } catch (e) { console.warn(e); }
                }
                return;
            } catch (err) {
                const why = (err && err.message) || String(err);
                if (this._isTerminal(why)) {
                    console.error('[UserConnectionBase] Cannot rejoin:', why);
                    break;
                }
                console.warn('[UserConnectionBase] Rejoin attempt '
                    + this._reconnectAttempt + ' failed:', why);
            }
        }

        this.reconnecting = false;
        if (typeof this.onReconnectFailed === 'function') {
            try { this.onReconnectFailed(); } catch (e) { console.warn(e); }
        }
    }

    /**
     * A refusal worth stopping for.
     *
     * "That name is in use" is not one of them: it usually means the server is
     * still holding the session we just lost, and it will let go. A password
     * the channel no longer accepts is — trying again for ever cannot fix it.
     */
    _isTerminal(message) {
        return /password|unauthor|forbidden|not allowed|invalid channel/i.test(message || '');
    }

    /** One attempt: put down what is left of the old session, then join. */
    async _rejoin() {
        // Peer connections belong to the session that just died. Left alone
        // they pile up one set per outage.
        try {
            if (this.webrtcHelper && this.webrtcHelper.closeAllStreams) {
                this.webrtcHelper.closeAllStreams();
            }
        } catch (e) { /* it is already gone */ }

        // Tell the server the old session is finished, so it does not sit
        // there holding the name we are about to ask for again.
        try {
            if (this.channel && this.channel.disconnect) this.channel.disconnect();
        } catch (e) { /* best effort */ }

        this.channel = null;
        this.webrtcHelper = null;
        this.connected = false;
        this.connecting = false;

        await this.connect({
            username: this.username,
            channelName: this.channelName,
            channelPassword: this.channelPassword
        });
    }

    /**
     * Send message to channel
     */
    sendCustomEventMessage(content, to = '*') {
        if (!this.connected || !this.channel) {
            throw new Error('Not connected');
        }

        return new Promise((resolve, reject) => {
            this.channel.sendMessage({
                content: typeof content === 'string' ? content : JSON.stringify(content),
                to: to,
                type: 'CUSTOM',
                customType: this.options.customType
            }, (response) => {
                if (response.status === 'success') {
                    resolve(response);
                } else {
                    reject(new Error(response.statusMessage || 'Failed to send'));
                }
            });
        });
    }

    /**
     * Who actually sent this — the transport's word, never the payload's.
     *
     * Apps routinely read data.by / data.username / data.playerName, which the
     * sender chose and can therefore lie about: a peer could vote as somebody
     * else, resign somebody else's chess game, or redirect a file transfer by
     * naming a different recipient. The channel and the data-channel layer both
     * know who a message actually came from; this returns that.
     *
     * Accepts either shape an app receives: onGameMessage's {from, data} detail
     * or onDataChannelMessage's (peerId, data) — pass the peerId directly.
     */
    senderOf(detail) {
        if (typeof detail === 'string') return detail;
        if (!detail) return null;
        // _fromClient is stamped by the host relay from the transport peer id.
        return detail.from || detail.agentName || detail._fromClient || null;
    }

    /**
     * Did this message really come from the host?
     *
     * Checks the sender's identity against the current host rather than
     * trusting a _fromHost flag, which a client can set on anything it sends.
     */
    isFromHost(detail) {
        const sender = this.senderOf(detail);
        if (!sender) return false;
        const host = this._getHostName();
        return !!host && sender === host;
    }

    /**
     * Send chat message
     */
    sendChat(message) {
        if (!this.connected || !this.channel) {
            throw new Error('Not connected');
        }

        return new Promise((resolve, reject) => {
            this.channel.sendMessage(message, (response) => {
                if (response.status === 'success') {
                    resolve(response);
                } else {
                    reject(new Error(response.statusMessage || 'Failed to send chat'));
                }
            });
        });
    }

    /**
     * Check if current user is host
     */
    isHost() {
        return this.channel ? this.channel.isHostAgent() : false;
    }

    /**
     * Get connected users
     */
    getConnectedUsers() {
        return this.channel ? this.channel.connectedAgents : [];
    }

    /**
     * Send data via WebRTC DataChannel (P2P) or Relay
     * Automatically routes based on relay mode configuration
     * @param {*} data - Data to send (object will be JSON stringified)
     * @param {string} targetPeer - Specific peer to send to, or null to broadcast
     * @returns {number} Number of peers data was sent to
     */
    sendData(data, targetPeer = null) {
        // Route based on relay mode
        switch (this.relayMode) {
            case 'websocket-relay':
                return this._sendViaWebSocketRelay(data, targetPeer);

            case 'datachannel-server':
                return this._sendViaDataChannelServer(data, targetPeer);

            case 'p2p-mesh':
            case 'p2p-host':
            default:
                return this._sendViaP2P(data, targetPeer);
        }
    }

    /**
     * Send data via WebSocket relay (ephemeral messages)
     * Uses existing channel ephemeral message system
     * @private
     */
    _sendViaWebSocketRelay(data, targetPeer = null) {
        if (!this.channel || !this.connected) {
            console.warn('[UserConnectionBase] Not connected to channel');
            return 0;
        }

        // Wrap data with relay metadata
        const payload = {
            type: 'game-data',
            relayMode: 'websocket-relay',
            fromAgent: this.username,
            timestamp: Date.now(),
            data: data
        };

        // Send as ephemeral message (not stored, real-time only)
        this.channel.sendMessage({
            content: JSON.stringify(payload),
            to: targetPeer || '*',
            type: 'CUSTOM',
            customType: this.options.customType,
            ephemeral: true  // Use ephemeral message system
        }, (response) => {
            if (response.status !== 'success') {
                console.error('[UserConnectionBase] WebSocket relay send failed:', response.statusMessage);
            }
        });

        return targetPeer ? 1 : this.getConnectedUsers().length - 1;
    }

    /**
     * Send data via DataChannel server relay (Java backend relay)
     * Backend receives and broadcasts to all players
     * @private
     */
    _sendViaDataChannelServer(data, targetPeer = null) {
        if (!this.webrtcHelper) {
            console.warn('[AgentSessionBase] WebRTC not available, falling back to WebSocket');
            return this._sendViaWebSocketRelay(data, targetPeer);
        }

        // Send to backend relay via special '__server__' peer
        const payload = {
            type: 'relay-data',
            relayMode: 'datachannel-server',
            fromAgent: this.username,
            targetPeer: targetPeer,
            timestamp: Date.now(),
            data: data
        };

        // Backend acts as relay peer
        return this.webrtcHelper.sendData('__server__', payload) ? 1 : 0;
    }

    /**
     * Send data via P2P (direct mesh or host-based)
     * @private
     */
    _sendViaP2P(data, targetPeer = null) {
        if (!this.webrtcHelper) {
            console.warn('[AgentSessionBase] No WebRTC helper available');
            return 0;
        }

        // P2P Host mode: Use star topology (all messages go through host)
        if (this.relayMode === 'p2p-host' && !targetPeer) {
            if (this.isHost()) {
                // I'm host: broadcast to all players
                return this._broadcastFromHost(data);
            } else {
                // I'm client: send only to host, host will relay
                return this._sendToHost(data);
            }
        }

        // P2P Mesh mode or specific target: Direct P2P
        if (targetPeer) {
            // Send to specific peer
            return this.webrtcHelper.sendData(targetPeer, data) ? 1 : 0;
        } else {
            // Broadcast to all peers (mesh mode)
            return this.webrtcHelper.broadcastDataChannel(data);
        }
    }

    /**
     * Send data to host (for clients in host mode)
     * @private
     */
    _sendToHost(data) {
        const hostName = this._getHostName();
        if (!hostName) {
            console.warn('[AgentSessionBase] No host found, cannot send');
            return 0;
        }

        if (hostName === this.username) {
            console.warn('[AgentSessionBase] I am the host, cannot send to self');
            return 0;
        }

        // Add metadata to indicate this needs relaying
        const wrappedData = {
            ...data,
            _fromClient: this.username,
            _needsRelay: true
        };

        return this.webrtcHelper.sendData(hostName, wrappedData) ? 1 : 0;
    }

    /**
     * Broadcast from host to all clients
     * @private
     */
    _broadcastFromHost(data) {
        if (!this.isHost()) {
            console.warn('[AgentSessionBase] Only host can broadcast');
            return 0;
        }

        // Add metadata to indicate this is from host
        const wrappedData = {
            ...data,
            _fromHost: true
        };

        return this.webrtcHelper.broadcastDataChannel(wrappedData);
    }

    /**
     * Get the host's username
     * Host is the first connected user (lowest index in connectedAgents)
     * @private
     */
    _getHostName() {
        const users = this.getConnectedUsers();
        return users.length > 0 ? users[0] : null;
    }

    /**
     * Check if DataChannel is open with a specific peer
     */
    isDataChannelOpen(peerId) {
        if (!this.webrtcHelper) return false;
        const dc = this.webrtcHelper.dataChannels.get(peerId);
        return dc && dc.readyState === 'open';
    }

    /**
     * Get list of peers with open DataChannels
     */
    getDataChannelPeers() {
        if (!this.webrtcHelper) return [];
        const peers = [];
        this.webrtcHelper.dataChannels.forEach((dc, peerId) => {
            if (dc.readyState === 'open') {
                peers.push(peerId);
            }
        });
        return peers;
    }

    /**
     * Get DataChannel connection status for all peers
     * @returns {Map<string, string>} Map of peerId -> readyState ('connecting', 'open', 'closing', 'closed')
     */
    getDataChannelStatus() {
        const status = new Map();
        if (!this.webrtcHelper) return status;

        this.webrtcHelper.dataChannels.forEach((dc, peerId) => {
            status.set(peerId, dc.readyState);
        });
        return status;
    }

    /**
     * Initiate WebRTC DataChannel with a peer (like legacy code)
     * Only initiates if current agent is the host relative to the peer (to avoid duplicate connections)
     * @param {string} agentName - Name of the agent to create DataChannel with
     * @param {Object} config - Optional DataChannel configuration to override defaults
     * @protected
     */
    _initiateDataChannel(agentName, config = null) {
        if (!this.webrtcHelper) return;

        // Check if we should be the initiator (host) for this peer connection
        // This prevents both peers from trying to initiate simultaneously
        if (!this.channel.isHostAgent(agentName)) {
            console.log(`[AgentSessionBase] Skipping DataChannel initiation with ${agentName} (we are not the host)`);
            return;
        }

        // Guard against creating multiple offers to the same peer at once.
        // agent-connect, the connect-event "existing agents" loop and the
        // reconnect sweep can all fire within a few hundred ms; each extra offer
        // makes another peer connection for the SAME agent, and the agent-keyed
        // dataChannels map is then overwritten to the last (still-connecting) one,
        // orphaning the channel that actually opened. One offer per peer at a time.
        this._peersBeingInitiated = this._peersBeingInitiated || new Set();
        if (this._peersBeingInitiated.has(agentName)) {
            console.log(`[AgentSessionBase] DataChannel initiation already in progress for ${agentName}, skipping duplicate`);
            return;
        }
        this._peersBeingInitiated.add(agentName);
        // Failsafe release: if the connection never reports ready or fails, don't
        // block a future re-initiation forever (stream-ready and agent-disconnect
        // also release it — see _setupChannelEvents / stream-ready handler).
        const releaseInitiationGuard = () => {
            if (this._peersBeingInitiated) this._peersBeingInitiated.delete(agentName);
        };
        setTimeout(releaseInitiationGuard, 15000);

        // Use custom config if provided, otherwise use default from options
        const dataChannelConfig = config || {
            dataChannel: {
                name: this.options.dataChannelName,
                options: this.options.dataChannelOptions
            }
        };

        console.log(`[AgentSessionBase] Creating DataChannel with ${agentName} (we are the host)`);
        this.webrtcHelper.createStreamOffer(agentName, dataChannelConfig)
            .then(() => {
                console.log(`[AgentSessionBase] DataChannel offer sent to ${agentName}`);
            }).catch(err => {
            console.error(`[AgentSessionBase] Failed to create DataChannel with ${agentName}:`, err);
            releaseInitiationGuard();  // allow retry on failure
        });
    }

    /**
     * Setup channel event listeners (like legacy code)
     * @private
     */
    _setupChannelEvents() {
        // The socket has run out of its own attempts and told us so.
        this.channel.addEventListener('connection-lost', (ev) => {
            console.warn('[UserConnectionBase] Connection lost ('
                + ((ev && ev.reason) || 'unknown') + ')');
            this._beginReconnect('connection lost');
        });

        // The server no longer knows this session. The SDK schedules its own
        // retry twenty seconds out; this gets there first and does it properly.
        this.channel.addEventListener('session-not-found', () => {
            console.warn('[UserConnectionBase] Session is gone from the server');
            this._beginReconnect('session expired');
        });

        // Connect event
        this.channel.addEventListener('connect', (ev) => {
            const resp = ev.response || {};
            if (resp.status === 'success') {
                // Get existing agents from channel.connectedAgents
                const agentNames = this.getConnectedUsers();
                agentNames.forEach(name => {
                    if (name !== this.username) {
                        // Initiate WebRTC DataChannel with existing peers (if enabled)
                        if (this.options.autoCreateDataChannel) {
                            this._initiateDataChannel(name);
                        }
                    }
                });

                // Track initial host status
                this.wasHost = this.isHost();

                // Update host indicator to show if we're host
                this.updateHostIndicator();

                if (typeof this.onConnect === 'function') {
                    this.onConnect({
                        username: this.username,
                        users: agentNames.filter(n => n !== this.username),
                        isHost: this.isHost()
                    });
                }
            }
        });

        // Message event
        this.channel.addEventListener('message', (ev) => {
            const resp = ev.response || {};
            const items = Array.isArray(resp.data) ? resp.data : [];

            items.forEach(msg => {
                if (!msg) return;

                // Handle custom messages
                if (msg.type === 'custom') {
                    let payload = msg.content;
                    if (typeof payload === 'string') {
                        try { payload = JSON.parse(payload); } catch (e) {}
                    }

                    // Handle WebSocket relay messages
                    if (this.relayMode === 'websocket-relay' && payload.type === 'game-data' && payload.relayMode === 'websocket-relay') {
                        // Route WebSocket relay messages to onDataChannelMessage for uniform handling
                        if (typeof this.onDataChannelMessage === 'function' && payload.fromAgent !== this.username) {
                            console.log(`[AgentSessionBase] 📡 WebSocket relay from ${payload.fromAgent}`);
                            this.onDataChannelMessage(payload.fromAgent, payload.data);
                        }
                    } else {
                        // Regular game message
                        if (typeof this.onGameMessage === 'function') {
                            this.onGameMessage({
                                from: msg.from,
                                data: payload,
                                customType: msg.customType
                            });
                        }
                    }
                }
                // Handle chat messages
                else if (msg.type === 'chat-text' && msg.from !== this.username) {
                    if (typeof this.onChat === 'function') {
                        this.onChat({
                            from: msg.from,
                            message: msg.content
                        });
                    }
                }
            });
        });

        // Agent connect event
        this.channel.addEventListener('agent-connect', (ev) => {
            this._syncAgentsBadge();
            const agentName = ev.agentName;
            console.log(`[AgentSessionBase] Agent connected: ${agentName}`);
            if (agentName !== this.username) {
                // Fire onUserJoining (loading state - user is connecting)
                if (typeof this.onUserJoining === 'function') {
                    console.log(`[AgentSessionBase] UserJoining ${agentName}`);
                    this.onUserJoining({
                        agentName,
                        users: this.getConnectedUsers().filter(n => n !== this.username)
                    });
                }

                // Initiate WebRTC DataChannel with new peer (if enabled)
                if (this.options.autoCreateDataChannel) {
                    console.log(`[AgentSessionBase] Initiating DataChannel with new agent ${agentName}`);
                    this._initiateDataChannel(agentName);

                    // onUserJoin waits for that DataChannel to open, because for
                    // these apps "joined" means "reachable", and it is not
                    // reachable until the channel is up.
                } else {
                    // No DataChannel is coming. An app that talks over the
                    // channel alone is reachable the moment the server says the
                    // agent connected, so waiting for an event that will never
                    // fire left it deaf to arrivals while still hearing every
                    // departure through onUserLeave — a roster that only ever
                    // counted down.
                    console.log(`[AgentSessionBase] Agent ${agentName} joined (channel-only) - firing onUserJoin`);
                    if (typeof this.onUserJoin === 'function') {
                        this.onUserJoin({
                            agentName,
                            users: this.getConnectedUsers().filter(n => n !== this.username),
                            connectionTimeMs: null
                        });
                    }
                }
            }
        });

        // Agent disconnect event
        this.channel.addEventListener('agent-disconnect', (ev) => {
            const agentName = ev.agentName;
            this._syncAgentsBadge();

            // Release the initiation guard so this peer can be re-initiated if it
            // rejoins.
            if (this._peersBeingInitiated && agentName) {
                this._peersBeingInitiated.delete(agentName);
            }

            if (typeof this.onUserLeave === 'function') {
                this.onUserLeave({
                    agentName,
                    users: this.getConnectedUsers().filter(n => n !== this.username)
                });
            }

            // Check for host change after a short delay (allow channel state to update)
            setTimeout(() => {
                this._checkHostChange();
            }, 100);
        });

        // Disconnect event
        this.channel.addEventListener('disconnect', () => {
            this.connected = false;

            if (typeof this.onDisconnect === 'function') {
                this.onDisconnect();
            }
        });
    }

    /**
     * Setup WebRTC event listeners
     * @private
     */
    _setupWebRtcEvents() {
        if (!this.webrtcHelper) return;

        this.webrtcHelper.on('datachannel-open', (peerId, dataChannel, connectionTimeMs) => {
            if (connectionTimeMs !== null && connectionTimeMs !== undefined) {
                console.log(`[AgentSessionBase] ⏱️  DataChannel opened with ${peerId} in ${connectionTimeMs}ms`);
            } else {
                console.log(`[AgentSessionBase] DataChannel opened with ${peerId}`);
            }

            // Fire onUserJoin for new agent (DataChannel is ready for communication)
            console.log(`[AgentSessionBase] Agent ${peerId} DataChannel ready - firing onUserJoin`);
            if (typeof this.onUserJoin === 'function') {
                this.onUserJoin({
                    agentName: peerId,
                    users: this.getConnectedUsers().filter(n => n !== this.username),
                    connectionTimeMs: connectionTimeMs
                });
            }

            if (typeof this.onDataChannelOpen === 'function') {
                this.onDataChannelOpen(peerId, connectionTimeMs);
            }
        });

        this.webrtcHelper.on('datachannel-message', (peerId, data) => {
            // Host mode: Relay messages from clients to all other clients
            if (this.options.useHostMode && this.isHost() && data._needsRelay) {
                console.log(`[AgentSessionBase] 📡 Host relaying message from ${peerId} to all clients`);

                // Remove relay metadata AND any trust markers the sender set.
                //
                // _fromHost was not stripped here, so a client could send
                // {_needsRelay: true, _fromHost: true, ...} and the host would
                // rebroadcast it with that flag intact — every other client
                // then believed the message came from the host. That defeated
                // even the apps that check the flag correctly.
                //
                // A client cannot vouch for itself: identity is whatever the
                // transport says (peerId), never what the payload claims.
                const { _fromClient, _needsRelay, _fromHost, ...cleanData } = data;

                // Add source information
                const relayedData = {
                    ...cleanData,
                    _fromClient: peerId
                };

                // Broadcast to all other clients (excluding sender)
                const connectedUsers = this.getConnectedUsers();
                connectedUsers.forEach(userName => {
                    if (userName !== this.username && userName !== peerId) {
                        this.webrtcHelper.sendData(userName, relayedData);
                    }
                });

                // Also process locally for host
                if (typeof this.onDataChannelMessage === 'function') {
                    this.onDataChannelMessage(peerId, cleanData);
                }
            } else {
                // Regular message processing
                if (typeof this.onDataChannelMessage === 'function') {
                    this.onDataChannelMessage(peerId, data);
                }
            }
        });

        this.webrtcHelper.on('datachannel-close', (peerId) => {
            console.log(`[AgentSessionBase] DataChannel closed with ${peerId}`);

            if (typeof this.onDataChannelClose === 'function') {
                this.onDataChannelClose(peerId);
            }
        });

        this.webrtcHelper.on('datachannel-error', (peerId, error, isGracefulClose) => {
            // Only log as error if it's not a graceful close
            if (isGracefulClose) {
                console.log(`[AgentSessionBase] DataChannel gracefully closed with ${peerId}`);
            } else {
                console.error(`[AgentSessionBase] DataChannel error with ${peerId}:`, error);
            }

            if (typeof this.onDataChannelError === 'function') {
                this.onDataChannelError(peerId, error, isGracefulClose);
            }
        });

        this.webrtcHelper.on('stream-ready', (streamId, remoteAgent, connectionTimeMs) => {
            // Connection established — release the per-peer initiation guard. From
            // here the reconnect sweep's own getActiveDataChannels() check prevents
            // duplicates, and if this channel later drops it can be re-initiated.
            if (this._peersBeingInitiated && remoteAgent) {
                this._peersBeingInitiated.delete(remoteAgent);
            }

            if (connectionTimeMs !== null && connectionTimeMs !== undefined) {
                console.log(`[AgentSessionBase] ⏱️  Stream ready ${streamId} from ${remoteAgent} in ${connectionTimeMs}ms`);
            } else {
                console.log(`[AgentSessionBase] Stream ready ${streamId} from ${remoteAgent}`);
            }

            if (typeof this.onStreamReady === 'function') {
                this.onStreamReady(streamId, remoteAgent, connectionTimeMs);
            }
        });

        this.webrtcHelper.on('ice-candidate', (streamId, candidate) => {
            const candidateText = candidate && candidate.candidate ? candidate.candidate : JSON.stringify(candidate);
            console.log('[GameBase] 🧊 ICE candidate generated (stream=' + streamId + ') ' + candidateText);
        });
    }

    /* ====================================================================
     * Noticing somebody who left without saying so
     * ==================================================================== */

    /**
     * The roster is fetched once on connect and then kept up to date purely
     * from connect/disconnect events. A leaving tab announces itself with a
     * pagehide beacon — but a crash, a killed process or a dead battery sends
     * nothing, and a session that simply expires server-side publishes no
     * event either. Every remaining client then keeps that agent for ever.
     *
     * It matters most for the host: host election only re-runs when somebody
     * is seen to leave, and every host-only action is gated on isHost(), so a
     * host that vanishes leaves a room nobody can host.
     *
     * So ask the server who is actually here, now and then, and treat anyone
     * who has gone as having left — through the same path a clean departure
     * takes, which is what makes election re-run.
     *
     * @private
     */
    _startRosterReconcile() {
        if (!this.options.rosterReconcile) return;
        this._stopRosterReconcile();
        this._rosterMisses = new Map();
        this._rosterTimer = setInterval(() => this._reconcileRoster(),
            this.options.rosterReconcileIntervalMs);
    }

    /** @private */
    _stopRosterReconcile() {
        clearInterval(this._rosterTimer);
        this._rosterTimer = null;
        if (this._rosterMisses) this._rosterMisses.clear();
    }

    /**
     * One pass. Deliberately cautious: a peer has to be missing from two
     * consecutive answers before it is dropped, because a single truncated or
     * failed response must never be able to empty a room that is fine.
     *
     * @private
     */
    _reconcileRoster() {
        if (!this.connected || this.reconnecting || this._userDisconnected) return;
        if (!this.channel || typeof this.channel.getActiveAgents !== 'function') return;

        let live;
        try {
            live = this.channel.getActiveAgents((res) => {
                if (!res || res.status !== 'success' || !Array.isArray(res.data)) return;

                const here = new Set(res.data.map(a =>
                    (a && typeof a === 'object') ? (a.name || a.agentName) : a).filter(Boolean));
                // An answer that does not contain us is not an answer about us.
                if (!here.has(this.username)) return;

                const known = this.getConnectedUsers() || [];
                for (const name of known) {
                    if (name === this.username) continue;
                    if (here.has(name)) { this._rosterMisses.delete(name); continue; }

                    const misses = (this._rosterMisses.get(name) || 0) + 1;
                    this._rosterMisses.set(name, misses);
                    if (misses < 2) continue;

                    console.log('[UserConnectionBase] ' + name +
                        ' is gone without a disconnect — dropping after ' + misses + ' checks');
                    this._rosterMisses.delete(name);
                    this._dropVanishedAgent(name);
                }
            });
        } catch (e) {
            // Not ready, or the channel went away underneath us. Try again later.
        }
        void live;
    }

    /**
     * Take an agent out of the roster and run the same departure path a clean
     * disconnect would, so host election re-runs and apps hear onUserLeave.
     *
     * @private
     */
    _dropVanishedAgent(agentName) {
        try {
            const map = this.channel && this.channel._connectedAgentsMap;
            if (map && map[agentName]) {
                delete map[agentName];
                if (typeof this.channel._updateAgents === 'function') this.channel._updateAgents();
            }
            this._syncAgentsBadge();
            if (typeof this.onUserLeave === 'function') {
                this.onUserLeave({ agentName: agentName, reason: 'vanished' });
            }
            this._checkHostChange();
        } catch (e) {
            console.warn('[UserConnectionBase] could not drop ' + agentName, e);
        }
    }

    /**
     * Check if host status has changed and handle host migration
     * Called automatically when a player leaves
     * @private
     */
    async _checkHostChange() {
        const isHostNow = this.isHost();

        // If we weren't host before but are now (HOST MIGRATION!)
        if (!this.wasHost && isHostNow) {
            console.log('[AgentSessionBase] 🎯 Host transferred to us!');
            this.wasHost = true;

            // Update host indicator
            this.updateHostIndicator();

            // Show toast notification
            if (typeof this.showToast === 'function') {
                this.showToast('You are now the host!', 'success');
            }

            // Handle host mode migration if enabled
            if (this.options.useHostMode) {
                await this._handleHostMigration();
            }

            // Notify subclass about becoming host
            if (typeof this.onBecomeHost === 'function') {
                this.onBecomeHost();
            }
        }
        // If we were host before but aren't now (shouldn't normally happen, but handle it)
        else if (this.wasHost && !isHostNow) {
            console.log('[AgentSessionBase] Host transferred to someone else');
            this.wasHost = false;

            // Update host indicator
            this.updateHostIndicator();

            // Notify subclass about losing host
            if (typeof this.onLoseHost === 'function') {
                this.onLoseHost();
            }
        }
    }

    /**
     * Handle host migration when we become the new host
     * Establishes DataChannel connections with all other players
     * @private
     */
    async _handleHostMigration() {
        if (this.hostMigrationInProgress) {
            console.log('[AgentSessionBase] Host migration already in progress, skipping');
            return;
        }

        this.hostMigrationInProgress = true;
        console.log('[AgentSessionBase] 🔄 Starting host migration...');

        // PAUSE THE GAME during host migration
        this.pauseGame('Host migration in progress...');

        try {
            const connectedUsers = this.getConnectedUsers();
            const otherPlayers = connectedUsers.filter(name => name !== this.username);

            console.log(`[AgentSessionBase] Need to establish DataChannels with ${otherPlayers.length} players:`, otherPlayers);

            // Check existing DataChannels
            const existingChannels = this.webrtcHelper ? this.webrtcHelper.getActiveDataChannels() : [];
            console.log('[AgentSessionBase] Existing DataChannels:', existingChannels);

            // Find players we need to connect to
            const playersNeedingConnection = otherPlayers.filter(player => {
                const hasChannel = existingChannels.includes(player);
                if (hasChannel) {
                    console.log(`[AgentSessionBase] ✓ Already have DataChannel with ${player}`);
                }
                return !hasChannel;
            });

            if (playersNeedingConnection.length === 0) {
                console.log('[AgentSessionBase] ✓ All DataChannels already established');
                this.hostMigrationInProgress = false;
                this.resumeGame(); // Resume game
                return;
            }

            console.log(`[AgentSessionBase] Creating DataChannels with ${playersNeedingConnection.length} players:`, playersNeedingConnection);

            // Create DataChannels with all players we don't have connections to
            const connectionPromises = playersNeedingConnection.map(async (playerName) => {
                try {
                    this.pendingHostConnections.add(playerName);
                    console.log(`[AgentSessionBase] 📡 Initiating DataChannel with ${playerName}...`);

                    await this._initiateDataChannel(playerName);

                    console.log(`[AgentSessionBase] ✓ DataChannel initiated with ${playerName}`);
                    this.pendingHostConnections.delete(playerName);
                } catch (error) {
                    console.error(`[AgentSessionBase] ✗ Failed to connect to ${playerName}:`, error);
                    this.pendingHostConnections.delete(playerName);
                }
            });

            // Wait for all connections (with timeout)
            await Promise.race([
                Promise.all(connectionPromises),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Host migration timeout')), 10000))
            ]).catch(error => {
                console.warn('[AgentSessionBase] Some connections failed during host migration:', error);
            });

            console.log('[AgentSessionBase] ✓ Host migration complete!');

            // RESUME THE GAME after successful host migration
            this.resumeGame();

            // Show success notification
            if (typeof this.showToast === 'function') {
                this.showToast('Host migration complete', 'success', 2000);
            }

        } catch (error) {
            console.error('[AgentSessionBase] Host migration failed:', error);

            // Resume game even on failure
            this.resumeGame();

            if (typeof this.showToast === 'function') {
                this.showToast('Host migration failed', 'error', 3000);
            }
        } finally {
            this.hostMigrationInProgress = false;
            this.pendingHostConnections.clear();
        }
    }

    /**
     * Lifecycle hooks for subclasses to override
     */

    // Called during initialization
    async onInitialize() {}

    // Called when successfully connected
    onConnect(detail) {}

    // Called when disconnected
    onDisconnect() {}

    // Called when game starts
    onStart() {}

    // Called when game stops
    onStop() {}

    // Called when a user is joining (agent-connect event - show loading notification)
    onUserJoining(detail) {}

    // Called when a user joins successfully (datachannel-open event - ready for communication)
    onUserJoin(detail) {}

    // Called when a user leaves
    onUserLeave(detail) {}

    // Called when current user becomes host (generic - automatically called by AgentSessionBase)
    onBecomeHost() {}

    // Called when current user loses host (generic - automatically called by AgentSessionBase)
    onLoseHost() {}

    // Called when chat message received
    onChat(detail) {}

    // Called when game message received
    onGameMessage(detail) {}

    // Called when DataChannel opens (WebRTC)
    onDataChannelOpen(peerId, connectionTimeMs) {}

    // Called when DataChannel message received (WebRTC)
    onDataChannelMessage(peerId, data) {}

    // Called when DataChannel closes (WebRTC)
    onDataChannelClose(peerId) {}

    // Called when WebRTC stream is ready (WebRTC)
    onStreamReady(streamId, remoteAgent, connectionTimeMs) {}

    // ========================================================================
    // COMMON UTILITY METHODS
    // ========================================================================

    /**
     * Show toast notification (uses MiniGameUtils if available)
     * @param {string} message - Message to display
     * @param {string} type - Toast type: 'info', 'success', 'error', 'warning'
     * @param {number} duration - Duration in ms (default: 3000)
     */
    showToast(message, type = 'info', duration = 3000) {
        console.log(`[AgentSessionBase] Toast (${type}): ${message}`);
        if (typeof MiniGameUtils !== 'undefined' && typeof MiniGameUtils.showToast === 'function') {
            MiniGameUtils.showToast(message, type, duration);
        }
    }

    /**
     * Show notification when a player joins
     * @param {string} agentName - Name of agent that joined
     */
    showJoinNotification(agentName) {
        if (agentName === this.username) return; // Don't show for self
        this.showToast(`${agentName} joined`, 'success');
    }

    /**
     * Show notification when a player leaves
     * @param {string} agentName - Name of agent that left
     */
    showLeaveNotification(agentName) {
        if (agentName === this.username) return; // Don't show for self
        this.showToast(`${agentName} left`, 'info');
    }

    /**
     * Generate a consistent color for a user based on their name
     * @param {string} name - Username
     * @returns {string} Hex color code
     */
    generateUserColor(name) {
        if (!name) return '#667eea';

        // Simple hash function
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash; // Convert to 32bit integer
        }

        // Generate vibrant colors (avoid too dark or too light)
        const hue = Math.abs(hash % 360);
        const saturation = 65 + (Math.abs(hash >> 8) % 20); // 65-85%
        const lightness = 50 + (Math.abs(hash >> 16) % 15); // 50-65%

        // Convert HSL to RGB
        const h = hue / 360;
        const s = saturation / 100;
        const l = lightness / 100;

        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        let r, g, b;
        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        const toHex = (x) => {
            const hex = Math.round(x * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };

        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    /**
     * Get array of all connected users including self
     * @returns {Array<{name: string, color: string, isHost: boolean, isSelf: boolean}>}
     */
    getUserList() {
        const users = [];
        const connectedUsers = this.getConnectedUsers();

        // Determine who is host (first to join the channel)
        const otherUsers = connectedUsers.filter(n => n !== this.username);
        const hostName = this.isHost() ? this.username : otherUsers[0];

        // Add self
        users.push({
            name: this.username,
            color: this.generateUserColor(this.username),
            isHost: this.isHost(),
            isSelf: true
        });

        // Add other users
        otherUsers.forEach(name => {
            users.push({
                name: name,
                color: this.generateUserColor(name),
                isHost: name === hostName,
                isSelf: false
            });
        });

        // Sort: host first, then alphabetically
        users.sort((a, b) => {
            if (a.isHost && !b.isHost) return -1;
            if (!a.isHost && b.isHost) return 1;
            return a.name.localeCompare(b.name);
        });

        return users;
    }

    /**
     * Get total user count (including self)
     * @returns {number}
     */
    getUserCount() {
        return this.getUserList().length;
    }

    /**
     * Check if enough users are connected to start the session
     * @param {number} minUsers - Minimum required users (default: 2)
     * @returns {boolean}
     */
    hasEnoughUsers(minUsers = 2) {
        return this.getUserCount() >= minUsers;
    }

    // ============================================
    // LOADER METHODS (for user joining state)
    // ============================================

    /**
     * Show a loading overlay while waiting for DataChannel connection
     * @param {string} message - Message to display
     */
    showConnectionLoader(message = 'Connecting to player...') {
        try {
            let loader = document.getElementById('gameConnectionLoader');
            if (!loader) {
                // Create loader overlay
                loader = document.createElement('div');
                loader.id = 'gameConnectionLoader';
                loader.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    z-index: 99999;
                    gap: 16px;
                `;

                const spinner = document.createElement('div');
                spinner.id = 'gameConnectionSpinner';
                spinner.style.cssText = `
                    width: 50px;
                    height: 50px;
                    border: 4px solid rgba(0, 212, 255, 0.2);
                    border-top-color: #00d4ff;
                    border-radius: 50%;
                    animation: AgentSessionBaseSpin 0.8s linear infinite;
                `;

                const text = document.createElement('div');
                text.id = 'gameConnectionText';
                text.style.cssText = `
                    color: white;
                    font-size: 16px;
                    font-weight: 600;
                `;
                text.textContent = message;

                // Add animation styles if not already present
                if (!document.getElementById('AgentSessionBaseLoaderStyles')) {
                    const styles = document.createElement('style');
                    styles.id = 'AgentSessionBaseLoaderStyles';
                    styles.textContent = `
                        @keyframes AgentSessionBaseSpin {
                            to { transform: rotate(360deg); }
                        }
                    `;
                    document.head.appendChild(styles);
                }

                loader.appendChild(spinner);
                loader.appendChild(text);
                document.body.appendChild(loader);
            } else {
                // Update message text
                const text = document.getElementById('gameConnectionText');
                if (text) {
                    text.textContent = message;
                }
            }
            loader.style.display = 'flex';
        } catch (e) {
            console.warn('[AgentSessionBase] Failed to show connection loader', e);
        }
    }

    /**
     * Hide the connection loading overlay
     */
    hideConnectionLoader() {
        try {
            const loader = document.getElementById('gameConnectionLoader');
            if (loader) {
                loader.style.display = 'none';
            }
        } catch (e) {
            console.warn('[AgentSessionBase] Failed to hide connection loader', e);
        }
    }

    /**
     * Update the loader message text
     * @param {string} message - New message to display
     */
    updateConnectionLoaderMessage(message) {
        try {
            const text = document.getElementById('gameConnectionText');
            if (text) {
                text.textContent = message;
            }
        } catch (e) {
            console.warn('[AgentSessionBase] Failed to update loader message', e);
        }
    }

    // ============================================
    // HOST INDICATOR METHODS
    // ============================================

    /**
     * Show a floating host indicator icon at bottom right
     * Indicates that the current user is the host
     */
    showHostIndicator() {
        try {
            let indicator = document.getElementById('gameHostIndicator');
            if (!indicator) {
                // Create host indicator
                indicator = document.createElement('div');
                indicator.id = 'gameHostIndicator';
                indicator.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: linear-gradient(135deg, rgba(102, 126, 234, 0.7) 0%, rgba(118, 75, 162, 0.7) 100%);
                    color: white;
                    padding: 10px 16px;
                    border-radius: 24px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                    font-size: 14px;
                    font-weight: 600;
                    z-index: 100000;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: default;
                    user-select: none;
                    opacity: 0.85;
                    backdrop-filter: blur(4px);
                    animation: hostIndicatorSlideIn 0.3s ease-out;
                    transition: opacity 0.3s ease;
                `;

                // Add hover effect
                indicator.onmouseenter = () => { indicator.style.opacity = '1'; };
                indicator.onmouseleave = () => { indicator.style.opacity = '0.85'; };

                // The floating host pill appears on every app built on this
                // base, so its mark comes from the shared sprite rather than
                // being the one emoji left on an otherwise converted page.
                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                icon.setAttribute('class', 'icon icon--sm');
                icon.setAttribute('aria-hidden', 'true');
                icon.style.width = '16px';
                icon.style.height = '16px';
                const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                use.setAttribute('href', '#i-crown');
                icon.appendChild(use);

                const text = document.createElement('span');
                text.textContent = 'Host';

                // Add animation styles if not already present
                if (!document.getElementById('hostIndicatorStyles')) {
                    const styles = document.createElement('style');
                    styles.id = 'hostIndicatorStyles';
                    styles.textContent = `
                        @keyframes hostIndicatorSlideIn {
                            from {
                                transform: translateY(100px);
                                opacity: 0;
                            }
                            to {
                                transform: translateY(0);
                                opacity: 0.85;
                            }
                        }
                        @keyframes hostIndicatorSlideOut {
                            from {
                                transform: translateY(0);
                                opacity: 0.85;
                            }
                            to {
                                transform: translateY(100px);
                                opacity: 0;
                            }
                        }
                    `;
                    document.head.appendChild(styles);
                }

                indicator.appendChild(icon);
                indicator.appendChild(text);
                document.body.appendChild(indicator);
            } else {
                indicator.style.display = 'flex';
                indicator.style.animation = 'hostIndicatorSlideIn 0.3s ease-out';
            }
        } catch (e) {
            console.warn('[AgentSessionBase] Failed to show host indicator', e);
        }
    }

    /**
     * Hide the floating host indicator
     */
    hideHostIndicator() {
        try {
            const indicator = document.getElementById('gameHostIndicator');
            if (indicator) {
                indicator.style.animation = 'hostIndicatorSlideOut 0.3s ease-in';
                setTimeout(() => {
                    indicator.style.display = 'none';
                }, 300);
            }
        } catch (e) {
            console.warn('[AgentSessionBase] Failed to hide host indicator', e);
        }
    }

    /**
     * Update host indicator visibility based on current host status
     */
    updateHostIndicator() {
        if (!this.options.enableHostIndicator)
        {
            return;
        }
        if (this.isHost()) {
            this.showHostIndicator();
        } else {
            this.hideHostIndicator();
        }
    }

    // ============================================
    // SESSION PAUSE/RESUME METHODS
    // ============================================

    /**
     * Pause the session (e.g., during host migration)
     * @param {string} reason - Reason for pausing
     */
    pauseSession(reason = 'Session paused') {
        // Check if pause/resume is supported
        if (!this.supportsPauseResume) {
            console.log(`[AgentSessionBase] Pause not supported for this application - ignoring`);
            return;
        }

        if (this.sessionPaused) return;

        this.sessionPaused = true;
        this.pauseReason = reason;

        console.log(`[AgentSessionBase] Session paused: ${reason}`);

        // Show toast if available
        if (typeof this.showToast === 'function') {
            this.showToast(reason, 'warning');
        }

        // Notify subclass
        if (typeof this.onSessionPaused === 'function') {
            this.onSessionPaused(reason);
        }
    }

    /**
     * Resume the session
     */
    resumeSession() {
        // Check if pause/resume is supported
        if (!this.supportsPauseResume) {
            console.log(`[AgentSessionBase] Resume not supported for this application - ignoring`);
            return;
        }

        if (!this.sessionPaused) return;

        const wasReason = this.pauseReason;
        this.sessionPaused = false;
        this.pauseReason = null;

        console.log(`[AgentSessionBase] Session resumed (was: ${wasReason})`);

        // Show toast if available
        if (typeof this.showToast === 'function') {
            this.showToast('Session resumed!', 'success');
        }

        // Notify subclass
        if (typeof this.onSessionResumed === 'function') {
            this.onSessionResumed();
        }
    }

    /**
     * Check if session is paused
     * @returns {boolean}
     */
    isPaused() {
        return this.sessionPaused;
    }

    // =========================================================================
    // Backward Compatibility Aliases (for existing games)
    // =========================================================================

    /**
     * @deprecated Use pauseSession() instead
     */
    pauseGame(reason) {
        console.warn('[UserConnectionBase] pauseGame() is deprecated, use pauseSession() instead');
        return this.pauseSession(reason);
    }

    /**
     * @deprecated Use resumeSession() instead
     */
    resumeGame() {
        console.warn('[UserConnectionBase] resumeGame() is deprecated, use resumeSession() instead');
        return this.resumeSession();
    }

    /**
     * @deprecated Use getUserList() instead
     */
    getPlayerList() {
        return this.getUserList();
    }

    /**
     * @deprecated Use getUserList() instead
     */
    getPeerList() {
        return this.getUserList();
    }

    /**
     * @deprecated Use getUserCount() instead
     */
    getPlayerCount() {
        return this.getUserCount();
    }

    /**
     * @deprecated Use getUserCount() instead
     */
    getPeerCount() {
        return this.getUserCount();
    }

    /**
     * @deprecated Use hasEnoughUsers() instead
     */
    hasEnoughPlayers(minPlayers) {
        return this.hasEnoughUsers(minPlayers);
    }

    /**
     * @deprecated Use hasEnoughUsers() instead
     */
    hasEnoughPeers(minPeers) {
        return this.hasEnoughUsers(minPeers);
    }
}

// ============================================
// GAME INITIALIZER - Common initialization logic
// ============================================

/**
 * GameInitializer - Handles common initialization for all mini-games
 * Eliminates duplicate code across game files
 *
 * For games that extend AgentSessionBase:
 * ```javascript
 * GameInitializer.init({
 *     gameClass: MyGameClass,
 *     gameName: 'my-game',
 *     storagePrefix: 'mygame_',
 *     channelPrefix: 'mygame-',
 *     title: '🎮 My Game'
 * });
 * ```
 *
 * For games that don't extend AgentSessionBase, use SimpleGameInitializer:
 * ```javascript
 * SimpleGameInitializer.init({
 *     gameName: 'my-game',
 *     storagePrefix: 'mygame_',
 *     channelPrefix: 'mygame-',
 *     title: '🎮 My Game',
 *     onConnect: async (username, channel, password) => {
 *         // Your custom connection logic
 *     }
 * });
 * ```
 */
let GameInitializer = {
    game: null,
    config: null,

    /**
     * Initialize the game with common setup
     * @param {Object} config - Configuration object
     * @param {Function} config.gameClass - The game class to instantiate (must extend AgentSessionBase)
     * @param {string} config.gameName - Game identifier
     * @param {string} config.storagePrefix - LocalStorage prefix (e.g., 'mygame_')
     * @param {string} config.channelPrefix - Channel name prefix (e.g., 'mygame-')
     * @param {string} config.title - Display title (e.g., '🎮 My Game')
     * @param {Function} [config.onGameCreated] - Callback after game is created
     * @param {Function} [config.onConnected] - Callback after successful connection
     * @param {Function} [config.onError] - Callback on error
     */
    init: function(config) {
        this.config = config;

        document.addEventListener('DOMContentLoaded', async () => {
            console.log(`[${config.gameName}] DOM loaded, initializing...`);

            try {
                // Create game instance
                this.game = new config.gameClass();

                // Expose globally for debugging and auto-connect
                window.game = this.game;
                window[config.gameName.replace(/-/g, '')] = this.game;

                // Initialize the game
                await this.game.initialize();

                // Callback after game created
                if (typeof config.onGameCreated === 'function') {
                    config.onGameCreated(this.game);
                }

                console.log(`[${config.gameName}] Game ready`);

                // Setup global connect function for auto-connect
                this._setupGlobalConnect(config);

                // Process shared link if present
                this._processSharedLink(config);

                // Show connection modal
                this._showConnectionModal();

            } catch (error) {
                console.error(`[${config.gameName}] Initialization error:`, error);

                if (typeof config.onError === 'function') {
                    config.onError(error);
                } else {
                    this._showErrorScreen(error, config.gameName);
                }
            }
        });
    },

    /**
     * Setup global connect function for auto-connect
     */
    _setupGlobalConnect: function(config) {
        let connectInProgress = false;
        window.connect = async () => {
            // Guard: prevent multiple simultaneous calls
            if (connectInProgress) {
                console.log(`[${config.gameName}] Connect already in progress, ignoring duplicate call`);
                return;
            }

            // Cancel the auto-connect timer immediately
            if (window.MiniGameUtils && typeof window.MiniGameUtils._cancelAutoConnect === 'function') {
                window.MiniGameUtils._cancelAutoConnect();
            }

            if (!this.game) {
                console.warn(`[${config.gameName}] Game not initialized yet`);
                return;
            }

            const usernameInput = document.getElementById('usernameInput');
            const channelInput = document.getElementById('channelInput');
            const passwordInput = document.getElementById('passwordInput');

            const username = usernameInput?.value?.trim();
            const channel = channelInput?.value?.trim();
            const password = passwordInput?.value || '';

            if (!username || !channel) {
                console.warn(`[${config.gameName}] Missing username or channel`);
                if (this.game.showToast) {
                    this.game.showToast('Please enter username and channel', 'warning');
                }
                return;
            }

            connectInProgress = true;
            try {
                await this.game.connect({
                    username,
                    channelName: channel,
                    channelPassword: password
                });
                await this.game.start();

                if (window.ConnectionModal) {
                    window.ConnectionModal.hide();
                }

                if (typeof config.onConnected === 'function') {
                    config.onConnected(this.game);
                }
            } catch (error) {
                console.error(`[${config.gameName}] Connection failed:`, error);
                if (this.game.showToast) {
                    this.game.showToast('Connection failed: ' + error.message, 'error');
                }
            } finally {
                connectInProgress = false;
            }
        };
    },

    /**
     * Process shared link (auto-fill credentials from URL hash)
     * @param {Object} config - Configuration object with gameName, storagePrefix, and optional connectCallback
     */
    _processSharedLink: function(config) {
        // Process shared link if present
        if (typeof ShareModal !== 'undefined' && ShareModal.processSharedLink) {
            let hasSharedLink = false;

            ShareModal.processSharedLink((auth, agentName) => {
                try {
                    const chEl = document.getElementById('channelInput');
                    const pwEl = document.getElementById('passwordInput');
                    const userEl = document.getElementById('usernameInput');

                if (auth && chEl && pwEl) {
                    hasSharedLink = true;
                    chEl.value = auth.c || '';
                    pwEl.value = auth.p || '';
                    // Allow editing - users can change channel/password if they want
                    // Warning will be shown in the modal
                }

                    // Generate or use provided agent name
                    let finalName = agentName ||
                        localStorage.getItem(config.storagePrefix + 'username') ||
                        (window.generateRandomAgentName ? window.generateRandomAgentName() : 'Player-' + Math.random().toString(36).slice(2, 8));

                    if (userEl) {
                        userEl.value = finalName;
                        requestAnimationFrame(() => {
                            userEl.focus();
                            userEl.select();
                        });
                    }

                    // Show the modal - collapsed when auto-connect is enabled
                    const modal = document.getElementById('connectionModal');
                    // Resolved before it is read. It used to be declared
                    // fifteen lines further down, inside the auto-connect
                    // block, so this `if` hit its temporal dead zone and every
                    // shared link died with a ReferenceError swallowed by the
                    // catch below — the link simply appeared not to work.
                    const connectCallback = config.connectCallback || window.connect;

                    if (modal) {
                        modal.classList.add('active');

                        // Collapse modal immediately when auto-connect is enabled
                        if (hasSharedLink && connectCallback && typeof connectCallback === 'function') {
                            modal.classList.add('collapsed');
                            console.log(`[${config.gameName}] Modal collapsed for auto-connect`);
                        }
                    }

                    console.log(`[${config.gameName}] Shared link processed`, {
                        channel: auth?.c,
                        hasPassword: !!auth?.p
                    });

                    // Enable auto-connect if shared link is present - immediate mode (no timer)
                    if (hasSharedLink && window.MiniGameUtils) {
                        // Auto-connect disabled - users must click Connect button manually
                        // Even with shared links, waiting for user action
                        console.log(`[${config.gameName}] Shared link detected - waiting for user to click Connect`);
                    }
                } catch (e) {
                    console.warn(`[${config.gameName}] Share link handler failed`, e);
                }
            });
        }
    },

    /**
     * Show connection modal after initialization
     */
    _showConnectionModal: function() {
        setTimeout(() => {
            if (window.ConnectionModal && typeof window.ConnectionModal.show === 'function') {
                const modal = document.getElementById('connectionModal');
                if (modal && !modal.classList.contains('active')) {
                    window.ConnectionModal.show();
                }
            }
        }, 200);
    },

    /**
     * Show error screen on initialization failure
     */
    _showErrorScreen: function(error, gameName) {
        document.body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f0f1a; color: white; font-family: monospace; padding: 20px;">
                <div style="max-width: 600px; background: #1a1a2e; padding: 30px; border-radius: 12px; border: 2px solid #ef4444;">
                    <h2 style="color: #ef4444; margin-bottom: 15px;">This game would not start</h2>
                    <p style="color: #94a3b8; margin-bottom: 10px;">Failed to initialize ${gameName}:</p>
                    <pre style="background: #0f0f1a; padding: 15px; border-radius: 8px; overflow-x: auto; color: #ff6b6b;">${error.message}\n\n${error.stack || ''}</pre>
                    <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer;">Reload Page</button>
                </div>
            </div>
        `;
    },

    /**
     * Get the current game instance
     * @returns {UserConnectionBase|null}
     */
    getGame: function() {
        return this.game;
    }
};

// Expose globally
window.GameInitializer = GameInitializer;

// Exported here rather than mid-file: GameInitializer is declared further down,
// so the previous placement hit its temporal dead zone and threw for any
// CommonJS importer — on top of naming a class (AgentSessionBase) that does not
// exist in this file at all.
if (typeof module !== 'undefined' && module.exports) {
    // The previous line named AgentSessionBase, which is not a name in this
    // file — the class is UserConnectionBase — so this threw for any importer.
    module.exports = { UserConnectionBase, GameInitializer };
}
