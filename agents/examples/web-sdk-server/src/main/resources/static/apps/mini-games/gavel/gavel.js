// ============================================================================
// Gavel — a full courtroom for a forty-pence grievance.
//
// The host is the bench: they open the case, admit exhibits, and pass sentence.
// Everyone else submits testimony PRIVATELY and votes in a sealed booth —
// anonymity is what makes colleagues eloquent, so a submission must never be
// broadcast with a name on it.
//
// The verdict is appended to channel storage with `storageAdd`, which keeps
// every previous version rather than replacing it. That is not a security
// feature here. It is the punchline: the case law cannot be quietly expunged,
// and later trials cite it.
// ============================================================================

const GV_EVIDENCE_TIME = 90;   // seconds of testimony
const GV_JURY_TIME     = 25;   // seconds in the booth
const GV_MAX_LEN       = 200;

const GV_SENTENCES = [
    'Provides biscuits until March.',
    'Loses fridge privileges for one week.',
    'Must label everything, including their own possessions.',
    'Makes the tea for a fortnight, without complaint.',
    'Writes a formal apology and reads it aloud.',
    'Case dismissed. The court is appalled it was brought.',
];

class GavelGame extends PartyKit.PartyGame {
    constructor() {
        super({
            storagePrefix: 'gavel',
            customType: 'gavel',
            dataChannelName: 'gavel-data',
        });

        // public
        this.caseNo = 0;
        this.title = '';
        this.charge = '';
        this.defendant = null;
        this.admitted = [];     // [{text}] — anonymous by construction
        this.juryIn = 0;
        this.verdict = null;
        this.sentence = '';
        this.caseLaw = [];

        // private
        this.myVote = null;
        this.mySubmissions = 0;

        // host only
        this.pending = [];      // [{id, text, author}] — author never leaves the bench
        this.votes = new Map();
        this._nextId = 1;
        this._timer = null;
    }

    async onInitialize() { this.setupUI(); }

    onConnect() {
        super.onConnect();
        setTimeout(() => this.loadCaseLaw(), 1400);
    }

    // =====================================================================
    // case law (the retention mechanism, and the joke)
    // =====================================================================

    lawKey() { return 'gavel-' + (this.channelName || 'chambers'); }

    loadCaseLaw() {
        if (!this.channel) return;
        this.channel.storageGetList(this.lawKey(), (res) => {
            if (!res || res.status !== 'success') return;
            const rows = PartyKit.storedVersions(res)
                .map(PartyKit.decodeStored)
                .filter(r => r && r.title);
            rows.sort((a, b) => (a.no || 0) - (b.no || 0));
            this.caseLaw = rows;
            this.caseNo = rows.length ? Math.max(...rows.map(r => r.no || 0)) : 0;
            this.renderCaseLaw();
        });
    }

    recordVerdict(record) {
        if (!this.channel) return;
        this.channel.storageAdd({
            storageKey: this.lawKey(),
            content: record,
            encrypted: false,
            metadata: { description: `Gavel case ${record.no} — ${record.title}` },
        }, (res) => {
            if (!res || res.status !== 'success') {
                console.warn('[Gavel] storageAdd failed:', res && res.statusMessage);
                this.showToast('The verdict stands but did not reach the record.', 'warning', 5000);
                return;
            }
            this.loadCaseLaw();
        });
    }

    // =====================================================================
    // HOST
    // =====================================================================

    hostOpenCase(cfg) {
        const players = this.players();
        this.title = String(cfg.title || '').trim().slice(0, 80) || 'An unnamed grievance';
        this.charge = String(cfg.charge || '').trim().slice(0, 200) || 'Conduct unbecoming.';
        this.defendant = players.includes(cfg.defendant) ? cfg.defendant : this.pick(players);
        this.caseNo += 1;

        this.pending = [];
        this.admitted = [];
        this.votes = new Map();
        this.verdict = null;
        this.sentence = '';

        this.phase = 'evidence';
        this.setDeadline(GV_EVIDENCE_TIME);
        this.broadcastState();
        this._timer = setTimeout(() => this.hostJury(), GV_EVIDENCE_TIME * 1000);
    }

