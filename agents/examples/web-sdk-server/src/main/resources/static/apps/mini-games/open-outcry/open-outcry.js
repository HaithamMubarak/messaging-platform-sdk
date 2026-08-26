// ============================================================================
// Open Outcry — a trading-floor party game.
//
// The room trades a claim instead of answering it. Every tap buys one share of
// YES or NO at the price the room's own flow has pushed it to; the tape prints
// anonymously so everybody can see WHAT happened but not WHO did it. Each
// round one player has been dealt the truth — the insider — and their problem
// is making money without the room reading it off the tape. When the market
// closes everyone names who they think it was.
//
// ---------------------------------------------------------------------------
// TRANSPORT — the rule this game lives or dies on
//
// UserConnectionBase in host mode auto-relays anything a client sends with a
// bare sendData(payload) to every other client BEFORE this app ever sees it.
// A broadcast order would therefore leak the insider's hand the instant they
// traded. So:
//
//   * every client message is ADDRESSED to the host — sendData(msg, hostName)
//   * only the host broadcasts, and it broadcasts the anonymised view
//   * clients accept host traffic only when it actually came from the host
//     (peerId check, not just the _fromHost flag, which a peer could forge)
//
// The host is the matching engine, the market maker and the referee. Clients
// hold no authority at all: they render what the host tells them.
// ============================================================================

const OO_START_CASH = 1000;   // every trader's opening bankroll, whole game
const OO_IMPACT     = 4;      // price move, in points, per share of flow
const OO_MIN_PRICE  = 3;
const OO_MAX_PRICE  = 97;
const OO_VOTE_TIME  = 18;     // seconds to name the insider
const OO_SETTLE_TIME = 9;     // seconds on the settlement screen
const OO_SUBJECT_TIME = 20;   // seconds for a room claim's subject to answer
const OO_CAUGHT_FINE = 50;    // paid by a caught insider to each correct accuser
const OO_CLEAN_BONUS = 100;   // paid to an insider the room failed to name

