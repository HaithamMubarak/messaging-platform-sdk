/**
 * Under the Hood — the machinery, on screen.
 *
 * Every app on this site uses host election, presence and a relay topology, and
 * none of them shows you any of it: you find out there was a host only when it
 * leaves and something stops working. This page is the one that shows the
 * plumbing, which makes it the useful page to have open while debugging any of
 * the others.
 *
 * What it draws is all read from UserConnectionBase — no new protocol, no
 * privileged access. That is deliberate: if this page can see it, so can your
 * app, and the code here is short enough to copy.
 *
 *   - the roster, with connection times, because that is what host election
 *     actually sorts on;
 *   - who the host is, and the fact that everyone independently agrees;
 *   - the relay topology (star through the host, or mesh);
 *   - a live message log, and
 *   - a "step aside" button that makes the host leave on purpose, so you can
 *     watch an election happen instead of reading about one.
 */
(function () {
    'use strict';

    var MAX_LOG = 120;

    function el(id) { return document.getElementById(id); }

    class UnderTheHood extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'hood_',
                customType: 'hood',
                // This page exists to show what actually travels on a channel,
                // so it opts out of the customType filter every other app
                // wants: a message from some other app sharing this room is
                // exactly the thing worth seeing here, not noise to drop.
                promiscuous: true,
                autoCreateDataChannel: true    // so the topology has edges to draw
            });
            this.log = [];
        }

        onConnect(detail) {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            this.note('connected', 'joined as ' + this.username +
                (detail && detail.isHost ? ' — and is the host' : ''));
            this.refresh();
            // Presence changes are events, but connection state is a value:
            // poll it so the panel is right even when nothing has happened.
            this._timer = setInterval(() => this.refresh(), 2000);
        }

        onDisconnect() {
            clearInterval(this._timer);
            this.note('disconnected', 'left the channel');
            this.refresh();
        }

        onUserJoin(detail) {
            this.note('join', (detail && detail.agentName) + ' joined');
            this.refresh();
        }

        onUserLeave(detail) {
            this.note('leave', (detail && detail.agentName) + ' left');
            this.refresh();
        }

        onBecomeHost() {
            this.note('host', 'this tab became the host');
            this.refresh();
        }

        onLoseHost() {
            this.note('host', 'this tab is no longer the host');
            this.refresh();
        }

        onGameMessage(detail) {
            var from = this.senderOf(detail) || 'unknown';
            var data = (detail && detail.data) ? detail.data : detail;
            this.note('message', from + ' → ' + (data && data.type ? data.type : 'message'));
            this.refresh();
        }

        onDataChannelOpen(peerId, ms) {
            this.note('datachannel', 'data channel open with ' + peerId +
                (ms ? ' (' + ms + 'ms)' : ''));
            this.refresh();
        }

        // ---- actions ---------------------------------------------------------

        ping() {
            this.sendCustomEventMessage({ type: 'ping', at: Date.now() }, '*');
            this.note('sent', 'ping to everyone');
        }

        /**
         * Leave on purpose, so an election can be watched rather than described.
         *
         * This is the whole reason the page exists: host migration is the part
         * of the system nobody can see happening, and the only way to see it is
         * to make it happen.
         */
        stepAside() {
            if (!this.isHost()) {
                this.note('host', 'not the host — nothing to hand over');
                return;
            }
            this.note('host', 'stepping aside; watch another tab take over');
            this.disconnect();
        }

        note(kind, text) {
            this.log.unshift({ kind: kind, text: text, at: Date.now() });
            if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
        }

        // ---- rendering -------------------------------------------------------

        refresh() {
            var users = this.getConnectedUsers() || [];
            var host = this._getHostName();

            el('mode').textContent = this.relayMode || 'unknown';
            el('meCount').textContent = String(users.length);
            el('meHost').textContent = this.isHost() ? 'yes' : 'no';
            el('meHost').className = 'hood-fact__value' + (this.isHost() ? ' is-yes' : '');

            this.renderRoster(users, host);
            this.renderTopology(users, host);
            this.renderLog();
        }

        renderRoster(users, host) {
            var target = el('roster');
            target.innerHTML = '';
            var self = this;

            users.forEach(function (name) {
                var row = document.createElement('div');
                row.className = 'hood-peer'
                    + (name === host ? ' hood-peer--host' : '')
                    + (name === self.username ? ' hood-peer--me' : '');

                var dot = document.createElement('span');
                dot.className = 'hood-peer__dot';

                var who = document.createElement('span');
                who.className = 'hood-peer__name';
                who.textContent = name;

                var tags = document.createElement('span');
                tags.className = 'hood-peer__tags';
                if (name === host) {
                    var h = document.createElement('span');
                    h.className = 'badge badge--brand';
                    h.textContent = 'host';
                    tags.appendChild(h);
                }
                if (name === self.username) {
                    var m = document.createElement('span');
                    m.className = 'badge';
                    m.textContent = 'you';
                    tags.appendChild(m);
                }
                // A data channel to this peer, if there is one.
                if (typeof self.isDataChannelOpen === 'function'
                    && name !== self.username && self.isDataChannelOpen(name)) {
                    var d = document.createElement('span');
                    d.className = 'badge badge--success';
                    d.textContent = 'p2p';
                    tags.appendChild(d);
                }

                row.appendChild(dot);
                row.appendChild(who);
                row.appendChild(tags);
                target.appendChild(row);
            });

            if (!users.length) {
                var empty = document.createElement('p');
                empty.className = 'hood-empty';
                empty.textContent = 'Nobody here yet.';
                target.appendChild(empty);
            }
        }

        /**
         * The topology, drawn from what the relay mode actually means.
         *
         * A star when the host relays (every message goes through one peer) and
         * a mesh when peers talk directly. Drawn rather than described because
         * the difference is the whole reason the modes exist.
         */
        renderTopology(users, host) {
            var svg = el('topology');
            svg.innerHTML = '';
            if (!users.length) return;

            var W = 340, H = 240, cx = W / 2, cy = H / 2, r = 88;
            svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

            var star = (this.relayMode || '').indexOf('host') !== -1;
            var others = users.filter(function (u) { return u !== host; });

            var points = {};
            if (host) points[host] = { x: cx, y: cy };
            others.forEach(function (name, i) {
                var angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
                points[name] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
            });

            function line(a, b, dashed) {
                var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                l.setAttribute('x1', a.x); l.setAttribute('y1', a.y);
                l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
                l.setAttribute('class', 'hood-edge' + (dashed ? ' hood-edge--weak' : ''));
                svg.appendChild(l);
            }

            if (star && host) {
                others.forEach(function (name) { line(points[host], points[name], false); });
            } else {
                // Mesh: everybody to everybody.
                users.forEach(function (a, i) {
                    users.slice(i + 1).forEach(function (b) { line(points[a], points[b], true); });
                });
            }

            var self = this;
            Object.keys(points).forEach(function (name) {
                var p = points[name];
                var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

                var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', p.x);
                circle.setAttribute('cy', p.y);
                circle.setAttribute('r', name === host ? 16 : 11);
                circle.setAttribute('class', 'hood-node'
                    + (name === host ? ' hood-node--host' : '')
                    + (name === self.username ? ' hood-node--me' : ''));

                var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', p.x);
                label.setAttribute('y', p.y + (name === host ? 32 : 26));
                label.setAttribute('class', 'hood-node__label');
                label.setAttribute('text-anchor', 'middle');
                label.textContent = name.length > 12 ? name.slice(0, 11) + '…' : name;

                g.appendChild(circle);
                g.appendChild(label);
                svg.appendChild(g);
            });

            el('topologyNote').textContent = star
                ? 'Star: every message goes through the host.'
                : 'Mesh: peers talk to each other directly.';
        }

        renderLog() {
            var target = el('log');
            target.innerHTML = '';
            this.log.forEach(function (entry) {
                var row = document.createElement('div');
                row.className = 'hood-log__row hood-log__row--' + entry.kind;

                var when = document.createElement('span');
                when.className = 'hood-log__time';
                var d = new Date(entry.at);
                when.textContent = String(d.getHours()).padStart(2, '0') + ':' +
                    String(d.getMinutes()).padStart(2, '0') + ':' +
                    String(d.getSeconds()).padStart(2, '0');

                var kind = document.createElement('span');
                kind.className = 'hood-log__kind';
                kind.textContent = entry.kind;

                var text = document.createElement('span');
                text.className = 'hood-log__text';
                text.textContent = entry.text;

                row.appendChild(when);
                row.appendChild(kind);
                row.appendChild(text);
                target.appendChild(row);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var app = new UnderTheHood();
        window.underTheHood = app;

        el('pingBtn').addEventListener('click', function () { app.ping(); });
        el('stepAsideBtn').addEventListener('click', function () { app.stepAside(); });

        window.loadConnectionModal({
            localStoragePrefix: 'hood_',
            channelPrefix: 'hood-',
            title: 'Look under the hood',
            collapsedTitle: 'Under the Hood',
            onConnect: async function (username, channel, password) {
                await app.initialize();
                await app.connect({
                    username: username, channelName: channel, channelPassword: password
                });
                app.start();
            }
        });
    });
})();
