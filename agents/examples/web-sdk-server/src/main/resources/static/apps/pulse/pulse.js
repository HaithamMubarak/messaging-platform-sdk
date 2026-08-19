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

            switch (data.type) {
                case 'state':
                    // Only the host's word counts for state.
                    if (this.isHost()) break;
                    this.poll = data.poll || null;
                    this.questions = data.questions || [];
                    this.versions = data.versions || this.versions;
                    this.myVote = this.poll && this.poll.votes ? this.poll.votes[this.username] || null : null;
                    this.render();
                    break;

                case 'vote':
                    if (!this.isHost()) break;
                    this._hostVote(data.by, data.option);
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
            var host = this._getHostName();
            this._say(payload, host || '*');
        }

        /** One place that knows how a Pulse message travels. */
        _say(payload, to) {
            try {
                this.sendCustomEventMessage(payload, to || '*');
            } catch (err) {
                console.warn('[Pulse] send failed:', err.message);
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
                votes: {}
            };
        }

        _hostVote(by, option) {
            if (!this.poll || !by) return;
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
            this.myVote = optionId;
            this._ask({ type: 'vote', by: this.username, option: optionId });
            this.render();
        }

        ask(text) {
            if (!String(text || '').trim()) return;
            this._ask({ type: 'ask', by: this.username, text: text });
        }

        upvote(id) { this._ask({ type: 'upvote', by: this.username, id: id }); }
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

            var counts = this._tally();
            var total = Object.keys(counts).reduce(function (n, k) { return n + counts[k]; }, 0);
            var self = this;

            var head = UI.el('div', { class: 'poll__head' }, [
                UI.el('span', { class: 'badge badge--danger' }, 'Live'),
                UI.el('span', { class: 'poll__meta' }, total + (total === 1 ? ' vote' : ' votes')),
                UI.el('span', { class: 'poll__meta poll__meta--right' },
                    'v' + (this.versions.length || 0))
            ]);

            var bars = this.poll.options.map(function (opt) {
                var n = counts[opt.id] || 0;
                var pct = total ? Math.round((n / total) * 100) : 0;
                var mine = self.myVote === opt.id;

                return UI.el('button', {
                    type: 'button',
                    class: 'poll-option' + (mine ? ' is-mine' : ''),
                    'data-option': opt.id
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
            var rows = this.versions.slice(0, 12).map(function (row, i) {
                var order = (self.poll ? self.poll.options : []).map(function (o) {
                    return row.tallies[o.id] || 0;
                }).join(' / ');
                return UI.el('div', { class: 'ver' + (i === 0 ? ' is-now' : '') }, [
                    UI.el('span', { class: 'ver__dot' }),
                    UI.el('span', { class: 'ver__v' }, 'v' + row.v),
                    UI.el('span', { class: 'ver__when' }, i === 0 ? 'now' : UI.fmtRelative(row.at)),
                    UI.el('span', { class: 'ver__tally' }, order)
                ]);
            });
            host.replaceChildren.apply(host, rows);
        }
    }

    // ---- boot ---------------------------------------------------------------

    var app = null;

    function wire() {
        document.getElementById('poll').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-option]');
            if (btn && app) app.vote(btn.getAttribute('data-option'));
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
