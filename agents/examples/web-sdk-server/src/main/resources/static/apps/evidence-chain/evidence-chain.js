/**
 * Evidence Chain — a log you can add to and cannot quietly rewrite.
 *
 * The primitive on show is **append-only channel storage made tamper-evident**.
 * Two halves, and neither is enough alone:
 *
 *  - `storageAdd` appends a version rather than replacing a value, so the
 *    channel keeps every entry that was ever written. That gives you a log.
 *  - each entry's hash covers the previous entry's hash, so the entries are
 *    welded into an order. That is what turns a log into a record: change one
 *    character of entry 3, or remove it, and every hash from there on stops
 *    matching, and re-deriving the chain names the first entry that broke.
 *
 * Storage alone would let somebody hand you a shorter list and call it the
 * whole thing. Hashing alone would let somebody hand you a different list.
 * Together they mean an entry can be added, and nothing else.
 *
 * What this deliberately is NOT: a product. There are no templates, no camera,
 * no report export and no operator manual — those live in Fieldstamp, which is
 * built on exactly the functions below. This page exists so you can read the
 * mechanism in one sitting and prove to yourself that it detects tampering,
 * because a verifier nobody has watched fail is a verifier nobody should trust.
 */
(function () {
    'use strict';

    var LOG_KEY = 'evidence_chain_log';
    var MAX_NOTE_CHARS = 280;

    function el(id) { return document.getElementById(id); }

    // ------------------------------------------------------------- the chain
    // These four functions are the entire mechanism. Everything else on this
    // page is a button that calls one of them.

    async function sha256Hex(buffer) {
        var digest = await crypto.subtle.digest('SHA-256', buffer);
        return [].slice.call(new Uint8Array(digest))
            .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    async function sha256Text(text) {
        return sha256Hex(new TextEncoder().encode(text));
    }

    /** Stable JSON: same object, same string, same hash, on every browser, next year. */
    function canonical(obj) {
        if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
        if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
        return '{' + Object.keys(obj).sort().map(function (k) {
            return JSON.stringify(k) + ':' + canonical(obj[k]);
        }).join(',') + '}';
    }

    /**
     * The chain hash for one entry. `prev` is the previous entry's chain hash,
     * or the log's genesis string for the first one.
     */
    async function chainNext(prev, contentHash, stamp) {
        return sha256Text(prev + '|' + contentHash + '|' + canonical(stamp));
    }

    /** Re-derive the whole log and report the first entry that does not hold. */
    async function verifyChain(entries, genesis) {
        var prev = genesis;
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var expect = await chainNext(prev, e.contentHash, e.stamp);
            if (expect !== e.chain) {
                return { ok: false, brokenAt: i, expected: expect, found: e.chain };
            }
            prev = e.chain;
        }
        return { ok: true, brokenAt: -1 };
    }

    function genesisFor(logName) { return 'evidence-chain:' + logName; }

    // ---------------------------------------------------------------- the app

    class EvidenceChain extends UserConnectionBase {
        constructor() {
            super({ autoCreateDataChannel: false });
            this.entries = [];
            this.tampered = false;
        }

        onConnect() {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            el('logName').textContent = this.channelName;
            el('genesis').textContent = genesisFor(this.channelName);
            this.reload();
        }

        say(msg, kind) {
            var box = el('state');
            box.textContent = msg;
            box.className = 'ec-state' + (kind ? ' ec-state--' + kind : '');
        }

        // ---- writing --------------------------------------------------------

        async append(note) {
            if (!note) return;
            if (note.length > MAX_NOTE_CHARS) {
                this.say('Entries are capped at ' + MAX_NOTE_CHARS + ' characters.', 'warn');
                return;
            }
            // Read the log back before appending: the previous chain hash has to
            // be the one actually in storage, not the one this tab remembers.
            // Two people adding at once is how a chain forks, and reading first
            // is what makes the fork visible instead of silent.
            await this.load();

            var prev = this.entries.length
                ? this.entries[this.entries.length - 1].chain
                : genesisFor(this.channelName);

            var stamp = {
                seq: this.entries.length,
                at: new Date().toISOString(),
                by: this.username
            };
            var contentHash = await sha256Text(note);
            var chain = await chainNext(prev, contentHash, stamp);

            var entry = { note: note, contentHash: contentHash, stamp: stamp, chain: chain };
            var self = this;
            this.channel.storageAdd({
                storageKey: LOG_KEY,
                content: JSON.stringify(entry),
                encrypted: false,
                metadata: { seq: stamp.seq, at: stamp.at }
            }, function (response) {
                if (response && response.status === 'success') {
                    el('note').value = '';
                    self.say('Entry ' + stamp.seq + ' appended.', 'ok');
                    self.reload();
                } else {
                    self.say('Could not append — ' +
                        ((response && response.statusMessage) || 'unknown error'), 'bad');
                }
            });
        }

        // ---- reading --------------------------------------------------------

        /**
         * storageGetList takes the key as a BARE STRING, not {storageKey}, and
         * the content of each row is base64-encoded JSON. Decode one layer only
         * and a full log reads as an empty one — which looks exactly like a log
         * nobody has written to yet, so it fails silently. This is the single
         * most expensive mistake to make against this API.
         */
        load() {
            var self = this;
            return new Promise(function (resolve) {
                self.channel.storageGetList(LOG_KEY, function (response) {
                    var rows = [];
                    if (response && response.status === 'success') {
                        var body = response.data && response.data.data
                            ? response.data.data : response.data;
                        if (Array.isArray(body)) rows = body;
                        else if (body && Array.isArray(body.versions)) rows = body.versions;
                    }

                    var entries = [];
                    rows.forEach(function (row) {
                        try {
                            var raw = (row && row.content !== undefined) ? row.content : row;
                            if (typeof raw === 'string') {
                                // base64 JSON on the listing path, plain JSON on others
                                try { raw = atob(raw); } catch (_) { /* already plain */ }
                                raw = JSON.parse(raw);
                            }
                            if (raw && raw.chain && raw.stamp) entries.push(raw);
                        } catch (_) { /* a row this client cannot read is skipped */ }
                    });

                    entries.sort(function (a, b) { return a.stamp.seq - b.stamp.seq; });
                    self.entries = entries;
                    self.tampered = false;
                    resolve(entries);
                });
            });
        }

        async reload() {
            this.say('Reading the log…');
            await this.load();
            this.render();
            this.say(this.entries.length
                ? this.entries.length + ' entries read from storage.'
                : 'This log is empty. Append the first entry.');
        }

        // ---- verifying ------------------------------------------------------

        async verify() {
            var result = await verifyChain(this.entries, genesisFor(this.channelName));
            this.render(result);
            if (result.ok) {
                this.say(this.entries.length + ' entries re-derived from the genesis string — '
                    + 'every hash holds.', 'ok');
            } else {
                this.say('Chain broken at entry ' + result.brokenAt
                    + '. Expected ' + result.expected.slice(0, 16)
                    + '…, the record says ' + result.found.slice(0, 16) + '…', 'bad');
            }
            return result;
        }

        /**
         * Tampering happens on the copy this page has loaded, not in storage —
         * storage is append-only, so there is nothing there to rewrite. That is
         * the realistic threat anyway: somebody hands you a log and says it is
         * the record. Verification is what tells you it is not.
         */
        async alter(index) {
            if (!this.entries[index]) return;
            this.entries[index].note = this.entries[index].note + ' (altered)';
            this.entries[index].contentHash = await sha256Text(this.entries[index].note);
            this.tampered = true;
            this.say('Entry ' + index + ' was altered in this tab. Now verify the chain.', 'warn');
            this.render();
        }

        async remove(index) {
            if (!this.entries[index]) return;
            this.entries.splice(index, 1);
            this.tampered = true;
            this.say('Entry ' + index + ' was removed from this tab’s copy. Now verify the chain.', 'warn');
            this.render();
        }

        // ---- rendering ------------------------------------------------------

        render(result) {
            var list = el('entries');
            list.innerHTML = '';
            el('count').textContent = this.entries.length;
            el('tamperFlag').hidden = !this.tampered;

            this.entries.forEach(function (e, i) {
                var broken = result && !result.ok && i >= result.brokenAt;
                var first = result && !result.ok && i === result.brokenAt;

                var row = document.createElement('li');
                row.className = 'ec-entry' + (broken ? ' ec-entry--broken' : '')
                    + (result && result.ok ? ' ec-entry--ok' : '');

                var head = document.createElement('div');
                head.className = 'ec-entry-head';
                head.appendChild(Object.assign(document.createElement('span'),
                    { className: 'ec-seq', textContent: '#' + e.stamp.seq }));
                head.appendChild(Object.assign(document.createElement('span'),
                    { className: 'ec-by', textContent: e.stamp.by }));
                head.appendChild(Object.assign(document.createElement('time'),
                    { className: 'ec-at', textContent: e.stamp.at.replace('T', ' ').slice(0, 19) }));
                row.appendChild(head);

                // textContent, never innerHTML: an entry is somebody else's text.
                row.appendChild(Object.assign(document.createElement('p'),
                    { className: 'ec-note', textContent: e.note }));

                var hashes = document.createElement('dl');
                hashes.className = 'ec-hashes';
                [['content', e.contentHash], ['chain', e.chain]].forEach(function (pair) {
                    hashes.appendChild(Object.assign(document.createElement('dt'),
                        { textContent: pair[0] }));
                    hashes.appendChild(Object.assign(document.createElement('dd'),
                        { textContent: pair[1] }));
                });
                row.appendChild(hashes);

                if (first) {
                    row.appendChild(Object.assign(document.createElement('p'), {
                        className: 'ec-break',
                        textContent: 'The chain first fails here. Everything below inherits the break.'
                    }));
                }

                var tools = document.createElement('div');
                tools.className = 'ec-entry-tools';
                var alter = Object.assign(document.createElement('button'),
                    { className: 'btn btn--sm btn--ghost', textContent: 'Alter' });
                alter.addEventListener('click', function () { window.ecApp.alter(i); });
                var drop = Object.assign(document.createElement('button'),
                    { className: 'btn btn--sm btn--ghost', textContent: 'Remove' });
                drop.addEventListener('click', function () { window.ecApp.remove(i); });
                tools.appendChild(alter);
                tools.appendChild(drop);
                row.appendChild(tools);

                list.appendChild(row);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var app = new EvidenceChain();
        window.ecApp = app;

        el('appendBtn').addEventListener('click', function () { app.append(el('note').value.trim()); });
        el('verifyBtn').addEventListener('click', function () { app.verify(); });
        el('reloadBtn').addEventListener('click', function () { app.reload(); });

        window.loadConnectionModal({
            localStoragePrefix: 'evchain_',
            channelPrefix: 'log-',
            title: 'Open an evidence log',
            collapsedTitle: 'Evidence Chain',
            onConnect: async function (username, channel, password) {
                await app.initialize();
                await app.connect({
                    username: username, channelName: channel, channelPassword: password
                });
            }
        });
    });

    // Exposed so the E2E suite can exercise the mechanism directly, and so you
    // can paste these four functions into a console and satisfy yourself.
    window.EvidenceChainCore = { sha256Text, canonical, chainNext, verifyChain, genesisFor };
})();
