/**
 * WebRTC Video Stream Support for Web Agent
 * ------------------------------------------
 * Handles peer connection creation, signaling, and stream management
 * between web agents and Java/Python agents via your messaging platform.
 *
 * Compatible with both browser and Node.js environments.
 */

(function(global) {
    'use strict';

    // =========================================================================
    // Environment Detection & Module Loading (BEFORE class definition)
    // =========================================================================

    // Check Node.js FIRST - more reliable than checking for module.exports
    // Node.js always has process.versions.node
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

    // Browser check: has window AND not Node.js (Node.js can have polyfilled window)
    const isBrowser = !isNode && typeof window !== 'undefined' && typeof document !== 'undefined';

    // WebRTC class references - will be set based on environment
    let _RTCPeerConnection = null;
    let _RTCSessionDescription = null;
    let _RTCIceCandidate = null;
    let _MediaStream = null;

    // Node.js environment - load wrtc module (CHECK FIRST before browser!)
    if (isNode) {
        console.log('[WebRTC] Node.js environment detected');
        console.log('[WebRTC] Node version:', process.version);
        console.log('[WebRTC] Platform:', process.platform, process.arch);

        // Try to load wrtc modules
        let wrtc = null;
        let loadError = null;

        try {
            // Try @roamhq/wrtc first (preferred)
            console.log('[WebRTC] Attempting to load @roamhq/wrtc...');
            wrtc = require('@roamhq/wrtc');
            console.log('[WebRTC] ✓ @roamhq/wrtc module loaded successfully');
        } catch (e1) {
            console.warn('[WebRTC] ✗ @roamhq/wrtc not available:', e1.message);
            loadError = e1;

            try {
                // Fallback to wrtc
                console.log('[WebRTC] Attempting to load wrtc...');
                wrtc = require('wrtc');
                console.log('[WebRTC] ✓ wrtc module loaded successfully');
                loadError = null;
            } catch (e2) {
                console.warn('[WebRTC] ✗ wrtc not available:', e2.message);
                wrtc = null;
            }
        }

        if (wrtc && wrtc.RTCPeerConnection) {
            _RTCPeerConnection = wrtc.RTCPeerConnection;
            _RTCSessionDescription = wrtc.RTCSessionDescription;
            _RTCIceCandidate = wrtc.RTCIceCandidate;
            _MediaStream = wrtc.MediaStream;
            console.log('[WebRTC] ✓ WebRTC classes loaded from wrtc module');
            console.log('[WebRTC] ✓ RTCPeerConnection:', typeof _RTCPeerConnection);
            console.log('[WebRTC] ✓ Full WebRTC support enabled');
        } else {
            console.error('[WebRTC] ============================================');
            console.error('[WebRTC] ✗ CRITICAL: wrtc module not available');
            console.error('[WebRTC] ============================================');

            if (loadError) {
                console.error('[WebRTC] Load error details:', loadError.stack);
            }

            console.error('[WebRTC]');
            console.error('[WebRTC] WebRTC functionality will NOT work in this Node.js environment.');
            console.error('[WebRTC]');
            console.error('[WebRTC] To fix:');
            console.error('[WebRTC]   1. Install the module:');
            console.error('[WebRTC]      npm install @roamhq/wrtc');
            console.error('[WebRTC]      or');
            console.error('[WebRTC]      npm install wrtc');
            console.error('[WebRTC]');
            console.error('[WebRTC]   2. Ensure build tools are installed:');
            console.error('[WebRTC]      - Python 3');
            console.error('[WebRTC]      - build-essential (Linux) or Build Tools (Windows)');
            console.error('[WebRTC]      - node-gyp');
            console.error('[WebRTC]');
            console.error('[WebRTC]   3. Check npm install logs for compilation errors');
            console.error('[WebRTC] ============================================');

            // Create stub that throws error with helpful message
            _RTCPeerConnection = class StubRTCPeerConnection {
                constructor() {
                    throw new Error(
                        'RTCPeerConnection not available - wrtc module failed to load. ' +
                        'Install with: npm install @roamhq/wrtc or npm install wrtc. ' +
                        'Ensure build tools (Python 3, build-essential) are installed.'
                    );
                }
            };
        }

        // MediaStream mock for Node.js if not provided by wrtc
        if (!_MediaStream) {
            _MediaStream = class MediaStream {
                constructor(tracks = []) {
                    this.tracks = tracks || [];
                    this.id = 'stream_' + Math.random().toString(36).slice(2);
                }
                getTracks() { return this.tracks; }
                getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
                getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
                addTrack(track) { this.tracks.push(track); }
                removeTrack(track) {
                    const idx = this.tracks.indexOf(track);
                    if (idx >= 0) this.tracks.splice(idx, 1);
                }
            };
        }

        // Navigator mock for Node.js
        if (!global.navigator) {
            global.navigator = {
                mediaDevices: {
                    getUserMedia: async () => {
                        throw new Error('getUserMedia not available in Node.js environment');
                    }
                }
            };
        }
    } else if (isBrowser) {
        // Browser environment - use native WebRTC APIs
        _RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        _RTCSessionDescription = window.RTCSessionDescription;
        _RTCIceCandidate = window.RTCIceCandidate;
        _MediaStream = window.MediaStream;

        console.log('[WebRTC] Browser environment detected, using native WebRTC APIs');
    } else {
        // Unknown environment
        console.warn('[WebRTC] Unknown environment - WebRTC may not be available');
    }

    // =========================================================================
    // WebRtcHelper Class
    // =========================================================================

    class WebRtcHelper {
        constructor(channel = null) {

            if (!channel) throw new Error('No signaling channel provided to WebRtcHelper constructor');

            this.peerConnections = new Map();   // streamId -> RTCPeerConnection
            this.streamSessions = new Map();    // streamId -> session metadata
            this.localStreams = new Map();      // streamId -> MediaStream (local streams we're sending)
            this.remoteStreams = new Map();     // streamId -> MediaStream (remote streams we're receiving)
            this.dataChannels = new Map();      // peerId -> RTCDataChannel
            this.dataChannelHandlers = {};      // event handlers for data channels
            this.eventHandlers = {};
            this.defaultLocalStream = null;    // optional global local MediaStream for answerer role
            // Note: Modern browsers handle ICE candidate queueing internally
            // No need for manual pendingIceCandidates queue
            this.dataChannelStartTimes = new Map(); // peerId -> timestamp when DataChannel creation started
            this.streamStartTimes = new Map();      // streamId -> timestamp when stream creation started
            this.peerConnectionStartTimes = new Map(); // streamId -> timestamp when peer connection was created

            // For Node.js SFU compatibility
            this.ready = _RTCPeerConnection !== null;
            this.initPromise = Promise.resolve();

            // Store optional channel for signaling (can still be passed per-call)
            this.channel = channel;

            // Handle all signaling events from agents
            channel.onWebRtcSignaling = async ({streamId, sourceAgent, signalingMsg}) => {
                console.log('[WebRTC] SIGNAL from agent:', streamId, signalingMsg);

                try {
                    const type = signalingMsg.type;

                    if (type === 'offer') {
                        await this.handleSdpOffer(streamId, sourceAgent, signalingMsg.sdp);
                    } else if (type === 'answer') {
                        await this.handleSdpAnswer(streamId, sourceAgent, signalingMsg.sdp);
                    } else if (type === 'ice-candidate') {
                        await this.handleIceCandidate(streamId, signalingMsg.candidate);
                    } else {
                        console.warn('[WebRTC] Unknown signaling type:', type);
                    }
                } catch (err) {
                    console.error('[WebRTC] Failed to process signaling message:', err);
                }
            };
        }

        // ------------------------------------------------------------------
        // ICE Server Configuration
        // ------------------------------------------------------------------

        /**
         * Get ICE servers from channel config or fallback to environment/defaults
         * @param {Object} channel - The channel object that may contain iceServers
         * @returns {Array} Array of ICE server configurations
         */
        getIceServersFromConfig(channel) {

            // Check if iceServers are provided in channel config
            if (channel && channel.iceServers && Array.isArray(channel.iceServers) && channel.iceServers.length > 0) {
                console.log('[WebRTC] ICE servers from channel config:', JSON.stringify(channel.iceServers, null, 2));
                return channel.iceServers;
            }

            // Fallback to environment-based or default ICE servers
            const iceServers = this._buildIceServers();
            console.log('[WebRTC] ICE servers resolved:', JSON.stringify(iceServers, null, 2));
            return iceServers;
        }

        /**
         * Build ICE servers from environment variables or defaults
         *
         * Node.js Environment:
         * - Reads from process.env.TURN_SERVER, process.env.STUN_SERVER, etc.
         * - Example: TURN_SERVER=host.docker.internal:3478
         *
         * Browser Environment:
         * - First checks this.channel object properties (turnServer, stunServer, turnUsername, turnPassword)
         * - Falls back to window.ENV if available
         * - Falls back to public STUN servers
         *
         * @returns {Array} Array of ICE server configurations
         */
        _buildIceServers() {
            // =================================================================
            // NODE.JS ENVIRONMENT - Read from process.env
            // =================================================================
            if (typeof process !== 'undefined' && process.env) {
                const turnServer = process.env.TURN_SERVER;
                const stunServer = process.env.STUN_SERVER;
                const turnUsername = process.env.TURN_USERNAME || 'webrtc';
                const turnPassword = process.env.TURN_PASSWORD || 'turnpassword123';

                // If custom TURN/STUN servers are configured in environment
                if (turnServer || stunServer) {
                    const turn = turnServer || 'coturn:3478';
                    const stun = stunServer || 'coturn:3478';

                    console.log(`[WebRTC] Node.js: Using TURN/STUN from process.env - TURN: ${turn}, STUN: ${stun}`);

                    return [
                        {
                            urls: [
                                `stun:${stun}`,
                                `turn:${turn}?transport=udp`,
                                `turn:${turn}?transport=tcp`
                            ],
                            username: turnUsername,
                            credential: turnPassword
                        },
                        { urls: 'stun:stun.l.google.com:19302' }
                    ];
                }
            }

            // =================================================================
            // FALLBACK - Default environment
            // =================================================================
            console.log('[WebRTC] Default environment, using public STUN servers');
            return [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ];
        }

        // ------------------------------------------------------------------
        // Event System
        // ------------------------------------------------------------------
        on(event, handler) {
            if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
            this.eventHandlers[event].push(handler);
        }

        emit(event, ...args) {
            if (this.eventHandlers[event]) {
                this.eventHandlers[event].forEach(fn => {
                    try {
                        fn(...args);
                    } catch (e) {
                        console.error(`[WebRTC] Handler error for ${event}:`, e);
                    }
                });
            }
        }

        // ------------------------------------------------------------------
        // Main API
        // ------------------------------------------------------------------

        /**
         * Request to send local video stream to a remote agent (offerer role)
         * Can also create DataChannel(s) alongside media stream
         * @param {string} remoteAgent - Remote agent name
         * @param {Object} constraints - Media constraints AND/OR dataChannel config
         *   Examples:
         *   - { video: true, audio: true } - Media only
         *   - { dataChannel: { name: 'chat', options: {...} } } - DataChannel only
         *   - { video: true, dataChannel: { name: 'data' } } - Both media + DataChannel
         *   - { sourceStreamId: 'stream_123' } - Relay existing stream (SFU mode)
         */
        async createStreamOffer(remoteAgent, constraints = {}) {
            if (!this.channel) {
                throw new Error('No signaling channel provided to WebRtcHelper constructor');
            }

            const streamId = this._id();

            // Determine if this is DataChannel-only (no media constraints)
            const hasMediaConstraints = constraints.video || constraints.audio || constraints.stream || constraints.sourceStreamId;
            const hasDataChannel = constraints.dataChannel;

            // Set streamSession BEFORE creating peer connection
            this.streamSessions.set(streamId, {
                id: streamId,
                remoteAgent,
                role: 'offer',
                state: 'creating',
                hasMedia: hasMediaConstraints,
                hasDataChannel: hasDataChannel,
                sourceStreamId: constraints.sourceStreamId  // For SFU relay
            });

            const pc = this._createPeerConnection(this.channel, remoteAgent, streamId);

            // Create DataChannel if requested (initiator creates it)
            if (hasDataChannel) {
                const dcConfig = typeof hasDataChannel === 'object' ? hasDataChannel : {};
                const channelName = dcConfig.name || 'data';
                const channelOptions = dcConfig.options || {
                    ordered: false,
                    maxRetransmits: 0
                };

                const dataChannel = pc.createDataChannel(channelName, channelOptions);
                this.dataChannels.set(remoteAgent, dataChannel);
                this._setupDataChannelHandlers(dataChannel, remoteAgent, pc);

                console.log(`[WebRTC] Created DataChannel "${channelName}" for peer ${remoteAgent}`);
            }

            // Add media stream if requested
            if (hasMediaConstraints) {
                let mediaStream = null;

                // SFU relay mode: Get stream from existing remote stream
                if (constraints.sourceStreamId) {
                    const sourceInfo = this.remoteStreams.get(constraints.sourceStreamId);
                    if (sourceInfo) {
                        // remoteStreams stores { sourceAgent, stream } in SFU, or just stream in browser
                        mediaStream = sourceInfo.stream || sourceInfo;
                        console.log(`[WebRTC] Relaying source stream ${constraints.sourceStreamId} to ${remoteAgent}`);
                    }
                }
                // Allow passing an existing MediaStream via constraints.stream
                else if (constraints.stream && typeof constraints.stream.getTracks === 'function') {
                    mediaStream = constraints.stream;
                } else {
                    mediaStream = await this._getLocalStream(constraints);
                }

                if (mediaStream) {
                    this.localStreams.set(streamId, mediaStream);

                    // Add tracks to peer connection
                    let hasVideo = false, hasAudio = false;
                    mediaStream.getTracks().forEach(track => {
                        if (track.readyState === 'live' || track.readyState === undefined) {
                            pc.addTrack(track, mediaStream);
                            if (track.kind === 'video') hasVideo = true;
                            if (track.kind === 'audio') hasAudio = true;
                        }
                    });

                    // Add transceivers for missing media types (needed for wrtc)
                    if (!hasVideo) pc.addTransceiver('video', {direction: 'recvonly'});
                    if (!hasAudio) pc.addTransceiver('audio', {direction: 'recvonly'});

                    console.log(`[WebRTC] Added media stream to offer for ${remoteAgent}`);
                } else {
                    // No stream available, add recvonly transceivers
                    pc.addTransceiver('video', {direction: 'recvonly'});
                    pc.addTransceiver('audio', {direction: 'recvonly'});
                }
            }

            // Create and send offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Update state to offer-created
            const session = this.streamSessions.get(streamId);
            if (session) session.state = 'offer-created';

            // Emit an 'offer' event so the UI can react
            this.emit('offer', streamId, offer.sdp);

            // Send to remote agent via channel
            this.channel.sendWebRtcSignaling({
                type: 'offer',
                sdp: offer.sdp,
                streamSessionId: streamId
            }, remoteAgent);

            console.log(`[WebRTC] Sent SDP offer to ${remoteAgent}, streamId=${streamId}`);
            return streamId;
        }


        /**
         * Handle an incoming SDP offer (answerer role)
         * Automatically detects DataChannel and/or media stream from SDP
         */
        async handleSdpOffer(streamId, sourceAgent, sdpOffer) {
            if (!this.channel) {
                throw new Error('No signaling channel provided to WebRtcHelper constructor');
            }

            console.log(`[WebRTC] Received SDP offer for ${streamId} from ${sourceAgent}`);

            // Detect what's in the SDP
            const hasDataChannel = sdpOffer.includes('m=application');
            const hasVideo = sdpOffer.includes('m=video');
            const hasAudio = sdpOffer.includes('m=audio');
            const hasMedia = hasVideo || hasAudio;

            console.log(`[WebRTC] SDP contains - Media: ${hasMedia}, DataChannel: ${hasDataChannel}`);

            // Set streamSession BEFORE creating peer connection
            this.streamSessions.set(streamId, {
                id: streamId,
                remoteAgent: sourceAgent,
                role: 'answer',
                state: 'offer-received',
                hasMedia: hasMedia,
                hasDataChannel: hasDataChannel
            });

            const pc = this._createPeerConnection(this.channel, sourceAgent, streamId);

            // Set up DataChannel receiver if present (receiver side: listen for incoming)
            if (hasDataChannel) {
                console.log(`[WebRTC] DataChannel detected in offer from ${sourceAgent}`);
                this.dataChannelStartTimes.set(sourceAgent, Date.now());

                // Receiver side: listen for incoming DataChannel
                pc.ondatachannel = (event) => {
                    console.log(`[WebRTC] Received DataChannel from ${sourceAgent}:`, event.channel.label);
                    const dataChannel = event.channel;
                    this.dataChannels.set(sourceAgent, dataChannel);
                    this._setupDataChannelHandlers(dataChannel, sourceAgent, this);
                };
            }

            // Add media handling if present
            if (hasMedia) {
                console.log(`[WebRTC] Media detected in offer from ${sourceAgent}`);

                // Add transceivers BEFORE setRemoteDescription
                // This is REQUIRED for Node.js wrtc module ONLY!
                // Browser: Does NOT need this, handles transceivers automatically
                // Node.js wrtc: MUST add transceivers before setRemoteDescription
                if (isNode) {
                    if (hasVideo || hasMedia) {
                        pc.addTransceiver('video', {direction: 'recvonly'});
                        console.log('[WebRTC] Node.js: Added video transceiver (recvonly)');
                    }
                    if (hasAudio || hasMedia) {
                        pc.addTransceiver('audio', {direction: 'recvonly'});
                        console.log('[WebRTC] Node.js: Added audio transceiver (recvonly)');
                    }
                }
            }

            // Set remote description AFTER adding transceivers (required for wrtc in Node.js)
            await pc.setRemoteDescription(new _RTCSessionDescription({type: 'offer', sdp: sdpOffer}));

            // Modern browsers handle ICE candidate queueing internally
            // No need to manually process queued candidates

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            // Update state to answer-created
            const session = this.streamSessions.get(streamId);
            if (session) session.state = 'answer-created';

            this.channel.sendWebRtcSignaling({
                type: 'answer',
                sdp: answer.sdp,
                streamSessionId: streamId
            }, sourceAgent);

            // Emit an 'answer' event after sending answer so UI can log it
            this.emit('answer', streamId, answer.sdp);

            console.log(`[WebRTC] Sent SDP answer for ${streamId}`);
        }

        /**
         * Handle incoming SDP answer from remote agent
         */
        async handleSdpAnswer(streamId, sourceAgent, sdpAnswer) {
            const pc = this.peerConnections.get(streamId);
            if (!pc) return console.warn(`[WebRTC] No PeerConnection for ${streamId}`);

            const session = this.streamSessions.get(streamId);

            // Check if we can set remote description
            if (pc.signalingState === 'stable') {
                // Connection is already stable - check if this is a duplicate answer
                if (session && session.state === 'answer-received') {
                    console.log(`[WebRTC] Ignoring duplicate SDP answer for ${streamId} - connection already stable`);
                } else {
                    console.log(`[WebRTC] SDP answer received for ${streamId} but connection already stable (possibly very fast connection)`);
                }
                return;
            }

            if (pc.signalingState !== 'have-local-offer') {
                console.warn(`[WebRTC] Cannot set remote answer in state ${pc.signalingState} for ${streamId} - expected 'have-local-offer'`);
                return; // Must return to prevent InvalidStateError
            }

            try {
                await pc.setRemoteDescription(new _RTCSessionDescription({type: 'answer', sdp: sdpAnswer}));

                if (session) session.state = 'answer-received';

                console.log(`[WebRTC] Applied remote SDP answer for ${streamId}`);
            } catch (err) {
                // Handle race condition where state changed between check and setRemoteDescription
                if (err.name === 'InvalidStateError') {
                    console.warn(`[WebRTC] Race condition: state changed to ${pc.signalingState} before setRemoteDescription for ${streamId}. Ignoring answer.`);
                    return;
                }
                // Re-throw other errors
                throw err;
            }

            // Modern browsers handle ICE candidate queueing internally
            // No need to manually process queued candidates
        }

        /**
         * Handle ICE candidate received from remote (Java) agent
         * Modern browsers handle ICE candidate queueing internally if remote description not yet set
         */
        async handleIceCandidate(streamId, candidate) {
            const pc = this.peerConnections.get(streamId);
            if (!pc) return console.warn(`[WebRTC] No peer connection for ${streamId}`);

            // Modern browsers can handle addIceCandidate even before setRemoteDescription
            // The browser will queue candidates internally if needed
            try {
                await pc.addIceCandidate(new _RTCIceCandidate({
                    candidate: candidate.candidate,
                    sdpMid: candidate.sdpMid,
                    sdpMLineIndex: candidate.sdpMLineIndex
                }));
                console.log(`[WebRTC] Added remote ICE candidate for ${streamId}`);
            } catch (err) {
                console.error(`[WebRTC] Failed to add ICE candidate for ${streamId}:`, err);
            }
        }

        /**
         * Close a stream session
         * @returns {Promise<void>} Resolves when stream is closed
         */
        closeStream(streamId) {
            try {
                const pc = this.peerConnections.get(streamId);
                if (pc) {
                    pc.close();
                    this.peerConnections.delete(streamId);
                }

                const local = this.localStreams.get(streamId);
                if (local) {
                    // Do not stop tracks if this is the defaultLocalStream (page manages camera lifecycle)
                    if (local !== this.defaultLocalStream) {
                        local.getTracks().forEach(t => t.stop());
                    }
                    this.localStreams.delete(streamId);
                }

                // Clean up remote stream if exists
                const remote = this.remoteStreams.get(streamId);
                if (remote) {
                    // Handle both formats: plain stream or { sourceAgent, stream }
                    const stream = remote.stream || remote;
                    if (stream?.getTracks) {
                        stream.getTracks().forEach(t => t.stop());
                    }
                    this.remoteStreams.delete(streamId);
                }

                this.streamSessions.delete(streamId);
                console.log(`[WebRTC] Closed stream ${streamId}`);

                return Promise.resolve();
            } catch (err) {
                console.error(`[WebRTC] Error closing stream ${streamId}:`, err);
                return Promise.reject(err);
            }
        }

        /**
         * Close all active stream sessions
         */
        closeAllStreams() {
            const streamIds = Array.from(this.peerConnections.keys());
            console.log(`[WebRTC] Closing ${streamIds.length} stream(s)`);

            streamIds.forEach(streamId => {
                this.closeStream(streamId);
            });

            console.log(`[WebRTC] All streams closed`);
        }

        // Allow page to register a default local MediaStream (e.g., camera) to be used when answering offers
        setLocalMediaStream(stream) {
            this.defaultLocalStream = stream;
        }

        /**
         * Setup event handlers for a data channel
         * @param {RTCDataChannel} dataChannel - The data channel
         * @param {string} peerId - The peer ID
         * @param {RTCPeerConnection} pc - The peer connection (for state validation)
         */
        _setupDataChannelHandlers(dataChannel, peerId, pc) {
            dataChannel.onopen = () => {
                // Calculate connection time
                const startTime = this.dataChannelStartTimes.get(peerId);
                let connectionTimeMs = null;
                if (startTime) {
                    connectionTimeMs = Date.now() - startTime;
                    this.dataChannelStartTimes.delete(peerId);
                    console.log(`[WebRTC DataChannel] ⏱️  OPEN with ${peerId} (took ${connectionTimeMs}ms)`);
                } else {
                    console.log(`[WebRTC DataChannel] OPEN with ${peerId}`);
                }

                // Emit datachannel-open event with timing info
                this.emit('datachannel-open', peerId, dataChannel, connectionTimeMs);
            };

            dataChannel.onclose = () => {
                console.log(`[WebRTC DataChannel] CLOSED with ${peerId}`);
                this.dataChannels.delete(peerId);
                this.emit('datachannel-close', peerId);
            };

            dataChannel.onerror = (error) => {
                // Check if this is a graceful close (User-Initiated Abort)
                const isGracefulClose = error?.error?.message?.includes('User-Initiated Abort') ||
                                       error?.error?.message?.includes('Close called');

                if (isGracefulClose) {
                    console.log(`[WebRTC DataChannel] Graceful close for ${peerId}`);
                } else {
                    console.error(`[WebRTC DataChannel] ERROR with ${peerId}:`, error);
                }

                this.emit('datachannel-error', peerId, error, isGracefulClose);
            };

            dataChannel.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.emit('datachannel-message', peerId, data);
                } catch (e) {
                    console.warn('[WebRTC DataChannel] Failed to parse message:', e);
                }
            };
        }

        /**
         * Send data through the data channel
         * @param {string} peerId - The peer agent name
         * @param {Object} data - Data to send (will be JSON stringified)
         */
        sendData(peerId, data) {
            const dataChannel = this.dataChannels.get(peerId);

            if (!dataChannel) {
                console.warn(`[WebRTC DataChannel] No data channel for ${peerId}`);
                return false;
            }

            if (dataChannel.readyState !== 'open') {
                console.warn(`[WebRTC DataChannel] Data channel not open for ${peerId}, state: ${dataChannel.readyState}`);
                return false;
            }

            try {
                dataChannel.send(JSON.stringify(data));
                return true;
            } catch (e) {
                console.error(`[WebRTC DataChannel] Failed to send data to ${peerId}:`, e);
                return false;
            }
        }

        /**
         * Broadcast data to all connected peers via data channels
         * @param {Object} data - Data to broadcast
         * @returns {number} Number of peers data was sent to
         */
        broadcastDataChannel(data) {
            let count = 0;
            this.dataChannels.forEach((dc, peerId) => {
                if (this.sendData(peerId, data)) {
                    count++;
                }
            });
            return count;
        }

        /**
         * Close data channel with a peer
         * @param {string} peerId - The peer agent name
         */
        closeDataChannel(peerId) {
            const dataChannel = this.dataChannels.get(peerId);
            if (dataChannel) {
                dataChannel.close();
                this.dataChannels.delete(peerId);
                console.log(`[WebRTC DataChannel] Closed data channel with ${peerId}`);
            }
        }

        /**
         * Get list of peers with active (open) DataChannels
         * @returns {Array<string>} Array of peer IDs with open data channels
         */
        getActiveDataChannels() {
            const active = [];
            this.dataChannels.forEach((dc, peerId) => {
                if (dc.readyState === 'open') {
                    active.push(peerId);
                }
            });
            return active;
        }

        /**
         * Get statistics about current WebRTC state
         * @returns {Object} Statistics object
         */
        getStats() {
            return {
                peerConnections: this.peerConnections.size,
                remoteStreams: this.remoteStreams.size,
                localStreams: this.localStreams.size,
                dataChannels: this.dataChannels.size,
                activeDataChannels: this.getActiveDataChannels().length,
                ready: _RTCPeerConnection !== null
            };
        }

        // ------------------------------------------------------------------
        // Internal Helpers
        // ------------------------------------------------------------------
        _createPeerConnection(channel, remoteAgent, streamId) {
            // Check if RTCPeerConnection is available
            if (!_RTCPeerConnection) {
                const errorMsg = 'RTCPeerConnection is not available. ' +
                    (typeof module !== 'undefined' && module.exports ?
                        'In Node.js, install wrtc module: npm install @roamhq/wrtc or npm install wrtc' :
                        'In browser, WebRTC is not supported');
                console.error('[WebRTC]', errorMsg);
                throw new Error(errorMsg);
            }

            const usedChannel = channel || this.channel;
            const pc = new _RTCPeerConnection({
                iceServers: this.getIceServersFromConfig(usedChannel)
            });
            this.peerConnections.set(streamId, pc);

            // Track peer connection creation time
            this.peerConnectionStartTimes.set(streamId, Date.now());
            console.log(`[WebRTC] 🔌 Peer connection created for ${streamId}`);

            // --- Local ICE candidates ---
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log(`[WebRTC] Local ICE candidate for ${streamId}`);
                    this.emit('ice-candidate', streamId, event.candidate);

                    // Send ICE to remote agent
                    if (usedChannel && typeof usedChannel.sendWebRtcSignaling === 'function') {
                        usedChannel.sendWebRtcSignaling({
                            type: 'ice-candidate',
                            candidate: {
                                candidate: event.candidate.candidate,
                                sdpMLineIndex: event.candidate.sdpMLineIndex,
                                sdpMid: event.candidate.sdpMid
                            },
                            streamSessionId: streamId
                        }, remoteAgent);
                    } else {
                        console.warn('[WebRTC] No signaling channel available to send ICE candidate');
                    }
                }
            };

            // Connection timeout handling
            let connectionTimeout = null;
            const CONNECTION_TIMEOUT_MS = 30000; // 30 seconds

            pc.onconnectionstatechange = () => {
                console.log(`[WebRTC] Connection state (${streamId}): ${pc.connectionState}`);
                // Emit connection-state for UI
                this.emit('connection-state', streamId, pc.connectionState);

                // Handle connection timeout
                if (pc.connectionState === 'connecting' || pc.connectionState === 'new') {
                    // Start timeout timer
                    if (connectionTimeout) clearTimeout(connectionTimeout);
                    connectionTimeout = setTimeout(() => {
                        if (pc.connectionState === 'connecting' || pc.connectionState === 'new') {
                            console.warn(`[WebRTC] Connection timeout for ${streamId}, closing`);
                            pc.close();
                            this.emit('connection-state', streamId, 'failed');
                        }
                    }, CONNECTION_TIMEOUT_MS);
                } else {
                    // Clear timeout on state change
                    if (connectionTimeout) {
                        clearTimeout(connectionTimeout);
                        connectionTimeout = null;
                    }
                }

                // When connected or completed, emit stream-ready (include remoteAgent if available)
                if (pc.connectionState === 'connected' || pc.connectionState === 'completed') {
                    const session = this.streamSessions.get(streamId) || {};
                    const remoteAgent = session.remoteAgent || null;

                    // Calculate peer connection time (from peer creation to ready)
                    const peerStartTime = this.peerConnectionStartTimes.get(streamId);
                    let peerConnectionTimeMs = null;
                    if (peerStartTime) {
                        peerConnectionTimeMs = Date.now() - peerStartTime;
                        this.peerConnectionStartTimes.delete(streamId);
                        console.log(`[WebRTC] ⏱️  Peer connection ready for ${streamId} (took ${peerConnectionTimeMs}ms from peer creation to ready)`);
                    }

                    // Calculate connection time (from stream creation start)
                    const startTime = this.streamStartTimes.get(streamId);
                    let connectionTimeMs = null;
                    if (startTime) {
                        connectionTimeMs = Date.now() - startTime;
                        this.streamStartTimes.delete(streamId);
                        console.log(`[WebRTC] ⏱️  Stream ready for ${streamId} (took ${connectionTimeMs}ms)`);
                    }

                    this.emit('stream-ready', streamId, remoteAgent, connectionTimeMs, peerConnectionTimeMs);
                }
            };

            pc.ontrack = (event) => {
                console.log(`[WebRTC] Remote track received for ${streamId}:`, event.track.kind);
                const stream = event.streams[0] || new _MediaStream([event.track]);

                // Get source agent from session if available
                const session = this.streamSessions.get(streamId);
                const sourceAgent = session?.remoteAgent || remoteAgent || 'Unknown';

                // Store remote stream in remoteStreams Map
                // Use object format for SFU compatibility: { sourceAgent, stream }
                const existingInfo = this.remoteStreams.get(streamId);
                if (existingInfo?.stream) {
                    // Add new track to existing stream
                    if (!existingInfo.stream.getTracks().find(t => t.id === event.track.id)) {
                        existingInfo.stream.addTrack(event.track);
                    }
                } else {
                    // Store new stream with sourceAgent
                    this.remoteStreams.set(streamId, { sourceAgent, stream });
                }

                this.emit('remote-stream', streamId, stream, sourceAgent);
            };

            return pc;
        }

        async _getLocalStream(constraints = {}) {
            const defaults = {
                video: {
                    width: constraints.width || {ideal: 1280},
                    height: constraints.height || {ideal: 720},
                    frameRate: constraints.frameRate || {ideal: 30}
                },
                audio: constraints.audio !== false
            };
            console.log('[WebRTC] getUserMedia', defaults);
            return await navigator.mediaDevices.getUserMedia(defaults);
        }

        _id() {
            return 'stream_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now();
        }
    }

    // Export for different environments
    // Node.js / CommonJS
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { WebRtcHelper };
    }

    // Browser global
    if (typeof window !== 'undefined') {
        window.WebRtcHelper = WebRtcHelper;
    }

    // AMD / RequireJS
    if (typeof define === 'function' && define.amd) {
        define('WebRtcHelper', [], function() { return WebRtcHelper; });
    }

    // Global fallback
    if (typeof global !== 'undefined' && !global.WebRtcHelper) {
        global.WebRtcHelper = WebRtcHelper;
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
