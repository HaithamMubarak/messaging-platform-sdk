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

// Escapes remote-supplied values (player names, scores, question/answer payloads)
// before they are interpolated into innerHTML strings, to prevent script injection (XSS).
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Sprite icon markup (js/icons.js). Falls back to nothing if the sprite
// script failed to load, so a missing icon never breaks a render.
function qbIcon(name, cls) { return typeof window.icon === 'function' ? window.icon(name, cls) : ''; }

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
    /**
     * The question as it travels between players: its text and its answer set.
     * Every client shuffles its own pool, so an index means nothing to anyone
     * but the client that produced it — the host has to send the question.
     */
    getQuestionPayload(index) {
        if (index >= this.currentQuestionPool.length) return null;
        const q = this.currentQuestionPool[index];
        return {
            question: q.question,
            answers: [q.correctAnswer, ...q.wrongAnswers],
            correctAnswerText: q.correctAnswer
        };
    }

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

        // Solo practice: a host playing alone against the clock. Same
        // questions, same scoring — just no minimum-player gate.
        this.practiceMode = false;
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

        // The header badge was static markup — it said "not connected" for the
        // whole of a connected game.
        const badge = document.getElementById('quizRoomName');
        if (badge && this.channelName) {
            badge.textContent = this.channelName;
            badge.title = 'You are in the room "' + this.channelName + '"';
        }

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

        // Messages only the host is entitled to send. Accepting these from any
        // peer let a player start the game, skip to a question of their
        // choosing, rewrite the scoreboard or end the round for everybody.
        const HOST_ONLY = ['game-start', 'next-question', 'game-state', 'game-end'];
        if (HOST_ONLY.indexOf(data.type) !== -1 && !this.isFromHost(peerId)) {
            console.warn('[QuizBattle] Ignoring', data.type, 'from a non-host peer:', peerId);
            return;
        }

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

    /**
     * The host's scoreboard, replacing whatever this client had.
     *
     * This used to write data.score under the SENDER's name, so any player
     * could set their own total by sending one message. The guard in
     * onDataChannelMessage already restricts this type to the host; this
     * replaces the whole table rather than trusting a single number.
     */
    handleScoreUpdate(peerId, data) {
        if (!Array.isArray(data.scores)) return;
        this.playerScores = new Map(data.scores.map(function (row) {
            return [row.name, row.score];
        }));
        if (typeof this.updatePlayersList === 'function') this.updatePlayersList();
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
                    <h2>${this.icon('crown')} You are the host</h2>
                    <p class="waiting-room__sub">Whoever joins this room plays with you.</p>
                    <div class="players-list">
                        <h3>In the room</h3>
                        <div id="playersList"></div>
                    </div>
                    <div class="waiting-room__go">
                        <button class="btn btn--primary btn--lg" onclick="window.quizGame.startGame()" id="startGameBtn">
                            Start the quiz
                        </button>
                        <button class="btn btn--ghost" onclick="window.quizGame.startSolo()" id="startSoloBtn">
                            Practise alone
                        </button>
                    </div>
                    <p class="waiting-room__hint" id="startHint">
                        Press <strong>Invite</strong> to get somebody else in, or practise alone while you wait.
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
                        ${this.icon('crown', 'is-host')} ${escapeHtml(player.name)}${player.isSelf ? ' (You)' : ''}
                        ${!player.isSelf ? p2pIndicator : ''}
                        <span style="margin-left:auto;font-size:12px;">HOST</span>
                    </div>
                `;
            } else {
                html += `
                    <div class="player-item">
                        👤 ${escapeHtml(player.name)}${player.isSelf ? ' (You)' : ''}
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
            const hint = document.getElementById('startHint');
            const alone = !this.hasEnoughPeers(2);
            if (startBtn) startBtn.disabled = alone;
            // Saying "Start" is disabled without saying why is how a visitor
            // decides the demo is broken. Practising alone is right there.
            if (hint) {
                hint.textContent = alone
                    ? 'A quiz needs somebody to race. Press Invite to get them in — or practise alone while you wait.'
                    : 'Everyone is here. Start when you are ready.';
            }
        }
    }

    /** One sprite icon, for the renderers that build markup as strings. */
    icon(name, extra) {
        return '<svg class="icon ' + (extra || '') + '" aria-hidden="true">'
            + '<use href="#i-' + name + '"></use></svg>';
    }

    /**
     * Practise alone.
     *
     * The quiz needed two people before anything happened, so a visitor who
     * opened it on their own got a disabled button and no way to see what the
     * game even is. Solo runs the same rounds against nobody — the scoring and
     * the questions are identical; there is simply no one to beat.
     */
    startSolo() {
        if (!this.isHost()) return;
        this.soloPractice = true;
        this.startGame(true);
    }

    startGame(solo) {
        if (!this.isHost()) {
            console.warn('[QuizBattle] Only host can start game');
            return;
        }
        if (!solo) this.soloPractice = false;

        if (!this.questionsLoaded) {
            console.error('[QuizBattle] Questions not loaded yet!');
            this.showToast('The questions are still loading — one moment.', 'error');
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

        // The host sends the question, not a pointer to it. Each client shuffles
        // its own pool, so index 0 was a different question on every screen and
        // players were scored against questions they had never been asked.
        const payload = this.questionManager.getQuestionPayload(0);

        this.sendData({
            type: 'game-start',
            questionIndex: 0,
            question: payload,
            timestamp: Date.now()
        });

        // Answer order is still per player — that part was always intended.
        this.showQuestionFromPayload(0, payload);
    }


    handleGameStart(data) {
        console.log('[QuizBattle] Game starting! Received from host:', data);
        this.gameStarted = true;
        this.currentQuestion = data.questionIndex || 0;
        this.score = 0;

        // Show toast using BaseGame method
        this.showToast('🎮 Game started by host!', 'success');

        if (data.question) {
            this.showQuestionFromPayload(this.currentQuestion, data.question);
            return;
        }

        // Older host without the question on the wire: fall back to a local pool.
        if (!this.questionManager.getTotalQuestions()) {
            this.questionManager.prepareQuestionPool(this.totalQuestions, 30);
        }
        this.showQuestion(this.currentQuestion);
    }

    handleNextQuestion(data) {
        console.log('[QuizBattle] Next question from host:', data.questionIndex);
        this.currentQuestion = data.questionIndex;

        if (data.question) {
            this.showQuestionFromPayload(data.questionIndex, data.question);
            return;
        }
        this.showQuestion(data.questionIndex);
    }

    /**
     * The host grades. Players report what they picked, not how they did.
     *
     * Every client used to mark its own answer and send the resulting score,
     * and the host wrote that number straight into the table — so the score was
     * whatever the player said it was, and a player on a slow connection could
     * also claim any time bonus they liked. The host has correctAnswerText and
     * the question clock, so it can decide both.
     *
     * The player's own screen still shows immediate feedback, because waiting
     * for a round trip to find out whether you were right ruins the moment;
     * that local view is now a prediction, and the host's table is the truth.
     */
    handlePlayerAnswer(peerId, data) {
        // Identity from the transport: playerName is the sender's own claim.
        const playerName = this.senderOf(peerId) || peerId;

        if (!this.isHost()) {
            // A non-host only needs to know somebody answered, for the UI.
            this.playerAnswers.set(playerName, data);
            return;
        }

        const question = this.currentQuestionData;
        const answered = typeof data.answerText === 'string' ? data.answerText : null;

        // One answer per player per question: a second one is ignored rather
        // than added, so repeatedly sending the right answer cannot farm points.
        const already = this._answeredThisQuestion && this._answeredThisQuestion.has(playerName);

        let correct = false;
        let awarded = 0;

        if (question && answered !== null && !already) {
            correct = (answered === question.correctAnswerText);
            if (correct) {
                // Time bonus from the host's own clock, not the player's.
                // The host's own remaining clock for this question (10s a
                // question, set where the timer starts), clamped so a stale
                // value cannot inflate the bonus.
                const timeLeft = Math.max(0, Math.min(10, this.timeLeft || 0));
                awarded = 100 + Math.floor(timeLeft * 10);
            }
        }

        if (!already) {
            const running = this.playerScores.get(playerName) || 0;
            this.playerScores.set(playerName, running + awarded);
        }

        this.playerAnswers.set(playerName, {
            playerName: playerName,
            answerText: answered,
            correct: correct,
            score: this.playerScores.get(playerName) || 0
        });

        if (this._answeredThisQuestion) {
            this._answeredThisQuestion.add(playerName);
            this._maybeAdvanceEarly();
        }

        // Publish the table the host just computed, so every screen agrees.
        this.sendData({
            type: 'score-update',
            scores: Array.from(this.playerScores.entries()).map(function (e) {
                return { name: e[0], score: e[1] };
            })
        });
    }

    handleGameState(data) {
        console.log('[QuizBattle] Received game state:', data);
        // Update local state to match
        this.currentQuestion = data.currentQuestion;
        this.gameStarted = data.gameStarted;
        this.showQuestion(this.currentQuestion);
    }

    /**
     * Previous games in this channel, newest first.
     *
     * The scoreboard used to live only in the open tabs, so a result was gone
     * the moment the room emptied. Each finished game is now a stored version,
     * which makes the channel a record of who has played rather than a single
     * overwritten scoreboard.
     */
    loadPastResults(done) {
        if (!this.channel || typeof this.channel.storageGetList !== 'function') {
            if (done) done([]);
            return;
        }
        this.channel.storageGetList('quizbattle_results', (response) => {
            if (!response || response.status !== 'success') { if (done) done([]); return; }

            let rows = response.data && response.data.data ? response.data.data : response.data;
            if (!Array.isArray(rows)) rows = (rows && rows.versions) ? rows.versions : [];

            const games = [];
            rows.forEach((row) => {
                if (row && row.unreadable) return;
                try {
                    const raw = (row && row.content !== undefined) ? row.content : row;
                    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (body && Array.isArray(body.scores)) games.push(body);
                } catch (e) { /* a version we cannot read is skipped */ }
            });
            games.sort((a, b) => (b.at || 0) - (a.at || 0));
            if (done) done(games);
        });
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
            this.showToast('No questions could be loaded.', 'error');
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
            this.showToast('That question would not load.', 'error');
            return;
        }

        this.displayQuestion(index, this.currentQuestionData);
    }

    /**
     * Render a question the host put on the wire. The answer order is shuffled
     * here, per client, which is the randomisation the game actually wanted.
     */
    showQuestionFromPayload(index, payload) {
        if (!payload || !payload.answers) {
            console.error('[QuizBattle] question payload missing at index', index);
            return;
        }
        this.currentQuestionData = {
            question: payload.question,
            answers: this.questionManager.shuffleArray([...payload.answers]),
            correctAnswerText: payload.correctAnswerText
        };
        this.displayQuestion(index, this.currentQuestionData);
    }

    displayQuestion(index, questionData) {
        const container = document.getElementById('quizContainer');

        const letters = ['A', 'B', 'C', 'D'];

        container.innerHTML = `
            <div class="question-header">
                <div class="question-number">Question ${index + 1} of ${this.totalQuestions}</div>
                <div class="question-text">${escapeHtml(questionData.question)}</div>
            </div>
            <div class="timer-bar">
                <div class="timer-fill" id="timerProgress" style="width: 100%;"></div>
            </div>
            <div class="answers-grid" id="answersGrid">
                ${questionData.answers.map((answer, i) => `
                    <button class="answer-btn" onclick="window.quizGame.selectAnswer(${i})" data-index="${i}">
                        <div class="answer-letter">${letters[i]}</div>
                        <div>${escapeHtml(answer)}</div>
                    </button>
                `).join('')}
            </div>
        `;

        // Update header
        document.getElementById('questionNum').textContent = `${index + 1}/${this.totalQuestions}`;
        document.getElementById('yourScore').textContent = this.score;

        // Start timer
        this.startTimer();

        // The host advances the room, so it needs a deadline that does not
        // depend on when it personally answers — otherwise a fast host cuts
        // everyone else off mid-question.
        if (this.isHost()) {
            this._answeredThisQuestion = new Set();
            clearTimeout(this._advanceTimer);
            this._advanceTimer = setTimeout(() => this.nextQuestion(), (10 + 2) * 1000);
        }
    }

    /**
     * Host only: everyone has answered, so there is nothing left to wait for.
     */
    _maybeAdvanceEarly() {
        if (!this.isHost() || !this.gameStarted) return;
        const expected = new Set([this.username, ...this.getConnectedUsers()]);
        for (const name of expected) {
            if (!this._answeredThisQuestion.has(name)) return;
        }
        clearTimeout(this._advanceTimer);
        this._advanceTimer = setTimeout(() => this.nextQuestion(), 2000);
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
        // Only what was picked. `correct`, `score` and `timeLeft` used to travel
        // with it and the host believed all three; the host works them out now.
        this.sendData({
            type: 'player-answer',
            questionIndex: this.currentQuestion,
            answerText: selectedAnswer,
            timestamp: Date.now()
        });

        // Only the host moves the room on. Every client used to advance its own
        // index on its own timer, so players drifted onto different questions.
        if (this.isHost()) {
            this._answeredThisQuestion.add(this.username);
            this._maybeAdvanceEarly();
        }
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
        clearTimeout(this._advanceTimer);
        this._advanceTimer = null;
        this.currentQuestion++;

        if (this.currentQuestion >= this.totalQuestions) {
            this.endGame();
            return;
        }

        // Host broadcasts the question itself; answer order stays per player.
        const payload = this.questionManager.getQuestionPayload(this.currentQuestion);
        if (this.isHost()) {
            this.sendData({
                type: 'next-question',
                questionIndex: this.currentQuestion,
                question: payload,
                timestamp: Date.now()
            });
        }

        this.showQuestionFromPayload(this.currentQuestion, payload);
    }

    endGame() {
        console.log('[QuizBattle] Game ended');
        this.gameStarted = false;
        clearTimeout(this._advanceTimer);
        this._advanceTimer = null;

        // The host's own score is already in playerScores: the host grades
        // every answer including its own. `this.score` is the local
        // prediction shown for instant feedback, and overwriting the graded
        // total with it puts the untrusted number back in charge of the
        // result — exactly what moving grading to the host removed. Only seed
        // it when the host has no graded entry at all.
        if (!this.playerScores.has(this.username)) {
            this.playerScores.set(this.username, this.score || 0);
        }

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

        // And keep them. A result that exists only in the tabs that were open
        // is gone the moment the room empties, which for a quiz between friends
        // is the one thing anybody wants afterwards. Host-only write, encrypted
        // like everything else in channel storage, appended as a version so the
        // channel accumulates a record of games rather than one overwritten
        // scoreboard.
        if (this.isHost() && this.channel && typeof this.channel.storageAdd === 'function') {
            const finished = {
                at: Date.now(),
                scores: Array.from(scores.entries()).map(([name, score]) => ({ name, score }))
            };
            this.channel.storageAdd({
                storageKey: 'quizbattle_results',
                content: JSON.stringify(finished),
                encrypted: true,
                metadata: { at: finished.at, players: finished.scores.length }
            }, (response) => {
                if (!response || response.status !== 'success') {
                    console.warn('[QuizBattle] Could not keep the results:',
                        (response && response.statusMessage) || 'unknown');
                }
            });
        }

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
                <h2>Quiz complete</h2>
                <div class="final-score">Your score: ${this.score}</div>
                <div class="leaderboard">
                    <h3>${this.icon('trophy')} Leaderboard</h3>
                    ${sortedScores.map((entry, index) => {
                        const [name, score] = entry;
                        const rankClass = index === 0 ? 'rank1' : index === 1 ? 'rank2' : index === 2 ? 'rank3' : '';
                        const medal = index === 0 ? this.icon('trophy', 'is-gold')
                            : index === 1 ? this.icon('medal', 'is-silver')
                            : index === 2 ? this.icon('medal', 'is-bronze')
                            : this.icon('users', 'is-rest');
                        return `
                            <div class="leaderboard-item ${rankClass}">
                                <span>${medal} ${escapeHtml(name)}</span>
                                <span>${escapeHtml(score)} pts</span>
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