class OpenOutcryGame extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'outcry',
            customType: 'open-outcry',
            autoCreateDataChannel: true,
            dataChannelName: 'outcry-data',
            dataChannelOptions: { ordered: true, maxRetransmits: 3 },
        });

        // ---- public state (every client holds a copy, host owns the truth)
        this.phase = 'lobby';       // lobby | subject | open | vote | settle | over
        this.round = 0;
        this.totalRounds = 6;
        this.claimText = '';
        this.price = 50;            // price of YES, 0..100
        this.history = [50];
        this.tape = [];             // newest first, anonymised
        this.standings = [];        // [{name, cash}]
        this.deadline = 0;          // local ms timestamp the phase ends
        this.settleView = null;     // settlement payload while phase === 'settle'
        this.voteCandidates = [];
        this.myVote = null;

        // ---- private to me
        this.wallet = { cash: OO_START_CASH, yes: 0, no: 0 };
        this.secret = null;         // {kind, truth, text} when I am the insider
        this.lot = 1;

        // ---- host-only
        this.book = new Map();      // name -> {cash, yes, no, roundSpent}
        this.deck = [];
        this.claim = null;
        this.insider = null;
        this.truth = null;
        this.votes = new Map();     // voter -> accused
        this.subjectAnswer = null;
        this.packId = 'house';
        this.practice = false;
        this._phaseTimer = null;
        this._tickTimer = null;
        this._seenOrders = new Set();

        this._chartCtx = null;
    }

    // =====================================================================
    // lifecycle
    // =====================================================================

    async onInitialize() {
        this.setupUI();
    }

    onConnect() {
        this.renderAll();
        const share = document.getElementById('shareBtn');
        if (share) share.hidden = false;

        const room = document.getElementById('outcryRoomName');
        if (room) room.textContent = this.channelName || this.channel?.channelName || 'connected';

        setTimeout(() => {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            // A late joiner asks the host for the current picture.
            if (!this.isHost()) this.toHost({ t: 'hello' });
            this.renderAll();
        }, 900);
    }

    onUserJoin() {
        if (this.isHost()) {
            this.ensureTrader(null);
            this.broadcastState();
        }
        this.renderAll();
    }

    onUserLeave(detail) {
        const name = detail && (detail.username || detail.name || detail.agentName);
        if (this.isHost() && name) {
            // Their money stays on the books — if they come back they get it.
            this.votes.delete(name);
            this.broadcastState();
        }
        this.renderAll();
    }

    onDataChannelOpen() {
        if (this.isHost()) {
            this.ensureTrader(null);
            this.broadcastState();
        }
        this.renderAll();
    }

    // =====================================================================
    // wire
    // =====================================================================

    /** Client -> host. Always addressed, never broadcast. */
    toHost(msg) {
        if (this.isHost()) { this.hostReceive(this.username, msg); return 1; }
        const host = this._getHostName();
        if (!host) { console.warn('[OpenOutcry] no host yet'); return 0; }
        return this.sendData(msg, host);
    }

    /** Host -> everyone. _fromHost is stamped by the base class. */
    toRoom(msg) {
        if (!this.isHost()) return 0;
        return this.sendData(msg);
    }

    /** Host -> one player. Stamp provenance by hand; targeted sends skip it. */
    toPlayer(name, msg) {
        if (!this.isHost()) return 0;
        if (name === this.username) { this.clientReceive(msg); return 1; }
        return this.sendData({ ...msg, _fromHost: true }, name);
    }

    onDataChannelMessage(peerId, data) {
        if (!data || typeof data !== 'object') return;

        if (this.isHost()) {
            // Anything arriving at the host from a peer is a player action.
            // _fromClient is present when the platform wrapped a broadcast;
            // either way the sender is peerId, which the platform sets.
            this.hostReceive(data._fromClient || peerId, data);
            return;
        }

        // Client: trust only the host. Checking the sender matters more than
        // the flag — a peer can put _fromHost on anything it likes.
        const host = this._getHostName();
        if (peerId !== host) return;
        this.clientReceive(data);
    }

    // =====================================================================
    // HOST — engine
    // =====================================================================

    ensureTrader(name) {
        const roster = this.getUserList().map(u => u.name);
        roster.forEach(n => {
            if (!this.book.has(n)) this.book.set(n, { cash: OO_START_CASH, yes: 0, no: 0, roundSpent: 0 });
        });
        if (name && !this.book.has(name)) {
            this.book.set(name, { cash: OO_START_CASH, yes: 0, no: 0, roundSpent: 0 });
        }
    }

    hostReceive(from, msg) {
        this.ensureTrader(from);
        switch (msg.t) {
            case 'hello':   this.broadcastState(); this.pushWallet(from); break;
            case 'order':   this.hostOrder(from, msg); break;
            case 'vote':    this.hostVote(from, msg); break;
            case 'subject-answer': this.hostSubjectAnswer(from, msg); break;
            default: break;
        }
    }

    hostStart(cfg) {
        this.packId = cfg.packId || 'house';
        this.totalRounds = cfg.rounds || 6;
        this.roundTime = cfg.roundTime || 45;
        this.ensureTrader(null);

        const players = this.getUserList().map(u => u.name);
        this.practice = players.length < 2;
        this.deck = window.OpenOutcryPacks.buildDeck(this.packId, players.length, this.totalRounds);
        this.round = 0;
        this.book.forEach(b => { b.cash = OO_START_CASH; b.yes = 0; b.no = 0; b.roundSpent = 0; });
        this.hostNextRound();
    }

    hostNextRound() {
        clearTimeout(this._phaseTimer);
        this.round += 1;
        if (this.round > this.totalRounds) return this.hostGameOver();

        const players = this.getUserList().map(u => u.name);
        this.claim = this.deck[this.round - 1];
        this.price = 50;
        this.history = [50];
        this.tape = [];
        this.votes.clear();
        this.subjectAnswer = null;
        this._seenOrders.clear();
        this.book.forEach(b => { b.yes = 0; b.no = 0; b.roundSpent = 0; });

        if (this.claim.t === 'room' && players.length >= 2) {
            // The subject is the insider: they answer in private, then trade.
            const subject = players[Math.floor(Math.random() * players.length)];
            this.insider = subject;
            this.truth = null;
            this.claimText = this.claim.text.replace('{P}', subject);
            this.phase = 'subject';
            this.setDeadline(OO_SUBJECT_TIME);
            this.broadcastState();
            this.toPlayer(subject, {
                t: 'secret', kind: 'subject', round: this.round, text: this.claimText,
                prompt: 'Only you know. Answer honestly — then trade on it without giving yourself away.',
            });
            this._phaseTimer = setTimeout(() => {
                // No answer in time: fall back to a coin flip nobody is told.
                if (this.subjectAnswer === null) this.truth = Math.random() < 0.5;
                this.hostOpenMarket();
            }, OO_SUBJECT_TIME * 1000);
            return;
        }

        // Fact claim: the truth is in the pack, dealt to one random player.
        this.claimText = this.claim.text;
        this.truth = !!this.claim.a;
        if (this.practice) {
            this.insider = null;
        } else {
            this.insider = players[Math.floor(Math.random() * players.length)];
            this.toPlayer(this.insider, {
                t: 'secret', kind: 'insider', round: this.round, text: this.claimText, truth: this.truth,
                prompt: 'You have been dealt the truth. Make money on it quietly.',
            });
        }
        this.hostOpenMarket();
    }

    hostSubjectAnswer(from, msg) {
        if (this.phase !== 'subject' || from !== this.insider) return;
        if (this.subjectAnswer !== null) return;
        this.subjectAnswer = !!msg.a;
        this.truth = this.subjectAnswer;
        clearTimeout(this._phaseTimer);
        this.hostOpenMarket();
    }

    hostOpenMarket() {
        clearTimeout(this._phaseTimer);
        this.phase = 'open';
        this.setDeadline(this.roundTime || 45);
        this.broadcastState();
        this.book.forEach((_b, n) => this.pushWallet(n));
        this._phaseTimer = setTimeout(() => this.hostCloseMarket(), (this.roundTime || 45) * 1000);
    }

    hostOrder(from, msg) {
        if (this.phase !== 'open') return;
        const cid = from + ':' + msg.cid;
        if (this._seenOrders.has(cid)) return;   // the platform can deliver twice
        this._seenOrders.add(cid);

        const b = this.book.get(from);
        if (!b) return;
        const side = msg.side === 'no' ? 'no' : 'yes';
        let qty = Math.max(1, Math.min(25, parseInt(msg.qty, 10) || 1));

        // Fill share by share so the price walks the way a real book does.
        let filled = 0, spent = 0;
        for (let i = 0; i < qty; i++) {
            const unit = side === 'yes' ? this.price : (100 - this.price);
            if (b.cash < unit) break;
            b.cash -= unit;
            spent += unit;
            b[side] += 1;
            filled += 1;
            this.price = Math.max(OO_MIN_PRICE, Math.min(OO_MAX_PRICE,
                this.price + (side === 'yes' ? OO_IMPACT : -OO_IMPACT)));
        }
        if (!filled) {
            this.toPlayer(from, { t: 'nofill', reason: 'Not enough cash for that lot.' });
            return;
        }

        b.roundSpent += spent;
        this.history.push(this.price);
        const print = { side, qty: filled, avg: Math.round(spent / filled), at: Date.now() };
        this.tape.unshift(print);
        if (this.tape.length > 40) this.tape.pop();

        this.toRoom({ t: 'print', print, price: this.price, standings: this.standingsList() });
        // The host has already applied this print to its own book above, so it
        // repaints rather than replaying the message — replaying it would put
        // the print on the host's tape twice.
        this.standings = this.standingsList();
        this.renderTape();
        this.renderMarket();
        this.renderStandings();
        this.pushWallet(from);
    }

    hostCloseMarket() {
        clearTimeout(this._phaseTimer);
        const players = this.getUserList().map(u => u.name);
        if (this.practice || !this.insider || players.length < 3) {
            // Naming the insider needs a room. Two players know it is each
            // other; one player has nobody to accuse.
            return this.hostSettle(null, false);
        }
        this.phase = 'vote';
        this.votes.clear();
        this.setDeadline(OO_VOTE_TIME);
        this.broadcastState();
        this._phaseTimer = setTimeout(() => this.hostTallyAndSettle(), OO_VOTE_TIME * 1000);
    }

    hostVote(from, msg) {
        if (this.phase !== 'vote') return;
        if (!msg.who || msg.who === from) return;
        this.votes.set(from, msg.who);
        this.broadcastState();
        // The insider votes too, and usually lies. Once everyone has named
        // somebody there is nothing left to wait for.
        if (this.votes.size >= this.getUserList().length) {
            clearTimeout(this._phaseTimer);
            this._phaseTimer = setTimeout(() => this.hostTallyAndSettle(), 500);
        }
    }

    hostTallyAndSettle() {
        const tally = new Map();
        this.votes.forEach(who => tally.set(who, (tally.get(who) || 0) + 1));
        let accused = null, best = 0;
        tally.forEach((n, who) => { if (n > best) { best = n; accused = who; } });
        // A tie convicts nobody.
        let tied = 0; tally.forEach(n => { if (n === best) tied++; });
        if (tied > 1) accused = null;
        this.hostSettle(accused, true);
    }

    hostSettle(accused, hadVote) {
        clearTimeout(this._phaseTimer);
        this.phase = 'settle';

        const outcome = this.truth === true ? 'yes' : 'no';
        const rows = [];
        this.book.forEach((b, name) => {
            const won = outcome === 'yes' ? b.yes : b.no;
            const payout = won * 100;
            b.cash += payout;
            rows.push({ name, yes: b.yes, no: b.no, spent: b.roundSpent, payout, pnl: payout - b.roundSpent });
        });

        // The insider settlement: caught, or a clean getaway.
        const caught = !!(this.insider && accused && accused === this.insider);
        const correct = [];
        if (this.insider) {
            this.votes.forEach((who, voter) => { if (who === this.insider) correct.push(voter); });
        }
        if (caught) {
            const ib = this.book.get(this.insider);
            correct.forEach(v => {
                const fine = Math.min(OO_CAUGHT_FINE, Math.max(0, ib ? ib.cash : 0));
                if (ib) ib.cash -= fine;
                const vb = this.book.get(v);
                if (vb) vb.cash += fine;
            });
        } else if (this.insider && hadVote) {
            // The room went looking and did not find them.
            const ib = this.book.get(this.insider);
            if (ib) ib.cash += OO_CLEAN_BONUS;
        }

        rows.sort((a, b) => b.pnl - a.pnl);
        this.settleView = {
            claimText: this.claimText,
            truth: this.truth,
            outcome,
            insider: this.insider,
            accused,
            caught,
            correct,
            rows,
            close: this.price,
            kind: this.claim ? this.claim.t : 'fact',
            practice: this.practice,
            last: this.round >= this.totalRounds,
        };
        this.setDeadline(OO_SETTLE_TIME);
        this.broadcastState();
        this.book.forEach((_b, n) => this.pushWallet(n));

        this._phaseTimer = setTimeout(() => {
            if (this.round >= this.totalRounds) this.hostGameOver();
            else this.hostNextRound();
        }, OO_SETTLE_TIME * 1000);
    }

    hostGameOver() {
        clearTimeout(this._phaseTimer);
        this.phase = 'over';
        this.deadline = 0;
        this.broadcastState();
    }

    hostAbort() {
        clearTimeout(this._phaseTimer);
        this.phase = 'lobby';
        this.deadline = 0;
        this.settleView = null;
        this.insider = null;
        this.broadcastState();
    }

    standingsList() {
        const out = [];
        this.book.forEach((b, name) => out.push({ name, cash: Math.round(b.cash) }));
        out.sort((a, b) => b.cash - a.cash);
        return out;
    }

    setDeadline(seconds) {
        this.secondsLeft = seconds;
        this.deadline = Date.now() + seconds * 1000;
    }

    pushWallet(name) {
        const b = this.book.get(name);
        if (!b) return;
        this.toPlayer(name, { t: 'wallet', cash: Math.round(b.cash), yes: b.yes, no: b.no });
    }

    /** The public picture. Deliberately carries no insider identity. */
    publicState() {
        return {
            t: 'state',
            phase: this.phase,
            round: this.round,
            totalRounds: this.totalRounds,
            claimText: this.claimText,
            claimKind: this.claim ? this.claim.t : 'fact',
            subject: this.phase === 'subject' ? this.insider : null,
            price: this.price,
            history: this.history.slice(-80),
            tape: this.tape.slice(0, 24),
            standings: this.standingsList(),
            secondsLeft: Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000)),
            voteCandidates: this.phase === 'vote' ? this.getUserList().map(u => u.name) : [],
            votesIn: this.phase === 'vote' ? this.votes.size : 0,
            settle: this.phase === 'settle' || this.phase === 'over' ? this.settleView : null,
            practice: this.practice,
            packId: this.packId,
        };
    }

    broadcastState() {
        if (!this.isHost()) return;
        const s = this.publicState();
        this.toRoom(s);
        this.clientReceive(s);
    }

    // =====================================================================
    // CLIENT — apply what the host says
    // =====================================================================

    clientReceive(msg) {
        switch (msg.t) {
            case 'state': this.applyState(msg); break;
            case 'print':
                this.tape.unshift(msg.print);
                if (this.tape.length > 24) this.tape.pop();
                this.price = msg.price;
                this.history.push(msg.price);
                if (msg.standings) this.standings = msg.standings;
                this.renderTape();
                this.renderMarket();
                this.renderStandings();
                break;
            case 'wallet':
                this.wallet = { cash: msg.cash, yes: msg.yes, no: msg.no };
                this.renderWallet();
                break;
            case 'secret':
                this.secret = msg;
                this.renderSecret();
                break;
            case 'nofill':
                this.showToast(msg.reason || 'Order rejected', 'warning', 2000);
                break;
            default: break;
        }
    }

    applyState(s) {
        // The secret can arrive either side of the state broadcast that opens
        // its round, so it is kept or dropped by the round it was stamped
        // with — never by arrival order.
        if (s.round !== this.round || s.phase === 'lobby') this.myVote = null;

        this.phase = s.phase;
        this.round = s.round;
        this.totalRounds = s.totalRounds;
        this.claimText = s.claimText;
        this.claimKind = s.claimKind;
        this.subject = s.subject;
        this.price = s.price;
        this.history = s.history && s.history.length ? s.history : [s.price];
        this.tape = s.tape || [];
        this.standings = s.standings || [];
        this.voteCandidates = s.voteCandidates || [];
        this.votesIn = s.votesIn || 0;
        this.settleView = s.settle;
        this.practice = s.practice;
        this.deadline = s.secondsLeft > 0 ? Date.now() + s.secondsLeft * 1000 : 0;
        if (this.secret && (this.secret.round !== this.round || this.phase === 'lobby')) this.secret = null;
        this.renderAll();
    }

    // =====================================================================
    // player actions
    // =====================================================================

    buy(side) {
        if (this.phase !== 'open') return;
        const unit = side === 'yes' ? this.price : 100 - this.price;
        if (this.wallet.cash < unit) { this.showToast('Not enough cash for that lot.', 'warning', 2000); return; }
        this._cid = (this._cid || 0) + 1;
        this.toHost({ t: 'order', side, qty: this.lot, cid: this._cid });
        const btn = document.getElementById(side === 'yes' ? 'buyYes' : 'buyNo');
        if (btn) { btn.classList.remove('oo-pulse'); void btn.offsetWidth; btn.classList.add('oo-pulse'); }
    }

    vote(who) {
        if (this.phase !== 'vote' || who === this.username) return;
        this.myVote = who;
        this.toHost({ t: 'vote', who });
        this.renderVote();
    }

    answerSubject(a) {
        this.toHost({ t: 'subject-answer', a });
        this.secret = { ...this.secret, answered: true, truth: a };
        this.renderSecret();
    }

    // =====================================================================
    // UI
    // =====================================================================

    setupUI() {
        const $ = id => document.getElementById(id);

        $('buyYes').addEventListener('click', () => this.buy('yes'));
        $('buyNo').addEventListener('click', () => this.buy('no'));

        document.querySelectorAll('.oo-lot').forEach(b => {
            b.addEventListener('click', () => {
                this.lot = parseInt(b.dataset.lot, 10) || 1;
                document.querySelectorAll('.oo-lot').forEach(x => x.classList.toggle('is-on', x === b));
            });
        });

        $('startBtn').addEventListener('click', () => {
            if (!this.isHost()) return;
            this.hostStart({
                packId: $('packSelect').value,
                rounds: parseInt($('roundsSelect').value, 10),
                roundTime: parseInt($('timeSelect').value, 10),
            });
        });

        $('abortBtn').addEventListener('click', () => { if (this.isHost()) this.hostAbort(); });
        $('againBtn').addEventListener('click', () => { if (this.isHost()) this.hostAbort(); });

        $('subjYes').addEventListener('click', () => this.answerSubject(true));
        $('subjNo').addEventListener('click', () => this.answerSubject(false));

        // Keyboard: the floor is faster with hands on the keys.
        document.addEventListener('keydown', (e) => {
            if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
            if (e.key === 'ArrowUp' || e.key === 'y' || e.key === 'Y') { e.preventDefault(); this.buy('yes'); }
            if (e.key === 'ArrowDown' || e.key === 'n' || e.key === 'N') { e.preventDefault(); this.buy('no'); }
            if (e.key >= '1' && e.key <= '3') {
                const map = { '1': 1, '2': 5, '3': 10 };
                const btn = document.querySelector(`.oo-lot[data-lot="${map[e.key]}"]`);
                if (btn) btn.click();
            }
        });

        const packSel = $('packSelect');
        const P = window.OpenOutcryPacks;
        P.PACK_ORDER.forEach(id => {
            const p = P.PACKS[id];
            const o = document.createElement('option');
            o.value = id;
            o.textContent = p.locked ? `${p.name} — pack` : p.name;
            packSel.appendChild(o);
        });
        packSel.addEventListener('change', () => {
            const p = P.PACKS[packSel.value];
            $('packBlurb').textContent = p ? p.blurb : '';
        });
        $('packBlurb').textContent = P.PACKS.house.blurb;

        this._chartCtx = $('priceChart').getContext('2d');

        // One timer drives every countdown on the page.
        this._tickTimer = setInterval(() => this.renderClock(), 250);

        this.renderAll();
    }

    renderAll() {
        this.renderPhase();
        this.renderMarket();
        this.renderTape();
        this.renderStandings();
        this.renderWallet();
        this.renderSecret();
        this.renderVote();
        this.renderSettle();
        this.renderClock();
        this.renderLobby();
    }

    show(id, on) {
        const el = document.getElementById(id);
        if (el) el.hidden = !on;
    }

    renderPhase() {
        const inGame = this.phase !== 'lobby';
        this.show('lobbyPanel', this.phase === 'lobby');
        this.show('floorPanel', inGame && this.phase !== 'over');
        this.show('overPanel', this.phase === 'over');
        this.show('tradeBar', this.phase === 'open');
        this.show('subjectPanel', this.phase === 'subject' && !!this.secret);
        this.show('votePanel', this.phase === 'vote');
        this.show('settlePanel', this.phase === 'settle');

        const pill = document.getElementById('phasePill');
        const label = {
            lobby: 'Lobby', subject: 'Sealed answer', open: 'Market open',
            vote: 'Name the insider', settle: 'Settling', over: 'Closed',
        }[this.phase] || '';
        pill.textContent = label;
        pill.className = 'pill-status ' + (this.phase === 'open' ? 'is-live' : this.phase === 'lobby' ? 'is-off' : 'is-busy');

        const rc = document.getElementById('roundCount');
        rc.textContent = this.phase === 'lobby' ? '' : `Round ${this.round} / ${this.totalRounds}`;

        document.getElementById('claimText').textContent = this.claimText || '';
        const kind = document.getElementById('claimKind');
        if (this.phase !== 'lobby') {
            kind.hidden = false;
            kind.textContent = this.claimKind === 'room' ? 'About someone here' : 'True or false';
        } else {
            kind.hidden = true;
        }
    }

    renderLobby() {
        const host = this.isHost();
        this.show('hostControls', host);
        this.show('guestWait', !host);
        const list = document.getElementById('lobbyPlayers');
        if (!list) return;
        const users = this.getUserList();
        list.innerHTML = users.map(u => `
            <li class="oo-player">
                <span class="avatar" style="background:${u.color}">${this.escapeHtml(u.name.charAt(0).toUpperCase())}</span>
                <span class="oo-player__name">${this.escapeHtml(u.name)}${u.isSelf ? ' <em>(you)</em>' : ''}</span>
                ${u.isHost ? '<span class="oo-tag">floor manager</span>' : ''}
            </li>`).join('');
        document.getElementById('lobbyCount').textContent =
            users.length === 1 ? '1 trader — practice run' : `${users.length} traders`;
        const startBtn = document.getElementById('startBtn');
        if (startBtn) startBtn.textContent = users.length === 1 ? 'Practice alone' : 'Open the floor';
    }

    renderMarket() {
        const p = Math.round(this.price);
        document.getElementById('priceYes').textContent = p;
        document.getElementById('priceNo').textContent = 100 - p;
        const bar = document.getElementById('priceBar');
        if (bar) bar.style.width = p + '%';

        const yb = document.getElementById('buyYes');
        const nb = document.getElementById('buyNo');
        if (yb) yb.querySelector('.oo-btn__price').textContent = `${p}¢`;
        if (nb) nb.querySelector('.oo-btn__price').textContent = `${100 - p}¢`;

        this.drawChart();
    }

    drawChart() {
        const cv = document.getElementById('priceChart');
        const ctx = this._chartCtx;
        if (!cv || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth || 300, h = cv.clientHeight || 90;
        if (cv.width !== w * dpr || cv.height !== h * dpr) {
            cv.width = w * dpr; cv.height = h * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const css = getComputedStyle(document.documentElement);
        const grid = css.getPropertyValue('--border').trim() || 'rgba(148,163,184,.14)';
        const up = css.getPropertyValue('--success').trim() || '#34d399';

        // 50¢ midline — the only reference a trader needs.
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

        const pts = this.history.slice(-80);
        if (pts.length < 2) return;
        const x = i => (i / (pts.length - 1)) * w;
        const y = v => h - (v / 100) * h;

        ctx.beginPath();
        ctx.moveTo(x(0), y(pts[0]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(pts[i]));
        ctx.strokeStyle = up;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Fill under the line, faint.
        ctx.lineTo(x(pts.length - 1), h);
        ctx.lineTo(x(0), h);
        ctx.closePath();
        ctx.fillStyle = up.replace(')', ', 0.10)').replace('rgb', 'rgba');
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = up;
        ctx.fill();
        ctx.globalAlpha = 1;

        // The last print, emphasised.
        ctx.beginPath();
        ctx.arc(x(pts.length - 1), y(pts[pts.length - 1]), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = up;
        ctx.fill();
    }

    renderTape() {
        const el = document.getElementById('tape');
        if (!el) return;
        if (!this.tape.length) {
            el.innerHTML = '<li class="oo-tape__empty">No prints yet. Somebody has to go first.</li>';
            return;
        }
        el.innerHTML = this.tape.map(t => `
            <li class="oo-print oo-print--${t.side}">
                <span class="oo-print__side">${t.side === 'yes' ? 'BUY YES' : 'BUY NO'}</span>
                <span class="oo-print__qty">×${t.qty}</span>
                <span class="oo-print__px">@ ${t.avg}¢</span>
            </li>`).join('');
    }

    renderStandings() {
        const el = document.getElementById('standings');
        if (!el) return;
        const rows = this.standings.length ? this.standings
            : this.getUserList().map(u => ({ name: u.name, cash: OO_START_CASH }));
        el.innerHTML = rows.map((r, i) => `
            <li class="oo-rank${r.name === this.username ? ' is-me' : ''}">
                <span class="oo-rank__pos">${i + 1}</span>
                <span class="oo-rank__name">${this.escapeHtml(r.name)}</span>
                <span class="oo-rank__cash">${r.cash}</span>
            </li>`).join('');
    }

    renderWallet() {
        document.getElementById('myCash').textContent = this.wallet.cash;
        document.getElementById('myYes').textContent = this.wallet.yes;
        document.getElementById('myNo').textContent = this.wallet.no;
    }

    renderSecret() {
        const box = document.getElementById('secretBox');
        if (!box) return;
        if (!this.secret || this.phase === 'lobby' || this.phase === 'over') { box.hidden = true; return; }
        box.hidden = false;

        if (this.secret.kind === 'subject') {
            const answered = this.secret.answered;
            document.getElementById('subjectClaim').textContent = this.secret.text || this.claimText;
            this.show('subjectButtons', !answered);
            const done = document.getElementById('subjectDone');
            done.hidden = !answered;
            if (answered) {
                done.textContent = `You answered ${this.secret.truth ? 'YES' : 'NO'}. Now trade it without being read.`;
            }
            box.querySelector('.oo-secret__label').textContent = 'It is about you';
            document.getElementById('secretLine').textContent = this.secret.prompt || '';
        } else {
            box.querySelector('.oo-secret__label').textContent = 'You are the insider';
            document.getElementById('secretLine').innerHTML =
                `The answer is <strong>${this.secret.truth ? 'YES' : 'NO'}</strong>. ${this.escapeHtml(this.secret.prompt || '')}`;
            this.show('subjectButtons', false);
            document.getElementById('subjectDone').hidden = true;
            document.getElementById('subjectClaim').textContent = '';
        }
    }

    renderVote() {
        const el = document.getElementById('voteList');
        if (!el || this.phase !== 'vote') return;
        el.innerHTML = this.voteCandidates
            .filter(n => n !== this.username)
            .map(n => `<button type="button" class="btn oo-vote${this.myVote === n ? ' is-on' : ''}" data-who="${this.escapeHtml(n)}">${this.escapeHtml(n)}</button>`)
            .join('');
        el.querySelectorAll('.oo-vote').forEach(b => {
            b.addEventListener('click', () => this.vote(b.dataset.who));
        });
        document.getElementById('votesIn').textContent =
            `${this.votesIn} of ${this.voteCandidates.length} have named somebody`;
    }

    renderSettle() {
        const s = this.settleView;
        if (!s) return;
        const target = this.phase === 'over' ? 'overBody' : 'settleBody';
        const el = document.getElementById(target);
        if (!el) return;

        const verdict = s.insider
            ? (s.caught
                ? `<p class="oo-verdict oo-verdict--caught">Caught. <strong>${this.escapeHtml(s.insider)}</strong> was the insider and the room named them. They pay ${OO_CAUGHT_FINE} to every trader who called it.</p>`
                : `<p class="oo-verdict oo-verdict--clean">Clean getaway. The insider was <strong>${this.escapeHtml(s.insider)}</strong>${s.accused ? `, and the room named ${this.escapeHtml(s.accused)}` : ', and the room could not agree'}. They take ${OO_CLEAN_BONUS} for the trouble.</p>`)
            : '<p class="oo-verdict">Practice round — no insider was dealt in.</p>';

        const rows = s.rows.map(r => `
            <tr class="${r.name === this.username ? 'is-me' : ''}">
                <td>${this.escapeHtml(r.name)}</td>
                <td class="num">${r.yes}</td>
                <td class="num">${r.no}</td>
                <td class="num">${r.spent}</td>
                <td class="num">${r.payout}</td>
                <td class="num ${r.pnl > 0 ? 'pos' : r.pnl < 0 ? 'neg' : ''}">${r.pnl > 0 ? '+' : ''}${r.pnl}</td>
            </tr>`).join('');

        el.innerHTML = `
            <div class="oo-outcome oo-outcome--${s.outcome}">
                <span class="oo-outcome__label">Settles at</span>
                <span class="oo-outcome__value">${s.outcome === 'yes' ? 'YES' : 'NO'}</span>
                <span class="oo-outcome__claim">${this.escapeHtml(s.claimText)}</span>
                <span class="oo-outcome__close">Market closed at ${Math.round(s.close)}¢</span>
            </div>
            ${verdict}
            <div class="oo-table-wrap">
              <table class="oo-table">
                <thead><tr><th>Trader</th><th class="num">Yes</th><th class="num">No</th><th class="num">Spent</th><th class="num">Paid</th><th class="num">P&amp;L</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`;

        if (this.phase === 'over') {
            const win = this.standings[0];
            const t = document.getElementById('overTitle');
            if (t && win) t.textContent = `${win.name} takes the floor — ${win.cash}`;
            this.show('againBtn', this.isHost());
        }
    }

    renderClock() {
        const el = document.getElementById('clock');
        if (!el) return;
        if (!this.deadline || this.phase === 'lobby' || this.phase === 'over') { el.textContent = ''; el.classList.remove('is-urgent'); return; }
        const left = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
        el.textContent = left + 's';
        el.classList.toggle('is-urgent', left <= 5);
    }

    escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
}

// ============================================================================
// bootstrap — same shape as the other mini-games
// ============================================================================

let outcryGame = null;

async function connectOpenOutcry(username, channel, password) {
    try {
        outcryGame = new OpenOutcryGame();
        window.outcryGame = outcryGame;
        await outcryGame.initialize();
        await outcryGame.connect({ username, channelName: channel, channelPassword: password });
        outcryGame.start();

        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' +
                    channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }
        console.log('[OpenOutcry] on the floor');
    } catch (error) {
        console.error('[OpenOutcry] connection failed:', error);
        if (window.ConnectionModal) ConnectionModal.fail(error);
    }
}

function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'outcry_',
        channelPrefix: 'outcry-',
        title: 'Join the floor',
        collapsedTitle: 'Open Outcry',
        onConnect: function (username, channel, password) {
            connectOpenOutcry(username, channel, password);
        },
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initializeConnectionModal();

    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'OpenOutcry',
            storagePrefix: 'outcry_',
            connectCallback: async function () {
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';
                if (username && channel) await connectOpenOutcry(username, channel, password);
            },
        });
    }

    setTimeout(() => {
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.add('active');
    }, 200);
});
