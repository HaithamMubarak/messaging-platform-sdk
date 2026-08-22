/**
 * Pictionary - Drawing & Guessing Game
 * Uses Messaging Platform SDK with UserConnectionBase
 *
 * The round is host-authoritative. The host alone holds the secret word
 * (plus the artist, who is told it privately), validates every guess,
 * awards every point, and broadcasts the results. Guesses travel as
 * targeted channel messages to the host - never as broadcasts - so the
 * word is not in any guesser's devtools and no client can assert its own
 * score. Strokes ride the data channel; game control rides the channel,
 * which is the reliable path (see rooms.js / pulse.js for the pattern).
 */

// Word bank
const WORD_BANK = [
    // Easy words
    'cat', 'dog', 'house', 'tree', 'car', 'sun', 'moon', 'star', 'fish', 'bird',
    'flower', 'apple', 'banana', 'pizza', 'coffee', 'phone', 'computer', 'book', 'pen', 'clock',
    // Medium words
    'elephant', 'mountain', 'rainbow', 'skateboard', 'guitar', 'camera', 'bicycle', 'airplane',
    'butterfly', 'waterfall', 'lighthouse', 'volcano', 'penguin', 'mushroom', 'helicopter',
    // Hard words
    'telescope', 'microscope', 'parachute', 'ambulance', 'astronaut', 'refrigerator',
    'trampoline', 'scarecrow', 'windmill', 'submarine', 'cactus', 'octopus', 'giraffe'
];

// Game Configuration
const GAME_CONFIG = {
    DEFAULT_ROUNDS: 5,
    DEFAULT_DRAW_TIME: 60,
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 600,
    POINTS_CORRECT: 100,
    POINTS_FIRST: 50,
    CLOSE_GUESS_THRESHOLD: 2,  // Edit distance for "close" guess
    MAX_STROKES_KEPT: 6000     // stroke history cap (mid-round joiner replay)
};

// ============================================
// PICTIONARY GAME CLASS
// ============================================

