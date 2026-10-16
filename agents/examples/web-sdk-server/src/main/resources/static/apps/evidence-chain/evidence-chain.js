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

    // ---------------------------------------------------------- the challenge
    //
    // The page is a game played against verifyEntries: write a log, tamper with
    // this tab's copy (edit, delete, swap), and see whether Verify notices. The
    // score is kept per browser. "Fooled it" only counts a verify that PASSED
    // while the copy differs from what was read: it should never go up.

    var SCORE_KEY = 'evchain_score';
    var TRICKS = ['edit', 'delete', 'swap'];
    var EXAMPLES = [
        'Arrived on site 09:12. Gate unlocked, no damage.',
        'Meter reading 41,208 kWh. Photographed.',
        'Panel 3 cover missing. Reported to the site manager.'
    ];

    function readScore() {
        try {
            var s = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
            return { attempts: s.attempts || 0, fooled: s.fooled || 0, tried: s.tried || {} };
        } catch (_) { return { attempts: 0, fooled: 0, tried: {} }; }
    }

    function saveScore(score) {
        try { localStorage.setItem(SCORE_KEY, JSON.stringify(score)); } catch (_) { /* private mode */ }
    }

    /** Eight colour bands from a hash: two entries that differ look different at a glance. */
    function fingerprint(hash) {
        var bar = document.createElement('span');
        bar.className = 'ec-print';
        bar.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < 8; i++) {
            var band = document.createElement('span');
            band.style.background = 'hsl(' + Math.round(parseInt(hash.substr(i * 4, 4), 16) / 65536 * 360) + ' 70% 60%)';
            bar.appendChild(band);
        }
        return bar;
    }

    const shortHash = (h) => h ? h.slice(0, 8) + '…' + h.slice(-6) : '';

    /** What the verdict panel says, in words a person can follow. */
    function verdictFor(result, entries, tampered, records) {
        if (!result) {
            return tampered
                ? { state: 'armed', kicker: 'Trick played', title: 'Think you got away with it?', detail: 'Press Verify and find out.' }
                : { state: 'idle', kicker: 'Waiting', title: 'Pick a trick, then press Verify.',
                    detail: 'Verification runs in your browser. It never asks the platform whether the platform is honest.' };
        }
        if (result.ok) {
            return { state: 'ok', kicker: 'All clear', title: 'Every seal holds.',
                detail: entries.length + ' entries re-derived from the start of the log, and every note still says what was sealed.' };
        }
        // brokenAt is a position in the copy; name the entry the platform sealed there.
        var n = records[result.brokenAt] ? records[result.brokenAt].seq : result.brokenAt;
        var detail = {
            content: 'Its text no longer hashes to what was sealed: sealed ' + shortHash(result.expected)
                + ', now ' + shortHash(result.found) + '.',
            order: 'The log and the platform’s receipts no longer line up: that place should hold '
                + result.expected + ', and holds ' + result.found + '.',
            count: 'The platform signed ' + result.expected + ', and this copy has ' + result.found + '.',
            chain: 'The signed chain itself does not re-derive: ' + result.found + '.'
        }[result.scope] || '';
        return { state: 'caught', kicker: 'Caught', title: 'Caught at entry ' + n + '.',
            detail: detail + ' Everything after it can no longer be trusted either.' };
    }

    // ---------------------------------------------------------------- the app

    class EvidenceChain extends UserConnectionBase {
        constructor() {
            super({ autoCreateDataChannel: false });
            this.entries = [];
            this.bundle = { records: [], genesis: null, publicKeys: [] };
            this.tampered = false;
            this.original = '';        // the copy as read, to tell a real pass from a fooled one
            this.played = {};          // tricks played on this copy since it was read
            this.result = null;        // the last verify, until the copy changes again
            this.editing = -1;
            this.score = readScore();
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

        /**
         * Somebody says they sealed an entry. The message is only a nudge:
         * anyone can send it, as often as they like, with any number. So one
         * check runs at a time, and nothing is read again or announced unless
         * the chain holds a NEW entry at that number, sealed by the sender.
         * Then read the log again, unless this tab is in the middle of a
         * trick: then say so, and leave the game alone.
         */
        onGameMessage(detail) {
            var data = detail && detail.data ? detail.data : detail;
            var from = this.senderOf(detail);
            if (!data || data.type !== 'sealed' || !from || from === this.username) return;
            this.nudged = { from: from, seq: data.seq };
            if (!this.checkingNudge) this.checkNudges();
        }

        async checkNudges() {
            this.checkingNudge = true;
            while (this.nudged) {
                var n = this.nudged;
                this.nudged = null;
                var known = (this.bundle.records || []).some(function (r) { return r.seq === n.seq; });
                var record = known ? null : await this.sealedBy(n.from, n.seq);
                if (!record) continue;
                if (this.tampered) {
                    this.say(n.from + ' sealed entry ' + record.seq + '. Reload to see it (it ends this trick).', 'warn');
                    continue;
                }
                this.fresh = record.seq;
                await this.reload();
            }
            this.checkingNudge = false;
        }

        /** The chain's record at `seq` if `agent` sealed it, else null. */
        sealedBy(agent, seq) {
            var self = this;
            return new Promise(function (resolve) {
                self.channel.attestList(LOG_CHAIN, function (res) {
                    var records = res && res.status === 'success' && res.data ? res.data.records || [] : [];
                    resolve(records.find(function (r) { return r.seq === seq && r.stamp && r.stamp.agent === agent; }) || null);
                });
            });
        }

        say(msg, kind) {
            var box = el('state');
            box.textContent = msg;
            box.className = 'ec-state' + (kind ? ' ec-state--' + kind : '');
        }

        // ---- writing --------------------------------------------------------

        /** Attest a note's hash, then store the note under the sequence the platform gave it. */
        async append(note, quiet) {
            if (!note) return false;
            if (note.length > MAX_NOTE_CHARS) {
                this.say('Entries are capped at ' + MAX_NOTE_CHARS + ' characters.', 'warn');
                return false;
            }
            var receipt = await this.attestNote(note);
            if (!receipt || receipt.status !== 'success') {
                this.say('Could not attest — ' +
                    ((receipt && (receipt.statusMessage || receipt.data)) || 'unknown error'), 'bad');
                return false;
            }
            var seq = receipt.data.record.seq;
            var stored = await this.storeNote(seq, note);
            if (stored) {
                this.fresh = seq;
                try { this.sendCustomEventMessage({ type: 'sealed', seq: seq }, '*'); } catch (_) { /* the log is the record either way */ }
                el('note').value = '';
                this.say('Entry ' + seq + ' sealed and stored.', 'ok');
            } else {
                this.say('Sealed as entry ' + seq + ', but storing the text failed — '
                    + 'verify will report the gap.', 'warn');
            }
            if (!quiet) await this.reload();
            return stored;
        }

        /*
         * Attest FIRST, because the server is what assigns the order. The page
         * never picks a sequence number, which is the point: two people
         * appending at once cannot both think they are entry 4.
         */
        async attestNote(note) {
            var self = this;
            var contentHash = await sha256Text(note);
            return new Promise(function (resolve) {
                self.channel.attest({
                    chainKey: LOG_CHAIN,
                    kind: 'log-entry',
                    contentHash: contentHash,
                    meta: { chars: note.length }   // public-safe: a length, not the text
                }, resolve);
            });
        }

        /*
         * If this half fails, the log has a receipt with no text -- which
         * verification reports rather than hides, because a silent gap is
         * exactly the thing this app exists to make visible.
         */
        storeNote(seq, note) {
            var self = this;
            return new Promise(function (resolve) {
                self.channel.storageAdd({
                    storageKey: LOG_KEY,
                    content: JSON.stringify({ seq: seq, note: note }),
                    encrypted: false,
                    metadata: { seq: seq }
                }, function (response) { resolve(!!(response && response.status === 'success')); });
            });
        }

        /** Three plausible entries, so there is something to tamper with in one click. */
        async seedExamples() {
            var button = el('seedBtn');
            button.disabled = true;
            for (var i = 0; i < EXAMPLES.length; i++) {
                this.say('Sealing example ' + (i + 1) + ' of ' + EXAMPLES.length + '…');
                if (!(await this.append(EXAMPLES[i], true))) break;
            }
            button.disabled = false;
            await this.reload();
        }
        // ---- reading --------------------------------------------------------

        load() {
            var self = this;
            return new Promise(function (resolve) {
                // Half one: the notes, out of channel storage (notesFrom).
                self.channel.storageGetList(LOG_KEY, function (response) {
                    var notes = notesFrom(response);
                    // Half two: the receipts, out of the platform chain.
                    self.channel.attestList(LOG_CHAIN, async function (chainResponse) {
                        var bundle = (chainResponse && chainResponse.status === 'success')
                            ? chainResponse.data : { records: [], genesis: null, publicKeys: [] };
                        // Join them by the sequence the server assigned. A
                        // record with no note keeps its place in the list with
                        // the text missing, so the gap is visible rather than
                        // quietly skipped.
                        self.entries = await Promise.all((bundle.records || []).map(function (r) {
                            return sealedNote(notes[r.seq] || [], r.contentHash).then(function (pick) {
                                return {
                                    seq: r.seq, note: pick.note, others: pick.others,
                                    contentHash: r.contentHash, chain: r.chain, stamp: r.stamp
                                };
                            });
                        }));
                        self.bundle = bundle;
                        self.untouched();
                        resolve(self.entries);
                    });
                });
            });
        }

        /** The copy now equals what was read: nothing played, nothing to judge. */
        untouched() {
            this.tampered = false;
            this.played = {};
            this.result = null;
            this.editing = -1;
            this.original = snapshot(this.entries);
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
                : 'This log is empty. Add an entry, or three examples.');
        }

        // ---- verifying ------------------------------------------------------

        async verify() {
            var result = await verifyEntries(this.entries, this.bundle || { records: [] });
            this.result = result;
            this.keepScore(result);
            this.render();
            this.say(result.ok ? 'Verified: every seal holds.' : 'Verify found a break. See the verdict below.',
                result.ok ? 'ok' : 'bad');
            return result;
        }

        /** An attempt is a verify of a copy somebody changed; fooling it is that verify passing. */
        keepScore(result) {
            if (!this.tampered) return;
            var changed = snapshot(this.entries) !== this.original;
            this.score.attempts += 1;
            if (result.ok && changed) this.score.fooled += 1;
            Object.keys(this.played).forEach(function (t) { this.score.tried[t] = true; }, this);
            saveScore(this.score);
        }

        // ---- tampering ------------------------------------------------------
        //
        // Tampering happens on the copy this page has loaded, not in storage or
        // in the chain — both are append-only, so there is nothing there to
        // rewrite. That is the realistic threat anyway: somebody hands you a log
        // and says it is the record. Verification is what tells you it is not.

        play(trick, msg) {
            this.tampered = true;
            this.played[trick] = true;
            this.result = null;
            this.editing = -1;
            this.say(msg, 'warn');
            this.render();
        }

        alter(index, text) {
            var e = this.entries[index];
            if (!e) return;
            e.note = typeof text === 'string' ? text : (e.note || '') + ' (altered)';
            this.play('edit', 'Entry ' + e.seq + ' was rewritten in this tab. Now verify.');
        }

        remove(index) {
            var e = this.entries[index];
            if (!e) return;
            this.entries.splice(index, 1);
            this.play('delete', 'Entry ' + e.seq + ' was deleted from this tab’s copy. Now verify.');
        }

        swap(index) {
            var a = this.entries[index], b = this.entries[index + 1];
            if (!a || !b) return;
            this.entries[index] = b;
            this.entries[index + 1] = a;
            this.play('swap', 'Entries ' + a.seq + ' and ' + b.seq + ' swapped places in this tab. Now verify.');
        }

        edit(index) {
            this.editing = index;
            this.render();
            var input = document.querySelector('.ec-edit input');
            if (input) { input.focus(); input.select(); }
        }

        // ---- rendering ------------------------------------------------------

        render() {
            var self = this, result = this.result;
            var list = el('entries');
            list.innerHTML = '';
            el('count').textContent = this.entries.length;
            el('tamperFlag').hidden = !this.tampered;
            this.entries.forEach(function (e, i) { list.appendChild(self.renderEntry(e, i, result)); });
            this.renderPlay();
        }

        renderEntry(e, i, result) {
            var broken = result && !result.ok && i >= result.brokenAt;
            var first = result && !result.ok && i === result.brokenAt;
            var row = document.createElement('li');
            if (this.fresh === e.seq && !result) { row.classList.add('ec-entry--fresh'); this.fresh = null; }
            row.className += ' ec-entry' + (broken ? ' ec-entry--broken' : '')
                + (first ? ' ec-entry--first-break' : '') + (result && result.ok ? ' ec-entry--ok' : '');
            var side = Object.assign(document.createElement('div'), { className: 'ec-entry-side' });
            side.appendChild(Object.assign(document.createElement('span'), { className: 'ec-seq', textContent: '#' + e.seq }));
            side.appendChild(Object.assign(document.createElement('span'), { className: 'ec-verdict-tag',
                textContent: !result ? '' : first ? 'broke here' : broken ? 'untrusted' : 'holds' }));
            var main = Object.assign(document.createElement('div'), { className: 'ec-entry-main' });
            main.appendChild(Object.assign(document.createElement('p'), { className: 'ec-meta',
                textContent: e.stamp.agent + ' · ' + String(e.stamp.serverTime).replace('T', ' ').slice(0, 19) }));
            main.appendChild(this.editing === i ? this.editor(e, i) : noteOf(e));
            if (e.others) {
                main.appendChild(Object.assign(document.createElement('p'), { className: 'ec-others',
                    textContent: e.others + (e.others === 1 ? ' other text was' : ' other texts were')
                        + ' stored for this entry by someone in the room. '
                        + (e.note !== null ? 'It does not match the seal, so it is ignored.' : '') }));
            }
            main.appendChild(sealOf(e));
            row.append(side, main, this.toolsFor(i));
            return row;
        }

        /** Inline rewrite of one entry: the "Edit a word" trick. */
        editor(e, i) {
            var self = this;
            var form = Object.assign(document.createElement('form'), { className: 'ec-edit' });
            var input = Object.assign(document.createElement('input'), { type: 'text', value: e.note || '', maxLength: MAX_NOTE_CHARS });
            input.setAttribute('aria-label', 'New text for entry ' + e.seq);
            var save = Object.assign(document.createElement('button'), { type: 'submit', className: 'btn btn--sm btn--primary', textContent: 'Save' });
            var cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--sm btn--ghost', textContent: 'Cancel' });
            form.addEventListener('submit', function (ev) { ev.preventDefault(); self.alter(i, input.value); });
            cancel.addEventListener('click', function () { self.editing = -1; self.render(); });
            form.append(input, save, cancel);
            return form;
        }

        toolsFor(i) {
            var self = this, seq = this.entries[i].seq;
            var tools = Object.assign(document.createElement('div'), { className: 'ec-entry-tools' });
            var add = function (label, aria, fn) {
                var b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--sm btn--ghost', textContent: label });
                b.setAttribute('aria-label', aria);
                b.addEventListener('click', fn);
                tools.appendChild(b);
            };
            add('Edit', 'Edit entry ' + seq, function () { self.edit(i); });
            add('Delete', 'Delete entry ' + seq, function () { self.remove(i); });
            if (i < this.entries.length - 1) add('Swap ↓', 'Swap entry ' + seq + ' with the next', function () { self.swap(i); });
            return tools;
        }

        /** The score, the tricks tried, and the verdict. */
        renderPlay() {
            var self = this;
            el('scoreAttempts').textContent = this.score.attempts;
            el('scoreFooled').textContent = this.score.fooled;
            TRICKS.forEach(function (t) {
                var item = el('trick-' + t);
                item.classList.toggle('is-tried', !!self.score.tried[t]);
                item.classList.toggle('is-played', !!self.played[t]);
            });
            var v = verdictFor(this.result, this.entries, this.tampered, (this.bundle && this.bundle.records) || []);
            el('verdict').setAttribute('data-state', v.state);
            el('verdictKicker').textContent = v.kicker;
            el('verdictTitle').textContent = v.title;
            el('verdictDetail').textContent = v.detail;
        }
    }

    /**
     * A storageGetList response's rows, as { seq: note }.
     *
     * storageGetList takes the key as a BARE STRING, not {storageKey}, and the
     * content of each row is base64-encoded JSON. Decode one layer only and a
     * full log reads as an empty one -- which looks exactly like a log nobody
     * has written to yet, so it fails silently. The single most expensive
     * mistake to make against this API.
     */
    function notesFrom(response) {
        var rows = [];
        if (response && response.status === 'success') {
            var body = response.data && response.data.data ? response.data.data : response.data;
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
                if (raw && typeof raw.seq === 'number' && typeof raw.note === 'string') {
                    (notes[raw.seq] = notes[raw.seq] || []).push({ note: raw.note, at: row.createdAt || '' });
                }
            } catch (_) { /* a row this client cannot read is skipped */ }
        });
        Object.keys(notes).forEach(function (k) {
            notes[k].sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
        });
        return notes;
    }

    /**
     * Which stored text is this entry's: the one that hashes to its seal.
     *
     * Storage is append-only and shared, so anyone in the room can store a text
     * under any entry number, including one not written yet. The page used to
     * take one by arrival order, so a text planted for entry 4 before its author
     * sealed it became entry 4: the honest entry showed the planted words and
     * Verify said "Caught at entry 4", blaming its author. The seal says which
     * text was sealed; any other is counted, shown as ignored, and never used.
     * With none matching, the oldest is shown, and Verify reports it, as before.
     */
    async function sealedNote(versions, contentHash) {
        for (var i = 0; i < versions.length; i++) {
            if (await sha256Text(versions[i].note) === contentHash) {
                return { note: versions[i].note, others: versions.length - 1 };
            }
        }
        return { note: versions.length ? versions[0].note : null, others: Math.max(0, versions.length - 1) };
    }

    const snapshot = (entries) => JSON.stringify(entries.map(function (e) { return [e.seq, e.note]; }));

    // textContent, never innerHTML: an entry is somebody else's text.
    function noteOf(e) {
        return Object.assign(document.createElement('p'), { className: 'ec-note',
            textContent: e.note === null ? '(sealed, but no text stored)' : e.note });
    }

    /** The seal: a colour fingerprint of the sealed hash, with both hashes on request. */
    function sealOf(e) {
        var seal = Object.assign(document.createElement('details'), { className: 'ec-seal' });
        var summary = document.createElement('summary');
        summary.append(fingerprint(e.contentHash), Object.assign(document.createElement('code'), { textContent: shortHash(e.contentHash) }));
        seal.appendChild(summary);
        var hashes = Object.assign(document.createElement('dl'), { className: 'ec-hashes' });
        [['content', e.contentHash], ['chain', e.chain]].forEach(function (pair) {
            hashes.appendChild(Object.assign(document.createElement('dt'), { textContent: pair[0] }));
            hashes.appendChild(Object.assign(document.createElement('dd'), { textContent: pair[1] }));
        });
        seal.appendChild(hashes);
        return seal;
    }

    document.addEventListener('DOMContentLoaded', function () {
        var app = new EvidenceChain();
        window.ecApp = app;

        el('appendBtn').addEventListener('click', function () { app.append(el('note').value.trim()); });
        el('seedBtn').addEventListener('click', function () { app.seedExamples(); });
        el('verifyBtn').addEventListener('click', function () { app.verify(); });
        el('reloadBtn').addEventListener('click', function () { app.reload(); });
        app.renderPlay();

        window.loadConnectionModal({
            localStoragePrefix: 'evchain_',
            channelPrefix: 'log-',
            title: 'Open an evidence log',
            collapsedTitle: 'Evidence Chain',
            partyLobby: {
                id: 'evidence-chain', start: 'Start a log', players: 'Works alone',
                tagline: 'Write a log the platform signs. Then try to change it without getting caught.',
                howTo: [
                    'Add a few entries, or three examples in one click.',
                    'Edit, delete or swap them in secret.',
                    'Press Verify, and see exactly where it broke.',
                ],
            },
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
