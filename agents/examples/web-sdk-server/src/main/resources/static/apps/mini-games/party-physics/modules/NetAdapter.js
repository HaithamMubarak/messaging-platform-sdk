/**
 * NetAdapter.js
 * Network adapter that wraps Messaging Platform + WebRTC
 * Handles control-plane (channel messages) and data-plane (WebRTC DataChannel)
 */

class NetAdapter {
    constructor(game) {
        this.game = game; // Reference to main game instance

        // Messaging Platform (control plane)
        this.channel = null;
        this.myPeerId = null;

        // WebRTC (data plane)
        this.rtcConnections = new Map(); // peerId -> DataChannel
        this.useWebRTC = true;

        // Host info
        this.hostId = null;
        this.isHost = false;

        // Callbacks
        this.onSnapshotCallback = null;
        this.onUserJoinCallback = null;
        this.onUserLeaveCallback = null;
        this.onModeChangeCallback = null;
        this.onGameStartCallback = null;
        this.onGameEndCallback = null;

        console.log('[NetAdapter] Created');
    }

    /**
     * Initialize channel
     */
    initChannel(channel, myPeerId) {
        this.channel = channel;
        this.myPeerId = myPeerId;

        // Setup message handlers
        this.setupChannelHandlers();

        console.log('[NetAdapter] Channel initialized, myPeerId:', myPeerId);
    }

    /**
     * Setup channel message handlers (control plane)
     * NOTE: AgentConnection doesn't have .on() method
     * Messages should be handled via UserConnectionBase callbacks (onUserJoin, etc.)
     * This method is kept for future WebRTC message handling
     */
    setupChannelHandlers() {
        console.log('[NetAdapter] Channel handlers setup (using UserConnectionBase callbacks)');

        // NOTE: Don't use this.channel.on() - it doesn't exist!
        // Instead, the game should forward UserConnectionBase callbacks to NetAdapter methods
        // Example: onUserJoin() -> netAdapter.handlePlayerJoin()
    }

    /**
     * Setup WebRTC DataChannel with peer
     */
    setupWebRTC(peerId, dataChannel) {
        // This is called from onDataChannelOpen, so the channel is already open:
        // there is no onopen left to wait for, and hooking one meant the peer
        // was never recorded at all. Waiting for it also used to be moot,
        // because the SDK passes the connection time in this position rather
        // than the channel — setting .onopen on a number is what threw.
        if (!dataChannel || typeof dataChannel !== 'object') {
            console.warn('[NetAdapter] No DataChannel for peer', peerId, '— staying on the channel transport');
            return;
        }

        console.log('[NetAdapter] Registering open DataChannel with peer:', peerId);
        this.rtcConnections.set(peerId, dataChannel);

        // Inbound messages are not read here: the SDK already listens on this
        // channel and routes them to onDataChannelMessage, which the game
        // forwards to handleDataChannelMessage. Assigning .onmessage would take
        // them away from it.
    }

    /** Forget a peer's channel when it goes away. */
    teardownWebRTC(peerId) {
        if (this.rtcConnections.delete(peerId)) {
            console.log('[NetAdapter] WebRTC DataChannel closed with', peerId);
        }
    }

    /**
     * Handle incoming DataChannel message
     */
    handleDataChannelMessage(peerId, data) {
        try {
            // The SDK hands this over already parsed; a raw channel would give
            // a string. Accept either.
            const message = typeof data === 'string' ? JSON.parse(data) : data;
            if (!message || !message.type) return;

            if (message.type === 'SNAPSHOT') {
                // Snapshot from host — accept only from the actual host
                if (this.hostId && peerId !== this.hostId) return;
                if (this.onSnapshotCallback) {
                    this.onSnapshotCallback(message.payload);
                }
            } else if (message.type === 'INPUT') {
                // Input from client (only host receives this)
                if (this.isHost && this.game.authority) {
                    this.game.authority.processInput(peerId, message.payload);
                }
            } else if (message.type === 'CHAR_SELECT') {
                // A peer picked a character. Request, not instruction: only
                // the host acts on it, only for the sending peer (the id
                // comes from the transport, never from the payload), and
                // only for a real archetype.
                if (!this.isHost) return;
                const character = message.payload && message.payload.character;
                if (typeof character !== 'string' ||
                    typeof ARCHETYPES === 'undefined' || !ARCHETYPES[character]) return;
                if (typeof this.game.setPeerCharacter === 'function') {
                    this.game.setPeerCharacter(peerId, character);
                }
            } else if (message.type === 'START_GAME') {
                // Only the host may start the game
                if (this.isHost || peerId !== this.hostId) return;
                if (this.onGameStartCallback) {
                    this.onGameStartCallback(message.payload);
                }
            } else if (message.type === 'END_GAME') {
                // Only the host may end the game
                if (this.isHost || peerId !== this.hostId) return;
                if (this.onGameEndCallback) {
                    this.onGameEndCallback(message.payload || {});
                }
            }
        } catch (error) {
            console.error('[NetAdapter] Error parsing DataChannel message:', error);
        }
    }

