/**
 * Under the Hood — the machinery, on screen.
 *
 * Every app on this site uses host election, presence and a relay topology, and
 * none of them shows you any of it: you find out there was a host only when it
 * leaves and something stops working. This page is the control room that shows
 * the plumbing, which makes it the useful page to have open while debugging any
 * of the others.
 *
 * What it draws is all read from UserConnectionBase — no new protocol, no
 * privileged access. That is deliberate: if this page can see it, so can your
 * app, and the code here is short enough to copy.
 *
 *   - the roster, in join order, because that is what host election sorts on:
 *     the host is the first one in, and everyone independently agrees;
 *   - the relay topology (star through the host, or mesh), with every ping
 *     drawn travelling the route it really took: a channel message through the
 *     SERVER, a data-channel message direct or through the host, read from who
 *     handed it over, not assumed; and each person's round trip on each path;
 *   - "Pass the crown", which makes the host leave on purpose so you can watch
 *     an election happen, and "Rejoin", which puts you back at the end of the
 *     line — so the crown does not come back to you;
 *   - "Open another tab", so one person can be a whole room.
 */
(function () {
    'use strict';

    var MAX_LOG = 60;
    var SVG = 'http://www.w3.org/2000/svg';
    var W = 560, H = 420, CX = W / 2, CY = H / 2 - 12, RING = 165;
    var HOP_MS = 420;
    var SERVER = 'the server';
    var SERVER_AT = { x: W - 52, y: 40 };    // top right, clear of the ring of people
    var COLORS = ['#fbbf24', '#2dd4bf', '#fb923c', '#a78bfa', '#38bdf8', '#f472b6'];

    function el(id) { return document.getElementById(id); }

    function svg(tag, attrs, text) {
        var node = document.createElementNS(SVG, tag);
        Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** The same name is always the same colour, on every screen. */
    function colorOf(name) {
        var h = 0;
        for (var i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) >>> 0;
        return COLORS[h % COLORS.length];
    }

    function clock(at) {
        var d = new Date(at);
        return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
    }

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
            this.rtt = {};          // name -> { p2p: ms }, from the last pongs
            this.pingsSent = new Map();   // our last few peer-to-peer pings: time sent -> who has answered
            this.serverRtt = undefined;   // our last ping through the server, there and back
            this.points = {};       // where each name is drawn, for the packets
            this.lastHost = null;
            this.creds = null;      // { username, channelName (the base), channelPassword, appId }
        }

        onConnect(detail) {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            this.outside = false;
            this.note('connected', 'You joined as ' + this.username
                + (detail && detail.isHost ? ', first in, so you hold the crown' : ''));
            this.lastHost = this._getHostName();
            // onConnect runs from the channel's connect event BEFORE the base
            // class sets `connected`, so drawing now would show this tab outside
            // the room, buttons disabled, until the next poll. Draw on the next tick.
            setTimeout(() => this.refresh(), 0);
            // Presence changes are events, but connection state is a value:
            // poll it so the panel is right even when nothing has happened.
            clearInterval(this._timer);
            this._timer = setInterval(() => this.refresh(), 2000);
        }

        onDisconnect() {
            clearInterval(this._timer);
            this.note('disconnected', 'You left the room');
            this.refresh();
        }

        /*
         * Leaving on purpose (Pass the crown, Watch) must leave the page in
         * view: common-utils re-opens the join form on every disconnect, which
         * is right for a dropped connection and would hide the election this
         * page exists to show, and the Rejoin button with it. The disconnect
         * event comes whenever the socket closes, so the form is kept shut for
         * as long as this tab is outside on purpose; Rejoin is the way back.
         */
        leaveOnPurpose() {
            var self = this;
            this.outside = true;
            var modal = document.getElementById('connectionModal');
            var keepShut = function () {
                if (self.outside && !self.connected && modal && modal.classList.contains('active')
                    && window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            };
            if (modal && !this._shutWatch) {
                this._shutWatch = new MutationObserver(keepShut);
                this._shutWatch.observe(modal, { attributes: true, attributeFilter: ['class'] });
            }
            this.disconnect();
            keepShut();
        }

        onUserJoin(detail) {
            this.note('join', (detail && detail.agentName) + ' joined, at the back of the line');
            this.refresh();
        }

        onUserLeave(detail) {
            this.note('leave', (detail && detail.agentName) + ' left');
            this.refresh();
        }

        onBecomeHost() {
            this.note('host', 'You have the crown now');
            this.refresh();
        }

        onLoseHost() {
            this.note('host', 'You no longer hold the crown');
            this.refresh();
        }

        /**
         * A channel message: it went from the sender to the SERVER and from
         * there to here. The drawing used to send it through the host, which is
         * the data channel's route in a star, not the channel's.
         */
        onGameMessage(detail) {
            var from = this.senderOf(detail) || 'unknown';
            var data = (detail && detail.data) ? detail.data : detail;
            var type = data && data.type ? data.type : 'message';
            // The server echoes our own message back to us. That is not news
            // for the log, but it is the honest measure of the server path:
            // our ping's round trip to the server and back, with no one else
            // having to answer. (A guest answering over the channel tripped
            // a server fault, filed 2026-10-15: a newly joined agent's push is
            // held until it receives, and the held reply stopped the host
            // rejoining under its own name.)
            if (from === this.username) {
                if (type === 'ping' && data.at) { this.serverRtt = Math.max(0, Date.now() - data.at); this.refresh(); }
                return;
            }
            this.note('message', from + ' sent ' + (type === 'ping' ? 'a ping, through the server' : type));
            this.flyRoute([[from, SERVER, this.username]]);
            this.refresh();
        }

        /**
         * A data-channel message. Who handed it over says how it came: from the
         * sender itself is direct; from the host, stamped with the sender, is
         * relayed. Drawn and logged as it really happened.
         */
        onDataChannelMessage(peerId, data) {
            if (!data || !data.type) return;
            var from = this.senderOf(peerId, data);
            if (data.type === 'pong') { this._pong(from, data, 'p2p'); return; }
            if (data.type !== 'ping') return;
            var relayed = from !== peerId;
            this.note('message', from + ' sent a ping, peer to peer, ' + (relayed ? 'relayed by ' + peerId : 'straight to you'));
            this.flyRoute([relayed ? [from, peerId, this.username] : [from, this.username]]);
            if (data.at) this.sendData({ type: 'pong', at: data.at }, from);
            this.refresh();
        }

        /** A reply to one of our pings: that person's round trip on that path. */
        /**
         * Only a reply to a ping this tab sent, once per person per ping. Any
         * pong used to be believed, so a peer could answer nothing with an old
         * timestamp and make its own link look as fast or as slow as it liked.
         */
        _pong(from, data, path) {
            var answered = data && this.pingsSent.get(data.at);
            if (!answered || !from || answered.has(from)) return;
            answered.add(from);
            var ms = Math.max(0, Date.now() - data.at);
            this.rtt[from] = Object.assign(this.rtt[from] || {}, { [path]: ms });
            this.refresh();
        }

        onDataChannelOpen(peerId, ms) {
            this.note('datachannel', 'Direct link to ' + peerId + ' opened' + (ms ? ' (' + ms + ' ms)' : ''));
            this.refresh();
        }

        // ---- actions ---------------------------------------------------------

        /** A ping to everyone, through the server (the channel) or peer to peer (the data channel). */
        ping(path) {
            if (!this.connected) return;
            var others = (this.getConnectedUsers() || []).filter(function (u) { return u !== this.username; }, this);
            if (path === 'p2p') {
                var at = Date.now();
                this.pingsSent.set(at, new Set());
                if (this.pingsSent.size > 5) this.pingsSent.delete(this.pingsSent.keys().next().value);
                this.sendData({ type: 'ping', at: at });
                this.note('sent', 'You sent a ping peer to peer');
                this.flyRoute(this.routeFrom(this.username));
            } else {
                this.sendCustomEventMessage({ type: 'ping', at: Date.now() }, '*');
                this.note('sent', 'You sent a ping through the server');
                var me = this.username;
                this.flyRoute(others.map(function (u) { return [me, SERVER, u]; }));
            }
            this.refresh();
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
                this.note('host', 'Only the crown holder can pass it on');
                this.refresh();
                return;
            }
            this.note('host', 'You passed the crown. Watch another tab take over');
            this.leaveOnPurpose();
            this.refresh();
        }

        /** Back in, at the end of the line: the crown stays where it went. */
        async rejoin(appId) {
            if (!this.creds || this.connected || this.connecting) return;
            if (appId !== undefined) this.creds.appId = appId;
            var c = this.creds;
            await this.connect({ username: c.username, channelName: roomOf(c.channelName, c.appId),
                channelPassword: c.channelPassword });
            this.start();
        }

        /** Watch another app's room: leave this one and join channel + "." + app. */
        async watch(appId) {
            if (appId && !/^[a-z0-9-]+$/.test(appId)) {
                this.note('host', 'An app name is lower-case letters, digits and hyphens');
                this.refresh();
                return;
            }
            if (this.connected) this.leaveOnPurpose();
            await this.rejoin(appId || '');
        }

        /**
         * A second person in one click: this room's code, opened in a new tab
         * with a fresh name. `noopener` gives that tab its own session storage,
         * so it joins as somebody new rather than resuming this tab's session.
         */
        openAnotherTab() {
            var c = this.creds;
            var code = c && window.PartyCode && window.PartyCode.codeFor('hood', c.channelName, c.channelPassword);
            if (!code) {
                el('sideHint').textContent = 'This room was joined by name, so it has no code. '
                    + 'Open this page in another tab and join it under Advanced.';
                return;
            }
            window.open(location.pathname + '?code=' + code + '&newname=1', '_blank', 'noopener');
        }

        note(kind, text) {
            this.log.unshift({ kind: kind, text: text, at: Date.now() });
            if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
        }

        // ---- packets ---------------------------------------------------------

        /** The route a message from `from` really takes: through the host in a star, direct in a mesh. */
        routeFrom(from) {
            var host = this._getHostName();
            var users = this.connected ? (this.getConnectedUsers() || []) : [];
            var star = (this.relayMode || '').indexOf('host') !== -1 && host;
            if (from === this.username) {
                var others = users.filter(function (u) { return u !== from; });
                if (!star || from === host) return others.map(function (u) { return [from, u]; });
                return [[from, host]].concat(others.filter(function (u) { return u !== host; })
                    .map(function (u) { return [from, host, u]; }));
            }
            return [star && from !== host && this.username !== host ? [from, host, this.username] : [from, this.username]];
        }

        flyRoute(paths) {
            var self = this;
            paths.forEach(function (names) {
                var pts = names.map(function (n) { return self.points[n]; });
                if (pts.every(Boolean) && pts.length > 1) flyPacket(pts);
            });
        }

        // ---- rendering -------------------------------------------------------

        refresh() {
            var users = this.connected ? (this.getConnectedUsers() || []) : [];
            var host = this.connected ? this._getHostName() : null;
            if (this.connected && host && this.lastHost && host !== this.lastHost && host !== this.username) {
                this.note('host', host + ' has the crown now: next in line after ' + this.lastHost);
            }
            if (host) this.lastHost = host;

            el('roomName').textContent = this.connected ? this.channelName : 'not connected';
            el('mode').textContent = this.relayMode || '—';
            el('meCount').textContent = String(users.length);
            el('meHost').textContent = !this.connected ? 'outside' : this.isHost() ? 'the host' : 'a guest';
            el('meHost').className = 'hood-fact__value' + (this.isHost() ? ' is-yes' : '');
            el('crown').textContent = host || '—';
            el('serverRtt').textContent = this.serverRtt !== undefined ? this.serverRtt + ' ms' : '—';
            this.renderControls();
            this.renderRoster(users, host);
            this.renderTopology(users, host);
            this.renderLog();
        }

        renderControls() {
            var inRoom = this.connected;
            el('pingBtn').disabled = !inRoom;
            el('pingDirectBtn').disabled = !inRoom;
            el('stepAsideBtn').disabled = !inRoom || !this.isHost();
            el('stepAsideBtn').title = this.isHost() ? '' : 'Only the crown holder can pass it on';
            el('rejoinBtn').hidden = inRoom || !this.creds;
            el('anotherTabBtn').disabled = !inRoom;
        }

        renderRoster(users, host) {
            var target = el('roster');
            target.innerHTML = '';
            var self = this;
            users.forEach(function (name, i) {
                var row = document.createElement('div');
                row.className = 'hood-peer' + (name === host ? ' hood-peer--host' : '')
                    + (name === self.username ? ' hood-peer--me' : '');
                var place = Object.assign(document.createElement('span'), { className: 'hood-peer__place', textContent: String(i + 1) });
                place.title = 'Place in line';
                var who = Object.assign(document.createElement('span'), { className: 'hood-peer__name', textContent: name });
                row.append(place, who);
                if (name === host) row.appendChild(tag('host', 'badge badge--brand'));
                if (name === self.username) row.appendChild(tag('you', 'badge'));
                if (name !== self.username && typeof self.isDataChannelOpen === 'function' && self.isDataChannelOpen(name)) {
                    row.appendChild(tag('p2p', 'badge badge--success'));
                }
                var rtt = self.rtt[name];
                if (rtt && rtt.p2p !== undefined && name !== self.username) {
                    var r = tag(rtt.p2p + ' ms', 'hood-rtt');
                    r.title = 'Round trip of your last peer-to-peer ping to ' + name;
                    row.appendChild(r);
                }
                target.appendChild(row);
            });
            if (!users.length) {
                target.appendChild(Object.assign(document.createElement('p'), { className: 'hood-empty',
                    textContent: this.creds ? 'You are outside the room.' : 'Nobody here yet.' }));
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
            var root = el('topology');
            root.innerHTML = '';
            this.points = layout(users, host);
            var star = (this.relayMode || '').indexOf('host') !== -1 && host;
            var p = this.points;
            if (star) {
                users.forEach(function (u) { if (u !== host) root.appendChild(edge(p[host], p[u], false)); });
            } else {
                users.forEach(function (a, i) { users.slice(i + 1).forEach(function (b) { root.appendChild(edge(p[a], p[b], true)); }); });
            }
            var self = this;
            if (users.length) { this.points[SERVER] = SERVER_AT; root.appendChild(serverNode(SERVER_AT)); }
            users.forEach(function (name) { root.appendChild(node(name, p[name], name === host, name === self.username)); });
            // What the lines mean, and what they do not: channel messages never
            // use them, they go through the server.
            el('topologyNote').textContent = !users.length ? ''
                : (star ? 'Star: peer-to-peer messages go through ' + host + ', the crown holder.'
                    : 'Mesh: peer-to-peer messages go straight between peers.')
                  + ' Channel messages go through the server.';
        }

        renderLog() {
            var target = el('log');
            target.innerHTML = '';
            this.log.forEach(function (entry) {
                var row = document.createElement('li');
                row.className = 'hood-log__row hood-log__row--' + entry.kind;
                row.appendChild(Object.assign(document.createElement('span'), { className: 'hood-log__text', textContent: entry.text }));
                row.appendChild(Object.assign(document.createElement('time'), { className: 'hood-log__time', textContent: clock(entry.at) }));
                target.appendChild(row);
            });
        }
    }

    const roomOf = (channel, appId) => appId ? channel + '.' + appId : channel;

    function tag(text, cls) {
        return Object.assign(document.createElement('span'), { className: cls, textContent: text });
    }

    /** Host in the middle, everyone else on a ring in join order; a lone guest to one side, clear of the crown. */
    function layout(users, host) {
        var points = {};
        var others = users.filter(function (u) { return u !== host; });
        var start = others.length === 1 ? 0 : -Math.PI / 2;
        if (host) points[host] = { x: CX, y: CY };
        others.forEach(function (name, i) {
            var angle = start + (i / Math.max(1, others.length)) * Math.PI * 2;
            points[name] = { x: CX + Math.cos(angle) * RING, y: CY + Math.sin(angle) * RING * 0.95 };
        });
        return points;
    }

    function edge(a, b, mesh) {
        return svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hood-edge' + (mesh ? ' hood-edge--mesh' : '') });
    }

    function node(name, p, isHost, isMe) {
        var r = isHost ? 40 : 28;
        var g = svg('g', { class: 'hood-peer-node' });
        if (isMe) g.appendChild(svg('circle', { cx: p.x, cy: p.y, r: r + 7, class: 'hood-node__me' }));
        g.appendChild(svg('circle', { cx: p.x, cy: p.y, r: r, fill: colorOf(name),
            class: 'hood-node' + (isHost ? ' hood-node--host' : '') + (isMe ? ' hood-node--me' : '') }));
        g.appendChild(svg('text', { x: p.x, y: p.y + (isHost ? 10 : 7), class: 'hood-node__initial', 'text-anchor': 'middle' },
            name.charAt(0).toUpperCase()));
        if (isHost) g.appendChild(svg('path', { class: 'hood-crown',
            d: 'M' + (p.x - 18) + ' ' + (p.y - 50) + 'l6 -16 l12 10 l12 -10 l6 16 z' }));
        g.appendChild(svg('text', { x: p.x, y: p.y + r + 20, class: 'hood-node__label', 'text-anchor': 'middle' },
            (name.length > 16 ? name.slice(0, 15) + '…' : name) + (isMe ? ' (you)' : '')));
        return g;
    }

    /** The messaging server, where every channel message goes on its way. */
    function serverNode(p) {
        var g = svg('g', { class: 'hood-server' });
        g.appendChild(svg('rect', { x: p.x - 38, y: p.y - 18, width: 76, height: 36, rx: 10, class: 'hood-server__box' }));
        g.appendChild(svg('text', { x: p.x, y: p.y + 5, class: 'hood-server__label', 'text-anchor': 'middle' }, 'server'));
        return g;
    }

    /** One packet along a list of points, a hop at a time. Skipped when motion is reduced. */
    function flyPacket(pts) {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var layer = el('packets');
        var dot = svg('circle', { r: 8, class: 'hood-packet' });
        layer.appendChild(dot);
        var total = (pts.length - 1) * HOP_MS, t0 = performance.now();
        (function step(now) {
            // A frame's timestamp is when the frame began, which can be before t0.
            var t = Math.min(1, Math.max(0, (now - t0) / total)) * (pts.length - 1);
            var i = Math.min(pts.length - 2, Math.floor(t)), f = t - i;
            dot.setAttribute('cx', pts[i].x + (pts[i + 1].x - pts[i].x) * f);
            dot.setAttribute('cy', pts[i].y + (pts[i + 1].y - pts[i].y) * f);
            if (now - t0 < total) requestAnimationFrame(step); else dot.remove();
        })(t0);
    }

    document.addEventListener('DOMContentLoaded', function () {
        var app = new UnderTheHood();
        window.underTheHood = app;

        el('pingBtn').addEventListener('click', function () { app.ping('server'); });
        el('pingDirectBtn').addEventListener('click', function () { app.ping('p2p'); });
        el('stepAsideBtn').addEventListener('click', function () { app.stepAside(); });
        el('rejoinBtn').addEventListener('click', function () { app.rejoin(); });
        el('anotherTabBtn').addEventListener('click', function () { app.openAnotherTab(); });
        el('inspectBtn').addEventListener('click', function () { app.watch(el('inspectApp').value.trim()); });
        app.refresh();

        window.loadConnectionModal({
            localStoragePrefix: 'hood_',
            channelPrefix: 'hood-',
            title: 'Look under the hood',
            collapsedTitle: 'Under the Hood',
            partyLobby: {
                id: 'under-the-hood', start: 'Open the control room', players: 'Best with 2–4 tabs or devices',
                waitingRoom: { solo: { label: 'Open another tab', run: () => window.underTheHood.openAnotherTab() } },
                tagline: 'See every connection live, then pass the crown and watch the room elect another host.',
                howTo: [
                    'Open the room, then press "Open another tab" to be two people at once.',
                    'Ping through the server, then peer to peer, and see the two routes.',
                    'Pass the crown and see who takes over.',
                ],
            },
            onConnect: async function (username, channel, password) {
                // This page is `promiscuous`, which means rawRoom: it joins the
                // name it is given, verbatim, and derives no suffix of its own.
                // So to watch an app's room it has to be told which one --
                // every other app is in `channel + "." + appId` now.
                var appId = (el('inspectApp') && el('inspectApp').value || '').trim();
                if (appId && !/^[a-z0-9-]+$/.test(appId)) {
                    throw new Error('An app name is lower-case letters, digits and hyphens.');
                }
                app.creds = { username: username, channelName: channel, channelPassword: password, appId: appId };
                await app.initialize();
                await app.connect({
                    username: username, channelName: roomOf(channel, appId), channelPassword: password
                });
                app.start();
            }
        });
    });
})();
