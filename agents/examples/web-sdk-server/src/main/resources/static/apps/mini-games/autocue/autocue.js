// ============================================================================
// Autocue — one person gives the speech, everybody else writes it.
//
// Three seats:
//   THE SPEAKER   sees one line at a time, huge, and taps for the next. They
//                 read each line aloud before they know where it goes.
//   THE WRITERS   compose lines on their phones. Lines go PRIVATELY to the
//                 host; nothing reaches the lectern unvetted.
//   THE HOST      is the television and the editor. Approves lines into the
//                 queue, and shows the delivered line — then, a beat later,
//                 who wrote it. That beat is the second laugh.
//
// The one thing that kills this game is the queue running dry, so the floor of
// five and the scaffold fallback below are not polish: they are the product.
// ============================================================================

const AC_FLOOR       = 5;     // approved lines before Deliver unlocks
const AC_ATTRIB_MS   = 1400;  // the beat between the line and the name
const AC_MAX_LEN     = 140;
const AC_RESCUES     = 3;     // times the speaker may ask for an easy one
const AC_BEST_TIME   = 22;    // seconds to vote for the line of the night
const AC_BEST_POINTS = 3;     // to whoever wrote it

class AutocueGame extends PartyKit.PartyGame {
    constructor() {
        super({
            storagePrefix: 'autocue',
            customType: 'autocue',
            dataChannelName: 'autocue-data',
        });

        // public
        this.speaker = null;
        this.formatName = '';
        this.prompts = [];
        this.delivered = [];      // [{text, author, shown}]
        this.queueSize = 0;
        this.target = 10;
        this.unlocked = false;
        this.direction = null;    // the current stage direction, shown to everyone
        this.heckles = 0;
        this.lastHeckle = null;
        this.rescuesLeft = AC_RESCUES;
        this.bestVotes = 0;
        this.bestLine = null;

        // private
        this.myRole = 'writer';
        this.currentLine = null;  // the speaker's line, addressed to them alone
        this.myDirection = null;
        this.mySubmitted = 0;
        this.myBest = null;

        // host only — never written by applyState
        this.hostDelivered = [];  // the full speech; `delivered` is the display copy
        this.queue = [];          // [{text, author}]
        this.pending = [];        // [{id, text, author}] awaiting approval
        this.format = null;
        this.scoreByAuthor = new Map();
        this.hostBest = new Map();    // voter -> delivered index
        this._nextId = 1;
        this._attribTimer = null;
        this._heckleTimer = null;
    }

    async onInitialize() { this.setupUI(); }

    // =====================================================================
    // HOST
    // =====================================================================

    hostStart(cfg) {
        const players = this.players();
        this.format = window.AutocueFormats.FORMATS.find(f => f.id === cfg.formatId)
            || window.AutocueFormats.FORMATS[0];
        this.speaker = cfg.speaker && players.includes(cfg.speaker) ? cfg.speaker : this.pick(players);
        this.target = cfg.target || 10;

        this.queue = [];
        this.pending = [];
        this.hostDelivered = [];
        this.scoreByAuthor = new Map();
        this.hostBest = new Map();
        this.unlocked = false;
        this.direction = null;
        this.heckles = 0;
        this.lastHeckle = null;
        this.rescuesLeft = AC_RESCUES;
        this.bestLine = null;
        this.phase = 'live';

        // Seed the queue so the speaker is never the first to notice a problem.
        this.format.scaffolds.slice(0, 2).forEach(text =>
            this.queue.push({ text, author: null }));

        this.broadcastState();
        this.hostPushRoles();
        // The opening line is fixed, and is delivered like any other.
        this.toPlayer(this.speaker, { t: 'line', text: this.format.opening });
        this.currentForSpeaker = { text: this.format.opening, author: null };
    }

    hostPushRoles() {
        this.players().forEach(name => {
            this.toPlayer(name, {
                t: 'role',
                role: name === this.speaker ? 'speaker' : 'writer',
                prompts: this.format ? this.format.prompts : [],
            });
        });
    }

