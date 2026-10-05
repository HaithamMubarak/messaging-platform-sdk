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
    // PeerFiles: sendFile / receive, over the peer's own data channel
    // =========================================================================
    //
    // Six apps each carried a file transfer of their own: three JSON+base64
    // (a third bigger on the wire, no backpressure, no integrity check) and
    // three raw-binary copies of one engine that had to take over the data
    // channel's onmessage, because this helper JSON-parsed every frame and
    // dropped the binary ones. This is that engine, in the helper:
    //
    //   {__mpFile:'start', id, name, size, mime, sha256}   JSON, sender -> receiver
    //   <8-byte id><bytes>                                  binary, one per chunk
    //   {__mpFile:'end', id}                                JSON
    //   {__mpFile:'done', id, ok, reason}                   JSON, receiver -> sender
    //
    // It needs the channel to be ordered and reliable, because the control
    // messages and the chunks share it and a lost chunk is a corrupt file; it
    // refuses to send on any other. The sender waits on bufferedAmount rather
    // than a timer, and the promise resolves only when the RECEIVER has
    // checked the SHA-256 and said so -- "sent" is not "arrived".

    const FILE_ID_BYTES = 8;
    const FILE_HIGH_WATER = 1024 * 1024;
    const FILE_LOW_WATER = 256 * 1024;
    const FILE_ACK_TIMEOUT_MS = 60000;

    async function fileSha256Hex(bytes) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    function fileId() {
        let id = '';
        while (id.length < FILE_ID_BYTES) id += Math.random().toString(36).slice(2);
        return id.slice(0, FILE_ID_BYTES);
    }

    class PeerFiles {
        constructor(helper) {
            this.helper = helper;
            this.maxBytes = 256 * 1024 * 1024;   // largest file this side accepts
            this.outgoing = new Map();           // id -> {peerId, resolve, reject, timer}
            this.incoming = new Map();           // id -> {peerId, meta, parts, got}
        }

        /** Reliable and ordered, or a file cannot survive the trip. */
        _channelFor(peerId) {
            const dc = this.helper.dataChannels.get(peerId);
            if (!dc || dc.readyState !== 'open') throw new Error('No open data channel with ' + peerId + '.');
            const reliable = dc.ordered !== false && dc.maxRetransmits == null && dc.maxPacketLifeTime == null;
            if (!reliable) throw new Error('The data channel with ' + peerId + ' is not reliable and ordered.');
            return dc;
        }

        _control(dc, msg) {
            dc.send(JSON.stringify(Object.assign({ __mpFile: true }, msg)));
        }

        /** Resolve when the channel has room again; reject if it closes first. */
        _drain(dc) {
            if (dc.bufferedAmount <= FILE_HIGH_WATER) return Promise.resolve();
            dc.bufferedAmountLowThreshold = FILE_LOW_WATER;
            return new Promise((resolve, reject) => {
                const done = (ok) => () => {
                    dc.removeEventListener('bufferedamountlow', onLow);
                    dc.removeEventListener('close', onClose);
                    ok ? resolve() : reject(new Error('The data channel closed mid-transfer.'));
                };
                const onLow = done(true), onClose = done(false);
                dc.addEventListener('bufferedamountlow', onLow);
                dc.addEventListener('close', onClose);
            });
        }

        async send(peerId, file, options) {
            const opts = options || {};
            const dc = this._channelFor(peerId);
            const chunk = Math.max(1024, opts.chunkBytes || 16 * 1024);
            const bytes = new Uint8Array(await file.arrayBuffer());
            const id = fileId();
            const meta = { id, name: opts.name || file.name || 'file', size: bytes.length,
                mime: file.type || 'application/octet-stream', sha256: await fileSha256Hex(bytes) };
            const arrived = this._awaitDone(id, peerId);
            // A refusal can land while chunks are still going out, before
            // anything awaits this; it is awaited below, so it is not lost.
            arrived.catch(() => {});
            try {
                this._control(dc, Object.assign({ phase: 'start' }, meta));
                await this._pump(dc, id, bytes, chunk, opts.onProgress);
                if (this.outgoing.has(id)) this._control(dc, { phase: 'end', id });
            } catch (e) {
                this._settle(id, false, e.message);
            }
            this._armTimeout(id);
            await arrived;
            return meta;
        }

        /** The chunks, paced by the channel's buffer; stops if the receiver said no. */
        async _pump(dc, id, bytes, chunk, onProgress) {
            const tag = new TextEncoder().encode(id);
            for (let at = 0; at < bytes.length && this.outgoing.has(id); at += chunk) {
                await this._drain(dc);
                const part = bytes.subarray(at, Math.min(at + chunk, bytes.length));
                const frame = new Uint8Array(FILE_ID_BYTES + part.length);
                frame.set(tag, 0);
                frame.set(part, FILE_ID_BYTES);
                dc.send(frame.buffer);
                if (onProgress) onProgress({ id, sent: at + part.length, size: bytes.length });
            }
        }

        _awaitDone(id, peerId) {
            return new Promise((resolve, reject) => this.outgoing.set(id, { peerId, resolve, reject, timer: null }));
        }

        _armTimeout(id) {
            const out = this.outgoing.get(id);
            if (!out) return;
            out.timer = setTimeout(() => this._settle(id, false, 'no_answer'), FILE_ACK_TIMEOUT_MS);
        }

        _settle(id, ok, reason) {
            const out = this.outgoing.get(id);
            if (!out) return;
            this.outgoing.delete(id);
            clearTimeout(out.timer);
            ok ? out.resolve() : out.reject(new Error('The file did not arrive: ' + (reason || 'refused') + '.'));
        }

        /** A JSON frame with __mpFile. Returns true when it was ours. */
        onControl(peerId, msg) {
            if (msg.phase === 'start') this._start(peerId, msg);
            else if (msg.phase === 'end') this._finish(peerId, msg.id);
            else if (msg.phase === 'done') this._settle(msg.id, !!msg.ok, msg.reason);
            return true;
        }

        _start(peerId, meta) {
            if (!(meta.size <= this.maxBytes)) {
                this._reply(peerId, meta.id, false, 'too_large');
                return;
            }
            const info = { id: meta.id, name: meta.name, size: meta.size, mime: meta.mime, sha256: meta.sha256 };
            this.incoming.set(meta.id, { peerId, meta: info, parts: [], got: 0 });
            this.helper.emit('file-start', peerId, info);
        }

        onChunk(peerId, buffer) {
            const id = new TextDecoder().decode(new Uint8Array(buffer, 0, FILE_ID_BYTES));
            const entry = this.incoming.get(id);
            if (!entry || entry.peerId !== peerId) return;   // refused, or not from its sender
            const part = buffer.slice(FILE_ID_BYTES);
            entry.parts.push(part);
            entry.got += part.byteLength;
            this.helper.emit('file-progress', peerId, { id, received: entry.got, size: entry.meta.size });
        }

        async _finish(peerId, id) {
            const entry = this.incoming.get(id);
            if (!entry || entry.peerId !== peerId) return;
            this.incoming.delete(id);
            const blob = new Blob(entry.parts, { type: entry.meta.mime });
            const whole = entry.got === entry.meta.size;
            const intact = whole && await fileSha256Hex(new Uint8Array(await blob.arrayBuffer())) === entry.meta.sha256;
            const reason = !whole ? 'incomplete' : (intact ? null : 'corrupt');
            this._reply(peerId, id, intact, reason);
            if (intact) this.helper.emit('file', peerId, Object.assign({ blob }, entry.meta));
            else this.helper.emit('file-failed', peerId, { id, name: entry.meta.name, reason });
        }

        _reply(peerId, id, ok, reason) {
            try { this._control(this._channelFor(peerId), { phase: 'done', id, ok, reason }); }
            catch (e) { /* the sender times out; nothing more honest to do */ }
        }

        /** The channel to a peer closed: everything in flight with it failed. */
        dropPeer(peerId) {
            this.outgoing.forEach((out, id) => { if (out.peerId === peerId) this._settle(id, false, 'channel_closed'); });
            this.incoming.forEach((entry, id) => {
                if (entry.peerId !== peerId) return;
                this.incoming.delete(id);
                this.helper.emit('file-failed', peerId, { id, name: entry.meta.name, reason: 'channel_closed' });
            });
        }
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
            this.files = new PeerFiles(this);         // sendFile / 'file' events over the data channels
            // How a broken connection is brought back (see "Reconnecting"). Tunable per helper.
            this.reconnect = {
                disconnectedGraceMs: 4000,   // 'disconnected' often heals by itself
                attemptTimeoutMs: 10000,     // how long one attempt gets to reach 'connected'
                maxAttempts: 4,              // one ICE restart, then new connections
                offlinePollMs: 2000,         // while offline, how often to look again
                answererGiveUpMs: 45000,     // answerer: how long to wait for the offerer to come back
                dataChannelCloseGraceMs: 1500 // answerer: a closed channel may be a rebuild about to arrive
            };
            if (typeof window !== 'undefined' && window.addEventListener) {
                this._onlineListener = () => this._onOnline();
                window.addEventListener('online', this._onlineListener);
            }

            // For Node.js SFU compatibility
            this.ready = _RTCPeerConnection !== null;
            this.initPromise = Promise.resolve();

            // Store optional channel for signaling (can still be passed per-call)
            this.channel = channel;

            // Handle all signaling events from agents
            channel.onWebRtcSignaling = (msg) => this._onSignal(msg);
        }

        /** Handle all signaling events from agents. */
        async _onSignal({streamId, sourceAgent, signalingMsg}) {
            console.log('[WebRTC] SIGNAL from agent:', streamId, signalingMsg);

            try {
                const type = signalingMsg.type;

                if (type === 'offer') {
                    await this.handleSdpOffer(streamId, sourceAgent, signalingMsg.sdp, signalingMsg);
                } else if (type === 'answer') {
                    await this.handleSdpAnswer(streamId, sourceAgent, signalingMsg.sdp);
                } else if (type === 'ice-candidate') {
                    await this.handleIceCandidate(streamId, signalingMsg.candidate);
                } else if (type === 'bye') {
                    this._onBye(streamId, sourceAgent, signalingMsg);
                } else {
                    console.warn('[WebRTC] Unknown signaling type:', type);
                }
            } catch (err) {
                console.error('[WebRTC] Failed to process signaling message:', err);
            }
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
         * - Example: TURN_SERVER=turn.example.com:3478
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
                // No hardcoded defaults here: this file ships to browsers, so a
                // literal host or credential is public the moment it is written.
                // Node.js callers must supply whatever they want used.
                const turnServer = process.env.TURN_SERVER;
                const stunServer = process.env.STUN_SERVER;
                const turnUsername = process.env.TURN_USERNAME;
                // TURN_CREDENTIAL is what the deployment actually sets, and
                // reading only TURN_PASSWORD is what silently broke the SFU:
                // see the note below.
                const turnPassword = process.env.TURN_PASSWORD || process.env.TURN_CREDENTIAL;

                // If custom TURN/STUN servers are configured in environment
                if (turnServer || stunServer) {
                    const turn = turnServer || stunServer;
                    const stun = stunServer || turnServer;

                    console.log(`[WebRTC] Node.js: Using TURN/STUN from process.env - TURN: ${turn}, STUN: ${stun}`);

                    /*
                     * A TURN URL WITHOUT A CREDENTIAL POISONS THE WHOLE LIST.
                     *
                     * This used to return one entry mixing stun: and turn: URLs
                     * with `credential: undefined`, because it read only
                     * TURN_PASSWORD while the deployment sets TURN_CREDENTIAL.
                     * In a browser that is merely ignored. In node, wrtc's
                     * parser rejects it and `new RTCPeerConnection` THROWS
                     * "ICE server parse failed" — so the SFU could not build a
                     * peer connection at all, every SDP offer it received died
                     * in the handler, and the relay never answered anybody.
                     * That is why thirteen relay agents ran for weeks with
                     * sourceStreams: 0. One missing environment variable, and
                     * the failure surfaced nowhere near it.
                     *
                     * So: STUN and TURN are separate entries, and TURN is
                     * included only when there is something to authenticate
                     * with. Losing TURN degrades reachability; an unparseable
                     * list loses WebRTC entirely.
                     */
                    const servers = [{ urls: `stun:${stun}` }];
                    if (turnUsername && turnPassword) {
                        servers.push({
                            urls: [`turn:${turn}?transport=udp`, `turn:${turn}?transport=tcp`],
                            username: turnUsername,
                            credential: turnPassword,
                        });
                    } else {
                        console.warn('[WebRTC] TURN configured without credentials '
                            + '(TURN_USERNAME + TURN_PASSWORD/TURN_CREDENTIAL); '
                            + 'using STUN only rather than an ICE list that will not parse.');
                    }
                    servers.push({ urls: 'stun:stun.l.google.com:19302' });
                    return servers;
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
         *   - { stream: myMediaStream } - Send a stream the caller owns
         *   - { sourceStreamId: 'stream_123' } - Relay existing stream (SFU mode)
         *
         * The returned id names the stream for its whole life. If the
         * connection breaks, this side reconnects it under the SAME id (see
         * _recover), so the caller's bookkeeping never changes. A stream the
         * caller passes in stays the caller's: closing never stops its tracks.
         */
        async createStreamOffer(remoteAgent, constraints = {}) {
            if (!this.channel) {
                throw new Error('No signaling channel provided to WebRtcHelper constructor');
            }

            const streamId = this._id();
            const hasMedia = !!(constraints.video || constraints.audio || constraints.stream || constraints.sourceStreamId);
            const session = {
                id: streamId,
                remoteAgent,
                role: 'offer',
                state: 'creating',
                hasMedia,
                hasDataChannel: constraints.dataChannel,
                sourceStreamId: constraints.sourceStreamId,  // For SFU relay
                ownsLocal: false,
                attempts: 0
            };
            this.streamSessions.set(streamId, session);

            try {
                if (hasMedia) {
                    const media = await this._resolveOfferStream(constraints);
                    if (media.stream) this.localStreams.set(streamId, media.stream);
                    session.ownsLocal = media.owned;
                }
                await this._offerOnNewConnection(streamId);
            } catch (err) {
                this.closeStream(streamId, { notify: false, reason: 'failed' });
                throw err;
            }

            console.log(`[WebRTC] Sent SDP offer to ${remoteAgent}, streamId=${streamId}`);
            return streamId;
        }

        /** The MediaStream an offer carries, and whether this helper acquired it. */
        async _resolveOfferStream(constraints) {
            // SFU relay mode: Get stream from existing remote stream
            if (constraints.sourceStreamId) {
                const sourceInfo = this.remoteStreams.get(constraints.sourceStreamId);
                if (!sourceInfo) return { stream: null, owned: false };
                console.log(`[WebRTC] Relaying source stream ${constraints.sourceStreamId}`);
                // remoteStreams stores { sourceAgent, stream } in SFU, or just stream in browser
                return { stream: sourceInfo.stream || sourceInfo, owned: false };
            }
            // Allow passing an existing MediaStream via constraints.stream
            if (constraints.stream && typeof constraints.stream.getTracks === 'function') {
                return { stream: constraints.stream, owned: false };
            }
            return { stream: await this._getLocalStream(constraints), owned: true };
        }

        /** Build a connection for an offer session and send its offer: to start, and to rebuild. */
        async _offerOnNewConnection(streamId) {
            const session = this.streamSessions.get(streamId);
            const pc = this._createPeerConnection(this.channel, session.remoteAgent, streamId);
            if (session.hasDataChannel) this._openOfferDataChannel(pc, session);
            if (session.hasMedia) this._addOfferMedia(pc, this.localStreams.get(streamId), session.remoteAgent);
            await this._sendOffer(streamId, pc, {});
        }

        _openOfferDataChannel(pc, session) {
            const dcConfig = typeof session.hasDataChannel === 'object' ? session.hasDataChannel : {};
            const channelName = dcConfig.name || 'data';
            const channelOptions = dcConfig.options || {
                ordered: false,
                maxRetransmits: 0
            };

            const dataChannel = pc.createDataChannel(channelName, channelOptions);
            session.dataChannel = dataChannel;
            this.dataChannels.set(session.remoteAgent, dataChannel);
            this._setupDataChannelHandlers(dataChannel, session.remoteAgent, pc);

            console.log(`[WebRTC] Created DataChannel "${channelName}" for peer ${session.remoteAgent}`);
        }

        _addOfferMedia(pc, mediaStream, remoteAgent) {
            let hasVideo = false, hasAudio = false;
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => {
                    if (track.readyState === 'live' || track.readyState === undefined) {
                        pc.addTrack(track, mediaStream);
                        if (track.kind === 'video') hasVideo = true;
                        if (track.kind === 'audio') hasAudio = true;
                    }
                });
                console.log(`[WebRTC] Added media stream to offer for ${remoteAgent}`);
            }
            // Add transceivers for missing media types (needed for wrtc)
            if (!hasVideo) pc.addTransceiver('video', {direction: 'recvonly'});
            if (!hasAudio) pc.addTransceiver('audio', {direction: 'recvonly'});
        }

        /**
         * Create, apply and send an offer on `pc`. `renegotiate` tells the
         * answerer to apply it to the connection it already has for this id
         * (an ICE restart) rather than build a new one.
         */
        async _sendOffer(streamId, pc, { iceRestart = false, renegotiate = false }) {
            const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
            await pc.setLocalDescription(offer);

            const session = this.streamSessions.get(streamId);
            if (!session || this.peerConnections.get(streamId) !== pc) return;   // closed meanwhile
            session.state = 'offer-created';
            session.renegotiating = renegotiate;

            // Emit an 'offer' event so the UI can react
            this.emit('offer', streamId, offer.sdp);

            // Send to remote agent via channel, with the candidates in it.
            const msg = { type: 'offer', sdp: await this._gatheredSdp(pc, offer.sdp), streamSessionId: streamId };
            if (renegotiate) msg.renegotiate = true;
            this.channel.sendWebRtcSignaling(msg, session.remoteAgent);
        }

        /**
         * Handle an incoming SDP offer (answerer role)
         * Automatically detects DataChannel and/or media stream from SDP
         *
         * An offer for an id this side already has is one of two things. With
         * `renegotiate` it is an ICE restart of that same connection and is
         * applied to it. Without, the offerer rebuilt the connection, so the
         * old one is closed first: it used to be overwritten in the map and
         * left running, holding its tracks and its data channel.
         */
        async handleSdpOffer(streamId, sourceAgent, sdpOffer, msg = {}) {
            if (!this.channel) {
                throw new Error('No signaling channel provided to WebRtcHelper constructor');
            }

            console.log(`[WebRTC] Received SDP offer for ${streamId} from ${sourceAgent}`);
            const existing = this.peerConnections.get(streamId);
            const known = this.streamSessions.get(streamId);
            if (known && known.remoteAgent !== sourceAgent) {
                return console.warn(`[WebRTC] Ignoring offer for ${streamId} from ${sourceAgent}: it belongs to ${known.remoteAgent}`);
            }
            if (msg.renegotiate) {
                if (existing) return this._answerOn(streamId, existing, sdpOffer);
                // We no longer have what it restarts (this tab reloaded): ask for a new one.
                this.channel.sendWebRtcSignaling({ type: 'bye', reason: 'unknown-stream', streamSessionId: streamId }, sourceAgent);
                return;
            }
            if (existing) this._teardown(streamId, { replacing: true });

            // Detect what's in the SDP
            const hasDataChannel = sdpOffer.includes('m=application');
            const hasMedia = sdpOffer.includes('m=video') || sdpOffer.includes('m=audio');
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
            if (hasDataChannel) this._acceptDataChannel(pc, streamId, sourceAgent);

            // Add transceivers BEFORE setRemoteDescription. REQUIRED for Node.js
            // wrtc ONLY; browsers handle transceivers automatically.
            if (hasMedia && isNode) {
                pc.addTransceiver('video', {direction: 'recvonly'});
                pc.addTransceiver('audio', {direction: 'recvonly'});
                console.log('[WebRTC] Node.js: Added video + audio transceivers (recvonly)');
            }

            // Attach answerer media so P2P media is bidirectional rather than
            // only flowing from offerer to answerer.
            await this._answerOn(streamId, pc, sdpOffer, hasMedia ? this.defaultLocalStream : null);
        }

        /** Receiver side of a data channel: wait for the offerer's to arrive. */
        _acceptDataChannel(pc, streamId, sourceAgent) {
            console.log(`[WebRTC] DataChannel detected in offer from ${sourceAgent}`);
            this.dataChannelStartTimes.set(sourceAgent, Date.now());

            pc.ondatachannel = (event) => {
                const session = this.streamSessions.get(streamId);
                if (!session || this.peerConnections.get(streamId) !== pc) return;
                console.log(`[WebRTC] Received DataChannel from ${sourceAgent}:`, event.channel.label);
                session.dataChannel = event.channel;
                this.dataChannels.set(sourceAgent, event.channel);
                this._setupDataChannelHandlers(event.channel, sourceAgent, pc);
            };
        }

        /** Apply an offer to `pc` and send the answer: first offers and ICE restarts alike. */
        async _answerOn(streamId, pc, sdpOffer, localStream = null) {
            if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
                // Only the offerer starts a round, so this is a stale half-round; the newer offer wins.
                await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
            }
            await pc.setRemoteDescription(new _RTCSessionDescription({type: 'offer', sdp: sdpOffer}));
            // The other side may have trickled candidates before this point.
            await this._flushIce(streamId);

            if (localStream) {
                localStream.getTracks().forEach(track => {
                    if (track.readyState === 'live' || track.readyState === undefined) {
                        pc.addTrack(track, localStream);
                    }
                });
                console.log(`[WebRTC] Added answerer local media for ${streamId}`);
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            const session = this.streamSessions.get(streamId);
            if (!session || this.peerConnections.get(streamId) !== pc) return;   // closed meanwhile
            session.state = 'answer-created';

            this.channel.sendWebRtcSignaling({
                type: 'answer',
                sdp: await this._gatheredSdp(pc, answer.sdp),
                streamSessionId: streamId
            }, session.remoteAgent);

            // Emit an 'answer' event after sending answer so UI can log it
            this.emit('answer', streamId, answer.sdp);
            console.log(`[WebRTC] Sent SDP answer for ${streamId}`);
        }

        /**
         * Wait for ICE gathering, then hand back the description that has the
         * candidates in it.
         *
         * WHY THIS EXISTS. Trickle ICE sends each candidate as its own
         * signalling message. Between a node peer and a browser those messages
         * go over the messaging channel, and in practice almost none of them
         * survived the trip: the browser would end up with a single remote
         * candidate out of the dozens the relay emitted, and whether the
         * connection came up at all depended on which one that was. Half the
         * spike runs connected and half stalled in "checking" — the classic
         * shape of a lossy signalling path, not of a broken network.
         *
         * Waiting for gathering to finish puts every candidate in the SDP
         * itself, which is one message and cannot be half-delivered. It costs
         * a little setup latency and it is what makes this reliable. Trickle
         * still runs alongside; this only removes the dependence on it.
         *
         * The wait is bounded: an unreachable STUN server never completes
         * gathering, and blocking forever on that would be worse than the
         * problem being solved.
         */
        async _gatheredSdp(pc, fallbackSdp, timeoutMs = 3000) {
            /*
             * ONLY IN NODE. Measured, not assumed: waiting here made the
             * node relay work and made the BROWSER-to-browser mesh stop
             * working — the Rooms suite went from 91 green to ten media
             * assertions red and back again with this one line. Browsers
             * trickle over this channel reliably and always have; the node
             * peer is the one whose candidates go missing. So the wait is
             * applied where the evidence says it is needed and nowhere else.
             */
            const inNode = typeof process !== 'undefined'
                && process.versions && process.versions.node
                && typeof window !== 'undefined' && window === global;
            if (!inNode) return fallbackSdp;

            if (pc.iceGatheringState !== 'complete') {
                await new Promise((resolve) => {
                    const done = () => {
                        if (pc.iceGatheringState !== 'complete') return;
                        pc.removeEventListener('icegatheringstatechange', done);
                        clearTimeout(timer);
                        resolve();
                    };
                    const timer = setTimeout(() => {
                        pc.removeEventListener('icegatheringstatechange', done);
                        console.warn('[WebRTC] ICE gathering did not finish in time; '
                            + 'sending what we have and relying on trickle.');
                        resolve();
                    }, timeoutMs);
                    pc.addEventListener('icegatheringstatechange', done);
                    done();
                });
            }
            return (pc.localDescription && pc.localDescription.sdp) || fallbackSdp;
        }

        /**
         * Handle incoming SDP answer from remote agent
         */
        async handleSdpAnswer(streamId, sourceAgent, sdpAnswer) {
            const pc = this.peerConnections.get(streamId);
            if (!pc) return console.warn(`[WebRTC] No PeerConnection for ${streamId}`);

            const session = this.streamSessions.get(streamId);
            if (session && session.remoteAgent !== sourceAgent) {
                return console.warn(`[WebRTC] Ignoring answer for ${streamId} from ${sourceAgent}`);
            }

            // Check if we can set remote description
            if (pc.signalingState === 'stable') {
                // Connection is already stable - a duplicate, or a very fast connection
                console.log(`[WebRTC] SDP answer received for ${streamId} but connection already stable - ignoring`);
                return;
            }

            if (pc.signalingState !== 'have-local-offer') {
                console.warn(`[WebRTC] Cannot set remote answer in state ${pc.signalingState} for ${streamId} - expected 'have-local-offer'`);
                return; // Must return to prevent InvalidStateError
            }

            try {
                await pc.setRemoteDescription(new _RTCSessionDescription({type: 'answer', sdp: sdpAnswer}));
            } catch (err) {
                if (session && session.renegotiating) {
                    // An answerer that rebuilt instead of restarting (an older
                    // SDK, or the relay) answers with a new DTLS identity, which
                    // the existing connection cannot take. Start over on a new one.
                    console.warn(`[WebRTC] ICE restart answer for ${streamId} did not apply (${err.message}); rebuilding`);
                    return this._recover(streamId, { fresh: true });
                }
                // Handle race condition where state changed between check and setRemoteDescription
                if (err.name === 'InvalidStateError') {
                    console.warn(`[WebRTC] Race condition: state changed to ${pc.signalingState} before setRemoteDescription for ${streamId}. Ignoring answer.`);
                    return;
                }
                throw err;
            }

            const restarted = !!(session && session.renegotiating);
            if (session) {
                session.state = 'answer-received';
                session.renegotiating = false;
            }
            console.log(`[WebRTC] Applied remote SDP answer for ${streamId}`);
            await this._flushIce(streamId);
            // A restart of a connection that never went down fires no state
            // change, so 'connected' is not coming: count it as recovered now.
            if (restarted && pc.connectionState === 'connected') this._onConnected(streamId, session);
        }

        /**
         * Handle an ICE candidate from the remote agent.
         *
         * CANDIDATES ARRIVE BEFORE THE ANSWER, AND THEY ARE NOT QUEUED FOR YOU.
         *
         * This used to say browsers queue candidates internally when the
         * remote description is not set yet. They do not: addIceCandidate
         * rejects with InvalidStateError, and the old code logged that and
         * dropped the candidate. Whenever the remote's candidates were
         * trickled ahead of its answer — which is the normal case, because a
         * peer starts gathering the moment it creates its answer — EVERY
         * candidate was thrown away and the connection failed with nothing in
         * the log but a line saying a candidate could not be added.
         *
         * So buffer them, and apply them once there is a remote description.
         * An ICE restart has the same race one level up: the other side's NEW
         * candidates can arrive before the description that introduces their
         * ufrag, so those wait too.
         */
        async handleIceCandidate(streamId, candidate) {
            const pc = this.peerConnections.get(streamId);
            if (!pc) return console.warn(`[WebRTC] No peer connection for ${streamId}`);

            if (!pc.remoteDescription || !this._iceFitsRemote(pc, candidate)) {
                if (!this.pendingIce) this.pendingIce = new Map();
                if (!this.pendingIce.has(streamId)) this.pendingIce.set(streamId, []);
                const queue = this.pendingIce.get(streamId);
                if (queue.length < 200) queue.push(candidate);
                console.log(`[WebRTC] Buffered ICE candidate for ${streamId} (its remote description is not here yet)`);
                return;
            }
            await this._addIce(streamId, pc, candidate);
        }

        /** Does this candidate belong to the remote description we have now? (Its ufrag says.) */
        _iceFitsRemote(pc, candidate) {
            const m = / ufrag (\S+)/.exec((candidate && candidate.candidate) || '');
            if (!m || !pc.remoteDescription || !pc.remoteDescription.sdp) return true;
            return pc.remoteDescription.sdp.indexOf('a=ice-ufrag:' + m[1]) !== -1;
        }

        async _addIce(streamId, pc, candidate) {
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

        /** Apply whatever arrived before the remote description did; drop what an ICE restart outdated. */
        async _flushIce(streamId) {
            const pc = this.peerConnections.get(streamId);
            const queued = this.pendingIce && this.pendingIce.get(streamId);
            if (!pc || !queued || !queued.length) return;
            this.pendingIce.delete(streamId);
            const fits = queued.filter((c) => this._iceFitsRemote(pc, c));
            console.log(`[WebRTC] Applying ${fits.length} buffered ICE candidates for ${streamId}`
                + (fits.length < queued.length ? ` (${queued.length - fits.length} outdated)` : ''));
            for (const c of fits) await this._addIce(streamId, pc, c);
        }

        // ------------------------------------------------------------------
        // Replacing what a stream sends
        // ------------------------------------------------------------------

        /**
         * Send `stream` on an existing outgoing connection instead of what it
         * carries now: camera to screen and back, with no new negotiation.
         *
         * Closing the camera's connection and offering the screen used to be
         * the only way, which costs a full offer/answer round (a black second
         * on every peer, and a chance to lose the offer). replaceTrack swaps
         * the pixels on the connection that is already up. It works for every
         * kind the connection was negotiated to SEND; a kind it only receives
         * (an audio-only call turning video on) needs a new offer, so this
         * resolves false and the caller closes and offers as before.
         *
         * It works from the ANSWERING side too, on the tracks its answer sent
         * (keep setLocalMediaStream current as well: a reconnect answers with it).
         * @returns {Promise<boolean>} true if replaced in place
         */
        async replaceStream(streamId, stream) {
            const pc = this.peerConnections.get(streamId);
            const session = this.streamSessions.get(streamId);
            if (!pc || !session || !stream || typeof pc.getTransceivers !== 'function') return false;

            const plan = ['video', 'audio'].map((kind) => ({
                track: stream.getTracks().find((t) => t.kind === kind && t.readyState !== 'ended') || null,
                tx: pc.getTransceivers().find((t) => !t.stopped && t.receiver && t.receiver.track
                    && t.receiver.track.kind === kind && /send/.test(t.direction))
            }));
            if (plan.some((p) => p.track && !p.tx)) return false;

            await Promise.all(plan.filter((p) => p.tx).map((p) => p.tx.sender.replaceTrack(p.track)));
            console.log(`[WebRTC] Replaced the stream on ${streamId} in place`);
            if (session.role !== 'offer') return true;
            const old = this.localStreams.get(streamId);
            if (old && old !== stream && session.ownsLocal) old.getTracks().forEach((t) => t.stop());
            session.ownsLocal = false;
            this.localStreams.set(streamId, stream);
            return true;
        }

        // ------------------------------------------------------------------
        // Reconnecting
        // ------------------------------------------------------------------
        //
        // A connection that breaks is brought back by the side that offered
        // it, under the same stream id, so neither side's app has to notice:
        //
        //   1. 'disconnected' gets a grace period (a Wi-Fi blip heals itself);
        //      'failed', or a connection that never came up, does not.
        //   2. First an ICE restart on the same connection: the DTLS session,
        //      tracks and data channel all survive it, and a changed network
        //      (Wi-Fi to mobile) is exactly what it is for.
        //   3. If that does not work, a new connection under the same id.
        //   4. After reconnect.maxAttempts, close it and say 'stream-failed'.
        //
        // While the device is offline, or the signalling socket is down,
        // nothing can be negotiated, so the attempts WAIT rather than being
        // spent; coming back online restarts every broken stream at once.
        // The answerer never starts a round (no glare); it waits for the
        // offerer, and lets go after reconnect.answererGiveUpMs if the
        // offerer's tab has gone for good.
        //
        // Events: 'stream-reconnecting' (id, peer, attempt),
        // 'stream-recovered' (id, peer, attempts), 'stream-failed' (id, peer),
        // 'stream-closed' (id, peer, reason: local | remote | failed).

        /** Reconnect an outgoing stream now, rather than waiting for it to fail. */
        restartStream(streamId) {
            const session = this.streamSessions.get(streamId);
            if (!session || session.role !== 'offer') return false;
            session.attempts = 0;
            this._recover(streamId);
            return true;
        }

        /** Can a negotiation round get to the other side at all right now? */
        _canSignal() {
            if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return false;
            const ch = this.channel;
            return !!ch && typeof ch.sendWebRtcSignaling === 'function'
                && (ch.readyState === undefined || !!ch.readyState);
        }

        async _recover(streamId, { fresh = false } = {}) {
            const session = this.streamSessions.get(streamId);
            if (!session || session.role !== 'offer') return;
            clearTimeout(session.recoveryTimer);
            if (!this._canSignal()) {
                // Offline: an offer now goes nowhere. Wait without spending an attempt.
                session.recoveryTimer = setTimeout(() => this._recover(streamId, { fresh }), this.reconnect.offlinePollMs);
                return;
            }
            if (session.attempts >= this.reconnect.maxAttempts) return this._giveUp(streamId);
            session.attempts++;
            this.emit('stream-reconnecting', streamId, session.remoteAgent, session.attempts);

            const pc = this.peerConnections.get(streamId);
            const restart = !fresh && session.attempts === 1 && pc && pc.signalingState === 'stable';
            console.warn(`[WebRTC] Reconnecting ${streamId} to ${session.remoteAgent} `
                + `(attempt ${session.attempts}: ${restart ? 'ICE restart' : 'new connection'})`);
            try {
                if (restart) await this._sendOffer(streamId, pc, { iceRestart: true, renegotiate: true });
                else await this._rebuild(streamId);
            } catch (err) {
                console.warn(`[WebRTC] Reconnect attempt for ${streamId} failed:`, err);
            }
            if (this.streamSessions.get(streamId) !== session) return;
            clearTimeout(session.recoveryTimer);
            session.recoveryTimer = setTimeout(() => {
                const now = this.peerConnections.get(streamId);
                // An ICE restart that worked may never have left 'connected', so no state event said so.
                if (now && now.connectionState === 'connected') this._onConnected(streamId, session);
                else this._recover(streamId);
            }, this.reconnect.attemptTimeoutMs);
        }

        async _rebuild(streamId) {
            this._teardown(streamId, { replacing: true });
            await this._offerOnNewConnection(streamId);
        }

        _giveUp(streamId) {
            const session = this.streamSessions.get(streamId);
            console.warn(`[WebRTC] Giving up on ${streamId} after ${session.attempts} reconnect attempts`);
            this.emit('stream-failed', streamId, session.remoteAgent);
            this.closeStream(streamId, { reason: 'failed' });
        }

        /** The connection to a stream's peer is down: schedule what each role does about it. */
        _onBroken(streamId, session, delayMs) {
            if (session.role === 'offer') {
                if (session.attempts > 0) return;   // an attempt is in flight; its own timer decides
                clearTimeout(session.recoveryTimer);
                session.recoveryTimer = setTimeout(() => this._recover(streamId), delayMs);
                return;
            }
            if (session.giveUpTimer) return;
            const giveUp = () => {
                const pc = this.peerConnections.get(streamId);
                if (!pc || pc.connectionState === 'connected') return;
                // It is this side that is offline: the offerer cannot reach us, so do not blame it.
                if (!this._canSignal()) { session.giveUpTimer = setTimeout(giveUp, this.reconnect.answererGiveUpMs); return; }
                console.warn(`[WebRTC] ${session.remoteAgent} did not reconnect ${streamId}; closing it`);
                this.closeStream(streamId, { reason: 'failed' });
            };
            session.giveUpTimer = setTimeout(giveUp, this.reconnect.answererGiveUpMs);
        }

        /** Back online: restart every outgoing stream that is not connected, now. */
        _onOnline() {
            this.streamSessions.forEach((session, streamId) => {
                const pc = this.peerConnections.get(streamId);
                if (session.role !== 'offer' || (pc && pc.connectionState === 'connected')) return;
                console.log(`[WebRTC] Back online: reconnecting ${streamId}`);
                session.attempts = 0;
                this._recover(streamId);
            });
        }

        /** The other side closed a stream, or (unknown-stream) cannot restart it. */
        _onBye(streamId, sourceAgent, msg) {
            const session = this.streamSessions.get(streamId);
            if (!session || session.remoteAgent !== sourceAgent) return;
            if (msg.reason === 'unknown-stream' && session.role === 'offer') {
                return this._recover(streamId, { fresh: true });
            }
            console.log(`[WebRTC] ${sourceAgent} closed ${streamId}`);
            this.closeStream(streamId, { notify: false, reason: 'remote' });
        }

        _sendBye(streamId, remoteAgent) {
            // A channel that is already down cannot carry it; the peer's own failure detection covers that.
            if (!remoteAgent || !this._canSignal()) return;
            try {
                this.channel.sendWebRtcSignaling({ type: 'bye', streamSessionId: streamId }, remoteAgent);
            } catch (_) { /* best effort */ }
        }

        // ------------------------------------------------------------------
        // Closing
        // ------------------------------------------------------------------

        /** Close the connection behind a stream id and everything hanging off it; keep the session. */
        _teardown(streamId, { replacing = false } = {}) {
            const pc = this.peerConnections.get(streamId);
            const session = this.streamSessions.get(streamId);
            this.peerConnections.delete(streamId);
            if (pc) { try { pc.close(); } catch (_) { /* already closed */ } }
            if (this.pendingIce) this.pendingIce.delete(streamId);
            this.peerConnectionStartTimes.delete(streamId);
            this.streamStartTimes.delete(streamId);

            if (session) {
                clearTimeout(session.recoveryTimer);
                clearTimeout(session.giveUpTimer);
                session.recoveryTimer = session.giveUpTimer = null;
                // pc.close() closes its data channels WITHOUT a 'close' event, so
                // the map used to keep a dead channel and nobody heard it went.
                if (session.dataChannel) {
                    if (replacing) this.files.dropPeer(session.remoteAgent);
                    this._retireDataChannel(session.remoteAgent, session.dataChannel, !replacing);
                    try { session.dataChannel.close(); } catch (_) { /* already closed */ }
                    session.dataChannel = null;
                }
            }
            this._stopRemote(streamId);
        }

        _stopRemote(streamId) {
            const remote = this.remoteStreams.get(streamId);
            if (!remote) return;
            // Handle both formats: plain stream or { sourceAgent, stream }
            const stream = remote.stream || remote;
            if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop());
            this.remoteStreams.delete(streamId);
        }

        /**
         * Close a stream session, and tell the other side (a 'bye') so it
         * closes its end now rather than when its connection times out.
         *
         * Only tracks this helper acquired itself are stopped. A stream the
         * caller passed in is the caller's: stopping it here is what turned
         * the Call demo's camera off for good the moment screen share started
         * (closing the camera's connection stopped the camera).
         * @param {string} streamId
         * @param {object} [options] - {notify = true, reason = 'local'}
         * @returns {Promise<void>} Resolves when stream is closed
         */
        closeStream(streamId, { notify = true, reason = 'local' } = {}) {
            try {
                const session = this.streamSessions.get(streamId);
                if (session && notify) this._sendBye(streamId, session.remoteAgent);
                this._teardown(streamId);

                const local = this.localStreams.get(streamId);
                if (local && session && session.ownsLocal && local !== this.defaultLocalStream) {
                    local.getTracks().forEach(t => t.stop());
                }
                this.localStreams.delete(streamId);
                this.streamSessions.delete(streamId);
                if (session) this.emit('stream-closed', streamId, session.remoteAgent, reason);
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
            const streamIds = Array.from(new Set([...this.peerConnections.keys(), ...this.streamSessions.keys()]));
            console.log(`[WebRTC] Closing ${streamIds.length} stream(s)`);

            streamIds.forEach(streamId => {
                this.closeStream(streamId);
            });

            console.log(`[WebRTC] All streams closed`);
        }

        /** Close everything and stop listening for the network: for a helper that is being thrown away. */
        destroy() {
            this.closeAllStreams();
            if (this._onlineListener && typeof window !== 'undefined' && window.removeEventListener) {
                window.removeEventListener('online', this._onlineListener);
            }
            this._onlineListener = null;
        }

        // Allow page to register a default local MediaStream (e.g., camera) to be used when answering offers
        setLocalMediaStream(stream) {
            this.defaultLocalStream = stream;
        }

        /**
         * The far end closed a data channel. On the ANSWERING side that is
         * also what the offerer rebuilding the connection looks like, and its
         * new offer is a moment behind: so wait reconnect.dataChannelCloseGraceMs
         * before telling the app, and say nothing if a replacement arrived.
         */
        _onDataChannelClosed(peerId, dataChannel) {
            let owner = null;
            this.streamSessions.forEach((s) => { if (s.dataChannel === dataChannel) owner = s; });
            if (!owner || owner.role !== 'answer') return this._retireDataChannel(peerId, dataChannel, true);
            setTimeout(() => this._retireDataChannel(peerId, dataChannel, true), this.reconnect.dataChannelCloseGraceMs);
        }

        /**
         * A data channel is finished: forget it, once. `announce` says whether
         * the app hears 'datachannel-close' -- not when the channel is being
         * replaced by a reconnect, and never for a channel that is no longer
         * the peer's current one. (A replaced channel's late 'close' used to
         * delete its REPLACEMENT from the map, orphaning a channel that was open.)
         */
        _retireDataChannel(peerId, dataChannel, announce) {
            if (!dataChannel || dataChannel.__mpRetired) return;
            dataChannel.__mpRetired = true;
            const current = this.dataChannels.get(peerId) === dataChannel;
            if (current) this.dataChannels.delete(peerId);
            if (!current || !announce) {
                console.log(`[WebRTC DataChannel] Retired a replaced channel with ${peerId}`);
                return;
            }
            console.log(`[WebRTC DataChannel] CLOSED with ${peerId}`);
            this.files.dropPeer(peerId);
            this.emit('datachannel-close', peerId);
        }

        /**
         * Setup event handlers for a data channel
         * @param {RTCDataChannel} dataChannel - The data channel
         * @param {string} peerId - The peer ID
         * @param {RTCPeerConnection} pc - The peer connection (for state validation)
         */
        _setupDataChannelHandlers(dataChannel, peerId, pc) {
            // Binary frames are file chunks; as a Blob they could not be read in order.
            dataChannel.binaryType = 'arraybuffer';
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

            dataChannel.onclose = () => this._onDataChannelClosed(peerId, dataChannel);

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
                if (typeof event.data !== 'string') {
                    this.files.onChunk(peerId, event.data);
                    return;
                }
                let data;
                try {
                    data = JSON.parse(event.data);
                } catch (e) {
                    console.warn('[WebRTC DataChannel] Failed to parse message:', e);
                    return;
                }
                if (data && data.__mpFile) this.files.onControl(peerId, data);
                else this.emit('datachannel-message', peerId, data);
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
         * Send a File or Blob to one peer over its data channel.
         *
         * Resolves {id, name, size, mime, sha256} once the RECEIVER has checked
         * the SHA-256; rejects if it refused (too large), found it corrupt or
         * incomplete, the channel closed, or no answer came. The channel must
         * be ordered and reliable. The receiver gets a 'file' event with
         * (peerId, {id, name, size, mime, sha256, blob}); 'file-start',
         * 'file-progress' and 'file-failed' say what happened on the way.
         * files.maxBytes (256 MB) is the largest file this side will accept.
         * @param {string} peerId
         * @param {Blob} file
         * @param {object} [options] - {name, chunkBytes = 16384, onProgress({id, sent, size})}
         * @returns {Promise<object>}
         */
        sendFile(peerId, file, options) {
            try {
                return this.files.send(peerId, file, options);
            } catch (e) {
                return Promise.reject(e);
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
                this._retireDataChannel(peerId, dataChannel, true);
                dataChannel.close();
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
            pc.onicecandidate = (event) => { if (event.candidate) this._sendLocalIce(usedChannel, remoteAgent, streamId, event.candidate); };

            // A connection that never comes up is broken too. 'new' fires no event, so arm it now.
            this._armConnectTimeout(streamId, pc);
            pc.onconnectionstatechange = () => this._onConnectionState(streamId, pc);

            pc.ontrack = (event) => this._onRemoteTrack(streamId, remoteAgent, pc, event);

            return pc;
        }

        _onRemoteTrack(streamId, remoteAgent, pc, event) {
            if (this.peerConnections.get(streamId) !== pc) return;   // a replaced connection's late track
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
        }

        _sendLocalIce(usedChannel, remoteAgent, streamId, candidate) {
            console.log(`[WebRTC] Local ICE candidate for ${streamId}`);
            this.emit('ice-candidate', streamId, candidate);

            // Send ICE to remote agent
            if (usedChannel && typeof usedChannel.sendWebRtcSignaling === 'function') {
                usedChannel.sendWebRtcSignaling({
                    type: 'ice-candidate',
                    candidate: {
                        candidate: candidate.candidate,
                        sdpMLineIndex: candidate.sdpMLineIndex,
                        sdpMid: candidate.sdpMid
                    },
                    streamSessionId: streamId
                }, remoteAgent);
            } else {
                console.warn('[WebRTC] No signaling channel available to send ICE candidate');
            }
        }

        /** A connection still not up after 30 s is broken: the offerer recovers it, the answerer lets go. */
        _armConnectTimeout(streamId, pc) {
            const CONNECTION_TIMEOUT_MS = 30000;
            clearTimeout(pc.__mpConnectTimer);
            pc.__mpConnectTimer = setTimeout(() => {
                if (this.peerConnections.get(streamId) !== pc) return;
                if (pc.connectionState !== 'connecting' && pc.connectionState !== 'new') return;
                const session = this.streamSessions.get(streamId);
                console.warn(`[WebRTC] Connection timeout for ${streamId}`);
                if (session && session.role === 'offer') return this._onBroken(streamId, session, 0);
                this.emit('connection-state', streamId, 'failed');
                this.closeStream(streamId, { reason: 'failed' });
            }, CONNECTION_TIMEOUT_MS);
        }

        _onConnectionState(streamId, pc) {
            if (this.peerConnections.get(streamId) !== pc) return;   // replaced or closed: not news
            const state = pc.connectionState;
            console.log(`[WebRTC] Connection state (${streamId}): ${state}`);
            // Emit connection-state for UI
            this.emit('connection-state', streamId, state);

            if (state === 'connecting') this._armConnectTimeout(streamId, pc);
            else clearTimeout(pc.__mpConnectTimer);

            const session = this.streamSessions.get(streamId);
            if (state === 'connected' || state === 'completed') this._onConnected(streamId, session);
            else if (session && state === 'failed') this._onBroken(streamId, session, 0);
            else if (session && state === 'disconnected') this._onBroken(streamId, session, this.reconnect.disconnectedGraceMs);
        }

        /** Up (again): stop any recovery, and emit stream-ready with how long it took. */
        _onConnected(streamId, session) {
            if (session) {
                clearTimeout(session.recoveryTimer);
                clearTimeout(session.giveUpTimer);
                session.recoveryTimer = session.giveUpTimer = null;
                if (session.attempts) {
                    console.log(`[WebRTC] ${streamId} reconnected after ${session.attempts} attempt(s)`);
                    this.emit('stream-recovered', streamId, session.remoteAgent, session.attempts);
                    session.attempts = 0;
                }
            }
            const remoteAgent = (session && session.remoteAgent) || null;

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
