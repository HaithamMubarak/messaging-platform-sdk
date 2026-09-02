/**
 * Evidence Chain — a log you can add to and cannot quietly rewrite.
 *
 * This is the demo of the **Attest** primitive, and it is deliberately built
 * from two halves that need each other:
 *
 *  - the NOTE lives in channel storage (`storageAdd` appends a version rather
 *    than replacing one), so the log can be read back by anyone who joins —
 *    and, crucially for a demo, so it can be tampered with in front of you.
 *  - the HASH of that note is sent to `attest()`, and the platform assigns the
 *    order, stamps its own clock, welds the record to the one before it and
 *    signs the result. The platform never sees the note itself.
 *
 * Neither half is enough alone. Storage without the chain would let somebody
 * hand you a shorter list and call it the whole thing. The chain without the
 * content would prove an order but not what was in it. Together they mean an
 * entry can be added, and nothing else.
 *
 * So verification here asks two questions, and the page shows you both:
 *
 *   1. does the platform's chain still hold? — `AgentConnection.attestVerify`
 *      re-derives every hash and checks every signature against the published
 *      key, WITHOUT asking the platform whether the platform is honest.
 *   2. does each stored note still hash to what was attested for it? — this is
 *      what catches somebody editing the text after the fact.
 *
 * Press Alter and then Verify: the note no longer matches its receipt, and the
 * page names the entry that broke. Press Remove: the record exists with no note
 * to match it, and that is caught too. A verifier nobody has watched fail is a
 * verifier nobody should trust.
 *
 * What this deliberately is NOT: a product. No templates, no camera, no report
 * export — those live in Fieldstamp, which is built on the same primitive.
 */
