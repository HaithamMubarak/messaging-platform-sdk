/**
 * Quiz Battle Game
 * Real-time multiplayer quiz game using Messaging Platform SDK with BaseGame
 * Features:
 * - Host/Player system with waiting room
 * - DataChannel P2P communication
 * - Real-time score synchronization
 * - Dynamic question loading from JSON files
 * - Random math question generation
 * - Randomized answer positions per player
 */

// ============================================
// QUIZ QUESTION MANAGER
// ============================================

class QuizQuestionManager {
    constructor() {
        this.questionBanks = [];
        this.loadedQuestions = [];
        this.currentQuestionPool = [];
    }

    /**
     * Load questions from JSON file
     */
    async loadQuestionBank(jsonPath) {
        try {
            const response = await fetch(jsonPath);
            if (!response.ok) {
                throw new Error(`Failed to load ${jsonPath}: ${response.statusText}`);
            }
            const bank = await response.json();
            this.questionBanks.push(bank);
            console.log(`[QuizManager] Loaded ${bank.questions.length} questions from ${bank.category}`);
            return bank;
        } catch (error) {
            console.error(`[QuizManager] Error loading question bank:`, error);
            return null;
        }
    }

    /**
     * Prepare a mixed question pool (JSON + Generated)
     * @param {number} totalQuestions - Total questions needed
     * @param {number} generatedPercent - Percentage of generated questions (0-100)
     */
    prepareQuestionPool(totalQuestions, generatedPercent = 30) {
        const numGenerated = Math.floor(totalQuestions * (generatedPercent / 100));
        const numFromBank = totalQuestions - numGenerated;

        this.currentQuestionPool = [];

        // Get questions from loaded banks
        const allBankQuestions = [];
        this.questionBanks.forEach(bank => {
            allBankQuestions.push(...bank.questions);
        });

        // Shuffle and pick from bank
        const shuffledBank = this.shuffleArray([...allBankQuestions]);
        const selectedFromBank = shuffledBank.slice(0, numFromBank);

        // Generate dynamic questions
        const generatedQuestions = QuestionGenerator.generateMultiple(numGenerated);

        // Combine and shuffle
        this.currentQuestionPool = this.shuffleArray([
            ...selectedFromBank,
            ...generatedQuestions
        ]);

        console.log(`[QuizManager] Prepared ${this.currentQuestionPool.length} questions (${numFromBank} from bank, ${numGenerated} generated)`);
        return this.currentQuestionPool;
    }

    /**
     * Get question with randomized answer positions
     * Returns a question object with answers array and correctAnswerText
     * @param {number} index - Question index
     */
    getQuestionWithRandomizedAnswers(index) {
        if (index >= this.currentQuestionPool.length) {
            return null;
        }

        const q = this.currentQuestionPool[index];

        // Create answers array with correct answer and wrong answers
        const answers = [
            q.correctAnswer,
            ...q.wrongAnswers
        ];

        // Shuffle answers
        const shuffledAnswers = this.shuffleArray([...answers]);

        return {
            question: q.question,
            answers: shuffledAnswers,
            correctAnswerText: q.correctAnswer  // Store the correct answer text (not index!)
        };
    }

    /**
     * Shuffle array (Fisher-Yates algorithm)
     */
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Get total questions in current pool
     */
    getTotalQuestions() {
        return this.currentQuestionPool.length;
    }
}

// ============================================
// QUIZ BATTLE GAME - BaseGame Integration
// ============================================