    hostSubmit(from, msg) {
        if (this.phase !== 'live') return;
        const text = String(msg.text || '').trim().slice(0, AC_MAX_LEN);
        if (!text) return;
        if (from === this.speaker) return;              // the victim does not get a vote
        if (this.pending.length > 40) return;
        this.pending.push({ id: this._nextId++, text, author: from });
        this.broadcastState();
        this.renderEditor();
    }

    hostJudge(id, approve) {
        const idx = this.pending.findIndex(p => p.id === id);
        if (idx < 0) return;
        const line = this.pending.splice(idx, 1)[0];
        if (approve) {
            this.queue.push({ text: line.text, author: line.author });
            if (!this.unlocked && this.queue.length >= AC_FLOOR) this.unlocked = true;
        }
        this.broadcastState();
        this.renderEditor();
    }

    /** The speaker has finished a line: show it, attribute it, hand over the next. */
    hostDeliver(from) {
        if (this.phase !== 'live' || from !== this.speaker) return;
        if (!this.unlocked && this.queue.length < AC_FLOOR) return;

        const said = this.currentForSpeaker;
        if (said) {
            this.hostDelivered.unshift({ text: said.text, author: said.author, shown: false });
            if (said.author) {
                this.scoreByAuthor.set(said.author, (this.scoreByAuthor.get(said.author) || 0) + 1);
            }
            this.broadcastState();
            // The name lands a beat after the line. That is the second laugh.
            clearTimeout(this._attribTimer);
            this._attribTimer = setTimeout(() => {
                if (this.hostDelivered[0]) this.hostDelivered[0].shown = true;
                this.broadcastState();
            }, AC_ATTRIB_MS);
        }

        if (this.hostDelivered.length >= this.target) return this.hostEnd();

        // Never leave the lectern empty: fall back to a scaffold line.
        let next = this.queue.shift();
        if (!next) {
            next = { text: this.pick(this.format.scaffolds), author: null };
        }
        this.currentForSpeaker = next;
        this.toPlayer(this.speaker, { t: 'line', text: next.text });
    }

    /** The editor changes how the next line is said, not what it says. */
    hostDirect(text) {
        if (this.phase !== 'live') return;
        this.direction = String(text || '').slice(0, 120);
        this.broadcastState();
        this.toPlayer(this.speaker, { t: 'direction', text: this.direction });
    }

    hostHeckle(from) {
        if (this.phase !== 'live' || from === this.speaker) return;
        this.heckles += 1;
        this.lastHeckle = { by: from, at: Date.now() };
        this.broadcastState();
        clearTimeout(this._heckleTimer);
        this._heckleTimer = setTimeout(() => { this.lastHeckle = null; this.broadcastState(); }, 4000);
    }

    /**
     * The speaker's rescue. The whole product fails if somebody is left
     * standing in silence, so they can always reach for a line that works —
     * three times, so it stays a rescue rather than a strategy.
     */
    hostRescue(from) {
        if (this.phase !== 'live' || from !== this.speaker) return;
        if (this.rescuesLeft <= 0) return;
        this.rescuesLeft -= 1;
        this.currentForSpeaker = { text: this.pick(this.format.scaffolds), author: null };
        this.direction = null;
        this.broadcastState();
        this.toPlayer(this.speaker, { t: 'line', text: this.currentForSpeaker.text });
    }

    hostVoteBest(from, msg) {
        if (this.phase !== 'best') return;
        const i = parseInt(msg.line, 10);
        if (!(i >= 0 && i < this.hostDelivered.length)) return;
        this.hostBest.set(from, i);
        this.broadcastState();
        if (this.hostBest.size >= this.playerCount()) {
            clearTimeout(this._attribTimer);
            this._attribTimer = setTimeout(() => this.hostSettleBest(), 500);
        }
    }

    hostSettleBest() {
        clearTimeout(this._attribTimer);
        const tally = new Map();
        this.hostBest.forEach(i => tally.set(i, (tally.get(i) || 0) + 1));
        let best = null, most = 0;
        tally.forEach((n, i) => { if (n > most) { most = n; best = i; } });
        if (best !== null && this.hostDelivered[best]) {
            const line = this.hostDelivered[best];
            this.bestLine = { text: line.text, author: line.author, votes: most };
            if (line.author) {
                this.scoreByAuthor.set(line.author,
                    (this.scoreByAuthor.get(line.author) || 0) + AC_BEST_POINTS);
            }
        }
        this.phase = 'done';
        this.broadcastState();
    }

