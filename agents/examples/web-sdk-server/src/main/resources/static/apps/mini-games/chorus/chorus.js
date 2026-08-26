// ============================================================================
// Chorus — forty phones, one creation, one tiny piece each.
//
// Two mechanics, in this order:
//   CHOOSE     your phone shows the prompt for the slot you own and three
//              options. You pick one. You have never seen the sentence.
//   ASSEMBLE   a cue walks the slots on the television. When yours is live,
//              tap. Tap late or not at all and your piece is a hole with your
//              name under it.
//
// Everything the player knows arrives addressed to them (see party-kit.js);
// the television's picture is the only thing broadcast, and it never names
// who owns which slot until the reveal.
// ============================================================================

const CH_CHOOSE_TIME = 25;    // seconds to pick your option
const CH_CUE_MS      = 2400;  // how long each slot stays live
const CH_REVEAL_TIME = 10;    // seconds on the finished creation
const CH_HIT_POINTS  = 10;

class ChorusGame extends PartyKit.PartyGame {
    constructor() {
        super({
            storagePrefix: 'chorus',
            customType: 'chorus',
            dataChannelName: 'chorus-data',
        });

        // public
        this.parts = [];
        this.round = 0;
        this.totalRounds = 3;
        this.templateName = '';
        this.cursor = -1;
        this.scores = [];
        this.feed = [];
        this.holes = [];

        // private to me
        this.mySlots = [];      // [{i, prompt, options, chosen}]
        this.liveSlot = -1;

        // host only
        this.slots = [];
        this.owner = new Map();     // slot index -> player
        this.chosen = new Map();    // slot index -> value
        this.score = new Map();
        this.deck = [];
        this._timer = null;
        this._cueTimer = null;
    }

    async onInitialize() { this.setupUI(); }

    // =====================================================================
    // HOST
    // =====================================================================

    hostStart(cfg) {
        this.totalRounds = cfg.rounds || 3;
        this.deck = this.shuffled(window.ChorusTemplates.TEMPLATES).slice(0, this.totalRounds);
        while (this.deck.length < this.totalRounds) {
            this.deck.push(this.pick(window.ChorusTemplates.TEMPLATES));
        }
        this.round = 0;
        this.score = new Map();
        this.players().forEach(n => this.score.set(n, 0));
        this.hostNextRound();
    }

    hostNextRound() {
        clearTimeout(this._timer);
        clearTimeout(this._cueTimer);
        this.round += 1;
        if (this.round > this.totalRounds) return this.hostOver();

        const players = this.players();
        players.forEach(n => { if (!this.score.has(n)) this.score.set(n, 0); });

        const template = this.deck[this.round - 1];
        const built = window.ChorusTemplates.buildRound(template, players.length);
        this.parts = built.parts;
        this.slots = built.slots;
        this.templateName = template.name;
        this.cursor = -1;
        this.owner = new Map();
        this.chosen = new Map();
        this.holes = [];
        this.feed = [];

        // Deal the slots round-robin so ownership is even and nobody idles.
        const order = this.shuffled(players);
        this.slots.forEach((slot, idx) => this.owner.set(slot.i, order[idx % order.length]));

        // Tell each player only about their own slots. Never the sentence.
        players.forEach(name => {
            const mine = this.slots
                .filter(s => this.owner.get(s.i) === name)
                .map(s => ({ i: s.i, prompt: s.prompt, options: s.options }));
            this.toPlayer(name, { t: 'deal', round: this.round, slots: mine });
        });

        this.phase = 'choose';
        this.setDeadline(CH_CHOOSE_TIME);
        this.broadcastState();
        this._timer = setTimeout(() => this.hostAssemble(), CH_CHOOSE_TIME * 1000);
    }

