/**
 * Pulse — live questions and polls, with a history you can scrub.
 *
 * The primitive on show is **storage versioning**. This is the smallest live
 * *writer* of `storageAdd` / `storageGetList` on the site (Rewind only reads a
 * version list back; Gavel buries the same calls inside a much larger app, and
 * Evidence Chain uses them to weld the versions into a hash chain), so the poll
 * here deliberately does not keep a running total in
 * one overwritten value: every change appends a new
 * version, and the panel on the right reads them all back. A poll therefore has
 * a shape over time — you can see the moment the room changed its mind — which
 * a single mutable counter cannot express.
 *
 * The host owns the tally. Votes are addressed to the host rather than
 * broadcast, because UserConnectionBase relays anything sent with a plain
 * sendData() to every client before this app sees it: a vote everyone could
 * apply locally would be counted once per browser.
 */
(function () {
    'use strict';

    var POLL_SECS = 90;             // how long a poll stays open
    var POLL_KEY = 'pulse_poll';
    var Q_KEY = 'pulse_questions';
    var MAX_Q = 40;
    var REACT_GAP_MS = 700;         // one reaction per person per this long, at the host
    var REPLAY_STEP_MS = 450;
    var REACTIONS = { zap: 'Zap', hand: 'Hands up', trophy: 'Winner' };   // kind -> icon is the same name
    var SIM_PREFIX = 'Simulated ';
    var SIM_NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fen', 'Gus', 'Hal'];

    const isSimulated = (name) => String(name).indexOf(SIM_PREFIX) === 0;

    /** A reaction floats up the side of the poll and fades. Skipped when motion is reduced. */
    function floatReaction(kind, by) {
        var layer = document.getElementById('reactionLayer');
        if (!layer || !REACTIONS[kind]) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var bubble = UI.el('span', { class: 'reaction reaction--' + kind, title: by || '' }, [UI.iconNode(kind)]);
        bubble.style.left = (10 + Math.random() * 70) + '%';
        layer.appendChild(bubble);
        setTimeout(function () { bubble.remove(); }, 2600);
    }

    var LEAD_FLASH_MS = 2500;
    var HISTORY_SEALS = 'pulse-history';

    /** What a stored version's seal covers: the version itself, as stored. */
    function versionText(content) { return 'pulse|' + JSON.stringify(content); }

    /** A burst of colour from an element: the winner's bar, when the bell rings. */
    function confetti(el) {
        if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // On the page, over the element: the poll redraws every second and
        // would take a burst inside it away half-way through.
        var box = el.getBoundingClientRect();
        var burst = document.createElement('span');
        burst.className = 'poll-burst';
        burst.style.left = (box.left + box.width / 2) + 'px';
        burst.style.top = (box.top + box.height / 2) + 'px';
        burst.setAttribute('aria-hidden', 'true');
        var colours = ['#f43f5e', '#f59e0b', '#22c55e', '#06b6d4', '#8b5cf6', '#eab308'];
        for (var i = 0; i < 28; i++) {
            var bit = document.createElement('i');
            var a = (i / 28) * Math.PI * 2;
            bit.style.setProperty('--dx', Math.round(Math.cos(a) * (80 + (i % 3) * 40)) + 'px');
            bit.style.setProperty('--dy', Math.round(Math.sin(a) * (40 + (i % 4) * 18) - 20) + 'px');
            bit.style.background = colours[i % colours.length];
            burst.appendChild(bit);
        }
        document.body.appendChild(burst);
        setTimeout(function () { burst.remove(); }, 1300);
    }

    class Pulse extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'pulse_',
                customType: 'pulse',
                autoCreateDataChannel: false    // everything here travels on the channel
            });

            this.poll = null;         // { question, options: [{id,label}], votes: {name: optionId} }
            this.questions = [];      // [{ id, text, by, at, votes: [names], answered }]
            this.versions = [];       // newest first — what storageGetList gave us
            this.myVote = null;
            this.viewing = null;      // a version index while scrubbing the history
            this._reactAt = {};       // host: when each person last reacted
            this._replaying = null;   // the running replay, if any
        }

        // ---- lifecycle -------------------------------------------------------

        onConnect() {
            UI.toast('Connected to ' + this.channelName, 'success');
            this._setStatus('live', this.getUserCount() + ' in the room');
            // The host is the one that owns the stored state, so only it seeds.
            if (this.isHost()) this._hostSeed();
            this._loadFromStorage();
            this.render();
        }

        onDisconnect() { this._setStatus('off', 'Disconnected'); }
        onUserJoin() { this._syncPresence(); if (this.isHost()) this._hostBroadcast(); }
        onUserLeave() { this._syncPresence(); }
        onBecomeHost() {
            // Whoever inherits the room inherits the tally with it.
            UI.toast('You are hosting this room now', 'info');
            this._loadFromStorage();
        }

        _syncPresence() {
            this._setStatus('live', this.getUserCount() + ' in the room');
        }

        _setStatus(kind, text) {
            var pill = document.getElementById('statusPill');
            if (!pill) return;
            pill.className = 'pill-status is-' + kind;
            pill.querySelector('.pill-status__text').textContent = text;
        }

        // ---- messages --------------------------------------------------------

        onGameMessage(detail) {
            var data = detail && detail.data ? detail.data : detail;
            if (!data || !data.type) return;

            // Who really sent this. The payload's own `by` field is whatever
            // the sender typed, so tallying it let one person vote as many.
            //
            // The host also feeds its OWN actions through here directly, and a
            // locally injected message carries no transport identity — so an
            // absent sender means us, not an anonymous one.
            var from = this.senderOf(detail) || this.username;

            switch (data.type) {
                case 'state':
                    // Only the host's word counts for state. This used to ask
                    // only whether THIS tab was the host, so any guest could
                    // broadcast a poll ("HACKED: vote for Mal") and questions
                    // signed with anyone's name onto every other screen.
                    if (this.isHost() || from !== this._getHostName()) break;
                    this.poll = data.poll || null;
                    this.questions = data.questions || [];
                    this.versions = data.versions || this.versions;
                    this.myVote = this.poll && this.poll.votes ? this.poll.votes[this.username] || null : null;
                    if (this.poll && !this._clock) this._tick();
                    this.render();
                    break;

                case 'vote':
                    if (!this.isHost()) break;
                    this._hostVote(from, data.option);
                    break;

                case 'ask':
                    if (!this.isHost()) break;
                    this._hostAsk(from, data.text);
                    break;

                case 'upvote':
                    if (!this.isHost()) break;
                    this._hostUpvote(from, data.id);
                    break;

                // Moderation is the HOST's own action, not a request anybody
                // may make. isHost() only asks whether *this tab* is the host —
                // it says nothing about who sent the message, so a guest could
                // ask the host to take a question down and the host obliged.
                // The host feeds its own actions through here locally, where
                // there is no transport identity, so `from` is us.
                case 'answered':
                    if (!this.isHost() || from !== this.username) break;
                    this._hostAnswered(data.id);
                    break;

                case 'remove':
                    if (!this.isHost() || from !== this.username) break;
                    this._hostRemove(data.id);
                    break;

                // Reactions go to the host, which relays them to the room. A
                // relayed one counts only from the host itself, so nobody can
                // put words in somebody else's mouth by sending 'reaction'.
                case 'react':
                    if (!this.isHost()) break;
                    this._hostReact(from, data.kind);
                    break;

                case 'reaction':
                    if (this.isHost() || from !== this._getHostName()) break;
                    floatReaction(data.kind, data.by);
                    break;
            }
        }

        // ---- reactions, simulated voters, the replay -------------------------

        react(kind) {
            if (!REACTIONS[kind] || !this.connected) return;
            if (this.isHost()) this._hostReact(this.username, kind);
            else this._ask({ type: 'react', kind: kind });
        }

        /** Relay one reaction, at most one per person every REACT_GAP_MS: a crowd, not a flood. */
        _hostReact(by, kind) {
            if (!REACTIONS[kind] || !by) return;
            var now = Date.now();
            if (now - (this._reactAt[by] || 0) < REACT_GAP_MS) return;
            this._reactAt[by] = now;
            floatReaction(kind, by);
            this._say({ type: 'reaction', kind: kind, by: by }, '*');
        }

        /**
         * Host only, and local: there is no message that asks for it, so no
         * guest can stuff the ballot. Each simulated vote goes through the same
         * tally and appends a version like any other, which is what gives the
         * time machine something to replay when you are on your own.
         */
        simulate(count) {
            if (!this.isHost() || !this.open) return;
            var self = this, options = this.poll.options;
            SIM_NAMES.slice(0, count || 5).forEach(function (name, i) {
                setTimeout(function () {
                    // Lean towards the first option, so the lead tends to change hands.
                    var pick = options[Math.random() < 0.45 ? 0 : Math.floor(Math.random() * options.length)];
                    self._hostVote(SIM_PREFIX + name, pick.id);
                }, 700 * (i + 1));
            });
        }

        /** Walk the versions from the first to now, then come back to live. */
        replay() {
            if (this.versions.length < 2) { UI.toast('Cast a few votes first: there is nothing to replay yet', 'info'); return; }
            var self = this, token = {};
            this._replaying = token;
            var i = this.versions.length - 1;
            (function step() {
                if (self._replaying !== token) return;
                self.scrubTo(i, true);
                if (i-- > 0) setTimeout(step, REPLAY_STEP_MS);
                else setTimeout(function () { if (self._replaying === token) { self._replaying = null; self.scrubTo(null); } }, REPLAY_STEP_MS);
            })();
        }

        /**
         * Anything the host must police goes to the host, never to the room.
         *
         * Over the channel rather than the data channel: a vote is small, rare
         * and must not be lost, and the channel is the reliable path. The data
         * channel is for the things that are neither — Drop's file chunks.
         */
        _ask(payload) {
            if (this.isHost()) { this.onGameMessage({ data: payload }); return; }
            var host = this._getHostName(), self = this;
            this._say(payload, host || '*', function () {
                // Put the UI back where the truth is.
                if (payload.type === 'vote') {
                    self.myVote = null;
                    self.render();
                    UI.toast('That vote did not reach the room — try again', 'error', 5000);
                } else if (payload.type === 'ask') {
                    UI.toast('That question did not reach the room — try again', 'error', 5000);
                }
            });
        }

        /**
         * One place that knows how a Pulse message travels.
         *
         * sendCustomEventMessage REJECTS rather than throwing, so the
         * try/catch that used to be the whole of this function caught nothing:
         * a refused vote was highlighted optimistically in the UI and simply
         * never counted. The rejection arrives on the promise, and the caller
         * gets told.
         */
        _say(payload, to, onFail) {
            var sent;
            try {
                sent = this.sendCustomEventMessage(payload, to || '*');
            } catch (err) {
                console.warn('[Pulse] send failed:', err.message);
                if (onFail) onFail(err);
                return;
            }
            if (sent && sent.catch) {
                sent.catch(function (err) {
                    console.warn('[Pulse] send failed:', err && err.message);
                    if (onFail) onFail(err);
                });
            }
        }

        // ---- host: the tally -------------------------------------------------

        _hostSeed() {
            if (this.poll) return;
            this.poll = {
                question: 'Which primitive should the next demo prove?',
                options: [
                    { id: 'video', label: 'Video & screen share' },
                    { id: 'files', label: 'File transfer' },
                    { id: 'versions', label: 'Storage version history' }
                ],
                votes: {},
                closesAt: Date.now() + POLL_SECS * 1000
            };
            this._tick();
        }

        /** Whether the poll is still taking votes. */
        get open() {
            return !!(this.poll && (!this.poll.closesAt || Date.now() < this.poll.closesAt));
        }

        /**
         * Keep the countdown honest. One second is the right rate for a clock
         * people are watching, and the poll closing is a state change the whole
         * room reaches on its own — the host does not have to announce it,
         * because everybody has the same closing time.
         */
        _tick() {
            var self = this;
            clearInterval(this._clock);
            this._clock = setInterval(function () {
                if (!self.poll) return;
                var wasOpen = self._wasOpen;
                self._wasOpen = self.open;
                self.renderPoll();
                if (wasOpen && !self.open) {
                    self._announceResult();
                    // The final tally deserves a version of its own.
                    if (self.isHost()) self._hostCommit('closed');
                }
            }, 1000);
        }

        /**
         * Host only: ask something else.
         *
         * The question was hardcoded, so the only poll this demo could ever
         * run was the one it shipped with — which makes it a screenshot rather
         * than a demo. The host writes their own now; everyone else sees it
         * the moment it is committed.
         */
        async compose() {
            if (!this.isHost()) { UI.toast('Only the host sets the question', 'info'); return; }
            var q = await this._prompt('What should the room vote on?',
                this.poll ? this.poll.question : '');
            if (!q) return;

            var raw = await this._prompt('The options, one per line',
                this.poll ? this.poll.options.map(function (o) { return o.label; }).join('\n') : '');
            if (raw === null) return;
            var labels = String(raw).split('\n')
                .map(function (t) { return t.trim(); })
                .filter(Boolean)
                .slice(0, 8);
            if (labels.length < 2) { UI.toast('A poll needs at least two options', 'warning'); return; }

            this.poll = {
                question: String(q).slice(0, 160),
                options: labels.map(function (label, i) {
                    return { id: 'o' + i, label: label.slice(0, 80) };
                }),
                votes: {},
                closesAt: Date.now() + POLL_SECS * 1000
            };
            this.myVote = null;
            this._wasOpen = true;
            this._hostCommit('asked');
        }

        /** A one-line question, using whichever dialog this page has. */
        _prompt(title, value) {
            if (window.MiniGameUtils && MiniGameUtils.askFor) {
                return MiniGameUtils.askFor(title, value);
            }
            if (window.AppDialog && AppDialog.askFor) return AppDialog.askFor(title, value);
            return Promise.resolve(window.prompt(title, value));
        }

        /** Host only: run the same question again from zero. */
        reopen() {
            if (!this.isHost() || !this.poll) return;
            this.poll.votes = {};
            this.poll.closesAt = Date.now() + POLL_SECS * 1000;
            this.myVote = null;
            this._wasOpen = true;
            this._hostCommit('reopened');
        }

        _hostVote(by, option) {
            if (!this.poll || !by) return;
            // A vote after the bell is not a vote.
            if (!this.open) return;
            if (!this.poll.options.some(function (o) { return o.id === option; })) return;
            // One vote per person: changing your mind replaces it rather than
            // adding a second, which is what makes the version history honest.
            this.poll.votes[by] = option;
            this._hostCommit('vote by ' + by);
        }

        _hostAsk(by, text) {
            text = String(text || '').trim().slice(0, 240);
            if (!text) return;
            this.questions.unshift({
                id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                text: text, by: by || 'anonymous', at: Date.now(), votes: [], answered: false
            });
            if (this.questions.length > MAX_Q) this.questions.length = MAX_Q;
            this._hostCommit('question from ' + by, true);
        }

        _hostUpvote(by, id) {
            var q = this.questions.find(function (x) { return x.id === id; });
            if (!q || !by) return;
            var at = q.votes.indexOf(by);
            if (at === -1) q.votes.push(by); else q.votes.splice(at, 1);
            this._hostCommit('upvote', true);
        }

        /**
         * Take a question off the board.
         *
         * The host could cap how many questions arrived and mark one answered,
         * but not remove one — so a room with a disruptive question had no way
         * out except ending the session. Removal is host-only and final: it is
         * kept out of the versioned history too, because the point is that it
         * stops being visible to the room.
         */
        _hostRemove(id) {
            var q = this.questions.filter(function (x) { return x.id === id; })[0];
            if (!q) return;
            // Hidden rather than deleted. Moderation happens quickly and
            // sometimes wrongly, and a host who takes down the wrong question
            // had no way back — the room only ever sees questions that are not
            // hidden, and the host keeps the means to undo it.
            q.removed = !q.removed;
            this._hostCommit(q.removed ? 'removed' : 'restored', true);
        }

        _hostAnswered(id) {
            var q = this.questions.find(function (x) { return x.id === id; });
            if (!q) return;
            q.answered = !q.answered;
            this._hostCommit('answered', true);
        }

        /**
         * Append a version and tell the room.
         *
         * `storageAdd` rather than `storagePut`: the point of this app is that
         * the previous values are still there afterwards.
         */
        _hostCommit(why, questionsToo) {
            var self = this;
            var tallies = this._tally();
            var content = { poll: this.poll, tallies: tallies, why: why, at: Date.now() };
            // Sealed (js/seals.js), so the history can tell a version the host
            // wrote from one anybody in the room appended to the same key.
            Seals.seal(this.channel, HISTORY_SEALS, 'version', versionText(content));

            this.channel.storageAdd({
                storageKey: POLL_KEY,
                content: content,
                encrypted: false,
                metadata: { description: 'Pulse poll — ' + why }
            }, function (res) {
                if (!res || res.status !== 'success') {
                    console.warn('[Pulse] storageAdd failed:', res && res.statusMessage);
                    UI.toast('Could not save that vote', 'error');
                    return;
                }
                self._loadVersions();
            });

            if (questionsToo) {
                this.channel.storagePut({
                    storageKey: Q_KEY,
                    content: { questions: this.questions },
                    encrypted: false
                }, function () { /* the room already has them from the broadcast */ });
            }

            this._hostBroadcast();
            this.render();
        }

        _hostBroadcast() {
            if (!this.isHost()) return;
            this._say({
                type: 'state', poll: this.poll, questions: this.questions, versions: this.versions
            }, '*');
        }

        _tally() {
            var counts = {};
            var self = this;
            (this.poll ? this.poll.options : []).forEach(function (o) { counts[o.id] = 0; });
            Object.keys(this.poll ? this.poll.votes : {}).forEach(function (name) {
                var pick = self.poll.votes[name];
                if (counts[pick] !== undefined) counts[pick]++;
            });
            return counts;
        }

        // ---- storage ---------------------------------------------------------

        _loadFromStorage() {
            var self = this;
            this.channel.storageRead(Q_KEY).then(function (data) {
                if (data && Array.isArray(data.questions)) {
                    self.questions = data.questions;
                    self.render();
                }
            }, function (e) { console.warn('[Pulse] could not read the questions:', e.message); });
            this._loadVersions();
        }

        /**
         * Unwrap one stored version.
         *
         * A version written with `encrypted: false` — which is what Pulse uses,
         * because the point of the app is that you can see the history — comes
         * back with its `content` as BASE64 of the JSON, not as the object that
         * went in. Reading `row.content.tallies` therefore yielded undefined on
         * every row, and the version panel rendered a full history with every
         * tally empty. (Storage written with `encrypted: true` is decrypted and
         * parsed by the SDK and arrives as an object, which is why the other
         * apps that read storage are unaffected.)
         */
        _decodeVersion(row) {
            var raw = (row && row.content !== undefined) ? row.content : row;
            if (raw && typeof raw === 'object') return raw;
            if (typeof raw !== 'string') return null;
            try {
                var binary = atob(raw);
                var bytes = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return JSON.parse(new TextDecoder().decode(bytes));
            } catch (e) { /* not base64 JSON — fall through */ }
            try { return JSON.parse(raw); } catch (e) { return null; }
        }

        /** Every version of the poll, newest first — the whole point of Pulse. */
        _loadVersions() {
            var self = this;
            // Reads overlap when votes arrive quickly, and their answers can come
            // back out of order: an older, shorter list arriving last would
            // overwrite a newer one (on production, five votes read back as
            // three versions). Only the newest read is believed.
            var ticket = this._versionsTicket = (this._versionsTicket || 0) + 1;
            // The key is passed as a string here, unlike put/get/add which take options.
            this.channel.storageGetList(POLL_KEY, function (res) {
                if (ticket !== self._versionsTicket) return;
                if (!res || res.status !== 'success') return;
                var rows = res.data && res.data.data ? res.data.data : res.data;
                if (!Array.isArray(rows)) rows = rows && rows.versions ? rows.versions : [];
                Seals.read(self.channel, HISTORY_SEALS).then(function (seals) {
                    if (ticket !== self._versionsTicket) return;
                    return self._signedVersions(rows, seals).then(function (kept) {
                        if (ticket !== self._versionsTicket) return;
                        self._applyVersions(kept);
                    });
                });
            });
        }

        /**
         * Only versions somebody sealed, each with who sealed it. The key is
         * shared and append-only, so anyone in the room could append a version
         * ("HACKED: Mal wins") and the time machine replayed it as history.
         * An unsealed version is counted and left out; a sealed one says whose.
         */
        async _signedVersions(rows, seals) {
            var kept = [];
            this.unsignedVersions = 0;
            for (var i = 0; i < rows.length; i++) {
                var body = this._decodeVersion(rows[i]);
                var by = body ? await Seals.who(seals, 'version', versionText(body)) : null;
                if (!by) { this.unsignedVersions++; continue; }
                kept.push({ row: rows[i], body: body, by: by });
            }
            return kept;
        }

        _applyVersions(kept) {
            var self = this;
            self.versions = kept.map(function (k, i) {
                return {
                    v: kept.length - i,
                    at: (k.body && k.body.at) || k.row.createdAt || k.row.updatedAt || null,
                    tallies: (k.body && k.body.tallies) || {},
                    why: (k.body && k.body.why) || '',
                    by: k.by
                };
            });
            // Newest first, however the server chose to order them.
            self.versions.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
            self.versions.forEach(function (row, i) { row.v = self.versions.length - i; });

            // A new host picks the poll up from the newest SIGNED version only.
            if (self.isHost() && !self.poll) {
                var newest = kept.length ? kept[0].body : null;
                if (newest && newest.poll) self.poll = newest.poll;
            }
            self.renderVersions();
            self._hostBroadcast();
        }

        // ---- actions from this browser --------------------------------------

        vote(optionId) {
            if (!this.open) { UI.toast('This poll has closed', 'info'); return; }
            this.myVote = optionId;
            this._ask({ type: 'vote', by: this.username, option: optionId });
            this.render();
        }

        ask(text) {
            if (!String(text || '').trim()) return;
            this._ask({ type: 'ask', by: this.username, text: text });
        }

        upvote(id) { this._ask({ type: 'upvote', by: this.username, id: id }); }

        /**
         * Look at the poll as it stood at a past version, or come back to now.
         * Scrubbing is local: it changes what you are looking at, never what
         * the room has recorded.
         */
        scrubTo(index, replaying) {
            if (!replaying) this._replaying = null;    // a hand on the slider stops the replay
            this.viewing = (index === null || index === 0) ? null : index;
            this.renderPoll();
            this.renderVersions();
        }
        markAnswered(id) { this._ask({ type: 'answered', id: id }); }

        /** Host only — the button is not rendered for anyone else. */
        removeQuestion(id) { this._ask({ type: 'remove', id: id }); }

        // ---- rendering -------------------------------------------------------

        render() {
            this.renderPoll();
            this.renderQuestions();
            this.renderVersions();
        }

        renderPoll() {
            var host = document.getElementById('poll');
            if (!host) return;
            if (!this.poll) {
                host.replaceChildren(UI.el('p', { class: 'sdk-note' }, 'Waiting for the host to open a poll.'));
                return;
            }

            // Scrubbing shows a past version's tally in place of the live one,
            // which is the whole reason for appending versions rather than
            // overwriting a counter.
            var past = this.viewing !== null ? this.versions[this.viewing] : null;
            var counts = past ? past.tallies : this._tally();
            var total = Object.keys(counts).reduce(function (n, k) { return n + (counts[k] || 0); }, 0);
            var open = this.open;

            var title = UI.el('div', { class: 'poll__title' }, [
                UI.el('h2', { class: 'poll__q' }, this.poll.question),
                this._ring(past, open)
            ]);
            host.replaceChildren(this._pollHead(past, open, total), title,
                UI.el('div', { class: 'poll__options' }, this._pollBars(counts, total, past, open)));
            if (!past && !open && total) host.appendChild(this._resultBanner(counts, total));
        }

        /**
         * Who won, in words: the option and its share, or the options that
         * tied. Shown under a closed poll; the bell plays it with confetti once.
         */
        _result(counts, total) {
            var max = Math.max.apply(null, this.poll.options.map(function (o) { return counts[o.id] || 0; }).concat([0]));
            var top = this.poll.options.filter(function (o) { return max && (counts[o.id] || 0) === max; });
            if (!top.length) return null;
            return {
                ids: top.map(function (o) { return o.id; }),
                text: top.length === 1
                    ? top[0].label + ' wins, with ' + max + ' of ' + total + (total === 1 ? ' vote' : ' votes')
                        + ' (' + Math.round(100 * max / total) + '%)'
                    : 'A tie: ' + top.map(function (o) { return o.label; }).join(' and ') + ', ' + max + ' each'
            };
        }

        _resultBanner(counts, total) {
            var r = this._result(counts, total);
            return UI.el('div', { class: 'poll__result', role: 'status' }, [
                UI.el('span', { class: 'poll__result-icon', 'aria-hidden': 'true' }, r && r.ids.length === 1 ? '🏆' : '🤝'),
                UI.el('span', {}, r ? r.text : 'No votes')
            ]);
        }

        /** The bell: every screen reaches it on its own, from the same closing time. */
        _announceResult() {
            var counts = this._tally();
            var total = Object.keys(counts).reduce(function (n, k) { return n + counts[k]; }, 0);
            var r = total ? this._result(counts, total) : null;
            UI.toast(r ? r.text : 'The poll has closed with no votes', 'info', 5000);
            this.renderPoll();
            if (!r || this.viewing !== null) return;
            r.ids.forEach(function (id) {
                var bar = document.querySelector('.poll-option[data-option="' + CSS.escape(id) + '"]');
                if (bar) confetti(bar);
            });
        }

        /** Live / closed / a past version, the count, and the host's buttons. */
        _pollHead(past, open, total) {
            var badge = past
                ? UI.el('span', { class: 'badge' }, 'v' + past.v)
                : open
                    ? UI.el('span', { class: 'badge badge--danger' }, 'Live')
                    : UI.el('span', { class: 'badge badge--warning' }, 'Closed');
            var simulated = Object.keys(this.poll.votes || {}).filter(isSimulated).length;
            var head = UI.el('div', { class: 'poll__head' }, [
                badge,
                UI.el('span', { class: 'poll__meta' }, total + (total === 1 ? ' vote' : ' votes')
                    + (!past && simulated ? ' (' + simulated + ' simulated)' : '')),
                UI.el('span', { class: 'poll__meta' }, past ? UI.fmtRelative(past.at) : open ? 'closes in ' + this._left() : 'final result'),
                UI.el('span', { class: 'poll__meta poll__meta--right' }, 'v' + (this.versions.length || 0))
            ]);
            var button = function (attr, label) {
                var attrs = { type: 'button', class: 'btn btn--ghost btn--sm' };
                attrs[attr] = '1';
                head.appendChild(UI.el('button', attrs, label));
            };
            if (past) button('data-live', 'Back to live');
            else if (!open && this.isHost()) button('data-reopen', 'Run it again');
            // The host can always write a new question — a demo whose only
            // poll is the one it shipped with is a screenshot.
            if (!past && this.isHost()) button('data-compose', open ? 'Ask something else' : 'New question');
            if (!past && open && this.isHost()) button('data-simulate', 'Add 5 simulated votes');
            return head;
        }

        _pollBars(counts, total, past, open) {
            var self = this;
            var max = Math.max.apply(null, this.poll.options.map(function (o) { return counts[o.id] || 0; }).concat([0]));
            var leaders = this.poll.options.filter(function (o) { return max && (counts[o.id] || 0) === max; }).length;
            // A new sole leader, live: say so for a moment. Never while scrubbing,
            // where the lead changing is the past, not news.
            var leaderNow = leaders === 1 ? this.poll.options.filter(function (o) { return (counts[o.id] || 0) === max; })[0].id : null;
            var tookLead = !past && open && leaderNow && this._leader && leaderNow !== this._leader ? leaderNow : null;
            if (!past) this._leader = leaderNow || this._leader;
            if (tookLead) { this._tookLeadAt = Date.now(); this._tookLead = tookLead; }
            var flash = this._tookLead && Date.now() - (this._tookLeadAt || 0) < LEAD_FLASH_MS ? this._tookLead : null;
            return this.poll.options.map(function (opt, i) {
                var n = counts[opt.id] || 0;
                var pct = total ? Math.round((n / total) * 100) : 0;
                var mine = !past && self.myVote === opt.id;
                var leads = max > 0 && n === max && leaders === 1;
                return UI.el('button', {
                    type: 'button',
                    class: 'poll-option poll-option--c' + (i % 6) + (mine ? ' is-mine' : '') + (leads ? ' is-leading' : '')
                        + ((past || !open) ? ' is-shut' : '') + (!past && flash === opt.id ? ' took-lead' : '')
                        + (!past && !open && n === max && max > 0 ? ' is-winner' : ''),
                    'data-option': opt.id,
                    disabled: (past || !open) ? true : null
                }, [
                    UI.el('span', { class: 'poll-option__row' }, [
                        UI.el('span', { class: 'poll-option__label' }, opt.label),
                        leads ? UI.el('span', { class: 'poll-option__lead' }, !past && !open ? 'Winner' : !past && flash === opt.id ? 'New leader!' : 'Leading') : '',
                        UI.el('span', { class: 'poll-option__n' }, n + ' · ' + pct + '%')
                    ]),
                    UI.el('span', { class: 'poll-option__track' }, [
                        UI.el('span', { class: 'poll-option__fill', style: 'width:' + pct + '%' })
                    ])
                ]);
            });
        }

        /** The countdown as a ring: the share of the poll's time still left. */
        _ring(past, open) {
            var left = this.poll.closesAt ? Math.max(0, this.poll.closesAt - Date.now()) : 0;
            var share = past || !open ? 0 : Math.min(1, left / (POLL_SECS * 1000));
            var ring = UI.el('span', { class: 'poll__ring', role: 'img',
                'aria-label': past ? 'A past version' : open ? this._left() + ' left' : 'Closed' }, [
                UI.el('span', { class: 'poll__ring-text' }, past ? 'v' + past.v : open ? this._left() : 'Done')
            ]);
            ring.style.setProperty('--left', (share * 100).toFixed(1) + '%');
            return ring;
        }

        /** How long the poll has left, in words a clock can show. */
        _left() {
            var ms = Math.max(0, (this.poll.closesAt || 0) - Date.now());
            var secs = Math.round(ms / 1000);
            if (secs >= 60) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
            return secs + 's';
        }

        renderQuestions() {
            var host = document.getElementById('questions');
            if (!host) return;

            if (!this.questions.length) {
                host.replaceChildren(UI.el('div', { class: 'sdk-empty' }, [
                    UI.iconNode('message'),
                    UI.el('p', {}, 'No questions yet. Ask the first one.')
                ]));
                return;
            }

            var self = this;
            // A hidden question is invisible to the room and still visible to
            // the host, who is the only person who can put it back.
            var visible = this.questions.filter(function (q) {
                return !q.removed || self.isHost();
            });
            var sorted = visible.slice().sort(function (a, b) {
                return (b.votes.length - a.votes.length) || (b.at - a.at);
            });

            host.replaceChildren.apply(host, sorted.map(function (q) {
                var mine = q.votes.indexOf(self.username) !== -1;
                var row = UI.el('article', {
                    class: 'q' + (q.answered ? ' is-answered' : '') + (q.removed ? ' is-removed' : '')
                }, [
                    UI.el('button', {
                        type: 'button',
                        class: 'q__vote' + (mine ? ' is-mine' : ''),
                        'data-upvote': q.id,
                        'aria-label': 'Upvote'
                    }, [
                        UI.iconNode('chevron-up', 'icon--sm'),
                        UI.el('span', { class: 'q__n' }, String(q.votes.length))
                    ]),
                    UI.el('div', { class: 'q__body' }, [
                        UI.el('p', { class: 'q__text' }, q.text),
                        UI.el('span', { class: 'q__meta' }, q.by + ' · ' + UI.fmtRelative(q.at))
                    ])
                ]);

                if (q.answered) {
                    row.appendChild(UI.el('span', { class: 'badge badge--success' }, 'Answered'));
                } else if (self.isHost()) {
                    row.appendChild(UI.el('button', {
                        type: 'button', class: 'btn btn--ghost btn--sm', 'data-answered': q.id
                    }, 'Mark answered'));
                }
                if (self.isHost()) {
                    row.appendChild(UI.el('button', {
                        type: 'button', class: 'btn btn--ghost btn--sm', 'data-remove': q.id,
                        'aria-label': q.removed
                            ? 'Put this question back on the board'
                            : 'Take this question off the board'
                    }, q.removed ? 'Put back' : 'Remove'));
                }
                return row;
            }));
        }

        renderVersions() {
            var host = document.getElementById('versions');
            if (!host) return;

            if (!this.versions.length) {
                host.replaceChildren(UI.el('p', { class: 'sdk-note' },
                    'Each vote appends a version here. Cast one to start the history.'));
                return;
            }

            var self = this;
            var self2 = this;
            var rows = this.versions.slice(0, 12).map(function (row, i) {
                var order = (self.poll ? self.poll.options : []).map(function (o) {
                    return row.tallies[o.id] || 0;
                }).join(' / ');
                return UI.el('button', {
                    type: 'button',
                    class: 'ver' + (i === 0 ? ' is-now' : '') + (self2.viewing === i ? ' is-viewing' : ''),
                    'data-version': String(i)
                }, [
                    UI.el('span', { class: 'ver__dot' }),
                    UI.el('span', { class: 'ver__v' }, 'v' + row.v),
                    // Who wrote it: on hover always, in the row only when it was
                    // not the room's host now (the case worth noticing).
                    UI.el('span', { class: 'ver__when', title: row.by ? 'Written by ' + row.by + ', signed' : '' },
                        (i === 0 ? 'now' : UI.fmtRelative(row.at)) + (row.by && row.by !== self._getHostName() ? ' · ' + row.by : '')),
                    UI.el('span', { class: 'ver__tally' }, order)
                ]);
            });

            // The scrub bar: drag from the first version to the latest and the
            // poll above replays what the room thought at that moment.
            var last = this.versions.length - 1;
            var scrub = UI.el('div', { class: 'scrub' }, [
                UI.el('span', { class: 'scrub__end' }, 'v' + (this.versions[last] ? this.versions[last].v : 1)),
                UI.el('input', {
                    type: 'range', class: 'scrub__range', id: 'scrubRange',
                    min: '0', max: String(Math.max(0, last)),
                    value: String(this.viewing === null ? 0 : (last - this.viewing)),
                    'aria-label': 'Scrub the poll history'
                }),
                UI.el('span', { class: 'scrub__end scrub__end--now' },
                    'v' + (this.versions[0] ? this.versions[0].v : 1))
            ]);

            var replay = UI.el('button', { type: 'button', class: 'btn btn--sm ver-replay', 'data-replay': '1',
                disabled: this.versions.length < 2 ? true : null }, [UI.iconNode('timer', 'icon--sm'), ' Replay the vote']);
            var ignored = this.unsignedVersions
                ? [UI.el('p', { class: 'sdk-note ver-ignored' }, this.unsignedVersions + (this.unsignedVersions === 1 ? ' unsigned version' : ' unsigned versions')
                    + ' in storage, not written by anybody the platform can name, left out of the history.')] : [];
            host.replaceChildren.apply(host, [replay].concat(rows, [scrub], ignored));
        }
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

    /**
     * Big screen: the poll alone, large, with the room's code and a QR to scan,
     * for a projector or a TV at the front of a room. Esc comes back.
     */
    function present(on) {
        document.body.classList.toggle('is-presenting', on);
        document.getElementById('presentBtn').setAttribute('aria-pressed', String(on));
        if (!on || !app) return;
        var code = window.PartyCode && PartyCode.codeFor('pulse', app.channelName, app.channelPassword);
        var url = code ? location.origin + location.pathname + '?code=' + code : null;
        document.getElementById('presentCode').textContent = code ? PartyCode.format(code) : 'Use Invite to share this room';
        var qr = document.getElementById('presentQr');
        qr.replaceChildren();
        if (url && typeof QRCode !== 'undefined') {
            new QRCode(qr, { text: url, width: 176, height: 176, colorDark: '#0b1120', colorLight: '#ffffff' });
        }
        qr.hidden = !url;
    }

    function wire() {
        var share = document.getElementById('shareBtn');
        if (share) share.addEventListener('click', invite);
        document.getElementById('presentBtn').addEventListener('click', function () {
            present(!document.body.classList.contains('is-presenting'));
        });
        document.getElementById('presentExit').addEventListener('click', function () { present(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && document.body.classList.contains('is-presenting')) present(false);
        });
        document.getElementById('reactions').addEventListener('click', function (e) {
            var b = e.target.closest('[data-react]');
            if (b && app) app.react(b.getAttribute('data-react'));
        });

        document.getElementById('poll').addEventListener('click', function (e) {
            if (!app) return;
            if (e.target.closest('[data-live]')) { app.scrubTo(null); return; }
            if (e.target.closest('[data-reopen]')) { app.reopen(); return; }
            if (e.target.closest('[data-compose]')) { app.compose(); return; }
            if (e.target.closest('[data-simulate]')) { app.simulate(5); return; }
            var btn = e.target.closest('[data-option]');
            if (btn && !btn.disabled) app.vote(btn.getAttribute('data-option'));
        });

        var versions = document.getElementById('versions');
        versions.addEventListener('click', function (e) {
            if (e.target.closest('[data-replay]') && app) { app.replay(); return; }
            var row = e.target.closest('[data-version]');
            if (row && app) app.scrubTo(Number(row.getAttribute('data-version')));
        });
        // Dragging the bar walks backwards through the versions.
        versions.addEventListener('input', function (e) {
            if (!app || !e.target.matches('.scrub__range')) return;
            var last = app.versions.length - 1;
            app.scrubTo(last - Number(e.target.value));
        });

        document.getElementById('questions').addEventListener('click', function (e) {
            var up = e.target.closest('[data-upvote]');
            if (up && app) { app.upvote(up.getAttribute('data-upvote')); return; }
            var rm = e.target.closest('[data-remove]');
            if (rm && app) { app.removeQuestion(rm.getAttribute('data-remove')); return; }
            var ans = e.target.closest('[data-answered]');
            if (ans && app) app.markAnswered(ans.getAttribute('data-answered'));
        });

        var form = document.getElementById('askForm');
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var input = document.getElementById('askInput');
            if (app) app.ask(input.value);
            input.value = '';
        });
    }

    async function connect(username, channel, password) {
        try {
            app = new Pulse();
            window.pulseApp = app;

            // Attach before connecting, so the connect-time calls are on the
            // panel too rather than only whatever happens afterwards.
            var wireMount = document.getElementById('wirePanel');
            if (window.SdkWire && wireMount) {
                window.pulseWire = window.SdkWire.attach(app, {
                    mount: wireMount,
                    note: 'Every row is a real call this page just made. An untargeted ' +
                          'send from a guest reaches the host, not the room — the host ' +
                          'decides what to relay.'
                });
            }

            await app.connect({ username: username, channelName: channel, channelPassword: password });
            app.start();
            document.getElementById('roomName').textContent = channel;
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            if (typeof window.encodeChannelAuth === 'function') {
                var encoded = window.encodeChannelAuth(channel, password, null);
                if (encoded) history.replaceState(null, '', '#' + encoded);
            }
        } catch (err) {
            console.error('[Pulse] connect failed:', err);
            if (window.ConnectionModal) ConnectionModal.fail(err);
            UI.toast('Could not connect: ' + err.message, 'error', 5000);
            app = null;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        wire();
        window.loadConnectionModal({
            localStoragePrefix: 'pulse_',
            channelPrefix: 'pulse-',
            title: 'Join a Pulse room',
            collapsedTitle: 'Pulse',
            partyLobby: {
                id: 'pulse', start: 'Start a poll', players: 'Any size room · works alone',
                tagline: 'Ask the room anything. Watch the votes arrive, then scrub back through how they moved.',
                howTo: [
                    'Ask a question, then put it on the big screen with its code.',
                    'Everyone votes and reacts from their own phone. On your own? Add simulated votes.',
                    'Press Replay and watch the vote happen again, version by version.',
                ],
            },
            onConnect: connect
        });
        if (window.MiniGameUtils && MiniGameUtils.processSharedLinkAndAutoConnect) {
            MiniGameUtils.processSharedLinkAndAutoConnect({
                gameName: 'Pulse', storagePrefix: 'pulse_',
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
