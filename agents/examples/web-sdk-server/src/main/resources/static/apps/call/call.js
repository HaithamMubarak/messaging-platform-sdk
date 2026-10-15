/**
 * Call — camera, microphone and screen share, peer to peer.
 *
 * The demo of WebRtcHelper's media side. The channel carries only who is
 * here and what they have switched on; the pictures go straight between
 * browsers. Every pair negotiates its own stream (a mesh), which is right
 * for a handful of people and is the honest limit of this page: past six or
 * so, each person's upload runs out, and a room that size wants the SFU
 * (Rooms' broadcast mode uses it).
 *
 * The three things worth copying out of this file:
 *   1. The stream goes IN THE OFFER: createStreamOffer(peer, {stream}).
 *      Called with {} it negotiates nothing, and your camera shows in your
 *      own tab and nowhere else.
 *   2. One outgoing stream per peer, replaced rather than added: turning on
 *      the screen swaps it onto the camera's connection (replaceStream), so
 *      nothing is renegotiated; only a kind the connection never sent needs
 *      a new offer. A broken connection is reconnected by the helper itself,
 *      under the same id, so this file never has to.
 *   3. The browser's own "Stop sharing" bar ends the track without asking
 *      the page; listen for 'ended' or the app thinks it is still sharing.
 */
