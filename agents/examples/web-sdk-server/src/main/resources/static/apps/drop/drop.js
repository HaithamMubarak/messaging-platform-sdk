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
    var MAX_WAITING_OFFERS = 8;     // offers one person can have waiting on your screen
    var MAX_CHUNK_B64 = Math.ceil(CHUNK / 3) * 4;
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
                this._pace(row);
                if (i % 8 === 0 || i === row.total - 1) this.render();
                // Yielding keeps the tab responsive and the channel from
                // backing up on a large file.
                if (SEND_GAP_MS) await wait(SEND_GAP_MS);
            }

            row.state = 'sent';
            row.fresh = true;
            this.render();
        }

        /**
         * How fast this transfer is moving, either end: bytes per second over
         * the transfer so far, which is what the time left is worked out from.
         */
        _pace(row) {
            var now = Date.now();
            if (!row.t0) { row.t0 = now; row.d0 = row.done - 1; return; }
            var secs = (now - row.t0) / 1000;
            if (secs > 0.2) row.rate = ((row.done - row.d0) * CHUNK) / secs;
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
         * senderOf() reads the p2p-host relay's stamp, so a guest's message
         * relayed by the host is still credited to the guest.
         */
        onDataChannelMessage(peerId, data) {
            this._receive(data, this.senderOf(peerId, data));
        }

        /** Whatever came through the host relay instead. */
        onGameMessage(detail) {
            this._receive(detail && detail.data ? detail.data : detail,
                detail && (detail.from || detail.agentName));
        }

        /**
         * Every message is about one transfer, and only the person on the other
         * end of that transfer may move it along. `from` is the transport's
         * word; `d.by` is whatever the sender typed, and is never believed.
         *
         * It used to be. An offer was filed under `d.by`, and a chunk was taken
         * from anyone who knew the id, so a third person could offer
         * "invoice.pdf" signed "Ann" and stream their own bytes into it. And
         * `need` re-sent pieces to whoever asked, so anyone who had seen a
         * room-wide offer could ask for a file that went to somebody else.
         */
        _receive(d, from) {
            if (!d || !d.type || !from || from === this.username) return;
            var handler = RECEIVE[d.type];
            if (handler) handler.call(this, d, from);
        }

        /**
         * An offer is the sender's description of a file, so it is held to the
         * rules our own offers keep: a size within MAX_FILE, exactly the pieces
         * that size needs, and a few waiting per sender. Taken as sent, "1 byte
         * in a billion pieces" made the stall check walk a billion slots, a
         * 10 GB offer sat past the limit, and one person could stack offers
         * without end.
         */
        _offerOk(d, from) {
            if (typeof d.id !== 'string' || !d.id || d.id.length > 64 || this.transfers.has(d.id)) return false;
            if (!Number.isInteger(d.size) || d.size < 0 || d.size > MAX_FILE) return false;
            if (d.chunks !== Math.max(1, Math.ceil(d.size / CHUNK))) return false;
            var waiting = 0;
            this.transfers.forEach(function (r) { if (r.dir === 'in' && r.from === from && r.state === 'offered') waiting++; });
            return waiting < MAX_WAITING_OFFERS;
        }

        _onOffer(d, from) {
            if (!this._offerOk(d, from)) return;
            this.transfers.set(d.id, {
                id: d.id, dir: 'in', name: String(d.name || 'file').slice(0, 120),
                size: d.size, mime: String(d.mime || 'application/octet-stream').slice(0, 100),
                total: d.chunks, done: 0, state: 'offered',
                from: from, parts: [], at: Date.now()
            });
            this.render();
            UI.toast(from + ' wants to send you ' + this.transfers.get(d.id).name, 'info', 4000);
        }

        _onAccept(d, from) {
            var out = this.transfers.get(d.id);
            if (!out || out.dir !== 'out') return;
            // An offer made to one person is theirs to accept, nobody else's.
            if (out.to && out.to !== from && out.state === 'offered') return;
            if (out.state !== 'offered') {
                // The file already went (or is going) to the first acceptor.
                // Tell this one, instead of leaving them at 0% for ever.
                if (out.to !== from) this._say({ type: 'taken', id: d.id, by: this.username, winner: out.to }, from);
                return;
            }
            // Whoever accepted is who it goes to, so a broadcast offer does not
            // stream to the whole room at once.
            out.to = from;
            this._stream(out);
        }

        _onTaken(d, from) {
            var late = this.transfers.get(d.id);
            if (!late || late.dir !== 'in' || late.from !== from) return;
            if (late.state !== 'accepted' && late.state !== 'offered') return;
            clearTimeout(late._stall);
            late.state = 'taken';
            late.parts = [];
            this.render();
            UI.toast(late.name + ' went to ' + (d.winner || 'someone else') + ' — first to accept receives', 'info', 5000);
        }

        /**
         * A decline ends an offer made to that one person. An offer to the
         * room used to end at the FIRST decline, so anyone who said no stopped
         * everyone else from saying yes; it now ends only when all have.
         */
        _onDecline(d, from) {
            var dec = this.transfers.get(d.id);
            if (!dec || dec.dir !== 'out' || dec.state !== 'offered') return;
            if (dec.to) {
                if (dec.to === from) dec.state = 'declined';
            } else {
                dec.declinedBy = dec.declinedBy || [];
                if (dec.declinedBy.indexOf(from) < 0) dec.declinedBy.push(from);
                var self = this;
                var others = (this.getConnectedUsers() || []).filter(function (n) { return n !== self.username; });
                if (others.every(function (n) { return dec.declinedBy.indexOf(n) >= 0; })) dec.state = 'declined';
            }
            this.render();
        }

        _onNeed(d, from) {
            // The receiver is short of some pieces. Send those and only those,
            // and only to the receiver: anyone else asking gets nothing.
            var out = this.transfers.get(d.id);
            if (!out || out.dir !== 'out' || !out.file || out.to !== from || !Array.isArray(d.missing)) return;
            this._resend(out, d.missing, from);
        }

        _onChunk(d, from) {
            var row = this.transfers.get(d.id);
            if (!row || row.dir !== 'in' || row.state !== 'accepted' || row.from !== from) return;
            if (typeof d.i !== 'number' || d.i < 0 || d.i >= row.total) return;
            // A piece is at most CHUNK bytes, as base64 text: anything else would
            // let the sender push past MAX_FILE into this tab's memory.
            if (typeof d.b !== 'string' || d.b.length > MAX_CHUNK_B64) return;
            if (row.parts[d.i]) return;                 // a repeat is not progress
            row.parts[d.i] = fromB64(d.b);
            row.done++;
            this._pace(row);
            if (row.done >= row.total) this._finish(row);
            else { this._watch(row); if (row.done % 8 === 0) this.render(); }
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
            row.fresh = row.state === 'ready';
            this.render();
            if (row.state === 'ready') UI.toast(row.name + ' arrived', 'success');
            else UI.toast(row.name + ' arrived incomplete', 'error', 5000);
            if (row.state === 'ready') this._preview(row);
        }

        /**
         * A look at what arrived before you save it: a thumbnail for a picture,
         * the first lines of a text file. Made here, from the bytes in this
         * browser; nothing is opened, run or sent anywhere.
         */
        _preview(row) {
            var self = this;
            if (/^image\/(png|jpe?g|gif|webp)$/.test(row.mime) && row.size <= PREVIEW_IMAGE_MAX) {
                row.previewUrl = URL.createObjectURL(row.blob);
                this.render();
            } else if (/^text\/|json|csv|markdown/.test(row.mime) || /\.(txt|md|csv|json|log)$/i.test(row.name)) {
                row.blob.slice(0, 600).text().then(function (t) {
                    row.previewText = t.split('\n').slice(0, 6).join('\n');
                    self.render();
                }).catch(function () { /* no preview is fine */ });
            }
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

            if (row.state === 'sending' || row.state === 'accepted') kids.push(this._flight(row, pct));
            if (row.dir === 'out' && row.state === 'offered' && row.declinedBy && row.declinedBy.length) {
                kids.push(UI.el('span', { class: 'tr__chunks' }, 'declined by ' + row.declinedBy.join(', ') + ' · still open to the rest'));
            }
            if (row.previewUrl) {
                kids.push(UI.el('img', { class: 'tr__preview', src: row.previewUrl, alt: 'Preview of ' + row.name }));
            } else if (row.previewText) {
                kids.push(UI.el('pre', { class: 'tr__preview tr__preview--text' }, row.previewText));
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

            var fresh = row.fresh;
            row.fresh = false;   // the arrival moment plays once
            return UI.el('article', { class: 'tr tr--' + row.state + (fresh ? ' is-fresh' : '') }, kids);
        }

        /**
         * The file in flight: who it leaves, who it reaches, a bar between them
         * with the plane at its front, and the speed and time left.
         */
        _flight(row, pct) {
            var me = this.username;
            var a = row.dir === 'out' ? me : row.from;
            var b = row.dir === 'out' ? row.to : me;
            var dot = function (n) {
                return UI.el('span', { class: 'avatar avatar--sm', style: 'background:' + this.generateUserColor(n || '?'), title: n || '' }, initials(n));
            }.bind(this);
            var left = row.rate ? Math.max(0, (row.total - row.done) * CHUNK / row.rate) : null;
            var pace = row.rate ? ' · ' + UI.fmtBytes(row.rate) + '/s' + (left !== null ? ' · ' + fmtLeft(left) : '') : '';
            return UI.el('div', { class: 'tr__flight' }, [
                dot(a),
                UI.el('div', { class: 'tr__track' }, [
                    UI.el('div', { class: 'tr__fill', style: 'width:' + pct + '%' }, [
                        UI.el('span', { class: 'tr__plane' }, UI.iconNode('send', 'icon--sm'))
                    ])
                ]),
                dot(b),
                UI.el('span', { class: 'tr__chunks' }, 'chunk ' + row.done + ' / ' + row.total + pace)
            ]);
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

    /** Which method moves which kind of message along. */
    var RECEIVE = {
        offer: Drop.prototype._onOffer, accept: Drop.prototype._onAccept, taken: Drop.prototype._onTaken,
        decline: Drop.prototype._onDecline, need: Drop.prototype._onNeed, chunk: Drop.prototype._onChunk
    };

    var PREVIEW_IMAGE_MAX = 8 * 1024 * 1024;

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

    /** "about 4 s left", "about 2 min left". */
    function fmtLeft(secs) {
        if (secs < 1) return 'almost there';
        if (secs < 90) return 'about ' + Math.ceil(secs) + ' s left';
        return 'about ' + Math.round(secs / 60) + ' min left';
    }

    /**
     * Something to send when you have nothing to hand: a postcard from this
     * room, drawn here as a PNG. It is a real file, so the whole path runs,
     * offer, accept, chunks, and the picture preview at the other end.
     */
    function postcard(room) {
        var c = document.createElement('canvas');
        c.width = 800; c.height = 500;
        var g = c.getContext('2d');
        var sky = g.createLinearGradient(0, 0, 0, 500);
        sky.addColorStop(0, '#0ea5e9'); sky.addColorStop(0.6, '#fbbf24'); sky.addColorStop(1, '#f97316');
        g.fillStyle = sky; g.fillRect(0, 0, 800, 500);
        g.fillStyle = '#fde68a'; g.beginPath(); g.arc(600, 300, 90, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#0f172a';
        g.beginPath(); g.moveTo(0, 500); g.lineTo(0, 380); g.lineTo(180, 260); g.lineTo(330, 380);
        g.lineTo(470, 300); g.lineTo(800, 420); g.lineTo(800, 500); g.fill();
        g.fillStyle = '#ffffff'; g.font = 'bold 54px system-ui, sans-serif';
        g.fillText('Greetings from', 48, 110);
        g.font = 'bold 44px ui-monospace, monospace';
        g.fillText(String(room).slice(0, 26), 48, 170);
        g.font = '24px system-ui, sans-serif';
        g.fillText('Sent with Drop · ' + new Date().toLocaleString(), 48, 470);
        var name = 'postcard-' + String(room).replace(/[^a-z0-9-]+/gi, '-') + '.png';
        return new Promise(function (res) {
            c.toBlob(function (blob) { res(new File([blob], name, { type: 'image/png' })); }, 'image/png');
        });
    }

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

        var card = document.getElementById('postcardBtn');
        if (card) card.addEventListener('click', function () {
            if (!app || !app.connected) { UI.toast('Join a room first', 'info'); return; }
            postcard(app.channelName).then(function (file) { app.send(file); });
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
            if (window.dropMailbox) window.dropMailbox.onConnect();   // "Leave for later" reads the same room

            // Drop is the one demo that proves nothing on your own: without a
            // second person there is no one to offer a file to. The companion
            // is a real second connection that accepts what it is offered, so
            // the whole transfer runs — offer, accept, chunks, progress, done.
            //
            // It does not reassemble the file; it does not need to. The sender
            // counts its own chunks out, so this side of the wire behaves
            // exactly as it does with a person on the other end.
            if (window.Companion) {
                window.dropCompanion = window.Companion.attach(app, {
                    onData: function (c, from, data) {
                        if (!data || data.type !== 'offer') return;
                        c.send({ type: 'accept', id: data.id, by: c.name }, from);
                    }
                }, {
                    noteText: 'The companion is a second connection running in this tab. ' +
                              'It accepts what you send it, so the transfer really runs — but ' +
                              'there is no network between the two, so the speed here is not ' +
                              'representative.'
                });
            }
        } catch (err) {
            console.error('[Drop] connect failed:', err);
            if (window.ConnectionModal) ConnectionModal.fail(err);
            UI.toast('Could not connect: ' + err.message, 'error', 5000);
            app = null;
        }
    }

    /** Send now | Leave for later. ?mode=later opens the mailbox (the old Dead Drop address lands there). */
    function wireModes() {
        var tabs = document.querySelectorAll('[data-drop-mode]');
        function select(name) {
            tabs.forEach(function (tab) {
                var on = tab.getAttribute('data-drop-mode') === name;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
            });
        }
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () { select(tab.getAttribute('data-drop-mode')); });
        });
        if (new URLSearchParams(location.search).get('mode') === 'later') select('later');
    }

    document.addEventListener('DOMContentLoaded', function () {
        wire();
        wireModes();
        window.loadConnectionModal({
            localStoragePrefix: 'drop_',
            channelPrefix: 'drop-',
            title: 'Join a Drop room',
            collapsedTitle: 'Drop',
            partyLobby: {
                id: 'drop', start: 'Open a drop room', players: 'You and whoever has the code',
                waitingRoom: {
                    hint: 'Nobody to send to yet? Add a companion and send it something, or leave a file for later: it waits for whoever opens the link.',
                    solo: { label: 'Add a companion', close: true, run: function () {
                        var btn = document.querySelector('.companion-btn');
                        if (btn && !btn.classList.contains('is-on')) btn.click();
                    } }
                },
                howTo: [
                    'Open a room and send its code to the other side.',
                    'Send now goes straight between your browsers, nothing uploaded.',
                    'Or leave a file for later, encrypted before it leaves you.',
                ],
            },
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
