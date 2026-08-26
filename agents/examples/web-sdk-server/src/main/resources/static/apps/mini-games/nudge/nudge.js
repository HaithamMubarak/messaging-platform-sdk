// ============================================================================
// Nudge — secret missions at the dinner table.
//
// The game deals twelve briefings into twelve pockets in thirty seconds and
// then gets out of the way. The television shows a ticker and nothing else,
// all evening, on purpose: the play is the conversation, not the screen.
//
// Two people are dealt NO mission, and everybody knows those cards exist.
// That is the engine — the innocent radiate suspicion for free, and at the
// reveal the whole evening reinterprets itself at once.
//
// Every briefing is addressed to one player. A broadcast here would end the
// game before the starter arrived.
// ============================================================================

const NG_CLAIM_TIME  = 12;   // seconds the table has to agree a claim
const NG_MISSION_PTS = 100;
const NG_HARD_PTS    = 150;  // a mission that takes real steering
const NG_BLUFF_PTS   = 150;  // an innocent who talks a claim past the table
const NG_CATCH_PTS   = 150;
const NG_WRONG_PTS   = -75;
const NG_INNOCENT_PTS = 100;

class NudgeGame extends PartyKit.PartyGame {
    constructor() {
        super({
            storagePrefix: 'nudge',
            customType: 'nudge',
            dataChannelName: 'nudge-data',
        });

        // public
        this.completed = 0;
        this.claim = null;        // {by, yes, no, of}
        this.accusedCount = 0;
        this.scores = [];
        this.reveal = null;

        // private
        this.mission = null;      // the text, or null when you are an innocent
        this.missionHard = false;
        this.missionsDone = 0;
        this.hasMission = false;
        this.dealt = false;
        this.myAccusation = null;
        this.claimedDone = false;

        // host only
        this.missions = new Map();   // player -> text | null
        this.score = new Map();
        this.accusations = new Map();// accuser -> accused
        this.votes = new Map();
        this._timer = null;
    }

    async onInitialize() { this.setupUI(); }

    // =====================================================================
    // HOST
    // =====================================================================

    hostStart() {
        const players = this.players();
        if (players.length < 3) {
            this.showToast('Nudge needs at least three people at the table.', 'warning', 4000);
            return;
        }

        // Two innocents in a decent-sized room, one in a small one — the
        // proportion matters more than the number.
        const innocents = players.length >= 6 ? 2 : 1;
        const order = this.shuffled(players);
        const noMission = new Set(order.slice(0, innocents));

        this.missions = new Map();
        this.score = new Map();
        this.accusations = new Map();
        this.completedList = [];
        this.completed = 0;
        this.claim = null;

        this.deck = this.shuffled(window.NudgeMissions.MISSIONS);
        this._deckAt = 0;
        this.done = new Map();
        players.forEach(name => {
            this.score.set(name, 0);
            this.done.set(name, 0);
            if (noMission.has(name)) { this.missions.set(name, null); return; }
            this.missions.set(name, this.dealOne(name));
        });

        this.phase = 'live';
        this.setDeadline(0);
        this.broadcastState();
        players.forEach(name => this.sendMission(name));
    }

    /** One mission, aimed at somebody who is actually at the table. */
    dealOne(name) {
        const targets = this.players().filter(n => n !== name);
        if (!targets.length) return null;
        const card = this.deck[this._deckAt++ % this.deck.length];
        return { text: card.text.replace('{target}', this.pick(targets)), hard: !!card.hard };
    }

    sendMission(name) {
        const m = this.missions.get(name);
        this.toPlayer(name, {
            t: 'mission',
            text: m ? m.text : null,
            hard: !!(m && m.hard),
            done: this.done ? (this.done.get(name) || 0) : 0,
            hasMission: m !== null && m !== undefined,
        });
    }

    hostClaim(from) {
        if (this.phase !== 'live' || this.claim) return;
        if (!this.missions.has(from) || this.missions.get(from) === null) {
            // An innocent claiming is a bluff the table gets to judge anyway.
        }
        this.votes = new Map();
        this.claim = { by: from, yes: 0, no: 0, of: this.playerCount() - 1 };
        this.setDeadline(NG_CLAIM_TIME);
        this.broadcastState();
        this._timer = setTimeout(() => this.hostResolveClaim(), NG_CLAIM_TIME * 1000);
    }

