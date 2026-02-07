/**
 * AgentInteractionBase - Abstract base class for real-time multi-agent applications
 * Provides common functionality for games, file sharing, collaboration tools, and more
 *
 * Features:
 * - Real-time messaging via WebSocket
 * - Peer-to-peer data channels via WebRTC
 * - Host migration and session management
 * - Agent/player management
 * - Pause/resume support
 * - State synchronization
 *
 * This class is generic and can be extended for any real-time interactive application:
 * - Games (air hockey, quiz battle, reactor, fall guys, etc.)
 * - File sharing (QuickShare)
 * - Collaboration tools (whiteboard)
 * - Chat applications
 * - Any multi-agent real-time interaction
 *
 * @class AgentInteractionBase
 * @abstract
 */
class AgentInteractionBase {
    constructor(options = {}) {
        if (this.constructor === AgentInteractionBase) {
            throw new Error('AgentInteractionBase is abstract and cannot be instantiated directly');
        }

        this.options = {
            storagePrefix: 'game',
            customType: 'game',
            usePubKey: false,
            autoCreateDataChannel: true,  // Automatically create DataChannel on peer join
            useHostMode: true,             // Use host-based relay (star topology)

            // Relay Mode Configuration
            // Modes: 'p2p-mesh' | 'p2p-host' | 'websocket-relay' | 'datachannel-server' | 'sfu-media'
            relayMode: 'p2p-host',         // Default: P2P with host-based routing
            relayEnabled: false,           // Enable server relay mode (websocket/datachannel/sfu)

            dataChannelName: 'game-data',
            dataChannelOptions: {
                ordered: false,
                maxRetransmits: 0
            },
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

        // Game pause state (for host migration, connection issues, etc.)
        this.gamePaused = false;
        this.pauseReason = null;

        // Pause/Resume support flag (some apps like whiteboard don't support pause)
        this.supportsPauseResume = this.options.supportsPauseResume !== false; // Default true

        this.isInitialized = false;
        this.isRunning = false;

        // Event emitter for custom events
        this.eventHandlers = new Map();

        console.log('Created AgentInteractionBase instance with options:', this.options);
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
                console.error(`[AgentInteractionBase] Error in event handler for '${eventName}':`, error);
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

        console.log('[AgentInteractionBase] Initializing...');

        // Auto-connect disabled - users must click Connect button manually
        // (Previously enabled auto-connect for shared links)

        // Call subclass initialization
        if (typeof this.onInitialize === 'function') {
            await this.onInitialize();
        }

        this.isInitialized = true;
        console.log('[AgentInteractionBase] Initialized');
    }

    /**
     * Connect to game channel - same as legacy code
     */
    async connect(credentials) {
        const { username, channelName, channelPassword } = credentials;

        // CRITICAL: Cancel auto-connect timer to prevent duplicate connection
        if (window.MiniGameUtils && typeof window.MiniGameUtils._cancelAutoConnect === 'function') {
            window.MiniGameUtils._cancelAutoConnect();
            console.log('[AgentInteractionBase] Auto-connect canceled - manual connection started');
        }

        // GUARD: Prevent duplicate connection requests
        if (this.connected) {
            console.warn('[AgentInteractionBase] Already connected, ignoring duplicate connect request');
            return;
        }

        if (this.connecting) {
            console.warn('[AgentInteractionBase] Connection in progress, ignoring duplicate connect request');
            return;
        }

        if (!username || !channelName) {
            throw new Error('Username and channel name required');
        }

        // Set connecting flag
        this.connecting = true;

        try {
            this.username = username;
            this.channelName = channelName;
            this.channelPassword = channelPassword || '';

            // Get config
            console.log('[AgentInteractionBase] Requesting API key...');
            const response = await window.fetchAppConfig(300, false);
            const config = response?.data || response;
            const apiKey = config?.apiKey || null;
            const apiUrl = config?.messagingServiceUrl || config?.messagingApiUrl || null;

            if (!apiUrl) {
                throw new Error('No messagingServiceUrl in config');
            }

            console.log('[AgentInteractionBase] Using API URL:', apiUrl);

            // Create connection (same as legacy)
            this.channel = new AgentConnection();

            // Initialize WebRTC helper for DataChannels (same as legacy)
            if (typeof WebRtcHelper !== 'undefined') {
                this.webrtcHelper = new WebRtcHelper(this.channel);
                this._setupWebRtcEvents();
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

            console.log('[AgentInteractionBase] Connected');

            // Setup automatic cleanup on page unload
            this._setupCleanupOnUnload();
        } catch (error) {
            // Reset connecting flag on error
            this.connecting = false;
            throw error;
        }
    }

    /**
     * Setup automatic cleanup when page is unloaded
     * @private
     */
    _setupCleanupOnUnload() {
        if (typeof MiniGameUtils !== 'undefined' && typeof MiniGameUtils.setupCleanupOnUnload === 'function') {
            MiniGameUtils.setupCleanupOnUnload(() => this.channel, this.options.customType || 'Game');
            console.log(`[AgentInteractionBase] Cleanup on unload registered for ${this.options.customType}`);
        } else {
            console.warn('[AgentInteractionBase] MiniGameUtils not loaded, cleanup may not work properly');
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
            console.warn('[AgentInteractionBase] Already running');
            return;
        }

        console.log('[AgentInteractionBase] Starting...');
        this.isRunning = true;

        // Call subclass start
        if (typeof this.onStart === 'function') {
            this.onStart();
        }

        console.log('[AgentInteractionBase] Started');
    }

    /**
     * Stop the game
     */
    stop() {
        if (!this.isRunning) return;

        console.log('[AgentInteractionBase] Stopping...');
        this.isRunning = false;

        // Call subclass stop
        if (typeof this.onStop === 'function') {
            this.onStop();
        }

        console.log('[AgentInteractionBase] Stopped');
    }

    /**
     * Disconnect from game
     */
    disconnect() {
        this.stop();

        if (this.channel) {
            this.channel.disconnect();
        }

        this.connected = false;
        console.log('[AgentInteractionBase] Disconnected');
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
            console.warn('[AgentInteractionBase] Not connected to channel');
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
                console.error('[AgentInteractionBase] WebSocket relay send failed:', response.statusMessage);
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
        });
    }