(function () {
    'use strict';

    var LOG_KEY = 'evidence_chain_log';
    var LOG_CHAIN = 'evidence-log';
    var MAX_NOTE_CHARS = 280;

    function el(id) { return document.getElementById(id); }

    // ------------------------------------------------------------- the chain
    //
    // These used to be hand-rolled here, and in four other apps besides. They
    // are now `attest()` on the SDK: same rule, same canonical JSON, but the
    // ORDER is assigned by the server and the result is signed, so a receipt
    // can be checked by somebody who does not trust the app that wrote it.
    //
    // sha256Text and canonical are kept because this page exists to be read.
    // They are byte-identical to the SDK's and the server's — that is what
    // lets a chain written by hand before the primitive existed still verify.

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
     * The two questions, asked in order.
     *
     * `bundle` is what attestList returned — records, genesis and the public
     * key. `entries` is this page's joined view of notes and records. The first
     * check is the platform's chain; the second is whether the text still
     * matches the receipt written for it.
     */
    async function verifyEntries(entries, bundle) {
        var chain = await window.AgentConnection.attestVerify(bundle);
        if (!chain.ok) {
            return {
                ok: false, brokenAt: chain.brokenAt, scope: 'chain',
                expected: 'a chain that re-derives', found: chain.reason
            };
        }

        var records = (bundle && bundle.records) || [];
        for (var i = 0; i < Math.max(entries.length, records.length); i++) {
            var e = entries[i], r = records[i];
            if (!e || !r) {
                // A record with no note, or a note with no record: the two
                // halves disagree about how many things happened.
                return {
                    ok: false, brokenAt: i, scope: 'count',
                    expected: records.length + ' entries',
                    found: entries.length + ' entries'
                };
            }
            if (e.seq !== r.seq) {
                return {
                    ok: false, brokenAt: i, scope: 'order',
                    expected: 'entry ' + r.seq, found: 'entry ' + e.seq
                };
            }
            var actual = await sha256Text(e.note);
            if (actual !== r.contentHash) {
                return {
                    ok: false, brokenAt: i, scope: 'content',
                    expected: r.contentHash, found: actual
                };
            }
        }
        return { ok: true, brokenAt: -1, scope: null };
    }

    // ---------------------------------------------------------------- the app

    class EvidenceChain extends UserConnectionBase {
        constructor() {
            super({ autoCreateDataChannel: false });
            this.entries = [];
            this.bundle = { records: [], genesis: null, publicKeys: [] };
            this.tampered = false;
        }

        onConnect() {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            el('logName').textContent = this.channelName;
            // The genesis is derived by the server from the channel and the
            // chain name, and handed back with every read, so this page shows
            // the real one rather than a string it made up.
            el('genesis').textContent = 'reading…';
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

            var self = this;
            var contentHash = await sha256Text(note);

            // Attest FIRST, because the server is what assigns the order. The
            // page never picks a sequence number, which is the point: two
            // people appending at once cannot both think they are entry 4.
            var receipt = await new Promise(function (resolve) {
                self.channel.attest({
                    chainKey: LOG_CHAIN,
                    kind: 'log-entry',
                    contentHash: contentHash,
                    meta: { chars: note.length }   // public-safe: a length, not the text
                }, resolve);
            });

            if (!receipt || receipt.status !== 'success') {
                this.say('Could not attest — ' +
                    ((receipt && (receipt.statusMessage || receipt.data)) || 'unknown error'), 'bad');
                return;
            }

            var seq = receipt.data.record.seq;

            // Then store the note under the sequence the receipt gave it. If
            // this half fails, the log has a receipt with no text -- which
            // verification reports rather than hides, because a silent gap is
            // exactly the thing this app exists to make visible.
            this.channel.storageAdd({
                storageKey: LOG_KEY,
                content: JSON.stringify({ seq: seq, note: note }),
                encrypted: false,
                metadata: { seq: seq }
            }, function (response) {
                if (response && response.status === 'success') {
                    el('note').value = '';
                    self.say('Entry ' + seq + ' attested and stored.', 'ok');
                    self.reload();
                } else {
                    self.say('Attested as entry ' + seq + ', but storing the text failed — '
                        + 'verify will report the gap.', 'warn');
                    self.reload();
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
                // Half one: the notes, out of channel storage.
                //
                // storageGetList takes the key as a BARE STRING, not
                // {storageKey}, and the content of each row is base64-encoded
                // JSON. Decode one layer only and a full log reads as an empty
                // one -- which looks exactly like a log nobody has written to
                // yet, so it fails silently. The single most expensive mistake
                // to make against this API.
                self.channel.storageGetList(LOG_KEY, function (response) {
                    var rows = [];
                    if (response && response.status === 'success') {
                        var body = response.data && response.data.data
                            ? response.data.data : response.data;
                        if (Array.isArray(body)) rows = body;
                        else if (body && Array.isArray(body.versions)) rows = body.versions;
                    }

                    var notes = {};
                    rows.forEach(function (row) {
                        try {
                            var raw = (row && row.content !== undefined) ? row.content : row;
                            if (typeof raw === 'string') {
                                try { raw = atob(raw); } catch (_) { /* already plain */ }
                                raw = JSON.parse(raw);
                            }
                            if (raw && typeof raw.seq === 'number') notes[raw.seq] = raw.note;
                        } catch (_) { /* a row this client cannot read is skipped */ }
                    });

                    // Half two: the receipts, out of the platform chain.
                    self.channel.attestList(LOG_CHAIN, function (chainResponse) {
                        var bundle = (chainResponse && chainResponse.status === 'success')
                            ? chainResponse.data : { records: [], genesis: null, publicKeys: [] };

                        // Join them by the sequence the server assigned. A
                        // record with no note keeps its place in the list with
                        // the text missing, so the gap is visible rather than
                        // quietly skipped.
                        self.entries = (bundle.records || []).map(function (r) {
                            return {
                                seq: r.seq,
                                note: notes[r.seq] !== undefined ? notes[r.seq] : null,
                                contentHash: r.contentHash,
                                chain: r.chain,
                                stamp: r.stamp
                            };
                        });
                        self.bundle = bundle;
                        self.tampered = false;
                        resolve(self.entries);
                    });
                });
            });
        }

        async reload() {
            this.say('Reading the log…');
            await this.load();
            if (this.bundle && this.bundle.genesis) {
                el('genesis').textContent = this.bundle.genesis;
            }
            this.render();
            this.say(this.entries.length
                ? this.entries.length + ' entries read from storage.'
                : 'This log is empty. Append the first entry.');
        }

        // ---- verifying ------------------------------------------------------

        async verify() {
            var result = await verifyEntries(this.entries, this.bundle || { records: [] });
            this.render(result);

            if (result.ok) {
                this.say(this.entries.length + ' entries: the platform chain re-derives and every '
                    + 'note still hashes to its receipt.', 'ok');
            } else if (result.scope === 'chain') {
                this.say('The signed chain itself is broken at entry ' + result.brokenAt
                    + ' — ' + result.found, 'bad');
            } else if (result.scope === 'content') {
                this.say('Entry ' + result.brokenAt + ' no longer matches its receipt. Attested '
                    + result.expected.slice(0, 16) + '…, the text now hashes to '
                    + result.found.slice(0, 16) + '…', 'bad');
            } else {
                this.say('The log and its receipts disagree at entry ' + result.brokenAt
                    + ' — expected ' + result.expected + ', found ' + result.found, 'bad');
            }
            return result;
        }

        /**
         * Tampering happens on the copy this page has loaded, not in storage or
         * in the chain — both are append-only, so there is nothing there to
         * rewrite. That is the realistic threat anyway: somebody hands you a log
         * and says it is the record. Verification is what tells you it is not.
         */
        async alter(index) {
            if (!this.entries[index]) return;
            this.entries[index].note = (this.entries[index].note || '') + ' (altered)';
            this.tampered = true;
            this.say('Entry ' + index + ' was altered in this tab. Now verify.', 'warn');
            this.render();
        }

        async remove(index) {
            if (!this.entries[index]) return;
            this.entries.splice(index, 1);
            this.tampered = true;
            this.say('Entry ' + index + ' was removed from this tab\u2019s copy. Now verify.', 'warn');
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
                    { className: 'ec-seq', textContent: '#' + e.seq }));
                head.appendChild(Object.assign(document.createElement('span'),
                    { className: 'ec-by', textContent: e.stamp.agent }));
                head.appendChild(Object.assign(document.createElement('time'),
                    { className: 'ec-at', textContent: String(e.stamp.serverTime).replace('T', ' ').slice(0, 19) }));
                row.appendChild(head);

                // textContent, never innerHTML: an entry is somebody else's text.
                row.appendChild(Object.assign(document.createElement('p'),
                    { className: 'ec-note', textContent: e.note === null ? '(attested, but no text stored)' : e.note }));

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
    window.EvidenceChainCore = { sha256Text, canonical, verifyEntries };
})();