class QuizBattleGame extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'quiz',
            customType: 'quiz-battle',
            autoCreateDataChannel: true,
            dataChannelName: 'quiz-data',
            dataChannelOptions: {

                ordered: true,       // Ordered delivery for quiz messages
                maxRetransmits: 3    // Some retransmits for reliability
            }
        });

        // Question Manager
        this.questionManager = new QuizQuestionManager();
        this.questionsLoaded = false;

        // Game state
        this.gameStarted = false;
        this.currentQuestion = 0;
        this.score = 0;
        this.totalQuestions = 10;
        this.timeLeft = 10;
        this.timerInterval = null;
        this.playerScores = new Map();
        this.playerAnswers = new Map();
        this.connectedPeers = new Set(); // Track which peers have open DataChannels

        // Current question data (with randomized answers for this player)
        this.currentQuestionData = null;
    }

    async onInitialize() {
        console.log('[QuizBattle] Initializing...');

        // Load question banks
        await this.loadQuestions();

        this.setupUI();
    }

    /**
     * Load question banks from JSON files
     */
    async loadQuestions() {
        console.log('[QuizBattle] Loading questions...');

        // Load general knowledge questions
        await this.questionManager.loadQuestionBank('questions/general-knowledge.json');

        // You can add more question banks here in the future:
        // await this.questionManager.loadQuestionBank('questions/science.json');
        // await this.questionManager.loadQuestionBank('questions/history.json');

        this.questionsLoaded = true;
        console.log('[QuizBattle] Questions loaded successfully');
    }

    onConnect(detail) {
        console.log('[QuizBattle] Connected:', detail);
        window.quizChannel = this.channel;

        // Update URL hash with channel details (like whiteboard does)
        if (this.channelName && this.channelPassword) {
            const hash = btoa(JSON.stringify({
                c: this.channelName,
                p: this.channelPassword
            }));
            window.history.replaceState(null, '', `#${hash}`);
            console.log('[QuizBattle] Updated URL hash with channel details');
        }

        // Hide connection modal
        setTimeout(() => {
            if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
                window.ConnectionModal.hide();
                console.log('[QuizBattle] Connection modal hidden');
            }
        }, 100);

        // Log host status (determined by channel) - use getPlayerCount() instead of this.users.size
        console.log('[QuizBattle] Is host:', this.isHost(), 'Players count:', this.getPlayerCount());

        // Show waiting room
        this.showWaitingRoom();
    }

    onUserJoining(detail) {
        console.log('[QuizBattle] Player joining:', detail.agentName);
        this.showToast(`${detail.agentName} is joining...`, 'info', 2000);

        // Show loader while waiting for DataChannel to open
        this.showConnectionLoader(`Connecting to ${detail.agentName}...`);
    }

    onUserJoin(detail) {
        console.log('[QuizBattle] Player joined successfully:', detail.agentName);

        // Hide the connection loader - DataChannel is now open
        this.hideConnectionLoader();

        // Show toast notification using BaseGame method
        this.showJoinNotification(detail.agentName);

        // Add to player scores
        this.playerScores.set(detail.agentName, 0);

        // Update players list UI
        this.updatePlayersList();

        // NOTE: BaseGame automatically creates DataChannel connections via _initiateDataChannel
        // when agent-connect event fires. No need to manually call createStreamOffer here.

        // If game started and I'm host, send current game state to new player
        if (this.gameStarted && this.isHost()) {
            console.log('[QuizBattle] Sending current game state to late joiner:', detail.agentName);


            this.sendGameState(detail.agentName);
        }
    }

    onUserLeave(detail) {
        console.log('[QuizBattle] User left:', detail.agentName);

        // Show toast notification using BaseGame method
        this.showLeaveNotification(detail.agentName);

        // Remove from tracking
        this.playerScores.delete(detail.agentName);
        this.playerAnswers.delete(detail.agentName);

        // Update players list UI
        this.updatePlayersList();

        // Update header count
        const countEl = document.getElementById('playerCount');
        if (countEl) {
            countEl.textContent = this.getPlayerCount();
        }
    }

    onDataChannelOpen(peerId) {
        console.log('[QuizBattle] DataChannel OPEN with', peerId);
        this.connectedPeers.add(peerId);

        // Update UI to show connection status
        this.updatePlayersList();

        // Show toast
        this.showToast(`🔗 P2P connected with ${peerId}`, 'success');

        // If game already started and I'm host, send current state to new peer
        if (this.gameStarted && this.isHost()) {
            console.log('[QuizBattle] Sending game state to newly connected peer:', peerId);
            this.sendGameState(peerId);
        }
    }

    onDataChannelClose(peerId) {
        console.log('[QuizBattle] DataChannel CLOSED with', peerId);
        this.connectedPeers.delete(peerId);
        this.updatePlayersList();
    }

    onDataChannelMessage(peerId, data) {
        console.log('[QuizBattle] DataChannel message from', peerId, '- type:', data.type);

        switch(data.type) {
            case 'game-start':
                this.handleGameStart(data);
                break;
            case 'next-question':
                this.handleNextQuestion(data);
                break;
            case 'player-answer':
                this.handlePlayerAnswer(peerId, data);
                break;
            case 'game-state':
                this.handleGameState(data);
                break;
            case 'game-end':
                this.handleGameEnd(data);
                break;
            case 'score-update':
                this.handleScoreUpdate(peerId, data);
                break;
        }
    }

    handleScoreUpdate(peerId, data) {
        console.log('[QuizBattle] Score update from', peerId, ':', data.score);
        this.playerScores.set(peerId, data.score);
    }

    setupUI() {
        // Setup share button
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn && typeof ShareModal !== 'undefined') {
            shareBtn.addEventListener('click', () => {
                try {
                    ShareModal.show(this.channelName, this.channelPassword);
                } catch (e) {
                    console.error('Failed to show share modal:', e);
                }
            });
        }
    }

    showWaitingRoom() {
        const container = document.getElementById('quizContainer');
        const shareBtn = document.getElementById('shareBtn');

        if (shareBtn) shareBtn.style.display = 'inline-block';

        const isHost = this.isHost();

        if (isHost) {
            container.innerHTML = `
                <div class="waiting-room">
                    <h2>🎮 You are the Host!</h2>
                    <p>Waiting for players to join...</p>
                    <div class="players-list">
                        <h3>Connected Players:</h3>
                        <div id="playersList"></div>
                    </div>
                    <button class="start-game-btn" onclick="window.quizGame.startGame()" id="startGameBtn">
                        🚀 Start Game
                    </button>
                    <p style="font-size:14px;color:#666;margin-top:20px;">
                        Share the room link with friends to invite them!
                    </p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="waiting-room">
                    <h2>⏳ Waiting for Host...</h2>
                    <p>You've joined the quiz battle!</p>
                    <div class="players-list">
                        <h3>Connected Players:</h3>
                        <div id="playersList"></div>
                    </div>
                    <div class="waiting-indicator">
                        🎮 Waiting for host to start the game...
                    </div>
                </div>
            `;
        }

        this.updatePlayersList();
    }

    updatePlayersList() {
        const listEl = document.getElementById('playersList');
        if (!listEl) return;

        // Use BaseGame's getPeerList method
        const players = this.getPeerList();

        let html = '';

        players.forEach(player => {
            // Check if we have P2P DataChannel connection with this player
            const hasP2P = player.isSelf || this.connectedPeers.has(player.name);
            const p2pIndicator = hasP2P
                ? '<span style="color:#10b981;margin-left:8px;" title="P2P Connected">🔗</span>'
                : '<span style="color:#f59e0b;margin-left:8px;" title="Connecting...">⏳</span>';

            if (player.isHost) {
                html += `
                    <div class="player-item host">
                        👑 ${player.name}${player.isSelf ? ' (You)' : ''}
                        ${!player.isSelf ? p2pIndicator : ''}
                        <span style="margin-left:auto;font-size:12px;">HOST</span>
                    </div>
                `;
            } else {
                html += `
                    <div class="player-item">
                        👤 ${player.name}${player.isSelf ? ' (You)' : ''}
                        ${!player.isSelf ? p2pIndicator : ''}
                    </div>
                `;
            }
        });

        listEl.innerHTML = html || '<p style="color:#999;">No players yet</p>';

        // Update player count in header using BaseGame method
        const countEl = document.getElementById('playerCount');
        if (countEl) {
            countEl.textContent = this.getPlayerCount();
        }

        // Enable start button if host and has enough players
        if (this.isHost()) {
            const startBtn = document.getElementById('startGameBtn');
            if (startBtn) {
                startBtn.disabled = !this.hasEnoughPeers(2);
            }
        }
    }

    startGame() {
        if (!this.isHost()) {
            console.warn('[QuizBattle] Only host can start game');
            return;
        }

        if (!this.questionsLoaded) {
            console.error('[QuizBattle] Questions not loaded yet!');
            this.showToast('⚠️ Questions still loading...', 'error');
            return;
        }

        console.log('[QuizBattle] Host starting game...');

        // Prepare question pool (70% from JSON, 30% generated math questions)
        this.questionManager.prepareQuestionPool(this.totalQuestions, 30);

        this.gameStarted = true;

        // Show toast using BaseGame method
        this.showToast('🎮 Game starting!', 'success');

        // Start game locally
        this.currentQuestion = 0;
        this.score = 0;

        // Host sends first question to all players via DataChannel
        // NOTE: Each player will get their own randomized answer order
        const questionData = this.questionManager.getQuestionWithRandomizedAnswers(0);

        this.sendData({
            type: 'game-start',
            questionIndex: 0,
            questionText: questionData.question,
            timestamp: Date.now()
        });

        // Show question for host (with randomized answers)
        this.showQuestion(0);
    }


    handleGameStart(data) {
        console.log('[QuizBattle] Game starting! Received from host:', data);
        this.gameStarted = true;
        this.currentQuestion = data.questionIndex || 0;
        this.score = 0;

        // Show toast using BaseGame method
        this.showToast('🎮 Game started by host!', 'success');

        // Prepare question pool (same mix as host: 70% JSON, 30% generated)
        if (!this.questionManager.getTotalQuestions()) {
            this.questionManager.prepareQuestionPool(this.totalQuestions, 30);
        }

        // Show first question (each player gets their own randomized answer order)
        this.showQuestion(this.currentQuestion);
    }

    handleNextQuestion(data) {
        console.log('[QuizBattle] Next question from host:', data.questionIndex);
        this.currentQuestion = data.questionIndex;

        // Show question with randomized answers (each player has different order)
        this.showQuestion(data.questionIndex);
    }

    handlePlayerAnswer(peerId, data) {
        // Track answer from any player (host collects all scores)
        const playerName = data.playerName || peerId;
        console.log('[QuizBattle] Player', playerName, 'answered:', data.answer, 'correct:', data.correct, 'score:', data.score);

        this.playerAnswers.set(playerName, data);

        // Update player score
        if (data.score !== undefined) {
            this.playerScores.set(playerName, data.score);
        }
    }

    handleGameState(data) {
        console.log('[QuizBattle] Received game state:', data);
        // Update local state to match
        this.currentQuestion = data.currentQuestion;
        this.gameStarted = data.gameStarted;
        this.showQuestion(this.currentQuestion);
    }

    handleGameEnd(data) {
        console.log('[QuizBattle] Game ended');
        this.gameStarted = false;
        this.showResults(data.scores);
    }

    sendGameState(toPlayer) {
        this.sendData({
            type: 'game-state',
            currentQuestion: this.currentQuestion,
            gameStarted: this.gameStarted,
            timestamp: Date.now()
        }, toPlayer);
    }

    showQuestion(index) {
        const totalQuestions = this.questionManager.getTotalQuestions();

        console.log(`[QuizBattle] showQuestion(${index}), total: ${totalQuestions}`);

        if (totalQuestions === 0) {
            console.error('[QuizBattle] No questions in pool! Cannot show question.');
            this.showToast('⚠️ No questions available!', 'error');
            return;
        }

        if (index >= totalQuestions) {
            console.log('[QuizBattle] All questions completed, ending game');
            this.endGame();
            return;
        }

        // Get question with randomized answers for THIS player
        this.currentQuestionData = this.questionManager.getQuestionWithRandomizedAnswers(index);

        if (!this.currentQuestionData) {
            console.error(`[QuizBattle] Failed to get question at index ${index}`);
            this.showToast('⚠️ Error loading question!', 'error');
            return;
        }

        this.displayQuestion(index, this.currentQuestionData);
    }

    displayQuestion(index, questionData) {
        const container = document.getElementById('quizContainer');

        const letters = ['A', 'B', 'C', 'D'];

        container.innerHTML = `
            <div class="question-header">
                <div class="question-number">Question ${index + 1} of ${this.totalQuestions}</div>
                <div class="question-text">${questionData.question}</div>
            </div>
            <div class="timer-bar">
                <div class="timer-fill" id="timerProgress" style="width: 100%;"></div>
            </div>
            <div class="answers-grid" id="answersGrid">
                ${questionData.answers.map((answer, i) => `
                    <button class="answer-btn" onclick="window.quizGame.selectAnswer(${i})" data-index="${i}">
                        <div class="answer-letter">${letters[i]}</div>
                        <div>${answer}</div>
                    </button>
                `).join('')}
            </div>
        `;

        // Update header
        document.getElementById('questionNum').textContent = `${index + 1}/${this.totalQuestions}`;
        document.getElementById('yourScore').textContent = this.score;

        // Start timer
        this.startTimer();
    }

    startTimer() {
        this.timeLeft = 10;
        this.updateTimerUI();

        if (this.timerInterval) clearInterval(this.timerInterval);

        this.timerInterval = setInterval(() => {
            this.timeLeft--;
            this.updateTimerUI();

            if (this.timeLeft <= 0) {
                clearInterval(this.timerInterval);
                this.selectAnswer(-1); // Time's up, no answer
            }
        }, 1000);
    }

    updateTimerUI() {
        const label = document.getElementById('timeLeft');
        label.textContent = `${this.timeLeft}s`;
        const progress = document.getElementById('timerProgress');
        if (progress) {
            progress.style.width = `${(this.timeLeft / 10) * 100}%`;
            // Urgency: the bar turns amber then red as the clock runs out,
            // and the last 3 seconds pulse the countdown label.
            progress.style.background =
                this.timeLeft <= 3 ? '#ef4444' :
                this.timeLeft <= 6 ? '#f59e0b' : '';
        }
        if (this.timeLeft <= 3 && this.timeLeft > 0 && label.animate) {
            label.animate([
                { transform: 'scale(1)', color: '#ef4444' },
                { transform: 'scale(1.3)', color: '#ef4444' },
                { transform: 'scale(1)', color: '' },
            ], { duration: 320, easing: 'ease-out' });
        }
    }

    selectAnswer(answerIndex) {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        if (!this.currentQuestionData) {
            console.error('[QuizBattle] No current question data!');
            return;
        }

        // Check if selected answer matches the correct answer TEXT (not index!)
        const selectedAnswer = this.currentQuestionData.answers[answerIndex];
        const correct = selectedAnswer === this.currentQuestionData.correctAnswerText;

        // Update score
        if (correct) {
            const timeBonus = Math.floor(this.timeLeft * 10);
            this.score += 100 + timeBonus;
        }

        // Show feedback
        this.showAnswerFeedback(answerIndex, correct);

        // Send answer to all peers via DataChannel (host will track scores)
        this.sendData({
            type: 'player-answer',
            playerName: this.username,
            questionIndex: this.currentQuestion,
            answerText: selectedAnswer,
            correct: correct,
            score: this.score,
            timeLeft: this.timeLeft,
            timestamp: Date.now()
        });

        // Move to next question after delay
        setTimeout(() => {
            this.nextQuestion();
        }, 2000);
    }

    showAnswerFeedback(selectedIndex, correct) {
        const buttons = document.querySelectorAll('.answer-btn');

        buttons.forEach((btn, index) => {
            btn.disabled = true;

            // Highlight the correct answer (by comparing text)
            const answerText = this.currentQuestionData.answers[index];
            if (answerText === this.currentQuestionData.correctAnswerText) {
                btn.classList.add('correct');
                // Pop the correct answer so the eye lands on it.
                btn.animate([
                    { transform: 'scale(1)' },
                    { transform: 'scale(1.06)' },
                    { transform: 'scale(1)' },
                ], { duration: 450, easing: 'ease-out' });
                // Confetti from the correct button when I got it right —
                // and a bigger celebration the longer my streak runs.
                if (correct && window.GameKit) {
                    this.streak = (this.streak || 0) + 1;
                    const r = btn.getBoundingClientRect();
                    GameKit.Confetti.burst({
                        x: r.left + r.width / 2,
                        y: r.top + r.height / 2,
                        count: this.streak >= 3 ? 150 : 90,
                        duration: this.streak >= 3 ? 2.0 : 1.5,
                    });
                    GameKit.Sfx.ding();
                    if (this.streak >= 3) {
                        this.showStreakBadge(this.streak);
                    }
                }
            } else if (index === selectedIndex && !correct) {
                btn.classList.add('wrong');
                this.streak = 0;
                if (window.GameKit) GameKit.Sfx.buzz();
                // Head-shake on the wrong pick — instant "nope" feedback.
                btn.animate([
                    { transform: 'translateX(0)' },
                    { transform: 'translateX(-8px)' },
                    { transform: 'translateX(8px)' },
                    { transform: 'translateX(-5px)' },
                    { transform: 'translateX(5px)' },
                    { transform: 'translateX(0)' },
                ], { duration: 400, easing: 'ease-in-out' });
            }
        });

        // Update score display
        document.getElementById('yourScore').textContent = this.score;
    }

    // Floating "🔥 xN STREAK" badge that rises from the score and fades.
    showStreakBadge(streak) {
        const el = document.createElement('div');
        el.textContent = `🔥 x${streak} STREAK!`;
        el.style.cssText =
            'position:fixed;left:50%;top:38%;transform:translateX(-50%);' +
            'font-size:34px;font-weight:800;color:#f59e0b;z-index:99998;' +
            'pointer-events:none;text-shadow:0 2px 12px rgba(0,0,0,0.5);';
        document.body.appendChild(el);
        el.animate([
            { transform: 'translateX(-50%) translateY(0) scale(0.6)', opacity: 0 },
            { transform: 'translateX(-50%) translateY(-20px) scale(1.15)', opacity: 1, offset: 0.25 },
            { transform: 'translateX(-50%) translateY(-70px) scale(1)', opacity: 0 },
        ], { duration: 1400, easing: 'ease-out' }).onfinish = () => el.remove();
    }

    nextQuestion() {
        this.currentQuestion++;

        if (this.currentQuestion >= this.totalQuestions) {
            this.endGame();
            return;
        }

        // Host broadcasts next question (only sends questionText, each player gets their own randomized answers)
        if (this.isHost()) {
            const questionData = this.questionManager.getQuestionWithRandomizedAnswers(this.currentQuestion);
            this.sendData({
                type: 'next-question',
                questionIndex: this.currentQuestion,
                questionText: questionData.question,
                timestamp: Date.now()
            });
        }

        this.showQuestion(this.currentQuestion);
    }

    endGame() {
        console.log('[QuizBattle] Game ended');
        this.gameStarted = false;

        // Add own score to playerScores
        this.playerScores.set(this.username, this.score);

        // Collect final scores
        const scores = new Map();
        this.playerScores.forEach((score, name) => {
            scores.set(name, score);
        });

        console.log('[QuizBattle] Final scores:', Array.from(scores.entries()));

        // Broadcast game end with all scores to all peers
        this.sendData({
            type: 'game-end',
            scores: Array.from(scores.entries()),
            timestamp: Date.now()
        });

        this.showResults(scores);
    }

    showResults(scores) {
        const container = document.getElementById('quizContainer');

        // Convert to sorted array
        const sortedScores = Array.from(scores instanceof Map ? scores : new Map(scores))
            .sort((a, b) => b[1] - a[1]);

        const isHost = this.isHost();

        container.innerHTML = `
            <div class="results-screen">
                <h2>🎉 Quiz Complete!</h2>
                <div class="final-score">Your Score: ${this.score}</div>
                <div class="leaderboard">
                    <h3>🏆 Leaderboard</h3>
                    ${sortedScores.map((entry, index) => {
                        const [name, score] = entry;
                        const rankClass = index === 0 ? 'rank1' : index === 1 ? 'rank2' : index === 2 ? 'rank3' : '';
                        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
                        return `
                            <div class="leaderboard-item ${rankClass}">
                                <span>${medal} ${name}</span>
                                <span>${score} pts</span>
                            </div>
                        `;
                    }).join('')}
                </div>
                ${isHost ? `
                    <button class="start-game-btn" onclick="window.quizGame.restartGame()">
                        🔄 Play Again
                    </button>
                ` : `
                    <p style="margin-top:20px;color:#666;">Waiting for host to start a new game...</p>
                `}
            </div>
        `;
    }

    restartGame() {
        if (!this.isHost()) return;

        this.score = 0;
        this.currentQuestion = 0;
        this.playerScores.clear();
        this.playerAnswers.clear();

        this.showWaitingRoom();
    }
}