    hostVote(from, msg) {
        if (!this.claim || from === this.claim.by) return;
        this.votes.set(from, msg.yes === true);
        let yes = 0, no = 0;
        this.votes.forEach(v => (v ? yes++ : no++));
        this.claim.yes = yes;
        this.claim.no = no;
        this.broadcastState();
        if (this.votes.size >= this.claim.of) {
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this.hostResolveClaim(), 500);
        }
    }

    hostResolveClaim() {
        clearTimeout(this._timer);
        if (!this.claim) return;
        const c = this.claim;
        const carried = c.yes > c.no;
        let bluff = false;
        if (carried) {
            this.completed += 1;
            const m = this.missions.get(c.by);
            if (m) {
                this.score.set(c.by, (this.score.get(c.by) || 0) + (m.hard ? NG_HARD_PTS : NG_MISSION_PTS));
                this.done.set(c.by, (this.done.get(c.by) || 0) + 1);
                // Finishing your job does not retire you for the evening —
                // without this, half the table has nothing to do by pudding.
                this.missions.set(c.by, this.dealOne(c.by));
                this.sendMission(c.by);
            } else {
                // An innocent talked a claim past the table. That deserves more
                // than a mission does.
                bluff = true;
                this.score.set(c.by, (this.score.get(c.by) || 0) + NG_BLUFF_PTS);
                this.done.set(c.by, (this.done.get(c.by) || 0) + 1);
                this.sendMission(c.by);
            }
            this.completedList.push({ by: c.by, at: Date.now(), bluff });
        }
        this.lastClaim = { by: c.by, carried, yes: c.yes, no: c.no, bluff };
        this.claim = null;
        this.setDeadline(0);
        this.broadcastState();
    }

    hostAccuse(from, msg) {
        if (this.phase !== 'live') return;
        if (this.accusations.has(from)) return;          // one each, all evening
        if (!msg.who || msg.who === from) return;
        this.accusations.set(from, msg.who);
        this.broadcastState();
        this.toPlayer(from, { t: 'accused', who: msg.who });
    }

    hostEnd() {
        clearTimeout(this._timer);
        this.claim = null;

        // Settle the accusations: naming somebody who was dealt NO mission is
        // the read the whole game is about.
        const caught = new Set();
        this.accusations.forEach((accused, accuser) => {
            const innocent = this.missions.get(accused) === null;
            this.score.set(accuser, (this.score.get(accuser) || 0) + (innocent ? NG_CATCH_PTS : NG_WRONG_PTS));
            if (innocent) caught.add(accused);
        });
        this.missions.forEach((m, name) => {
            if (m === null && !caught.has(name)) {
                this.score.set(name, (this.score.get(name) || 0) + NG_INNOCENT_PTS);
            }
        });

        const rows = [];
        this.missions.forEach((m, name) => {
            const namedBy = [];
            this.accusations.forEach((accused, accuser) => { if (accused === name) namedBy.push(accuser); });
            rows.push({ name, mission: m ? m.text : null, hard: !!(m && m.hard), done: this.done.get(name) || 0, namedBy });
        });
        this.reveal = { rows, completed: this.completed };

        this.phase = 'over';
        this.broadcastState();
    }

    hostReset() {
        clearTimeout(this._timer);
        this.phase = 'lobby';
        this.reveal = null;
        this.claim = null;
        this.completed = 0;
        this.broadcastState();
    }

    hostReceive(from, msg) {
        switch (msg.t) {
            case 'hello':
                this.broadcastState();
                // Somebody who refreshed gets their briefing back, or they
                // spend the rest of dinner wondering what they were meant to do.
                if (this.phase === 'live' && this.missions.has(from)) this.sendMission(from);
                break;
            case 'claim':  this.hostClaim(from); break;
            case 'vote':   this.hostVote(from, msg); break;
            case 'accuse': this.hostAccuse(from, msg); break;
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
        return {
            t: 'state',
            phase: this.phase,
            completed: this.completed,
            claim: this.claim,
            lastClaim: this.lastClaim || null,
            accusedCount: this.accusations ? this.accusations.size : 0,
            playerCount: this.playerCount(),
            secondsLeft: this.secondsLeft(),
            scores: this.phase === 'over' ? this.scoreList() : [],
            reveal: this.reveal,
        };
    }

    // =====================================================================
    // CLIENT
    // =====================================================================

    clientReceive(msg) {
        switch (msg.t) {
            case 'state': this.applyState(msg); break;
            case 'mission':
                this.mission = msg.text;
                this.missionHard = !!msg.hard;
                this.missionsDone = msg.done || 0;
                this.hasMission = !!msg.hasMission;
                this.dealt = true;
                this.claimedDone = false;
                PartySFX.play('deal');
                this.renderAll();
                break;
            case 'accused':
                this.myAccusation = msg.who;
                this.renderAll();
                break;
            default: break;
        }
    }

    applyState(s) {
        if (s.claim && !this.claim) PartySFX.play('claim');
        if (!s.claim && this.claim) PartySFX.play(s.lastClaim && s.lastClaim.carried ? 'carried' : 'thrown');
        if (s.phase === 'over' && this.phase !== 'over') PartySFX.play('applause');

        if (s.phase === 'lobby') {
            this.mission = null; this.hasMission = false; this.dealt = false;
            this.missionHard = false; this.missionsDone = 0;
            this.myAccusation = null; this.claimedDone = false;
        }
        this.phase = s.phase;
        this.completed = s.completed;
        this.claim = s.claim;
        this.lastClaim = s.lastClaim;
        this.accusedCount = s.accusedCount;
        this.tablePlayers = s.playerCount;
        this.scores = s.scores || [];
        this.reveal = s.reveal;
        this.adoptDeadline(s.secondsLeft);
        this.renderAll();
    }

    // =====================================================================
    // ACTIONS
    // =====================================================================

    claimMission() {
        if (this.phase !== 'live' || this.claim) return;
        this.claimedDone = true;
        this.toHost({ t: 'claim' });
    }

    voteClaim(yes) {
        if (!this.claim || this.claim.by === this.username) return;
        this.myClaimVote = yes;
        this.toHost({ t: 'vote', yes });
        this.renderAll();
    }

    accuse(who) {
        if (this.myAccusation) return;
        this.toHost({ t: 'accuse', who });
    }

    // =====================================================================
    // UI
    // =====================================================================

    setupUI() {
        const $ = id => document.getElementById(id);
        $('startBtn').addEventListener('click', () => { if (this.isHost()) this.hostStart(); });
        $('endBtn').addEventListener('click', () => { if (this.isHost()) this.hostEnd(); });
        $('againBtn').addEventListener('click', () => { if (this.isHost()) this.hostReset(); });
        $('claimBtn').addEventListener('click', () => this.claimMission());
        $('voteYes').addEventListener('click', () => this.voteClaim(true));
        $('voteNo').addEventListener('click', () => this.voteClaim(false));
        PartySFX.attachToggle('soundBtn');
        this.startClock('clock');
        this.renderAll();
    }

    renderAll() {
        this.renderPhase();
        this.renderTicker();
        this.renderMission();
        this.renderClaim();
        this.renderAccuse();
        this.renderReveal();
        this.renderClock('clock');
        this.renderRoster('lobbyPlayers');
    }

    renderPhase() {
        this.show('lobbyPanel', this.phase === 'lobby');
        this.show('gamePanel', this.phase === 'live');
        this.show('overPanel', this.phase === 'over');
        this.show('hostControls', this.isHost() && this.phase === 'lobby');
        this.show('guestWait', !this.isHost() && this.phase === 'lobby');
        this.show('endBtn', this.isHost() && this.phase === 'live');
        this.show('againBtn', this.isHost() && this.phase === 'over');

        const label = { lobby: 'The table', live: 'In play', over: 'The reveal' }[this.phase] || '';
        this.setPhasePill('phasePill', label, this.phase === 'live' ? 'is-live' : this.phase === 'lobby' ? 'is-off' : 'is-busy');
        this.setText('lobbyCount', this.playerCount() === 1 ? '1 at the table' : `${this.playerCount()} at the table`);
    }

    renderTicker() {
        this.setText('tickerDone', this.completed);
        this.setText('tickerDoneLabel', this.completed === 1 ? 'mission completed' : 'missions completed');
        this.setText('tickerAcc', this.accusedCount || 0);
        this.setText('tickerAccLabel', (this.accusedCount === 1 ? 'accusation' : 'accusations') + ' made');

        const note = document.getElementById('tickerNote');
        if (note) {
            note.textContent = this.claim
                ? `${this.claim.by} says they have done it.`
                : this.lastClaim
                    ? `${this.lastClaim.by}'s claim was ${this.lastClaim.carried ? 'allowed' : 'thrown out'} (${this.lastClaim.yes}–${this.lastClaim.no}).`
                    : 'Nothing to see here. Carry on eating.';
        }
    }

    renderMission() {
        const box = document.getElementById('missionPanel');
        if (!box) return;
        if (this.phase !== 'live' || !this.dealt) { box.hidden = true; return; }
        box.hidden = false;

        if (this.hasMission) {
            this.setText('missionLabel',
                (this.missionHard ? 'Your mission — the hard kind' : 'Your mission — nobody else has it') +
                (this.missionsDone ? ` · ${this.missionsDone} done` : ''));
            document.getElementById('missionText').textContent = this.mission || '';
            this.setText('missionHint', this.missionHard
                ? 'This one is worth more, and it will take some steering. Land it and you get another.'
                : 'It has to happen in front of everyone, and it has to be something you could talk them into. Land it and you get another.');
        } else {
            this.setText('missionLabel',
                'You were dealt nothing' + (this.missionsDone ? ` · ${this.missionsDone} bluff${this.missionsDone === 1 ? '' : 's'} landed` : ''));
            document.getElementById('missionText').textContent = 'You have no mission. Act natural.';
            this.setText('missionHint', 'Everybody knows this card exists. You may still claim — talk a claim past the table and it pays better than a mission does.');
        }

        const btn = document.getElementById('claimBtn');
        btn.disabled = !!this.claim;
        btn.innerHTML = this.claim ? 'A CLAIM IS OPEN<small>wait your turn</small>' : 'DONE IT<small>the table will vote</small>';
    }

    renderClaim() {
        const box = document.getElementById('claimPanel');
        if (!box) return;
        const open = this.phase === 'live' && this.claim && this.claim.by !== this.username;
        box.hidden = !open;
        if (!open) return;
        this.setText('claimWho', `${this.claim.by} says they just completed a mission.`);
        this.setText('claimTally', `${this.claim.yes} yes · ${this.claim.no} no`);
        document.getElementById('voteYes').classList.toggle('is-on', this.myClaimVote === true);
        document.getElementById('voteNo').classList.toggle('is-on', this.myClaimVote === false);
    }

    renderAccuse() {
        const box = document.getElementById('accusePanel');
        if (!box) return;
        if (this.phase !== 'live' || !this.dealt) { box.hidden = true; return; }
        box.hidden = false;

        if (this.myAccusation) {
            document.getElementById('accuseList').innerHTML =
                `<p class="pk-secret__hint">You named <strong>${PartyKit.esc(this.myAccusation)}</strong>. One accusation each — that was yours.</p>`;
            return;
        }
        document.getElementById('accuseList').innerHTML = this.others().map(n =>
            `<button type="button" class="pk-choice ng-accuse" data-who="${PartyKit.esc(n)}">${PartyKit.esc(n)}</button>`
        ).join('') || '<p class="pk-secret__hint">Nobody else here yet.</p>';
        document.getElementById('accuseList').querySelectorAll('.ng-accuse').forEach(b =>
            b.addEventListener('click', () => this.accuse(b.dataset.who)));
    }

    renderReveal() {
        if (this.phase !== 'over' || !this.reveal) return;
        const el = document.getElementById('revealBody');
        if (!el) return;

        const scoreOf = n => {
            const r = (this.scores || []).find(s => s.name === n);
            return r ? r.score : 0;
        };
        const rows = this.reveal.rows.slice().sort((a, b) => scoreOf(b.name) - scoreOf(a.name));

        el.innerHTML = `
            <div class="pk-table-wrap">
              <table class="pk-table">
                <thead><tr><th>Who</th><th>What they were doing all evening</th><th class="num">Named by</th><th class="num">Score</th></tr></thead>
                <tbody>
                  ${rows.map(r => `
                    <tr class="${r.name === this.username ? 'is-me' : ''}">
                      <td>${PartyKit.esc(r.name)}</td>
                      <td>${r.mission
                          ? PartyKit.esc(r.mission) + (r.hard ? ' <span class="ng-hard">hard</span>' : '')
                          : '<span class="ng-innocent">Nothing at all.</span>'}${r.done ? `<span class="ng-done">${r.done} landed</span>` : ''}</td>
                      <td class="num">${r.namedBy.length ? PartyKit.esc(r.namedBy.join(', ')) : '—'}</td>
                      <td class="num">${scoreOf(r.name)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`;

        if (this.scores && this.scores.length) {
            this.setText('overTitle', `${this.scores[0].name} read the table best — ${this.scores[0].score}`);
        }
    }
}

PartyKit.boot({
    GameClass: NudgeGame,
    globalName: 'nudgeGame',
    storagePrefix: 'nudge_',
    channelPrefix: 'nudge-',
    title: 'Sit down at the table',
    collapsedTitle: 'Nudge',
});
