/**
 * Find the Liar - Secret Item Edition
 * 
 * A multiplayer social deduction game where:
 * - Each round, a SECRET ITEM is selected
 * - Non-liars see the item name and image
 * - The Liar only gets hints (category + clues) but NOT the item name
 * - Players answer questions about the item
 * - After questioning rounds, players vote to find the Liar
 * 
 * Game Flow:
 * WAITING → ROLE_ASSIGNMENT → QUESTIONING (loop) → VOTING → REVEAL → ROUND_END
 * 
 * Inherited from AgentSessionBase:
 * - connect() / disconnect() - Connection management
 * - sendData() - P2P data transmission
 * - isHost() - Check if current player is host
 * - getPlayerList() / getPlayerCount() - Player management
 * - hasEnoughPlayers() - Check minimum players
 * - showToast() - Toast notifications
 * - showConnectionLoader() / hideConnectionLoader() - Loading overlay
 * - generateUserColor() - Consistent player colors
 * - Event emitter (on/off/emit) - Custom events
 */

// ============================================
// GAME CONFIGURATION
// ============================================

const GamePhase = {
    WAITING: 'WAITING',
    ROLE_ASSIGNMENT: 'ROLE_ASSIGNMENT',
    QUESTIONING: 'QUESTIONING',
    DISCUSSION: 'DISCUSSION',
    VOTING: 'VOTING',
    REVEAL: 'REVEAL',
    ROUND_END: 'ROUND_END'
};

// Game modes
const GameMode = {
    SURVIVAL: 'SURVIVAL',           // Elimination mode: players can be eliminated
    INVESTIGATION: 'INVESTIGATION'  // Non-elimination: catch liars before max rounds
};

// Timer durations in milliseconds
const PHASE_DURATIONS = {
    ROLE_ASSIGNMENT: 10000,   // 10 seconds to study your role/item/hints
    QUESTIONING: 20000,       // 20 seconds per question
    DISCUSSION: 15000,        // 15 seconds to review all answers before voting
    VOTING: 15000,            // 15 seconds to vote
    REVEAL: 8000,             // 8 seconds to see results
    ROUND_END: 5000           // 5 seconds before next round
};

// Game limits
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const QUESTIONS_PER_ROUND = 3;    // Fixed: 3 questions per round
const MAX_ROUNDS = 5;              // If liar survives 5 rounds, liar wins!
const MAX_ANSWER_LENGTH = 200;
const VOTE_THRESHOLD = 0.5;        // ≥50% of votes needed to eliminate/catch

// UI Timing Constants (milliseconds)
const ANSWER_REVEAL_DELAY = 4000;  // Time to display answers before moving on
const LIAR_CELEBRATION_DURATION = 3000; // Duration of liar celebration animation
const CONNECTION_LOADER_TIMEOUT = 2000; // Fallback timeout for connection loader
const HOST_MIGRATION_DELAY = 100;  // Delay for host migration check

// Liar Selection Rules
const MIN_PLAYERS_FOR_TWO_LIARS = 7; // Minimum players required for 2 liars
const MAX_LIAR_PERCENTAGE = 0.5;     // Maximum 50% of players can be liars

// UI Constants
const PLAYER_INITIAL_HINT_COUNT = 2; // Number of hints shown in item reminder
const CELEBRATION_EMOJI_COUNT = 20;  // Number of emojis in celebration

// ============================================
// FIND THE LIAR GAME CLASS
// ============================================

class FindTheLiarGame extends AgentInteractionBase {
    constructor() {
        super({
            storagePrefix: 'liar',
            customType: 'find-the-liar',
            autoCreateDataChannel: true,
            dataChannelName: 'liar-data',
            dataChannelOptions: {
                ordered: true,
                maxRetransmits: 5
            }
        });

        // Item manager
        this.itemManager = new ItemManager();

        // Game state (host-authoritative)
        this.gameState = {
            phase: GamePhase.WAITING,
            round: 0,
            
            // Game settings
            gameMode: GameMode.SURVIVAL,  // SURVIVAL or INVESTIGATION
            numLiars: 1,                  // 1 or 2 (based on player count)
            questionsPerRound: QUESTIONS_PER_ROUND,
            maxRounds: MAX_ROUNDS,
            reviewAnswersBeforeVoting: false,

            // Liar celebration settings
            liarCelebrationEmoji: '😈',  // Default emoji for liar celebration
            liarCelebrationText: 'HAHAHA!', // Default text for liar celebration

            // Current game data
            currentItem: null,          // The secret item
            // liarNames removed for security - each player only knows their own role!
            eliminatedPlayers: new Set(), // Players eliminated in Survival mode
            revealedLiars: new Set(),   // Liars caught in Investigation mode (can't vote)

            // Role tracking (for game end)
            playerRoles: new Map(),     // Stores reported roles at game end

            // Question tracking
            questions: [],
            currentQuestionIndex: 0,

            // Answers collected per question
            currentAnswers: new Map(),
            allAnswers: [],

            // Voting
            votes: new Map(),

            // Timing
            phaseEndTime: null
        };

        // Local player state
        this.myRole = null;             // 'LIAR' or 'INNOCENT'
        this.myItemInfo = null;         // What I know about the item
        this.myCurrentAnswer = null;
        this.hasAnswered = false;
        this.hasVoted = false;

        // Timer
        this.timerInterval = null;
        this.connectedPeers = new Set();
        this.joiningPlayers = new Set(); // Track players who are connecting

        console.log('[FindTheLiar] Game instance created');
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    async onInitialize() {
        console.log('[FindTheLiar] Initializing...');
        
        this.setupUI();
        
        console.log('[FindTheLiar] Ready!');
    }

    setupUI() {
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn && typeof ShareModal !== 'undefined') {
            shareBtn.addEventListener('click', () => {
                if (this.connected) {
                    ShareModal.show(this.channelName, this.channelPassword);
                } else {
                    this.showToast('Connect first to share', 'warning');
                }
            });
        }

        // Create floating control panel
        this.createFloatingControlPanel();
    }

    createFloatingControlPanel() {
        // Remove existing panel if any (handled by GameControlPanel singleton)
        this.initializeControlPanel();
    }

    initializeControlPanel() {
        if (typeof GameControlPanel === 'undefined') {
            console.warn('[FindTheLiar] GameControlPanel not loaded');
            return;
        }

        this.controlPanel = new GameControlPanel({
            gameName: 'Find the Liar',
            gameIcon: '🤥',  // Liar game icon
            agentName: this.username,  // Current player name
            isHost: this.isHost(),
            isPaused: this.isPaused || false,
            isPauseEnabled: this.gameState.phase !== GamePhase.WAITING,  // Enable pause only when game is running
            roomCode: this.channelName,
            roomPassword: this.channelPassword,  // For share modal
            shareUrl: window.location.href,
            startCollapsed: false,  // Start expanded
            savePosition: false,  // Don't save position to localStorage
            defaultPosition: { x: 20, y: 20 },  // Top-left position

            // Custom buttons
            customButtons: [
                {
                    id: 'reset-game',
                    icon: '🔄',
                    label: 'Reset Game',
                    onClick: () => {
                        if (this.isHost()) {
                            this.confirmReset();
                        }
                    },
                    visible: true,
                    hostOnly: true,
                    class: 'btn-warning-style'
                }
            ],

            // Callbacks
            onPauseToggle: (isPaused) => {
                if (isPaused) {
                    this.pauseGameFromControlPanel();
                } else {
                    this.resumeGameFromControlPanel();
                }
            },

            onShare: () => {
                // Trigger same action as non-floating shareBtn
                const shareBtn = document.getElementById('shareBtn');
                if (shareBtn) {
                    shareBtn.click();
                }
            },

            onLeave: () => {
                // Trigger same action as non-floating disconnectBtn (calls disconnect() function)
                if (typeof disconnect === 'function') {
                    disconnect();
                }
            }
        });

        // Initial update
        this.updateControlPanel();
    }

    /**
     * Update control panel state
     */
    updateControlPanel() {
        if (this.controlPanel) {
            this.controlPanel.updateState({
                isHost: this.isHost(),
                isPaused: this.isPaused || false,
                isPauseEnabled: this.gameState.phase !== GamePhase.WAITING,  // Enable pause only when game is running
                roomCode: this.channelName,
                roomPassword: this.channelPassword,
                agentName: this.username
            });
        }
    }

    /**
     * Pause game from control panel
     */
    pauseGameFromControlPanel() {
        if (!this.isHost()) {
            this.showToast('Only host can pause the game', 'warning');
            return;
        }

        this.isPaused = true;

        // Save remaining time when pausing
        if (this.gameState.phaseEndTime) {
            this.pausedTimeRemaining = Math.max(0, this.gameState.phaseEndTime - Date.now());
        }

        // Show pause overlay
        this.showPauseOverlay();

        // Broadcast pause state to all players
        this.sendData({
            type: 'game-paused',
            paused: true,
            pausedTimeRemaining: this.pausedTimeRemaining
        });

        this.showToast('⏸️ Game Paused', 'info');
    }

    /**
     * Resume game from control panel
     */
    resumeGameFromControlPanel() {
        if (!this.isHost()) {
            this.showToast('Only host can resume the game', 'warning');
            return;
        }

        this.isPaused = false;

        // Restore remaining time when resuming
        if (this.pausedTimeRemaining) {
            this.gameState.phaseEndTime = Date.now() + this.pausedTimeRemaining;
        }

        // Hide pause overlay
        this.hidePauseOverlay();

        // Broadcast resume state
        this.sendData({
            type: 'game-paused',
            paused: false,
            phaseEndTime: this.gameState.phaseEndTime
        });

        this.showToast('▶️ Game Resumed', 'success');
    }

    showFloatingControls() {
        if (this.controlPanel && this.controlPanel.container) {
            this.controlPanel.container.style.display = 'block';
            this.controlPanel.container.style.visibility = 'visible';
        }
    }

    hideFloatingControls() {
        if (this.controlPanel && this.controlPanel.container) {
            this.controlPanel.container.style.display = 'none';
        }
    }

    // =========================================================================
    // Control Panel Actions
    // =========================================================================

    togglePause() {
        if (!this.isHost()) {
            this.showToast('Only host can pause the game', 'warning');
            return;
        }

        this.isPaused = !this.isPaused;

        // Update control panel state
        this.updateControlPanel();

        if (this.isPaused) {
            // Stop the timer
            if (this.phaseTimer) {
                clearInterval(this.phaseTimer);
                this.phaseTimer = null;
            }

            // Show pause overlay
            this.showPauseOverlay();

            // Broadcast pause state to all players
            this.sendData({
                type: 'game-paused',
                paused: true
            });

            this.showToast('⏸️ Game Paused', 'info');
        } else {
            // Resume the timer
            this.startPhaseTimer(this.gameState.phase);

            // Hide pause overlay
            this.hidePauseOverlay();

            // Broadcast resume state
            this.sendData({
                type: 'game-paused',
                paused: false
            });

            this.showToast('▶️ Game Resumed', 'success');
        }
    }