    hostChoose(from, msg) {
        if (this.phase !== 'choose') return;
        const slot = this.slots.find(s => s.i === msg.slot);
        if (!slot || this.owner.get(slot.i) !== from) return;
        if (!slot.options.includes(msg.option)) return;
        this.chosen.set(slot.i, msg.option);

        // Everybody chosen? Get on with it.
        if (this.chosen.size >= this.slots.length) {
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this.hostAssemble(), 700);
        }
        this.broadcastState();
    }

    hostAssemble() {
        clearTimeout(this._timer);
        this.phase = 'assemble';
        this.cursor = -1;
        this.setDeadline(0);
        this.broadcastState();
        this.hostAdvanceCue();
    }

    hostAdvanceCue() {
        clearTimeout(this._cueTimer);
        this.cursor += 1;

        if (this.cursor >= this.slots.length) return this.hostReveal();

        const slot = this.slots[this.cursor];
        slot.tapped = false;
        this.broadcastState();

        this._cueTimer = setTimeout(() => {
            // The window closed. If they did not tap, the hole is theirs.
            if (!slot.tapped) {
                const who = this.owner.get(slot.i);
                slot.value = null;
                this.holes.push({ slot: slot.i, who });
                this.feed.unshift({ text: `${who} missed slot ${slot.i + 1}.`, bad: true });
            }
            this.hostAdvanceCue();
        }, CH_CUE_MS);
    }

    hostTap(from, msg) {
        if (this.phase !== 'assemble') return;
        const slot = this.slots[this.cursor];
        if (!slot || slot.i !== msg.slot) return;
        if (this.owner.get(slot.i) !== from) return;
        if (slot.tapped) return;

        slot.tapped = true;
        const value = this.chosen.get(slot.i);
        if (!value) {
            // Tapped, but never chose anything to place.
            this.holes.push({ slot: slot.i, who: from });
            this.feed.unshift({ text: `${from} had nothing ready for slot ${slot.i + 1}.`, bad: true });
        } else {
            slot.value = value;
            this.score.set(from, (this.score.get(from) || 0) + CH_HIT_POINTS);
            this.feed.unshift({ text: `${from} placed "${value}".`, bad: false });
        }
        if (this.feed.length > 20) this.feed.pop();
        this.broadcastState();

        // Move on early — waiting out a full window after a tap kills the pace.
        clearTimeout(this._cueTimer);
        this._cueTimer = setTimeout(() => this.hostAdvanceCue(), 650);
    }

    hostReveal() {
        clearTimeout(this._cueTimer);
        this.phase = 'reveal';
        this.cursor = -1;
        this.setDeadline(CH_REVEAL_TIME);
        this.broadcastState();
        this._timer = setTimeout(() => {
            if (this.round >= this.totalRounds) this.hostOver();
            else this.hostNextRound();
        }, CH_REVEAL_TIME * 1000);
    }

    hostOver() {
        clearTimeout(this._timer);
        clearTimeout(this._cueTimer);
        this.phase = 'over';
        this.setDeadline(0);
        this.broadcastState();
    }

    hostAbort() {
        clearTimeout(this._timer);
        clearTimeout(this._cueTimer);
        this.phase = 'lobby';
        this.parts = [];
        this.setDeadline(0);
        this.broadcastState();
    }

    hostReceive(from, msg) {
        if (!this.score.has(from)) this.score.set(from, 0);
        switch (msg.t) {
            case 'hello':  this.broadcastState(); break;
            case 'choose': this.hostChoose(from, msg); break;
            case 'tap':    this.hostTap(from, msg); break;
            default: break;
        }
    }

    scoreList() {
        const out = [];
        this.score.forEach((v, k) => out.push({ name: k, score: v }));
        out.sort((a, b) => b.score - a.score);
        return out;
    }

    publicState() {
        // The parts carry values but never owners — the room sees WHAT was
        // placed, not who placed it, until the reveal.
        const parts = this.parts.map(p => (typeof p === 'string'
            ? p
            : { i: p.i, value: p.value, live: this.phase === 'assemble' && this.cursor === this.slots.findIndex(s => s.i === p.i) }));

        return {
            t: 'state',
            phase: this.phase,
            round: this.round,
            totalRounds: this.totalRounds,
            templateName: this.templateName,
            parts,
            slotCount: this.slots.length,
            chosenCount: this.chosen.size,
            cursorSlot: this.phase === 'assemble' && this.slots[this.cursor] ? this.slots[this.cursor].i : -1,
            secondsLeft: this.secondsLeft(),
            scores: this.scoreList(),
            feed: this.feed.slice(0, 12),
            holes: this.phase === 'reveal' || this.phase === 'over' ? this.holes : [],
        };
    }

    // =====================================================================
    // CLIENT
    // =====================================================================

    clientReceive(msg) {
        switch (msg.t) {
            case 'state': this.applyState(msg); break;
            case 'deal':
                this.mySlots = (msg.slots || []).map(s => Object.assign({ chosen: null }, s));
                this.dealRound = msg.round;
                this.renderAll();
                break;
            default: break;
        }
    }

    applyState(s) {
        if (s.round !== this.round) { this.liveSlot = -1; }
        if (s.phase === 'lobby') { this.mySlots = []; }
        if (this.dealRound && this.dealRound !== s.round) this.mySlots = [];

        this.phase = s.phase;
        this.round = s.round;
        this.totalRounds = s.totalRounds;
        this.templateName = s.templateName;
        this.parts = s.parts || [];
        this.slotCount = s.slotCount;
        this.chosenCount = s.chosenCount;
        this.liveSlot = s.cursorSlot;
        this.scores = s.scores || [];
        this.feed = s.feed || [];
        this.holes = s.holes || [];
        this.adoptDeadline(s.secondsLeft);
        this.renderAll();
    }

    // =====================================================================
    // ACTIONS
    // =====================================================================

    choose(slotIndex, option) {
        const slot = this.mySlots.find(s => s.i === slotIndex);
        if (!slot || this.phase !== 'choose') return;
        slot.chosen = option;
        this.toHost({ t: 'choose', slot: slotIndex, option });
        this.renderAll();
    }

    tap() {
        if (this.phase !== 'assemble') return;
        if (!this.mySlots.some(s => s.i === this.liveSlot)) return;
        this.toHost({ t: 'tap', slot: this.liveSlot });
        const btn = document.getElementById('tapBtn');
        if (btn) { btn.classList.remove('pk-pulse'); void btn.offsetWidth; btn.classList.add('pk-pulse'); }
    }

    // =====================================================================
    // UI
    // =====================================================================

    setupUI() {
        const $ = id => document.getElementById(id);

        $('startBtn').addEventListener('click', () => {
            if (!this.isHost()) return;
            this.hostStart({ rounds: parseInt($('roundsSelect').value, 10) });
        });
        $('againBtn').addEventListener('click', () => { if (this.isHost()) this.hostAbort(); });
        $('tapBtn').addEventListener('click', () => this.tap());

        document.addEventListener('keydown', (e) => {
            if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
            if (e.code === 'Space') { e.preventDefault(); this.tap(); }
        });

        this.startClock('clock');
        this.renderAll();
    }

    renderAll() {
        this.renderPhase();
        this.renderStage();
        this.renderMine();
        this.renderScores();
        this.renderFeed();
        this.renderClock('clock');
        this.renderRoster('lobbyPlayers');
    }

    renderPhase() {
        const inGame = this.phase !== 'lobby';
        this.show('lobbyPanel', this.phase === 'lobby');
        this.show('gamePanel', inGame && this.phase !== 'over');
        this.show('overPanel', this.phase === 'over');
        this.show('hostControls', this.isHost() && this.phase === 'lobby');
        this.show('guestWait', !this.isHost() && this.phase === 'lobby');
        this.show('againBtn', this.isHost());

        const label = { lobby: 'Lobby', choose: 'Choosing', assemble: 'Assembling', reveal: 'The reveal', over: 'Finished' }[this.phase] || '';
        const tone = this.phase === 'assemble' ? 'is-live' : this.phase === 'lobby' ? 'is-off' : 'is-busy';
        this.setPhasePill('phasePill', label, tone);
        this.setText('roundCount', this.phase === 'lobby' ? '' : `Round ${this.round} / ${this.totalRounds}`);
        this.setText('templateName', this.templateName || '');
        this.setText('lobbyCount', this.playerCount() === 1 ? '1 player' : `${this.playerCount()} players`);
    }

    renderStage() {
        const el = document.getElementById('creation');
        if (!el) return;
        if (!this.parts.length) { el.innerHTML = ''; return; }

        el.innerHTML = this.parts.map(p => {
            if (typeof p === 'string') return `<span class="ch-lit">${PartyKit.esc(p)}</span>`;
            const mine = this.mySlots.some(s => s.i === p.i);
            if (p.value) {
                return `<span class="ch-slot is-filled${mine ? ' is-mine' : ''}">${PartyKit.esc(p.value)}</span>`;
            }
            const hole = this.holes.find(h => h.slot === p.i);
            if (hole) return `<span class="ch-slot is-hole" title="${PartyKit.esc(hole.who)}">${PartyKit.esc(hole.who)}</span>`;
            const live = p.live || this.liveSlot === p.i;
            return `<span class="ch-slot${live ? ' is-live' : ''}${mine ? ' is-mine' : ''}">&nbsp;&nbsp;&nbsp;&nbsp;</span>`;
        }).join('');

        this.setText('progress', this.phase === 'choose'
            ? `${this.chosenCount || 0} of ${this.slotCount || 0} pieces chosen`
            : this.phase === 'reveal'
                ? (this.holes.length ? `${this.holes.length} hole${this.holes.length === 1 ? '' : 's'}` : 'Nobody missed. Suspicious.')
                : '');
    }

    renderMine() {
        const box = document.getElementById('minePanel');
        if (!box) return;

        if (this.phase === 'choose' && this.mySlots.length) {
            box.hidden = false;
            document.getElementById('mineTitle').textContent =
                this.mySlots.length === 1 ? 'Your piece' : `Your ${this.mySlots.length} pieces`;
            document.getElementById('mineBody').innerHTML = this.mySlots.map(s => `
                <div class="ch-mine">
                    <div class="ch-mine__prompt">Slot ${s.i + 1} — ${PartyKit.esc(s.prompt)}</div>
                    <div class="pk-choices">
                        ${s.options.map(o => `<button type="button" class="pk-choice${s.chosen === o ? ' is-on' : ''}"
                            data-slot="${s.i}" data-opt="${PartyKit.esc(o)}">${PartyKit.esc(o)}</button>`).join('')}
                    </div>
                </div>`).join('');
            box.querySelectorAll('.pk-choice').forEach(b => {
                b.addEventListener('click', () =>
                    this.choose(parseInt(b.dataset.slot, 10), b.dataset.opt));
            });
            this.show('tapWrap', false);
            return;
        }

        if (this.phase === 'assemble') {
            box.hidden = false;
            const mineLive = this.mySlots.some(s => s.i === this.liveSlot);
            document.getElementById('mineTitle').textContent = mineLive ? 'Now — this one is yours' : 'Watch for your slot';
            const next = this.mySlots.find(s => s.i > this.liveSlot);
            document.getElementById('mineBody').innerHTML = mineLive
                ? `<p class="pk-secret__body">${PartyKit.esc(this.mySlots.find(s => s.i === this.liveSlot).chosen || 'you never chose one')}</p>`
                : `<p class="pk-secret__hint">${next ? `Yours is slot ${next.i + 1}.` : 'All of yours are done.'}</p>`;
            this.show('tapWrap', true);
            const btn = document.getElementById('tapBtn');
            btn.disabled = !mineLive;
            btn.innerHTML = mineLive ? 'TAP<small>place your piece</small>' : 'WAIT<small>not your slot yet</small>';
            return;
        }

        if (this.phase === 'choose' && !this.mySlots.length) {
            box.hidden = false;
            document.getElementById('mineTitle').textContent = 'Waiting for a slot';
            document.getElementById('mineBody').innerHTML =
                '<p class="pk-secret__hint">The round has started without you — you will be dealt in next round.</p>';
            this.show('tapWrap', false);
            return;
        }

        box.hidden = true;
        this.show('tapWrap', false);
    }

    renderScores() {
        const el = document.getElementById('scores');
        if (!el) return;
        const rows = this.scores.length ? this.scores : this.players().map(n => ({ name: n, score: 0 }));
        el.innerHTML = rows.map((r, i) => `
            <li class="pk-rank${r.name === this.username ? ' is-me' : ''}">
                <span class="pk-rank__pos">${i + 1}</span>
                <span class="pk-rank__name">${PartyKit.esc(r.name)}</span>
                <span class="pk-rank__score">${r.score}</span>
            </li>`).join('');

        if (this.phase === 'over' && rows.length) {
            this.setText('overTitle', `${rows[0].name} placed the most — ${rows[0].score}`);
        }
    }

    renderFeed() {
        const el = document.getElementById('feed');
        if (!el) return;
        if (!this.feed.length) { el.innerHTML = '<li class="pk-empty">Nothing placed yet.</li>'; return; }
        el.innerHTML = this.feed.map(f =>
            `<li class="${f.bad ? 'is-bad' : 'is-good'}">${PartyKit.esc(f.text)}</li>`).join('');
    }
}

PartyKit.boot({
    GameClass: ChorusGame,
    globalName: 'chorusGame',
    storagePrefix: 'chorus_',
    channelPrefix: 'chorus-',
    title: 'Join Chorus',
    collapsedTitle: 'Chorus',
});
