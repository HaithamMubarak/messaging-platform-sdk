/**
 * SponsorPulse — the attendee side.
 *
 * Everything an attendee needs is in the link they scanned: which room, and the
 * key to it. So there is no account, no app, and no password to type — the only
 * thing asked for is a display name, because the room shows one.
 *
 * This page never decides anything. It renders the state the host broadcasts
 * and sends actions back; the tally, the score and the rules all live at the
 * host. That is deliberate — this page runs on a stranger's phone.
 */
(function () {
    'use strict';

    var Core = window.SponsorPulseCore;
    var I18n = window.SponsorPulseI18n;

    var el = function (id) { return document.getElementById(id); };

    function showToast(text) {
        var node = el('toast');
        node.textContent = text;
        node.hidden = false;
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(function () { node.hidden = true; }, 3200);
    }

    /** Room and key travel in the hash, which browsers keep out of Referer. */
    function readInvite() {
        var raw = (window.location.hash || '').replace(/^#/, '');
        var params = new URLSearchParams(raw);
        return {
            room: params.get('r') || params.get('c') || '',
            key: params.get('k') || '',
            lang: params.get('l') || ''
        };
    }

    class Attendee extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'sp_',
                customType: 'sponsorpulse',
                autoCreateDataChannel: false    // the channel relay carries everything
            });
            this.segment = Core.emptySegment();
            this.campaign = Core.emptyCampaign();
            this.myName = '';
            this.myAnswer = null;
            this.tickHandle = 0;
        }


        /**
         * Send without letting a rejected promise become an unhandled error.
         *
         * sendCustomEventMessage rejects when the channel refuses a message,
         * which is a normal thing to happen mid-reconnect. Left unhandled it
         * surfaces as a page error, so it is reported and swallowed here.
         */
        _send(payload, to) {
            try {
                var sending = this.sendCustomEventMessage(payload, to);
                if (sending && typeof sending.catch === 'function') {
                    sending.catch(function (err) {
                        console.debug('[SponsorPulse] send failed:', (err && err.message) || err);
                    });
                }
            } catch (err) {
                console.debug('[SponsorPulse] send threw:', (err && err.message) || err);
            }
        }

        onConnect() {
            el('joinStep').hidden = true;
            el('liveStep').hidden = false;
            // Tell the host who is here, and whether they agreed to be contacted.
            this._send(({
                type: Core.MSG.PROFILE,
                name: this.myName,
                email: el('attendeeEmail').value.trim(),
                consent: el('consent').checked,
                consentedAt: el('consent').checked ? Date.now() : 0
            }), this._hostName());
            this.render();
        }

        onDisconnect() {
            showToast(I18n.t('connectionLost'));
        }

        _hostName() {
            // Actions go to the host specifically; a broadcast would be applied
            // by every browser and counted many times. The base class spells
            // this _getHostName — the public-looking name does not exist, and
            // reaching for it silently fell back to broadcasting.
            return this._getHostName() || '*';
        }

        onGameMessage(detail) {
            // The base class has already parsed the payload and hands it over
            // as detail.data — reading detail.content instead finds nothing and
            // fails silently, which is exactly what it did.
            var payload = (detail && detail.data) ? detail.data : detail;
            if (!payload || !payload.type) return;

            if (payload.type === Core.MSG.STATE) {
                this.segment = payload.segment || Core.emptySegment();
                // A new segment means the previous answer no longer applies.
                if (this.segment.id !== this._lastSegmentId) {
                    this._lastSegmentId = this.segment.id;
                    this.myAnswer = this.segment.votes ? this.segment.votes[this.myName] || null : null;
                }
                this.render();
                return;
            }
            if (payload.type === Core.MSG.CAMPAIGN) {
                this.campaign = payload.campaign || this.campaign;
                this.applyBranding();
                return;
            }
            if (payload.type === Core.MSG.REJECTED) {
                showToast(payload.reason || '');
            }
        }

        // ---- sending -------------------------------------------------------

        answer(optionId) {
            this.myAnswer = optionId;
            this.render();                       // optimistic; the host confirms
            this._send(({
                type: this.segment.kind === 'quiz' ? Core.MSG.ANSWER : Core.MSG.VOTE,
                segmentId: this.segment.id,
                optionId: optionId
            }), this._hostName());
        }

        ask(text) {
            this._send(({
                type: Core.MSG.ASK, text: text
            }), this._hostName());
        }

        upvote(questionId) {
            this._send(({
                type: Core.MSG.UPVOTE, questionId: questionId
            }), this._hostName());
        }

        // ---- rendering -----------------------------------------------------

        applyBranding() {
            var c = this.campaign;
            if (c.brandName) el('brandName').textContent = c.brandName;
            if (c.eventName) el('brandEvent').textContent = c.eventName;
            if (c.logoDataUrl) {
                el('brandLogo').src = c.logoDataUrl;
                el('brandLogo').hidden = false;
            }
            if (c.accent) document.body.style.setProperty('--sp-accent', c.accent);

            var slot = el('sponsorSlot');
            if (c.sponsorVisible && (c.sponsorName || c.sponsorOffer)) {
                slot.hidden = false;
                slot.innerHTML = '';
                var card = document.createElement('div');
                card.className = 'sp-sponsor';
                if (c.sponsorLogoDataUrl) {
                    var img = document.createElement('img');
                    img.className = 'sp-sponsor__logo';
                    img.src = c.sponsorLogoDataUrl;
                    img.alt = '';
                    card.appendChild(img);
                }
                var body = document.createElement('div');
                body.className = 'sp-sponsor__body';
                var label = document.createElement('div');
                label.className = 'sp-sponsor__label';
                label.textContent = I18n.t('sponsoredBy') + ' ' + (c.sponsorName || '');
                var offer = document.createElement('div');
                offer.className = 'sp-sponsor__offer';
                // textContent, never innerHTML: this string is typed by an
                // organiser and shown on every attendee's phone.
                offer.textContent = c.sponsorOffer || '';
                body.appendChild(label);
                body.appendChild(offer);
                card.appendChild(body);
                slot.appendChild(card);
            } else {
                slot.hidden = true;
            }
        }

        render() {
            var host = el('segment');
            host.innerHTML = '';
            clearInterval(this.tickHandle);

            var s = this.segment;
            if (!s || s.kind === 'idle') {
                var idle = document.createElement('p');
                idle.className = 'sp-empty';
                idle.textContent = I18n.t('waiting');
                host.appendChild(idle);
                el('boardSection').hidden = true;
                return;
            }

            if (s.kind === 'poll' || s.kind === 'quiz') this.renderChoices(host, s);
            if (s.kind === 'qa') this.renderQa(host, s);

            var board = Core.leaderboard(s);
            el('boardSection').hidden = board.length === 0;
            if (board.length) this.renderBoard(board);
        }

        renderChoices(host, s) {
            var prompt = document.createElement('h1');
            prompt.className = 'sp-prompt';
            prompt.textContent = s.prompt;
            host.appendChild(prompt);

            if (s.endsAt) host.appendChild(this.buildTimer(s));

            var counts = s.revealed ? Core.tally(s) : null;
            var total = counts ? Object.keys(counts).reduce(function (sum, k) { return sum + counts[k]; }, 0) : 0;

            var list = document.createElement('div');
            list.className = 'sp-options';
            var self = this;
            var closed = s.revealed || (s.endsAt && Date.now() > s.endsAt);

            s.options.forEach(function (option, index) {
                var btn = document.createElement('button');
                btn.className = 'sp-option' + (counts ? ' sp-option--result' : '');
                btn.type = 'button';
                btn.setAttribute('aria-pressed', String(self.myAnswer === option.id));
                btn.disabled = !!closed;

                if (s.revealed && s.kind === 'quiz') {
                    if (option.correct) btn.classList.add('sp-option--correct');
                    else if (self.myAnswer === option.id) btn.classList.add('sp-option--wrong');
                }

                var key = document.createElement('span');
                key.className = 'sp-option__key';
                key.textContent = String.fromCharCode(65 + index);

                var label = document.createElement('span');
                label.className = 'sp-option__label';
                label.textContent = option.label;

                btn.appendChild(key);
                btn.appendChild(label);

                if (counts) {
                    var count = document.createElement('span');
                    count.className = 'sp-option__count';
                    var share = total ? Math.round((counts[option.id] / total) * 100) : 0;
                    count.textContent = counts[option.id] + ' · ' + share + '%';
                    btn.appendChild(count);

                    var bar = document.createElement('span');
                    bar.className = 'sp-option__bar';
                    bar.style.inlineSize = share + '%';
                    btn.appendChild(bar);
                }

                btn.addEventListener('click', function () {
                    if (closed) return;
                    self.answer(option.id);
                });
                list.appendChild(btn);
            });
            host.appendChild(list);

            if (this.myAnswer && !s.revealed) {
                var done = document.createElement('p');
                done.className = 'sp-privacy';
                done.textContent = I18n.t('voted');
                host.appendChild(done);
            }
        }

        buildTimer(s) {
            var wrap = document.createElement('div');
            wrap.className = 'sp-timer';
            var label = document.createElement('span');
            var track = document.createElement('span');
            track.className = 'sp-timer__track';
            var fill = document.createElement('span');
            fill.className = 'sp-timer__fill';
            track.appendChild(fill);
            wrap.appendChild(label);
            wrap.appendChild(track);

            var total = Math.max(1, s.endsAt - (s.startedAt || (s.endsAt - 30000)));
            function tick() {
                var left = Math.max(0, s.endsAt - Date.now());
                label.textContent = Math.ceil(left / 1000) + 's';
                fill.style.inlineSize = Math.max(0, (left / total) * 100) + '%';
                wrap.classList.toggle('sp-timer--urgent', left < 6000);
            }
            tick();
            this.tickHandle = setInterval(tick, 1000);
            return wrap;
        }

        renderQa(host, s) {
            var heading = document.createElement('h1');
            heading.className = 'sp-prompt';
            heading.textContent = s.prompt || I18n.t('qa');
            host.appendChild(heading);

            var field = document.createElement('div');
            field.className = 'sp-field';
            var input = document.createElement('input');
            input.type = 'text';
            input.maxLength = Core.LIMITS.MAX_QUESTION_CHARS;
            input.placeholder = I18n.t('askPlaceholder');
            input.setAttribute('enterkeyhint', 'send');
            var send = document.createElement('button');
            send.className = 'btn btn--primary';
            send.style.minHeight = '48px';
            send.textContent = I18n.t('askQuestion');

            var self = this;
            function submit() {
                var text = input.value.trim();
                if (!text) return;
                self.ask(text);
                input.value = '';
            }
            send.addEventListener('click', submit);
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') submit();
            });
            field.appendChild(input);
            field.appendChild(send);
            host.appendChild(field);

            var list = document.createElement('div');
            list.className = 'sp-questions';
            // An attendee only ever sees what the host let through.
            s.questions
                .filter(function (q) { return q.state === 'approved' || q.state === 'pinned'; })
                .sort(function (a, b) {
                    if ((b.state === 'pinned') !== (a.state === 'pinned')) return b.state === 'pinned' ? 1 : -1;
                    return b.upvotes.length - a.upvotes.length || a.at - b.at;
                })
                .forEach(function (q) {
                    list.appendChild(self.buildQuestion(q));
                });
            host.appendChild(list);
        }

        buildQuestion(q) {
            var self = this;
            var row = document.createElement('div');
            row.className = 'sp-question' + (q.state === 'pinned' ? ' sp-question--pinned' : '');

            var body = document.createElement('div');
            body.className = 'sp-question__body';
            var text = document.createElement('div');
            text.className = 'sp-question__text';
            text.textContent = q.text;
            var meta = document.createElement('div');
            meta.className = 'sp-question__meta';
            meta.textContent = q.by + (q.state === 'pinned' ? ' · ' + I18n.t('pinned') : '');
            body.appendChild(text);
            body.appendChild(meta);

            var up = document.createElement('button');
            up.className = 'sp-upvote';
            up.type = 'button';
            up.setAttribute('aria-label', I18n.t('upvote'));
            up.setAttribute('aria-pressed', String(q.upvotes.indexOf(this.myName) !== -1));
            up.textContent = String(q.upvotes.length);
            up.addEventListener('click', function () { self.upvote(q.id); });

            row.appendChild(body);
            row.appendChild(up);
            return row;
        }

        renderBoard(board) {
            var host = el('board');
            host.innerHTML = '';
            var self = this;
            board.slice(0, 10).forEach(function (entry, index) {
                var row = document.createElement('div');
                row.className = 'sp-board__row' + (entry.name === self.myName ? ' sp-board__row--me' : '');
                var rank = document.createElement('span');
                rank.className = 'sp-board__rank';
                rank.textContent = String(index + 1);
                var name = document.createElement('span');
                name.className = 'sp-board__name';
                name.textContent = entry.name;
                var points = document.createElement('span');
                points.className = 'sp-board__points';
                points.textContent = String(entry.points);
                row.appendChild(rank);
                row.appendChild(name);
                row.appendChild(points);
                host.appendChild(row);
            });
        }
    }

    // ---- boot ---------------------------------------------------------------

    document.addEventListener('DOMContentLoaded', function () {
        var picker = el('langPick');
        I18n.languages().forEach(function (lang) {
            var opt = document.createElement('option');
            opt.value = lang.code;
            opt.textContent = lang.name;
            picker.appendChild(opt);
        });

        var invite = readInvite();
        I18n.setLanguage(invite.lang || 'en');
        picker.value = I18n.current;
        picker.addEventListener('change', function () {
            I18n.setLanguage(picker.value);
            if (window.sponsorPulseAttendee) window.sponsorPulseAttendee.render();
        });

        el('consent').addEventListener('change', function () {
            // Only ask for an email once someone has said yes to being contacted.
            el('emailField').hidden = !el('consent').checked;
        });

        var app = new Attendee();
        window.sponsorPulseAttendee = app;

        el('joinBtn').addEventListener('click', async function () {
            var name = Core.cleanText(el('attendeeName').value, Core.LIMITS.MAX_NAME_CHARS);
            if (!name) {
                el('joinError').textContent = I18n.t('enterName');
                el('attendeeName').focus();
                return;
            }
            if (!invite.room || !invite.key) {
                el('joinError').textContent = 'This link is missing its event details.';
                return;
            }
            app.myName = name;
            el('joinBtn').disabled = true;
            el('joinBtn').textContent = I18n.t('joining');
            try {
                await app.initialize();
                await app.connect({ username: name, channel: invite.room, password: invite.key });
            } catch (err) {
                el('joinError').textContent = (err && err.message) || 'Could not join';
                el('joinBtn').disabled = false;
                el('joinBtn').textContent = I18n.t('join');
            }
        });

        el('attendeeName').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') el('joinBtn').click();
        });
    });
})();
