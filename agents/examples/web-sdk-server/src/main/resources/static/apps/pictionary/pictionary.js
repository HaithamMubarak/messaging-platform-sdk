/**
 * Pictionary - Drawing & Guessing Game
 * Uses Messaging Platform SDK with UserConnectionBase
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
    CLOSE_GUESS_THRESHOLD: 2  // Edit distance for "close" guess
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
        this.gameStatus = 'lobby'; // lobby, playing, round_end, game_end
        this.currentRound = 0;
        this.totalRounds = GAME_CONFIG.DEFAULT_ROUNDS;
        this.drawingTime = GAME_CONFIG.DEFAULT_DRAW_TIME;
        
        // Round state
        this.currentArtist = null;
        this.currentWord = null;
        this.roundStartTime = 0;
        this.roundTimer = null;
        this.timeRemaining = 0;
        
        // Players
        this.players = new Map(); // username -> {score, hasGuessed, guessTime}
        this.playerOrder = [];
        
        // Used words (don't repeat)
        this.usedWords = new Set();
        
        // Drawing strokes for synchronization
        this.strokes = [];
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
        
        this.addChatMessage('system', `✅ ${detail.agentName} joined!`);
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
        
        // If artist left, end round
        if (this.currentArtist === detail.agentName && this.gameStatus === 'playing') {
            this.addChatMessage('system', 'Artist left! Ending round...');
            setTimeout(() => this.endRound(), 2000);
        }
    }

    onDataChannelMessage(peerId, data) {
        if (!data || !data.type) return;
        
        switch (data.type) {
            case 'draw-stroke':
                this.handleRemoteStroke(data);
                break;
            case 'clear-canvas':
                this.clearCanvas(true);
                break;
            case 'game-start':
                this.handleGameStart(data);
                break;
            case 'round-start':
                this.handleRoundStart(data);
                break;
            case 'round-end':
                this.handleRoundEnd(data);
                break;
            case 'correct-guess':
                this.handleCorrectGuess(data);
                break;
            case 'game-sync':
                this.handleGameSync(data);
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
                        <span class="player-name">${username}${username === this.username ? ' (You)' : ''}</span>
                        ${isArtist ? '🎨' : ''}
                        ${hasGuessed ? '✓' : ''}
                    </div>
                    <span class="player-score">${player.score}</span>
                </div>
            `;
        });
        
        playersList.innerHTML = html;
    }

    updateStartButton() {
        const startBtn = document.getElementById('startGameBtn');
        if (this.isHost() && this.players.size >= 2) {
            startBtn.disabled = false;
        } else {
            startBtn.disabled = true;
        }
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
        
        // Get settings
        this.totalRounds = parseInt(document.getElementById('roundsPerGame').value);
        this.drawingTime = parseInt(document.getElementById('drawingTime').value);
        
        // Reset game state
        this.currentRound = 0;
        this.usedWords.clear();
        this.players.forEach(player => {
            player.score = 0;
            player.hasGuessed = false;
        });
        
        // Hide lobby
        document.getElementById('controlPanel').classList.add('hidden');
        
        // Broadcast game start
        this.broadcastGameStart();
        
        // Start first round
        this.gameStatus = 'playing';
        this.startNextRound();
    }

    broadcastGameStart() {
        const data = {
            type: 'game-start',
            totalRounds: this.totalRounds,
            drawingTime: this.drawingTime
        };
        
        this.sendData(data);
        this.handleGameStart(data);
    }

    handleGameStart(data) {
        this.totalRounds = data.totalRounds;
        this.drawingTime = data.drawingTime;
        this.currentRound = 0;
        this.gameStatus = 'playing';
        
        document.getElementById('controlPanel').classList.add('hidden');
        this.addChatMessage('system', '🎮 Game Started!');
    }

    startNextRound() {
        if (!this.isHost()) return;
        
        this.currentRound++;
        
        if (this.currentRound > this.totalRounds) {
            this.endGame();
            return;
        }
        
        // Select next artist (rotate)
        const artistIndex = (this.currentRound - 1) % this.playerOrder.length;
        this.currentArtist = this.playerOrder[artistIndex];
        
        // Select word
        this.currentWord = this.selectRandomWord();
        
        // Clear canvas
        this.clearCanvas();
        
        // Reset player guess states
        this.players.forEach(player => {
            player.hasGuessed = false;
            player.guessTime = null;
        });
        
        // Broadcast round start
        const data = {
            type: 'round-start',
            round: this.currentRound,
            artist: this.currentArtist,
            word: this.currentWord,
            wordLength: this.currentWord.length,
            drawingTime: this.drawingTime
        };
        
        this.sendData(data);
        this.handleRoundStart(data);
        
        // Start timer
        this.startRoundTimer();
    }

    handleRoundStart(data) {
        this.currentRound = data.round;
        this.currentArtist = data.artist;
        this.drawingTime = data.drawingTime;
        
        const isArtist = this.currentArtist === this.username;
        
        if (isArtist) {
            this.currentWord = data.word;
            document.getElementById('currentWordDisplay').textContent = data.word;
            document.getElementById('wordPanelTitle').textContent = '🎨 Your Word (Draw This!)';
            this.enableDrawing();
        } else {
            // Show blanks for guessers
            const blanks = '_ '.repeat(data.wordLength).trim();
            document.getElementById('currentWordDisplay').textContent = blanks;
            document.getElementById('wordPanelTitle').textContent = '🎯 Guess the Word';
            this.disableDrawing();
        }
        
        // Clear word hint
        document.getElementById('wordHintDisplay').textContent = '';
        
        // Update UI
        document.getElementById('roundInfo').textContent = `Round ${this.currentRound}/${this.totalRounds}`;
        document.getElementById('artistBanner').classList.remove('hidden');
        document.getElementById('artistName').textContent = this.currentArtist;
        
        this.updatePlayersUI();
        this.addChatMessage('system', `🎨 Round ${this.currentRound}: ${this.currentArtist} is drawing!`);
    }

    startRoundTimer() {
        this.roundStartTime = Date.now();
        this.timeRemaining = this.drawingTime;
        
        this.roundTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.roundStartTime) / 1000);
            this.timeRemaining = this.drawingTime - elapsed;
            
            if (this.timeRemaining <= 0) {
                this.endRound();
                return;
            }
            
            this.updateTimerUI();
        }, 100);
    }

    updateTimerUI() {
        const minutes = Math.floor(this.timeRemaining / 60);
        const seconds = this.timeRemaining % 60;
        document.getElementById('timerValue').textContent = 
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    endRound() {
        if (!this.isHost()) return;
        
        clearInterval(this.roundTimer);
        this.roundTimer = null;
        
        // Reveal word
        const data = {
            type: 'round-end',
            word: this.currentWord
        };
        
        this.sendData(data);
        this.handleRoundEnd(data);
        
        // Start next round after delay
        setTimeout(() => {
            this.startNextRound();
        }, 5000);
    }

    handleRoundEnd(data) {
        clearInterval(this.roundTimer);
        this.roundTimer = null;
        
        this.addChatMessage('system', `⏰ Time's up! The word was: ${data.word}`);
        document.getElementById('currentWordDisplay').textContent = data.word;
        document.getElementById('artistBanner').classList.add('hidden');
        
        this.disableDrawing();
    }

    endGame() {
        clearInterval(this.roundTimer);
        this.roundTimer = null;
        this.gameStatus = 'game_end';
        
        this.addChatMessage('system', '🎮 Game Over!');
        this.showResults();
    }

    showResults() {
        // Calculate winner
        let maxScore = 0;
        let winner = null;
        
        this.players.forEach((player, username) => {
            if (player.score > maxScore) {
                maxScore = player.score;
                winner = username;
            }
        });
        
        // Show results panel
        const controlPanel = document.getElementById('controlPanel');
        controlPanel.innerHTML = `
            <h2>🏆 Game Results</h2>
            <div class="results-panel">
                <div class="final-scores">
                    ${Array.from(this.players.entries())
                        .sort((a, b) => b[1].score - a[1].score)
                        .map(([username, player], index) => `
                            <div class="score-item ${index === 0 ? 'winner' : ''}">
                                <span>${index === 0 ? '🏆' : `${index + 1}.`} ${username}</span>
                                <span>${player.score} pts</span>
                            </div>
                        `).join('')}
                </div>
                <button class="btn-primary" onclick="pictionaryGame?.restartGame()">
                    🔄 Play Again
                </button>
            </div>
        `;
        controlPanel.classList.remove('hidden');
    }

    restartGame() {
        if (!this.isHost()) {
            this.showToast('Only host can restart', 'error');
            return;
        }
        
        // Reset to lobby
        this.gameStatus = 'lobby';
        this.currentRound = 0;
        this.usedWords.clear();
        
        // Reset scores
        this.players.forEach(player => {
            player.score = 0;
            player.hasGuessed = false;
        });
        
        this.updatePlayersUI();
        
        // Show lobby
        const controlPanel = document.getElementById('controlPanel');
        controlPanel.innerHTML = `
            <h2>🎨 Pictionary Lobby</h2>
            <div class="lobby-content">
                <p>Ready for another game?</p>
                <button id="startGameBtn" class="btn-primary" onclick="pictionaryGame?.startGame()">
                    Start Game
                </button>
            </div>
        `;
        controlPanel.classList.remove('hidden');
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

    handleDrawStart(e) {
        if (this.currentArtist !== this.username || this.gameStatus !== 'playing') return;
        
        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        this.lastX = e.clientX - rect.left;
        this.lastY = e.clientY - rect.top;
    }

    handleDrawMove(e) {
        if (!this.isDrawing || this.currentArtist !== this.username) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.drawLine(this.lastX, this.lastY, x, y);
        
        // Broadcast stroke
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
        
        this.sendData(stroke);
        
        this.lastX = x;
        this.lastY = y;
    }

    handleDrawEnd() {
        this.isDrawing = false;
    }

    handleTouchStart(e) {
        e.preventDefault();
        if (this.currentArtist !== this.username || this.gameStatus !== 'playing') return;
        
        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        this.lastX = touch.clientX - rect.left;
        this.lastY = touch.clientY - rect.top;
        this.isDrawing = true;
    }

    handleTouchMove(e) {
        e.preventDefault();
        if (!this.isDrawing || this.currentArtist !== this.username) return;
        
        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        
        this.drawLine(this.lastX, this.lastY, x, y);
        
        // Broadcast stroke
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
        
        this.sendData(stroke);
        
        this.lastX = x;
        this.lastY = y;
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
        this.drawLine(data.x1, data.y1, data.x2, data.y2, data.tool, data.color, data.size);
    }

    clearCanvas(isRemote = false) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (!isRemote && this.currentArtist === this.username) {
            this.sendData({ type: 'clear-canvas' });
        }
    }

    // ============================================
    // GUESSING
    // ============================================

    sendGuess() {
        const input = document.getElementById('chatInput');
        const guess = input.value.trim();
        
        if (!guess) return;
        
        input.value = '';
        
        // If you're the artist, send as chat only
        if (this.currentArtist === this.username) {
            this.addChatMessage(this.username, guess);
            this.sendChat(guess);
            return;
        }
        
        // If already guessed, send as chat
        const myPlayer = this.players.get(this.username);
        if (myPlayer && myPlayer.hasGuessed) {
            this.addChatMessage(this.username, guess);
            this.sendChat(guess);
            return;
        }
        
        // Check if correct
        const isCorrect = guess.toLowerCase() === this.currentWord.toLowerCase();
        const isClose = this.isCloseGuess(guess, this.currentWord);
        
        if (isCorrect) {
            // Correct guess!
            this.handleMyCorrectGuess();
        } else if (isClose) {
            // Close guess
            this.addChatMessage(this.username, guess, 'close');
            this.sendChat(guess);
        } else {
            // Wrong guess
            this.addChatMessage(this.username, guess);
            this.sendChat(guess);
        }
    }

    handleMyCorrectGuess() {
        const myPlayer = this.players.get(this.username);
        if (!myPlayer) return;
        
        myPlayer.hasGuessed = true;
        myPlayer.guessTime = Date.now() - this.roundStartTime;
        
        // Calculate points
        const isFirst = !Array.from(this.players.values()).some(p => p !== myPlayer && p.hasGuessed);
        const points = GAME_CONFIG.POINTS_CORRECT + (isFirst ? GAME_CONFIG.POINTS_FIRST : 0);
        myPlayer.score += points;
        
        // Broadcast correct guess
        const data = {
            type: 'correct-guess',
            username: this.username,
            points: points,
            isFirst: isFirst
        };
        
        this.sendData(data);
        this.handleCorrectGuess(data);
        
        // Check if all players have guessed
        if (this.isHost()) {
            this.checkIfRoundComplete();
        }
    }

    handleCorrectGuess(data) {
        const player = this.players.get(data.username);
        if (player) {
            player.hasGuessed = true;
            player.score += data.points;
        }
        
        this.addChatMessage('system', 
            `✅ ${data.username} guessed correctly! +${data.points} points${data.isFirst ? ' (First!)' : ''}`, 
            'correct');
        
        this.updatePlayersUI();
    }

    checkIfRoundComplete() {
        // Check if all players (except artist) have guessed
        let allGuessed = true;
        this.players.forEach((player, username) => {
            if (username !== this.currentArtist && !player.hasGuessed) {
                allGuessed = false;
            }
        });
        
        if (allGuessed) {
            this.addChatMessage('system', 'All players guessed! Ending round...');
            setTimeout(() => this.endRound(), 2000);
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

    addChatMessage(username, message, type = 'normal') {
        const chatMessages = document.getElementById('chatMessages');
        const msgEl = document.createElement('div');
        msgEl.className = `chat-message ${type}`;
        
        if (type === 'system') {
            msgEl.textContent = message;
        } else {
            msgEl.innerHTML = `<strong>${username}:</strong> ${message}`;
        }
        
        chatMessages.appendChild(msgEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // ============================================
    // SYNC
    // ============================================

    syncGameStateToPlayer(username) {
        const data = {
            type: 'game-sync',
            gameStatus: this.gameStatus,
            currentRound: this.currentRound,
            totalRounds: this.totalRounds,
            currentArtist: this.currentArtist,
            wordLength: this.currentWord ? this.currentWord.length : 0,
            timeRemaining: this.timeRemaining,
            players: Array.from(this.players.entries()).map(([name, player]) => ({
                username: name,
                score: player.score,
                hasGuessed: player.hasGuessed
            }))
        };
        
        this.sendData(data, username);
    }

    handleGameSync(data) {
        this.gameStatus = data.gameStatus;
        this.currentRound = data.currentRound;
        this.totalRounds = data.totalRounds;
        this.currentArtist = data.currentArtist;
        this.timeRemaining = data.timeRemaining;
        
        // Update players
        data.players.forEach(p => {
            const player = this.players.get(p.username);
            if (player) {
                player.score = p.score;
                player.hasGuessed = p.hasGuessed;
            }
        });
        
        this.updatePlayersUI();
        this.updateTimerUI();
        
        if (this.currentArtist === this.username) {
            this.enableDrawing();
        } else {
            this.disableDrawing();
        }
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
        alert('Failed to connect: ' + error.message);
        pictionaryGame = null;
    } finally {
        isConnecting = false;
    }
}

function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'pictionary_',
        channelPrefix: 'pictionary-',
        title: '🎨 Join Pictionary',
        collapsedTitle: '🎨 Pictionary',
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

