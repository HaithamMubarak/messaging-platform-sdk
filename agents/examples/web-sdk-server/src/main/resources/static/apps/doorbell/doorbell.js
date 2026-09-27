/**
 * Doorbell — Knock: reach somebody whose page is closed.
 *
 * Two halves on one page. The resident lets this browser ring (a push
 * subscription for this channel) and closes the tab. A visitor rings them.
 * The resident's device shows a notice even with no tab open.
 *
 * The part worth copying is the split, which is the whole design of Knock:
 *   - the knock carries NOTHING -- not who rang, not why. The push service
 *     learns that something happened and never what;
 *   - what happened goes into channel storage, where only people with the
 *     channel password can read it, and the page fetches it when the
 *     resident opens it.
 * And the sentence that goes with it: "a knock was sent" is all anybody can
 * honestly say. Whether a person saw it is up to their browser and them.
 */
(function () {
    'use strict';

    const RINGS = 'doorbell.rings';

    class Doorbell extends UserConnectionBase {
        constructor() {
            super({ storagePrefix: 'doorbell_', customType: 'doorbell', autoCreateDataChannel: true, dataChannelName: 'doorbell-data' });
            this.reachable = [];     // [{agent, devices}] -- names and counts, never endpoints
            this.rings = [];         // newest first, from channel storage
            this.ringing = null;     // result of this browser's subscription attempt
            this.lastSent = null;    // what the platform said about our last ring
        }

        onConnect() {
            UI.toast('Connected to ' + this.channelName, 'success');
            this.refresh();
        }
        onUserJoin() { this.refresh(); }
        onUserLeave() { this.refresh(); }

        /** A ring is saved to storage; the others' pages pick it up from there. */
        onDataChannelMessage(peer, data) {
            if (data && data.t === 'rang') this.loadRings();
        }

        refresh() {
            this.loadReachable();
            this.loadRings();
        }

        loadReachable() {
            this.channel.knockReachable((res) => {
                const list = res && res.status === 'success' && res.data && res.data.reachable;
                this.reachable = Array.isArray(list) ? list : [];
                this.render();
            });
        }

        loadRings() {
            this.channel.storageReadList(RINGS).then((rows) => {
                this.rings = rows.filter((r) => r && r.to && r.at);
                this.render();
            }, () => { /* the list stays as it was; the next refresh tries again */ });
        }

        // ---- the resident's half -----------------------------------------------

        /**
         * Subscribe this browser. From a click, never on load: a prompt nobody
         * asked for is refused by some browsers and resented by everyone.
         * The shared worker at the site root is narrowed to this demo's
         * directory, so a click on the notice opens this page.
         */
        async letThisRing() {
            this.ringing = await this.channel.knockSubscribe({ swPath: '../../knock-sw.js', swScope: './' });
            this.render();
            this.loadReachable();
        }

        // ---- the visitor's half ------------------------------------------------

        /** Say who rang where only the channel can read it, then knock with nothing in it. */
        async ring(agent) {
            const record = { to: agent, from: this.username, at: Date.now() };
            await new Promise((resolve) => this.channel.storageAdd({ storageKey: RINGS, content: record }, resolve));
            this.sendData({ t: 'rang' });
            this.channel.knock(agent, { tag: 'doorbell' }, (res) => {
                this.lastSent = res && res.status === 'success' ? res.data : { meaning: 'No knock was sent: ' + ((res && res.data) || 'no answer') + '.' };
                this.render();
                this.loadRings();
            });
        }

        // ---- render -------------------------------------------------------------

        render() {
            this._renderSelf();
            this._renderPeople();
            this._renderRings();
            const n = (this.getConnectedUsers() || []).length;
            const pill = document.getElementById('statusPill');
            pill.className = 'pill-status is-' + (this.connected ? 'live' : 'off');
            pill.querySelector('.pill-status__text').textContent = this.connected ? n + ' here' : 'Not connected';
        }

        _renderSelf() {
            const me = this.reachable.find((r) => r.agent === this.username);
            const says = {
                unsupported: 'This browser cannot receive knocks. On an iPhone, add this page to the Home Screen first.',
                denied: 'Notifications are blocked for this site. Allow them in the browser settings, then try again.',
                no_key: 'This server has no push key configured.',
                ephemeral_key: 'This server has only a temporary push key, so a subscription would stop working at its next restart.',
                subscribe_failed: 'The browser could not subscribe' + (this.ringing && this.ringing.detail ? ': ' + this.ringing.detail : '.'),
            };
            const el = document.getElementById('selfState');
            if (me) el.textContent = 'This browser can ring (' + me.devices + (me.devices === 1 ? ' device' : ' devices') + ' under your name). You can close the tab.';
            else if (this.ringing && !this.ringing.ok) el.textContent = says[this.ringing.reason] || ('Could not subscribe: ' + this.ringing.reason);
            else el.textContent = 'This browser will not ring yet.';
            document.getElementById('ringBtn').textContent = me ? 'Subscribed' : 'Let this browser ring';
        }

        _renderPeople() {
            const list = document.getElementById('people');
            const others = this.reachable.filter((r) => r.agent !== this.username);
            list.replaceChildren(...others.map((r) => {
                const li = document.createElement('li'), b = document.createElement('button');
                li.append(document.createTextNode(r.agent + ' · ' + r.devices + (r.devices === 1 ? ' device ' : ' devices ')));
                b.type = 'button'; b.className = 'btn btn--sm btn--primary'; b.textContent = 'Ring';
                b.addEventListener('click', () => this.ring(r.agent));
                li.appendChild(b);
                return li;
            }));
            document.getElementById('nobody').hidden = others.length > 0;
            const sent = document.getElementById('sentNote');
            sent.hidden = !this.lastSent;
            if (this.lastSent) sent.textContent = this.lastSent.meaning
                + (this.lastSent.devices ? ' (' + (this.lastSent.sent || 0) + ' of ' + this.lastSent.devices + ' devices accepted by their push service'
                   + (this.lastSent.rateCapped ? ', ' + this.lastSent.rateCapped + ' held back by the rate cap' : '') + ')' : '');
        }

        _renderRings() {
            const mine = this.rings.filter((r) => r.to === this.username);
            const list = document.getElementById('rings');
            list.replaceChildren(...mine.slice(0, 10).map((r) => {
                const li = document.createElement('li');
                li.textContent = r.from + ' rang · ' + new Date(r.at).toLocaleString();
                return li;
            }));
            document.getElementById('noRings').hidden = mine.length > 0;
        }
    }

    // ---- page ------------------------------------------------------------------

    let app = null;

    function invite() {
        if (!app || !app.connected) { UI.toast('Join a room first', 'info'); return; }
        if (typeof ShareModal === 'undefined' || !ShareModal.show) { UI.toast('Sharing is not available on this page', 'error'); return; }
        ShareModal.show(app.channelName, app.channelPassword);
    }

    function wire() {
        document.getElementById('shareBtn').addEventListener('click', invite);
        document.getElementById('ringBtn').addEventListener('click', () => { if (app) app.letThisRing(); });
    }

    async function connect(username, channel, password) {
        try {
            app = new Doorbell();
            window.doorbellApp = app;
            await app.connect({ username, channelName: channel, channelPassword: password });
            app.start();
            document.getElementById('roomName').textContent = channel;
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            app.render();
        } catch (err) {
            console.error('[Doorbell] connect failed:', err);
            if (window.ConnectionModal) ConnectionModal.fail(err);
            UI.toast('Could not connect: ' + err.message, 'error', 5000);
            app = null;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        wire();
        window.loadConnectionModal({
            localStoragePrefix: 'doorbell_', channelPrefix: 'doorbell-',
            title: 'Join a doorbell room', collapsedTitle: 'Doorbell', onConnect: connect,
        });
        setTimeout(() => {
            const m = document.getElementById('connectionModal');
            if (m) m.classList.add('active');
        }, 200);
    });
})();
