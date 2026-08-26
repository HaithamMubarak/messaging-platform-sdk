/**
 * Drop — send a file to whoever is in the room, browser to browser.
 *
 * The primitive on show is **binary transfer over the data channel**. A file is
 * offered first and only sent once the other side accepts, then streamed in
 * chunks; the receiver reassembles and is handed a Blob to save. Nothing is
 * uploaded and nothing is stored — leave the room and the transfer history is
 * gone with it.
 *
 * Two things shape the implementation:
 *
 *  - **Offer before send.** A browser cannot be handed 30 MB it did not ask
 *    for, so the sender announces the file and waits. That also gives the
 *    receiver somewhere to refuse.
 *  - **Chunks are base64, not byte arrays.** The obvious `Array.from(bytes)`
 *    turns every byte into up to four JSON characters; base64 costs a third of
 *    that, and the transport is a JSON message channel either way.
 */
(function () {
    'use strict';

    // A receiver asks for missing pieces rather than restarting; these bound
    // how insistently, so a bad connection cannot turn into an endless resend.
    var MAX_CHUNK_RETRIES = 5;
    var MAX_NEED_PER_REQUEST = 64;

    var CHUNK = 16 * 1024;          // what a data channel carries comfortably
    var MAX_FILE = 64 * 1024 * 1024;
    var SEND_GAP_MS = 12;           // let the channel drain between chunks
    var RECEIVE_STALL_MS = 30000;   // give up on a receive after this long without a chunk

    class Drop extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'drop_',
                customType: 'drop',
                autoCreateDataChannel: true,
                dataChannelName: 'drop-data'
            });

            this.transfers = new Map();   // id -> row
            this.target = null;           // null = everyone
        }

        // ---- lifecycle -------------------------------------------------------

        onConnect() {
            UI.toast('Connected to ' + this.channelName, 'success');
            this._sync();
            this._resumeIncoming();
        }

        /**
         * Pick up any half-finished transfer after a reconnect.
         *
         * The gap-filling resend is driven by the stall watchdog, which is
         * armed while chunks are arriving. A connection that drops mid-transfer
         * leaves the watchdog holding a timer against a channel that no longer
         * exists — so on the way back in, anything still incomplete asks again
         * for what it is missing. That is what turns "survives a lost packet"
         * into "survives losing the connection".
         */
        _resumeIncoming() {
            var self = this;
            this.transfers.forEach(function (row) {
                if (!row || row.dir !== 'in' || row.state !== 'accepted') return;
                var missing = self._missingChunks(row);
                if (!missing.length) return;
                // A fresh budget: the previous failures were the disconnect,
                // not the sender refusing.
                row._retries = 0;
                UI.toast('Picking ' + row.name + ' back up — ' + missing.length
                    + ' piece(s) to go', 'info', 4000);
                self._say({
                    type: 'need', id: row.id, missing: missing.slice(0, MAX_NEED_PER_REQUEST)
                }, row.from);
                self._watch(row);
            });
        }
        onDisconnect() { this._status('off', 'Disconnected'); }
        onUserJoin() { this._sync(); }

        onUserLeave(detail) {
            // Any transfer still in flight with the leaver is dead; say so
            // instead of leaving a bar frozen mid-way for ever.
            var name = detail && detail.agentName;
            if (name) {
                var dropped = [];
                this.transfers.forEach(function (row) {
                    var inFlight = row.state === 'offered' || row.state === 'accepted' || row.state === 'sending';
                    if (!inFlight) return;
                    if ((row.dir === 'out' && row.to === name) || (row.dir === 'in' && row.from === name)) {
                        clearTimeout(row._stall);
                        row.state = 'cancelled';
                        row.parts = [];
                        dropped.push(row.name);
                    }
                });
                if (dropped.length) {
                    this.render();
                    UI.toast(name + ' left — transfer of ' + dropped.join(', ') + ' cancelled', 'warning', 5000);
                }
            }
            this._sync();
        }
        onDataChannelOpen() { this._sync(); }
        onDataChannelClose() { this._sync(); }

        _sync() {
            var n = Math.max(0, this.getUserCount() - 1);
            this._status(n ? 'live' : 'busy', n ? n + (n === 1 ? ' peer' : ' peers') : 'waiting for someone');
            this.renderPeers();
        }

        _status(kind, text) {
            var pill = document.getElementById('statusPill');
            if (!pill) return;
            pill.className = 'pill-status is-' + kind;
            pill.querySelector('.pill-status__text').textContent = text;
        }

        // ---- sending ---------------------------------------------------------

        async send(file) {
            if (!file) return;
            if (file.size > MAX_FILE) {
                UI.toast('That file is larger than ' + UI.fmtBytes(MAX_FILE), 'warning', 4000);
                return;
            }
            if (this.getUserCount() < 2) {
                UI.toast('Nobody else is here yet — share the room link first', 'warning', 4000);
                return;
            }

            var id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            var total = Math.max(1, Math.ceil(file.size / CHUNK));
            var row = {
                id: id, dir: 'out', name: file.name, size: file.size, mime: file.type || 'application/octet-stream',
                total: total, done: 0, state: 'offered', to: this.target, file: file, at: Date.now()
            };
            this.transfers.set(id, row);
            this.render();

            var sent = this._say({
                type: 'offer', id: id, name: row.name, size: row.size,
                mime: row.mime, chunks: total, by: this.username
            }, this.target);
            if (!sent) {
                // sendData returns 0 when there is no channel to carry it;
                // an offer nobody received must not sit there looking pending.
                row.state = 'failed';
                this.render();
                UI.toast('Could not reach ' + (this.target || 'the room') + ' — the offer was not sent', 'error', 5000);
            }
        }

        /**
         * Re-send a specific set of chunks to whoever asked for them.
         *
         * Bounded on purpose: a receiver that asks for everything, repeatedly,
         * should not be able to make the sender read the whole file over and
         * over. `to` comes from the transport, so the pieces go back to the
         * peer that actually asked.
         */
        async _resend(row, indices, to) {
            if (!to || row.state === 'cancelled') return;
            var wanted = indices
                .filter(function (i) { return typeof i === 'number' && i >= 0 && i < row.total; })
                .slice(0, MAX_NEED_PER_REQUEST);
            if (!wanted.length) return;

            for (var n = 0; n < wanted.length; n++) {
                if (row.state === 'cancelled') return;
                var i = wanted[n];
                var slice = row.file.slice(i * CHUNK, (i + 1) * CHUNK);
                var buf = await slice.arrayBuffer();
                if (!this._say({ type: 'chunk', id: row.id, i: i, b: toB64(buf) }, to)) return;
                if (SEND_GAP_MS) await wait(SEND_GAP_MS);
            }
        }

        async _stream(row) {
            row.state = 'sending';
            this.render();

            for (var i = 0; i < row.total; i++) {
                if (row.state === 'cancelled') return;
                var slice = row.file.slice(i * CHUNK, (i + 1) * CHUNK);
                var buf = await slice.arrayBuffer();
                var sent = this._say({ type: 'chunk', id: row.id, i: i, b: toB64(buf) }, row.to);
                if (!sent) {
                    // sendData said the chunk went nowhere. Marking this "sent"
                    // anyway is a lie the receiver pays for.
                    row.state = 'failed';
                    this.render();
                    UI.toast('Sending ' + row.name + ' failed — lost the connection to ' + (row.to || 'the room'), 'error', 5000);
                    return;
                }
                row.done = i + 1;
                if (i % 8 === 0 || i === row.total - 1) this.render();
                // Yielding keeps the tab responsive and the channel from
                // backing up on a large file.
                if (SEND_GAP_MS) await wait(SEND_GAP_MS);
            }

            row.state = 'sent';
            this.render();
        }

        /**
         * Returns how many peers the message actually went to — 0 means it
         * went nowhere (sendData warns but does not throw), and callers must
         * not report success on 0.
         */
        _say(payload, to) {
            return to ? this.sendData(payload, to) : this.sendData(payload);
        }

        // ---- receiving -------------------------------------------------------

        /**
         * Chunks arrive on the data channel, which is the point of this app —
         * `sendData` routes there, and the base class hands it back here.
         */
        onDataChannelMessage(peerId, data) {
            this._receive(data, peerId);
        }

        /** Whatever came through the host relay instead. */
        onGameMessage(detail) {
            this._receive(detail && detail.data ? detail.data : detail,
                detail && (detail.from || detail.agentName));
        }

        _receive(d, from) {
            if (!d || !d.type) return;
            // Deliberately NOT falling back to d.by: that is the sender's own
            // claim about who they are, and accepting it undoes the point of
            // taking `from` from the transport in the first place.
            if (!from) return;

            switch (d.type) {
                case 'offer': {
                    if (d.by === this.username) break;
                    if (this.transfers.has(d.id)) break;
                    this.transfers.set(d.id, {
                        id: d.id, dir: 'in', name: String(d.name || 'file').slice(0, 120),
                        size: d.size || 0, mime: d.mime || 'application/octet-stream',
                        total: d.chunks || 1, done: 0, state: 'offered',
                        from: d.by || from, parts: [], at: Date.now()
                    });
                    this.render();
                    UI.toast((d.by || 'Someone') + ' wants to send you ' + d.name, 'info', 4000);
                    break;
                }

                case 'accept': {
                    var out = this.transfers.get(d.id);
                    if (!out || out.dir !== 'out') break;
                    if (out.state !== 'offered') {
                        // The file already went (or is going) to the first
                        // acceptor. Tell this one, instead of leaving them
                        // sitting at 0% for ever.
                        this._say({ type: 'taken', id: d.id, by: this.username, winner: out.to }, d.by || from);
                        break;
                    }
                    // Whoever accepted is who it goes to, so a broadcast offer
                    // does not stream to the whole room at once.
                    //
                    // `from` is the transport's word; d.by is whatever the
                    // sender typed. Trusting d.by let a peer accept an offer
                    // and name somebody else as the recipient, redirecting the
                    // file — a data leak, not merely impersonation.
                    out.to = from || d.by || out.to;
                    this._stream(out);
                    break;
                }

                case 'taken': {
                    var late = this.transfers.get(d.id);
                    if (!late || late.dir !== 'in') break;
                    if (late.state !== 'accepted' && late.state !== 'offered') break;
                    clearTimeout(late._stall);
                    late.state = 'taken';
                    late.parts = [];
                    this.render();
                    UI.toast(late.name + ' went to ' + (d.winner || 'someone else') + ' — first to accept receives', 'info', 5000);
                    break;
                }

                case 'decline': {
                    var dec = this.transfers.get(d.id);
                    if (!dec || dec.dir !== 'out') break;
                    dec.state = 'declined';
                    this.render();
                    break;
                }

                case 'need': {
                    // The receiver is short of some pieces. Send those and only
                    // those — resending the whole file to fix one lost chunk is
                    // how a 4GB transfer used to start again from zero.
                    var out = this.transfers.get(d.id);
                    if (!out || out.dir !== 'out' || !Array.isArray(d.missing)) break;
                    if (!out.file) break;
                    this._resend(out, d.missing, from);
                    break;
                }

                case 'chunk': {
                    var row = this.transfers.get(d.id);
                    if (!row || row.dir !== 'in' || row.state !== 'accepted') break;
                    if (typeof d.i !== 'number' || d.i < 0 || d.i >= row.total) break;
                    if (row.parts[d.i]) break;                 // a repeat is not progress
                    row.parts[d.i] = fromB64(d.b);
                    row.done++;
                    if (row.done >= row.total) this._finish(row);
                    else { this._watch(row); if (row.done % 8 === 0) this.render(); }
                    break;
                }
            }
        }

        accept(id) {
            var row = this.transfers.get(id);
            if (!row || row.dir !== 'in') return;
            row.state = 'accepted';
            this.render();
            var sent = this._say({ type: 'accept', id: id, by: this.username }, row.from);
            if (!sent) {
                // The sender never heard the accept; do not sit at "receiving".
                row.state = 'offered';
                this.render();
                UI.toast('Could not reach ' + (row.from || 'the sender') + ' — try accepting again', 'error', 5000);
                return;
            }
            this._watch(row);
        }

        /**
         * A receive with no chunk for RECEIVE_STALL_MS is dead. Without this a
         * sender whose stream silently went nowhere left the receiver at
         * "receiving" for ever.
         */
        /**
         * Nothing has arrived for a while — ask for what is missing.
         *
         * This used to give up: state 'failed', parts thrown away, and the
         * whole file sent again from the beginning. But the receiver knows
         * exactly which indices it is short of, so it can ask for those and
         * keep everything it already has. Only after several unanswered
         * requests is the transfer really dead.
         *
         * This is also what makes a transfer survive a reconnect: the receiver
         * wakes up, notices the gap, and asks.
         */
        _watch(row) {
            var self = this;
            clearTimeout(row._stall);
            row._stall = setTimeout(function () {
                if (row.state !== 'accepted') return;

                var missing = self._missingChunks(row);
                row._retries = (row._retries || 0) + 1;

                if (missing.length && row._retries <= MAX_CHUNK_RETRIES) {
                    // Ask for the gaps, keep what we have, and keep waiting.
                    var asked = self._say({
                        type: 'need', id: row.id, missing: missing.slice(0, MAX_NEED_PER_REQUEST)
                    }, row.from);
                    if (asked) {
                        UI.toast('Asking ' + (row.from || 'the sender') + ' for '
                            + missing.length + ' missing piece(s) of ' + row.name, 'info', 3500);
                        self._watch(row);
                        return;
                    }
                }

                row.state = 'failed';
                row.parts = [];
                self.render();
                UI.toast('Receiving ' + row.name + ' stalled — nothing arrived for '
                    + Math.round(RECEIVE_STALL_MS / 1000) + 's. Ask '
                    + (row.from || 'the sender') + ' to send it again.', 'error', 6000);
            }, RECEIVE_STALL_MS);
        }

        /** Which chunk indices this receiver has not got yet. */
        _missingChunks(row) {
            var missing = [];
            for (var i = 0; i < row.total; i++) {
                if (!row.parts[i]) missing.push(i);
            }
            return missing;
        }

        decline(id) {
            var row = this.transfers.get(id);
            if (!row) return;
            row.state = 'declined';
            this.render();
            this._say({ type: 'decline', id: id, by: this.username }, row.from);
        }

        _finish(row) {
            clearTimeout(row._stall);
            var blob = new Blob(row.parts, { type: row.mime });
            // Only trust the size we were promised if the bytes agree with it.
            row.state = (row.size && blob.size !== row.size) ? 'damaged' : 'ready';
            row.blob = blob;
            row.parts = [];
            this.render();
            if (row.state === 'ready') UI.toast(row.name + ' arrived', 'success');
            else UI.toast(row.name + ' arrived incomplete', 'error', 5000);
        }

        save(id) {
            var row = this.transfers.get(id);
            if (!row || !row.blob) return;
            var url = URL.createObjectURL(row.blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = row.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        }

        // ---- rendering -------------------------------------------------------

        render() {
            var host = document.getElementById('transfers');
            if (!host) return;

            var rows = Array.from(this.transfers.values()).sort(function (a, b) { return b.at - a.at; });
            this._renderSummary(rows);
            if (!rows.length) {
                host.replaceChildren(UI.el('div', { class: 'sdk-empty' }, [
                    UI.iconNode('inbox'),
                    UI.el('p', {}, 'No transfers yet.')
                ]));
                return;
            }

            var self = this;
            host.replaceChildren.apply(host, rows.map(function (row) { return self._row(row); }));
        }

        /**
         * What this session has actually moved. Only bytes that arrived are
         * counted — a transfer still in flight, declined or damaged has not
         * moved anything, and a summary that pretends otherwise is worse than
         * none.
         */
        _renderSummary(rows) {
            var out = document.getElementById('transferSummary');
            if (!out) return;
            var done = rows.filter(function (r) {
                return r.state === 'sent' || r.state === 'ready';
            });
            var bytes = done.reduce(function (n, r) { return n + (r.size || 0); }, 0);
            out.textContent = done.length
                ? done.length + ' this session · ' + UI.fmtBytes(bytes)
                : rows.length ? rows.length + ' in progress' : '';
        }

        _row(row) {
            var pct = row.total ? Math.round((row.done / row.total) * 100) : 0;
            var who = row.dir === 'out'
                ? 'to ' + (row.to || 'first to accept')
                : 'from ' + (row.from || 'someone');

            var kids = [
                UI.el('div', { class: 'tr__head' }, [
                    UI.el('span', { class: 'tr__icon tr__icon--' + row.state },
                        UI.iconNode(row.dir === 'out' ? 'send' : 'download', 'icon--sm')),
                    UI.el('div', { class: 'tr__id' }, [
                        UI.el('span', { class: 'tr__name' }, row.name),
                        UI.el('span', { class: 'tr__meta' }, who + ' · ' + UI.fmtBytes(row.size))
                    ]),
                    UI.el('span', { class: 'tr__state' }, STATE_TEXT[row.state] || row.state)
                ])
            ];

            if (row.state === 'sending' || row.state === 'accepted') {
                kids.push(UI.el('div', { class: 'tr__track' }, [
                    UI.el('div', { class: 'tr__fill', style: 'width:' + pct + '%' })
                ]));
                kids.push(UI.el('span', { class: 'tr__chunks' },
                    'chunk ' + row.done + ' / ' + row.total));
            }

            var actions = [];
            if (row.dir === 'in' && row.state === 'offered') {
                actions.push(UI.el('button', { type: 'button', class: 'btn btn--ghost', 'data-decline': row.id }, 'Decline'));
                actions.push(UI.el('button', { type: 'button', class: 'btn btn--primary', 'data-accept': row.id }, 'Accept'));
            }
            if (row.state === 'ready') {
                actions.push(UI.el('button', { type: 'button', class: 'btn btn--primary', 'data-save': row.id }, 'Save'));
            }
            if (actions.length) kids.push(UI.el('div', { class: 'tr__actions' }, actions));

            return UI.el('article', { class: 'tr tr--' + row.state }, kids);
        }

        renderPeers() {
            var host = document.getElementById('peers');
            if (!host) return;
            var self = this;
            var names = (this.getConnectedUsers() || []).filter(function (n) { return n !== self.username; });

            var everyone = UI.el('button', {
                type: 'button',
                class: 'peer' + (this.target === null ? ' is-on' : ''),
                'data-peer': ''
            }, [
                UI.el('span', { class: 'avatar', style: 'background:var(--surface-3);color:var(--text-body)' },
                    UI.iconNode('users', 'icon--sm')),
                UI.el('span', { class: 'peer__id' }, [
                    UI.el('span', { class: 'peer__name' }, 'Everyone'),
                    // Honest about the semantics: the offer goes to the room,
                    // the file streams to whoever accepts first.
                    UI.el('span', { class: 'peer__link' }, 'first to accept receives')
                ])
            ]);

            var rows = names.map(function (name) {
                var direct = self.isDataChannelOpen ? self.isDataChannelOpen(name) : false;
                return UI.el('button', {
                    type: 'button',
                    class: 'peer' + (self.target === name ? ' is-on' : ''),
                    'data-peer': name
                }, [
                    UI.el('span', { class: 'avatar', style: 'background:' + self.generateUserColor(name) },
                        initials(name)),
                    UI.el('span', { class: 'peer__id' }, [
                        UI.el('span', { class: 'peer__name' }, name),
                        UI.el('span', { class: 'peer__link' + (direct ? ' is-direct' : '') },
                            direct ? 'direct' : 'relayed')
                    ])
                ]);
            });

            host.replaceChildren.apply(host, [everyone].concat(rows));
        }
    }

    var STATE_TEXT = {
        offered: 'waiting', accepted: 'receiving', sending: 'sending',
        sent: 'sent', ready: 'ready', declined: 'declined', damaged: 'incomplete', cancelled: 'cancelled',
        failed: 'failed', taken: 'went to another peer'
    };

    // ---- helpers ------------------------------------------------------------

    function toB64(buf) {
        var bytes = new Uint8Array(buf), out = '';
        for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
        return btoa(out);
    }

    function fromB64(b64) {
        var bin = atob(b64 || ''), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map(function (p) { return p[0]; }).join('').toUpperCase() || '?';
    }

    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // ---- boot ---------------------------------------------------------------

    var app = null;


    /**
     * Hand the room to somebody: a link, and a code they can point a phone at.
     *
     * Both pages already loaded share-modal.js and then never called it — one
     * had a Share button permanently display:none, the other told you to
     * "share the room link" from a header with no way to do it.
     */
    function invite() {
        if (!app || !app.connected) { UI.toast('Join a room first', 'info'); return; }
        if (typeof ShareModal === 'undefined' || !ShareModal.show) {
            UI.toast('Sharing is not available on this page', 'error');
            return;
        }
        ShareModal.show(app.channelName, app.channelPassword);
    }

    function wire() {
        var share = document.getElementById('shareBtn');
        if (share) share.addEventListener('click', invite);

        var zone = document.getElementById('dropZone');
        var input = document.getElementById('fileInput');

        ['dragenter', 'dragover'].forEach(function (ev) {
            zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
            zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
        });
        zone.addEventListener('drop', function (e) {
            var files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length && app) app.send(files[0]);
        });
        zone.addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () {
            if (input.files && input.files.length && app) app.send(input.files[0]);
            input.value = '';
        });

        document.getElementById('transfers').addEventListener('click', function (e) {
            var a = e.target.closest('[data-accept]');
            if (a && app) { app.accept(a.getAttribute('data-accept')); return; }
            var d = e.target.closest('[data-decline]');
            if (d && app) { app.decline(d.getAttribute('data-decline')); return; }
            var s = e.target.closest('[data-save]');
            if (s && app) app.save(s.getAttribute('data-save'));
        });

        document.getElementById('peers').addEventListener('click', function (e) {
            var p = e.target.closest('[data-peer]');
            if (!p || !app) return;
            var name = p.getAttribute('data-peer');
            app.target = name || null;
            app.renderPeers();
        });
    }

    async function connect(username, channel, password) {
        try {
            app = new Drop();
            window.dropApp = app;
            await app.connect({ username: username, channelName: channel, channelPassword: password });
            app.start();
            document.getElementById('roomName').textContent = channel;
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            if (typeof window.encodeChannelAuth === 'function') {
                var encoded = window.encodeChannelAuth(channel, password, null);
                if (encoded) history.replaceState(null, '', '#' + encoded);
            }
            app.render();
            app.renderPeers();
        } catch (err) {
            console.error('[Drop] connect failed:', err);
            if (window.ConnectionModal) ConnectionModal.fail(err);
            UI.toast('Could not connect: ' + err.message, 'error', 5000);
            app = null;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        wire();
        window.loadConnectionModal({
            localStoragePrefix: 'drop_',
            channelPrefix: 'drop-',
            title: 'Join a Drop room',
            collapsedTitle: 'Drop',
            onConnect: connect
        });
        if (window.MiniGameUtils && MiniGameUtils.processSharedLinkAndAutoConnect) {
            MiniGameUtils.processSharedLinkAndAutoConnect({
                gameName: 'Drop', storagePrefix: 'drop_',
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