// ============================================
// QUIZ QUESTIONS
// ============================================


// ============================================
// INITIALIZATION - Same pattern as whiteboard-client.js
// ============================================

let quizGame = null;

async function connectQuizBattle(username, channel, password) {
    try {
        // Create game instance
        quizGame = new QuizBattleGame();
        window.quizGame = quizGame;

        // Initialize
        await quizGame.initialize();

        // Connect
        await quizGame.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });

        // Start
        quizGame.start();

        // Update URL hash for sharing
        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' + channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }

        console.log('[QuizBattle] Connected and ready!');
    } catch (error) {
        console.error('[QuizBattle] Connection failed:', error);
        if (window.ConnectionModal) ConnectionModal.fail(error);
    }
}

// Initialize connection modal
function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'quiz_',
        channelPrefix: 'quiz-',
        title: 'Join Quiz Battle',
        collapsedTitle: 'Quiz Battle',
        onConnect: function(username, channel, password) {
            connectQuizBattle(username, channel, password);
        }
    });
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    console.log('[QuizBattle] Page loaded');

    // Initialize connection modal
    initializeConnectionModal();

    // Process shared link and setup auto-connect using centralized utility
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'QuizBattle',
            storagePrefix: 'quiz_',
            connectCallback: async function() {
                console.log('[QuizBattle] Auto-connect triggered');
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectQuizBattle(username, channel, password);
                } else {
                    console.warn('[QuizBattle] Auto-connect skipped: missing username or channel');
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