class PictionaryGame extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'pictionary',
            customType: 'pictionary',
            autoCreateDataChannel: true,
            dataChannelName: 'pictionary-data',
            dataChannelOptions: {
                ordered: false,
                maxRetransmits: 0
            }
        });

        // Canvas
        this.canvas = null;
        this.ctx = null;

        // Drawing state
        this.isDrawing = false;
        this.currentTool = 'pen';
        this.currentColor = '#000000';
        this.brushSize = 5;
        this.lastX = 0;
        this.lastY = 0;

        // Game state
        this.gameStatus = 'lobby'; // lobby, playing, game_end
        this.currentRound = 0;
        this.totalRounds = GAME_CONFIG.DEFAULT_ROUNDS;
        this.drawingTime = GAME_CONFIG.DEFAULT_DRAW_TIME;

        // Round state
        this.currentArtist = null;
        this.currentWord = null;       // held only by the host and the artist
        this.roundActive = false;      // true while a drawing is in progress
        this.roundStartTime = 0;
        this.roundTimer = null;
        this.timeRemaining = 0;
        this._roundEnding = false;     // host-side guard against a double round-end
        this._pendingWord = null;      // word-assign that arrived before its round-start

        // Players
        this.players = new Map(); // username -> {score, hasGuessed, guessTime}
        this.playerOrder = [];

        // Used words (don't repeat)
        this.usedWords = new Set();

        // Stroke history - replayed to mid-round joiners by the host
        this.strokes = [];

        // Original lobby markup, restored on Play Again
        this._lobbyHTML = null;
    }

    async onInitialize() {
        console.log('[Pictionary] Initializing...');

        // Setup canvas
        this.canvas = document.getElementById('drawingCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = GAME_CONFIG.CANVAS_WIDTH;
        this.canvas.height = GAME_CONFIG.CANVAS_HEIGHT;

        // Setup canvas events
        this.canvas.addEventListener('mousedown', (e) => this.handleDrawStart(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleDrawMove(e));
        this.canvas.addEventListener('mouseup', () => this.handleDrawEnd());
        this.canvas.addEventListener('mouseleave', () => this.handleDrawEnd());

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), {passive: false});
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), {passive: false});
        this.canvas.addEventListener('touchend', () => this.handleDrawEnd());

        // Setup tools
        this.setupTools();

        // Setup chat
        this.setupChat();

        // Keep the pristine lobby (settings included) so Play Again can restore it
        const controlPanel = document.getElementById('controlPanel');
        if (controlPanel) this._lobbyHTML = controlPanel.innerHTML;

        console.log('[Pictionary] Initialized');
    }

    setupTools() {
        // Tool buttons
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentTool = btn.dataset.tool;
                document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Color buttons
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentColor = btn.dataset.color;
                document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Brush size
        const sizeSlider = document.getElementById('brushSize');
        const sizeLabel = document.getElementById('brushSizeLabel');
        sizeSlider.addEventListener('input', (e) => {
            this.brushSize = parseInt(e.target.value);
            sizeLabel.textContent = this.brushSize;
        });
    }

    setupChat() {
        const chatInput = document.getElementById('chatInput');
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendGuess();
            }
        });
    }

    onConnect(detail) {
        // Dismiss the connection dialog — without this it stays over the app
        // even though the session is live.
        if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
            window.ConnectionModal.hide();
        }
        console.log('[Pictionary] Connected:', detail);

        // Show game container
        document.getElementById('gameContainer').classList.remove('hidden');

        // Update connection status
        document.getElementById('connectionStatus').classList.add('connected');
        document.getElementById('statusText').textContent = 'Connected';

        // Show room name
        document.getElementById('roomName').textContent = this.channelName;

        // Show share button
        document.getElementById('shareBtn').style.display = 'block';

        // Initialize players
        this.initializePlayers(detail.users);

        // Update UI
        this.updatePlayersUI();
        this.updateStartButton();
    }

    onUserJoining(detail) {
        console.log('[Pictionary] User joining:', detail.agentName);
        this.addChatMessage('system', `${detail.agentName} is joining...`);
    }

    onUserJoin(detail) {
        console.log('[Pictionary] User joined:', detail.agentName);

        // Add player
        if (!this.players.has(detail.agentName)) {
            this.players.set(detail.agentName, {
                score: 0,
                hasGuessed: false,
                guessTime: null
            });
            this.playerOrder.push(detail.agentName);
        }

        this.addChatMessage('system', `${detail.agentName} joined!`);
        this.updatePlayersUI();
        this.updateStartButton();

        // If game is in progress, sync state to new player
        if (this.gameStatus === 'playing' && this.isHost()) {
            this.syncGameStateToPlayer(detail.agentName);
        }
    }

    onUserLeave(detail) {
        console.log('[Pictionary] User left:', detail.agentName);

        this.players.delete(detail.agentName);
        this.playerOrder = this.playerOrder.filter(p => p !== detail.agentName);

        this.addChatMessage('system', `${detail.agentName} left`);
        this.updatePlayersUI();
        this.updateStartButton();

        // If artist left, the host ends the round
        if (this.currentArtist === detail.agentName && this.roundActive) {
            this.addChatMessage('system', 'The artist left!');
            if (this.isHost()) {
                setTimeout(() => this.endRound('artist-left'), 1000);
            }
        }
    }

    onBecomeHost() {
        this.updateStartButton();
        if (this.gameStatus !== 'playing') return;

        if (this.roundActive) {
            // If we are the artist we already hold the word and simply keep
            // hosting: our own timer takes over ending the round, and guesses
            // now route to us. Otherwise the word left with the old host and
            // nobody can score guesses, so close this round and deal a fresh one.
            if (!this.currentWord) {
                this.endRound('host-change');
            }
        } else {
            // Between rounds: the old host's next-round timer left with it.
            setTimeout(() => {
                if (this.isHost() && this.gameStatus === 'playing' && !this.roundActive) {
                    this.startNextRound();
                }
            }, 3000);
        }
    }

    // ============================================
    // TRANSPORT
    // ============================================

    /**
     * One place that knows how a Pictionary control message travels: over the
     * channel, which is the reliable path. sendCustomEventMessage rejects
     * rather than throwing, so the failure is picked off the promise.
     */
    _send(payload, to) {
        let sent;
        try {
            sent = this.sendCustomEventMessage(payload, to || '*');
        } catch (err) {
            if (this.connected) console.warn('[Pictionary] send failed:', err.message);
            return false;
        }
        if (sent && typeof sent.catch === 'function') {
            sent.catch((err) => {
                if (this.connected) console.warn('[Pictionary] send failed:', err && err.message);
            });
        }
        return true;
    }

    _broadcast(payload) {
        return this._send(payload, '*');
    }

    _tellHost(payload) {
        return this._send(payload, this._getHostName() || '*');
    }

    /**
     * Game control messages arrive here (channel transport).
     * Identity comes from the transport's sender stamp, never from the payload.
     */
    onGameMessage(detail) {
        const data = detail && detail.data ? detail.data : detail;
        if (!data || !data.type) return;

        const from = detail && detail.from ? detail.from : null;
        if (from === this.username) return; // our own broadcast, echoed back

        // The one client-to-host message.
        if (data.type === 'guess') {
            if (this.isHost() && from) {
                this.hostHandleGuess(from, data.text);
            }
            return;
        }

        // Everything else changes authoritative game state: honour it only
        // when the host actually sent it.
        if (!from || from !== this._getHostName()) {
            console.warn('[Pictionary] Ignoring non-host message:', data.type, 'from', from);
            return;
        }

        switch (data.type) {
            case 'game-start':
                this.handleGameStart(data);
                break;
            case 'round-start':
                this.handleRoundStart(data);
                break;
            case 'word-assign':
                this.handleWordAssign(data);
                break;
            case 'guess-chat':
                this.handleGuessChat(data);
                break;
            case 'guess-correct':
                this.handleCorrectGuess(data);
                break;
            case 'round-end':
                this.handleRoundEnd(data);
                break;
            case 'game-end':
                this.handleGameEnd(data);
                break;
            case 'play-again':
                this.handlePlayAgain(data);
                break;
            case 'game-sync':
                this.handleGameSync(data);
                break;
        }
    }

    /**
     * Strokes arrive here (data channel transport). A client's broadcast
     * reaches us relayed through the host carrying _fromClient; anything
     * genuinely from the host arrives on the host's own channel without it.
     * Direct targeted sends identify themselves by peerId.
     */
    onDataChannelMessage(peerId, data) {
        if (!data || !data.type) return;

        const host = this._getHostName();
        const sender = peerId === host ? (data._fromClient || host) : peerId;

        switch (data.type) {
            case 'draw-stroke':
                if (sender !== this.currentArtist) return;
                this.handleRemoteStroke(data);
                break;
            case 'clear-canvas':
                if (sender !== this.currentArtist) return;
                this.clearCanvas(true);
                break;
            case 'stroke-batch':
                // Only the host sends these, directly, so there is no _fromClient.
                if (peerId !== host || data._fromClient) return;
                (Array.isArray(data.strokes) ? data.strokes : []).forEach(s => {
                    if (s && s.type === 'draw-stroke') this.handleRemoteStroke(s);
                });
                break;
        }
    }

    initializePlayers(usernames) {
        // Add self
        if (!this.players.has(this.username)) {
            this.players.set(this.username, {
                score: 0,
                hasGuessed: false,
                guessTime: null
            });
            this.playerOrder.push(this.username);
        }

        // Add other users
        usernames.forEach(name => {
            if (name !== this.username && !this.players.has(name)) {
                this.players.set(name, {
                    score: 0,
                    hasGuessed: false,
                    guessTime: null
                });
                this.playerOrder.push(name);
            }
        });
    }

    updatePlayersUI() {
        const playersList = document.getElementById('playersList');
        const playerCount = document.getElementById('playerCount');

        playerCount.textContent = this.players.size;

        let html = '';
        this.playerOrder.forEach(username => {
            const player = this.players.get(username);
            if (!player) return;

            const isArtist = this.currentArtist === username;
            const hasGuessed = player.hasGuessed;

            let classes = 'player-item';
            if (isArtist) classes += ' drawing';
            if (hasGuessed) classes += ' guessed';

            html += `
                <div class="${classes}">
                    <div class="player-info">
                        <span class="player-name">${MiniGameUtils.escapeHtml(username)}${username === this.username ? ' (You)' : ''}</span>
                        ${isArtist ? '<svg class="icon icon--sm" aria-hidden="true"><use href="#i-pen"></use></svg>' : ''}
                        ${hasGuessed ? '<svg class="icon icon--sm" aria-hidden="true"><use href="#i-check"></use></svg>' : ''}
                    </div>
                    <span class="player-score">${MiniGameUtils.escapeHtml(player.score)}</span>
                </div>
            `;
        });

        playersList.innerHTML = html;
    }

    updateStartButton() {
        const startBtn = document.getElementById('startGameBtn');
        if (!startBtn) return; // results screen has no start button
        startBtn.disabled = !(this.isHost() && this.players.size >= 2);
    }

    // ============================================
    // GAME FLOW
    // ============================================

    startGame() {
        if (!this.isHost()) {
            this.showToast('Only host can start the game', 'error');
            return;
        }

        if (this.players.size < 2) {
            this.showToast('Need at least 2 players to start', 'error');
            return;
        }

        if (this.gameStatus === 'playing') return; // already running

        // Get settings
        const roundsSel = document.getElementById('roundsPerGame');
        const timeSel = document.getElementById('drawingTime');
        this.totalRounds = parseInt(roundsSel && roundsSel.value, 10) || GAME_CONFIG.DEFAULT_ROUNDS;
        this.drawingTime = parseInt(timeSel && timeSel.value, 10) || GAME_CONFIG.DEFAULT_DRAW_TIME;

        this.usedWords.clear();

        // Broadcast game start, apply locally, deal the first round
        const data = {
            type: 'game-start',
            totalRounds: this.totalRounds,
            drawingTime: this.drawingTime
        };
        this._broadcast(data);
        this.handleGameStart(data);
        this.startNextRound();
    }

    handleGameStart(data) {
        this.totalRounds = data.totalRounds;
        this.drawingTime = data.drawingTime;
        this.currentRound = 0;
        this.gameStatus = 'playing';
        this.roundActive = false;

        this.players.forEach(player => {
            player.score = 0;
            player.hasGuessed = false;
            player.guessTime = null;
        });
        this.updatePlayersUI();

        document.getElementById('controlPanel').classList.add('hidden');
        this.addChatMessage('system', 'Game started!');
    }

    startNextRound() {
        if (!this.isHost() || this.gameStatus !== 'playing') return;

        this.currentRound++;

        if (this.currentRound > this.totalRounds) {
            this.endGame();
            return;
        }

        if (this.playerOrder.length === 0) return;

        // Select next artist (rotate)
        const artistIndex = (this.currentRound - 1) % this.playerOrder.length;
        const artist = this.playerOrder[artistIndex];

        // Select word - it stays here, with the host
        this.currentWord = this.selectRandomWord();

        // Broadcast round start; the word itself never rides this message
        const data = {
            type: 'round-start',
            round: this.currentRound,
            artist: artist,
            wordLength: this.currentWord.length,
            drawingTime: this.drawingTime
        };
        this._broadcast(data);
        this.handleRoundStart(data);

        // The artist is the only other player who is told the word
        if (artist !== this.username) {
            this._send({ type: 'word-assign', round: this.currentRound, word: this.currentWord }, artist);
        }
    }

    handleRoundStart(data) {
        this.currentRound = data.round;
        this.currentArtist = data.artist;
        this.drawingTime = data.drawingTime;
        this.gameStatus = 'playing';
        this.roundActive = true;
        this._roundEnding = false;

        // Fresh canvas and stroke history for everyone
        this.clearCanvas(true);

        // Reset player guess states
        this.players.forEach(player => {
            player.hasGuessed = false;
            player.guessTime = null;
        });

        const isArtist = this.currentArtist === this.username;
        const wordDisplay = document.getElementById('currentWordDisplay');
        const panelTitle = document.getElementById('wordPanelTitle');

        if (isArtist) {
            panelTitle.textContent = 'Your Word (Draw This!)';
            // The host artist already holds the word; a guest artist is told
            // it by a private word-assign, which may land before or after this.
            if (this._pendingWord && this._pendingWord.round === this.currentRound) {
                this.currentWord = this._pendingWord.word;
            }
            this._pendingWord = null;
            wordDisplay.textContent = this.currentWord ? this.currentWord : 'Waiting for your word...';
            this.enableDrawing();
        } else {
            // Guessers never hold the word (the host keeps it for scoring)
            if (!this.isHost()) this.currentWord = null;
            const len = Math.max(0, Math.min(60, data.wordLength | 0));
            wordDisplay.textContent = '_ '.repeat(len).trim();
            panelTitle.textContent = 'Guess the Word';
            this.disableDrawing();
        }

        // Clear word hint
        document.getElementById('wordHintDisplay').textContent = '';

        // Update UI
        document.getElementById('roundInfo').textContent = `Round ${this.currentRound}/${this.totalRounds}`;
        document.getElementById('artistBanner').classList.remove('hidden');
        document.getElementById('artistName').textContent = this.currentArtist;

        this.updatePlayersUI();
        this.addChatMessage('system', `Round ${this.currentRound}: ${this.currentArtist} is drawing!`);

        // Everyone runs the countdown display; only the host ends the round
        this.startRoundTimer(this.drawingTime);
    }

    handleWordAssign(data) {
        if (!data || typeof data.word !== 'string') return;
        if (data.round === this.currentRound && this.currentArtist === this.username) {
            this.currentWord = data.word;
            document.getElementById('currentWordDisplay').textContent = data.word;
        } else {
            // round-start has not reached us yet; keep it for when it does
            this._pendingWord = { round: data.round, word: data.word };
        }
    }

    startRoundTimer(remainingSecs) {
        clearInterval(this.roundTimer);

        const remaining = (typeof remainingSecs === 'number' && remainingSecs >= 0)
            ? Math.min(remainingSecs, this.drawingTime)
            : this.drawingTime;
        this.roundStartTime = Date.now() - (this.drawingTime - remaining) * 1000;
        this.timeRemaining = Math.ceil(remaining);
        this.updateTimerUI();

        this.roundTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.roundStartTime) / 1000);
            this.timeRemaining = Math.max(0, this.drawingTime - elapsed);
            this.updateTimerUI();

            if (this.timeRemaining <= 0) {
                clearInterval(this.roundTimer);
                this.roundTimer = null;
                // Guests hold at 0:00 until the host's round-end arrives
                if (this.isHost()) this.endRound('time');
            }
        }, 250);
    }

    updateTimerUI() {
        const minutes = Math.floor(this.timeRemaining / 60);
        const seconds = this.timeRemaining % 60;
        document.getElementById('timerValue').textContent =
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    endRound(reason) {
        if (!this.isHost() || this.gameStatus !== 'playing' || this._roundEnding) return;
        this._roundEnding = true;

        clearInterval(this.roundTimer);
        this.roundTimer = null;

        // Reveal the word (null if it left with a departed host)
        const data = {
            type: 'round-end',
            word: this.currentWord,
            reason: reason || 'time',
            players: this._playersSnapshot()
        };
        this._broadcast(data);
        this.handleRoundEnd(data);

        // Start next round after delay
        setTimeout(() => {
            this._roundEnding = false;
            this.startNextRound();
        }, 5000);
    }

    handleRoundEnd(data) {
        clearInterval(this.roundTimer);
        this.roundTimer = null;
        this.roundActive = false;

        if (Array.isArray(data.players)) this._applyScores(data.players);

        const word = typeof data.word === 'string' ? data.word : null;
        let notice;
        if (data.reason === 'all-guessed') {
            notice = word ? `Everyone guessed it! The word was: ${word}` : 'Everyone guessed it!';
        } else if (data.reason === 'artist-left') {
            notice = word ? `The artist left. The word was: ${word}` : 'The artist left - round over.';
        } else if (data.reason === 'host-change') {
            notice = 'The host changed - starting a fresh round.';
        } else {
            notice = word ? `Time's up! The word was: ${word}` : `Time's up!`;
        }
        this.addChatMessage('system', notice);

        document.getElementById('currentWordDisplay').textContent = word || '-';
        document.getElementById('wordPanelTitle').textContent = 'The Word Was';
        document.getElementById('artistBanner').classList.add('hidden');

        this.currentWord = null;
        this.disableDrawing();
        this.updatePlayersUI();
    }

    endGame() {
        if (!this.isHost()) return;
        const data = {
            type: 'game-end',
            players: this._playersSnapshot()
        };
        this._broadcast(data);
        this.handleGameEnd(data);
    }

    handleGameEnd(data) {
        clearInterval(this.roundTimer);
        this.roundTimer = null;
        this.roundActive = false;
        this.gameStatus = 'game_end';
        this.currentWord = null;

        if (Array.isArray(data.players)) this._applyScores(data.players);

        this.addChatMessage('system', 'Game over!');
        document.getElementById('artistBanner').classList.add('hidden');
        this.disableDrawing();
        this.updatePlayersUI();
        this.showResults();
    }

    showResults() {
        // Show results panel
        const controlPanel = document.getElementById('controlPanel');
        controlPanel.innerHTML = `
            <h2><svg class="icon" aria-hidden="true"><use href="#i-trophy"></use></svg> Game Results</h2>
            <div class="results-panel">
                <div class="final-scores">
                    ${Array.from(this.players.entries())
                        .sort((a, b) => b[1].score - a[1].score)
                        .map(([username, player], index) => `
                            <div class="score-item ${index === 0 ? 'winner' : ''}">
                                <span>${index === 0 ? '<svg class="icon icon--sm" aria-hidden="true"><use href="#i-trophy"></use></svg>' : `${index + 1}.`} ${MiniGameUtils.escapeHtml(username)}</span>
                                <span>${MiniGameUtils.escapeHtml(player.score)} pts</span>
                            </div>
                        `).join('')}
                </div>
                ${this.isHost()
                    ? '<button class="btn-primary" onclick="pictionaryGame?.restartGame()">Play Again</button>'
                    : '<p class="lobby-info">Waiting for the host to start a new game...</p>'}
            </div>
        `;
        controlPanel.classList.remove('hidden');
    }

    restartGame() {
        if (!this.isHost()) {
            this.showToast('Only host can restart', 'error');
            return;
        }

        const data = { type: 'play-again' };
        this._broadcast(data);
        this.handlePlayAgain(data);
    }

    handlePlayAgain() {
        clearInterval(this.roundTimer);
        this.roundTimer = null;

        // Reset to lobby
        this.gameStatus = 'lobby';
        this.roundActive = false;
        this._roundEnding = false;
        this.currentRound = 0;
        this.currentArtist = null;
        this.currentWord = null;
        this._pendingWord = null;
        this.usedWords.clear();

        // Reset scores
        this.players.forEach(player => {
            player.score = 0;
            player.hasGuessed = false;
            player.guessTime = null;
        });

        this.clearCanvas(true);
        this.disableDrawing();

        // Restore the original lobby (settings and start button included)
        const controlPanel = document.getElementById('controlPanel');
        if (this._lobbyHTML) controlPanel.innerHTML = this._lobbyHTML;
        controlPanel.classList.remove('hidden');

        document.getElementById('artistBanner').classList.add('hidden');
        document.getElementById('roundInfo').textContent = 'Round 0/0';
        document.getElementById('timerValue').textContent = '0:00';
        document.getElementById('currentWordDisplay').textContent = 'Waiting...';
        document.getElementById('wordPanelTitle').textContent = 'Current Word';
        document.getElementById('wordHintDisplay').textContent = '';

        this.updatePlayersUI();
        this.updateStartButton();
        this.addChatMessage('system', 'Back to the lobby - ready for another game!');
    }

    selectRandomWord() {
        const availableWords = WORD_BANK.filter(word => !this.usedWords.has(word));

        if (availableWords.length === 0) {
            // Reset if we've used all words
            this.usedWords.clear();
            return WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
        }

        const word = availableWords[Math.floor(Math.random() * availableWords.length)];
        this.usedWords.add(word);
        return word;
    }

    // ============================================
    // DRAWING
    // ============================================

    enableDrawing() {
        this.canvas.classList.remove('disabled');
        document.getElementById('drawingTools').classList.remove('hidden');
    }

    disableDrawing() {
        this.canvas.classList.add('disabled');
        document.getElementById('drawingTools').classList.add('hidden');
    }

    /**
     * Client coordinates -> canvas coordinates. The canvas backing store is a
     * fixed 800x600 but CSS scales the element to fit, so the pointer position
     * must be scaled by the ratio between the two or every stroke lands wide.
     */
    _canvasPos(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width ? this.canvas.width / rect.width : 1;
        const scaleY = rect.height ? this.canvas.height / rect.height : 1;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    handleDrawStart(e) {
        if (this.currentArtist !== this.username || !this.roundActive) return;

        this.isDrawing = true;
        const p = this._canvasPos(e.clientX, e.clientY);
        this.lastX = p.x;
        this.lastY = p.y;
    }

    handleDrawMove(e) {
        if (!this.isDrawing || this.currentArtist !== this.username) return;

        const p = this._canvasPos(e.clientX, e.clientY);
        this._emitStroke(p.x, p.y);
    }

    handleDrawEnd() {
        this.isDrawing = false;
    }

    handleTouchStart(e) {
        e.preventDefault();
        if (this.currentArtist !== this.username || !this.roundActive) return;

        const touch = e.touches[0];
        const p = this._canvasPos(touch.clientX, touch.clientY);
        this.lastX = p.x;
        this.lastY = p.y;
        this.isDrawing = true;
    }

    handleTouchMove(e) {
        e.preventDefault();
        if (!this.isDrawing || this.currentArtist !== this.username) return;

        const touch = e.touches[0];
        const p = this._canvasPos(touch.clientX, touch.clientY);
        this._emitStroke(p.x, p.y);
    }

    /** Draw one segment locally, broadcast it, and record it for joiners. */
    _emitStroke(x, y) {
        const stroke = {
            type: 'draw-stroke',
            tool: this.currentTool,
            color: this.currentColor,
            size: this.brushSize,
            x1: this.lastX,
            y1: this.lastY,
            x2: x,
            y2: y
        };

        this.drawLine(stroke.x1, stroke.y1, stroke.x2, stroke.y2);
        this.sendData(stroke);
        this._recordStroke(stroke);

        this.lastX = x;
        this.lastY = y;
    }

    _recordStroke(stroke) {
        this.strokes.push(stroke);
        if (this.strokes.length > GAME_CONFIG.MAX_STROKES_KEPT) {
            this.strokes.splice(0, this.strokes.length - GAME_CONFIG.MAX_STROKES_KEPT);
        }
    }

    drawLine(x1, y1, x2, y2, tool = this.currentTool, color = this.currentColor, size = this.brushSize) {
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);

        if (tool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.lineWidth = size * 2;
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = size;
        }

        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();
    }

    handleRemoteStroke(data) {
        // Everything a remote peer sends is untrusted - normalize it
        const stroke = {
            type: 'draw-stroke',
            tool: data.tool === 'eraser' ? 'eraser' : 'pen',
            color: (typeof MiniGameUtils !== 'undefined' && MiniGameUtils.safeColor)
                ? MiniGameUtils.safeColor(data.color, '#000000') : '#000000',
            size: Math.max(1, Math.min(40, Number(data.size) || 5)),
            x1: Number(data.x1) || 0,
            y1: Number(data.y1) || 0,
            x2: Number(data.x2) || 0,
            y2: Number(data.y2) || 0
        };

        this.drawLine(stroke.x1, stroke.y1, stroke.x2, stroke.y2, stroke.tool, stroke.color, stroke.size);
        this._recordStroke(stroke);
    }

    clearCanvas(isRemote = false) {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.strokes = [];

        if (!isRemote && this.currentArtist === this.username) {
            this.sendData({ type: 'clear-canvas' });
        }
    }

    // ============================================
    // GUESSING
    // ============================================

    sendGuess() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();

        if (!text) return;

        input.value = '';

        const me = this.players.get(this.username);
        const isGuessing = this.roundActive
            && this.currentArtist !== this.username
            && me && !me.hasGuessed;

        if (!isGuessing) {
            // Plain chat: the artist, players who already guessed, and
            // everyone between rounds.
            this.addChatMessage(this.username, text);
            try {
                const sent = this.sendChat(text);
                if (sent && typeof sent.catch === 'function') {
                    sent.catch((err) => {
                        if (this.connected) console.warn('[Pictionary] chat failed:', err && err.message);
                    });
                }
            } catch (err) {
                console.warn('[Pictionary] chat failed:', err.message);
            }
            return;
        }

        // A guess goes to the host alone; the host broadcasts the outcome.
        // Our own text comes back in that broadcast, so no local echo here.
        if (this.isHost()) {
            this.hostHandleGuess(this.username, text);
        } else {
            this._tellHost({ type: 'guess', text: text });
        }
    }

    /**
     * Host only: judge a guess against the word the host holds.
     * `from` is the transport-stamped sender, never a payload claim.
     */
    hostHandleGuess(from, text) {
        if (!this.isHost() || !this.roundActive || !this.currentWord) return;
        if (typeof text !== 'string') return;

        const guess = text.trim().slice(0, 100);
        if (!guess) return;
        if (from === this.currentArtist) return;

        const player = this.players.get(from);
        if (!player || player.hasGuessed) return;

        if (guess.toLowerCase() === this.currentWord.toLowerCase()) {
            // Correct: the host awards the points and broadcasts the table.
            // The word itself is not revealed until the round ends.
            const isFirst = !Array.from(this.players.values()).some(p => p.hasGuessed);
            const points = GAME_CONFIG.POINTS_CORRECT + (isFirst ? GAME_CONFIG.POINTS_FIRST : 0);

            player.hasGuessed = true;
            player.guessTime = Date.now() - this.roundStartTime;
            player.score += points;

            const data = {
                type: 'guess-correct',
                by: from,
                points: points,
                first: isFirst,
                players: this._playersSnapshot()
            };
            this._broadcast(data);
            this.handleCorrectGuess(data);
            this.checkIfRoundComplete();
        } else {
            // Wrong (or close): relay to the room as chat so everyone sees
            // the guessing happen.
            const data = {
                type: 'guess-chat',
                by: from,
                text: guess,
                close: this.isCloseGuess(guess, this.currentWord)
            };
            this._broadcast(data);
            this.handleGuessChat(data);
        }
    }

    handleGuessChat(data) {
        if (typeof data.text !== 'string' || typeof data.by !== 'string') return;
        // The "close" styling is a hint; only the guesser themselves sees it
        const style = (data.close && data.by === this.username) ? 'close' : 'normal';
        this.addChatMessage(data.by, data.text, style);
    }

    handleCorrectGuess(data) {
        if (typeof data.by !== 'string') return;

        if (Array.isArray(data.players)) this._applyScores(data.players);

        const player = this.players.get(data.by);
        if (player) player.hasGuessed = true;

        const name = data.by === this.username ? 'You' : data.by;
        this.addChatMessage('system',
            `${name} guessed the word! +${Number(data.points) || 0} points${data.first ? ' (first!)' : ''}`,
            'correct');

        this.updatePlayersUI();
    }

    checkIfRoundComplete() {
        if (!this.isHost() || !this.roundActive) return;

        // Check if all players (except artist) have guessed
        let allGuessed = true;
        this.players.forEach((player, username) => {
            if (username !== this.currentArtist && !player.hasGuessed) {
                allGuessed = false;
            }
        });

        if (allGuessed) {
            this.endRound('all-guessed');
        }
    }

    isCloseGuess(guess, word) {
        return this.levenshteinDistance(guess.toLowerCase(), word.toLowerCase()) <= GAME_CONFIG.CLOSE_GUESS_THRESHOLD;
    }

    levenshteinDistance(a, b) {
        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    // ============================================
    // CHAT
    // ============================================

    /** Plain chat from the channel (artist chat, between-round chat). */
    onChat(detail) {
        if (!detail || typeof detail.message !== 'string' || !detail.from) return;
        this.addChatMessage(detail.from, detail.message);
    }

    addChatMessage(username, message, type = 'normal') {
        const chatMessages = document.getElementById('chatMessages');
        const msgEl = document.createElement('div');
        msgEl.className = `chat-message ${type}`;

        if (type === 'system') {
            msgEl.textContent = message;
        } else {
            msgEl.innerHTML = `<strong>${MiniGameUtils.escapeHtml(username)}:</strong> ${MiniGameUtils.escapeHtml(message)}`;
        }

        chatMessages.appendChild(msgEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ============================================
    // SCORES (host-owned)
    // ============================================

    _playersSnapshot() {
        return Array.from(this.players.entries()).map(([username, player]) => ({
            username: username,
            score: player.score,
            hasGuessed: player.hasGuessed
        }));
    }

    /** Apply the host's score table; the host's word is absolute. */
    _applyScores(list) {
        list.forEach(entry => {
            if (!entry || typeof entry.username !== 'string') return;
            let player = this.players.get(entry.username);
            if (!player) {
                player = { score: 0, hasGuessed: false, guessTime: null };
                this.players.set(entry.username, player);
                this.playerOrder.push(entry.username);
            }
            player.score = Number(entry.score) || 0;
            player.hasGuessed = !!entry.hasGuessed;
        });
        this.updatePlayersUI();
    }

    // ============================================
    // SYNC (mid-round joiners)
    // ============================================

    syncGameStateToPlayer(username) {
        if (!this.isHost()) return;

        const data = {
            type: 'game-sync',
            gameStatus: this.gameStatus,
            roundActive: this.roundActive,
            currentRound: this.currentRound,
            totalRounds: this.totalRounds,
            currentArtist: this.currentArtist,
            wordLength: this.currentWord ? this.currentWord.length : 0,
            drawingTime: this.drawingTime,
            timeRemaining: this.timeRemaining,
            players: this._playersSnapshot()
        };
        this._send(data, username);

        // Replay the drawing so far, in small batches on the data channel
        for (let i = 0; i < this.strokes.length; i += 40) {
            this.sendData({
                type: 'stroke-batch',
                strokes: this.strokes.slice(i, i + 40)
            }, username);
        }
    }

    handleGameSync(data) {
        this.gameStatus = data.gameStatus;
        this.roundActive = !!data.roundActive;
        this.currentRound = data.currentRound;
        this.totalRounds = data.totalRounds;
        this.currentArtist = data.currentArtist;
        this.drawingTime = data.drawingTime || this.drawingTime;

        if (Array.isArray(data.players)) this._applyScores(data.players);

        if (this.gameStatus !== 'playing') return;

        document.getElementById('controlPanel').classList.add('hidden');
        document.getElementById('roundInfo').textContent = `Round ${this.currentRound}/${this.totalRounds}`;
        this.disableDrawing();

        if (this.roundActive) {
            const len = Math.max(0, Math.min(60, data.wordLength | 0));
            document.getElementById('currentWordDisplay').textContent = '_ '.repeat(len).trim();
            document.getElementById('wordPanelTitle').textContent = 'Guess the Word';
            document.getElementById('artistBanner').classList.remove('hidden');
            document.getElementById('artistName').textContent = this.currentArtist || '';
            this.startRoundTimer(data.timeRemaining);
            this.addChatMessage('system',
                `You joined mid-round - ${this.currentArtist} is drawing. The canvas replays what you missed.`);
        }

        this.updatePlayersUI();
    }

    // ============================================
    // UTILITIES
    // ============================================

    showToast(message, type = 'info') {
        if (typeof MiniGameUtils !== 'undefined' && MiniGameUtils.showToast) {
            MiniGameUtils.showToast(message, type);
        } else {
            console.log(`[Toast] ${message}`);
        }
    }

    openShareModal() {
        if (typeof window.openShareModal === 'function') {
            window.openShareModal();
        }
    }
}

// ============================================
// INITIALIZATION
// ============================================

let pictionaryGame = null;
let isConnecting = false;

async function connectPictionary(username, channel, password) {
    if (isConnecting) {
        console.warn('[Pictionary] Connection already in progress');
        return;
    }
    if (pictionaryGame && pictionaryGame.connected) {
        console.warn('[Pictionary] Already connected');
        return;
    }

    isConnecting = true;

    try {
        pictionaryGame = new PictionaryGame();
        window.pictionaryGame = pictionaryGame;

        await pictionaryGame.initialize();
        await pictionaryGame.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });

        pictionaryGame.start();

        // Update URL for sharing
        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' + channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }

        console.log('[Pictionary] Connected and ready!');
    } catch (error) {
        console.error('[Pictionary] Connection failed:', error);
        if (window.ConnectionModal) ConnectionModal.fail(error);
        pictionaryGame = null;
    } finally {
        isConnecting = false;
    }
}

function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'pictionary_',
        channelPrefix: 'pictionary-',
        title: 'Join Pictionary',
        collapsedTitle: 'Pictionary',
        onConnect: function(username, channel, password) {
            connectPictionary(username, channel, password);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Pictionary] Page loaded');

    initializeConnectionModal();

    // Process shared link
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'Pictionary',
            storagePrefix: 'pictionary_',
            connectCallback: async function() {
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectPictionary(username, channel, password);
                }
            }
        });
    }

    // Show modal
    setTimeout(() => {
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.add('active');
    }, 200);
});