    hostEnd() {
        clearTimeout(this._attribTimer);
        this.hostDelivered.forEach(d => { d.shown = true; });
        // Enough of a speech to have a favourite? Let the room pick one.
        if (this.hostDelivered.length >= 3) {
            this.phase = 'best';
            this.hostBest = new Map();
            this.setDeadline(AC_BEST_TIME);
            this.broadcastState();
            this._attribTimer = setTimeout(() => this.hostSettleBest(), AC_BEST_TIME * 1000);
            return;
        }
        this.phase = 'done';
        this.hostDelivered.forEach(d => { d.shown = true; });
        this.broadcastState();
    }

    hostAbort() {
        clearTimeout(this._attribTimer);
        this.phase = 'lobby';
        this.speaker = null;
        this.hostDelivered = [];
        this.queue = [];
        this.pending = [];
        this.broadcastState();
    }

    hostReceive(from, msg) {
        switch (msg.t) {
            case 'hello':
                this.broadcastState();
                if (this.phase === 'live') {
                    this.toPlayer(from, {
                        t: 'role',
                        role: from === this.speaker ? 'speaker' : 'writer',
                        prompts: this.format ? this.format.prompts : [],
                    });
                    if (from === this.speaker && this.currentForSpeaker) {
                        this.toPlayer(from, { t: 'line', text: this.currentForSpeaker.text });
                    }
                }
                break;
            case 'submit':  this.hostSubmit(from, msg); break;
            case 'deliver': this.hostDeliver(from); break;
            case 'heckle':  this.hostHeckle(from); break;
            case 'rescue':  this.hostRescue(from); break;
            case 'best':    this.hostVoteBest(from, msg); break;
            case 'end':     if (from === this.speaker) this.hostEnd(); break;
            default: break;
        }
    }

    publicState() {
        const scores = [];
        this.scoreByAuthor.forEach((v, k) => scores.push({ name: k, score: v }));
        scores.sort((a, b) => b.score - a.score);
        return {
            t: 'state',
            phase: this.phase,
            speaker: this.speaker,
            formatName: this.format ? this.format.name : '',
            delivered: this.hostDelivered.slice(0, 12),
            queueSize: this.queue.length,
            pendingSize: this.pending.length,
            target: this.target,
            unlocked: this.unlocked || this.queue.length >= AC_FLOOR,
            floor: AC_FLOOR,
            direction: this.direction,
            heckles: this.heckles,
            lastHeckle: this.lastHeckle,
            rescuesLeft: this.rescuesLeft,
            bestVotes: this.hostBest ? this.hostBest.size : 0,
            bestLine: this.bestLine || null,
            secondsLeft: this.secondsLeft(),
            scores,
        };
    }

    // =====================================================================
    // CLIENT
    // =====================================================================

    clientReceive(msg) {
        switch (msg.t) {
            case 'state': this.applyState(msg); break;
            case 'role':
                this.myRole = msg.role;
                this.prompts = msg.prompts || [];
                this.renderAll();
                break;
            case 'line':
                this.currentLine = msg.text;
                this.myDirection = null;
                PartySFX.play('line');
                this.renderAll();
                break;
            case 'direction':
                this.myDirection = msg.text;
                PartySFX.play('direction');
                this.renderAll();
                break;
            default: break;
        }
    }