    hostSubmit(from, msg) {
        if (this.phase !== 'evidence') return;
        const text = String(msg.text || '').trim().slice(0, GV_MAX_LEN);
        if (!text || this.pending.length > 50) return;
        // The author is kept at the bench and never broadcast. Anonymity is the
        // reason anybody says anything worth hearing.
        this.pending.push({ id: this._nextId++, text, author: from });
        this.broadcastState();
        this.renderBench();
    }

    hostAdmit(id, admit) {
        const idx = this.pending.findIndex(p => p.id === id);
        if (idx < 0) return;
        const item = this.pending.splice(idx, 1)[0];
        if (admit) this.admitted.push({ text: item.text });
        this.broadcastState();
        this.renderBench();
    }

    hostJury() {
        clearTimeout(this._timer);
        this.phase = 'jury';
        this.votes = new Map();
        this.setDeadline(GV_JURY_TIME);
        this.broadcastState();
        this._timer = setTimeout(() => this.hostTally(), GV_JURY_TIME * 1000);
    }

    hostVote(from, msg) {
        if (this.phase !== 'jury') return;
        if (from === this.defendant) return;          // you do not sit on your own jury
        if (msg.vote !== 'guilty' && msg.vote !== 'not-guilty') return;
        this.votes.set(from, msg.vote);
        this.broadcastState();

        const eligible = this.players().filter(n => n !== this.defendant).length;
        if (this.votes.size >= eligible) {
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this.hostTally(), 600);
        }
    }

    hostTally() {
        clearTimeout(this._timer);
        let guilty = 0, notGuilty = 0;
        this.votes.forEach(v => { if (v === 'guilty') guilty++; else notGuilty++; });
        this.verdict = guilty > notGuilty ? 'guilty' : 'not-guilty';
        this.tally = { guilty, notGuilty };
        this.phase = 'sentence';
        this.setDeadline(0);
        this.broadcastState();
    }

    hostSentence(text) {
        this.sentence = String(text || '').trim().slice(0, 160) || GV_SENTENCES[GV_SENTENCES.length - 1];
        this.phase = 'done';
        this.broadcastState();

        this.recordVerdict({
            no: this.caseNo,
            title: this.title,
            charge: this.charge,
            defendant: this.defendant,
            verdict: this.verdict,
            sentence: this.sentence,
            guilty: this.tally ? this.tally.guilty : 0,
            notGuilty: this.tally ? this.tally.notGuilty : 0,
            at: new Date().toISOString(),
        });
    }

    hostAdjourn() {
        clearTimeout(this._timer);
        this.phase = 'lobby';
        this.setDeadline(0);
        this.broadcastState();
    }

    hostReceive(from, msg) {
        switch (msg.t) {
            case 'hello':  this.broadcastState(); break;
            case 'submit': this.hostSubmit(from, msg); break;
            case 'vote':   this.hostVote(from, msg); break;
            default: break;
        }
    }

    publicState() {
        const eligible = this.players().filter(n => n !== this.defendant).length;
        return {
            t: 'state',
            phase: this.phase,
            caseNo: this.caseNo,
            title: this.title,
            charge: this.charge,
            defendant: this.defendant,
            admitted: this.admitted,
            pendingSize: this.pending.length,
            juryIn: this.votes.size,
            juryOf: eligible,
            verdict: this.verdict,
            tally: this.tally || null,
            sentence: this.sentence,
            secondsLeft: this.secondsLeft(),
        };
    }

    // =====================================================================
    // CLIENT
    // =====================================================================

    clientReceive(msg) {
        if (msg.t === 'state') this.applyState(msg);
    }

    applyState(s) {
        if (s.phase !== this.phase && s.phase === 'jury') this.myVote = null;
        if (s.phase === 'lobby') { this.myVote = null; this.mySubmissions = 0; }
        this.phase = s.phase;
        this.caseNo = s.caseNo;
        this.title = s.title;
        this.charge = s.charge;
        this.defendant = s.defendant;
        this.admitted = s.admitted || [];
        this.pendingSize = s.pendingSize;
        this.juryIn = s.juryIn;
        this.juryOf = s.juryOf;
        this.verdict = s.verdict;
        this.tally = s.tally;
        this.sentence = s.sentence;
        this.adoptDeadline(s.secondsLeft);
        this.renderAll();
    }

    // =====================================================================
    // ACTIONS
    // =====================================================================

    submitTestimony() {
        const input = document.getElementById('testimonyInput');
        const text = (input.value || '').trim();
        if (!text) return;
        this.toHost({ t: 'submit', text: text.slice(0, GV_MAX_LEN) });
        input.value = '';
        this.mySubmissions += 1;
        this.showToast('Submitted. The bench decides whether it is admitted.', 'info', 2400);
        this.renderAll();
    }

    vote(v) {
        if (this.phase !== 'jury' || this.username === this.defendant) return;
        this.myVote = v;
        this.toHost({ t: 'vote', vote: v });
        this.renderAll();
    }

    // =====================================================================
    // UI
    // =====================================================================

    setupUI() {
        const $ = id => document.getElementById(id);

        $('openBtn').addEventListener('click', () => {
            if (!this.isHost()) return;
            this.hostOpenCase({
                title: $('caseTitle').value,
                charge: $('caseCharge').value,
                defendant: $('defendantSelect').value,
            });
        });
        $('sendTestimony').addEventListener('click', () => this.submitTestimony());
        $('testimonyInput').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitTestimony(); }
        });
        $('guiltyBtn').addEventListener('click', () => this.vote('guilty'));
        $('notGuiltyBtn').addEventListener('click', () => this.vote('not-guilty'));
        $('juryNowBtn').addEventListener('click', () => { if (this.isHost()) this.hostJury(); });
        $('adjournBtn').addEventListener('click', () => { if (this.isHost()) this.hostAdjourn(); });

        const sentSel = $('sentenceSelect');
        GV_SENTENCES.forEach(s => {
            const o = document.createElement('option');
            o.value = s; o.textContent = s;
            sentSel.appendChild(o);
        });
        $('passBtn').addEventListener('click', () => {
            if (!this.isHost()) return;
            const custom = $('sentenceCustom').value.trim();
            this.hostSentence(custom || sentSel.value);
        });

        this.startClock('clock');
        this.renderAll();
    }

    renderAll() {
        this.renderPhase();
        this.renderStage();
        this.renderMine();
        this.renderBench();
        this.renderCaseLaw();
        this.renderClock('clock');
        this.renderRoster('lobbyPlayers', u => (u.name === this.defendant ? 'in the dock' : (u.isHost ? 'the bench' : '')));
        this.renderDefendantOptions();
    }

    renderPhase() {
        this.show('lobbyPanel', this.phase === 'lobby');
        this.show('gamePanel', this.phase !== 'lobby');
        this.show('hostControls', this.isHost() && this.phase === 'lobby');
        this.show('guestWait', !this.isHost() && this.phase === 'lobby');
        this.show('benchCard', this.isHost() && this.phase === 'evidence');
        this.show('sentencePanel', this.isHost() && this.phase === 'sentence');
        this.show('juryNowBtn', this.isHost() && this.phase === 'evidence');
        this.show('adjournBtn', this.isHost() && this.phase === 'done');

        const label = { lobby: 'Chambers', evidence: 'Testimony', jury: 'The jury retires', sentence: 'Sentencing', done: 'Judgment' }[this.phase] || '';
        const tone = this.phase === 'evidence' ? 'is-live' : this.phase === 'lobby' ? 'is-off' : 'is-busy';
        this.setPhasePill('phasePill', label, tone);
        this.setText('roundCount', this.phase === 'lobby' ? '' : `Case ${String(this.caseNo).padStart(4, '0')}`);
        this.setText('lobbyCount', this.playerCount() === 1 ? '1 present' : `${this.playerCount()} present`);
    }

    renderStage() {
        this.setText('caseTitleOut', this.title || '');
        this.setText('caseChargeOut', this.charge || '');
        this.setText('defendantOut', this.defendant ? `In the dock: ${this.defendant}` : '');

        const el = document.getElementById('exhibits');
        if (el) {
            el.innerHTML = this.admitted.length
                ? this.admitted.map((a, i) => `
                    <li class="gv-exhibit">
                        <span class="gv-exhibit__no">${String.fromCharCode(65 + i)}</span>
                        <span>${PartyKit.esc(a.text)}</span>
                    </li>`).join('')
                : '<li class="pk-empty">Nothing has been admitted yet.</li>';
        }

        const v = document.getElementById('verdictBox');
        if (v) {
            if (this.phase === 'sentence' || this.phase === 'done') {
                v.hidden = false;
                v.className = 'gv-verdict ' + (this.verdict === 'guilty' ? 'is-guilty' : 'is-clear');
                v.innerHTML = `
                    <div class="gv-verdict__word">${this.verdict === 'guilty' ? 'Guilty' : 'Not guilty'}</div>
                    <div class="gv-verdict__tally">${this.tally ? `${this.tally.guilty} to ${this.tally.notGuilty}` : ''}</div>
                    ${this.sentence ? `<div class="gv-verdict__sentence">${PartyKit.esc(this.sentence)}</div>` : ''}
                    ${this.phase === 'done' ? '<div class="gv-verdict__chain">Written to the record. It cannot be quietly expunged.</div>' : ''}`;
            } else {
                v.hidden = true;
            }
        }

        this.setText('juryCount', this.phase === 'jury' ? `${this.juryIn} of ${this.juryOf} have voted` : '');
    }

    renderMine() {
        const inDock = this.username === this.defendant;
        this.show('testimonyPanel', this.phase === 'evidence');
        this.show('juryPanel', this.phase === 'jury' && !inDock);
        this.show('dockPanel', this.phase === 'jury' && inDock);

        if (this.phase === 'evidence') {
            this.setText('mineCount', this.mySubmissions === 1 ? '1 submitted' : `${this.mySubmissions} submitted`);
            this.setText('pendingNote', `${this.pendingSize || 0} awaiting the bench`);
        }
        if (this.phase === 'jury' && !inDock) {
            document.getElementById('guiltyBtn').classList.toggle('is-on', this.myVote === 'guilty');
            document.getElementById('notGuiltyBtn').classList.toggle('is-on', this.myVote === 'not-guilty');
        }
    }

    renderBench() {
        if (!this.isHost()) return;
        const el = document.getElementById('benchList');
        if (!el) return;
        if (!this.pending.length) {
            el.innerHTML = '<li class="pk-empty">Nothing submitted. The court waits.</li>';
            return;
        }
        el.innerHTML = this.pending.map(p => `
            <li class="gv-pending">
                <span class="gv-pending__text">${PartyKit.esc(p.text)}</span>
                <span class="gv-pending__acts">
                    <button type="button" class="btn btn--sm btn--primary gv-ok" data-id="${p.id}">Admit</button>
                    <button type="button" class="btn btn--sm gv-no" data-id="${p.id}">Strike</button>
                </span>
            </li>`).join('');
        el.querySelectorAll('.gv-ok').forEach(b =>
            b.addEventListener('click', () => this.hostAdmit(parseInt(b.dataset.id, 10), true)));
        el.querySelectorAll('.gv-no').forEach(b =>
            b.addEventListener('click', () => this.hostAdmit(parseInt(b.dataset.id, 10), false)));
    }

    renderDefendantOptions() {
        if (this.phase !== 'lobby' || !this.isHost()) return;
        const sel = document.getElementById('defendantSelect');
        if (!sel) return;
        const current = sel.value;
        const names = this.players();
        sel.innerHTML = '<option value="">Pick at random</option>' +
            names.map(n => `<option value="${PartyKit.esc(n)}">${PartyKit.esc(n)}</option>`).join('');
        if (names.includes(current)) sel.value = current;
    }

    renderCaseLaw() {
        const el = document.getElementById('caseLaw');
        if (!el) return;
        if (!this.caseLaw.length) {
            el.innerHTML = '<li class="pk-empty">No precedent yet. Somebody has to be first.</li>';
            return;
        }
        el.innerHTML = this.caseLaw.slice(-12).reverse().map(c => `
            <li class="gv-law">
                <span class="gv-law__no">${String(c.no).padStart(4, '0')}</span>
                <span class="gv-law__body">
                    <strong>${PartyKit.esc(c.title)}</strong>
                    <em class="${c.verdict === 'guilty' ? 'is-guilty' : ''}">${c.verdict === 'guilty' ? 'Guilty' : 'Not guilty'}</em>
                    ${c.sentence ? `<span>${PartyKit.esc(c.sentence)}</span>` : ''}
                </span>
            </li>`).join('');
    }
}

PartyKit.boot({
    GameClass: GavelGame,
    globalName: 'gavelGame',
    storagePrefix: 'gavel_',
    channelPrefix: 'gavel-',
    title: 'Enter chambers',
    collapsedTitle: 'Gavel',
});