    /**
     * Setup channel event listeners (like legacy code)
     * @private
     */
    _setupChannelEvents() {
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
            const agentName = ev.agentName;
            if (agentName !== this.username) {
                // Fire onPlayerJoining (loading state - player is connecting)
                if (typeof this.onPlayerJoining === 'function') {
                    this.onPlayerJoining({
                        agentName,
                        users: this.getConnectedUsers().filter(n => n !== this.username)
                    });
                }

                // Initiate WebRTC DataChannel with new peer (if enabled)
                if (this.options.autoCreateDataChannel) {
                    this._initiateDataChannel(agentName);
                }

                // NOTE: onPlayerJoin is fired when DataChannel opens (when ready for communication)
            }
        });

        // Agent disconnect event
        this.channel.addEventListener('agent-disconnect', (ev) => {
            const agentName = ev.agentName;

            if (typeof this.onPlayerLeave === 'function') {
                this.onPlayerLeave({
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

            // Fire onPlayerJoin for new agent (DataChannel is ready for communication)
            console.log(`[AgentSessionBase] Agent ${peerId} DataChannel ready - firing onPlayerJoin`);
            if (typeof this.onPlayerJoin === 'function') {
                this.onPlayerJoin({
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

                // Remove relay metadata
                const { _fromClient, _needsRelay, ...cleanData } = data;

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

    // Called when a player is joining (agent-connect event - show loading notification)
    onPlayerJoining(detail) {}

    // Called when a player joins successfully (datachannel-open event - ready for communication)
    onPlayerJoin(detail) {}

    // Called when a player leaves
    onPlayerLeave(detail) {}

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
        this.showToast(`👋 ${agentName} joined`, 'success');
    }

    /**
     * Show notification when a player leaves
     * @param {string} agentName - Name of agent that left
     */
    showLeaveNotification(agentName) {
        if (agentName === this.username) return; // Don't show for self
        this.showToast(`👋 ${agentName} left`, 'info');
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
     * Get array of all connected players including self
     * @returns {Array<{name: string, color: string, isHost: boolean, isSelf: boolean}>}
     */
    getPlayerList() {
        const players = [];
        const connectedUsers = this.getConnectedUsers();

        // Determine who is host (first to join the channel)
        const otherUsers = connectedUsers.filter(n => n !== this.username);
        const hostName = this.isHost() ? this.username : otherUsers[0];

        // Add self
        players.push({
            name: this.username,
            color: this.generateUserColor(this.username),
            isHost: this.isHost(),
            isSelf: true
        });

        // Add other players
        otherUsers.forEach(name => {
            players.push({
                name: name,
                color: this.generateUserColor(name),
                isHost: name === hostName,
                isSelf: false
            });
        });

        // Sort: host first, then alphabetically
        players.sort((a, b) => {
            if (a.isHost && !b.isHost) return -1;
            if (!a.isHost && b.isHost) return 1;
            return a.name.localeCompare(b.name);
        });

        return players;
    }
    /**
     * Get total player count (including self)
     * @returns {number}
     */
    getPlayerCount() {
        return this.getPlayerList().length;
    }

    /**
     * Check if enough players are connected to start the game
     * @param {number} minPlayers - Minimum required players (default: 2)
     * @returns {boolean}
     */
    hasEnoughPlayers(minPlayers = 2) {
        return this.getPlayerCount() >= minPlayers;
    }

    // ============================================
    // LOADER METHODS (for player joining state)
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

                const icon = document.createElement('span');
                icon.textContent = '👑';
                icon.style.fontSize = '18px';

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
        if (this.isHost()) {
            this.showHostIndicator();
        } else {
            this.hideHostIndicator();
        }
    }

    // ============================================
    // GAME PAUSE/RESUME METHODS
    // ============================================

    /**
     * Pause the game (e.g., during host migration)
     * @param {string} reason - Reason for pausing
     */
    pauseGame(reason = 'Game paused') {
        // Check if pause/resume is supported
        if (!this.supportsPauseResume) {
            console.log(`[AgentSessionBase] Pause not supported for this application - ignoring`);
            return;
        }

        if (this.gamePaused) return;

        this.gamePaused = true;
        this.pauseReason = reason;

        console.log(`[AgentSessionBase] Game paused: ${reason}`);

        // Show toast if available
        if (typeof this.showToast === 'function') {
            this.showToast(reason, 'warning');
        }

        // Notify subclass
        if (typeof this.onGamePaused === 'function') {
            this.onGamePaused(reason);
        }
    }

    /**
     * Resume the game
     */
    resumeGame() {
        // Check if pause/resume is supported
        if (!this.supportsPauseResume) {
            console.log(`[AgentSessionBase] Resume not supported for this application - ignoring`);
            return;
        }

        if (!this.gamePaused) return;

        const wasReason = this.pauseReason;
        this.gamePaused = false;
        this.pauseReason = null;

        console.log(`[AgentSessionBase] Game resumed (was: ${wasReason})`);

        // Show toast if available
        if (typeof this.showToast === 'function') {
            this.showToast('Game resumed!', 'success');
        }

        // Notify subclass
        if (typeof this.onGameResumed === 'function') {
            this.onGameResumed();
        }
    }

    /**
     * Check if game is paused
     * @returns {boolean}
     */
    isPaused() {
        return this.gamePaused;
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AgentSessionBase;
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
                        // Use the provided callback or fall back to window.connect
                        const connectCallback = config.connectCallback || window.connect;

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
                    <h2 style="color: #ef4444; margin-bottom: 15px;">⚠️ Game Initialization Error</h2>
                    <p style="color: #94a3b8; margin-bottom: 10px;">Failed to initialize ${gameName}:</p>
                    <pre style="background: #0f0f1a; padding: 15px; border-radius: 8px; overflow-x: auto; color: #ff6b6b;">${error.message}\n\n${error.stack || ''}</pre>
                    <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer;">Reload Page</button>
                </div>
            </div>
        `;
    },

    /**
     * Get the current game instance
     * @returns {AgentSessionBase|null}
     */
    getGame: function() {
        return this.game;
    }
};

// Expose globally
window.GameInitializer = GameInitializer;