    showPauseOverlay() {
        let overlay = document.getElementById('pauseOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'pauseOverlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9998;
                animation: fadeIn 0.3s ease;
            `;

            const content = document.createElement('div');
            content.style.cssText = `
                text-align: center;
                color: white;
            `;
            content.innerHTML = `
                <div style="font-size: 80px; margin-bottom: 20px;">⏸️</div>
                <h2 style="font-size: 36px; margin: 0 0 10px 0;">Game Paused</h2>
                <p style="font-size: 18px; color: #aaa;">Waiting for host to resume...</p>
            `;

            overlay.appendChild(content);
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    }

    hidePauseOverlay() {
        const overlay = document.getElementById('pauseOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    shareGame() {
        if (!this.connected) {
            this.showToast('Connect first to share', 'warning');
            return;
        }

        if (typeof ShareModal !== 'undefined' && ShareModal.show) {
            ShareModal.show(this.channelName, this.channelPassword);
        } else {
            // Fallback: copy to clipboard
            const gameUrl = `${window.location.origin}${window.location.pathname}#${btoa(JSON.stringify({
                c: this.channelName,
                p: this.channelPassword
            }))}`;

            navigator.clipboard.writeText(gameUrl).then(() => {
                this.showToast('🔗 Game link copied to clipboard!', 'success');
            }).catch(() => {
                this.showToast('Game: ' + this.channelName, 'info', 5000);
            });
        }
    }

    confirmDisconnect() {
        if (confirm('Are you sure you want to disconnect from the game?')) {
            this.disconnect();
        }
    }

    // =========================================================================
    // Connection Events
    // =========================================================================

    onConnect(detail) {
        console.log('[FindTheLiar] Connected:', detail);

        // Show loader while establishing DataChannel connections
        this.showConnectionLoader('Establishing peer connections...');

        // Update URL hash
        if (this.channelName && this.channelPassword) {
            const hash = btoa(JSON.stringify({
                c: this.channelName,
                p: this.channelPassword
            }));
            window.history.replaceState(null, '', `#${hash}`);
        }

        setTimeout(() => {
            if (window.ConnectionModal?.hide) {
                window.ConnectionModal.hide();
            }
        }, 100);

        // Show disconnect button
        const disconnectBtn = document.getElementById('disconnectBtn');
        if (disconnectBtn) {
            disconnectBtn.style.display = 'block';
        }

        // Show floating control panel
        this.showFloatingControls();

        this.showWaitingRoom();
        this.updatePlayersList();
        this.updateRoundDisplay(); // Initialize round display

        // Hide loader after a short delay if no DataChannels are pending
        setTimeout(() => {
            if (this.connectedPeers.size === 0 && this.joiningPlayers.size === 0) {
                this.hideConnectionLoader();
            }
        }, CONNECTION_LOADER_TIMEOUT);
    }

    onPlayerJoining(detail) {
        console.log('[FindTheLiar] Player joining (connecting):', detail.agentName);
        this.showToast(`⏳ ${detail.agentName} is connecting...`, 'info');
        this.joiningPlayers.add(detail.agentName);
        this.updatePlayersList();
    }

    onPlayerJoin(detail) {
        console.log('[FindTheLiar] Player joined (DataChannel ready):', detail.agentName);
        this.showToast(`👋 ${detail.agentName} joined!`, 'success');

        this.joiningPlayers.delete(detail.agentName); // Remove from joining state
        this.updatePlayersList();
        this.updateStartButton();

        // Send game state to late joiner
        if (this.isHost() && this.gameState.phase !== GamePhase.WAITING) {
            this.sendGameStateToPlayer(detail.agentName);
        }
    }

    onPlayerLeave(detail) {
        console.log('[FindTheLiar] Player left:', detail.agentName);
        this.showToast(`👋 ${detail.agentName} left`, 'warning');
        
        this.connectedPeers.delete(detail.agentName);
        this.joiningPlayers.delete(detail.agentName); // Also remove from joining state
        this.updatePlayersList();
        this.updateStartButton();

        // Host migration check
        setTimeout(() => {
            if (this.isHost() && !this.wasHost) {
                this.wasHost = true;
                this.showToast('👑 You are now the host!', 'info');

                // Refresh waiting room to show start button and settings for new host
                if (this.gameState.phase === GamePhase.WAITING) {
                    this.showWaitingRoom();
                }

                this.updateStartButton();
            }
        }, HOST_MIGRATION_DELAY);
    }

    onDataChannelOpen(peerId) {
        console.log('[FindTheLiar] DataChannel open:', peerId);
        this.connectedPeers.add(peerId);
        this.updatePlayersList();

        // Hide loader when first DataChannel connection is established
        this.hideConnectionLoader();
    }

    onDataChannelClose(peerId) {
        console.log('[FindTheLiar] DataChannel closed:', peerId);
        this.connectedPeers.delete(peerId);
        this.updatePlayersList();
    }

    onDataChannelMessage(peerId, data) {
        console.log('[FindTheLiar] Message from', peerId, ':', data.type);
        
        switch (data.type) {
            // Host broadcasts
            case 'phase-change':
                this.handlePhaseChange(data);
                break;
            case 'role-assignment':
                this.handleRoleAssignment(data);
                break;
            case 'question-start':
                this.handleQuestionStart(data);
                break;
            case 'answers-reveal':
                this.handleAnswersReveal(data);
                break;
            case 'vote-results':
                this.handleVoteResults(data);
                break;
            case 'liar-secret-revealed':
                this.handleLiarSecretRevealed(data);
                break;
            case 'liar-celebration':
                this.handleLiarCelebration(data);
                break;
            case 'liar-disturbance-broadcast':
                this.handleLiarDisturbanceBroadcast(data);
                break;
            case 'game-state-sync':
                this.handleGameStateSync(data);
                break;
            case 'settings-update':
                this.handleSettingsUpdate(data);
                break;
            case 'game-over':
                this.handleGameOver(data);
                break;
            case 'game-reset':
                this.handleGameReset(data);
                break;
            case 'game-paused':
                this.handleGamePaused(data);
                break;

            // Player to host
            case 'submit-answer':
                this.handleSubmitAnswer(peerId, data);
                break;
            case 'submit-vote':
                this.handleSubmitVote(peerId, data);
                break;
            case 'request-new-round':
                this.handleNewRoundRequest(peerId);
                break;
            case 'request-role-reveal':
                this.handleRoleRevealRequest(data);
                break;
            case 'role-reveal-response':
                this.handleRoleRevealResponse(peerId, data);
                break;
            case 'liar-disturbance':
                this.handleLiarDisturbance(peerId, data);
                break;
        }
    }

    // =========================================================================
    // Game Flow - Host Controls
    // =========================================================================

    confirmReset() {
        if (!this.isHost()) return;

        if (confirm('⚠️ Are you sure you want to reset the game?\n\nThis will:\n• Return to waiting room\n• Clear all progress\n• Reset round counter\n• Allow settings changes\n\nAll players will return to the lobby.')) {
            this.resetGame();
        }
    }

    resetGame() {
        if (!this.isHost()) return;

        console.log('[FindTheLiar] Resetting game...');

        // Reset all game state
        this.gameState.phase = GamePhase.WAITING;
        this.gameState.round = 0;
        this.gameState.currentItem = null;
        this.gameState.eliminatedPlayers.clear();
        this.gameState.revealedLiars.clear();
        this.gameState.playerRoles.clear();
        this.gameState.questions = [];
        this.gameState.currentQuestionIndex = 0;
        this.gameState.currentAnswers.clear();
        this.gameState.allAnswers = [];
        this.gameState.votes.clear();
        this.gameState.phaseEndTime = null;

        this.resetLocalState();

        // Stop timer
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Broadcast reset to all players
        this.sendData({
            type: 'game-reset'
        });

        this.showToast('Game reset! Ready to start fresh.', 'success');
        this.showWaitingRoom();
        this.updateRoundDisplay();

        // Update control panel to disable pause button in waiting room
        this.updateControlPanel();
    }

    startRound() {
        if (!this.isHost()) return;

        // Check minimum players requirement
        if (!this.hasMinimumPlayers()) {
            this.showToast(`Need at least ${MIN_PLAYERS} players`, 'error');
            return;
        }

        // Check if game should end (liar survived maxRounds)
        const maxRounds = this.gameState.maxRounds || MAX_ROUNDS;
        if (this.gameState.round >= maxRounds) {
            this.showToast(`Game complete! Liar survived ${maxRounds} rounds and wins!`, 'info');
            return;
        }

        console.log('[FindTheLiar] Starting new round...');

        // Reset round state
        this.gameState.round++;
        this.gameState.currentQuestionIndex = 0;
        this.gameState.currentAnswers.clear();
        this.gameState.allAnswers = [];
        this.gameState.votes.clear();
        this.resetLocalState();

        // Select item for this round
        this.gameState.currentItem = this.itemManager.getRandomItem();

        // Select liars ONLY on round 1 (roles persistent, but not stored on host!)
        if (this.gameState.round === 1) {
            const players = this.getPlayerList().map(p => p.name);
            const activeNonEliminated = players.filter(p => !this.gameState.eliminatedPlayers.has(p));

            // Determine liar count based on player count
            let numLiars = this.gameState.numLiars || 1;
            if (activeNonEliminated.length < MIN_PLAYERS_FOR_TWO_LIARS) {
                numLiars = 1; // Force 1 liar if <7 players
            }
            numLiars = Math.min(numLiars, Math.floor(activeNonEliminated.length * MAX_LIAR_PERCENTAGE));

            // Randomly select liars (temporary - only for distribution)
            const tempLiarNames = [];
            const shuffledPlayers = [...activeNonEliminated].sort(() => Math.random() - 0.5);
            for (let i = 0; i < numLiars; i++) {
                tempLiarNames.push(shuffledPlayers[i]);
            }

            console.log('╔══════════════════════════════════════════════════════════════╗');
            console.log('║ [FindTheLiar] ROLES ASSIGNED (NOT STORED FOR SECURITY):     ║');
            console.log(`║ ${tempLiarNames.length} liar(s) selected                                     ║`);
            console.log('║ Roles distributed privately - host does not know who!       ║');
            console.log('╚══════════════════════════════════════════════════════════════╝');

            // Store temporarily for role distribution, then clear
            this.tempLiarNames = tempLiarNames;
        } else {
            console.log(`[FindTheLiar] Round ${this.gameState.round}: Players remember their roles from Round 1`);
        }

        // Get questions for this round
        const questionsCount = this.gameState.questionsPerRound || QUESTIONS_PER_ROUND;
        this.gameState.questions = this.itemManager.getShuffledQuestions(questionsCount);

        console.log('[FindTheLiar] Round', this.gameState.round, '/', maxRounds);
        console.log('[FindTheLiar] Questions:', questionsCount);
        console.log('[FindTheLiar] Item:', this.gameState.currentItem.name);
        console.log('[FindTheLiar] Liars: (hidden for security - will be revealed at game end)');

        // Start role assignment phase
        this.transitionToPhase(GamePhase.ROLE_ASSIGNMENT);
    }

    transitionToPhase(newPhase) {
        if (!this.isHost()) return;

        console.log('[FindTheLiar] Phase:', newPhase);

        this.gameState.phase = newPhase;
        this.gameState.phaseEndTime = Date.now() + (PHASE_DURATIONS[newPhase] || 0);

        // Broadcast phase change with all answers for discussion phase
        const phaseData = {
            type: 'phase-change',
            phase: newPhase,
            phaseEndTime: this.gameState.phaseEndTime,
            round: this.gameState.round,
            maxRounds: this.gameState.maxRounds || MAX_ROUNDS,
            questionIndex: this.gameState.currentQuestionIndex,
            totalQuestions: this.gameState.questions.length
        };

        // Include all answers for discussion phase
        if (newPhase === GamePhase.DISCUSSION) {
            phaseData.allAnswers = this.gameState.allAnswers;
        }

        this.sendData(phaseData);

        // Phase-specific actions
        switch (newPhase) {
            case GamePhase.ROLE_ASSIGNMENT:
                this.distributeRoles();
                break;
            case GamePhase.QUESTIONING:
                this.broadcastCurrentQuestion();
                break;
            case GamePhase.DISCUSSION:
                this.showDiscussionScreen(this.gameState.allAnswers);
                break;
            case GamePhase.VOTING:
                // Just show voting UI
                break;
            case GamePhase.REVEAL:
                this.revealLiarAndScores();
                break;
            case GamePhase.ROUND_END:
                // Show round end screen - host must manually start next round
                // No automatic transition - wait for host to click "New Round" button
                break;
        }

        this.onPhaseChange(newPhase);
        this.startPhaseTimer(newPhase);

        // Update control panel to enable/disable pause button based on phase
        this.updateControlPanel();
    }

    distributeRoles() {
        if (!this.isHost()) return;

        const players = this.getPlayerList();
        const item = this.gameState.currentItem;

        // Only use tempLiarNames in round 1, otherwise each player remembers their role
        const isRound1 = this.gameState.round === 1;

        players.forEach(player => {
            let isLiar, isRevealedLiar;

            if (isRound1) {
                // Round 1: Assign new roles
                isLiar = this.tempLiarNames.includes(player.name);
                if (player.isSelf) {
                    // Host saves their own role for future rounds
                    this.myPersistentRole = isLiar ? 'LIAR' : 'INNOCENT';
                }
            } else {
                // Round 2+: Use stored role (each player remembers)
                if (player.isSelf) {
                    isLiar = (this.myPersistentRole === 'LIAR');
                } else {
                    // For remote players, they already know their role from round 1
                    // We don't actually know their role on the host!
                    // This is just for determining what info to send
                    // We'll send the role indicator in the message
                    isLiar = null; // We don't know!
                }
            }

            isRevealedLiar = this.gameState.revealedLiars.has(player.name);

            // In Investigation mode, revealed liars get the truth (but keep liar role indicator)
            const shouldGetTruth = (isRound1 ? !isLiar : !isLiar) || isRevealedLiar;

            const roleData = {
                type: 'role-assignment',
                role: isRevealedLiar ? 'REVEALED_LIAR' : (isRound1 ? (isLiar ? 'LIAR' : 'INNOCENT') : 'REMEMBER'), // Round 2+: 'REMEMBER' means use stored role
                itemInfo: shouldGetTruth
                    ? this.itemManager.getNonLiarInfo(item)
                    : this.itemManager.getLiarInfo(item),
                round: this.gameState.round,
                totalQuestions: this.gameState.questions.length,
                numLiars: this.tempLiarNames ? this.tempLiarNames.length : this.gameState.numLiars,
                currentItem: !isRound1 ? item : undefined // Send item for round 2+ so clients can generate itemInfo
            };

            if (player.isSelf) {
                if (roleData.role === 'REMEMBER') {
                    roleData.role = this.myPersistentRole; // Use stored role
                    roleData.itemInfo = this.myPersistentRole === 'LIAR'
                        ? this.itemManager.getLiarInfo(item)
                        : this.itemManager.getNonLiarInfo(item);
                }
                this.myRole = roleData.role;
                this.myItemInfo = roleData.itemInfo;
                this.showRoleScreen(roleData);
            } else {
                this.sendData(roleData, player.name);
            }
        });

        // Clear temporary liar names after distribution (security!)
        if (isRound1) {
            delete this.tempLiarNames;
            console.log('[FindTheLiar] Temporary liar names cleared from host memory');
        }
    }

    broadcastCurrentQuestion() {
        if (!this.isHost()) return;

        const question = this.gameState.questions[this.gameState.currentQuestionIndex];
        this.gameState.currentAnswers.clear();
        
        this.sendData({
            type: 'question-start',
            questionIndex: this.gameState.currentQuestionIndex,
            totalQuestions: this.gameState.questions.length,
            question: question,
            round: this.gameState.round
        });

        // Reset local answer state
        this.hasAnswered = false;
        this.myCurrentAnswer = null;

        this.showQuestionScreen(question, this.gameState.currentQuestionIndex);
    }

    revealCurrentAnswers() {
        if (!this.isHost()) return;

        const answers = Array.from(this.gameState.currentAnswers.entries()).map(([name, answer]) => ({
            name, answer
        }));

        // Store in all answers history
        this.gameState.allAnswers.push({
            questionIndex: this.gameState.currentQuestionIndex,
            question: this.gameState.questions[this.gameState.currentQuestionIndex],
            answers: answers
        });

        this.sendData({
            type: 'answers-reveal',
            questionIndex: this.gameState.currentQuestionIndex,
            answers: answers,
            round: this.gameState.round
        });

        this.showAnswerRevealScreen(answers);
    }

    advanceToNextQuestion() {
        if (!this.isHost()) return;

        this.gameState.currentQuestionIndex++;

        if (this.gameState.currentQuestionIndex >= this.gameState.questions.length) {
            // All questions done - check if review is enabled
            if (this.gameState.reviewAnswersBeforeVoting) {
                // Go to DISCUSSION phase (review all answers)
                this.transitionToPhase(GamePhase.DISCUSSION);
            } else {
                // Skip directly to VOTING
                this.transitionToPhase(GamePhase.VOTING);
            }
        } else {
            // Next question
            this.transitionToPhase(GamePhase.QUESTIONING);
        }
    }

    revealLiarAndScores() {
        if (!this.isHost()) return;

        const playerCount = this.getPlayerCount();
        const voteThreshold = Math.ceil(playerCount * VOTE_THRESHOLD);

        // Tally votes
        const voteCounts = new Map();
        this.gameState.votes.forEach((votedFor) => {
            voteCounts.set(votedFor, (voteCounts.get(votedFor) || 0) + 1);
        });

        // We can't determine who was caught without knowing who the liars are!
        // So for between-round votes, we just show vote counts
        // At game end, we'll collect roles from all players

        const voteResults = Array.from(voteCounts.entries()).map(([name, count]) => ({
            name,
            count,
            metThreshold: count >= voteThreshold,
            wasEliminated: this.gameState.eliminatedPlayers.has(name)
        }));

        // MODE-SPECIFIC LOGIC
        if (this.gameState.gameMode === GameMode.SURVIVAL) {
            // SURVIVAL MODE: Eliminate players who got ≥50% votes
            const eliminatedThisRound = [];
            voteCounts.forEach((count, playerName) => {
                if (count >= voteThreshold && !this.gameState.eliminatedPlayers.has(playerName)) {
                    this.gameState.eliminatedPlayers.add(playerName);
                    eliminatedThisRound.push(playerName);
                }
            });

            // Check win condition for Survival mode:
            // 1. If we reached max rounds -> game ends
            // 2. If we have 3 or fewer players AND someone was just eliminated -> game ends
            const activePlayers = this.getPlayerList().filter(p => !this.gameState.eliminatedPlayers.has(p.name));

            if (this.gameState.round >= this.gameState.maxRounds) {
                // Max rounds reached - game ends
                console.log('[FindTheLiar] Survival: Max rounds reached, ending game');
                this.requestRoleReveal('SURVIVAL');
                return;
            }

            if (activePlayers.length <= 3 && eliminatedThisRound.length > 0) {
                // Just eliminated someone and now at 3 or fewer - game ends
                console.log('[FindTheLiar] Survival: 3 or fewer players remain after elimination, ending game');
                this.requestRoleReveal('SURVIVAL');
                return;
            }
        } else {
            // INVESTIGATION MODE
            // Track which players got caught (≥50% votes)
            const caughtPlayers = [];
            voteCounts.forEach((count, playerName) => {
                if (count >= voteThreshold) {
                    caughtPlayers.push(playerName);
                }
            });

            // Add to revealed liars list (we'll verify they're actually liars at game end)
            caughtPlayers.forEach(name => this.gameState.revealedLiars.add(name));

            // Check win condition: max rounds reached
            if (this.gameState.round >= this.gameState.maxRounds) {
                // Game ends - request role reveal from all players
                console.log('[FindTheLiar] Investigation: Max rounds reached, ending game');
                this.requestRoleReveal('INVESTIGATION');
                return;
            }

            // Send secret to caught players (we assume they're liars for now)
            caughtPlayers.forEach(playerName => {
                this.sendData({
                    type: 'liar-secret-revealed',
                    secretItem: this.gameState.currentItem,
                    message: 'You were caught! The secret item is now revealed to you.'
                }, playerName);
            });
        }

        // Send results (without liar identification - we don't know!)
        this.sendData({
            type: 'vote-results',
            gameMode: this.gameState.gameMode,
            voteThreshold,
            secretItem: this.gameState.currentItem,
            voteResults,
            eliminatedPlayers: Array.from(this.gameState.eliminatedPlayers),
            revealedLiars: Array.from(this.gameState.revealedLiars),
            round: this.gameState.round
        });

        this.showRevealScreen({
            gameMode: this.gameState.gameMode,
            voteThreshold,
            secretItem: this.gameState.currentItem,
            voteResults,
            eliminatedPlayers: Array.from(this.gameState.eliminatedPlayers),
            revealedLiars: Array.from(this.gameState.revealedLiars)
        });

        // Show generic celebration if someone was caught/eliminated
        const someoneEliminated = this.gameState.eliminatedPlayers.size > 0 || this.gameState.revealedLiars.size > 0;
        if (!someoneEliminated) {
            // No one caught - liars escaped!
            setTimeout(() => {
                this.broadcastLiarCelebration([]); // No names - we don't know who they are!
            }, 2000);
        }
    }

    sendGameStateToPlayer(playerName) {
        if (!this.isHost()) return;

        this.sendData({
            type: 'game-state-sync',
            phase: this.gameState.phase,
            round: this.gameState.round,
            maxRounds: this.gameState.maxRounds || MAX_ROUNDS,
            phaseEndTime: this.gameState.phaseEndTime,
            questionIndex: this.gameState.currentQuestionIndex,
            totalQuestions: this.gameState.questions?.length || 0
        }, playerName);
    }

    /**
     * Request all players to reveal their roles (at game end)
     */
    requestRoleReveal(mode) {
        if (!this.isHost()) return;

        console.log('[FindTheLiar] Requesting role reveal from all players...');

        // Reset role collection
        this.gameState.playerRoles.clear();
        this.roleRevealMode = mode;
        this.roleRevealTimeout = null;

        // Add host's role
        const hostName = this.username;
        const hostRole = this.myPersistentRole || this.myRole;
        this.gameState.playerRoles.set(hostName, hostRole);
        console.log(`[FindTheLiar] Host role: ${hostRole}`);

        // Request from all other players
        this.sendData({
            type: 'request-role-reveal',
            message: 'Game over! Please reveal your role.'
        });

        // Set timeout to process roles after 3 seconds
        this.roleRevealTimeout = setTimeout(() => {
            this.processRoleReveals();
        }, 3000);
    }

    /**
     * Process collected roles and determine winner
     */
    processRoleReveals() {
        if (!this.isHost()) return;

        console.log('[FindTheLiar] Processing role reveals...');
        console.log('[FindTheLiar] Collected roles:', Array.from(this.gameState.playerRoles.entries()));

        // Determine who the liars were
        const liarNames = [];
        const truthfulNames = [];

        this.gameState.playerRoles.forEach((role, name) => {
            if (role === 'LIAR' || role === 'REVEALED_LIAR') {
                liarNames.push(name);
            } else {
                truthfulNames.push(name);
            }
        });

        console.log('[FindTheLiar] Liars:', liarNames.join(', '));
        console.log('[FindTheLiar] Truthful:', truthfulNames.join(', '));

        // Determine winner based on mode
        let winner, message;

        if (this.roleRevealMode === GameMode.SURVIVAL) {
            // Survival: Did any liars survive?
            const survivingLiars = liarNames.filter(l => !this.gameState.eliminatedPlayers.has(l));
            winner = survivingLiars.length > 0 ? 'LIARS' : 'TRUTHFUL';
            message = survivingLiars.length > 0
                ? '🤥 Liars Win! They survived elimination!'
                : '🎉 Truthful Players Win! All liars eliminated!';
        } else {
            // Investigation: Were all liars caught?
            const caughtLiars = liarNames.filter(l => this.gameState.revealedLiars.has(l));
            winner = caughtLiars.length === liarNames.length ? 'TRUTHFUL' : 'LIARS';
            message = caughtLiars.length === liarNames.length
                ? '🎉 Truthful Players Win! All liars caught!'
                : '🤥 Liars Win! They escaped detection!';
        }

        const gameOverData = {
            type: 'game-over',
            mode: this.roleRevealMode,
            winner,
            liarNames,
            truthfulNames,
            eliminatedPlayers: Array.from(this.gameState.eliminatedPlayers),
            revealedLiars: Array.from(this.gameState.revealedLiars),
            message
        };

        this.sendData(gameOverData);
        this.showGameOverScreen(gameOverData);

        // Show celebration if liars won - WITH NAMES (game end only)
        if (winner === 'LIARS') {
            setTimeout(() => {
                this.broadcastLiarCelebration(liarNames);
            }, 2000);
        }
    }

    /**
     * Broadcast liar celebration when they escape!
     */
    broadcastLiarCelebration(liarNames) {
        if (!this.isHost()) return;

        const emojis = ['😂', '🤣', '😈', '🎉', '🎊', '🤪', '😜', '🥳'];
        const celebrationEmojis = [];
        for (let i = 0; i < CELEBRATION_EMOJI_COUNT; i++) {
            celebrationEmojis.push(emojis[Math.floor(Math.random() * emojis.length)]);
        }

        this.sendData({
            type: 'liar-celebration',
            liarNames,
            emojis: celebrationEmojis,
            message: liarNames.length > 1 ? 'HAHAHAHAHA!' : 'HAHAHA!'
        });

        // Show on host too
        this.showLiarCelebration(liarNames, celebrationEmojis, liarNames.length > 1 ? 'HAHAHAHAHA!' : 'HAHAHA!');
    }

    // =========================================================================
    // Message Handlers
    // =========================================================================

    handlePhaseChange(data) {
        this.gameState.phase = data.phase;
        this.gameState.phaseEndTime = data.phaseEndTime;
        this.gameState.round = data.round;
        this.gameState.currentQuestionIndex = data.questionIndex || 0;

        // Update maxRounds if provided by host
        if (data.maxRounds) {
            this.gameState.maxRounds = data.maxRounds;
        }

        // Handle DISCUSSION phase with all answers
        if (data.phase === GamePhase.DISCUSSION && data.allAnswers) {
            this.gameState.allAnswers = data.allAnswers;
            this.showDiscussionScreen(data.allAnswers);
        }

        this.onPhaseChange(data.phase);
        this.startPhaseTimer(data.phase);
    }

    handleRoleAssignment(data) {
        console.log('[FindTheLiar] Role assigned:', data.role);
        
        // Store role persistently (for Round 2+)
        if (data.role !== 'REMEMBER' && data.round === 1) {
            this.myPersistentRole = data.role;
            this.myStoredItemManager = this.itemManager || new ItemManager(); // Store item manager reference
            console.log('[FindTheLiar] Persistent role saved for future rounds');
        }

        // If REMEMBER, use stored role and generate itemInfo
        if (data.role === 'REMEMBER') {
            data.role = this.myPersistentRole;
            console.log('[FindTheLiar] Using persistent role from Round 1:', this.myPersistentRole);

            // Generate item info based on stored role and current item
            if (!this.myStoredItemManager) {
                this.myStoredItemManager = new ItemManager();
            }

            // The current item info should be in data, but we need to get proper info based on role
            const currentItem = data.currentItem || this.gameState.currentItem;
            if (currentItem) {
                if (this.myPersistentRole === 'LIAR') {
                    data.itemInfo = this.myStoredItemManager.getLiarInfo(currentItem);
                } else {
                    data.itemInfo = this.myStoredItemManager.getNonLiarInfo(currentItem);
                }
                console.log('[FindTheLiar] Generated itemInfo for stored role:', data.itemInfo);
            }
        }

        this.myRole = data.role;
        this.myItemInfo = data.itemInfo;
        this.showRoleScreen(data);
    }

    handleQuestionStart(data) {
        this.gameState.currentQuestionIndex = data.questionIndex;
        this.hasAnswered = false;
        this.myCurrentAnswer = null;
        this.showQuestionScreen(data.question, data.questionIndex);
    }

    handleAnswersReveal(data) {
        this.showAnswerRevealScreen(data.answers);
    }

    handleVoteResults(data) {
        this.showRevealScreen(data);

        // Auto-celebration: If I'm a liar and wasn't caught/eliminated, send celebration!
        if (this.myRole === 'LIAR' || this.myPersistentRole === 'LIAR') {
            const myName = this.username;
            const wasEliminated = data.eliminatedPlayers && data.eliminatedPlayers.includes(myName);
            const wasRevealed = data.revealedLiars && data.revealedLiars.includes(myName);

            if (!wasEliminated && !wasRevealed) {
                // I escaped! Send auto-celebration with my personal settings
                console.log('[FindTheLiar] 😈 Escaped detection! Sending auto-celebration...');

                setTimeout(() => {
                    this.sendData({
                        type: 'liar-disturbance',
                        disturbanceType: 'celebration',
                        emoji: this.myCelebrationEmoji || '😈',
                        text: this.myCelebrationText || 'HAHAHA!',
                        isAuto: true
                    });
                }, 2500); // Send after a short delay
            }
        }
    }

    handleLiarSecretRevealed(data) {
        console.log('[FindTheLiar] You were caught! Secret revealed:', data.secretItem.name);

        // Update local state - now you know the secret
        this.myItemInfo = {
            itemName: data.secretItem.name,
            imageUrl: data.secretItem.imageUrl
        };

        // Show toast notification
        this.showToast(`🔍 ${data.message}`, 'info', 5000);

        // Update role display if visible
        const roleInfo = document.querySelector('.role-info');
        if (roleInfo) {
            roleInfo.innerHTML = `
                <h3>🔍 Caught Liar (Secret Revealed)</h3>
                <div class="item-reveal">
                    <span class="item-emoji">${data.secretItem.imageUrl}</span>
                    <strong>${data.secretItem.name}</strong>
                </div>
                <p style="color: #f59e0b; margin-top: 10px; font-size: 14px;">
                    The secret has been revealed to you, but others don't know you were caught!
                </p>
            `;
        }
    }

    handleLiarCelebration(data) {
        console.log('[FindTheLiar] Liar celebration!', data.liarNames);
        this.showLiarCelebration(data.liarNames, data.emojis, data.message);
    }

    handleGameStateSync(data) {
        this.gameState.phase = data.phase;
        this.gameState.round = data.round;
        this.gameState.phaseEndTime = data.phaseEndTime;
        this.gameState.currentQuestionIndex = data.questionIndex;

        // Update maxRounds if provided by host
        if (data.maxRounds) {
            this.gameState.maxRounds = data.maxRounds;
        }

        this.onPhaseChange(data.phase);
    }

    broadcastSettingsUpdate() {
        if (!this.isHost()) return;

        this.sendData({
            type: 'settings-update',
            gameMode: this.gameState.gameMode,
            numLiars: this.gameState.numLiars,
            questionsPerRound: this.gameState.questionsPerRound,
            maxRounds: this.gameState.maxRounds,
            reviewAnswersBeforeVoting: this.gameState.reviewAnswersBeforeVoting,
            liarCelebrationEmoji: this.gameState.liarCelebrationEmoji,
            liarCelebrationText: this.gameState.liarCelebrationText
        });
    }

    handleSettingsUpdate(data) {
        // Non-hosts receive settings from host
        this.gameState.gameMode = data.gameMode;
        this.gameState.numLiars = data.numLiars;
        this.gameState.questionsPerRound = data.questionsPerRound;
        this.gameState.maxRounds = data.maxRounds;
        this.gameState.reviewAnswersBeforeVoting = data.reviewAnswersBeforeVoting;
        this.gameState.liarCelebrationEmoji = data.liarCelebrationEmoji || '😈';
        this.gameState.liarCelebrationText = data.liarCelebrationText || 'HAHAHA!';

        // Refresh waiting room to show updated settings
        if (this.gameState.phase === GamePhase.WAITING) {
            this.showWaitingRoom();
        }
    }

    handleSubmitAnswer(peerId, data) {
        if (!this.isHost()) return;

        console.log('[FindTheLiar] Answer from', peerId);
        this.gameState.currentAnswers.set(peerId, data.answer);
        this.checkAllAnswersSubmitted();
    }

    handleSubmitVote(peerId, data) {
        if (!this.isHost()) return;

        console.log('[FindTheLiar] Vote from', peerId, 'for:', data.votedFor);
        this.gameState.votes.set(peerId, data.votedFor);
        this.checkAllVotesSubmitted();
    }

    handleNewRoundRequest(peerId) {
        if (!this.isHost()) return;

        if (this.gameState.phase === GamePhase.WAITING || this.gameState.phase === GamePhase.ROUND_END) {
            this.startRound();
        }
    }

    handleGameOver(data) {
        if (!this.isHost()) return;

        console.log('[FindTheLiar] Game over:', data);

        // Show game over screen to all players
        this.showGameOverScreen(data);
    }

    handleGameReset(data) {
        console.log('[FindTheLiar] Game reset by host');

        // Reset all game state for all players
        this.gameState.phase = GamePhase.WAITING;
        this.gameState.round = 0;
        this.gameState.currentItem = null;
        this.gameState.eliminatedPlayers.clear();
        this.gameState.revealedLiars.clear();
        this.gameState.playerRoles.clear();
        this.gameState.questions = [];
        this.gameState.currentQuestionIndex = 0;
        this.gameState.currentAnswers.clear();
        this.gameState.allAnswers = [];
        this.gameState.votes.clear();
        this.gameState.phaseEndTime = null;

        this.resetLocalState();

        // Stop timer
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        this.showToast('Game reset by host', 'info');
        this.showWaitingRoom();
        this.updateRoundDisplay();
    }

    handleGamePaused(data) {
        console.log('[FindTheLiar] Game pause state changed:', data.paused);

        if (data.paused) {
            // Pause the game
            this.isPaused = true;

            // Save remaining time
            if (data.pausedTimeRemaining !== undefined) {
                this.pausedTimeRemaining = data.pausedTimeRemaining;
            } else if (this.gameState.phaseEndTime) {
                this.pausedTimeRemaining = Math.max(0, this.gameState.phaseEndTime - Date.now());
            }

            this.showPauseOverlay();
            this.showToast('⏸️ Game Paused by Host', 'info');
        } else {
            // Resume the game
            this.isPaused = false;

            // Restore phase end time
            if (data.phaseEndTime) {
                this.gameState.phaseEndTime = data.phaseEndTime;
            } else if (this.pausedTimeRemaining) {
                this.gameState.phaseEndTime = Date.now() + this.pausedTimeRemaining;
            }

            this.hidePauseOverlay();
            this.showToast('▶️ Game Resumed', 'success');
        }
    }

    handleRoleRevealRequest(data) {
        console.log('[FindTheLiar] Role reveal requested by host');

        // Send our role back to host
        const myRole = this.myPersistentRole || this.myRole;
        console.log('[FindTheLiar] Revealing role:', myRole);

        this.sendData({
            type: 'role-reveal-response',
            role: myRole
        });
    }

    handleRoleRevealResponse(peerId, data) {
        if (!this.isHost()) return;

        console.log(`[FindTheLiar] Role reveal from ${peerId}:`, data.role);

        // Store the role
        this.gameState.playerRoles.set(peerId, data.role);

        // Check if we have all roles
        const expectedCount = this.getPlayerCount();
        if (this.gameState.playerRoles.size >= expectedCount) {
            console.log('[FindTheLiar] All roles collected!');

            // Clear timeout and process immediately
            if (this.roleRevealTimeout) {
                clearTimeout(this.roleRevealTimeout);
                this.roleRevealTimeout = null;
            }

            this.processRoleReveals();
        }
    }

    handleLiarDisturbance(peerId, data) {
        if (!this.isHost()) return;

        console.log(`[FindTheLiar] Liar disturbance from ${peerId}: ${data.disturbanceType}`);
        console.log(`[FindTheLiar] Disturbance data:`, data);

        // Broadcast disturbance to all players
        const broadcastData = {
            type: 'liar-disturbance-broadcast',
            liarName: peerId,
            disturbanceType: data.disturbanceType || 'celebration',
            emoji: data.emoji || '😈',
            text: data.text || 'Hehe!',
            isMini: true
        };

        console.log(`[FindTheLiar] Broadcasting disturbance to all:`, broadcastData);
        this.sendData(broadcastData); // Broadcast to ALL players

        // Also show to the sender (host)
        this.applyDisturbanceEffect(data.disturbanceType || 'celebration', data.emoji, data.text);
    }

    handleLiarDisturbanceBroadcast(data) {
        console.log('[FindTheLiar] Received liar disturbance broadcast:', data.disturbanceType);
        console.log('[FindTheLiar] Applying effect with emoji:', data.emoji, 'text:', data.text);
        this.applyDisturbanceEffect(data.disturbanceType, data.emoji, data.text);
    }

    /**
     * Apply disturbance effects based on type
     */
    applyDisturbanceEffect(type, emoji, text) {
        console.log('[FindTheLiar] Applying disturbance effect:', type);
        switch(type) {
            case 'celebration':
                this.showMiniCelebration(emoji, text);
                break;
            case 'timer':
                this.showFakeTimerSpeedup();
                break;
            case 'shake':
                this.shakeScreen();
                break;
            case 'emoji-rain':
                this.showEmojiRain(emoji);
                break;
            case 'blur':
                this.blurQuestion();
                break;
            case 'fake-submit':
                this.showFakeSubmission();
                break;
            case 'fake-typing':
                this.showFakeTyping();
                break;
            case 'fake-alert':
                this.showFakeAlert();
                break;
            default:
                this.showMiniCelebration(emoji, text);
        }
    }

    // =========================================================================
    // Player Actions
    // =========================================================================

    submitAnswer(answer) {
        if (this.hasAnswered) {
            this.showToast('Already submitted!', 'warning');
            return;
        }

        if (!answer || answer.trim().length === 0) {
            this.showToast('Please enter an answer', 'error');
            return;
        }

        const trimmed = answer.trim().substring(0, MAX_ANSWER_LENGTH);
        this.myCurrentAnswer = trimmed;
        this.hasAnswered = true;

        if (this.isHost()) {
            this.gameState.currentAnswers.set(this.username, trimmed);
            this.checkAllAnswersSubmitted();
        } else {
            this.sendData({
                type: 'submit-answer',
                answer: trimmed
            });
        }

        this.showToast('✓ Answer submitted!', 'success');
        this.showAnswerSubmitted();
    }

    submitVote(votedForName) {
        if (this.hasVoted) {
            this.showToast('Already voted!', 'warning');
            return;
        }

        if (votedForName === this.username) {
            this.showToast("Can't vote for yourself!", 'error');
            return;
        }

        this.hasVoted = true;

        if (this.isHost()) {
            this.gameState.votes.set(this.username, votedForName);
            this.checkAllVotesSubmitted();
        } else {
            this.sendData({
                type: 'submit-vote',
                votedFor: votedForName
            });
        }

        this.showToast(`✓ Voted for ${votedForName}`, 'success');
        this.highlightVotedPlayer(votedForName);
    }

    requestNewRound() {
        if (this.isHost()) {
            this.startRound();
        } else {
            this.sendData({ type: 'request-new-round' });
            this.showToast('Requesting new round...', 'info');
        }
    }

    // =========================================================================
    // Checks
    // =========================================================================

    checkAllAnswersSubmitted() {
        if (!this.isHost()) return;

        const playerCount = this.getPlayerCount();
        const answerCount = this.gameState.currentAnswers.size;

        if (answerCount >= playerCount) {
            // All answers in - reveal them
            this.stopTimer();
            this.revealCurrentAnswers();
            
            // After a brief delay, advance
            setTimeout(() => {
                if (this.isHost()) {
                    this.advanceToNextQuestion();
                }
            }, ANSWER_REVEAL_DELAY);
        }
    }

    checkAllVotesSubmitted() {
        if (!this.isHost()) return;

        const playerCount = this.getPlayerCount();
        const voteCount = this.gameState.votes.size;

        if (voteCount >= playerCount) {
            this.transitionToPhase(GamePhase.REVEAL);
        }
    }

    resetLocalState() {
        this.myRole = null;
        this.myItemInfo = null;
        this.myCurrentAnswer = null;
        this.hasAnswered = false;
        this.hasVoted = false;
    }

    // =========================================================================
    // Utility Methods
    // =========================================================================

    /**
     * Safely get DOM element by ID
     * @param {string} id - Element ID
     * @returns {HTMLElement|null}
     */
    getElement(id) {
        return document.getElementById(id);
    }

    /**
     * Update element text content safely
     * @param {string} id - Element ID
     * @param {string} text - Text content
     */
    updateElementText(id, text) {
        const el = this.getElement(id);
        if (el) el.textContent = text;
    }

    /**
     * Update element HTML safely
     * @param {string} id - Element ID
     * @param {string} html - HTML content
     */
    updateElementHTML(id, html) {
        const el = this.getElement(id);
        if (el) el.innerHTML = html;
    }

    /**
     * Toggle element visibility
     * @param {string} id - Element ID
     * @param {boolean} visible - Show or hide
     */
    toggleElement(id, visible) {
        const el = this.getElement(id);
        if (el) el.style.display = visible ? 'block' : 'none';
    }

    /**
     * Check if this player is the host (override to add alias)
     * @returns {boolean}
     */
    isHostPlayer() {
        return this.isHost();
    }

    /**
     * Get active player count (non-eliminated)
     * @returns {number}
     */
    getActivePlayerCount() {
        if (this.gameState.gameMode === GameMode.SURVIVAL) {
            return this.getPlayerList().filter(p => 
                !this.gameState.eliminatedPlayers.has(p.name)
            ).length;
        }
        return this.getPlayerCount();
    }

    /**
     * Check if minimum players requirement is met
     * @returns {boolean}
     */
    hasMinimumPlayers() {
        return this.hasEnoughPlayers(MIN_PLAYERS);
    }

    /**
     * Check if player is eliminated
     * @param {string} playerName - Player name
     * @returns {boolean}
     */
    isPlayerEliminated(playerName) {
        return this.gameState.eliminatedPlayers.has(playerName);
    }

    /**
     * Check if player is a revealed liar
     * @param {string} playerName - Player name
     * @returns {boolean}
     */
    isPlayerRevealedLiar(playerName) {
        return this.gameState.revealedLiars.has(playerName);
    }

    /**
     * Format time remaining display
     * @param {number} seconds - Seconds remaining
     * @returns {string}
     */
    formatTimeRemaining(seconds) {
        return `⏱️ ${seconds}s`;
    }

    /**
     * Generate player initial avatar
     * @param {string} name - Player name
     * @returns {string}
     */
    getPlayerInitial(name) {
        return name.charAt(0).toUpperCase();
    }

    // =========================================================================
    // Timer
    // =========================================================================

    startPhaseTimer(phase) {
        this.stopTimer();

        if (!PHASE_DURATIONS[phase]) {
            this.updateTimerDisplay('');
            return;
        }

        this.timerInterval = setInterval(() => {
            // Check if game is paused - don't progress timer
            if (this.isPaused) {
                return;
            }

            const remaining = Math.max(0, this.gameState.phaseEndTime - Date.now());
            const seconds = Math.ceil(remaining / 1000);

            this.updateTimerDisplay(this.formatTimeRemaining(seconds));
            this.updateTimerBar(remaining / PHASE_DURATIONS[phase]);

            if (remaining <= 0) {
                this.stopTimer();
                this.onPhaseTimeout(phase);
            }
        }, 100);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    onPhaseTimeout(phase) {
        if (!this.isHostPlayer()) return;

        switch (phase) {
            case GamePhase.ROLE_ASSIGNMENT:
                this.transitionToPhase(GamePhase.QUESTIONING);
                break;
            case GamePhase.QUESTIONING:
                this.fillEmptyAnswers();
                this.revealCurrentAnswers();
                setTimeout(() => {
                    if (this.isHostPlayer()) this.advanceToNextQuestion();
                }, 4000);
                break;
            case GamePhase.DISCUSSION:
                this.transitionToPhase(GamePhase.VOTING);
                break;
            case GamePhase.VOTING:
                this.transitionToPhase(GamePhase.REVEAL);
                break;
            case GamePhase.REVEAL:
                this.transitionToPhase(GamePhase.ROUND_END);
                break;
        }
    }

    fillEmptyAnswers() {
        const players = this.getPlayerList().map(p => p.name);
        players.forEach(name => {
            if (!this.gameState.currentAnswers.has(name)) {
                this.gameState.currentAnswers.set(name, '(No answer)');
            }
        });
    }

    // =========================================================================
    // UI Rendering
    // =========================================================================

    onPhaseChange(phase) {
        this.updatePhaseDisplay();
        
        switch (phase) {
            case GamePhase.WAITING:
                this.showWaitingRoom();
                break;
            case GamePhase.VOTING:
                this.showVotingScreen();
                break;
            case GamePhase.ROUND_END:
                this.showRoundEndScreen();
                break;
        }
    }

    updatePhaseDisplay() {
        this.updateElementText('currentPhase', this.gameState.phase);
        this.updateRoundDisplay();
    }

    updateRoundDisplay() {
        const maxRounds = this.gameState.maxRounds || MAX_ROUNDS;
        const currentRound = this.gameState.round || 0;
        this.updateElementText('roundDisplay', `Round ${currentRound}/${maxRounds}`);
    }

    updateTimerDisplay(text) {
        this.updateElementText('timerDisplay', text);
    }

    updateTimerBar(percentage) {
        const bar = document.querySelector('.timer-fill');
        if (bar) bar.style.width = `${percentage * 100}%`;
    }

    updatePlayersList() {
        const listEl = document.getElementById('playersList');

        if (!listEl) return;

        const players = this.getPlayerList();

        let html = players.map(player => {
            let cls = 'player-item';
            if (player.isHost) cls += ' host';
            if (player.isSelf) cls += ' self';
            
            // Show ⏳ icon if player is joining (connecting)
            const isJoining = this.joiningPlayers.has(player.name);
            const joiningIcon = isJoining ? ' ⏳' : '';

            return `
                <div class="${cls}" data-name="${player.name}">
                    ${player.isHost ? '👑' : '👤'} ${player.name}${player.isSelf ? ' (You)' : ''}${joiningIcon}
                </div>
            `;
        }).join('');

        listEl.innerHTML = html || '<p style="color:#999;text-align:center;">No players</p>';
    }

    updateStartButton() {
        const btn = document.getElementById('startRoundBtn');
        if (!btn) return;

        const isHost = this.isHost();
        const count = this.getPlayerCount();


        btn.style.display = isHost ? 'inline-block' : 'none';

        if (isHost) {
            if (count < MIN_PLAYERS) {
                btn.textContent = `🚀 Need ${MIN_PLAYERS - count} more`;
                btn.disabled = true;
            } else {
                btn.textContent = '🚀 Start Round';
                btn.disabled = false;
            }
        }
    }

    showWaitingRoom() {
        const container = document.getElementById('gameContainer');
        const isHost = this.isHost();
        this.wasHost = isHost;
        const gameStarted = this.gameState.round > 0;

        container.innerHTML = `
            <div class="waiting-screen">
                <span class="phase-indicator phase-waiting">Waiting for Players</span>
                <h2>${isHost ? '👑 You are the Host!' : '⏳ Waiting for Host'}</h2>
                <p style="margin:10px 0;">
                    Round ${this.gameState.round}/${this.gameState.maxRounds || MAX_ROUNDS} | 
                    ${this.itemManager.getItemCount()} items | 
                    ${this.itemManager.getQuestionCount()} questions available
                </p>
                
                ${isHost ? `
                    <div class="game-settings" style="margin: 20px 0; padding: 20px; background: ${gameStarted ? '#f9f9f9' : '#f5f5f5'}; border-radius: 10px; ${gameStarted ? 'opacity: 0.8;' : ''}">
                        <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #9c27b0;">⚙️ Game Settings ${gameStarted ? '(Read-only)' : ''}</h3>
                        
                        <label style="display: block; margin-bottom: 15px;">
                            <strong>Game Mode:</strong>
                            <select id="gameMode" ${gameStarted ? 'disabled' : ''}
                                    style="padding: 8px 12px; border-radius: 5px; margin-left: 10px; border: 2px solid #ddd; font-size: 14px; width: 200px;">
                                <option value="${GameMode.SURVIVAL}" ${this.gameState.gameMode === GameMode.SURVIVAL ? 'selected' : ''}>🏆 Survival Mode</option>
                                <option value="${GameMode.INVESTIGATION}" ${this.gameState.gameMode === GameMode.INVESTIGATION ? 'selected' : ''}>🔍 Investigation Mode</option>
                            </select>
                        </label>
                        <p style="font-size: 11px; color: #666; margin: -10px 0 15px 0; padding-left: 10px;">
                            ${this.gameState.gameMode === GameMode.SURVIVAL 
                                ? '📋 Elimination mode: Players can be eliminated. Game ends at 3 players.' 
                                : '📋 Time attack: Catch liars before max rounds or they win!'}
                        </p>
                        
                        <label style="display: block; margin-bottom: 15px;">
                            <strong>Number of Liars:</strong>
                            <select id="numLiars" ${gameStarted ? 'disabled' : ''}
                                    style="padding: 8px 12px; border-radius: 5px; margin-left: 10px; border: 2px solid #ddd; font-size: 14px;">
                                <option value="1" ${this.gameState.numLiars === 1 ? 'selected' : ''}>1 Liar</option>
                                <option value="2" ${this.gameState.numLiars === 2 ? 'selected' : ''} ${this.getPlayerCount() < 7 ? 'disabled' : ''}>2 Liars (7+ players)</option>
                            </select>
                        </label>
                        
                        <label style="display: block; margin-bottom: 15px;">
                            <strong>Questions per round:</strong>
                            <select id="questionsPerRound" ${gameStarted ? 'disabled' : ''}
                                    style="padding: 8px 12px; border-radius: 5px; margin-left: 10px; border: 2px solid #ddd; font-size: 14px;">
                                ${[3,4,5,6,7,8,9,10].map(n => 
                                    `<option value="${n}" ${n === this.gameState.questionsPerRound ? 'selected' : ''}>${n} questions</option>`
                                ).join('')}
                            </select>
                        </label>
                        
                        <label style="display: block; margin-bottom: 15px;">
                            <strong>Maximum rounds:</strong>
                            <select id="maxRounds" ${gameStarted ? 'disabled' : ''}
                                    style="padding: 8px 12px; border-radius: 5px; margin-left: 10px; border: 2px solid #ddd; font-size: 14px;">
                                ${[3,5,7,10,15].map(n => 
                                    `<option value="${n}" ${n === (this.gameState.maxRounds || MAX_ROUNDS) ? 'selected' : ''}>${n} rounds</option>`
                                ).join('')}
                            </select>
                        </label>
                        
                        <label style="display: flex; align-items: center; margin-bottom: 10px; cursor: ${gameStarted ? 'not-allowed' : 'pointer'};">
                            <input type="checkbox" id="reviewAnswersBeforeVoting" ${gameStarted ? 'disabled' : ''}
                                   ${this.gameState.reviewAnswersBeforeVoting ? 'checked' : ''}
                                   style="width: 18px; height: 18px; margin-right: 10px; cursor: ${gameStarted ? 'not-allowed' : 'pointer'};">
                            <strong>📝 Review All Answers Before Voting</strong>
                        </label>
                    </div>
                ` : `
                    <div class="game-settings" style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 10px;">
                        <p style="margin: 0; color: #666;">
                            <strong>Game Settings:</strong><br>
                            Mode: ${this.gameState.gameMode === GameMode.SURVIVAL ? '🏆 Survival' : '🔍 Investigation'}<br>
                            ${this.gameState.numLiars} Liar(s)<br>
                            ${this.gameState.questionsPerRound || QUESTIONS_PER_ROUND} questions per round<br>
                            ${this.gameState.maxRounds || MAX_ROUNDS} rounds maximum<br>
                            ${this.gameState.reviewAnswersBeforeVoting ? '📝 Review answers enabled' : ''}
                        </p>
                    </div>
                `}
                
                ${isHost ? `
                    <div style="display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap;">
                        <button id="startRoundBtn" class="btn btn-primary" onclick="liarGame.startRound()">
                            🚀 Start Round
                        </button>
                        ${gameStarted ? `
                            <button class="btn" style="background: #ff9800; color: white;" onclick="liarGame.confirmReset()">
                                🔄 Reset Game
                            </button>
                        ` : ''}
                    </div>
                ` : `
                    <div class="waiting-indicator">Waiting for host to start...</div>
                `}
            </div>
        `;

        // Bind settings change for host (only if game hasn't started)
        if (isHost && !gameStarted) {
            const gameModeSelect = document.getElementById('gameMode');
            const numLiarsSelect = document.getElementById('numLiars');
            const questionsSelect = document.getElementById('questionsPerRound');
            const roundsSelect = document.getElementById('maxRounds');
            const reviewCheckbox = document.getElementById('reviewAnswersBeforeVoting');

            if (gameModeSelect) {
                gameModeSelect.addEventListener('change', (e) => {
                    this.gameState.gameMode = e.target.value;
                    console.log('[FindTheLiar] Game mode:', this.gameState.gameMode);
                    // Broadcast settings change to all players
                    this.broadcastSettingsUpdate();
                    // Update UI description
                    const desc = document.querySelector('.game-settings p');
                    if (desc) {
                        desc.textContent = this.gameState.gameMode === GameMode.SURVIVAL
                            ? '📋 Elimination mode: Players can be eliminated. Game ends at 3 players.'
                            : '📋 Time attack: Catch liars before max rounds or they win!';
                    }
                });
            }

            if (numLiarsSelect) {
                numLiarsSelect.addEventListener('change', (e) => {
                    this.gameState.numLiars = parseInt(e.target.value);
                    console.log('[FindTheLiar] Number of liars:', this.gameState.numLiars);
                    this.broadcastSettingsUpdate();
                });
            }

            if (questionsSelect) {
                questionsSelect.addEventListener('change', (e) => {
                    this.gameState.questionsPerRound = parseInt(e.target.value);
                    console.log('[FindTheLiar] Questions per round:', this.gameState.questionsPerRound);
                    this.broadcastSettingsUpdate();
                });
            }

            if (roundsSelect) {
                roundsSelect.addEventListener('change', (e) => {
                    this.gameState.maxRounds = parseInt(e.target.value);
                    console.log('[FindTheLiar] Max rounds:', this.gameState.maxRounds);
                    this.broadcastSettingsUpdate();
                });
            }

            if (reviewCheckbox) {
                reviewCheckbox.addEventListener('change', (e) => {
                    this.gameState.reviewAnswersBeforeVoting = e.target.checked;
                    console.log('[FindTheLiar] Review answers before voting:', this.gameState.reviewAnswersBeforeVoting);
                    this.broadcastSettingsUpdate();
                });
            }
        }

        this.updateStartButton();
        this.updatePlayersList();
        document.getElementById('scoreModal')?.classList.add('hidden');
    }

    showRoleScreen(data) {
        const container = document.getElementById('gameContainer');
        const isLiar = data.role === 'LIAR';
        const isRevealedLiar = data.role === 'REVEALED_LIAR';
        const info = data.itemInfo;

        let infoHtml;
        if (isLiar && !isRevealedLiar) {
            // Liar sees category + hints
            const hints = info.hints || [];
            infoHtml = `
                <div class="item-info liar-info">
                    <h4>📂 Category: ${info.category || 'Unknown'}</h4>
                    <div class="hints-list">
                        <p><strong>Your hints:</strong></p>
                        <ul>
                            ${hints.length > 0 ? hints.map(h => `<li>💡 ${h}</li>`).join('') : '<li>No hints available</li>'}
                        </ul>
                    </div>
                    <p class="hint-warning">⚠️ You must figure out the item from these clues!</p>
                </div>
            `;
        } else if (isRevealedLiar) {
            // Revealed liar sees the actual item (caught in Investigation mode)
            infoHtml = `
                <div class="item-info innocent-info">
                    <div class="secret-item">
                        <span class="item-emoji">${info.imageUrl}</span>
                        <h3>${info.name}</h3>
                        <p class="item-category">${info.category}</p>
                    </div>
                    <p class="item-instruction" style="color: #f59e0b;">
                        🔍 You were caught! The secret is now revealed to you.
                    </p>
                    <p style="color: #999; font-size: 13px; margin-top: 10px;">
                        Others don't know you were caught. Play along!
                    </p>
                </div>
            `;
        } else {
            // Non-liar sees the actual item
            infoHtml = `
                <div class="item-info innocent-info">
                    <div class="secret-item">
                        <span class="item-emoji">${info.imageUrl}</span>
                        <h3>${info.name}</h3>
                        <p class="item-category">${info.category}</p>
                    </div>
                    <p class="item-instruction">✓ Answer questions about this item truthfully!</p>
                </div>
            `;
        }

        const roleTitle = isRevealedLiar ? 'REVEALED LIAR' : (isLiar ? 'THE LIAR!' : 'INNOCENT');
        const roleDescription = isRevealedLiar
            ? 'You were caught! The secret is now revealed to you, but others don\'t know.'
            : (isLiar
                ? 'You don\'t know the secret item! Use the hints to blend in.'
                : 'You know the secret item. Find who doesn\'t!');

        const roleEmoji = isRevealedLiar ? '🔍' : (isLiar ? '🤥' : '😇');
        const roleClass = (isLiar || isRevealedLiar) ? 'liar' : 'innocent';

        container.innerHTML = `
            <div class="role-screen">
                <span class="phase-indicator phase-roles">Role Assignment - Round ${data.round}</span>
                <div class="role-card ${roleClass}">
                    <span class="role-emoji">${roleEmoji}</span>
                    <h3>You are ${roleTitle}</h3>
                    <p>${roleDescription}</p>
                </div>
                ${infoHtml}
                ${isLiar && !isRevealedLiar ? `
                    <div style="background: rgba(156, 39, 176, 0.1); padding: 15px; border-radius: 10px; margin: 20px 0; border: 2px dashed #9c27b0;">
                        <h4 style="margin: 0 0 10px 0; color: #9c27b0;">😈 Customize Your Celebration</h4>
                        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                            <label style="display: flex; align-items: center; gap: 5px;">
                                <strong>Emoji:</strong>
                                <select id="myCelebrationEmoji" style="padding: 8px; border-radius: 5px; font-size: 20px; border: 2px solid #9c27b0;">
                                    <option value="😈" ${!this.myCelebrationEmoji || this.myCelebrationEmoji === '😈' ? 'selected' : ''}>😈</option>
                                    <option value="👹" ${this.myCelebrationEmoji === '👹' ? 'selected' : ''}>👹</option>
                                    <option value="🤡" ${this.myCelebrationEmoji === '🤡' ? 'selected' : ''}>🤡</option>
                                    <option value="😏" ${this.myCelebrationEmoji === '😏' ? 'selected' : ''}>😏</option>
                                    <option value="🤪" ${this.myCelebrationEmoji === '🤪' ? 'selected' : ''}>🤪</option>
                                    <option value="😜" ${this.myCelebrationEmoji === '😜' ? 'selected' : ''}>😜</option>
                                    <option value="🥳" ${this.myCelebrationEmoji === '🥳' ? 'selected' : ''}>🥳</option>
                                    <option value="💀" ${this.myCelebrationEmoji === '💀' ? 'selected' : ''}>💀</option>
                                    <option value="🎭" ${this.myCelebrationEmoji === '🎭' ? 'selected' : ''}>🎭</option>
                                    <option value="🔥" ${this.myCelebrationEmoji === '🔥' ? 'selected' : ''}>🔥</option>
                                </select>
                            </label>
                            <label style="display: flex; align-items: center; gap: 5px; flex: 1; min-width: 200px;">
                                <strong>Text:</strong>
                                <input type="text" id="myCelebrationText" maxlength="20" 
                                       value="${this.myCelebrationText || 'HAHAHA!'}"
                                       placeholder="HAHAHA!"
                                       style="padding: 8px; border-radius: 5px; border: 2px solid #9c27b0; flex: 1;">
                            </label>
                        </div>
                        <p style="font-size: 11px; color: #666; margin: 8px 0 0 0;">This will be used when you escape or use disturbances!</p>
                    </div>
                ` : ''}
                <div class="timer-bar">
                    <div class="timer-fill" style="width: 100%;"></div>
                </div>
                <p style="color:#666;font-size:14px;">${data.totalQuestions} questions this round</p>
            </div>
        `;

        // Setup celebration customization listeners for liars
        if (isLiar && !isRevealedLiar) {
            const emojiSelect = document.getElementById('myCelebrationEmoji');
            const textInput = document.getElementById('myCelebrationText');

            if (emojiSelect) {
                emojiSelect.addEventListener('change', (e) => {
                    this.myCelebrationEmoji = e.target.value;
                    console.log('[FindTheLiar] My celebration emoji:', this.myCelebrationEmoji);
                });
            }

            if (textInput) {
                textInput.addEventListener('input', (e) => {
                    this.myCelebrationText = e.target.value || 'HAHAHA!';
                    console.log('[FindTheLiar] My celebration text:', this.myCelebrationText);
                });
            }
        }
    }

    showQuestionScreen(question, index) {
        const container = document.getElementById('gameContainer');
        const total = this.gameState.questions?.length || this.gameState.questionsPerRound;

        // NOTE: Item/hints are ONLY shown during role assignment phase
        // Players must remember the information during questions!

        // Determine question type label and UI
        const isMcq = question.type === 'MULTIPLE_CHOICE';
        const questionTypeLabel = isMcq ? 'Multiple Choice' : 'Open Question';
        const questionTypeColor = isMcq ? '#4f46e5' : '#10b981';

        // Build answer input UI based on question type
        let answerInputHtml = '';
        if (isMcq && question.options) {
            // MCQ: Radio buttons
            answerInputHtml = `
                <div class="mcq-options">
                    ${question.options.map((opt, optIdx) => `
                        <label class="mcq-option" for="mcq-${index}-${optIdx}">
                            <input type="radio" id="mcq-${index}-${optIdx}" name="mcqAnswer" value="${opt.id}" />
                            <span class="mcq-option-text">${opt.text}</span>
                        </label>
                    `).join('')}
                </div>
                <p style="font-size: 12px; color: #888; margin: 8px 0 12px 0; text-align: center;">
                    💡 Tip: Click again to deselect • Submit without selecting = "None of these"
                </p>
                <button id="submitAnswerBtn" class="btn btn-success" onclick="liarGame.submitMyAnswer()">
                    ✓ Submit Answer
                </button>
            `;
        } else {
            // FREE_TEXT: Textarea
            answerInputHtml = `
                <textarea 
                    id="answerInput" 
                    class="answer-input" 
                    placeholder="Type your answer..."
                    maxlength="${MAX_ANSWER_LENGTH}"
                    rows="2"
                ></textarea>
                <div class="char-count">
                    <span id="charCount">0</span>/${MAX_ANSWER_LENGTH}
                </div>
                <button id="submitAnswerBtn" class="btn btn-success" onclick="liarGame.submitMyAnswer()">
                    ✓ Submit
                </button>
            `;
        }

        container.innerHTML = `
            <div class="question-screen">
                <span class="phase-indicator phase-answering">Question ${index + 1}/${total}</span>
                <div style="text-align: center; margin-bottom: 12px;">
                    <span style="display: inline-block; padding: 4px 12px; background: ${questionTypeColor}20; border: 1px solid ${questionTypeColor}; border-radius: 12px; font-size: 11px; font-weight: 700; color: ${questionTypeColor}; text-transform: uppercase; letter-spacing: 0.5px;">
                        ${questionTypeLabel}
                    </span>
                </div>
                <div class="question-card">
                    <span class="question-icon">${question.icon}</span>
                    <p class="question-text">${question.text}</p>
                </div>
                <div class="timer-bar">
                    <div class="timer-fill" style="width: 100%;"></div>
                </div>
                <div class="answer-form">
                    ${answerInputHtml}
                </div>
                ${this.myRole === 'LIAR' ? `
                    <div style="text-align: center; margin-top: 20px; padding-top: 15px; border-top: 2px dashed #9c27b0;">
                        <div style="margin-bottom: 10px;">
                            <button class="btn" style="background: linear-gradient(135deg, #9c27b0, #e91e63); color: white; font-size: 14px; padding: 10px 20px; margin: 5px;" 
                                    onclick="liarGame.sendDisturbance('celebration')"
                                    title="Send a mini celebration!">
                                ${this.myCelebrationEmoji || '😈'} Celebrate!
                            </button>
                            <button class="btn" style="background: linear-gradient(135deg, #f44336, #ff9800); color: white; font-size: 14px; padding: 10px 20px; margin: 5px;" 
                                    onclick="liarGame.sendDisturbance('timer')"
                                    title="Make the timer look faster!">
                                ⏱️ Fake Rush!
                            </button>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <button class="btn" style="background: linear-gradient(135deg, #673ab7, #3f51b5); color: white; font-size: 14px; padding: 10px 20px; margin: 5px;" 
                                    onclick="liarGame.sendDisturbance('shake')"
                                    title="Shake everyone's screen!">
                                📳 Shake!
                            </button>
                            <button class="btn" style="background: linear-gradient(135deg, #009688, #4caf50); color: white; font-size: 14px; padding: 10px 20px; margin: 5px;" 
                                    onclick="liarGame.sendDisturbance('emoji-rain')"
                                    title="Drop emojis everywhere!">
                                🌧️ Emoji Rain!
                            </button>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <button class="btn" style="background: linear-gradient(135deg, #607d8b, #9e9e9e); color: white; font-size: 14px; padding: 10px 20px; margin: 5px;" 
                                    onclick="liarGame.sendDisturbance('blur')"
                                    title="Briefly blur the question!">
                                😵 Confuse!
                            </button>
                            <button class="btn" style="background: linear-gradient(135deg, #ff5722, #ffc107); color: white; font-size: 14px; padding: 10px 20px; margin: 5px;" 
                                    onclick="liarGame.sendDisturbance('fake-submit')"
                                    title="Fake submission notifications!">
                                ✅ Fake Submit!
                            </button>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <button class="btn" style="background: linear-gradient(135deg, #795548, #8d6e63); color: white; font-size: 14px; padding: 10px 20px; margin: 5px;" 
                                    onclick="liarGame.sendDisturbance('fake-typing')"
                                    title="Show fake 'typing...' indicators!">
                                💬 Fake Typing!
                            </button>
                            <button class="btn" style="background: linear-gradient(135deg, #f44336, #e91e63); color: white; font-size: 14px; padding: 10px 20px; margin: 5px;" 
                                    onclick="liarGame.sendDisturbance('fake-alert')"
                                    title="Show fake urgent alerts!">
                                🚨 Fake Alert!
                            </button>
                        </div>
                        <p style="font-size: 11px; color: #666; margin-top: 5px;">😈 Choose your chaos weapon!</p>
                    </div>
                ` : ''}
            </div>
        `;

        // Setup event listeners for FREE_TEXT
        if (!isMcq) {
            const input = document.getElementById('answerInput');
            const counter = document.getElementById('charCount');
            input?.addEventListener('input', () => {
                counter.textContent = input.value.length;
            });
            input?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.submitMyAnswer();
                }
            });
            input?.focus();
        } else {
            // Setup event listeners for MCQ to allow deselecting
            const radioButtons = document.querySelectorAll('input[name="mcqAnswer"]');
            radioButtons.forEach(radio => {
                radio.addEventListener('click', (e) => {
                    // If clicking on already selected radio, deselect it
                    if (radio.dataset.wasChecked === 'true') {
                        radio.checked = false;
                        radio.dataset.wasChecked = 'false';
                    } else {
                        // Mark this one as checked and clear others
                        radioButtons.forEach(r => r.dataset.wasChecked = 'false');
                        radio.dataset.wasChecked = 'true';
                    }
                });
            });
        }
    }

    submitMyAnswer() {
        // Check for MCQ answer (radio button)
        const selectedRadio = document.querySelector('input[name="mcqAnswer"]:checked');
        if (selectedRadio) {
            // Get the text value from the selected option
            const optionLabel = document.querySelector(`label[for="${selectedRadio.id}"] .mcq-option-text`);
            const answerText = optionLabel ? optionLabel.textContent : selectedRadio.value;
            this.submitAnswer(answerText);
            return;
        }

        // Check if this is an MCQ question (has radio buttons)
        const hasRadioButtons = document.querySelector('input[name="mcqAnswer"]');
        if (hasRadioButtons) {
            // MCQ question but no option selected = implicit "None of these"
            this.submitAnswer('None of these');
            return;
        }

        // Check for FREE_TEXT answer (textarea)
        const input = document.getElementById('answerInput');
        if (input) {
            this.submitAnswer(input.value);
        }
    }

    /**
     * Helper to get readable answer text (converts MCQ IDs to text if needed)
     */
    getReadableAnswer(answer, questionIndex) {
        // If answer looks like an MCQ option ID (opt-xxx), try to convert it
        if (typeof answer === 'string' && answer.startsWith('opt-')) {
            const question = this.gameState.questions[questionIndex];
            if (question && question.options) {
                const option = question.options.find(opt => opt.id === answer);
                if (option) {
                    return option.text;
                }
            }
        }
        return answer;
    }

    showAnswerSubmitted() {
        const form = document.querySelector('.answer-form');
        if (form) {
            form.innerHTML = `
                <div style="padding:20px;text-align:center;">
                    <span style="font-size:36px;">✅</span>
                    <h4 style="color:#4caf50;margin-top:10px;">Submitted!</h4>
                    <p style="color:#666;">Waiting for others...</p>
                </div>
            `;
        }
    }

    showAnswerRevealScreen(answers) {
        const container = document.getElementById('gameContainer');
        const index = this.gameState.currentQuestionIndex;
        const total = this.gameState.questions?.length || this.gameState.questionsPerRound;

        const answersHtml = answers
            .map(({ name, answer }) => this.createAnswerCard(name, answer, index, false))
            .join('');

        const phaseIndicator = this.createPhaseIndicator('reveal', `Answers - Q${index + 1}/${total}`);
        const nextMessage = index + 1 < total ? 'Next question coming...' : 'Discussion time next...';

        container.innerHTML = this.createScreenContainer(
            phaseIndicator,
            `
                <h3>📝 Everyone's Answers</h3>
                <div class="answers-grid">${answersHtml}</div>
                <p style="color:#666;font-size:14px;margin-top:15px;">${nextMessage}</p>
            `
        );
    }

    /**
     * Show DISCUSSION phase - review ALL answers from all questions before voting
     */
    showDiscussionScreen(allAnswers) {
        const container = document.getElementById('gameContainer');

        const allQuestionsHtml = !allAnswers || allAnswers.length === 0
            ? '<p style="color:#999;">No answers recorded</p>'
            : allAnswers.map((qa, qIndex) => {
                const answersHtml = qa.answers
                    .map(({ name, answer }) => this.createAnswerCard(name, answer, qIndex, true))
                    .join('');

                return `
                    <div class="question-block">
                        <div class="question-header-mini">
                            <span class="q-icon">${qa.question?.icon || '❓'}</span>
                            <span class="q-text">Q${qIndex + 1}: ${qa.question?.text || 'Question'}</span>
                        </div>
                        <div class="answers-mini-grid">${answersHtml}</div>
                    </div>
                `;
            }).join('');

        const phaseIndicator = this.createPhaseIndicator('discussion', '📋 Discussion Time');
        const timerBar = this.createTimerBar();
        const roundInfo = `Round ${this.gameState.round}/${this.gameState.maxRounds || MAX_ROUNDS}`;

        container.innerHTML = this.createScreenContainer(
            phaseIndicator,
            `
                <h3>Review All Answers Before Voting!</h3>
                <p style="color:#666;margin-bottom:15px;">${roundInfo} • Look for suspicious answers!</p>
                ${timerBar}
                <div class="all-answers-container">${allQuestionsHtml}</div>
                <p style="color:#888;font-size:13px;margin-top:15px;">⏳ Voting starts when timer ends...</p>
            `,
            'discussion-screen'
        );
    }

    showVotingScreen() {
        const container = document.getElementById('gameContainer');
        const players = this.getPlayerList();

        const votingHtml = players.map(player => {
            const isSelf = player.name === this.username;
            const initial = player.name.charAt(0).toUpperCase();
            
            return `
                <button 
                    class="vote-btn${isSelf ? ' is-self' : ''}" 
                    data-name="${player.name}"
                    onclick="liarGame.submitVote('${player.name}')"
                    ${isSelf ? 'disabled' : ''}
                >
                    <div class="answer-avatar">${initial}</div>
                    <div class="answer-content">
                        <div class="answer-name">${player.name}${isSelf ? ' (You)' : ''}</div>
                    </div>
                </button>
            `;
        }).join('');

        container.innerHTML = `
            <div class="question-screen">
                <span class="phase-indicator phase-voting">Voting Time</span>
                <h3>🗳️ Who is the Liar?</h3>
                <p style="color:#666;margin-bottom:15px;">Vote for who you think doesn't know the item!</p>
                <div class="timer-bar">
                    <div class="timer-fill" style="width: 100%;"></div>
                </div>
                <div class="voting-grid">${votingHtml}</div>
            </div>
        `;
    }

    highlightVotedPlayer(name) {
        const btn = document.querySelector(`.vote-btn[data-name="${name}"]`);
        if (btn) btn.classList.add('selected');
        document.querySelectorAll('.vote-btn').forEach(b => b.disabled = true);
    }

    showRevealScreen(data) {
        const container = document.getElementById('gameContainer');
        const { gameMode, voteThreshold, secretItem, voteResults, eliminatedPlayers, revealedLiars } = data;

        // MODE-SPECIFIC VOTE DISPLAY
        let voteHtml = '';
        let voteResultMessage = '';

        if (gameMode === GameMode.SURVIVAL) {
            // SURVIVAL: Show full vote counts with percentages
            const totalVotes = voteResults.reduce((sum, v) => sum + v.count, 0);
            voteHtml = voteResults
                .sort((a, b) => b.count - a.count) // Sort by vote count descending
                .map(({ name, count }) => {
                    const eliminated = eliminatedPlayers && eliminatedPlayers.includes(name);
                    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    return `
                        <div class="vote-result ${eliminated ? 'eliminated' : ''}">
                            👤 ${name} ${eliminated ? '❌ ELIMINATED' : ''}
                            <span class="vote-count">${count} vote${count !== 1 ? 's' : ''} (${percentage}%)</span>
                        </div>
                    `;
                }).join('');

            voteResultMessage = eliminatedPlayers && eliminatedPlayers.length > 0
                ? `<strong>Players eliminated this round:</strong> ${eliminatedPlayers.join(', ')}`
                : '<strong>No one was eliminated this round</strong>';
        } else {
            // INVESTIGATION: Show only Pass/Fail WITHOUT revealing names
            const anyoneEliminated = eliminatedPlayers && eliminatedPlayers.length > 0;
            const anyoneRevealed = revealedLiars && revealedLiars.length > 0;
            const votePassed = anyoneEliminated || anyoneRevealed;

            voteHtml = `
                <div class="vote-result-investigation ${votePassed ? 'pass' : 'fail'}">
                    <div style="font-size: 48px; margin-bottom: 10px;">
                        ${votePassed ? '✅' : '❌'}
                    </div>
                    <h3>${votePassed ? 'PASS' : 'FAIL'}</h3>
                    <p style="color: #666; margin-top: 10px; font-size: 16px;">
                        ${votePassed 
                            ? `<strong style="color: #333;">🤥 Someone was caught!</strong>` 
                            : 'No one caught this round!'}
                    </p>
                    ${votePassed 
                        ? `<p style="color: #4caf50; margin-top: 8px; font-size: 14px;">The secret may have been revealed to caught players.</p>`
                        : `<p style="color: #f59e0b; margin-top: 8px; font-size: 14px;">The mystery continues...</p>`}
                </div>
            `;

            voteResultMessage = votePassed
                ? `<strong>Investigation successful!</strong> Someone was caught.`
                : '<strong>Investigation failed.</strong> No one caught.';
        }

        container.innerHTML = `
            <div class="reveal-screen">
                <span class="phase-indicator phase-results">Results - Round ${this.gameState.round}/${this.gameState.maxRounds}</span>
                
                <div class="vote-tally" style="max-width: 500px; margin: 20px auto;">
                    <h4>🗳️ Vote Results</h4>
                    ${voteHtml || '<p>No votes</p>'}
                    <p style="margin-top: 15px; font-size: 14px; color: #666;">
                        ${voteResultMessage}
                    </p>
                </div>
                
                <p style="text-align: center; color: #666; margin-top: 20px; font-size: 14px;">
                    ${this.isHost() ? 'Click below to continue to the next round...' : 'Waiting for next round...'}
                </p>
                
                <div class="timer-bar">
                    <div class="timer-fill" style="width: 100%;"></div>
                </div>
            </div>
        `;

        // Mark eliminated players in sidebar (SURVIVAL mode only)
        if (gameMode === GameMode.SURVIVAL && eliminatedPlayers) {
            eliminatedPlayers.forEach(playerName => {
                const item = document.querySelector(`.player-item[data-name="${playerName}"]`);
                if (item) item.classList.add('eliminated');
            });
        }

        // Don't highlight liars in sidebar - we don't know who they are!
    }

    /**
     * Send disturbance from liar (multiple types)
     */
    sendDisturbance(type = 'celebration') {
        if (this.myRole !== 'LIAR') {
            console.log('[FindTheLiar] Only liars can send disturbance!');
            return;
        }

        // Use liar's personal celebration settings (or defaults)
        const emoji = this.myCelebrationEmoji || '😈';
        const text = type === 'celebration' ? (this.myCelebrationText || 'HAHAHA!') : this.getDisturbanceText(type);

        console.log(`[FindTheLiar] Sending liar disturbance: ${type} with emoji ${emoji}`);

        const message = {
            type: 'liar-disturbance',
            disturbanceType: type,
            emoji: emoji,
            text: text
        };

        if (this.isHost()) {
            // If we are the host, handle it directly
            this.handleLiarDisturbance(this.username, message);
        } else {
            // Non-host: sendData() automatically routes to host
            this.sendData(message);
        }

        this.showToast(`${this.getDisturbanceIcon(type)} ${this.getDisturbanceMessage(type)}`, 'success');
    }

    getDisturbanceText(type) {
        const texts = {
            'celebration': 'Hehe!',
            'timer': 'Hurry up!',
            'shake': 'Shake it!',
            'emoji-rain': 'Rain!',
            'blur': 'Confused?',
            'fake-submit': 'Submitted!',
            'fake-typing': 'Typing...',
            'fake-alert': 'Alert!'
        };
        return texts[type] || 'Hehe!';
    }

    getDisturbanceIcon(type) {
        const icons = {
            'celebration': this.myCelebrationEmoji || '😈',
            'timer': '⏱️',
            'shake': '📳',
            'emoji-rain': '🌧️',
            'blur': '😵',
            'fake-submit': '✅',
            'fake-typing': '💬',
            'fake-alert': '🚨'
        };
        return icons[type] || '😈';
    }

    getDisturbanceMessage(type) {
        const messages = {
            'celebration': 'Celebration sent!',
            'timer': 'Fake rush sent!',
            'shake': 'Screen shake sent!',
            'emoji-rain': 'Emoji rain sent!',
            'blur': 'Confusion sent!',
            'fake-submit': 'Fake submission sent!',
            'fake-typing': 'Fake typing sent!',
            'fake-alert': 'Fake alert sent!'
        };
        return messages[type] || 'Disturbance sent!';
    }

    /**
     * Show mini celebration (smaller, shorter version)
     */
    showMiniCelebration(emoji, text) {
        // Create mini celebration overlay
        const overlay = document.createElement('div');
        overlay.id = 'miniCelebration';
        overlay.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 10000;
            animation: miniCelebrationPop 1.5s ease-out forwards;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: rgba(156, 39, 176, 0.95);
            padding: 30px 50px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        `;

        const emojiEl = document.createElement('div');
        emojiEl.textContent = emoji;
        emojiEl.style.cssText = `
            font-size: 60px;
            margin-bottom: 10px;
            animation: bounce 0.6s infinite alternate;
        `;

        const textEl = document.createElement('div');
        textEl.textContent = text;
        textEl.style.cssText = `
            color: #fff;
            font-size: 32px;
            font-weight: bold;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        `;

        content.appendChild(emojiEl);
        content.appendChild(textEl);
        overlay.appendChild(content);
        document.body.appendChild(overlay);

        // Auto-remove after animation
        setTimeout(() => {
            overlay.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => overlay.remove(), 300);
        }, 1500);

        // Add mini celebration animation if not exists
        if (!document.getElementById('miniCelebrationStyles')) {
            const style = document.createElement('style');
            style.id = 'miniCelebrationStyles';
            style.textContent = `
                @keyframes miniCelebrationPop {
                    0% { 
                        opacity: 0; 
                        transform: translate(-50%, -50%) scale(0.5);
                    }
                    50% { 
                        opacity: 1; 
                        transform: translate(-50%, -50%) scale(1.1);
                    }
                    70% { 
                        transform: translate(-50%, -50%) scale(1);
                    }
                    100% { 
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.8);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Fake timer speedup effect
     */
    showFakeTimerSpeedup() {
        const timerFill = document.querySelector('.timer-fill');
        if (!timerFill) return;

        // Rapidly animate timer fill to make it look like time is running out
        timerFill.style.transition = 'width 3s linear';
        timerFill.style.width = '10%';

        // Show warning toast
        this.showToast('⏱️ TIME RUNNING OUT!', 'error', 2000);

        // Reset after 3 seconds
        setTimeout(() => {
            timerFill.style.transition = 'width 0.3s linear';
        }, 3000);
    }

    /**
     * Screen shake effect
     */
    shakeScreen() {
        const gameContainer = document.getElementById('gameContainer');
        if (!gameContainer) return;

        gameContainer.style.animation = 'shake 0.5s';

        setTimeout(() => {
            gameContainer.style.animation = '';
        }, 500);

        // Add shake animation if not exists
        if (!document.getElementById('shakeAnimation')) {
            const style = document.createElement('style');
            style.id = 'shakeAnimation';
            style.textContent = `
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    10%, 30%, 50%, 70%, 90% { transform: translateX(-10px); }
                    20%, 40%, 60%, 80% { transform: translateX(10px); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Emoji rain effect
     */
    showEmojiRain(emoji) {
        const container = document.createElement('div');
        container.id = 'emojiRain';
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 9999;
        `;

        // Create 20 falling emojis
        for (let i = 0; i < 20; i++) {
            const emojiEl = document.createElement('div');
            emojiEl.textContent = emoji;
            emojiEl.style.cssText = `
                position: absolute;
                font-size: ${30 + Math.random() * 30}px;
                left: ${Math.random() * 100}%;
                top: -50px;
                animation: fall ${3 + Math.random() * 2}s linear forwards;
                animation-delay: ${Math.random() * 0.5}s;
            `;
            container.appendChild(emojiEl);
        }

        document.body.appendChild(container);

        // Remove after animation
        setTimeout(() => container.remove(), 6000);

        // Add fall animation if not already added
        if (!document.getElementById('fallAnimation')) {
            const style = document.createElement('style');
            style.id = 'fallAnimation';
            style.textContent = `
                @keyframes fall {
                    to {
                        transform: translateY(100vh) rotate(360deg);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Blur question effect
     */
    blurQuestion() {
        const questionCard = document.querySelector('.question-card');
        if (!questionCard) return;

        questionCard.style.filter = 'blur(8px)';
        questionCard.style.transition = 'filter 0.3s';

        this.showToast('😵 What was the question again?', 'info', 2000);

        // Gradually remove blur
        setTimeout(() => {
            questionCard.style.filter = 'blur(4px)';
        }, 1000);

        setTimeout(() => {
            questionCard.style.filter = 'blur(0px)';
        }, 2000);

        setTimeout(() => {
            questionCard.style.filter = '';
            questionCard.style.transition = '';
        }, 2300);
    }

    /**
     * Fake submission notification
     */
    showFakeSubmission() {
        const fakeNames = ['Player1', 'Player2', 'QuickGamer', 'FastTyper', 'SmartOne'];
        const randomName = fakeNames[Math.floor(Math.random() * fakeNames.length)];

        this.showToast(`✅ ${randomName} submitted their answer!`, 'success', 2000);

        // Show another one after a delay
        setTimeout(() => {
            const anotherName = fakeNames[Math.floor(Math.random() * fakeNames.length)];
            this.showToast(`✅ ${anotherName} submitted their answer!`, 'success', 2000);
        }, 1000);
    }

    /**
     * Show fake typing indicators
     */
    showFakeTyping() {
        const fakeNames = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan'];
        const randomName = fakeNames[Math.floor(Math.random() * fakeNames.length)];

        // Show typing indicator
        this.showToast(`💬 ${randomName} is typing...`, 'info', 2500);

        // Show another after delay
        setTimeout(() => {
            const anotherName = fakeNames[Math.floor(Math.random() * fakeNames.length)];
            this.showToast(`💬 ${anotherName} is typing...`, 'info', 2500);
        }, 1500);
    }

    /**
     * Show fake urgent alerts
     */
    showFakeAlert() {
        const alerts = [
            '🚨 10 seconds remaining!',
            '🚨 Time is running out!',
            '🚨 Last chance to answer!',
            '🚨 Submit now!',
            '⚠️ Connection unstable!'
        ];

        const randomAlert = alerts[Math.floor(Math.random() * alerts.length)];
        this.showToast(randomAlert, 'error', 3000);

        // Add a second alert for extra pressure
        setTimeout(() => {
            const anotherAlert = alerts[Math.floor(Math.random() * alerts.length)];
            if (anotherAlert !== randomAlert) {
                this.showToast(anotherAlert, 'warning', 2500);
            }
        }, 1500);
    }

    showRoundEndScreen() {
        const container = document.getElementById('gameContainer');

        container.innerHTML = `
            <div class="waiting-screen">
                <span class="phase-indicator phase-waiting">Round Complete</span>
                <h2>🏁 Round ${this.gameState.round} Complete!</h2>
                <p style="color:#666;margin:20px 0;">
                    ${this.isHost() 
                        ? 'Click below to start a new round.'
                        : 'Waiting for host...'}
                </p>
                ${this.isHost ? `
                    <button class="btn btn-primary" onclick="liarGame.startRound()">
                        🔄 New Round
                    </button>
                ` : `
                    <div class="waiting-indicator">Waiting for host...</div>
                `}
            </div>
        `;

        this.resetLocalState();
    }

    /**
     * Show game over screen with results
     */
    showGameOverScreen(data) {
        const container = document.getElementById('gameContainer');
        const { mode, winner, liarNames, revealedLiars, message } = data;

        // Build player results list
        const playerResultsHtml = this.getPlayerList().map(player => {
            const isLiar = liarNames.includes(player.name);
            const isRevealed = revealedLiars && revealedLiars.includes(player.name);

            return `
                <div class="player-result${isLiar ? ' liar' : ''}${isRevealed ? ' revealed' : ''}" data-name="${player.name}">
                    <span class="player-icon">${player.name.charAt(0).toUpperCase()}</span>
                    <div class="player-info">
                        <span class="player-name">${player.name}</span>
                    </div>
                    ${isLiar ? '<span class="player-role">🤥 Liar</span>' : ''}
                    ${isRevealed ? '<span class="player-status">✅ Revealed</span>' : ''}
                </div>
            `;
        }).join('');

        // Show start new game button for host
        const actionButtonHtml = this.isHost()
            ? `<button class="btn btn-primary" style="margin-top: 20px;" onclick="liarGame.resetGame()">
                🎮 Start New Game
               </button>`
            : `<p style="color: #666; margin-top: 20px;">Waiting for host to start new game...</p>`;

        container.innerHTML = `
            <div class="game-over-screen">
                <span class="phase-indicator phase-game-over">Game Over</span>
                <h2>${winner === 'LIARS' ? '🎉 Liars Win!' : '🎊 Truthful Players Win!'}</h2>
                <p style="font-size: 18px; margin: 10px 0;">${message}</p>
                
                <div class="player-results">
                    ${playerResultsHtml}
                </div>
                
                ${actionButtonHtml}
                
                <div class="timer-bar">
                    <div class="timer-fill" style="width: 100%;"></div>
                </div>
            </div>
        `;
    }

    /**
     * Show liar celebration overlay with emojis and sound
     */
    showLiarCelebration(liarNames, emojis, message) {
        // Create celebration overlay
        const overlay = document.createElement('div');
        overlay.id = 'liarCelebration';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(156, 39, 176, 0.95);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            animation: fadeIn 0.3s ease;
        `;

        const emojiContainer = document.createElement('div');
        emojiContainer.style.cssText = `
            font-size: 60px;
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            max-width: 600px;
            gap: 10px;
            margin-bottom: 30px;
            animation: bounceIn 0.5s ease;
        `;
        emojis.forEach(emoji => {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.style.animation = `bounce 0.6s infinite alternate`;
            span.style.animationDelay = `${Math.random() * 0.5}s`;
            emojiContainer.appendChild(span);
        });

        const messageEl = document.createElement('h1');
        messageEl.textContent = message;
        messageEl.style.cssText = `
            color: #fff;
            font-size: 72px;
            margin: 20px 0;
            text-shadow: 3px 3px 6px rgba(0,0,0,0.5);
            animation: pulse 0.5s infinite alternate;
        `;

        overlay.appendChild(emojiContainer);
        overlay.appendChild(messageEl);

        // Only show liar names if provided (at game end)
        if (liarNames && liarNames.length > 0) {
            const liarNamesEl = document.createElement('p');
            liarNamesEl.textContent = liarNames.join(' & ') + (liarNames.length > 1 ? ' escaped!' : ' escaped!');
            liarNamesEl.style.cssText = `
                color: #fff;
                font-size: 32px;
                margin-top: 20px;
            `;
            overlay.appendChild(liarNamesEl);
        }

        document.body.appendChild(overlay);

        // Play laughing sound
        this.playLaughSound();

        // Remove after celebration duration
        setTimeout(() => {
            overlay.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => overlay.remove(), 300);
        }, LIAR_CELEBRATION_DURATION);

        // Add keyframes if not already added
        if (!document.getElementById('celebrationStyles')) {
            const style = document.createElement('style');
            style.id = 'celebrationStyles';
            style.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes fadeOut {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                @keyframes bounce {
                    from { transform: translateY(0px); }
                    to { transform: translateY(-20px); }
                }
                @keyframes bounceIn {
                    from { transform: scale(0); }
                    to { transform: scale(1); }
                }
                @keyframes pulse {
                    from { transform: scale(1); }
                    to { transform: scale(1.1); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Play laughing sound effect
     */
    playLaughSound() {
        try {
            // Create AudioContext for sound generation
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.1);
            oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.2);

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);

            // Repeat for "ha ha ha" effect
            setTimeout(() => this.playSingleHa(audioContext), 200);
            setTimeout(() => this.playSingleHa(audioContext), 400);
        } catch (e) {
            console.log('[FindTheLiar] Audio not supported', e);
        }
    }

    playSingleHa(audioContext) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(450, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =========================================================================
    // HTML Template Helpers (Reduce Duplication)
    // =========================================================================

    /**
     * Generate phase indicator HTML
     * @param {string} phase - Phase name
     * @param {string} label - Display label
     * @returns {string} HTML string
     */
    createPhaseIndicator(phase, label) {
        const phaseClass = phase.toLowerCase().replace('_', '-');
        return `<span class="phase-indicator phase-${phaseClass}">${label}</span>`;
    }

    /**
     * Generate timer bar HTML
     * @returns {string} HTML string
     */
    createTimerBar() {
        return `
            <div class="timer-bar">
                <div class="timer-fill" style="width: 100%;"></div>
            </div>
        `;
    }

    /**
     * Generate item reminder HTML (for non-liars and liars)
     * @returns {string} HTML string
     */
    createItemReminder() {
        if (!this.myItemInfo) return '';

        if (this.myRole === 'LIAR') {
            return `
                <div class="item-reminder liar-reminder">
                    <strong>📂 ${this.myItemInfo.category}</strong> | 
                    Hints: ${this.myItemInfo.hints.slice(0, PLAYER_INITIAL_HINT_COUNT).join(', ')}...
                </div>
            `;
        } else {
            return `
                <div class="item-reminder innocent-reminder">
                    <span>${this.myItemInfo.imageUrl}</span>
                    <strong>${this.myItemInfo.name}</strong>
                </div>
            `;
        }
    }

    /**
     * Generate answer card HTML
     * @param {string} name - Player name
     * @param {string} answer - Answer text
     * @param {number} questionIndex - Question index for MCQ conversion
     * @param {boolean} compact - Use compact style
     * @returns {string} HTML string
     */
    createAnswerCard(name, answer, questionIndex, compact = false) {
        const initial = name.charAt(0).toUpperCase();
        const isSelf = name === this.username;
        const displayAnswer = this.getReadableAnswer(answer, questionIndex);
        const compactClass = compact ? ' compact' : '';
        const selfClass = isSelf ? ' self' : '';

        return `
            <div class="answer-card${compactClass}${selfClass}" data-name="${name}">
                <div class="answer-avatar${compact ? ' small' : ''}">${initial}</div>
                <div class="answer-content">
                    <div class="answer-name">${name}${isSelf && !compact ? ' (You)' : ''}</div>
                    <div class="answer-text">${this.escapeHtml(displayAnswer)}</div>
                </div>
            </div>
        `;
    }

    /**
     * Generate container with title and content
     * @param {string} title - Screen title
     * @param {string} content - Inner HTML content
     * @param {string} className - Container class name
     * @returns {string} HTML string
     */
    createScreenContainer(title, content, className = 'question-screen') {
        return `
            <div class="${className}">
                ${title}
                ${content}
            </div>
        `;
    }
}


// ============================================
// CONNECTION MODAL INITIALIZATION
// ============================================

function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'liar_',
        channelPrefix: 'liar-',
        title: '🤥 Join Find the Liar',
        collapsedTitle: '🤥 Find the Liar',
        onConnect: async function(username, channel, password) {
            console.log('[FindTheLiar] Connecting...', { username, channel });

            // Show loader using parent class method
            liarGame.showConnectionLoader('Connecting to game...');

            try {
                await liarGame.connect({
                    username: username,
                    channelName: channel,
                    channelPassword: password
                });

                await liarGame.start();

                if (window.ConnectionModal) {
                    ConnectionModal.hide();
                }

                console.log('[FindTheLiar] Connected successfully!');
            } catch (error) {
                console.error('[FindTheLiar] Connection failed:', error);
                liarGame.showToast('Connection failed: ' + error.message, 'error');
            } finally {
                // Hide loader using parent class method
                liarGame.hideConnectionLoader();
            }
        }
    });
}

// ============================================
// INITIALIZATION
// ============================================

let liarGame;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[FindTheLiar] Page loaded');

    // Create game instance
    liarGame = new FindTheLiarGame();
    window.liarGame = liarGame;
    
    await liarGame.initialize();
    
    // Initialize connection modal
    initializeConnectionModal();

    // Process shared link and setup auto-connect
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'FindTheLiar',
            storagePrefix: 'liar_',
            connectCallback: async function() {
                console.log('[FindTheLiar] Auto-connect triggered');
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    try {
                        await liarGame.connect({
                            username: username,
                            channelName: channel,
                            channelPassword: password
                        });

                        await liarGame.start();

                        if (window.ConnectionModal) {
                            ConnectionModal.hide();
                        }
                    } catch (error) {
                        console.error('[FindTheLiar] Auto-connect failed:', error);
                    }
                } else {
                    console.warn('[FindTheLiar] Auto-connect skipped: missing username or channel');
                }
            }
        });
    }

    console.log('[FindTheLiar] Ready!');
});

