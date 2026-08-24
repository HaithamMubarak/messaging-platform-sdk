/**
 * Rooms — camera, microphone and screen share in a shared channel.
 *
 * The primitive on show is **WebRTC streaming**, and the shape of it is worth
 * reading the code for: the media never touches the channel. Streams go peer
 * to peer and the channel carries only the small facts a room needs — who is
 * here, who has what switched on, and which stream is a camera and which is a
 * screen. That is why a room of four costs the same in messages as a room of
 * two.
 *
 * It is a **mesh**: every publisher offers its own stream to every other
 * member, one peer connection each way. Two reasons, both load-bearing:
 *
 *  - The answering side of the SDK is receive-only. It never attaches its own
 *    tracks to somebody else's offer, so a two-way conversation is two offers,
 *    not one negotiation.
 *  - `startStreamBroadcast` wants a relay agent on the deployment and most
 *    deployments have none, which is a room where the camera button does
 *    nothing and no message says why. `createStreamOffer` needs nothing but
 *    the channel to signal over, so a room works anywhere the SDK does.
 *
 * A mesh costs one upload per viewer, which is fine for the handful of people
 * a room like this holds and is why the size is capped rather than left to
 * discover itself.
 */
(function () {
    'use strict';

    var MESH_LIMIT = 8;          // past this a mesh is unkind to the uplink
    var SPEAK_LEVEL = 0.05;      // RMS above which somebody is talking
    var SPEAK_HOLD_MS = 800;     // how long the ring stays after they stop

    class Rooms extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'rooms_',
                customType: 'rooms',
                autoCreateDataChannel: false   // media is WebRTC; facts are the channel
            });

            this.cam = null;             // my camera + microphone
            this.screen = null;          // my screen share
            this.published = new Map();  // kind -> Map(peer -> streamId)
            this.incoming = new Map();   // streamId -> { from, kind, stream }
            this.kindOf = new Map();     // streamId -> kind, learned from announcements
            this.parked = new Map();     // streamId -> media that arrived before its label
            this.state = new Map();      // peer -> { mic, camOn, sharing }
            this.speaking = new Map();   // name -> when they were last heard
            this.messages = [];
            this.known = [];
            this.devices = { cams: [], mics: [], cam: null, mic: null };
            this.view = 'auto';          // 'auto' follows the presenter; 'grid' shows everyone
            this.pinned = null;          // somebody clicked a tile to make them big
            this.hand = false;           // my own hand, up or down
            this.blocked = {};           // devices the browser refused us
            this.unreachable = {};       // peers whose media never got through
            this.ready = false;          // past the green room
        }

        // ---- lifecycle -------------------------------------------------------

        /**
         * Attach to the media helper.
         *
         * Called on every join, including the automatic one after a
         * connection drops — a reconnect builds a fresh helper, and a room
         * that subscribed once at startup would come back deaf and blind
         * while insisting it was fine.
         *
         * The event is `remote-stream`. Listening for anything else is a room
         * where nobody ever appears and nothing says why.
         */
        onWebrtcHelperReady(helper) {
            var self = this;
            helper.on('remote-stream', function (streamId, stream, from) {
                self.accept(streamId, stream, from);
            });
            helper.on('connection-state', function (streamId, state) {
                if (state === 'failed' || state === 'closed') self._forget(streamId);
            });
        }

        /** Everything about other people's media belongs to the old session. */
        _resetMedia() {
            var self = this;
            this.published.forEach(function (byPeer) { byPeer.clear(); });
            this.incoming.forEach(function (rec, id) { self._close(id); });
            this.incoming.clear();
            this.kindOf.clear();
            this.parked.clear();
            this.state.clear();
            this.speaking.clear();
            if (this.ears) { this.ears.forEach(function (el) { el.remove(); }); this.ears.clear(); }
            if (this.meters) this.meters.clear();
            this.tiles = {};
        }

        onReconnecting(attempt, waitMs) {
            this._status('busy', 'Reconnecting…');
            this._syncComposer();
            if (attempt === 1) this.note('Connection lost — trying to get back in', 'leave');
            void waitMs;
        }

        onReconnected() {
            UI.toast('Back in ' + this.channelName, 'success');
            this._syncComposer();
            this.note('Reconnected', 'join');
            // What I am sending has to be offered again over the new session;
            // what they were sending arrives again when they notice me rejoin.
            var self = this;
            this._peers().forEach(function (p) { self._offerAllTo(p); });
        }

        onReconnectFailed() {
            this._status('off', 'Disconnected');
            this._syncComposer();
            this.note('Could not get back into the room. Reload to try again.', 'leave');
            UI.toast('Could not reconnect', 'error', 6000);
        }

        onConnect() {
            var rejoined = this.messages.length > 0;
            if (rejoined) this._resetMedia();
            else {
                UI.toast('Joined ' + this.channelName, 'success');
                this.note('You joined ' + this.channelName, 'join');
            }
            this.known = this._names();
            this._watchRoster();
            this._watchStats();
            this._announce();
            this._syncComposer();
            this._sync();
            this._loadDevices();
            if (!this.ready) this.openLobby();
        }

        onDisconnect(detail) {
            clearInterval(this._rosterTimer);
            clearInterval(this._statsTimer);
            clearInterval(this._levelTimer);
            this._levelTimer = null;
            // A drop is not a departure: the room says so and the rejoin
            // reports itself, rather than claiming you left.
            if (detail && detail.reason) {
                this._status('busy', 'Reconnecting…');
                return;
            }
            this._status('off', 'Disconnected');
            this.note('You left the room');
            this._syncComposer();
        }

        onUserJoin() { this._roster(); }
        onUserJoining() { this._roster(); }
        onUserLeave() { this._roster(); }

        _names() { return (this.getUserList() || []).map(function (u) { return u.name; }); }

        _peers() {
            var me = this.username;
            return this._names().filter(function (n) { return n !== me; });
        }

        /**
         * Reconcile the member list and say what changed.
         *
         * Watched on a timer as well as listened for: the join event does not
         * reliably arrive before the roster updates, and a member list that is
         * occasionally a person short is worse than none at all.
         */
        _roster() {
            var now = this._names(), was = this.known || [], self = this;

            // A mesh costs one upload per viewer, so the room has a size. Say
            // so when it is reached, rather than at the unrelated moment
            // somebody presses the camera button.
            if (now.length > MESH_LIMIT && was.length <= MESH_LIMIT) {
                UI.toast('This room is full for video — ' + MESH_LIMIT
                    + ' is the limit for peer-to-peer. Chat still works for everyone.', 'warning', 7000);
            }

            now.forEach(function (n) {
                if (n === self.username || was.indexOf(n) !== -1) return;
                self.note(n + ' joined', 'join');
                if (now.length > MESH_LIMIT) return;   // past the cap, nothing new is offered
                // Somebody arriving can only see me if I offer to them, and
                // they have no way to know what I already have switched on.
                self._offerAllTo(n);
                self._announce();
            });
            was.forEach(function (n) {
                if (n === self.username || now.indexOf(n) !== -1) return;
                self._dropPeer(n);
                self.note(n + ' left', 'leave');
            });

            this.known = now;
            this._sync();
        }

        _watchRoster() {
            var self = this;
            clearInterval(this._rosterTimer);
            var tick = 0;
            this._rosterTimer = setInterval(function () {
                if (!self.connected) return;
                if (self._names().join('|') !== (self.known || []).join('|')) self._roster();
                if (++tick % 4 === 0) self._announce();     // slow heartbeat, ~6s
            }, 1500);
        }

        _dropPeer(name) {
            var self = this;
            this.published.forEach(function (byPeer) {
                var id = byPeer.get(name);
                if (id) { self._close(id); byPeer.delete(name); }
            });
            this.incoming.forEach(function (rec, id) {
                if (rec.from === name) { self._close(id); self.incoming.delete(id); }
            });
            this.state.delete(name);
            this.speaking.delete(name);
            delete this.unreachable[name];
            if (this.pinned === name) this.pinned = null;
            this._deafen(name);
            if (this.meters) this.meters.delete(name);
        }

        _sync() {
            var n = this._names().length;
            this._status(n > 1 ? 'live' : 'busy', n > 1 ? n + ' in the room' : 'waiting for someone');
            this.renderPeople();
            this.renderStage();
            this._syncButtons();
            this._syncPresenting();
            this._syncComposer();
        }

        /** The bar that follows a screen share around. */
        _syncPresenting() {
            var bar = document.getElementById('presentingBar');
            if (bar) bar.hidden = !this.screen;
        }

        _status(kind, text) {
            var pill = document.getElementById('statusPill');
            if (!pill) return;
            pill.className = 'pill-status is-' + kind;
            var t = pill.querySelector('.pill-status__text');
            if (t) t.textContent = text;
        }

        // ---- the small facts the channel carries ------------------------------

        /**
         * One place that knows how a Rooms message travels: to the host, which
         * relays it. A guest broadcasting to '*' reaches the host and nobody
         * else, so everything goes through the host and carries an id, because
         * the host then sees its own relay come back.
         */
        _say(payload, onFail) {
            if (!payload.id) {
                payload.id = this.username + ':' + Date.now().toString(36)
                    + Math.random().toString(36).slice(2, 6);
            }
            var self = this, sent;
            try {
                if (this.isHost()) {
                    payload._relayed = true;
                    sent = this.sendCustomEventMessage(payload, '*');
                } else {
                    sent = this.sendCustomEventMessage(payload, this._getHostName() || '*');
                }
            } catch (err) {
                if (this.connected) console.warn('[Rooms] send failed:', err.message);
                if (onFail) onFail(err);
                return false;
            }
            // A refused send rejects the promise rather than throwing, so the
            // try/catch above catches nothing and the failure arrives later.
            // Without this, a message the room never received sits in your own
            // log looking delivered.
            if (sent && sent.catch) {
                sent.catch(function (err) {
                    if (self.connected) console.warn('[Rooms] send failed:', err && err.message);
                    if (onFail) onFail(err);
                });
            }
            return true;
        }

        /**
         * Say what I have switched on.
         *
         * Retried if the channel is not up yet — this runs the moment the room
         * opens — and repeated on a slow beat by the roster watcher. A state
         * message that goes missing would otherwise leave a stale microphone
         * icon on somebody's screen for the rest of the call, and there is
         * nothing in a room this small to notice and ask again.
         */
        _announce(attempt) {
            var sent = this._say({
                type: 'state', by: this.username,
                mic: this._live(this.cam, 'audio'),
                camOn: this._live(this.cam, 'video'),
                sharing: !!this.screen,
                hand: !!this.hand,
                // The labels ride along, so a peer who missed the one-shot
                // announcement stops holding unlabelled media at the next beat
                // instead of holding it for the rest of the call.
                pubs: this._pubs()
            });
            if (sent || (attempt || 0) > 6) return;
            var self = this, n = (attempt || 0) + 1;
            setTimeout(function () { self._announce(n); }, 400 * n);
        }

        /** Every stream I am sending, and what each one is. */
        _pubs() {
            var out = [];
            this.published.forEach(function (byPeer, kind) {
                byPeer.forEach(function (id) { if (id !== 'pending') out.push({ stream: id, kind: kind }); });
            });
            return out;
        }

        _live(stream, kind) {
            return !!(stream && stream.getTracks().some(function (t) {
                return t.kind === kind && t.enabled && t.readyState === 'live';
            }));
        }

        onGameMessage(detail) {
            var d = detail && detail.data ? detail.data : detail;
            if (!d || !d.by) return;

            if (this.isHost() && !d._relayed) {
                d._relayed = true;
                try { this.sendCustomEventMessage(d, '*'); } catch (e) { /* best effort */ }
            }
            if (d.by === this.username) return;

            if (d.id) {
                this.seen = this.seen || [];
                if (this.seen.indexOf(d.id) !== -1) return;   // the relay's echo
                this.seen.push(d.id);
                if (this.seen.length > 400) this.seen.shift();
            }

            switch (d.type) {
                case 'state': {
                    var was = this.state.get(d.by) || {};
                    this.state.set(d.by, {
                        mic: !!d.mic, camOn: !!d.camOn, sharing: !!d.sharing, hand: !!d.hand
                    });
                    if (d.sharing && !was.sharing) this.note(d.by + ' started sharing their screen', 'share');
                    if (!d.sharing && was.sharing) this.note(d.by + ' stopped sharing', 'share');
                    if (d.hand && !was.hand) this.note(d.by + ' raised their hand', 'hand');
                    if (!d.hand && was.hand) this.note(d.by + ' lowered their hand', 'hand');
                    (d.pubs || []).forEach(this._label, this);
                    // The announce is the whole truth about what they are
                    // sending, so anything of theirs still waiting for a label
                    // is not coming — an offer that was superseded, or media
                    // whose label was lost while the stream itself was not.
                    // Without this it waits for the rest of the call.
                    if (Array.isArray(d.pubs)) this._reapParked(d.by, d.pubs);
                    this._sync();
                    break;
                }
                case 'pub':
                    this._label(d);
                    break;
                case 'unpub':
                    (d.streams || []).forEach(this._forget.bind(this));
                    break;
                case 'chat':
                    this.say(d.by, d.text, d.at);
                    break;
            }
        }

        // ---- publishing -------------------------------------------------------

        /**
         * Offer one of my streams to one peer, then say what it is.
         *
         * The stream id does not exist until the offer is made, so the label
         * follows rather than precedes it; the receiver parks the media until
         * the label lands.
         */
        async _offer(kind, peer, attempt) {
            var stream = kind === 'screen' ? this.screen : this.cam;
            if (!stream || !this.webrtcHelper || peer === this.username) return;

            var byPeer = this.published.get(kind) || new Map();
            this.published.set(kind, byPeer);
            if (byPeer.has(peer)) return;                    // already offered
            byPeer.set(peer, 'pending');                     // claim it before awaiting

            try {
                var id = await this.webrtcHelper.createStreamOffer(peer, { stream: stream });
                byPeer.set(peer, id);
                this._say({ type: 'pub', by: this.username, kind: kind, stream: id });
                this._watchOffer(kind, peer, id, (attempt || 0));
            } catch (err) {
                byPeer.delete(peer);
                console.warn('[Rooms] could not offer ' + kind + ' to ' + peer + ':', err.message);
            }
        }

        /**
         * An offer that is never answered is offered again.
         *
         * Signalling is a message like any other and can be missed — most
         * often when it is sent in the first moments after somebody joins,
         * before the other end is listening for it. The symptom is silent and
         * permanent: the connection sits in 'new' for ever, the publisher
         * believes it published, and the other person simply never sees or
         * hears them. So the connection is given a few seconds to come up, and
         * if it has not, the session is dropped and offered afresh.
         */
        _watchOffer(kind, peer, id, attempt) {
            var self = this;
            setTimeout(function () {
                var byPeer = self.published.get(kind);
                if (!byPeer || byPeer.get(peer) !== id) return;      // already replaced or withdrawn
                if (!self.connected || self._peers().indexOf(peer) === -1) return;

                var pc = self.webrtcHelper && self.webrtcHelper.peerConnections
                    && self.webrtcHelper.peerConnections.get(id);
                var state = pc && pc.connectionState;
                if (state === 'connected' || state === 'connecting') return;

                if (attempt >= 3) {
                    // Silence here is the worst outcome: the publisher believes
                    // they are on camera and the other person sees an avatar for
                    // the rest of the call. Say it on both the tile and once out
                    // loud.
                    console.warn('[Rooms] gave up offering ' + kind + ' to ' + peer);
                    self.unreachable[peer] = true;
                    UI.toast('Could not get your ' + (kind === 'screen' ? 'screen' : 'video')
                        + ' through to ' + peer + ' — their network may be blocking it', 'warning', 6000);
                    self._sync();
                    return;
                }
                delete self.unreachable[peer];
                console.warn('[Rooms] no answer for ' + kind + ' to ' + peer + ' (' + state + '), offering again');
                self._close(id);
                byPeer.delete(peer);
                self._offer(kind, peer, attempt + 1);
            }, 6000);
        }

        _offerAllTo(peer) {
            var self = this;
            ['cam', 'screen'].forEach(function (kind) {
                if (kind === 'screen' ? self.screen : self.cam) self._offer(kind, peer);
            });
        }

        _publish(kind) {
            var self = this;
            var peers = this._peers();
            if (peers.length + 1 > MESH_LIMIT) {
                UI.toast('Too many people for peer-to-peer video (' + MESH_LIMIT + ' is the limit)', 'warning', 4500);
                return;
            }
            peers.forEach(function (p) { self._offer(kind, p); });
        }

        _unpublish(kind) {
            var byPeer = this.published.get(kind);
            if (!byPeer) return;
            var ids = [], self = this;
            byPeer.forEach(function (id) { if (id !== 'pending') { ids.push(id); self._close(id); } });
            byPeer.clear();
            if (ids.length) this._say({ type: 'unpub', by: this.username, streams: ids });
        }

        /**
         * Hang up one stream session without taking the camera with it.
         *
         * closeStream() stops the tracks it is holding, and my camera is the
         * same object in every peer's session — hanging up on one person would
         * otherwise switch it off for everyone. The tracks are mine to stop, so
         * the session gives them up first.
         */
        _close(id) {
            var h = this.webrtcHelper;
            if (!h || !id || id === 'pending') return;
            try { if (h.localStreams) h.localStreams.delete(id); } catch (e) { /* ignore */ }
            try { if (h.closeStream) h.closeStream(id); } catch (e) { /* it may already be gone */ }
        }

        // ---- receiving --------------------------------------------------------

        /** A remote stream arrived. It may not yet be clear what it is. */
        accept(streamId, stream, from) {
            var kind = this.kindOf.get(streamId);
            if (!kind) { this.parked.set(streamId, { stream: stream, from: from }); return; }
            this.incoming.set(streamId, { from: from, kind: kind, stream: stream });
            if (kind === 'cam') { this._listen(from, stream); this._hear(from, stream); }
            this._sync();
        }

        /**
         * Play what somebody is saying, whether or not you can see them.
         *
         * Their voice used to come out of the video element on their tile, so
         * it stopped where the picture stopped: a tile with the camera off
         * hides its video, and a hidden element is not somewhere a browser
         * will reliably start unmuted audio. Speaking with the camera off is
         * the ordinary case in a call, not an edge one, so audio gets its own
         * element that exists for as long as the person does and does not care
         * what the tile is doing.
         */
        _hear(name, stream) {
            if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return;
            var host = document.getElementById('roomAudio');
            if (!host) {
                host = UI.el('div', { id: 'roomAudio', 'aria-hidden': 'true',
                    style: 'position:absolute;width:0;height:0;overflow:hidden' });
                document.body.appendChild(host);
            }
            this.ears = this.ears || new Map();
            var el = this.ears.get(name);
            if (!el) {
                el = UI.el('audio', { autoplay: true, playsinline: true });
                this.ears.set(name, el);
                host.appendChild(el);
            }
            if (el.srcObject !== stream) el.srcObject = stream;
            if (this.devices.spk && el.setSinkId) el.setSinkId(this.devices.spk).catch(function () {});
            this._play(el);
        }

        /**
         * Autoplay of unmuted audio needs a gesture behind it. There always is
         * one here — nobody arrives in a room without pressing something — but
         * a stream can land in the gap before it, so a refusal is remembered
         * and retried on the next thing the person touches.
         */
        _play(el) {
            var self = this;
            var attempt = el.play();
            if (!attempt || !attempt.catch) return;
            attempt.catch(function () {
                if (self._waitingForGesture) return;
                self._waitingForGesture = true;
                var go = function () {
                    self._waitingForGesture = false;
                    document.removeEventListener('pointerdown', go, true);
                    document.removeEventListener('keydown', go, true);
                    if (self.ears) self.ears.forEach(function (a) { a.play().catch(function () {}); });
                };
                document.addEventListener('pointerdown', go, true);
                document.addEventListener('keydown', go, true);
                UI.toast('Tap anywhere to let the room be heard', 'info', 5000);
            });
        }

        _deafen(name) {
            if (!this.ears) return;
            var el = this.ears.get(name);
            if (!el) return;
            el.srcObject = null;
            el.remove();
            this.ears.delete(name);
        }

        /**
         * Learn which of somebody's streams is the camera and which is the
         * screen. The media can beat the label here, so anything parked waiting
         * for one is claimed the moment it lands.
         */
        _label(pub) {
            if (!pub || !pub.stream || !pub.kind) return;
            if (this.kindOf.get(pub.stream) === pub.kind) return;
            this.kindOf.set(pub.stream, pub.kind);
            this._claimParked(pub.stream);
        }

        /**
         * Drop media parked in the hope of a label that will never come.
         *
         * @param {string} from  the peer who just described everything they send
         * @param {Array}  pubs  every stream they still claim
         */
        _reapParked(from, pubs) {
            var claimed = {};
            pubs.forEach(function (p) { if (p && p.stream) claimed[p.stream] = true; });
            var self = this, stale = [];
            this.parked.forEach(function (rec, streamId) {
                if (rec && rec.from === from && !claimed[streamId]) stale.push(streamId);
            });
            stale.forEach(function (streamId) {
                self.parked.delete(streamId);
                self._close(streamId);
                console.log('[Rooms] dropped unclaimed media ' + streamId + ' from ' + from);
            });
        }

        _claimParked(streamId) {
            var p = this.parked.get(streamId);
            if (!p) return;
            this.parked.delete(streamId);
            this.accept(streamId, p.stream, p.from);
        }

        _forget(streamId) {
            var rec = this.incoming.get(streamId);
            if (rec && rec.kind === 'cam') this._deafen(rec.from);
            this.incoming.delete(streamId);
            this.kindOf.delete(streamId);
            this.parked.delete(streamId);
            this._close(streamId);
            this._sync();
        }

        /** What a peer is sending, by kind. */
        _streamFrom(name, kind) {
            var found = null;
            this.incoming.forEach(function (rec) {
                if (rec.from === name && rec.kind === kind) found = rec.stream;
            });
            return found;
        }

        /** Whoever is presenting: me if I am, otherwise the first who is. */
        get presenter() {
            if (this.screen) return this.username;
            var withPicture = null, claimed = null, self = this;
            this.state.forEach(function (st, name) {
                if (!st.sharing) return;
                if (!claimed) claimed = name;
                if (!withPicture && self._streamFrom(name, 'screen')) withPicture = name;
            });
            return withPicture || claimed;
        }

        // ---- who is talking ---------------------------------------------------

        /**
         * Ring the tile of whoever is speaking.
         *
         * Measured off the audio rather than asked for over the channel: a
         * level changes sixty times a second and nobody wants that on a message
         * bus. One analyser per stream, polled slowly enough to be free and
         * often enough to look live.
         */
        _listen(name, stream) {
            if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return;
            try {
                this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)();
                var node = this.audio.createAnalyser();
                node.fftSize = 512;
                this.audio.createMediaStreamSource(stream).connect(node);
                this.meters = this.meters || new Map();
                this.meters.set(name, { node: node, data: new Uint8Array(node.frequencyBinCount) });
                this._watchLevels();
            } catch (err) {
                console.warn('[Rooms] could not listen to ' + name + ':', err.message);
            }
        }

        _watchLevels() {
            if (this._levelTimer) return;
            var self = this;
            this._levelTimer = setInterval(function () {
                if (!self.meters || !self.meters.size) return;
                var changed = false, now = Date.now();
                self.meters.forEach(function (m, name) {
                    m.node.getByteTimeDomainData(m.data);
                    var sum = 0;
                    for (var i = 0; i < m.data.length; i++) {
                        var v = (m.data[i] - 128) / 128;
                        sum += v * v;
                    }
                    if (Math.sqrt(sum / m.data.length) > SPEAK_LEVEL) {
                        if (!self.speaking.has(name)) changed = true;
                        self.speaking.set(name, now);
                    }
                });
                self.speaking.forEach(function (at, name) {
                    if (now - at > SPEAK_HOLD_MS) { self.speaking.delete(name); changed = true; }
                });
                if (changed) self.renderPeople();
            }, 200);
        }

        isSpeaking(name) {
            // Muted is muted, whatever the analyser last heard.
            var st = name === this.username
                ? { mic: this._live(this.cam, 'audio') }
                : (this.state.get(name) || {});
            return !!st.mic && this.speaking.has(name);
        }

        // ---- devices ----------------------------------------------------------

        async _loadDevices() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
            try {
                var list = await navigator.mediaDevices.enumerateDevices();
                this.devices.cams = list.filter(function (d) { return d.kind === 'videoinput'; });
                this.devices.mics = list.filter(function (d) { return d.kind === 'audioinput'; });
                this.devices.spks = list.filter(function (d) { return d.kind === 'audiooutput'; });
                this.renderDevices();
            } catch (err) { /* labels need permission; the menu simply stays short */ }
        }

        renderDevices() {
            var fill = function (id, list, current, word) {
                var sel = document.getElementById(id);
                if (!sel) return;
                sel.replaceChildren.apply(sel, list.map(function (d, i) {
                    var o = UI.el('option', { value: d.deviceId }, d.label || (word + ' ' + (i + 1)));
                    if (d.deviceId === current) o.selected = true;
                    return o;
                }));
                sel.disabled = !list.length;
            };
            fill('camPick', this.devices.cams, this.devices.cam, 'Camera');
            fill('micPick', this.devices.mics, this.devices.mic, 'Microphone');

            // Choosing where the room comes out is only offered where the
            // browser can actually honour it: setSinkId is not universal, and a
            // dropdown that does nothing is worse than no dropdown.
            var row = document.getElementById('spkRow');
            var canRoute = !!(document.createElement('audio').setSinkId);
            if (row) row.hidden = !canRoute || !(this.devices.spks || []).length;
            if (canRoute) fill('spkPick', this.devices.spks || [], this.devices.spk, 'Speaker');
        }

        /**
         * Show what the picker is picking.
         *
         * Switching camera used to be blind: you chose from a list of names and
         * found out what you had chosen when the room did. The menu borrows the
         * live camera when there is one, and asks for a private preview when
         * there is not — dropped again the moment the menu closes.
         */
        async previewDevices(open) {
            var video = document.getElementById('devicePreview');
            var note = document.getElementById('devicePreviewNote');
            var fill = document.getElementById('levelFill');
            if (!video) return;

            if (!open) {
                if (this._menuPreview) {
                    this._menuPreview.getTracks().forEach(function (t) { t.stop(); });
                    this._menuPreview = null;
                }
                clearInterval(this._lobbyMeter);
                this._lobbyMeter = null;
                video.srcObject = null;
                video.hidden = true;
                if (fill) fill.style.width = '0';
                return;
            }

            var stream = this.cam;
            if (!stream) {
                try {
                    stream = this._menuPreview = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    this._loadDevices();
                } catch (err) {
                    if (note) note.textContent = 'Allow the camera to see yourself here';
                    return;
                }
            }
            var showing = !!(stream && stream.getVideoTracks().some(function (t) { return t.enabled; }));
            video.srcObject = stream;
            video.hidden = !showing;
            if (note) {
                note.hidden = showing;
                note.textContent = 'Camera off — turn it on to see yourself';
            }
            this._meterOn(stream, fill);
        }

        /** Send the room's voices to a chosen output. */
        useSpeaker(deviceId) {
            this.devices.spk = deviceId;
            if (!this.ears) return;
            this.ears.forEach(function (el) {
                if (el.setSinkId) el.setSinkId(deviceId).catch(function () { /* the browser may refuse */ });
            });
        }

        async useDevice(kind, deviceId) {
            this.devices[kind] = deviceId;
            if (!this.cam) return;
            // A different device means a different stream, so it is re-offered.
            await this.stopCamera(true);
            await this.startCamera();
        }

        // ---- the controls -----------------------------------------------------

        async startCamera(withVideo) {
            var wantVideo = withVideo !== false;
            var want = {
                video: !wantVideo ? false
                    : (this.devices.cam ? { deviceId: { exact: this.devices.cam } }
                        : { width: { ideal: 1280 }, height: { ideal: 720 } }),
                audio: this.devices.mic ? { deviceId: { exact: this.devices.mic } } : true
            };
            try {
                this.cam = await navigator.mediaDevices.getUserMedia(want);
            } catch (err) {
                this._mediaRefused(err, wantVideo);
                return false;
            }
            delete this.blocked.cam;
            delete this.blocked.mic;
            // The answering side of a connection uses this when it has nothing
            // of its own to send.
            if (this.webrtcHelper && this.webrtcHelper.setLocalMediaStream) {
                this.webrtcHelper.setLocalMediaStream(this.cam);
            }
            this._listen(this.username, this.cam);
            this._publish('cam');
            this._announce();
            this._loadDevices();          // labels appear once permission is given
            this._sync();
            return true;
        }

        /**
         * Why the camera did not come on, and what to do about it.
         *
         * A raw browser message in a toast that vanishes in five seconds is a
         * dead end: the button looks unchanged, pressing it again fails
         * instantly, and nothing says the permission is the browser's to give
         * back. So the failure is named, kept on the button, and explained.
         */
        _mediaRefused(err, wantVideo) {
            var what = wantVideo ? 'camera' : 'microphone';
            var name = (err && err.name) || '';
            var msg, help = '';
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                msg = 'Your browser is blocking the ' + what;
                help = 'Click the padlock in the address bar → Site settings → allow, then press the button again.';
                this.blocked[wantVideo ? 'cam' : 'mic'] = true;
            } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
                msg = 'No ' + what + ' found on this device';
                help = 'Plug one in, or pick another under the gear button.';
            } else if (name === 'NotReadableError') {
                msg = 'Something else is already using the ' + what;
                help = 'Close the other app or tab holding it, then try again.';
            } else {
                msg = 'Could not use the ' + what + (err && err.message ? ': ' + err.message : '');
            }
            UI.toast(msg + (help ? ' — ' + help : ''), 'error', 8000);
            this.note(msg, 'leave');
            this._syncButtons();
        }

        async stopCamera(quiet) {
            this._unpublish('cam');
            if (this.cam) this.cam.getTracks().forEach(function (t) { t.stop(); });
            this.cam = null;
            if (this.webrtcHelper && this.webrtcHelper.setLocalMediaStream) {
                this.webrtcHelper.setLocalMediaStream(null);
            }
            if (this.meters) this.meters.delete(this.username);
            this.speaking.delete(this.username);
            if (!quiet) { this._announce(); this._sync(); }
        }

        async toggleCamera() {
            if (this._live(this.cam, 'video')) {
                // Leave the microphone alone: turning the picture off is not
                // the same as leaving the conversation.
                this.cam.getVideoTracks().forEach(function (t) { t.enabled = false; });
                this._announce();
                this._sync();
                return;
            }
            if (this.cam && this.cam.getVideoTracks().length) {
                this.cam.getVideoTracks().forEach(function (t) { t.enabled = true; });
                this._announce();
                this._sync();
                return;
            }
            if (this.cam) {            // audio-only so far — get a picture too
                await this.stopCamera(true);
            }
            await this.startCamera(true);
        }

        async toggleMic() {
            if (!this.cam) { await this.startCamera(false); return; }   // microphone alone is fine
            var on = this._live(this.cam, 'audio');
            this.cam.getAudioTracks().forEach(function (t) { t.enabled = !on; });
            this._announce();
            this._sync();
        }

        async toggleScreen() {
            if (this.screen) {
                this._unpublish('screen');
                this.screen.getTracks().forEach(function (t) { t.stop(); });
                this.screen = null;
                this.note('You stopped sharing', 'share');
            } else {
                if (!navigator.mediaDevices.getDisplayMedia) {
                    UI.toast('This browser cannot share a screen', 'warning');
                    return;
                }
                try {
                    // Offer to bring the tab's sound with the picture; a shared
                    // video that is silent for everybody watching is a bug from
                    // where they are sitting. The browser decides whether the
                    // checkbox appears, and refusing it is not an error.
                    this.screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                } catch (err) {
                    if (err && err.name !== 'NotAllowedError') {
                        UI.toast('Screen share failed: ' + err.message, 'error', 5000);
                    }
                    return;
                }
                var self = this;
                // Stopping from the browser's own bar has to reach the room too.
                this.screen.getVideoTracks().forEach(function (t) {
                    t.addEventListener('ended', function () { if (self.screen) self.toggleScreen(); });
                });
                this.note('You started sharing your screen', 'share');
                this._publish('screen');
                this.view = 'auto';
            }
            this._announce();
            this._sync();
        }

        setView(view) {
            this.view = view;
            var btn = document.getElementById('viewBtn');
            if (btn) {
                btn.classList.toggle('btn--primary', view === 'grid');
                btn.setAttribute('aria-pressed', String(view === 'grid'));
            }
            this._sync();
        }

        /**
         * Make one person big.
         *
         * A call with no way to enlarge anybody is a wall of equal squares, so
         * clicking a tile pins that person to the stage and clicking again lets
         * the room go back to whatever it was doing. A pin outranks the
         * presenter, because you chose it and the presenter did not.
         */
        pin(name) {
            this.pinned = (this.pinned === name) ? null : name;
            if (this.pinned) this.view = 'auto';
            this._sync();
        }

        /** Put a hand up. Everybody's roster shows it; the log says it once. */
        toggleHand() {
            this.hand = !this.hand;
            this.note(this.hand ? 'You raised your hand' : 'You lowered your hand', 'hand');
            this._announce();
            this._sync();
        }

        // ---- how the connection is doing --------------------------------------

        _watchStats() {
            var self = this;
            clearInterval(this._statsTimer);
            this._statsTimer = setInterval(function () { self._readStats(); }, 2500);
            this._readStats();
        }

        /**
         * Round-trip time and route come from the standard stats report, so the
         * number in the bar is measured rather than decorative. A demo whose
         * whole claim is "this goes peer to peer" should be able to show it did.
         */
        async _readStats() {
            var out = document.getElementById('connStats');
            var peers = this._peers().length;
            var rtt = null, route = null;
            var pcs = this._peerConnections();

            for (var i = 0; i < pcs.length; i++) {
                try {
                    var report = await pcs[i].getStats();
                    report.forEach(function (r) {
                        if (r.type === 'candidate-pair' && r.state === 'succeeded'
                            && typeof r.currentRoundTripTime === 'number') {
                            var ms = Math.round(r.currentRoundTripTime * 1000);
                            if (rtt === null || ms > rtt) rtt = ms;   // the worst link is the one that hurts
                        }
                        if (r.type === 'local-candidate' && r.candidateType) {
                            // A relayed candidate means TURN carried it, which
                            // is worth saying rather than claiming otherwise.
                            if (r.candidateType === 'relay') route = 'relayed';
                            else if (!route) route = 'peer-to-peer';
                        }
                    });
                } catch (e) { /* a connection can go away mid-read */ }
            }

            this._route = route || 'peer-to-peer';
            if (out) {
                var bits = [peers + (peers === 1 ? ' peer' : ' peers')];
                if (rtt !== null) bits.unshift(rtt + ' ms');
                if (pcs.length) bits.push(this._route);
                out.textContent = bits.join(' · ');
            }
        }

        _peerConnections() {
            var h = this.webrtcHelper;
            if (!h || !h.peerConnections) return [];
            var found = [];
            h.peerConnections.forEach(function (pc) {
                if (pc && pc.getStats && pc.connectionState !== 'closed') found.push(pc);
            });
            return found;
        }

        // ---- chat and the room log --------------------------------------------

        /**
         * A line of chat.
         *
         * Stamped by whoever said it, because my own message appears the
         * instant I send it while everybody else's waits for the channel — so
         * arrival order puts my reply above the thing I was replying to. A
         * stamp from a stranger's clock is not to be trusted further than it
         * has to be: it is only allowed to place a message in the recent past,
         * never in the future and never before the room's memory begins.
         */
        say(from, text, at) {
            text = String(text || '').trim();
            if (!text) return;
            if (from !== this.username) this._onChat();
            var now = Date.now();
            var when = typeof at === 'number' && at > now - 120000 && at <= now ? at : now;
            this._log({ kind: 'chat', from: from, text: text.slice(0, 800), at: when });
        }

        note(text, kind) { this._log({ kind: kind || 'note', text: text, at: Date.now() }); }

        _log(entry) {
            // Almost always an append; the sort is for the one that arrives late.
            var i = this.messages.length;
            while (i > 0 && this.messages[i - 1].at > entry.at) i--;
            this.messages.splice(i, 0, entry);
            if (this.messages.length > 300) this.messages.shift();
            this.renderChat();
        }

        send(text) {
            text = String(text || '').trim();
            if (!text) return;
            if (!this.connected) {
                UI.toast('You are not in the room — nothing was sent', 'warning');
                return;
            }
            var at = Date.now(), self = this;
            var mid = 'm' + at.toString(36) + Math.random().toString(36).slice(2, 5);
            this._log({ kind: 'chat', from: this.username, text: text.slice(0, 800), at: at, mid: mid });
            this._say({ type: 'chat', by: this.username, text: text, at: at }, function () {
                self._undelivered(mid);
            });
        }

        /**
         * The room never got it.
         *
         * Your own message appears the instant you press send, which is the
         * right thing to do and the wrong thing to leave alone when the send
         * then fails: it sits in your log looking delivered while nobody else
         * has it. Mark it, and offer the one action that helps.
         */
        _undelivered(mid) {
            for (var i = 0; i < this.messages.length; i++) {
                if (this.messages[i].mid === mid) { this.messages[i].failed = true; break; }
            }
            this.renderChat();
        }

        retry(mid) {
            var m = null;
            for (var i = 0; i < this.messages.length; i++) {
                if (this.messages[i].mid === mid) { m = this.messages[i]; break; }
            }
            if (!m) return;
            this.messages.splice(this.messages.indexOf(m), 1);
            this.renderChat();
            this.send(m.text);
        }

        /** The composer is only live while the room is. */
        _syncComposer() {
            var input = document.getElementById('chatInput');
            var send = document.getElementById('chatSend');
            var on = !!this.connected;
            if (input) {
                input.disabled = !on;
                input.placeholder = on ? 'Message the room…' : 'Reconnecting…';
            }
            if (send) send.disabled = !on;
        }

        // ---- rendering --------------------------------------------------------

        renderStage() {
            var stage = document.getElementById('stage');
            if (!stage) return;
            if (this.lobbyOpen) return;          // the green room owns the stage

            // A pin is a decision somebody made; a presenter is a thing that
            // happened. The decision wins.
            if (this.pinned && this._names().indexOf(this.pinned) !== -1) {
                this._renderPinned(stage, this.pinned);
                return;
            }

            var presenter = this.presenter;
            if (this.view === 'grid' || !presenter) { this._renderGrid(stage); return; }
            stage.setAttribute('aria-label', presenter + ' is presenting');

            var stream = presenter === this.username ? this.screen : this._streamFrom(presenter, 'screen');
            if (!stream) {
                stage.replaceChildren(UI.el('div', { class: 'sdk-empty' }, [
                    UI.iconNode('monitor'),
                    UI.el('p', {}, presenter + ' is presenting — waiting for the picture')
                ]));
                return;
            }

            var video = stage.querySelector('video.stage__video');
            if (!video) {
                video = UI.el('video', { class: 'stage__video', autoplay: true, playsinline: true, muted: true });
                stage.replaceChildren(
                    video,
                    UI.el('span', { class: 'stage__tag' }, [UI.el('span', { class: 'stage__dot' }), '']),
                    UI.el('span', { class: 'stage__meta' }, '')
                );
            }
            if (video.srcObject !== stream) video.srcObject = stream;
            var tag = stage.querySelector('.stage__tag');
            if (tag) {
                tag.replaceChildren(UI.el('span', { class: 'stage__dot' }),
                    document.createTextNode(presenter === this.username
                        ? 'You are presenting' : presenter + ' is presenting'));
            }
            this._stageMeta(stage, stream);
        }

        /** Everyone at once — the view when nobody is presenting. */
        _renderGrid(stage) {
            var users = this.getUserList() || [], self = this;
            stage.setAttribute('aria-label', 'Everyone in the room');

            // Alone in a room, the only useful next action is to fetch
            // somebody, so that is what the stage offers instead of one
            // lonely square of yourself.
            if (users.length < 2) {
                var mine = users[0];
                var invite = UI.el('button', { class: 'btn btn--primary', type: 'button' }, [
                    UI.iconNode('qr-code', 'icon--sm'), UI.el('span', {}, 'Invite someone')
                ]);
                invite.addEventListener('click', function () { self.invite(); });
                var wrapOne = UI.el('div', { class: 'grid' });
                wrapOne.style.setProperty('--cols', '1');
                if (mine) wrapOne.appendChild(this._tile('stage', mine));
                stage.replaceChildren(wrapOne, UI.el('div', { class: 'alone' }, [
                    UI.iconNode('users', 'icon--lg'),
                    UI.el('h3', {}, 'You are the only one here'),
                    UI.el('p', {}, 'Send someone the link and they land in this room — same name, same password, nothing to install.'),
                    invite
                ]));
                return;
            }

            var wrap = stage.querySelector('.grid');
            if (!wrap) { wrap = UI.el('div', { class: 'grid' }); stage.replaceChildren(wrap); }
            // The invitation the empty room showed is a sibling of the grid, so
            // it has to be taken away by hand when somebody arrives — replacing
            // the grid's children leaves it sitting under a room full of people.
            var alone = stage.querySelector('.alone');
            if (alone) alone.remove();
            this._fit(wrap, stage, users.length);
            wrap.replaceChildren.apply(wrap, users.map(function (u) { return self._tile('stage', u); }));
        }

        /**
         * How big a face can be.
         *
         * Ceil(sqrt(n)) columns is the obvious answer and the wrong one on a
         * wide stage: two people in a 1040x730 box came out as two small
         * squares with four hundred pixels of nothing under them. Every column
         * count is tried, the one that makes the largest tile wins, and the
         * size is handed to CSS in pixels — the constraint is the stage's
         * height as often as its width, and no flex-basis can say that.
         */
        _fit(wrap, stage, n) {
            var GAP = 12, RATIO = 16 / 10;
            var W = stage.clientWidth - GAP * 2;
            var H = stage.clientHeight - GAP * 2;
            if (!(W > 0 && H > 0) || n < 1) return;

            // A wide stage never stacks more rows than columns, and a tall one
            // never does the reverse. Purely by area, two people on a wide
            // stage come out one above the other — mathematically the larger
            // tile, and not what anybody means by a video call.
            var wide = W >= H;
            var best = { w: 0, cols: 1, rows: 1 };
            for (var cols = 1; cols <= n; cols++) {
                var rows = Math.ceil(n / cols);
                if (wide ? rows > cols : cols > rows) continue;
                var w = (W - (cols - 1) * GAP) / cols;
                var h = w / RATIO;
                var maxH = (H - (rows - 1) * GAP) / rows;
                if (h > maxH) { h = maxH; w = h * RATIO; }
                if (w > best.w) best = { w: w, cols: cols, rows: rows };
            }
            if (!best.w) best = { w: (W - GAP) / 2, cols: Math.ceil(Math.sqrt(n)), rows: 1 };
            wrap.style.setProperty('--cols', String(best.cols));
            wrap.style.setProperty('--tileW', Math.floor(best.w) + 'px');
        }

        /** One person, made big because somebody clicked them. */
        _renderPinned(stage, name) {
            var users = this.getUserList() || [], self = this;
            var user = users.filter(function (u) { return u.name === name; })[0];
            if (!user) { this.pinned = null; this._renderGrid(stage); return; }
            stage.setAttribute('aria-label', name + ' pinned');
            var wrap = stage.querySelector('.grid');
            if (!wrap) { wrap = UI.el('div', { class: 'grid' }); stage.replaceChildren(wrap); }
            var gone = stage.querySelector('.alone');
            if (gone) gone.remove();
            this._fit(wrap, stage, 1);
            wrap.style.setProperty('--cols', '1');
            wrap.replaceChildren(self._tile('stage', user));
        }

        _stageMeta(stage, stream) {
            var meta = stage.querySelector('.stage__meta');
            if (!meta) return;
            var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
            var st = track && track.getSettings ? track.getSettings() : {};
            var bits = [this._route || 'peer-to-peer'];
            if (st.width && st.height) bits.push(st.width + '×' + st.height);
            meta.textContent = bits.join(' · ');
        }

        /**
         * One person, as a video tile.
         *
         * Tiles are kept and updated, never rebuilt. A <video> that is thrown
         * away and made again loses its decoder and paints black for a moment,
         * and this room re-renders on every state message and every change of
         * who is speaking — rebuilding would make the whole wall blink at every
         * mute. The element is the same one from the first render to the last;
         * only its attributes move.
         *
         * The stage and the member list are two different places, so a person
         * has one tile in each — the same person cannot be in two parents at
         * once.
         */
        _tile(where, user) {
            this.tiles = this.tiles || {};
            var cache = this.tiles[where] || (this.tiles[where] = new Map());
            var t = cache.get(user.name);
            if (!t) { t = this._buildTile(user, where === 'stage'); cache.set(user.name, t); }
            this._fillTile(t, user);
            return t.el;
        }

        _buildTile(user, big) {
            var t = {
                name: user.name,
                // Muted always: the voice comes from its own element, so a tile
                // that is hidden, rebuilt or showing an avatar cannot take the
                // sound with it, and nobody hears themselves back.
                video: UI.el('video', { class: 'tile__video', autoplay: true, playsinline: true, muted: true }),
                avatar: UI.el('span', {
                    class: 'avatar avatar--lg',
                    style: 'background:' + this.generateUserColor(user.name)
                }, initials(user.name)),
                host: UI.el('span', { class: 'tile__host', title: 'Host' }, 'HOST'),
                badge: UI.el('span', { class: 'tile__badge' }, 'Sharing'),
                label: UI.el('span', { class: 'tile__name' }, user.name),
                muted: UI.el('span', { class: 'tile__muted', title: 'Muted' }, UI.iconNode('mic-off', 'icon--sm')),
                hand: UI.el('span', { class: 'tile__hand', title: 'Hand up' }, UI.iconNode('hand', 'icon--sm')),
                warn: UI.el('span', { class: 'tile__warn', title: 'Their video could not get through' },
                    UI.iconNode('alert-triangle', 'icon--sm')),
                pin: UI.el('span', { class: 'tile__pin', title: 'Pinned' }, UI.iconNode('target', 'icon--sm')),
                joining: UI.el('span', { class: 'tile__joining' }, 'connecting…')
            };
            t.video.muted = true;
            t.el = UI.el('div', {
                class: 'tile' + (big ? ' tile--big' : ''),
                tabindex: '0', role: 'button',
                title: 'Click to pin ' + user.name + ' to the stage'
            }, [t.video, t.avatar, t.host, t.badge, t.label, t.muted, t.hand, t.warn, t.pin, t.joining]);

            var self = this, who = user.name;
            t.el.addEventListener('click', function () { self.pin(who); });
            t.el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.pin(who); }
            });
            return t;
        }

        _fillTile(t, user) {
            var name = user.name, me = !!user.isSelf;
            // Somebody who has not announced yet is connecting, not muted:
            // guessing "muted" and correcting it six seconds later puts a wrong
            // icon on a stranger's face for the whole of their arrival.
            var heard = me || this.state.has(name);
            var st = me
                ? { mic: this._live(this.cam, 'audio'), camOn: this._live(this.cam, 'video'),
                    sharing: !!this.screen, hand: !!this.hand }
                : (this.state.get(name) || { mic: false, camOn: false, sharing: false, hand: false });
            var stream = me ? this.cam : this._streamFrom(name, 'cam');
            var showing = !!(stream && st.camOn);

            if (stream && t.video.srcObject !== stream) t.video.srcObject = stream;
            if (!stream && t.video.srcObject) t.video.srcObject = null;
            t.video.hidden = !showing;
            t.avatar.hidden = showing;
            t.host.hidden = !user.isHost;
            t.badge.hidden = !st.sharing;
            t.muted.hidden = !heard || !!st.mic;
            t.hand.hidden = !st.hand;
            t.warn.hidden = !this.unreachable[name];
            t.pin.hidden = this.pinned !== name;
            t.joining.hidden = heard;
            t.label.textContent = me ? name + ' (you)' : name;
            t.el.classList.toggle('tile--self', me);
            t.el.classList.toggle('is-speaking', this.isSpeaking(name));
            t.el.classList.toggle('is-presenting', !!st.sharing);
            t.el.classList.toggle('is-pinned', this.pinned === name);
            t.el.classList.toggle('is-hand', !!st.hand);
        }

        /** Forget the tiles of people who are no longer here. */
        _pruneTiles(users) {
            if (!this.tiles) return;
            var here = users.map(function (u) { return u.name; });
            Object.keys(this.tiles).forEach(function (where) {
                this.tiles[where].forEach(function (t, name) {
                    if (here.indexOf(name) === -1) this.tiles[where].delete(name);
                }, this);
            }, this);
        }

        /**
         * Which pane the phone is showing. Both are on screen on a desktop, so
         * this only matters where there is not room for two.
         */
        setPane(which) {
            var side = document.getElementById('side');
            if (!side) return;
            side.classList.toggle('is-people', which === 'people');
            side.classList.toggle('is-chat', which === 'chat');
            // The stage is a sibling of the panel, so the choice is mirrored
            // onto their shared parent: that is what lets the call shrink when
            // the chat is the thing being read.
            var stage = document.querySelector('.sdk-stage');
            if (stage) {
                stage.classList.toggle('is-people', which === 'people');
                stage.classList.toggle('is-chat', which === 'chat');
            }
            ['tabPeople', 'tabChat'].forEach(function (id) {
                var b = document.getElementById(id);
                if (!b) return;
                var on = (id === 'tabPeople') === (which === 'people');
                b.classList.toggle('is-on', on);
                b.setAttribute('aria-selected', String(on));
            });
            if (which === 'chat') { this.unread = 0; this._renderUnread(); }
        }

        _onChat() {
            var side = document.getElementById('side');
            var tabs = document.querySelector('.tabs');
            // The tabs only exist where there is not room for both panes, so
            // their being visible is what makes the chat pane hideable at all.
            var tabbed = tabs && getComputedStyle(tabs).display !== 'none';
            if (!tabbed || !side || !side.classList.contains('is-people')) return;
            this.unread = (this.unread || 0) + 1;
            this._renderUnread();
        }

        _renderUnread() {
            var b = document.getElementById('unreadCount');
            if (!b) return;
            b.textContent = this.unread > 99 ? '99+' : String(this.unread || 0);
            b.hidden = !this.unread;
        }

        /**
         * The green room.
         *
         * You are in the channel and sending nothing, which is the right
         * default and a strange first second: the room is live behind a card
         * that shows what it is about to see and hear. Everything here already
         * existed — the camera, the level meter, the device pickers — it was
         * only ever reachable after you had already appeared in front of
         * everybody.
         */
        openLobby() {
            var self = this, stage = document.getElementById('stage');
            if (!stage) return;
            this.lobbyOpen = true;

            var video = UI.el('video', { class: 'lobby__video', autoplay: true, playsinline: true, muted: true });
            video.muted = true;
            video.hidden = true;
            var off = UI.el('div', { class: 'lobby__off' }, [
                UI.iconNode('video-off', 'icon--lg'),
                UI.el('span', {}, 'Camera off — nobody sees anything yet')
            ]);
            var level = UI.el('span', { class: 'level', hidden: true }, UI.el('span', { class: 'level__fill' }));

            var testCam = UI.el('button', { class: 'btn btn--ghost', type: 'button' }, [
                UI.iconNode('video', 'icon--sm'), UI.el('span', {}, 'Test my camera')
            ]);
            var joinOn = UI.el('button', { class: 'btn btn--primary btn--lg', type: 'button' }, [
                UI.iconNode('video', 'icon--sm'), UI.el('span', {}, 'Join with camera')
            ]);
            var joinOff = UI.el('button', { class: 'btn btn--ghost btn--lg', type: 'button' }, 'Join muted');

            var lobby = UI.el('div', { class: 'lobby', id: 'lobby' }, [
                UI.el('div', { class: 'lobby__card' }, [
                    UI.el('div', { class: 'lobby__preview' }, [video, off]),
                    level,
                    UI.el('h2', {}, 'Ready to join ' + this.channelName + '?'),
                    UI.el('p', {}, 'Nothing is being sent yet. Check yourself here first — the room only sees you when you say so.'),
                    UI.el('div', { class: 'lobby__row' }, [testCam]),
                    UI.el('div', { class: 'lobby__row' }, [joinOn, joinOff])
                ])
            ]);
            stage.replaceChildren(lobby);

            var preview = null;
            var stop = function () {
                if (preview) { preview.getTracks().forEach(function (t) { t.stop(); }); preview = null; }
                if (self._lobbyMeter) { clearInterval(self._lobbyMeter); self._lobbyMeter = null; }
            };

            testCam.addEventListener('click', async function () {
                if (preview) { stop(); video.hidden = true; off.hidden = false; level.hidden = true; return; }
                try {
                    preview = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                } catch (err) { self._mediaRefused(err, true); return; }
                video.srcObject = preview;
                video.hidden = false;
                off.hidden = true;
                self._loadDevices();
                level.hidden = false;
                self._meterOn(preview, level.firstChild);
            });

            var enter = function (withCamera) {
                stop();
                self.lobbyOpen = false;
                self.ready = true;
                self._sync();
                var mic = document.getElementById('micBtn');
                if (mic) mic.focus();
                if (withCamera) self.toggleCamera();
            };
            joinOn.addEventListener('click', function () { enter(true); });
            joinOff.addEventListener('click', function () { enter(false); });
        }

        /** Paint an audio level onto a bar, so a microphone can be checked. */
        _meterOn(stream, bar) {
            if (!bar || !stream || !stream.getAudioTracks().length) return;
            try {
                this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)();
                var node = this.audio.createAnalyser();
                node.fftSize = 512;
                this.audio.createMediaStreamSource(stream).connect(node);
                var data = new Uint8Array(node.frequencyBinCount);
                clearInterval(this._lobbyMeter);
                this._lobbyMeter = setInterval(function () {
                    node.getByteTimeDomainData(data);
                    var sum = 0;
                    for (var i = 0; i < data.length; i++) {
                        var v = (data[i] - 128) / 128;
                        sum += v * v;
                    }
                    var rms = Math.sqrt(sum / data.length);
                    bar.style.width = Math.min(100, Math.round(rms * 320)) + '%';
                }, 90);
            } catch (err) { /* a meter is a nicety, not a requirement */ }
        }

        /** Hand the room to somebody: a link, and a code they can point a phone at. */
        invite() {
            if (!this.connected) { UI.toast('Join the room first', 'info'); return; }
            if (typeof ShareModal === 'undefined' || !ShareModal.show) {
                UI.toast('Sharing is not available on this page', 'error');
                return;
            }
            ShareModal.show(this.channelName, this.channelPassword);
        }

        renderPeople() {
            var host = document.getElementById('people');
            var count = document.getElementById('peopleCount');
            var tab = document.getElementById('peopleCountTab');
            if (!host) return;
            var users = this.getUserList() || [], self = this;
            if (count) count.textContent = users.length;
            if (tab) tab.textContent = users.length;
            this._pruneTiles(users);
            host.replaceChildren.apply(host, users.map(function (u) { return self._tile('side', u); }));
        }

        _syncButtons() {
            var camOn = this._live(this.cam, 'video');
            var micOn = this._live(this.cam, 'audio');
            var blocked = this.blocked;
            set('camBtn', camOn, camOn ? 'Camera on' : 'Camera', camOn ? 'video' : 'video-off',
                camOn ? 'camera on' : 'camera off', blocked.cam);
            set('micBtn', micOn, micOn ? 'Mute' : 'Unmute', micOn ? 'mic' : 'mic-off',
                micOn ? 'microphone live' : 'microphone off', blocked.mic);
            set('shareScreenBtn', !!this.screen, this.screen ? 'Stop sharing' : 'Share screen', 'monitor');
            var hand = document.getElementById('handBtn');
            if (hand) {
                hand.classList.toggle('btn--primary', !!this.hand);
                hand.setAttribute('aria-pressed', String(!!this.hand));
            }
            var view = document.getElementById('viewBtn');
            if (view) view.setAttribute('aria-pressed', String(this.view === 'grid'));

            // The label is what a screen reader has to go on, and on a phone
            // the label is display:none — which takes it out of the tree
            // altogether. The state travels in its own line instead.
            function set(id, on, label, icon, spoken, isBlocked) {
                var b = document.getElementById(id);
                if (!b) return;
                b.classList.toggle('btn--primary', !!on);
                b.classList.toggle('is-blocked', !!isBlocked);
                b.setAttribute('aria-pressed', String(!!on));
                var span = b.querySelector('span');
                if (span) span.textContent = label;
                var sr = b.querySelector('.sr-only');
                if (sr && spoken) sr.textContent = isBlocked ? spoken + ', blocked by the browser' : spoken;
                var use = b.querySelector('use');
                if (use) use.setAttribute('href', '#i-' + icon);
            }
        }

        renderChat() {
            var host = document.getElementById('log');
            if (!host) return;
            var self = this;
            var atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 60;
            host.replaceChildren.apply(host, this.messages.map(function (m) {
                if (m.kind !== 'chat') {
                    return UI.el('div', { class: 'ev ev--' + m.kind }, [
                        UI.iconNode(m.kind === 'leave' ? 'log-out'
                            : m.kind === 'share' ? 'monitor'
                            : m.kind === 'hand' ? 'hand' : 'users', 'icon--sm'),
                        UI.el('span', {}, m.text)
                    ]);
                }
                var head = [
                    UI.el('span', { class: 'msg__name' }, m.from),
                    UI.el('span', { class: 'msg__time' }, clock(m.at))
                ];
                if (m.failed) {
                    var again = UI.el('button', { class: 'msg__fail', type: 'button' }, 'not delivered · retry');
                    again.addEventListener('click', function () { self.retry(m.mid); });
                    head.push(again);
                }
                return UI.el('div', { class: 'msg' + (m.failed ? ' is-failed' : '') }, [
                    UI.el('span', { class: 'avatar msg__who', style: 'background:' + self.generateUserColor(m.from) },
                        initials(m.from)),
                    UI.el('div', { class: 'msg__body' }, [
                        UI.el('span', { class: 'msg__head' }, head),
                        UI.el('p', { class: 'msg__text' }, m.text)
                    ])
                ]);
            }));
            if (atBottom) host.scrollTop = host.scrollHeight;
        }
    }

    // ---- helpers ---------------------------------------------------------------

    function clock(ts) {
        var d = new Date(ts || Date.now());
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map(function (p) { return p[0]; }).join('').toUpperCase() || '?';
    }

    // ---- boot ------------------------------------------------------------------

    var app = null;

    function wire() {
        var on = function (id, ev, fn) {
            var el = document.getElementById(id);
            if (el) el.addEventListener(ev, fn);
        };

        on('micBtn', 'click', function () { if (app) app.toggleMic(); });
        on('camBtn', 'click', function () { if (app) app.toggleCamera(); });
        on('shareScreenBtn', 'click', function () { if (app) app.toggleScreen(); });
        on('viewBtn', 'click', function () { if (app) app.setView(app.view === 'grid' ? 'auto' : 'grid'); });
        on('shareBtn', 'click', function () { if (app) app.invite(); });
        on('tabPeople', 'click', function () { if (app) app.setPane('people'); });
        on('tabChat', 'click', function () { if (app) app.setPane('chat'); });

        // A tablist is expected to answer the arrow keys, not just clicks.
        ['tabPeople', 'tabChat'].forEach(function (id) {
            on(id, 'keydown', function (e) {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                var to = id === 'tabPeople' ? 'chat' : 'people';
                if (app) app.setPane(to);
                var next = document.getElementById(to === 'chat' ? 'tabChat' : 'tabPeople');
                if (next) next.focus();
            });
        });
        window.addEventListener('resize', function () { if (app) app.renderStage(); });

        on('stopShareBtn', 'click', function () { if (app && app.screen) app.toggleScreen(); });
        on('handBtn', 'click', function () { if (app) app.toggleHand(); });
        on('helpBtn', 'click', function () { showKeys(true); });

        // Leaving is the one thing in this bar you cannot take back, and on a
        // phone it is an icon the width of a thumb next to Share screen.
        on('leaveBtn', 'click', async function () {
            var go = function () {
                if (app) { try { app.disconnect(); } catch (e) { /* ignore */ } }
                location.href = 'index.html';
            };
            if (!app || !app.connected) { go(); return; }
            if (window.UI && UI.confirm) {
                var yes = await UI.confirm({
                    title: 'Leave the room?',
                    body: 'Your camera and microphone stop and the room carries on without you.',
                    confirmLabel: 'Leave', cancelLabel: 'Stay', danger: true
                });
                if (yes) go();
            } else { go(); }
        });

        var menu = function () { return document.getElementById('deviceMenu'); };
        var showMenu = function (open) {
            var m = menu(), g = document.getElementById('gearBtn');
            if (!m) return;
            m.hidden = !open;
            if (g) g.setAttribute('aria-expanded', String(!!open));
            if (app) app.previewDevices(open);
            if (open) { var first = m.querySelector('select:not([disabled])'); if (first) first.focus(); }
            else if (g) g.focus();
        };
        window.__roomsShowMenu = showMenu;

        on('gearBtn', 'click', function (e) {
            e.stopPropagation();
            showMenu(!!(menu() && menu().hidden));
        });
        on('deviceMenu', 'click', function (e) { e.stopPropagation(); });
        document.addEventListener('click', function () {
            if (menu() && !menu().hidden) showMenu(false);
        });
        on('camPick', 'change', function () { if (app) app.useDevice('cam', this.value); });
        on('micPick', 'change', function () { if (app) app.useDevice('mic', this.value); });
        on('spkPick', 'change', function () { if (app) app.useSpeaker(this.value); });

        // The shortcuts dialog, and the one key that opens it.
        var keys = function () { return document.getElementById('keysModal'); };
        var showKeys = function (open) {
            var m = keys();
            if (!m) return;
            m.hidden = !open;
            if (open) { var c = m.querySelector('[data-close]'); if (c) c.focus(); }
        };
        var km = keys();
        if (km) {
            km.querySelectorAll('[data-close]').forEach(function (el) {
                el.addEventListener('click', function () { showKeys(false); });
            });
        }

        var form = document.getElementById('chatForm');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var input = document.getElementById('chatInput');
                if (app) app.send(input.value);
                input.value = '';
            });
        }

        // The shortcuts a call is expected to have — and, at last, somewhere
        // they are written down.
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (keys() && !keys().hidden) { showKeys(false); e.preventDefault(); return; }
                if (menu() && !menu().hidden) { showMenu(false); e.preventDefault(); return; }
            }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
            if (e.key === '?') { showKeys(!!(keys() && keys().hidden)); e.preventDefault(); return; }
            if (!app) return;
            var k = e.key.toLowerCase();
            if (k === 'm') app.toggleMic();
            else if (k === 'v') app.toggleCamera();
            else if (k === 's') app.toggleScreen();
            else if (k === 'h') app.toggleHand();
            else if (k === 'g') app.setView(app.view === 'grid' ? 'auto' : 'grid');
            else return;
            e.preventDefault();
        });
    }

    async function connect(username, channel, password) {
        try {
            app = new Rooms();
            window.roomsApp = app;
            await app.connect({ username: username, channelName: channel, channelPassword: password });
            app.start();

            document.getElementById('roomName').textContent = channel;
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            if (typeof window.encodeChannelAuth === 'function') {
                var encoded = window.encodeChannelAuth(channel, password, null);
                if (encoded) history.replaceState(null, '', '#' + encoded);
            }
        } catch (err) {
            console.error('[Rooms] connect failed:', err);
            if (window.ConnectionModal) ConnectionModal.fail(err);
            UI.toast('Could not connect: ' + err.message, 'error', 5000);
            app = null;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        wire();
        window.loadConnectionModal({
            localStoragePrefix: 'rooms_',
            channelPrefix: 'rooms-',
            title: 'Join a room',
            collapsedTitle: 'Rooms',
            onConnect: connect
        });
        if (window.MiniGameUtils && MiniGameUtils.processSharedLinkAndAutoConnect) {
            MiniGameUtils.processSharedLinkAndAutoConnect({
                gameName: 'Rooms', storagePrefix: 'rooms_',
                connectCallback: async function () {
                    var u = (document.getElementById('usernameInput') || {}).value;
                    var c = (document.getElementById('channelInput') || {}).value;
                    var p = (document.getElementById('passwordInput') || {}).value || '';
                    if (u && c) await connect(u.trim(), c.trim(), p);
                }
            });
        }
        setTimeout(function () {
            var m = document.getElementById('connectionModal');
            if (m) m.classList.add('active');
        }, 200);
    });
})();