    applyState(s) {
        // Sound off observed changes, so the whole room hears the same beats.
        if ((s.delivered || []).length > (this.delivered || []).length) PartySFX.play('line');
        const wasShown = (this.delivered || []).filter(d => d.shown).length;
        const nowShown = (s.delivered || []).filter(d => d.shown).length;
        if (nowShown > wasShown) PartySFX.play('attrib');
        if ((s.heckles || 0) > (this.heckles || 0)) PartySFX.play('heckle');
        if (s.direction && s.direction !== this.direction) PartySFX.play('direction');
        if (s.phase === 'done' && this.phase !== 'done') PartySFX.play('applause');

        if (s.phase === 'lobby') { this.currentLine = null; this.myRole = 'writer'; this.myDirection = null; this.myBest = null; }
        this.phase = s.phase;
        this.speaker = s.speaker;
        this.formatName = s.formatName;
        this.delivered = s.delivered || [];
        this.queueSize = s.queueSize;
        this.pendingSize = s.pendingSize;
        this.target = s.target;
        this.unlocked = s.unlocked;
        this.floor = s.floor;
        this.direction = s.direction;
        this.heckles = s.heckles || 0;
        this.lastHeckle = s.lastHeckle;
        this.rescuesLeft = s.rescuesLeft;
        this.bestVotes = s.bestVotes || 0;
        this.bestLine = s.bestLine || null;
        this.scores = s.scores || [];
        if (s.phase !== 'best') this.myBest = null;
        this.adoptDeadline(s.secondsLeft);
        if (this.speaker === this.username) this.myRole = 'speaker';
        this.renderAll();
    }

    // =====================================================================
    // ACTIONS
    // =====================================================================

    submitLine() {
        const input = document.getElementById('lineInput');
        const text = (input.value || '').trim();
        if (!text) return;
        this.toHost({ t: 'submit', text: text.slice(0, AC_MAX_LEN) });
        input.value = '';
        this.mySubmitted += 1;
        this.showToast('Sent to the editor.', 'success', 1600);
        this.renderAll();
    }

    deliver() { this.toHost({ t: 'deliver' }); }
    endSpeech() { this.toHost({ t: 'end' }); }
    heckle() { this.toHost({ t: 'heckle' }); PartySFX.play('heckle'); }
    rescue() { this.toHost({ t: 'rescue' }); }
    voteBest(i) { this.myBest = i; this.toHost({ t: 'best', line: i }); this.renderAll(); }

    // =====================================================================
    // UI
    // =====================================================================

