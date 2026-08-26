/**
 * Pulse — live questions and polls, with a history you can scrub.
 *
 * The primitive on show is **storage versioning**. Nothing else on the site
 * uses `storageAdd` / `storageGetList`, so the poll here deliberately does not
 * keep a running total in one overwritten value: every change appends a new
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
                    // Only the host's word counts for state.
                    if (this.isHost()) break;
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
                    this._hostAsk(data.by, data.text);
                    break;

                case 'upvote':
                    if (!this.isHost()) break;
                    this._hostUpvote(data.by, data.id);
                    break;

                case 'answered':
                    if (!this.isHost()) break;
                    this._hostAnswered(data.id);
                    break;
            }
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
                    UI.toast('The poll has closed', 'info');
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

            this.channel.storageAdd({
                storageKey: POLL_KEY,
                content: { poll: this.poll, tallies: tallies, why: why, at: Date.now() },
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
            this.channel.storageGet({ storageKey: Q_KEY }, function (res) {
                var data = res && res.status === 'success' ? (res.data && res.data.data ? res.data.data : res.data) : null;
                if (data && Array.isArray(data.questions)) {
                    self.questions = data.questions;
                    self.render();
                }
            });
            this._loadVersions();
        }

        /** Every version of the poll, newest first — the whole point of Pulse. */
        _loadVersions() {
            var self = this;
            // The key is passed as a string here, unlike put/get/add which take options.
            this.channel.storageGetList(POLL_KEY, function (res) {
                if (!res || res.status !== 'success') return;
                var rows = res.data && res.data.data ? res.data.data : res.data;
                if (!Array.isArray(rows)) rows = rows && rows.versions ? rows.versions : [];

                self.versions = rows.map(function (row, i) {
                    var body = row && row.content ? row.content : row;
                    return {
                        v: rows.length - i,
                        at: (body && body.at) || row.createdAt || row.updatedAt || null,
                        tallies: (body && body.tallies) || {},
                        why: (body && body.why) || ''
                    };
                });
                // Newest first, however the server chose to order them.
                self.versions.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
                self.versions.forEach(function (row, i) { row.v = self.versions.length - i; });

                if (self.isHost() && !self.poll) {
                    var newest = rows.length ? (rows[0].content || rows[0]) : null;
                    if (newest && newest.poll) self.poll = newest.poll;
                }
                self.renderVersions();
                self._hostBroadcast();
            });
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
        scrubTo(index) {
            this.viewing = (index === null || index === 0) ? null : index;
            this.renderPoll();
            this.renderVersions();
        }
        markAnswered(id) { this._ask({ type: 'answered', id: id }); }

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
            var self = this;
            var open = this.open;

            var badge = past
                ? UI.el('span', { class: 'badge' }, 'v' + past.v)
                : open
                    ? UI.el('span', { class: 'badge badge--danger' }, 'Live')
                    : UI.el('span', { class: 'badge badge--warning' }, 'Closed');

            var when = past
                ? UI.fmtRelative(past.at)
                : open ? 'closes in ' + this._left() : 'final result';

            var head = UI.el('div', { class: 'poll__head' }, [
                badge,
                UI.el('span', { class: 'poll__meta' }, total + (total === 1 ? ' vote' : ' votes')),
                UI.el('span', { class: 'poll__meta' }, when),
                UI.el('span', { class: 'poll__meta poll__meta--right' },
                    'v' + (this.versions.length || 0))
            ]);

            if (past) {
                head.appendChild(UI.el('button', {
                    type: 'button', class: 'btn btn--ghost btn--sm', 'data-live': '1'
                }, 'Back to live'));
            } else if (!open && this.isHost()) {
                head.appendChild(UI.el('button', {
                    type: 'button', class: 'btn btn--ghost btn--sm', 'data-reopen': '1'
                }, 'Run it again'));
            }

            // The host can always write a new question — a demo whose only
            // poll is the one it shipped with is a screenshot.
            if (!past && this.isHost()) {
                head.appendChild(UI.el('button', {
                    type: 'button', class: 'btn btn--ghost btn--sm', 'data-compose': '1'
                }, open ? 'Ask something else' : 'New question'));
            }

            var bars = this.poll.options.map(function (opt) {
                var n = counts[opt.id] || 0;
                var pct = total ? Math.round((n / total) * 100) : 0;
                var mine = !past && self.myVote === opt.id;

                return UI.el('button', {
                    type: 'button',
                    class: 'poll-option' + (mine ? ' is-mine' : '') + ((past || !open) ? ' is-shut' : ''),
                    'data-option': opt.id,
                    disabled: (past || !open) ? true : null
                }, [
                    UI.el('span', { class: 'poll-option__row' }, [
                        UI.el('span', { class: 'poll-option__label' }, opt.label),
                        UI.el('span', { class: 'poll-option__n' }, n + ' · ' + pct + '%')
                    ]),
                    UI.el('span', { class: 'poll-option__track' }, [
                        UI.el('span', { class: 'poll-option__fill', style: 'width:' + pct + '%' })
                    ])
                ]);
            });

            host.replaceChildren(head, UI.el('h2', { class: 'poll__q' }, this.poll.question),
                UI.el('div', { class: 'poll__options' }, bars));
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
            var sorted = this.questions.slice().sort(function (a, b) {
                return (b.votes.length - a.votes.length) || (b.at - a.at);
            });

            host.replaceChildren.apply(host, sorted.map(function (q) {
                var mine = q.votes.indexOf(self.username) !== -1;
                var row = UI.el('article', { class: 'q' + (q.answered ? ' is-answered' : '') }, [
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
                    UI.el('span', { class: 'ver__when' }, i === 0 ? 'now' : UI.fmtRelative(row.at)),
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

            host.replaceChildren.apply(host, rows.concat([scrub]));
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

    function wire() {
        var share = document.getElementById('shareBtn');
        if (share) share.addEventListener('click', invite);

        document.getElementById('poll').addEventListener('click', function (e) {
            if (!app) return;
            if (e.target.closest('[data-live]')) { app.scrubTo(null); return; }
            if (e.target.closest('[data-reopen]')) { app.reopen(); return; }
            if (e.target.closest('[data-compose]')) { app.compose(); return; }
            var btn = e.target.closest('[data-option]');
            if (btn && !btn.disabled) app.vote(btn.getAttribute('data-option'));
        });

        var versions = document.getElementById('versions');
        versions.addEventListener('click', function (e) {
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