(function () {
    'use strict';

    class Call extends UserConnectionBase {
        constructor() {
            super({ storagePrefix: 'call_', customType: 'call', autoCreateDataChannel: true, dataChannelName: 'call-data' });
            this.cam = null;            // MediaStream from getUserMedia
            this.screen = null;         // MediaStream from getDisplayMedia
            this.outgoing = new Map();  // peer -> stream id of what we are sending them
            this.remote = new Map();    // peer -> {stream, cam, screen, mic}
            this.linkDown = new Map();  // stream id -> peer, while that connection is down
            this._wiredHelper = null;
        }

        // ---- lifecycle -------------------------------------------------------

        onConnect() {
            this._wireHelper();
            UI.toast('Connected to ' + this.channelName, 'success');
            this.render();
        }

        onDisconnect() { this.render(); }

        /** The data channel to a peer is open: offer them whatever we already have on. */
        onUserJoin(detail) {
            this._wireHelper();
            const peer = detail && detail.agentName;
            // A rejoin (their tab reloaded) leaves our old connection to them dead: replace it.
            if (peer && peer !== this.username && this.current()) { this._closeTo(peer); this._offer(peer, this.current()); }
            this._announce(peer);
            this.render();
        }

        onUserLeave(detail) {
            const peer = detail && detail.agentName;
            if (!peer) return;
            this._closeTo(peer);
            this.remote.delete(peer);
            this.render();
        }

        /** A reconnect builds a new helper, so its listener is attached per helper. */
        _wireHelper() {
            if (!this.webrtcHelper || this._wiredHelper === this.webrtcHelper) return;
            this._wiredHelper = this.webrtcHelper;
            this.linkDown.clear();
            this._wireLinkState(this.webrtcHelper);
            this.webrtcHelper.on('remote-stream', (sid, stream, peer) => {
                const r = this.remote.get(peer) || {};
                this.remote.set(peer, Object.assign(r, { stream, sid }));
                this.render();
            });
            // Closed by the other side, or given up on after its reconnect attempts.
            this.webrtcHelper.on('stream-closed', (sid, peer) => {
                if (this.outgoing.get(peer) === sid) this.outgoing.delete(peer);
                const r = this.remote.get(peer);
                if (r && r.sid === sid) { r.stream = null; r.sid = null; this.render(); }
            });
        }

        /**
         * Which peers' connections are down and being brought back. The helper
         * reconnects by itself (ICE restart, then a new connection); this only
         * says so on the tile, so a frozen picture reads as "reconnecting"
         * instead of as a hang. Both ends see it: the offerer through the
         * helper's reconnect events, the answerer through the connection state.
         */
        _wireLinkState(h) {
            const mark = (sid, peer) => {
                if (peer) this.linkDown.set(sid, peer); else this.linkDown.delete(sid);
                this.render();
            };
            h.on('connection-state', (sid, state) => {
                if (state === 'connected') mark(sid, null);
                else if (state === 'disconnected' || state === 'failed') mark(sid, (h.streamSessions.get(sid) || {}).remoteAgent);
            });
            h.on('stream-reconnecting', (sid, peer) => mark(sid, peer));
            h.on('stream-recovered', (sid) => mark(sid, null));
            h.on('stream-closed', (sid) => mark(sid, null));
        }

        isReconnecting(peer) {
            for (const p of this.linkDown.values()) if (p === peer) return true;
            return false;
        }

        // ---- what is on --------------------------------------------------------

        /** Screen wins: it is what we last sent, and what the others should see. */
        current() { return this.screen || this.cam; }

        async toggleCamera() {
            this._levels();
            if (this.cam) {
                this.cam.getTracks().forEach((t) => t.stop());
                this.cam = null;
            } else {
                const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
                // A camera can end without the page asking: unplugged, taken by
                // another app, a privacy switch. Without this the tile freezes
                // and the room is still told the camera is on.
                cam.getVideoTracks().forEach((t) => t.addEventListener('ended', () => this._cameraLost(cam)));
                this.cam = cam;
            }
            this._publish();
        }

        _cameraLost(cam) {
            if (this.cam !== cam) return;   // already switched off, or replaced
            UI.toast('Your camera stopped. It may have been unplugged or taken by another app.', 'error', 6000);
            cam.getTracks().forEach((t) => t.stop());
            this.cam = null;
            this._publish();
        }

        toggleMic() {
            if (!this.cam) return;
            this.cam.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
            this._announce();
            this.render();
        }

        async toggleScreen() {
            if (this.screen) {
                this.screen.getTracks().forEach((t) => t.stop());
                this.screen = null;
            } else {
                this.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
                // The browser's own "Stop sharing" bar ends the track, not our button.
                this.screen.getVideoTracks().forEach((t) => t.addEventListener('ended', () => {
                    if (this.screen) this.toggleScreen();
                }));
            }
            this._publish();
        }

        micOn() {
            return !!this.cam && this.cam.getAudioTracks().some((t) => t.enabled);
        }

        // ---- the mesh ----------------------------------------------------------

        /** Replace what every peer receives from us with the current stream (or nothing). */
        _publish() {
            const stream = this.current();
            this.peers().forEach((peer) => this._sendTo(peer, stream));
            this._announce();
            this.render();
        }

        /** Swap in place when the connection can carry it; otherwise close and offer anew. */
        async _sendTo(peer, stream) {
            const sid = this.outgoing.get(peer);
            if (stream && sid && await this.webrtcHelper.replaceStream(sid, stream).catch(() => false)) return;
            this._closeTo(peer);
            if (stream) this._offer(peer, stream);
        }

        /*
         * An offer takes a moment to negotiate, and the camera can be switched
         * off inside that moment. Its id is not in `outgoing` yet, so
         * _closeTo cannot close it -- and it would land AFTER "camera off",
         * showing a camera its owner had turned off. So an offer that resolves
         * for a stream that is no longer current is closed on arrival.
         */
        _offer(peer, stream) {
            this.webrtcHelper.createStreamOffer(peer, { stream }).then((sid) => {
                if (stream !== this.current()) { this.webrtcHelper.closeStream(sid); return; }
                this.outgoing.set(peer, sid);
            }).catch((e) => console.warn('[Call] offer to ' + peer + ' failed:', e));
        }

        _closeTo(peer) {
            const sid = this.outgoing.get(peer);
            if (sid && this.webrtcHelper) this.webrtcHelper.closeStream(sid);
            this.outgoing.delete(peer);
        }

        /** Tell the room what we have on, so a stopped camera clears its tile everywhere. */
        _announce(to) {
            const state = { t: 'media', cam: !!this.cam, screen: !!this.screen, mic: this.micOn() };
            if (to) this.sendData(state, to); else this.sendData(state);
        }

        /**
         * Who said it is the transport's word, read through the host relay.
         * `senderOf(peer)` alone named the HOST as the author of every guest's
         * message, so in a call of three each guest's "camera on" was filed
         * under the host: the guests received each other's pictures and never
         * showed them. Only two-person calls worked.
         */
        onDataChannelMessage(peer, data) {
            if (!data) return;
            const from = this.senderOf(peer, data);
            if (!from || from === this.username) return;
            if (data.t === 'react') { this._showReaction(from, data.e); return; }
            if (data.t !== 'media') return;
            const r = this.remote.get(from) || {};
            Object.assign(r, { cam: !!data.cam, screen: !!data.screen, mic: !!data.mic });
            this.remote.set(from, r);
            this.render();
        }

        // ---- reactions ---------------------------------------------------------

        /** A reaction floats up over your tile on every screen, yours included. */
        react(e) {
            if (REACTIONS.indexOf(e) < 0) return;
            const now = Date.now();
            if (now - (this._lastReact || 0) < REACT_GAP_MS) return;
            this._lastReact = now;
            this.sendData({ t: 'react', e });
            this._showReaction(this.username, e);
        }

        _showReaction(from, e) {
            if (REACTIONS.indexOf(e) < 0) return;          // only the four on the buttons
            const seen = this._reactSeen || (this._reactSeen = new Map());
            const now = Date.now();
            if (from !== this.username && now - (seen.get(from) || 0) < REACT_GAP_MS) return;
            seen.set(from, now);
            const tile = document.querySelector('.call-tile[data-name="' + CSS.escape(from) + '"]');
            if (!tile) return;
            const bubble = document.createElement('span');
            bubble.className = 'call-react';
            bubble.textContent = e;
            bubble.style.left = (20 + Math.random() * 60) + '%';
            tile.appendChild(bubble);
            setTimeout(() => bubble.remove(), 2400);
        }

        // ---- who is speaking ---------------------------------------------------

        /**
         * A tile glows while its sound is above a whisper. One AudioContext,
         * one analyser per stream with audio, sampled a few times a second;
         * nothing is played, and your own microphone is measured, not heard.
         */
        _levels() {
            if (!this._ac) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                this._ac = new AC();
                this._meters = new Map();
                this._levelTimer = setInterval(() => this._sampleLevels(), 150);
            }
            if (this._ac.state === 'suspended') this._ac.resume().catch(() => {});
        }

        _meterFor(stream) {
            if (!stream || !stream.getAudioTracks().length || !this._ac) return null;
            let m = this._meters.get(stream.id);
            if (!m) {
                const an = this._ac.createAnalyser();
                an.fftSize = 512;
                this._ac.createMediaStreamSource(stream).connect(an);
                m = { an, buf: new Float32Array(an.fftSize) };
                this._meters.set(stream.id, m);
            }
            return m;
        }

        _sampleLevels() {
            document.querySelectorAll('.call-tile').forEach((el) => {
                const v = el.querySelector('video');
                const live = v && v.srcObject && (el.dataset.me ? this.micOn() : (this.remote.get(el.dataset.name) || {}).mic);
                const m = live ? this._meterFor(v.srcObject) : null;
                let rms = 0;
                if (m) {
                    m.an.getFloatTimeDomainData(m.buf);
                    for (let i = 0; i < m.buf.length; i++) rms += m.buf[i] * m.buf[i];
                    rms = Math.sqrt(rms / m.buf.length);
                }
                el.classList.toggle('is-speaking', rms > SPEAKING_RMS);
            });
        }

        peers() {
            return (this.getConnectedUsers() || []).filter((n) => n !== this.username);
        }

        // ---- render ------------------------------------------------------------

        render() {
            const grid = document.getElementById('tiles');
            const want = [{ name: this.username || 'You', me: true, stream: this.current(),
                            screen: !!this.screen, mic: this.micOn() }]
                .concat(this.peers().map((p) => this._remoteTile(p)));
            const keep = new Set(want.map((w) => w.name));
            Array.from(grid.children).forEach((el) => { if (!keep.has(el.dataset.name)) el.remove(); });
            want.forEach((w) => this._tile(grid, w));
            document.getElementById('camBtn').setAttribute('aria-pressed', String(!!this.cam));
            document.getElementById('micBtn').setAttribute('aria-pressed', String(this.micOn()));
            document.getElementById('micBtn').disabled = !this.cam;
            document.getElementById('screenBtn').setAttribute('aria-pressed', String(!!this.screen));
            document.getElementById('alone').hidden = this.peers().length > 0;
            this._status();
        }

        _status() {
            const pill = document.getElementById('statusPill'), n = this.peers().length;
            const [kind, text] = !this.connected ? ['off', 'Not connected']
                : n ? ['live', n + (n === 1 ? ' other person' : ' other people')] : ['busy', 'waiting for someone'];
            pill.className = 'pill-status is-' + kind;
            pill.querySelector('.pill-status__text').textContent = text;
        }

        /**
         * A peer's picture shows only while their last word says it is on. A
         * stream can arrive before that word, or after "off"; either way the
         * sender's own announcement decides, not the order packets landed in.
         */
        _remoteTile(peer) {
            const r = this.remote.get(peer) || {};
            return { name: peer, stream: (r.cam || r.screen) ? r.stream || null : null, screen: !!r.screen, mic: !!r.mic,
                     reconnecting: this.isReconnecting(peer) };
        }

        _tile(grid, w) {
            let el = grid.querySelector('[data-name="' + CSS.escape(w.name) + '"]');
            if (!el) {
                el = document.createElement('figure');
                el.className = 'call-tile';
                el.dataset.name = w.name;
                el.innerHTML = '<video autoplay playsinline></video><figcaption></figcaption>';
                grid.appendChild(el);
            }
            const video = el.querySelector('video');
            video.muted = !!w.me;   // never play your own microphone back to you
            if (video.srcObject !== (w.stream || null)) video.srcObject = w.stream || null;
            if (w.me) el.dataset.me = '1';
            el.dataset.initial = String(w.name || '?').trim().charAt(0).toUpperCase();
            el.classList.toggle('is-empty', !w.stream);
            el.classList.toggle('is-screen', !!w.screen);
            el.classList.toggle('is-reconnecting', !!w.reconnecting);
            el.querySelector('figcaption').textContent = w.name + (w.me ? ' (you)' : '')
                + (w.screen ? ' · sharing screen' : '') + (w.stream && !w.mic ? ' · muted' : '')
                + (w.reconnecting ? ' · reconnecting…' : '');
        }
    }

    const REACTIONS = ['👋', '👏', '😂', '❤️'];
    const REACT_GAP_MS = 400;     // a held button is a reaction, not a flood
    const SPEAKING_RMS = 0.02;

    /**
     * A test card for the companion's camera: colour bars, its name and a
     * running clock, drawn on a canvas and sent as a real video stream.
     */
    function testCard(name) {
        // 4:3, the tile's own shape, so nothing is cropped; words kept above
        // the bottom edge, where the tile puts the name.
        const c = Object.assign(document.createElement('canvas'), { width: 640, height: 480 });
        const g = c.getContext('2d');
        const bars = ['#e5e7eb', '#facc15', '#22d3ee', '#22c55e', '#d946ef', '#ef4444', '#3b82f6'];
        let n = 0;
        const draw = () => {
            bars.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 640 / 7, 0, 640 / 7 + 1, 300); });
            g.fillStyle = 'rgba(255,255,255,.85)';
            g.beginPath(); g.arc((n++ * 6) % 680 - 20, 150, 18, 0, Math.PI * 2); g.fill();   // the picture moves
            g.fillStyle = '#0b1120'; g.fillRect(0, 300, 640, 180);
            g.fillStyle = '#fff'; g.textAlign = 'center';
            g.font = 'bold 34px system-ui, sans-serif';
            g.fillText(name + ' · test card', 320, 352);
            g.font = '26px ui-monospace, monospace';
            g.fillText(new Date().toLocaleTimeString(), 320, 396);
        };
        draw();
        const timer = setInterval(draw, 66);
        const stream = c.captureStream(15);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
        return stream;
    }

    /**
     * The companion (companion.js): a real second connection in this tab. It
     * sends you a test card over WebRTC as its camera, so you see a picture
     * arrive from another peer, and it waves back when you react.
     */
    const COMPANION_SCRIPT = {
        onJoin(c) {
            const peer = c.connection();
            const me = c.host().username;
            setTimeout(() => {
                if (!peer.webrtcHelper) return;
                c.card = testCard(c.name);
                peer.webrtcHelper.createStreamOffer(me, { stream: c.card }).catch(() => {});
                c.send({ t: 'media', cam: true, screen: false, mic: false }, me);
            }, 1500);
        },
        onData(c, from, data) {
            if (data && data.t === 'react' && REACTIONS.indexOf(data.e) >= 0) {
                setTimeout(() => c.send({ t: 'react', e: data.e }), 700);
            }
            // Asked again after a page change: say what it has on.
            if (data && data.t === 'media') c.send({ t: 'media', cam: true, screen: false, mic: false }, c.host().username);
        }
    };

    // ---- page ------------------------------------------------------------------

    let app = null;

    function invite() {
        if (!app || !app.connected) { UI.toast('Join a call first', 'info'); return; }
        if (typeof ShareModal === 'undefined' || !ShareModal.show) { UI.toast('Sharing is not available on this page', 'error'); return; }
        ShareModal.show(app.channelName, app.channelPassword);
    }

    function wire() {
        document.getElementById('shareBtn').addEventListener('click', invite);
        const run = (fn) => () => {
            if (!app) return;
            Promise.resolve(fn()).catch((e) => UI.toast(e && e.name === 'NotAllowedError'
                ? 'The browser was not allowed to use that device.' : 'Could not start: ' + (e && e.message), 'error', 5000));
        };
        document.getElementById('camBtn').addEventListener('click', run(() => app.toggleCamera()));
        document.getElementById('micBtn').addEventListener('click', run(() => app.toggleMic()));
        document.getElementById('screenBtn').addEventListener('click', run(() => app.toggleScreen()));
        document.getElementById('reactions').addEventListener('click', (e) => {
            const b = e.target.closest('[data-react]');
            if (b && app && app.connected) { app._levels(); app.react(b.dataset.react); }
        });
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            document.getElementById('screenBtn').hidden = true;   // phones cannot share a screen
        }
    }

    async function connect(username, channel, password) {
        try {
            app = new Call();
            window.callApp = app;
            await app.connect({ username, channelName: channel, channelPassword: password });
            app.start();
            document.getElementById('roomName').textContent = channel;
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            if (typeof window.encodeChannelAuth === 'function') {
                const encoded = window.encodeChannelAuth(channel, password, null);
                if (encoded) history.replaceState(null, '', '#' + encoded);
            }
            app.render();
            if (window.Companion) {
                window.callCompanion = window.Companion.attach(app, COMPANION_SCRIPT, {
                    noteText: 'The companion is a second connection running in this tab. Its camera is a test card, ' +
                              'sent to you over a real WebRTC connection, but there is no network between you, so ' +
                              'the quality here is not representative.'
                });
            }
        } catch (err) {
            console.error('[Call] connect failed:', err);
            if (window.ConnectionModal) ConnectionModal.fail(err);
            UI.toast('Could not connect: ' + err.message, 'error', 5000);
            app = null;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        wire();
        window.loadConnectionModal({
            localStoragePrefix: 'call_', channelPrefix: 'call-',
            title: 'Join a call', collapsedTitle: 'Call', onConnect: connect,
            partyLobby: {
                id: 'call', start: 'Start a call', players: '2–4 people',
                waitingRoom: {
                    hint: 'Nobody here yet? Add a companion: it joins as a second person and sends you a test card.',
                    solo: { label: 'Add a companion', close: true, run: () => {
                        const btn = document.querySelector('.companion-btn');
                        if (btn && !btn.classList.contains('is-on')) btn.click();
                    } }
                },
                howTo: [
                    'Start a call and send the code to whoever you want to see.',
                    'Turn your camera and microphone on when you are ready.',
                    'Share your screen instead of your camera, any time.',
                ],
            },
        });
        setTimeout(() => {
            const m = document.getElementById('connectionModal');
            if (m) m.classList.add('active');
        }, 200);
    });
})();