    setupUI() {
        const $ = id => document.getElementById(id);

        const sel = $('formatSelect');
        window.AutocueFormats.FORMATS.forEach(f => {
            const o = document.createElement('option');
            o.value = f.id; o.textContent = f.name;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
            const f = window.AutocueFormats.FORMATS.find(x => x.id === sel.value);
            $('formatBlurb').textContent = f ? f.blurb : '';
        });
        $('formatBlurb').textContent = window.AutocueFormats.FORMATS[0].blurb;

        $('startBtn').addEventListener('click', () => {
            if (!this.isHost()) return;
            this.hostStart({
                formatId: sel.value,
                speaker: $('speakerSelect').value || null,
                target: parseInt($('targetSelect').value, 10),
            });
        });
        $('againBtn').addEventListener('click', () => { if (this.isHost()) this.hostAbort(); });
        $('sendBtn').addEventListener('click', () => this.submitLine());
        $('lineInput').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitLine(); }
        });
        $('deliverBtn').addEventListener('click', () => this.deliver());
        $('endBtn').addEventListener('click', () => this.endSpeech());
        $('rescueBtn').addEventListener('click', () => this.rescue());
        $('heckleBtn').addEventListener('click', () => this.heckle());
        $('directBtn').addEventListener('click', () => {
            if (!this.isHost()) return;
            const chosen = $('directionSelect').value;
            this.hostDirect(chosen || this.pick(window.AutocueFormats.DIRECTIONS));
        });

        const dsel = $('directionSelect');
        dsel.innerHTML = '<option value="">Something at random</option>' +
            window.AutocueFormats.DIRECTIONS.map(d =>
                `<option value="${PartyKit.esc(d)}">${PartyKit.esc(d)}</option>`).join('');

        PartySFX.attachToggle('soundBtn');
        this.startClock('clock');
        this.renderAll();
    }

    renderAll() {
        this.renderPhase();
        this.renderStage();
        this.renderMine();
        this.renderBest();
        this.renderEditor();
        this.renderScores();
        this.renderRoster('lobbyPlayers', u => (u.name === this.speaker ? 'speaking' : (u.isHost ? 'screen' : '')));
        this.renderSpeakerOptions();
    }

    renderPhase() {
        this.show('lobbyPanel', this.phase === 'lobby');
        this.show('gamePanel', this.phase === 'live');
        this.show('bestPanel', this.phase === 'best');
        this.show('overPanel', this.phase === 'done');
        this.show('hostControls', this.isHost() && this.phase === 'lobby');
        this.show('guestWait', !this.isHost() && this.phase === 'lobby');
        this.show('editorCard', this.isHost() && this.phase === 'live');
        this.show('againBtn', this.isHost());

        const label = { lobby: 'Lobby', live: 'On stage', best: 'Line of the night', done: 'Applause' }[this.phase] || '';
        this.setPhasePill('phasePill', label, this.phase === 'live' ? 'is-live' : this.phase === 'lobby' ? 'is-off' : 'is-busy');
        this.setText('roundCount', this.phase === 'live' ? `${this.delivered.length} / ${this.target} lines` : '');
        this.setText('formatName', this.formatName || '');
        this.setText('lobbyCount', this.playerCount() === 1 ? '1 player' : `${this.playerCount()} players`);
    }

    renderStage() {
        const el = document.getElementById('stage');
        if (!el) return;
        const last = this.delivered[0];
        if (!last) {
            el.innerHTML = `<p class="pk-secret__hint">${PartyKit.esc(this.speaker || 'Somebody')} is about to begin.</p>`;
            return;
        }
        el.innerHTML = `
            <p class="ac-line">${PartyKit.esc(last.text)}</p>
            <div class="ac-attrib${last.shown ? ' is-shown' : ''}">
                <span class="ac-attrib__rule"></span>
                <span class="ac-attrib__name">${last.author ? PartyKit.esc(last.author) : 'the autocue itself'}</span>
            </div>`;

        const dir = document.getElementById('directionBox');
        if (dir) {
            dir.hidden = !this.direction || this.phase !== 'live';
            if (this.direction) dir.textContent = this.direction;
        }
        const heck = document.getElementById('heckleBox');
        if (heck) {
            heck.hidden = !this.lastHeckle;
            if (this.lastHeckle) heck.textContent = `${this.lastHeckle.by} heckles.`;
        }
        this.setText('heckleCount', this.heckles ? `${this.heckles} heckle${this.heckles === 1 ? '' : 's'}` : '');

        const prev = document.getElementById('previously');
        if (prev) {
            prev.innerHTML = this.delivered.slice(1, 7).map(d =>
                `<li>${PartyKit.esc(d.text)} <span class="ac-by">${d.author ? PartyKit.esc(d.author) : 'scaffold'}</span></li>`
            ).join('') || '<li class="pk-empty">Nothing yet.</li>';
        }
    }

    renderMine() {
        const isSpeaker = this.myRole === 'speaker' || this.speaker === this.username;
        this.show('speakerPanel', this.phase === 'live' && isSpeaker);
        this.show('writerPanel', this.phase === 'live' && !isSpeaker);

        if (this.phase === 'live' && isSpeaker) {
            this.setText('speakerLine', this.currentLine || 'Waiting for your first line…');
            const b = document.getElementById('deliverBtn');
            const ready = this.unlocked;
            b.disabled = !ready;
            b.innerHTML = ready
                ? 'SAID IT<small>tap for the next line</small>'
                : `WAIT<small>${this.queueSize} of ${this.floor || AC_FLOOR} lines written</small>`;

            const r = document.getElementById('rescueBtn');
            r.disabled = !this.rescuesLeft;
            r.textContent = this.rescuesLeft
                ? `Give me an easy one (${this.rescuesLeft} left)`
                : 'No rescues left';
            const sd = document.getElementById('speakerDirection');
            if (sd) {
                sd.hidden = !this.myDirection;
                if (this.myDirection) sd.textContent = this.myDirection;
            }
        }

        if (this.phase === 'live' && !isSpeaker) {
            const el = document.getElementById('promptList');
            if (el) {
                el.innerHTML = (this.prompts || []).map(p =>
                    `<li>${PartyKit.esc(p)}</li>`).join('');
            }
            this.setText('mineCount', this.mySubmitted === 1 ? '1 line sent' : `${this.mySubmitted} lines sent`);
            this.setText('queueNote', `${this.queueSize} approved and waiting`);
        }
    }

    renderBest() {
        if (this.phase !== 'best') return;
        const el = document.getElementById('bestList');
        if (!el) return;
        el.innerHTML = this.delivered.map((d, i) => `
            <button type="button" class="pk-choice ac-bestline${this.myBest === i ? ' is-on' : ''}" data-i="${i}">
                <span class="ac-bestline__text">${PartyKit.esc(d.text)}</span>
                <span class="ac-bestline__by">${d.author ? PartyKit.esc(d.author) : 'the autocue itself'}</span>
            </button>`).join('');
        el.querySelectorAll('.ac-bestline').forEach(b =>
            b.addEventListener('click', () => this.voteBest(parseInt(b.dataset.i, 10))));
        this.setText('bestVotesNote', `${this.bestVotes} of ${this.playerCount()} have voted`);
    }

    renderEditor() {
        if (!this.isHost()) return;
        const el = document.getElementById('pendingList');
        if (!el) return;
        if (!this.pending.length) {
            el.innerHTML = '<li class="pk-empty">Nothing waiting. Nudge them.</li>';
            return;
        }
        el.innerHTML = this.pending.map(p => `
            <li class="ac-pending">
                <span class="ac-pending__text">${PartyKit.esc(p.text)}</span>
                <span class="ac-pending__by">${PartyKit.esc(p.author)}</span>
                <span class="ac-pending__acts">
                    <button type="button" class="btn btn--sm btn--primary ac-ok" data-id="${p.id}">In</button>
                    <button type="button" class="btn btn--sm ac-no" data-id="${p.id}">No</button>
                </span>
            </li>`).join('');
        el.querySelectorAll('.ac-ok').forEach(b =>
            b.addEventListener('click', () => this.hostJudge(parseInt(b.dataset.id, 10), true)));
        el.querySelectorAll('.ac-no').forEach(b =>
            b.addEventListener('click', () => this.hostJudge(parseInt(b.dataset.id, 10), false)));
        this.setText('queueCount', `${this.queue.length} approved`);
    }

    renderSpeakerOptions() {
        if (this.phase !== 'lobby' || !this.isHost()) return;
        const sel = document.getElementById('speakerSelect');
        if (!sel) return;
        const current = sel.value;
        const names = this.players();
        sel.innerHTML = '<option value="">Pick at random</option>' +
            names.map(n => `<option value="${PartyKit.esc(n)}">${PartyKit.esc(n)}</option>`).join('');
        if (names.includes(current)) sel.value = current;
    }

    renderScores() {
        const el = document.getElementById('scores');
        if (!el) return;
        const rows = (this.scores || []);
        if (!rows.length) { el.innerHTML = '<li class="pk-empty">Nothing landed yet.</li>'; return; }
        el.innerHTML = rows.map((r, i) => `
            <li class="pk-rank${r.name === this.username ? ' is-me' : ''}">
                <span class="pk-rank__pos">${i + 1}</span>
                <span class="pk-rank__name">${PartyKit.esc(r.name)}</span>
                <span class="pk-rank__score">${r.score}</span>
            </li>`).join('');
        if (this.phase === 'done' && rows.length) {
            this.setText('overTitle', `${rows[0].name} put ${rows[0].score} line${rows[0].score === 1 ? '' : 's'} in ${this.speaker || 'their'} mouth`);
        }
        const bl = document.getElementById('bestLineBox');
        if (bl) {
            bl.hidden = !(this.phase === 'done' && this.bestLine);
            if (this.phase === 'done' && this.bestLine) {
                bl.innerHTML = `
                    <div class="pk-kicker">Line of the night — ${this.bestLine.votes} vote${this.bestLine.votes === 1 ? '' : 's'}</div>
                    <p class="ac-line">${PartyKit.esc(this.bestLine.text)}</p>
                    <div class="ac-attrib is-shown">
                        <span class="ac-attrib__rule"></span>
                        <span class="ac-attrib__name">${this.bestLine.author ? PartyKit.esc(this.bestLine.author) : 'the autocue itself'}</span>
                    </div>`;
            }
        }
    }
}

PartyKit.boot({
    GameClass: AutocueGame,
    globalName: 'autocueGame',
    storagePrefix: 'autocue_',
    channelPrefix: 'autocue-',
    title: 'Join Autocue',
    collapsedTitle: 'Autocue',
});