    /**
     * Send input to host
     */
    sendInput(input) {
        if (!this.hostId) return;

        const message = {
            type: 'INPUT',
            payload: input
        };

        // Try WebRTC first
        if (this.useWebRTC && this.rtcConnections.has(this.hostId)) {
            const dc = this.rtcConnections.get(this.hostId);
            if (dc.readyState === 'open') {
                try {
                    dc.send(JSON.stringify(message));
                    return;
                } catch (error) {
                    console.error('[NetAdapter] WebRTC send failed:', error);
                }
            }
        }

        // Fallback to channel
        this.channel.send('INPUT', message.payload);
    }

    /**
     * Tell the host which character this client picked (lobby only).
     * The host validates it and applies it to this peer alone.
     */
    sendCharSelect(character) {
        if (!this.hostId || this.isHost) return;

        const dc = this.rtcConnections.get(this.hostId);
        if (dc && dc.readyState === 'open') {
            try {
                dc.send(JSON.stringify({
                    type: 'CHAR_SELECT',
                    payload: { character }
                }));
            } catch (error) {
                console.error('[NetAdapter] CHAR_SELECT send failed:', error);
            }
        }
    }

    /**
     * Host-only: send a control message to every connected peer over the
     * DataChannels (the same transport snapshots use).
     */
    broadcastControl(type, payload) {
        if (!this.isHost) return;

        const text = JSON.stringify({ type, payload });
        this.rtcConnections.forEach((dc, peerId) => {
            if (dc.readyState === 'open') {
                try {
                    dc.send(text);
                } catch (error) {
                    console.error('[NetAdapter]', type, 'send failed to', peerId, error);
                }
            }
        });
    }

    /**
     * Send snapshot to all clients (host only)
     */
    sendSnapshot(snapshot) {
        if (!this.isHost) return;

        const message = {
            type: 'SNAPSHOT',
            payload: snapshot
        };

        // Send via WebRTC to connected peers
        let sentCount = 0;
        this.rtcConnections.forEach((dc, peerId) => {
            if (dc.readyState === 'open') {
                try {
                    dc.send(JSON.stringify(message));
                    sentCount++;
                } catch (error) {
                    console.error('[NetAdapter] WebRTC snapshot send failed to', peerId, error);
                }
            }
        });

        // Fallback: send via channel if no WebRTC connections
        if (sentCount === 0 || !this.useWebRTC) {
            this.channel.send('SNAPSHOT', snapshot);
        }
    }

    /**
     * Announce as host
     */
    announceHost(gameId, mode) {
        this.hostId = this.myPeerId;
        this.isHost = true;

        this.channel.send('HOST_ANNOUNCE', {
            hostId: this.myPeerId,
            gameId,
            mode,
            seed: Math.floor(Math.random() * 1000000)
        });

        console.log('[NetAdapter] Announced as host');
    }

    /**
     * Broadcast mode change (host only)
     */
    broadcastModeChange(mode) {
        if (!this.isHost) return;

        this.channel.send('MODE_SET', { mode });
    }

    /**
     * Broadcast game start (host only). Carries the authoritative roster
     * (names, characters), the mode and the chosen map, over DataChannels.
     */
    broadcastGameStart(startData) {
        this.broadcastControl('START_GAME', {
            ...(startData || {}),
            timestamp: Date.now()
        });
    }

    /**
     * Broadcast game end (host only)
     */
    broadcastGameEnd(winnerId) {
        this.broadcastControl('END_GAME', {
            winnerId,
            timestamp: Date.now()
        });
    }

    /**
     * Request resync from host
     */
    requestResync() {
        if (this.isHost) return;

        this.channel.sendTo(this.hostId, 'RESYNC_REQUEST', {
            peerId: this.myPeerId
        });
    }

    /**
     * Get list of peers
     */
    getPeers() {
        return this.channel ? this.channel.getPeers() : [];
    }

    /**
     * Check if WebRTC is connected with peer
     */
    isWebRTCConnected(peerId) {
        const dc = this.rtcConnections.get(peerId);
        return dc && dc.readyState === 'open';
    }

    /**
     * Set callback for snapshots
     */
    onSnapshot(callback) {
        this.onSnapshotCallback = callback;
    }

    /**
     * Set callback for user join
     */
    onUserJoin(callback) {
        this.onUserJoinCallback = callback;
    }

    /**
     * Set callback for user leave
     */
    onUserLeave(callback) {
        this.onUserLeaveCallback = callback;
    }

    /**
     * Set callback for mode change
     */
    onModeChange(callback) {
        this.onModeChangeCallback = callback;
    }

    /**
     * Set callback for game start
     */
    onGameStart(callback) {
        this.onGameStartCallback = callback;
    }

    /**
     * Set callback for game end
     */
    onGameEnd(callback) {
        this.onGameEndCallback = callback;
    }

    /**
     * Handle user join (called from game's onUserJoin)
     */
    handleUserJoin(peerId, username) {
        console.log('[NetAdapter] User joined:', peerId, username);
        if (this.onUserJoinCallback) {
            this.onUserJoinCallback({ peerId, name: username });
        }
    }

    /**
     * Handle user leave (called from game's onUserLeave)
     */
    handleUserLeave(peerId, username) {
        console.log('[NetAdapter] User left:', peerId, username);
        if (this.onUserLeaveCallback) {
            this.onUserLeaveCallback({ peerId, name: username });
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NetAdapter };
}
