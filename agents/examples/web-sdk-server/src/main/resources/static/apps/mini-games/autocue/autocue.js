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

        // private
        this.myRole = 'writer';
        this.currentLine = null;  // the speaker's line, addressed to them alone
        this.mySubmitted = 0;

        // host only
        this.queue = [];          // [{text, author}]
        this.pending = [];        // [{id, text, author}] awaiting approval
        this.format = null;
        this.scoreByAuthor = new Map();
        this._nextId = 1;
        this._attribTimer = null;
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
        this.delivered = [];
        this.scoreByAuthor = new Map();
        this.unlocked = false;
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
            this.delivered.unshift({ text: said.text, author: said.author, shown: false });
            if (said.author) {
                this.scoreByAuthor.set(said.author, (this.scoreByAuthor.get(said.author) || 0) + 1);
            }
            this.broadcastState();
            // The name lands a beat after the line. That is the second laugh.
            clearTimeout(this._attribTimer);
            this._attribTimer = setTimeout(() => {
                if (this.delivered[0]) this.delivered[0].shown = true;
                this.broadcastState();
            }, AC_ATTRIB_MS);
        }

        if (this.delivered.length >= this.target) return this.hostEnd();

        // Never leave the lectern empty: fall back to a scaffold line.
        let next = this.queue.shift();
        if (!next) {
            next = { text: this.pick(this.format.scaffolds), author: null };
        }
        this.currentForSpeaker = next;
        this.toPlayer(this.speaker, { t: 'line', text: next.text });
    }

    hostEnd() {
        clearTimeout(this._attribTimer);
        this.phase = 'done';
        this.delivered.forEach(d => { d.shown = true; });
        this.broadcastState();
    }

    hostAbort() {
        clearTimeout(this._attribTimer);
        this.phase = 'lobby';
        this.speaker = null;
        this.delivered = [];
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
            delivered: this.delivered.slice(0, 12),
            queueSize: this.queue.length,
            pendingSize: this.pending.length,
            target: this.target,
            unlocked: this.unlocked || this.queue.length >= AC_FLOOR,
            floor: AC_FLOOR,
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
                this.renderAll();
                break;
            default: break;
        }
    }

    applyState(s) {
        if (s.phase === 'lobby') { this.currentLine = null; this.myRole = 'writer'; }
        this.phase = s.phase;
        this.speaker = s.speaker;
        this.formatName = s.formatName;
        this.delivered = s.delivered || [];
        this.queueSize = s.queueSize;
        this.pendingSize = s.pendingSize;
        this.target = s.target;
        this.unlocked = s.unlocked;
        this.floor = s.floor;
        this.scores = s.scores || [];
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

        this.renderAll();
    }

    renderAll() {
        this.renderPhase();
        this.renderStage();
        this.renderMine();
        this.renderEditor();
        this.renderScores();
        this.renderRoster('lobbyPlayers', u => (u.name === this.speaker ? 'speaking' : (u.isHost ? 'screen' : '')));
        this.renderSpeakerOptions();
    }

    renderPhase() {
        this.show('lobbyPanel', this.phase === 'lobby');
        this.show('gamePanel', this.phase === 'live');
        this.show('overPanel', this.phase === 'done');
        this.show('hostControls', this.isHost() && this.phase === 'lobby');
        this.show('guestWait', !this.isHost() && this.phase === 'lobby');
        this.show('editorCard', this.isHost() && this.phase === 'live');
        this.show('againBtn', this.isHost());

        const label = { lobby: 'Lobby', live: 'On stage', done: 'Applause' }[this.phase] || '';
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
