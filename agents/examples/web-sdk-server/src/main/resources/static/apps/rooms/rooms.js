/**
 * Rooms — camera, microphone and screen share in a shared channel.
 *
 * The primitive on show is **WebRTC streaming**. Nothing else in the playground
 * used `WebRtcHelper`, so a visitor could tour the whole site without learning
 * the platform carries media at all.
 *
 * What goes where matters here, and it is the thing worth reading the code for:
 * the **media never touches the channel**. Streams are negotiated peer to peer
 * and the channel carries only the small facts a room needs — who is here, who
 * has their camera on, and who is presenting. That is why a room of four costs
 * the same in messages as a room of two.
 *
 * Live streaming needs a relay agent on the deployment. Where there is none,
 * this says so plainly and stays usable as a presence room rather than
 * pretending the camera is broken.
 */
(function () {
    'use strict';

    class Rooms extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'rooms_',
                customType: 'rooms',
                autoCreateDataChannel: false,   // media rides WebRTC, not the data channel
                enableWebrtcRelay: true
            });

            this.localStream = null;
            this.screenStream = null;
            this.remote = new Map();      // agentName -> { stream, cam, mic }
            this.state = new Map();       // agentName -> { cam, mic, presenting }
            this.presenter = null;
            this.streaming = false;       // is live streaming available at all
        }

        // ---- lifecycle -------------------------------------------------------

        async onConnect() {
            UI.toast('Joined ' + this.channelName, 'success');
            this.note('You joined ' + this.channelName, 'join');
            this.known = (this.getUserList() || []).map(function (u) { return u.name; });
            this._watchRoster();
            this._sync();
            this._announce();
            await this._checkStreamingAvailable();
        }

        onDisconnect() {
            clearInterval(this._rosterTimer);
            this._status('off', 'Disconnected');
            this.note('You left the room');
        }

        onUserJoin(detail) { this._roster(detail); this._announce(); }
        onUserJoining(detail) { this._roster(detail); }

        /**
         * Reconcile the member list against the channel and say what changed.
         *
         * Driven from a watcher as well as the join event: the event does not
         * always arrive before the roster updates, and a member list that is
         * occasionally a person short is worse than no member list at all.
         */
        _roster() {
            var now = (this.getUserList() || []).map(function (u) { return u.name; });
            var was = this.known || [];
            var self = this;

            now.forEach(function (n) {
                if (n !== self.username && was.indexOf(n) === -1) self.note(n + ' joined', 'join');
            });
            was.forEach(function (n) {
                if (n !== self.username && now.indexOf(n) === -1) {
                    self.remote.delete(n);
                    self.state.delete(n);
                    if (self.presenter === n) { self.presenter = null; self.screenOf = null; }
                    self.note(n + ' left', 'leave');
                }
            });

            this.known = now;
            this._sync();
        }

        _watchRoster() {
            var self = this;
            clearInterval(this._rosterTimer);
            this._rosterTimer = setInterval(function () {
                if (!self.connected) return;
                var now = (self.getUserList() || []).map(function (u) { return u.name; }).join('|');
                if (now !== (self.known || []).join('|')) self._roster();
            }, 1500);
        }

        onUserLeave() { this._roster(); }

        /** Chat sent by the platform's own chat type, if anything uses it. */
        onChat(detail) {
            if (!detail) return;
            var from = detail.from || detail.agentName || 'someone';
            if (from === this.username) return;   // ours was shown when we sent it
            this.say(from, detail.message || detail.content || '');
        }

        // ---- the room log: chat and what happened ---------------------------

        /** A line of chat from somebody. */
        say(from, text) {
            text = String(text || '').trim();
            if (!text) return;
            this._log({ kind: 'chat', from: from, text: text.slice(0, 800), at: Date.now() });
        }

        /** A thing that happened, rather than a thing somebody said. */
        note(text, kind) {
            this._log({ kind: kind || 'note', text: text, at: Date.now() });
        }

        _log(entry) {
            this.messages = this.messages || [];
            this.messages.push(entry);
            if (this.messages.length > 300) this.messages.shift();
            this.renderChat();
        }

        send(text) {
            text = String(text || '').trim();
            if (!text) return;
            this.say(this.username, text);
            this._say({ type: 'chat', by: this.username, text: text });
        }

        renderChat() {
            var host = document.getElementById('log');
            if (!host) return;
            var self = this;
            var rows = (this.messages || []).map(function (m) {
                if (m.kind !== 'chat') {
                    return UI.el('div', { class: 'ev ev--' + m.kind }, [
                        UI.iconNode(m.kind === 'leave' ? 'log-out' : m.kind === 'share' ? 'dashboard' : 'users', 'icon--sm'),
                        UI.el('span', {}, m.text)
                    ]);
                }
                return UI.el('div', { class: 'msg' }, [
                    UI.el('span', {
                        class: 'avatar msg__who',
                        style: 'background:' + self.generateUserColor(m.from)
                    }, initials(m.from)),
                    UI.el('div', { class: 'msg__body' }, [
                        UI.el('span', { class: 'msg__head' }, [
                            UI.el('span', { class: 'msg__name' }, m.from),
                            UI.el('span', { class: 'msg__time' }, time(m.at))
                        ]),
                        UI.el('p', { class: 'msg__text' }, m.text)
                    ])
                ]);
            });
            host.replaceChildren.apply(host, rows);
            host.scrollTop = host.scrollHeight;
        }

        /**
         * Live streaming rides a relay agent. Ask once, and if there is none,
         * say so rather than leaving a dead Camera button on screen.
         */
        _checkStreamingAvailable() {
            var self = this;
            return new Promise(function (resolve) {
                if (!self.channel || typeof self.channel.getSystemAgents !== 'function') {
                    self._setStreaming(false, 'This deployment has no streaming relay.');
                    return resolve();
                }
                var settled = false;
                var done = function (ok, why) {
                    if (settled) return;
                    settled = true;
                    self._setStreaming(ok, why);
                    resolve();
                };
                setTimeout(function () { done(false, 'The streaming relay did not answer.'); }, 6000);

                self.channel.getSystemAgents(function (res) {
                    var list = (res && res.status === 'success' && res.data) || [];
                    var relays = list.filter(function (a) {
                        return a.role === 'webrtc-relay'
                            || (a.metadata && a.metadata.role === 'webrtc-relay')
                            || (a.agentContext && a.agentContext.role === 'webrtc-relay');
                    });
                    done(relays.length > 0, relays.length ? '' : 'This deployment has no streaming relay.');
                });
            });
        }

        _setStreaming(ok, why) {
            this.streaming = !!ok;
            var banner = document.getElementById('noStream');
            if (banner) {
                banner.hidden = !!ok;
                if (!ok && why) banner.querySelector('.notice__text').textContent =
                    why + ' Presence and screen names still work — the camera and screen share do not.';
            }
            ['camBtn', 'micBtn', 'shareScreenBtn'].forEach(function (id) {
                var b = document.getElementById(id);
                if (b) b.disabled = !ok;
            });
        }

        _sync() {
            var n = this.getUserCount();
            this._status(n > 1 ? 'live' : 'busy', n > 1 ? n + ' in the room' : 'waiting for someone');
            this.renderPeople();
            this.renderStage();
        }

        _status(kind, text) {
            var pill = document.getElementById('statusPill');
            if (!pill) return;
            pill.className = 'pill-status is-' + kind;
            pill.querySelector('.pill-status__text').textContent = text;
        }

        // ---- the small facts the channel actually carries ---------------------

        _announce() {
            // Presence facts go on the channel: small, rare, and they must
            // reach a peer whose media connection has not come up yet.
            this._say({
                type: 'state', by: this.username,
                cam: !!(this.localStream && this._hasLive(this.localStream, 'video')),
                mic: !!(this.localStream && this._hasLive(this.localStream, 'audio')),
                presenting: !!this.screenStream
            });
        }

        /**
         * One place that knows how a Rooms message travels: to the host, which
         * relays it to everyone. A guest broadcasting to '*' reaches the host
         * and nobody else.
         */
        _say(payload) {
            // An id per message: the host relays, so everyone can see the same
            // one twice and needs a way to tell.
            if (!payload.id) {
                payload.id = this.username + ':' + Date.now().toString(36)
                    + Math.random().toString(36).slice(2, 6);
            }
            try {
                if (this.isHost()) {
                    payload._relayed = true;
                    this.sendCustomEventMessage(payload, '*');
                } else {
                    var host = this._getHostName();
                    this.sendCustomEventMessage(payload, host || '*');
                }
            } catch (err) {
                console.warn('[Rooms] send failed:', err.message);
            }
        }

        _hasLive(stream, kind) {
            return stream.getTracks().some(function (t) {
                return t.kind === kind && t.enabled && t.readyState === 'live';
            });
        }

        onGameMessage(detail) {
            var d = detail && detail.data ? detail.data : detail;
            if (!d || !d.by) return;

            // The host is the room's relay. A guest's broadcast reaches the
            // host and nobody else, so everything goes to the host and the host
            // passes it on — the same shape Pulse's votes use.
            if (this.isHost() && !d._relayed) {
                d._relayed = true;
                try { this.sendCustomEventMessage(d, '*'); } catch (e) { /* best effort */ }
            }
            if (d.by === this.username) return;

            // The host sees each message twice: once addressed to it, once as
            // its own relay coming back. Every message carries an id so the
            // second copy is dropped rather than shown again.
            if (d.id) {
                this.seen = this.seen || [];
                if (this.seen.indexOf(d.id) !== -1) return;
                this.seen.push(d.id);
                if (this.seen.length > 400) this.seen.shift();
            }

            if (d.type === 'chat') { this.say(d.by, d.text); return; }
            if (d.type !== 'state') return;
            var was = this.state.get(d.by) || {};
            this.state.set(d.by, { cam: !!d.cam, mic: !!d.mic, presenting: !!d.presenting });
            if (d.presenting && !was.presenting) this.note(d.by + ' started sharing their screen', 'share');
            if (!d.presenting && was.presenting) this.note(d.by + ' stopped sharing', 'share');
            if (d.presenting) this.presenter = d.by;
            else if (this.presenter === d.by) { this.presenter = null; this.screenOf = null; }
            this.renderPeople();
            this.renderStage();
        }

        // ---- media -----------------------------------------------------------

        async toggleCamera() {
            if (!this.streaming) return;
            if (this.localStream && this._hasLive(this.localStream, 'video')) {
                this.localStream.getVideoTracks().forEach(function (t) { t.stop(); });
                this.localStream = null;
                if (this.webrtcHelper && this.webrtcHelper.stopStreamBroadcast) {
                    try { this.webrtcHelper.stopStreamBroadcast('cam-' + this.username); } catch (e) { /* ignore */ }
                }
            } else {
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({
                        video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true
                    });
                } catch (err) {
                    UI.toast('Could not use the camera: ' + err.message, 'error', 5000);
                    return;
                }
                this._broadcast('cam-' + this.username, this.localStream);
            }
            this._announce();
            this.renderStage();
            this.renderPeople();
            this._syncButtons();
        }

        toggleMic() {
            if (!this.localStream) { UI.toast('Turn the camera on first', 'info'); return; }
            var on = this._hasLive(this.localStream, 'audio');
            this.localStream.getAudioTracks().forEach(function (t) { t.enabled = !on; });
            this._announce();
            this._syncButtons();
        }

        async toggleScreen() {
            if (!this.streaming) return;
            if (this.screenStream) {
                this.screenStream.getTracks().forEach(function (t) { t.stop(); });
                this.screenStream = null;
                if (this.webrtcHelper && this.webrtcHelper.stopStreamBroadcast) {
                    try { this.webrtcHelper.stopStreamBroadcast('screen-' + this.username); } catch (e) { /* ignore */ }
                }
                if (this.presenter === this.username) this.presenter = null;
                this.note('You stopped sharing', 'share');
            } else {
                try {
                    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                } catch (err) {
                    if (err && err.name !== 'NotAllowedError') UI.toast('Screen share failed: ' + err.message, 'error', 5000);
                    return;
                }
                var self = this;
                // Stopping from the browser's own bar has to reach the room too.
                this.screenStream.getVideoTracks().forEach(function (t) {
                    t.addEventListener('ended', function () { self.toggleScreen(); });
                });
                this.presenter = this.username;
                this.note('You started sharing your screen', 'share');
                this._broadcast('screen-' + this.username, this.screenStream);
            }
            this._announce();
            this.renderStage();
            this._syncButtons();
        }

        _broadcast(id, stream) {
            if (!this.webrtcHelper || !this.webrtcHelper.startStreamBroadcast) return;
            try {
                this.webrtcHelper.startStreamBroadcast(id, stream);
            } catch (err) {
                console.warn('[Rooms] broadcast failed:', err);
                UI.toast('Could not start the stream', 'error');
            }
        }

        onStreamReady(streamId, remoteAgent) {
            console.log('[Rooms] stream ready from', remoteAgent, streamId);
        }

        /** A remote stream arrived — put it where it belongs. */
        acceptStream(streamId, stream, from) {
            var who = from || String(streamId || '').replace(/^(cam|screen)-/, '');
            var isScreen = String(streamId || '').indexOf('screen-') === 0;
            if (isScreen) { this.presenter = who; this.screenOf = stream; }
            else this.remote.set(who, { stream: stream });
            this.renderStage();
            this.renderPeople();
        }

        _syncButtons() {
            var cam = this.localStream && this._hasLive(this.localStream, 'video');
            var mic = this.localStream && this._hasLive(this.localStream, 'audio');
            set('camBtn', cam, cam ? 'Camera on' : 'Camera');
            set('micBtn', mic, mic ? 'Mute' : 'Unmute');
            set('shareScreenBtn', !!this.screenStream, this.screenStream ? 'Stop sharing' : 'Share screen');

            function set(id, on, label) {
                var b = document.getElementById(id);
                if (!b) return;
                b.classList.toggle('btn--primary', !!on);
                var span = b.querySelector('span');
                if (span) span.textContent = label;
            }
        }

        // ---- rendering -------------------------------------------------------

        renderStage() {
            var stage = document.getElementById('stage');
            if (!stage) return;

            var presenting = this.presenter;
            var stream = presenting === this.username ? this.screenStream : this.screenOf;

            if (presenting && stream) {
                var video = stage.querySelector('video.stage__video');
                if (!video) {
                    video = UI.el('video', { class: 'stage__video', autoplay: true, playsinline: true, muted: true });
                    stage.replaceChildren(video, UI.el('span', { class: 'stage__tag' }, [
                        UI.el('span', { class: 'stage__dot' }),
                        presenting === this.username ? 'You are presenting' : presenting + ' is presenting'
                    ]));
                }
                if (video.srcObject !== stream) video.srcObject = stream;
                return;
            }

            if (presenting) {
                stage.replaceChildren(UI.el('div', { class: 'sdk-empty' }, [
                    UI.iconNode('video'),
                    UI.el('p', {}, presenting + ' is presenting — waiting for the stream')
                ]));
                return;
            }

            stage.replaceChildren(UI.el('div', { class: 'sdk-empty' }, [
                UI.iconNode('video'),
                UI.el('p', {}, this.streaming
                    ? 'Nobody is presenting. Share your screen to start.'
                    : 'Streaming is unavailable on this deployment.')
            ]));
        }

        renderPeople() {
            var host = document.getElementById('people');
            var count = document.getElementById('peopleCount');
            if (!host) return;

            var self = this;
            // getUserList() is the one that includes you and marks the host;
            // getConnectedUsers() is the raw roster and leaves you out of it.
            var users = this.getUserList() || [];
            if (count) count.textContent = users.length;

            host.replaceChildren.apply(host, users.map(function (user) {
                var name = user.name;
                var me = !!user.isSelf;
                var st = me
                    ? { cam: !!(self.localStream && self._hasLive(self.localStream, 'video')),
                        mic: !!(self.localStream && self._hasLive(self.localStream, 'audio')) }
                    : (self.state.get(name) || { cam: false, mic: false });

                var rec = self.remote.get(name);
                var tile = UI.el('div', { class: 'tile' + (self.presenter === name ? ' is-presenting' : '') });
                if (user.isHost) tile.appendChild(UI.el('span', { class: 'tile__host', title: 'Host' }, 'HOST'));

                if (me && self.localStream && st.cam) {
                    var v = UI.el('video', { class: 'tile__video', autoplay: true, playsinline: true, muted: true });
                    v.srcObject = self.localStream;
                    tile.appendChild(v);
                } else if (rec && rec.stream) {
                    var rv = UI.el('video', { class: 'tile__video', autoplay: true, playsinline: true });
                    rv.srcObject = rec.stream;
                    tile.appendChild(rv);
                } else {
                    tile.appendChild(UI.el('span', {
                        class: 'avatar avatar--lg',
                        style: 'background:' + self.generateUserColor(name)
                    }, initials(name)));
                }

                tile.appendChild(UI.el('span', { class: 'tile__name' }, me ? name + ' (you)' : name));
                if (self.presenter === name) {
                    tile.appendChild(UI.el('span', { class: 'tile__badge' }, 'Sharing'));
                }
                if (!st.mic) {
                    tile.appendChild(UI.el('span', { class: 'tile__muted', title: 'Muted' },
                        UI.iconNode('x', 'icon--sm')));
                }
                return tile;
            }));
        }
    }

    function time(ts) {
        var d = new Date(ts || Date.now());
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map(function (p) { return p[0]; }).join('').toUpperCase() || '?';
    }

    // ---- boot ---------------------------------------------------------------

    var app = null;

    function wire() {
        document.getElementById('camBtn').addEventListener('click', function () { if (app) app.toggleCamera(); });
        document.getElementById('micBtn').addEventListener('click', function () { if (app) app.toggleMic(); });
        document.getElementById('shareScreenBtn').addEventListener('click', function () { if (app) app.toggleScreen(); });
        var form = document.getElementById('chatForm');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var input = document.getElementById('chatInput');
                if (app) app.send(input.value);
                input.value = '';
            });
        }

        document.getElementById('leaveBtn').addEventListener('click', function () {
            if (app) { try { app.disconnect(); } catch (e) { /* ignore */ } }
            location.href = '../../playground.html';
        });
    }

    async function connect(username, channel, password) {
        try {
            app = new Rooms();
            window.roomsApp = app;
            await app.connect({ username: username, channelName: channel, channelPassword: password });
            app.start();

            // Remote media arrives on the helper the base class built.
            if (app.webrtcHelper && app.webrtcHelper.on) {
                app.webrtcHelper.on('stream-added', function (streamId, stream, sourceAgent) {
                    app.acceptStream(streamId, stream, sourceAgent);
                });
                app.webrtcHelper.on('stream-removed', function (streamId) {
                    var who = String(streamId || '').replace(/^(cam|screen)-/, '');
                    if (String(streamId).indexOf('screen-') === 0) {
                        if (app.presenter === who) { app.presenter = null; app.screenOf = null; }
                    } else app.remote.delete(who);
                    app.renderStage();
                    app.renderPeople();
                });
            }

            document.getElementById('roomName').textContent = channel;
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            if (typeof window.encodeChannelAuth === 'function') {
                var encoded = window.encodeChannelAuth(channel, password, null);
                if (encoded) history.replaceState(null, '', '#' + encoded);
            }
        } catch (err) {
            console.error('[Rooms] connect failed:', err);
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
