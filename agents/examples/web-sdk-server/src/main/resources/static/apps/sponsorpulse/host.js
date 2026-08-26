/**
 * SponsorPulse — the organiser's console.
 *
 * This page is the authority. Attendee actions arrive addressed to it, are
 * checked here against the rules in sponsorpulse-core.js, and the resulting
 * state is broadcast whole. Nothing an attendee sends is trusted: the cap, the
 * rate limit, one-answer-per-person and the moderation gate all live here,
 * because the page at the other end runs on someone else's phone.
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
        showToast._timer = setTimeout(function () { node.hidden = true; }, 3000);
    }

    /** Read a picked image as a data URL, small enough to broadcast. */
    function readImage(file, maxPx, done) {
        if (!file) return done('');
        var reader = new FileReader();
        reader.onload = function () {
            var img = new Image();
            img.onload = function () {
                var scale = Math.min(1, maxPx / Math.max(img.width, img.height));
                var canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                // A logo travels to every attendee on every campaign update, so
                // it is downsized rather than sent at whatever size was picked.
                done(canvas.toDataURL('image/png'));
            };
            img.onerror = function () { done(''); };
            img.src = reader.result;
        };
        reader.onerror = function () { done(''); };
        reader.readAsDataURL(file);
    }

    class HostConsole extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'sp_host_',
                customType: 'sponsorpulse',
                autoCreateDataChannel: false
            });
            this.segment = Core.emptySegment();
            this.campaign = Core.emptyCampaign();
            this.profiles = {};                 // attendeeName -> consent record
            this.limiter = new Core.RateLimiter();
            this.mode = 'poll';
            this.timerHandle = 0;
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
            this.renderInvite();
            this.broadcastCampaign();
            this.broadcastState();
            this.render();
        }

        onUserJoin() {
            // A newcomer needs the branding and whatever is running right now.
            this.broadcastCampaign();
            this.broadcastState();
            this.render();
        }

        onUserLeave(detail) {
            if (detail && detail.agentName) this.limiter.forget(detail.agentName);
            this.render();
        }

        // ---- receiving -----------------------------------------------------

        onGameMessage(detail) {
            var from = (detail && detail.from) || '';
            var payload = (detail && detail.data) ? detail.data : detail;
            if (!payload || !payload.type) return;

            if (payload.type === Core.MSG.PROFILE) {
                this.recordProfile(from, payload);
                this.render();
                return;
            }

            // Everything below changes the tally, so it is rate limited.
            if (!this.limiter.allow(from)) {
                this.reject(from, 'Slow down a moment');
                return;
            }

            if (Object.keys(this.profiles).length > Core.LIMITS.MAX_ATTENDEES) {
                this.reject(from, I18n.t('roomFull'));
                return;
            }

            var result = Core.applyAction(this.segment, payload, from);
            if (result.error) {
                this.reject(from, result.error);
                return;
            }
            this.broadcastState();
            this.render();
        }

        recordProfile(from, payload) {
            if (Object.keys(this.profiles).length >= Core.LIMITS.MAX_ATTENDEES
                && !this.profiles[from]) {
                this.reject(from, I18n.t('roomFull'));
                return;
            }
            this.profiles[from] = {
                name: Core.cleanText(payload.name || from, Core.LIMITS.MAX_NAME_CHARS),
                email: Core.cleanText(payload.email || '', 120),
                consent: !!payload.consent,
                consentedAt: payload.consent ? (payload.consentedAt || Date.now()) : 0
            };
        }

        reject(who, reason) {
            if (!who) return;
            this._send(({
                type: Core.MSG.REJECTED, reason: reason
            }), who);
        }

        // ---- broadcasting --------------------------------------------------

        broadcastState() {
            this._send(({
                type: Core.MSG.STATE, segment: this.segment
            }), '*');
        }

        broadcastCampaign() {
            this._send(({
                type: Core.MSG.CAMPAIGN, campaign: this.campaign
            }), '*');
        }

        // ---- running the event ---------------------------------------------

        launch() {
            var prompt = Core.cleanText(el('promptInput').value, 200);
            if (!prompt && this.mode !== 'qa') {
                showToast('Give the room a question first');
                return;
            }

            var previousScores = this.segment.scores || {};
            var previousQuestions = this.segment.questions || [];

            this.segment = Core.emptySegment();
            this.segment.kind = this.mode;
            this.segment.id = Core.newId('seg');
            this.segment.prompt = prompt;
            // Scores and the question board carry across segments; the event is
            // one continuous thing even though each segment is separate.
            this.segment.scores = previousScores;
            this.segment.questions = previousQuestions;

            if (this.mode === 'poll' || this.mode === 'quiz') {
                this.segment.options = this.readOptions();
                if (this.segment.options.length < 2) {
                    showToast('A question needs at least two options');
                    return;
                }
                var secs = parseInt(el('timerSecs').value, 10);
                if (!isNaN(secs) && secs > 0) {
                    this.segment.startedAt = Date.now();
                    this.segment.endsAt = Date.now() + secs * 1000;
                    this.scheduleClose();
                }
            }

            this.broadcastState();
            this.render();
            showToast('Live');
        }

        readOptions() {
            var rows = Array.prototype.slice.call(document.querySelectorAll('[data-option-row]'));
            var options = [];
            rows.forEach(function (row) {
                var label = Core.cleanText(row.querySelector('input[type="text"]').value, 120);
                if (!label) return;
                options.push({
                    id: Core.newId('opt'),
                    label: label,
                    correct: row.querySelector('input[type="checkbox"]').checked
                });
            });
            return options;
        }

        scheduleClose() {
            var self = this;
            clearTimeout(this.timerHandle);
            var wait = Math.max(0, this.segment.endsAt - Date.now());
            this.timerHandle = setTimeout(function () {
                // The timer closing the segment is what makes a late vote late;
                // the check also lives in the core, so a clock skew cannot open it.
                self.reveal();
            }, wait + 250);
        }

        reveal() {
            if (this.segment.kind === 'quiz' && !this.segment.revealed) {
                Core.scoreQuiz(this.segment);
            }
            this.segment.revealed = true;
            this.broadcastState();
            this.render();
        }

        endSegment() {
            clearTimeout(this.timerHandle);
            var scores = this.segment.scores;
            var questions = this.segment.questions;
            this.segment = Core.emptySegment();
            this.segment.scores = scores;
            this.segment.questions = questions;
            this.broadcastState();
            this.render();
        }

        moderate(questionId, state) {
            var q = this.segment.questions.filter(function (x) { return x.id === questionId; })[0];
            if (!q) return;
            if (state === 'pinned') {
                // Only one thing is pinned at a time, or pinning means nothing.
                this.segment.questions.forEach(function (other) {
                    if (other.state === 'pinned') other.state = 'approved';
                });
            }
            q.state = state;
            this.broadcastState();
            this.render();
        }

        // ---- rendering -----------------------------------------------------

        renderInvite() {
            var url = new URL('join.html', window.location.href);
            // Room and key ride in the hash so they stay out of Referer headers
            // and server logs.
            url.hash = new URLSearchParams({
                r: this.channelName || '',
                k: this.channelPassword || '',
                l: this.campaign.language || 'en'
            }).toString();

            var link = url.toString();
            el('joinLink').textContent = link;

            var host = el('qr');
            host.innerHTML = '';
            if (typeof QRCode !== 'undefined') {
                new QRCode(host, {
                    text: link, width: 148, height: 148,
                    colorDark: '#000000', colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            }
            this._joinLink = link;
        }

        render() {
            var attendees = Object.keys(this.profiles).length;
            el('statAttendees').textContent = String(attendees);
            el('attendeeCount').textContent = attendees + ' here';
            el('statVotes').textContent = String(Object.keys(this.segment.votes || {}).length);
            el('statQuestions').textContent = String((this.segment.questions || []).length);

            this.renderResults();
            this.renderQueue();
        }

        renderResults() {
            var host = el('liveResults');
            host.innerHTML = '';
            var s = this.segment;
            if (s.kind !== 'poll' && s.kind !== 'quiz') return;

            var counts = Core.tally(s);
            var total = Object.keys(counts).reduce(function (sum, k) { return sum + counts[k]; }, 0);

            s.options.forEach(function (option) {
                var row = document.createElement('div');
                row.className = 'sp-option sp-option--result';
                if (option.correct) row.classList.add('sp-option--correct');

                var label = document.createElement('span');
                label.className = 'sp-option__label';
                label.textContent = option.label;

                var count = document.createElement('span');
                count.className = 'sp-option__count';
                var share = total ? Math.round((counts[option.id] / total) * 100) : 0;
                count.textContent = counts[option.id] + ' · ' + share + '%';

                var bar = document.createElement('span');
                bar.className = 'sp-option__bar';
                bar.style.inlineSize = share + '%';

                row.appendChild(label);
                row.appendChild(count);
                row.appendChild(bar);
                host.appendChild(row);
            });
        }

        renderQueue() {
            var host = el('modQueue');
            host.innerHTML = '';
            var self = this;
            var questions = (this.segment.questions || []).slice().sort(function (a, b) {
                return b.at - a.at;
            });

            if (!questions.length) {
                var empty = document.createElement('p');
                empty.className = 'sp-privacy';
                empty.textContent = 'Nothing submitted yet.';
                host.appendChild(empty);
                return;
            }

            questions.forEach(function (q) {
                var row = document.createElement('div');
                row.className = 'sp-question' + (q.state === 'pinned' ? ' sp-question--pinned' : '');

                var body = document.createElement('div');
                body.className = 'sp-question__body';
                var text = document.createElement('div');
                text.className = 'sp-question__text';
                text.textContent = q.text;                   // never innerHTML
                var meta = document.createElement('div');
                meta.className = 'sp-question__meta';
                meta.textContent = q.by + ' · ' + q.upvotes.length + ' upvotes · ' + q.state;
                body.appendChild(text);
                body.appendChild(meta);

                var actions = document.createElement('div');
                actions.className = 'sp-mod';
                [['approve', 'approved'], ['pin', 'pinned'], ['hide', 'hidden'], ['answered', 'answered']]
                    .forEach(function (pair) {
                        var btn = document.createElement('button');
                        btn.className = 'btn btn--sm btn--ghost';
                        btn.type = 'button';
                        btn.textContent = pair[0];
                        btn.addEventListener('click', function () { self.moderate(q.id, pair[1]); });
                        actions.appendChild(btn);
                    });

                row.appendChild(body);
                row.appendChild(actions);
                host.appendChild(row);
            });
        }

        // ---- after the event -----------------------------------------------

        report() {
            return Core.buildReport(this.campaign, this.segment, this.profiles);
        }

        exportCsv() {
            var report = this.report();
            var csv = Core.leadsToCsv(report);
            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = (report.event || 'event').replace(/\W+/g, '-').toLowerCase() + '-leads.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            showToast(report.leads.length + ' consenting attendee(s) exported');
        }
    }

    // ---- boot ---------------------------------------------------------------

    document.addEventListener('DOMContentLoaded', function () {
        var app = new HostConsole();
        window.sponsorPulseHost = app;

        var langSelect = el('langInput');
        I18n.languages().forEach(function (lang) {
            var opt = document.createElement('option');
            opt.value = lang.code;
            opt.textContent = lang.name;
            langSelect.appendChild(opt);
        });

        // ---- option rows
        function addOptionRow(value) {
            var row = document.createElement('div');
            row.setAttribute('data-option-row', '');
            row.style.cssText = 'display:flex;gap:.5rem;align-items:center';
            var text = document.createElement('input');
            text.type = 'text';
            text.maxLength = 120;
            text.value = value || '';
            // Built in script, so it never passed under a <label> in the markup:
            // a screen reader reached it as an unnamed text box. The number is
            // what distinguishes one option row from the next.
            var position = el('optionRows').children.length + 1;
            text.setAttribute('aria-label', 'Answer option ' + position);
            text.placeholder = 'Option ' + position;
            text.style.cssText = 'flex:1;min-height:44px;padding:.5rem .75rem;border-radius:8px;'
                + 'border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)';
            var correctWrap = document.createElement('label');
            correctWrap.style.cssText = 'display:flex;align-items:center;gap:.25rem;font-size:.75rem;color:var(--text-muted)';
            var correct = document.createElement('input');
            correct.type = 'checkbox';
            correct.setAttribute('aria-label', 'Option ' + position + ' is the correct answer');
            correct.style.cssText = 'width:20px;height:20px';
            correctWrap.appendChild(correct);
            correctWrap.appendChild(document.createTextNode('correct'));
            var remove = document.createElement('button');
            remove.className = 'btn btn--sm btn--ghost';
            remove.type = 'button';
            remove.textContent = '×';
            remove.setAttribute('aria-label', 'Remove option');
            remove.addEventListener('click', function () { row.remove(); });
            row.appendChild(text);
            row.appendChild(correctWrap);
            row.appendChild(remove);
            el('optionRows').appendChild(row);
        }
        addOptionRow(''); addOptionRow('');
        el('addOption').addEventListener('click', function () { addOptionRow(''); });

        // ---- mode
        function setMode(mode) {
            app.mode = mode;
            ['modePoll', 'modeQuiz', 'modeQa'].forEach(function (id) {
                el(id).classList.remove('btn--primary');
            });
            el(mode === 'poll' ? 'modePoll' : mode === 'quiz' ? 'modeQuiz' : 'modeQa')
                .classList.add('btn--primary');
            el('optionsEditor').hidden = (mode === 'qa');
        }
        el('modePoll').addEventListener('click', function () { setMode('poll'); });
        el('modeQuiz').addEventListener('click', function () { setMode('quiz'); });
        el('modeQa').addEventListener('click', function () { setMode('qa'); });
        setMode('poll');

        el('launchBtn').addEventListener('click', function () { app.launch(); });
        el('revealBtn').addEventListener('click', function () { app.reveal(); });
        el('endBtn').addEventListener('click', function () { app.endSegment(); });

        // ---- campaign fields
        function pushCampaign() {
            app.campaign.brandName = el('brandInput').value.trim();
            app.campaign.eventName = el('eventInput').value.trim();
            app.campaign.eventDate = el('dateInput').value;
            app.campaign.accent = el('accentInput').value;
            app.campaign.language = langSelect.value;
            app.campaign.sponsorName = el('sponsorInput').value.trim();
            app.campaign.sponsorOffer = el('offerInput').value.trim();
            app.campaign.sponsorVisible = el('sponsorVisible').checked;

            el('brandName').textContent = app.campaign.brandName || 'SponsorPulse';
            el('brandEvent').textContent = app.campaign.eventName || 'Host console';
            document.body.style.setProperty('--sp-accent', app.campaign.accent);
            app.broadcastCampaign();
            app.renderInvite();
        }
        ['brandInput', 'eventInput', 'dateInput', 'accentInput', 'sponsorInput',
         'offerInput', 'sponsorVisible'].forEach(function (id) {
            el(id).addEventListener('change', pushCampaign);
        });
        langSelect.addEventListener('change', pushCampaign);

        el('logoInput').addEventListener('change', function (e) {
            readImage(e.target.files[0], 160, function (dataUrl) {
                app.campaign.logoDataUrl = dataUrl;
                if (dataUrl) { el('brandLogo').src = dataUrl; el('brandLogo').hidden = false; }
                app.broadcastCampaign();
            });
        });
        el('sponsorLogoInput').addEventListener('change', function (e) {
            readImage(e.target.files[0], 160, function (dataUrl) {
                app.campaign.sponsorLogoDataUrl = dataUrl;
                app.broadcastCampaign();
            });
        });

        el('copyLink').addEventListener('click', function () {
            navigator.clipboard.writeText(app._joinLink || '').then(function () {
                showToast('Link copied');
            }, function () {
                showToast('Copy failed — select the link instead');
            });
        });

        el('exportCsv').addEventListener('click', function () { app.exportCsv(); });
        el('exportSummary').addEventListener('click', function () {
            var r = app.report();
            el('summaryOut').textContent =
                r.event + (r.date ? ' · ' + r.date : '') + '\n' +
                r.attendees + ' attendees · ' + r.votesCast + ' answers · ' +
                r.questionsAsked + ' questions\n' +
                (r.sponsor ? 'Sponsor: ' + r.sponsor + '\n' : '') +
                r.leads.length + ' consented to follow-up\n\n' +
                r.leaderboard.slice(0, 5).map(function (row, i) {
                    return (i + 1) + '. ' + row.name + ' — ' + row.points;
                }).join('\n');
        });

        // The organiser joins their own room like any other app on the site.
        window.loadConnectionModal({
            localStoragePrefix: 'sp_host_',
            channelPrefix: 'event-',
            title: 'Start your event',
            collapsedTitle: 'SponsorPulse',
            onConnect: async function (username, channel, password) {
                await app.initialize();
                // The base class expects channelName/channelPassword; `channel`
                // and `password` are silently ignored and it throws
                // "Username and channel name required".
                await app.connect({
                    username: username,
                    channelName: channel,
                    channelPassword: password
                });
                app.start();
                if (window.ConnectionModal && window.ConnectionModal.hide) {
                    window.ConnectionModal.hide();
                }
            }
        });
    });
})();