// ============================================
// DISCONNECT FUNCTION
// ============================================

function disconnect() {
    if (liarGame) {
        // Stop timer
        if (liarGame.timerInterval) {
            clearInterval(liarGame.timerInterval);
            liarGame.timerInterval = null;
        }

        // Disconnect from channel
        liarGame.disconnect();

        // Hide disconnect button
        const disconnectBtn = document.getElementById('disconnectBtn');
        if (disconnectBtn) {
            disconnectBtn.style.display = 'none';
        }

        // Remove URL hash
        window.history.replaceState(null, '', window.location.pathname);
    }

    // Show connection modal
    if (window.ConnectionModal) {
        ConnectionModal.show();
    }
}

// ============================================
// HELP MODAL FUNCTIONS
// ============================================

/**
 * Show help modal with game rules and instructions
 */
function showHelpModal() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.classList.remove('hidden');
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Close help modal
 */
function closeHelpModal() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.classList.add('hidden');
        // Restore body scroll
        document.body.style.overflow = '';
    }
}

// Close modal when clicking outside the content or pressing Escape
document.addEventListener('DOMContentLoaded', function() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.addEventListener('click', function(e) {
            if (e.target === helpModal) {
                closeHelpModal();
            }
        });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const helpModal = document.getElementById('helpModal');
            if (helpModal && !helpModal.classList.contains('hidden')) {
                closeHelpModal();
            }
        }
    });
});

