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
 *      the screen closes the camera's connection and offers the screen.
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
            if (peer && peer !== this.username && this.current()) this._offer(peer, this.current());
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
            this.webrtcHelper.on('remote-stream', (sid, stream, peer) => {
                const r = this.remote.get(peer) || {};
                this.remote.set(peer, Object.assign(r, { stream }));
                this.render();
            });
        }

        // ---- what is on --------------------------------------------------------

        /** Screen wins: it is what we last sent, and what the others should see. */
        current() { return this.screen || this.cam; }

        async toggleCamera() {
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
            this.peers().forEach((peer) => {
                this._closeTo(peer);
                if (stream) this._offer(peer, stream);
            });
            this._announce();
            this.render();
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

        onDataChannelMessage(peer, data) {
            if (!data || data.t !== 'media') return;
            const from = this.senderOf(peer);
            const r = this.remote.get(from) || {};
            Object.assign(r, { cam: !!data.cam, screen: !!data.screen, mic: !!data.mic });
            this.remote.set(from, r);
            this.render();
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
            return { name: peer, stream: (r.cam || r.screen) ? r.stream || null : null, screen: !!r.screen, mic: !!r.mic };
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
            el.classList.toggle('is-empty', !w.stream);
            el.classList.toggle('is-screen', !!w.screen);
            el.querySelector('figcaption').textContent = w.name + (w.me ? ' (you)' : '')
                + (w.screen ? ' · sharing screen' : '') + (w.stream && !w.mic ? ' · muted' : '');
        }
    }

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
        });
        setTimeout(() => {
            const m = document.getElementById('connectionModal');
            if (m) m.classList.add('active');
        }, 200);
    });
})();
