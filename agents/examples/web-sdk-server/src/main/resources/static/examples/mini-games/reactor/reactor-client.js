/**
 * 4-Player Reactor Game
 * Real-time multiplayer reaction speed game using Messaging Platform SDK with BaseGame
 * Features:
 * - Host/Player system with waiting room
 * - DataChannel P2P communication for instant light activation
 * - Real-time score synchronization
 * - Zone-based gameplay for up to 4 players
 * - 10 Different Game Stages
 */

// ============================================
// GAME CONFIGURATION
// ============================================

const GAME_CONFIG = {
    NAME: 'reactor',
    VERSION: '3.0.0',
    MAX_PLAYERS: 4,
};

const ZONE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b']; // Blue, Red, Green, Yellow
const ZONE_NAMES = ['Blue', 'Red', 'Green', 'Yellow'];

// ============================================
// STAGE DEFINITIONS
// ============================================

const STAGES = [
    {
        id: 1,
        name: 'Classic Mode',
        icon: '⚡',
        description: 'Basic reaction speed test. Click when your zone lights up!',
        config: {
            roundDuration: 30,
            totalRounds: 3,
            minLightInterval: 1000,
            maxLightInterval: 2500,
            lightDuration: 2000,
            baseScore: 100,
            timeBonus: true,
            penalty: 50,
            mode: 'classic'
        }
    },
    {
        id: 2,
        name: 'Speed Frenzy',
        icon: '🏃',
        description: 'Faster lights, shorter duration. Can you keep up?',
        config: {
            roundDuration: 25,
            totalRounds: 3,
            minLightInterval: 400,
            maxLightInterval: 1200,
            lightDuration: 1000,
            baseScore: 80,
            timeBonus: true,
            penalty: 30,
            mode: 'classic'
        }
    },
    {
        id: 3,
        name: 'Memory Sequence',
        icon: '🧠',
        description: 'Remember the sequence! Lights flash in order - repeat it!',
        config: {
            roundDuration: 45,
            totalRounds: 5,
            sequenceLength: 3, // Starting length
            sequenceGrowth: 1, // Add 1 each round
            lightDuration: 600,
            baseScore: 150,
            penalty: 100,
            mode: 'sequence'
        }
    },
    {
        id: 4,
        name: 'Color Match',
        icon: '🎨',
        description: 'Only click when YOUR zone matches the target color!',
        config: {
            roundDuration: 30,
            totalRounds: 3,
            minLightInterval: 1200,
            maxLightInterval: 2000,
            lightDuration: 1500,
            baseScore: 120,
            timeBonus: true,
            penalty: 80,
            matchColors: ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3'],
            mode: 'colorMatch'
        }
    },
    {
        id: 5,
        name: 'Hot Potato',
        icon: '🔥',
        description: 'Light bounces between zones. Click fast when it stops on you!',
        config: {
            roundDuration: 35,
            totalRounds: 3,
            bounceSpeed: 300, // ms per bounce
            stopDuration: 800,
            baseScore: 100,
            penalty: 60,
            mode: 'hotPotato'
        }
    },
    {
        id: 6,
        name: 'Reverse Mode',
        icon: '🔄',
        description: 'DON\'T click your zone! Click when OTHER zones light up!',
        config: {
            roundDuration: 30,
            totalRounds: 3,
            minLightInterval: 1000,
            maxLightInterval: 2000,
            lightDuration: 1500,
            baseScore: 100,
            timeBonus: true,
            penalty: 100,
            mode: 'reverse'
        }
    },
    {
        id: 7,
        name: 'Combo Chain',
        icon: '🔗',
        description: 'Multiple zones light up! Click them in order 1→2→3→4!',
        config: {
            roundDuration: 40,
            totalRounds: 3,
            comboSize: 2, // Starting combo size
            comboGrowth: 1,
            lightDuration: 3000,
            baseScore: 50, // Per correct click
            comboMultiplier: 1.5,
            penalty: 50,
            mode: 'combo'
        }
    },
    {
        id: 8,
        name: 'Endurance',
        icon: '⏱️',
        description: 'Long round! Lights get faster over time. Survive!',
        config: {
            roundDuration: 60,
            totalRounds: 1,
            minLightInterval: 1500,
            maxLightInterval: 2500,
            lightDuration: 1800,
            speedIncrease: 50, // ms faster every 10 seconds
            baseScore: 80,
            timeBonus: true,
            penalty: 40,
            mode: 'endurance'
        }
    },
    {
        id: 9,
        name: 'Sniper Mode',
        icon: '🎯',
        description: 'Very short flash! High reward, high risk!',
        config: {
            roundDuration: 30,
            totalRounds: 3,
            minLightInterval: 1500,
            maxLightInterval: 3000,
            lightDuration: 500,
            baseScore: 200,
            timeBonus: true,
            penalty: 150,
            mode: 'classic'
        }
    },
    {
        id: 10,
        name: 'Boss Battle',
        icon: '👾',
        description: 'Ultimate challenge! Random patterns, moving lights, chaos!',
        config: {
            roundDuration: 45,
            totalRounds: 3,
            minLightInterval: 600,
            maxLightInterval: 1500,
            lightDuration: 1200,
            multiLight: true, // Multiple lights at once
            movingLight: true, // Light can shift zones
            baseScore: 150,
            timeBonus: true,
            penalty: 100,
            mode: 'boss'
        }
    }
];

// ============================================
// REACTOR GAME CLASS - BaseGame Integration
// ============================================

class ReactorGame extends AgentInteractionBase {
    constructor() {
        super({
            storagePrefix: 'reactor',
            customType: 'reactor',
            autoCreateDataChannel: true,
            dataChannelName: 'reactor-data',
            dataChannelOptions: {
                ordered: false,      // Unordered for lowest latency
                maxRetransmits: 0    // No retransmits for speed
            }
        });

        // Game state
        this.gameStatus = 'waiting'; // waiting, playing, finished
        this.currentRound = 0;
        this.roundStartTime = 0;
        this.activeLight = null;
        this.activeLights = []; // For multi-light modes
        this.lightActivatedTime = 0;

        // Stage system
        this.currentStage = STAGES[0];
        this.stageConfig = { ...STAGES[0].config };

        // Sequence mode state
        this.sequence = [];
        this.playerSequence = [];
        this.sequencePhase = 'show'; // 'show' or 'input'

        // Color match mode state
        this.targetColor = null;
        this.zoneColors = {};

        // Combo mode state
        this.comboSequence = [];
        this.comboIndex = 0;

        // Endurance mode state
        this.enduranceStartTime = 0;

        // Player management
        this.playerZones = new Map(); // playerId -> zone
        this.zoneAssignments = {}; // zone -> playerId
        this.playerScores = new Map(); // playerId -> score
        this.connectedPeers = new Set();

        // Stats
        this.gameStats = {
            totalHits: 0,
            fastestReaction: Infinity,
            avgReaction: 0,
            reactions: [],
        };

        // Timers
        this.roundTimer = null;
        this.lightTimer = null;
        this.countdownInterval = null;
        this.sequenceTimer = null;
    }

    async onInitialize() {
        console.log('[Reactor] Initializing...');
        this.setupUI();
    }

    onConnect(detail) {
        console.log('[Reactor] Connected:', detail);
        window.reactorChannel = this.channel;

        // Hide connection modal
        setTimeout(() => {
            if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
                window.ConnectionModal.hide();
            }
            document.getElementById('gameContainer').classList.remove('hidden');
        }, 100);

        // Update room name display
        document.getElementById('roomName').textContent = this.channelName;
        this.updateConnectionIndicator(true);

        // Add self to game
        this.addPlayer(this.username);

        // Check if there are other players already in the channel
        const otherPlayers = this.getConnectedUsers().filter(u => u !== this.username);
        if (otherPlayers.length > 0) {
            // Show loader while establishing DataChannel connections with existing players
            console.log('[Reactor] Other players present, showing connection loader:', otherPlayers);
            this.showConnectionLoader(`Connecting to ${otherPlayers.length} player${otherPlayers.length > 1 ? 's' : ''}...`);
        }

        // Show waiting room
        this.showWaitingRoom();
    }

    onPlayerJoining(detail) {
        console.log('[Reactor] Player joining:', detail.agentName);
        this.showToast(`${detail.agentName} is joining...`, 'info', 2000);

        // Show loader while waiting for DataChannel to open
        this.showConnectionLoader(`Connecting to ${detail.agentName}...`);
    }

    onPlayerJoin(detail) {
        console.log('[Reactor] Player joined successfully:', detail.agentName);

        // Hide the connection loader - DataChannel is now open
        this.hideConnectionLoader();

        this.showJoinNotification(detail.agentName);

        this.addPlayer(detail.agentName);
        this.updateZoneDisplays();
        this.updateLeaderboard();

        // If host, broadcast zone assignments
        if (this.isHost()) {
            this.broadcastZoneAssignments();
        }
    }

    onPlayerLeave(detail) {
        console.log('[Reactor] Player left:', detail.agentName);
        this.showLeaveNotification(detail.agentName);

        this.removePlayer(detail.agentName);
        this.updateZoneDisplays();
        this.updateLeaderboard();

        // If only one player remains and game is playing, stop the game
        if (this.players.size < 2 && this.gameStatus === 'playing') {
            console.log('[Reactor] Not enough players, stopping game');
            this.showToast('Not enough players - game stopped', 'warning');
            this.gameStatus = 'waiting';
        }

        // Host change is handled automatically by BaseGame -> onBecomeHost()

        this.updateGameMessage();
    }

    onBecomeHost() {
        console.log('[Reactor] Became host - showing start button and broadcasting zones');

        // Always show start button when becoming host (if game not playing)
        const startBtn = document.getElementById('startButton');
        if (startBtn) {
            if (this.gameStatus !== 'playing') {
                startBtn.classList.remove('hidden');
            }
        }

        // Broadcast zone assignments as new host
        this.broadcastZoneAssignments();
    }


    onDataChannelOpen(peerId) {
        console.log('[Reactor] DataChannel OPEN with', peerId);
        this.connectedPeers.add(peerId);
        this.showToast(`🔗 P2P connected with ${peerId}`, 'success');
        this.updateZoneDisplays();

        // If host, send current state
        if (this.isHost() && this.gameStatus === 'playing') {
            this.sendGameState(peerId);
        }
    }

    onDataChannelClose(peerId) {
        console.log('[Reactor] DataChannel CLOSED with', peerId);
        this.connectedPeers.delete(peerId);
        this.updateZoneDisplays();
    }

    onDataChannelMessage(peerId, data) {
        console.log('[Reactor] DataChannel message from', peerId, '- type:', data.type);

        switch(data.type) {
            case 'light-activate':
                // Accept light activation from host
                this.activateLight(data.zone, data.timestamp);
                break;
            case 'zone-reaction':
                this.handleZoneReaction(peerId, data.zone, data.reactionTime);
                break;
            case 'game-start':
                this.handleGameStart(data);
                break;
            case 'game-end':
                this.handleGameEnd(data);
                break;
            case 'round-start':
                this.handleRoundStart(data);
                break;
            case 'round-end':
                this.handleRoundEnd(data);
                break;
            case 'score-update':
                this.handleScoreUpdate(data.playerId, data.score, data.delta);
                break;
            case 'zone-assignments':
                this.handleZoneAssignments(data.assignments);
                break;
            case 'game-state':
                this.handleGameState(data);
                break;
            case 'stage-change':
                this.handleStageChange(data.stageId);
                break;
            // Mode-specific messages
            case 'sequence-start':
                this.sequence = data.sequence;
                this.playerSequence = [];
                this.sequencePhase = 'show';
                this.showSequence();
                break;
            case 'color-match':
                this.targetColor = data.targetColor;
                this.zoneColors = data.zoneColors;
                this.lightActivatedTime = data.timestamp;
                this.showColorMatch();
                break;
            case 'hot-potato-bounce':
                const bounceEl = document.getElementById(`light-${data.zone}`);
                if (bounceEl) {
                    bounceEl.classList.add('active');
                    setTimeout(() => bounceEl.classList.remove('active'), 200);
                }
                break;
            case 'hot-potato-stop':
                this.activeLight = data.zone;
                this.lightActivatedTime = data.timestamp;
                const stopEl = document.getElementById(`light-${data.zone}`);
                if (stopEl) stopEl.classList.add('active');
                break;
            case 'combo-start':
                this.comboSequence = data.sequence;
                this.comboIndex = 0;
                this.showCombo();
                break;
            case 'multi-light':
                data.zones.forEach(zone => {
                    const el = document.getElementById(`light-${zone}`);
                    if (el) el.classList.add('active');
                });
                this.activeLight = data.zones[0];
                this.activeLights = [...data.zones];
                this.lightActivatedTime = data.timestamp;
                break;
            case 'moving-light':
                this.activeLight = data.startZone;
                this.lightActivatedTime = data.timestamp;
                const moveEl = document.getElementById(`light-${data.startZone}`);
                if (moveEl) moveEl.classList.add('active');
                break;
            case 'light-move':
                // Deactivate old, activate new
                if (this.activeLight !== null) {
                    this.deactivateLight(this.activeLight);
                }
                this.activeLight = data.zone;
                this.lightActivatedTime = data.timestamp;
                const newEl = document.getElementById(`light-${data.zone}`);
                if (newEl) newEl.classList.add('active');
                break;
        }
    }

    // ============================================
    // PLAYER MANAGEMENT
    // ============================================

    addPlayer(playerId) {
        if (this.playerZones.has(playerId)) {
            console.log(`[Reactor] Player ${playerId} already added, skipping`);
            return;
        }

        // Assign to next available zone
        const zone = this.assignPlayerToZone(playerId);

        if (zone !== null) {
            this.playerZones.set(playerId, zone);
            this.playerScores.set(playerId, 0);

            console.log(`[Reactor] Player added: ${playerId} -> Zone ${zone} (${ZONE_NAMES[zone]})`);
            console.log('[Reactor] Current zone assignments:', this.zoneAssignments);
            console.log('[Reactor] Total players:', this.playerZones.size);
        } else {
            console.warn(`[Reactor] No zone available for ${playerId}`);
        }
    }

    removePlayer(playerId) {
        const zone = this.playerZones.get(playerId);
        if (zone !== undefined) {
            delete this.zoneAssignments[zone];
        }

        this.playerZones.delete(playerId);
        this.playerScores.delete(playerId);
        this.connectedPeers.delete(playerId);
    }

    assignPlayerToZone(playerId) {
        for (let zone = 0; zone < GAME_CONFIG.MAX_PLAYERS; zone++) {
            if (!this.zoneAssignments[zone]) {
                this.zoneAssignments[zone] = playerId;
                return zone;
            }
        }
        return null;
    }

    // ============================================
    // UI SETUP
    // ============================================

    setupUI() {
        // Setup share button click handler
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn && typeof ShareModal !== 'undefined') {
            shareBtn.addEventListener('click', () => {
                try {
                    ShareModal.show(this.channelName, this.channelPassword);
                } catch (e) {
                    console.error('[Reactor] Failed to show share modal:', e);
                }
            });
        }

        // Setup stage select button click handler
        this.setupStageButton();

        // Populate stage selector
        this.populateStageSelector();
    }

    setupStageButton() {
        const stageBtn = document.getElementById('stageSelectBtn');
        if (stageBtn && !stageBtn._listenerAdded) {
            stageBtn._listenerAdded = true;
            stageBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showStageModal();
            });
        }
    }

    populateStageSelector() {
        const container = document.getElementById('stageList');
        if (!container) return;

        container.innerHTML = STAGES.map(stage => `
            <div class="stage-card ${stage.id === this.currentStage.id ? 'selected' : ''}" 
                 data-stage-id="${stage.id}" 
                 onclick="selectStage(${stage.id})">
                <div class="stage-icon">${stage.icon}</div>
                <div class="stage-info">
                    <div class="stage-name">${stage.name}</div>
                    <div class="stage-desc">${stage.description}</div>
                </div>
                <div class="stage-number">#${stage.id}</div>
            </div>
        `).join('');
    }

    selectStage(stageId) {
        const stage = STAGES.find(s => s.id === stageId);
        if (!stage) return;

        this.currentStage = stage;
        this.stageConfig = { ...stage.config };

        // Update UI
        this.populateStageSelector();
        this.updateCurrentStageDisplay();

        // Broadcast stage change to all players
        if (this.isHost()) {
            this.sendData({
                type: 'stage-change',
                stageId: stageId,
                timestamp: Date.now()
            });
        }

        this.showToast(`Stage: ${stage.icon} ${stage.name}`, 'info');
        this.closeStageModal();
    }

    handleStageChange(stageId) {
        const stage = STAGES.find(s => s.id === stageId);
        if (!stage) return;

        this.currentStage = stage;
        this.stageConfig = { ...stage.config };

        this.populateStageSelector();
        this.updateCurrentStageDisplay();
        this.showToast(`Host selected: ${stage.icon} ${stage.name}`, 'info');
    }

    updateCurrentStageDisplay() {
        const display = document.getElementById('currentStageDisplay');
        if (display) {
            display.innerHTML = `${this.currentStage.icon} ${this.currentStage.name}`;
        }

        const stageInfo = document.getElementById('stageInfo');
        if (stageInfo) {
            stageInfo.textContent = this.currentStage.description;
        }
    }

    showStageModal() {
        const modal = document.getElementById('stageModal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    closeStageModal() {
        const modal = document.getElementById('stageModal');
        if (modal) modal.classList.add('hidden');
    }

    nextStage() {
        const currentIndex = STAGES.findIndex(s => s.id === this.currentStage.id);
        const nextIndex = (currentIndex + 1) % STAGES.length;
        this.selectStage(STAGES[nextIndex].id);
    }

    showWaitingRoom() {
        this.updateZoneDisplays();
        this.updateLeaderboard();
        this.updateGameMessage();
        this.updateCurrentStageDisplay();

        // Show share button
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) shareBtn.style.display = 'inline-block';

        // Setup stage button listener (in case it wasn't set up earlier)
        this.setupStageButton();

        // Show/hide stage selector button (host only)
        const stageBtn = document.getElementById('stageSelectBtn');
        if (stageBtn) {
            if (this.isHost()) {
                stageBtn.classList.remove('hidden');
            } else {
                stageBtn.classList.add('hidden');
            }
        }

        // Show start button for host
        const startBtn = document.getElementById('startButton');
        if (startBtn) {
            if (this.isHost()) {
                startBtn.classList.remove('hidden');
                startBtn.disabled = true;
            } else {
                startBtn.classList.add('hidden');
            }
        }
    }

    // ============================================
    // GAME FLOW
    // ============================================

    startGame() {
        if (!this.isHost()) {
            console.warn('[Reactor] Only host can start game');
            return;
        }

        console.log(`[Reactor] Starting Stage ${this.currentStage.id}: ${this.currentStage.name}`);
        this.gameStatus = 'playing';
        this.currentRound = 0;
        this.enduranceStartTime = Date.now();

        // Reset scores
        this.playerScores.forEach((_, key) => this.playerScores.set(key, 0));
        this.gameStats = {
            totalHits: 0,
            fastestReaction: Infinity,
            avgReaction: 0,
            reactions: [],
        };

        // Reset stage-specific state
        this.sequence = [];
        this.playerSequence = [];
        this.comboSequence = [];
        this.comboIndex = 0;

        // Broadcast game start with stage info
        this.sendData({
            type: 'game-start',
            stageId: this.currentStage.id,
            timestamp: Date.now()
        });

        // Update UI
        document.getElementById('startButton').classList.add('hidden');
        const stageBtn = document.getElementById('stageSelectBtn');
        if (stageBtn) stageBtn.classList.add('hidden');

        // Hide control panel during gameplay
        const controlPanel = document.getElementById('controlPanel') || document.querySelector('.control-panel');
        if (controlPanel) controlPanel.classList.add('hidden');

        this.showToast(`${this.currentStage.icon} ${this.currentStage.name} starting!`, 'success');

        // Start first round after delay
        setTimeout(() => this.startRound(), 1500);
    }

    handleGameStart(data) {
        console.log('[Reactor] Game starting!');
        this.gameStatus = 'playing';
        this.currentRound = 0;

        // Apply stage from host
        if (data.stageId) {
            this.handleStageChange(data.stageId);
        }

        // Reset scores
        this.playerScores.forEach((_, key) => this.playerScores.set(key, 0));
        this.gameStats.reactions = [];

        document.getElementById('readyButton').classList.add('hidden');
        const stageBtn = document.getElementById('stageSelectBtn');
        if (stageBtn) stageBtn.classList.add('hidden');

        // Hide control panel during gameplay
        const controlPanel = document.getElementById('controlPanel') || document.querySelector('.control-panel');
        if (controlPanel) controlPanel.classList.add('hidden');

        this.updateZoneDisplays();
        this.updateLeaderboard();

        this.showToast('🎮 Game started!', 'success');
    }

    startRound() {
        if (!this.isHost()) return;

        this.currentRound++;
        this.roundStartTime = Date.now();

        const totalRounds = this.stageConfig.totalRounds || 3;

        console.log(`[Reactor] Starting round ${this.currentRound}/${totalRounds} - Mode: ${this.stageConfig.mode}`);

        // Broadcast round start
        this.sendData({
            type: 'round-start',
            round: this.currentRound,
            totalRounds: totalRounds,
            mode: this.stageConfig.mode,
            timestamp: this.roundStartTime
        });

        // Start based on game mode
        switch (this.stageConfig.mode) {
            case 'sequence':
                this.startSequenceMode();
                break;
            case 'colorMatch':
                this.startColorMatchMode();
                break;
            case 'hotPotato':
                this.startHotPotatoMode();
                break;
            case 'combo':
                this.startComboMode();
                break;
            case 'boss':
                this.startBossMode();
                break;
            case 'classic':
            case 'reverse':
            case 'endurance':
            default:
                this.scheduleNextLight();
                break;
        }

        // Set round timer
        const roundDuration = this.stageConfig.roundDuration || 30;
        this.roundTimer = setTimeout(() => this.endRound(), roundDuration * 1000);

        // Start countdown
        this.startRoundCountdown();
    }

    handleRoundStart(data) {
        this.currentRound = data.round;
        this.roundStartTime = data.timestamp;
        this.updateRoundInfo();
        this.updateGameMessage();
        this.startRoundCountdown();
    }

    endRound() {
        if (!this.isHost()) return;

        this.clearTimers();

        const totalRounds = this.stageConfig.totalRounds || 3;

        console.log(`[Reactor] Round ${this.currentRound} ended`);

        // Broadcast round end
        this.sendData({
            type: 'round-end',
            round: this.currentRound,
            timestamp: Date.now()
        });

        // Deactivate any active lights
        if (this.activeLight !== null) {
            this.deactivateLight(this.activeLight);
        }
        this.activeLights.forEach(zone => this.deactivateLight(zone));
        this.activeLights = [];

        // Clear zone colors (for color match mode)
        this.clearZoneColors();

        // Check if game is over
        if (this.currentRound >= totalRounds) {
            setTimeout(() => this.endGame(), 2000);
        } else {
            this.showToast(`Round ${this.currentRound} complete!`, 'info');
            setTimeout(() => this.startRound(), 3000);
        }
    }

    handleRoundEnd(data) {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }

        if (this.activeLight !== null) {
            this.deactivateLight(this.activeLight);
        }

        this.showToast(`Round ${data.round} complete!`, 'info');
    }

    endGame() {
        if (!this.isHost()) return;

        this.gameStatus = 'finished';
        this.clearTimers();

        // Determine winner
        let winner = null;
        let maxScore = -1;
        this.playerScores.forEach((score, playerId) => {
            if (score > maxScore) {
                maxScore = score;
                winner = playerId;
            }
        });

        // Broadcast game end with scores
        const scoresArray = Array.from(this.playerScores.entries());
        this.sendData({
            type: 'game-end',
            winner: winner,
            scores: scoresArray,
            timestamp: Date.now()
        });

        this.handleGameEnd({ winner, scores: scoresArray });
    }

    handleGameEnd(data) {
        this.gameStatus = 'finished';
        this.clearTimers();

        // Update scores from data
        if (data.scores) {
            data.scores.forEach(([playerId, score]) => {
                this.playerScores.set(playerId, score);
            });
        }

        const message = data.winner ? `🏆 ${data.winner} wins!` : 'Game Over!';
        this.updateGameMessage(message);
        this.updateLeaderboard();
        this.showToast(message, 'success');

        // Show control panel again
        const controlPanel = document.getElementById('controlPanel') || document.querySelector('.control-panel');
        if (controlPanel) controlPanel.classList.remove('hidden');

        // Show start button for host after delay
        setTimeout(() => {
            if (this.isHost()) {
                document.getElementById('startButton').classList.remove('hidden');
                // Show stage select button again
                const stageBtn = document.getElementById('stageSelectBtn');
                if (stageBtn) stageBtn.classList.remove('hidden');
            }
            this.updateZoneDisplays();
            this.updateGameMessage();
        }, 3000);
    }

    sendGameState(toPlayer) {
        this.sendData({
            type: 'game-state',
            gameStatus: this.gameStatus,
            currentRound: this.currentRound,
            stageId: this.currentStage.id,
            scores: Array.from(this.playerScores.entries()),
            zoneAssignments: this.zoneAssignments,
            timestamp: Date.now()
        }, toPlayer);
    }

    handleGameState(data) {
        this.gameStatus = data.gameStatus;
        this.currentRound = data.currentRound;

        if (data.stageId) {
            this.handleStageChange(data.stageId);
        }

        if (data.scores) {
            data.scores.forEach(([playerId, score]) => {
                this.playerScores.set(playerId, score);
            });
        }

        if (data.zoneAssignments) {
            this.zoneAssignments = data.zoneAssignments;
        }

        this.updateZoneDisplays();
        this.updateLeaderboard();
    }

    // ============================================
    // LIGHT MECHANICS (Classic Mode)
    // ============================================

    scheduleNextLight() {
        if (this.gameStatus !== 'playing') return;

        let minInterval = this.stageConfig.minLightInterval || 1000;
        let maxInterval = this.stageConfig.maxLightInterval || 2500;

        // Endurance mode: speed up over time
        if (this.stageConfig.mode === 'endurance') {
            const elapsed = (Date.now() - this.enduranceStartTime) / 1000;
            const speedReduction = Math.floor(elapsed / 10) * (this.stageConfig.speedIncrease || 50);
            minInterval = Math.max(300, minInterval - speedReduction);
            maxInterval = Math.max(500, maxInterval - speedReduction);
        }

        const delay = minInterval + Math.random() * (maxInterval - minInterval);

        this.lightTimer = setTimeout(() => {
            this.activateRandomLight();
            this.scheduleNextLight();
        }, delay);
    }

    activateRandomLight() {
        if (!this.isHost()) return;

        // Pick random zone that has a player
        const occupiedZones = Object.keys(this.zoneAssignments).map(Number);
        if (occupiedZones.length === 0) return;

        const zone = occupiedZones[Math.floor(Math.random() * occupiedZones.length)];
        const timestamp = Date.now();

        // Broadcast via DataChannel (instant)
        this.sendData({
            type: 'light-activate',
            zone: zone,
            timestamp: timestamp
        });

        // Also activate locally
        this.activateLight(zone, timestamp);
    }

    activateLight(zone, timestamp) {
        this.activeLight = zone;
        this.lightActivatedTime = timestamp;

        const lightEl = document.getElementById(`light-${zone}`);
        if (lightEl) {
            lightEl.classList.add('active');
        }

        console.log(`[Reactor] Light activated: Zone ${zone} (${ZONE_NAMES[zone]})`);

        // Auto-deactivate after duration (use stage config)
        const lightDuration = this.stageConfig.lightDuration || 2000;
        setTimeout(() => {
            if (this.activeLight === zone) {
                this.deactivateLight(zone);
            }
        }, lightDuration);
    }

    deactivateLight(zone) {
        if (this.activeLight === zone) {
            this.activeLight = null;
        }

        // Remove from activeLights array if present
        const idx = this.activeLights.indexOf(zone);
        if (idx > -1) this.activeLights.splice(idx, 1);

        const lightEl = document.getElementById(`light-${zone}`);
        if (lightEl) {
            lightEl.classList.remove('active');
            lightEl.style.background = ''; // Reset any custom color
        }
    }

    clearZoneColors() {
        for (let i = 0; i < 4; i++) {
            const lightEl = document.getElementById(`light-${i}`);
            if (lightEl) {
                lightEl.style.background = '';
            }
        }
        this.zoneColors = {};
        this.targetColor = null;

        // Hide target color display
        const targetDisplay = document.getElementById('targetColorDisplay');
        if (targetDisplay) targetDisplay.classList.add('hidden');
    }

    // ============================================
    // SPECIAL GAME MODES
    // ============================================

    // --- SEQUENCE MODE (Stage 3) ---
    startSequenceMode() {
        const baseLength = this.stageConfig.sequenceLength || 3;
        const growth = this.stageConfig.sequenceGrowth || 1;
        const length = baseLength + (this.currentRound - 1) * growth;

        // Generate random sequence
        const occupiedZones = Object.keys(this.zoneAssignments).map(Number);
        this.sequence = [];
        for (let i = 0; i < length; i++) {
            this.sequence.push(occupiedZones[Math.floor(Math.random() * occupiedZones.length)]);
        }
        this.playerSequence = [];
        this.sequencePhase = 'show';

        // Broadcast sequence
        this.sendData({
            type: 'sequence-start',
            sequence: this.sequence,
            timestamp: Date.now()
        });

        // Show sequence to players
        this.showSequence();
    }

    showSequence() {
        this.showToast('Watch the sequence!', 'info');
        let i = 0;
        const showNext = () => {
            if (i >= this.sequence.length) {
                // Done showing, player's turn
                setTimeout(() => {
                    this.sequencePhase = 'input';
                    this.playerSequence = [];
                    this.showToast('Your turn! Repeat the sequence!', 'info');
                }, 500);
                return;
            }

            const zone = this.sequence[i];
            this.activateLight(zone, Date.now());
            i++;

            setTimeout(showNext, (this.stageConfig.lightDuration || 600) + 300);
        };
        showNext();
    }

    // --- COLOR MATCH MODE (Stage 4) ---
    startColorMatchMode() {
        this.scheduleColorMatch();
    }

    scheduleColorMatch() {
        if (this.gameStatus !== 'playing') return;

        const minInterval = this.stageConfig.minLightInterval || 1200;
        const maxInterval = this.stageConfig.maxLightInterval || 2000;
        const delay = minInterval + Math.random() * (maxInterval - minInterval);

        this.lightTimer = setTimeout(() => {
            this.activateColorMatch();
            this.scheduleColorMatch();
        }, delay);
    }

    activateColorMatch() {
        if (!this.isHost()) return;

        const colors = this.stageConfig.matchColors || ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3'];
        const occupiedZones = Object.keys(this.zoneAssignments).map(Number);

        // Pick target color
        this.targetColor = colors[Math.floor(Math.random() * colors.length)];

        // Assign random colors to zones (one will match)
        this.zoneColors = {};
        const matchZone = occupiedZones[Math.floor(Math.random() * occupiedZones.length)];

        occupiedZones.forEach(zone => {
            if (zone === matchZone) {
                this.zoneColors[zone] = this.targetColor;
            } else {
                // Pick different color
                let color;
                do {
                    color = colors[Math.floor(Math.random() * colors.length)];
                } while (color === this.targetColor && colors.length > 1);
                this.zoneColors[zone] = color;
            }
        });

        // Broadcast
        this.sendData({
            type: 'color-match',
            targetColor: this.targetColor,
            zoneColors: this.zoneColors,
            timestamp: Date.now()
        });

        this.showColorMatch();
    }

    showColorMatch() {
        // Show target color in center
        const targetDisplay = document.getElementById('targetColorDisplay');
        if (targetDisplay) {
            targetDisplay.style.background = this.targetColor;
            targetDisplay.classList.remove('hidden');
        }

        // Light up zones with their colors
        Object.entries(this.zoneColors).forEach(([zone, color]) => {
            const lightEl = document.getElementById(`light-${zone}`);
            if (lightEl) {
                lightEl.classList.add('active');
                lightEl.style.background = color;
            }
            this.activeLights.push(parseInt(zone));
        });

        // Auto-clear after duration
        setTimeout(() => {
            this.clearZoneColors();
            this.activeLights.forEach(z => this.deactivateLight(z));
            this.activeLights = [];
        }, this.stageConfig.lightDuration || 1500);
    }

    // --- HOT POTATO MODE (Stage 5) ---
    startHotPotatoMode() {
        this.scheduleHotPotato();
    }

    scheduleHotPotato() {
        if (this.gameStatus !== 'playing') return;

        const occupiedZones = Object.keys(this.zoneAssignments).map(Number);
        if (occupiedZones.length === 0) return;

        // Bounce around randomly
        const bounces = 3 + Math.floor(Math.random() * 5);
        let currentZone = occupiedZones[Math.floor(Math.random() * occupiedZones.length)];
        let bounceCount = 0;

        const doBounce = () => {
            if (bounceCount >= bounces || this.gameStatus !== 'playing') {
                // Stop here - player must click
                this.activeLight = currentZone;
                this.lightActivatedTime = Date.now();

                this.sendData({
                    type: 'hot-potato-stop',
                    zone: currentZone,
                    timestamp: Date.now()
                });

                // Auto-deactivate after stop duration
                setTimeout(() => {
                    if (this.activeLight === currentZone) {
                        this.deactivateLight(currentZone);
                        // Schedule next potato
                        setTimeout(() => this.scheduleHotPotato(), 500);
                    }
                }, this.stageConfig.stopDuration || 800);
                return;
            }

            // Show light briefly
            this.sendData({
                type: 'hot-potato-bounce',
                zone: currentZone,
                timestamp: Date.now()
            });

            const lightEl = document.getElementById(`light-${currentZone}`);
            if (lightEl) lightEl.classList.add('active');

            setTimeout(() => {
                if (lightEl) lightEl.classList.remove('active');
                // Move to different zone
                let nextZone;
                do {
                    nextZone = occupiedZones[Math.floor(Math.random() * occupiedZones.length)];
                } while (nextZone === currentZone && occupiedZones.length > 1);
                currentZone = nextZone;
                bounceCount++;
                doBounce();
            }, this.stageConfig.bounceSpeed || 300);
        };

        doBounce();
    }

    // --- COMBO MODE (Stage 7) ---
    startComboMode() {
        const baseSize = this.stageConfig.comboSize || 2;
        const growth = this.stageConfig.comboGrowth || 1;
        const size = Math.min(4, baseSize + Math.floor((this.currentRound - 1) * growth));

        const occupiedZones = Object.keys(this.zoneAssignments).map(Number);

        // Generate combo sequence (all different zones)
        this.comboSequence = [];
        const available = [...occupiedZones];
        for (let i = 0; i < size && available.length > 0; i++) {
            const idx = Math.floor(Math.random() * available.length);
            this.comboSequence.push(available[idx]);
            available.splice(idx, 1);
        }
        this.comboIndex = 0;

        // Broadcast and light up all at once
        this.sendData({
            type: 'combo-start',
            sequence: this.comboSequence,
            timestamp: Date.now()
        });

        this.showCombo();
    }

    showCombo() {
        this.activeLights = [...this.comboSequence];
        this.comboSequence.forEach((zone, i) => {
            const lightEl = document.getElementById(`light-${zone}`);
            if (lightEl) {
                lightEl.classList.add('active');
                // Show order number
                lightEl.setAttribute('data-order', i + 1);
            }
        });

        // Auto-clear after duration
        setTimeout(() => {
            if (this.comboSequence.length > 0) {
                this.comboSequence.forEach(z => this.deactivateLight(z));
                this.comboSequence = [];
                this.activeLights = [];
                // Start next combo
                setTimeout(() => this.startComboMode(), 1000);
            }
        }, this.stageConfig.lightDuration || 3000);
    }

    // --- BOSS MODE (Stage 10) ---
    startBossMode() {
        this.scheduleBossPattern();
    }

    scheduleBossPattern() {
        if (this.gameStatus !== 'playing') return;

        const minInterval = this.stageConfig.minLightInterval || 600;
        const maxInterval = this.stageConfig.maxLightInterval || 1500;
        const delay = minInterval + Math.random() * (maxInterval - minInterval);

        this.lightTimer = setTimeout(() => {
            const pattern = Math.random();

            if (pattern < 0.3 && this.stageConfig.multiLight) {
                // Multi-light
                this.activateMultipleLights();
            } else if (pattern < 0.5 && this.stageConfig.movingLight) {
                // Moving light
                this.activateMovingLight();
            } else {
                // Normal light
                this.activateRandomLight();
            }

            this.scheduleBossPattern();
        }, delay);
    }

    activateMultipleLights() {
        const occupiedZones = Object.keys(this.zoneAssignments).map(Number);
        const count = Math.min(occupiedZones.length, 2 + Math.floor(Math.random() * 2));

        const selected = [];
        const available = [...occupiedZones];
        for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * available.length);
            selected.push(available[idx]);
            available.splice(idx, 1);
        }

        this.sendData({
            type: 'multi-light',
            zones: selected,
            timestamp: Date.now()
        });

        selected.forEach(zone => {
            this.activeLights.push(zone);
            const lightEl = document.getElementById(`light-${zone}`);
            if (lightEl) lightEl.classList.add('active');
        });

        this.activeLight = selected[0]; // First one counts
        this.lightActivatedTime = Date.now();

        setTimeout(() => {
            selected.forEach(z => this.deactivateLight(z));
        }, this.stageConfig.lightDuration || 1200);
    }

    activateMovingLight() {
        const occupiedZones = Object.keys(this.zoneAssignments).map(Number);
        let zone = occupiedZones[Math.floor(Math.random() * occupiedZones.length)];

        this.sendData({
            type: 'moving-light',
            startZone: zone,
            timestamp: Date.now()
        });

        this.activeLight = zone;
        this.lightActivatedTime = Date.now();

        const lightEl = document.getElementById(`light-${zone}`);
        if (lightEl) lightEl.classList.add('active');

        // Move to different zone after short delay
        setTimeout(() => {
            if (this.activeLight === zone && this.gameStatus === 'playing') {
                this.deactivateLight(zone);

                // Move to new zone
                let newZone;
                do {
                    newZone = occupiedZones[Math.floor(Math.random() * occupiedZones.length)];
                } while (newZone === zone && occupiedZones.length > 1);

                this.activeLight = newZone;
                this.lightActivatedTime = Date.now();

                const newLightEl = document.getElementById(`light-${newZone}`);
                if (newLightEl) newLightEl.classList.add('active');

                this.sendData({
                    type: 'light-move',
                    zone: newZone,
                    timestamp: Date.now()
                });

                setTimeout(() => {
                    this.deactivateLight(newZone);
                }, (this.stageConfig.lightDuration || 1200) / 2);
            }
        }, (this.stageConfig.lightDuration || 1200) / 2);
    }

    // ============================================
    // REACTION HANDLING
    // ============================================

    handleZoneClick(zone) {
        if (this.gameStatus !== 'playing') return;

        const myZone = this.playerZones.get(this.username);

        // Handle based on game mode
        switch (this.stageConfig.mode) {
            case 'sequence':
                this.handleSequenceClick(zone);
                return;
            case 'colorMatch':
                this.handleColorMatchClick(zone, myZone);
                return;
            case 'reverse':
                this.handleReverseClick(zone, myZone);
                return;
            case 'combo':
                this.handleComboClick(zone);
                return;
            default:
                // Classic and other modes
                break;
        }

        // Standard zone check
        if (myZone !== zone) {
            this.showToast('Not your zone!', 'error');
            return;
        }

        if (this.activeLight !== zone) {
            // Too early - penalty
            const penalty = this.stageConfig.penalty || 50;
            this.showToast(`Too early! -${penalty} points`, 'error');
            this.updateScore(this.username, -penalty);
            return;
        }

        // Calculate reaction time
        const reactionTime = Date.now() - this.lightActivatedTime;

        // Broadcast reaction via DataChannel
        this.sendData({
            type: 'zone-reaction',
            zone: zone,
            reactionTime: reactionTime,
            timestamp: Date.now()
        });

        // Handle locally
        this.handleZoneReaction(this.username, zone, reactionTime);
    }

    // --- MODE-SPECIFIC CLICK HANDLERS ---

    handleSequenceClick(zone) {
        if (this.sequencePhase !== 'input') {
            this.showToast('Wait for your turn!', 'error');
            return;
        }

        this.playerSequence.push(zone);
        const idx = this.playerSequence.length - 1;

        // Flash the zone briefly
        const lightEl = document.getElementById(`light-${zone}`);
        if (lightEl) {
            lightEl.classList.add('active');
            setTimeout(() => lightEl.classList.remove('active'), 200);
        }

        if (this.sequence[idx] === zone) {
            // Correct!
            if (this.playerSequence.length === this.sequence.length) {
                // Completed sequence!
                const points = this.stageConfig.baseScore || 150;
                this.updateScore(this.username, points);
                this.showToast(`🎉 Sequence complete! +${points}`, 'success');
                this.sequence = [];
                this.playerSequence = [];
            }
        } else {
            // Wrong!
            const penalty = this.stageConfig.penalty || 100;
            this.updateScore(this.username, -penalty);
            this.showToast(`❌ Wrong! -${penalty}`, 'error');
            this.sequence = [];
            this.playerSequence = [];
        }
    }

    handleColorMatchClick(zone, myZone) {
        if (myZone !== zone) {
            this.showToast('Not your zone!', 'error');
            return;
        }

        if (!this.zoneColors[zone] || !this.targetColor) {
            const penalty = this.stageConfig.penalty || 80;
            this.showToast(`Too early! -${penalty}`, 'error');
            this.updateScore(this.username, -penalty);
            return;
        }

        if (this.zoneColors[zone] === this.targetColor) {
            // Correct color match!
            const reactionTime = Date.now() - this.lightActivatedTime;
            const baseScore = this.stageConfig.baseScore || 120;
            const timeBonus = this.stageConfig.timeBonus ? Math.max(0, 50 - Math.floor(reactionTime / 20)) : 0;
            const points = baseScore + timeBonus;

            this.updateScore(this.username, points);
            this.showToast(`🎨 Color match! +${points}`, 'success');
            this.clearZoneColors();
        } else {
            // Wrong color!
            const penalty = this.stageConfig.penalty || 80;
            this.updateScore(this.username, -penalty);
            this.showToast(`❌ Wrong color! -${penalty}`, 'error');
        }
    }

    handleReverseClick(zone, myZone) {
        // In reverse mode: click OTHER zones, NOT your own
        if (zone === myZone) {
            // Clicked own zone - penalty!
            if (this.activeLight === zone) {
                const penalty = this.stageConfig.penalty || 100;
                this.updateScore(this.username, -penalty);
                this.showToast(`🔄 Don't click YOUR zone! -${penalty}`, 'error');
            }
            return;
        }

        // Clicked other zone
        if (this.activeLight === zone) {
            // Correct! Other zone was lit
            const reactionTime = Date.now() - this.lightActivatedTime;
            const baseScore = this.stageConfig.baseScore || 100;
            const timeBonus = this.stageConfig.timeBonus ? Math.max(0, 100 - Math.floor(reactionTime / 10)) : 0;
            const points = baseScore + timeBonus;

            this.deactivateLight(zone);
            this.updateScore(this.username, points);
            this.showToast(`🔄 Correct! +${points}`, 'success');
        }
    }

    handleComboClick(zone) {
        if (this.comboSequence.length === 0) return;

        const expectedZone = this.comboSequence[this.comboIndex];

        if (zone === expectedZone) {
            // Correct in sequence
            this.deactivateLight(zone);
            this.comboIndex++;

            const baseScore = this.stageConfig.baseScore || 50;
            const multiplier = Math.pow(this.stageConfig.comboMultiplier || 1.5, this.comboIndex - 1);
            const points = Math.floor(baseScore * multiplier);

            this.updateScore(this.username, points);

            if (this.comboIndex >= this.comboSequence.length) {
                // Completed combo!
                this.showToast(`🔗 Combo complete! +${points}`, 'success');
                this.comboSequence = [];
                this.comboIndex = 0;
            } else {
                this.showToast(`+${points} (${this.comboIndex}/${this.comboSequence.length})`, 'info');
            }
        } else {
            // Wrong order - penalty
            const penalty = this.stageConfig.penalty || 50;
            this.updateScore(this.username, -penalty);
            this.showToast(`❌ Wrong order! -${penalty}`, 'error');

            // Clear combo
            this.comboSequence.forEach(z => this.deactivateLight(z));
            this.comboSequence = [];
            this.comboIndex = 0;
        }
    }

    handleZoneReaction(playerId, zone, reactionTime) {
        const playerZone = this.playerZones.get(playerId);
        if (playerZone !== zone) return;

        // Deactivate light
        this.deactivateLight(zone);

        // Calculate score using stage config
        const baseScore = this.stageConfig.baseScore || 100;
        const timeBonus = this.stageConfig.timeBonus ? Math.max(0, 100 - Math.floor(reactionTime / 10)) : 0;
        const points = baseScore + timeBonus;

        // Update stats
        this.gameStats.reactions.push(reactionTime);
        this.gameStats.totalHits++;
        this.gameStats.fastestReaction = Math.min(this.gameStats.fastestReaction, reactionTime);
        this.gameStats.avgReaction = this.gameStats.reactions.reduce((a, b) => a + b, 0) / this.gameStats.reactions.length;

        // Update score
        this.updateScore(playerId, points);

        if (playerId === this.username) {
            this.showToast(`${reactionTime}ms - +${points} points!`, 'success');
        } else {
            this.showToast(`${playerId}: ${reactionTime}ms`, 'info');
        }

        this.updateGameStats();
        console.log(`[Reactor] ${playerId} reacted in ${reactionTime}ms - +${points} points`);
    }

    updateScore(playerId, delta) {
        const currentScore = this.playerScores.get(playerId) || 0;
        const newScore = Math.max(0, currentScore + delta); // Don't go below 0
        this.playerScores.set(playerId, newScore);

        // Broadcast score update
        this.sendData({
            type: 'score-update',
            playerId: playerId,
            score: newScore,
            delta: delta,
            timestamp: Date.now()
        });

        this.updateZoneDisplays();
        this.updateLeaderboard();
    }

    handleScoreUpdate(playerId, score, delta) {
        this.playerScores.set(playerId, score);
        this.updateZoneDisplays();
        this.updateLeaderboard();
    }

    // ============================================
    // ZONE ASSIGNMENTS
    // ============================================

    broadcastZoneAssignments() {
        this.sendData({
            type: 'zone-assignments',
            assignments: this.zoneAssignments,
            timestamp: Date.now()
        });
    }

    handleZoneAssignments(assignments) {
        this.zoneAssignments = assignments;

        // Update player zones
        for (const [zone, playerId] of Object.entries(assignments)) {
            this.playerZones.set(playerId, parseInt(zone));
        }

        this.updateZoneDisplays();
    }

    // ============================================
    // UI UPDATES
    // ============================================

    updateZoneDisplays() {
        console.log('[Reactor] Updating zone displays. Assignments:', this.zoneAssignments);

        for (let zone = 0; zone < GAME_CONFIG.MAX_PLAYERS; zone++) {
            const playerId = this.zoneAssignments[zone];
            const playerEl = document.getElementById(`player-${zone}`);
            const scoreEl = document.getElementById(`score-${zone}`);
            const zoneEl = document.getElementById(`zone-${zone}`);

            console.log(`[Reactor] Zone ${zone}: playerId=${playerId}, zoneEl exists=${!!zoneEl}`);

            if (playerId) {
                // Show zone when player is assigned
                if (zoneEl) {
                    zoneEl.classList.remove('hidden');
                    console.log(`[Reactor] Showing zone ${zone} for player ${playerId}`);
                }

                const score = this.playerScores.get(playerId) || 0;
                const hasP2P = playerId === this.username || this.connectedPeers.has(playerId);

                if (playerEl) {
                    const p2pIcon = hasP2P ? '🔗' : '⏳';
                    playerEl.innerHTML = `${playerId}${playerId !== this.username ? ` ${p2pIcon}` : ' (You)'}`;
                }
                if (scoreEl) scoreEl.textContent = score;
            } else {
                // Hide zone when no player is assigned
                if (zoneEl) {
                    zoneEl.classList.add('hidden');
                    console.log(`[Reactor] Hiding zone ${zone} (no player)`);
                }
                if (playerEl) playerEl.textContent = '';
                if (scoreEl) scoreEl.textContent = '0';
            }
        }
    }

    updateLeaderboard() {
        const container = document.getElementById('leaderboard');
        if (!container) return;

        const sorted = Array.from(this.playerScores.entries())
            .sort((a, b) => b[1] - a[1]);

        container.innerHTML = sorted.map(([playerId, score], index) => {
            const zone = this.playerZones.get(playerId);
            const color = zone !== undefined ? ZONE_COLORS[zone] : '#667eea';
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';

            return `
                <div class="leaderboard-item">
                    <span class="rank">${medal || (index + 1)}</span>
                    <div class="player-color" style="background: ${color}"></div>
                    <span class="player-name">${playerId}${playerId === this.username ? ' (You)' : ''}</span>
                    <span class="player-score">${score}</span>
                </div>
            `;
        }).join('');
    }

    updateGameStats() {
        const avgEl = document.getElementById('avgReaction');
        const fastEl = document.getElementById('fastestHit');
        const roundsEl = document.getElementById('totalRounds');

        if (avgEl) {
            avgEl.textContent = this.gameStats.reactions.length > 0
                ? `${Math.round(this.gameStats.avgReaction)} ms`
                : '-- ms';
        }
        if (fastEl) {
            fastEl.textContent = this.gameStats.fastestReaction < Infinity
                ? `${this.gameStats.fastestReaction} ms`
                : '-- ms';
        }
        if (roundsEl) {
            roundsEl.textContent = this.currentRound;
        }
    }

    updateRoundInfo() {
        const el = document.getElementById('roundInfo');
        const totalRounds = this.stageConfig.totalRounds || 3;
        if (el) {
            el.textContent = `Round: ${this.currentRound}/${totalRounds}`;
        }
    }

    startRoundCountdown() {
        this.updateRoundInfo();

        if (this.countdownInterval) clearInterval(this.countdownInterval);

        const roundDuration = this.stageConfig.roundDuration || 30;

        this.countdownInterval = setInterval(() => {
            if (this.roundStartTime === 0) {
                clearInterval(this.countdownInterval);
                return;
            }

            const elapsed = (Date.now() - this.roundStartTime) / 1000;
            const remaining = Math.max(0, roundDuration - elapsed);

            const timeEl = document.getElementById('timeRemaining');
            if (timeEl) {
                timeEl.textContent = `Time: ${Math.ceil(remaining)}s`;
            }

            if (remaining <= 0) {
                clearInterval(this.countdownInterval);
            }
        }, 100);
    }

    updateGameMessage(customMessage = null) {
        const el = document.getElementById('gameMessage');
        if (!el) return;

        if (customMessage) {
            el.textContent = customMessage;
            return;
        }

        const playerCount = this.playerZones.size;

        // Update start button visibility based on current host status
        const startBtn = document.getElementById('startButton');
        if (startBtn && this.gameStatus === 'waiting') {
            if (this.isHost()) {
                startBtn.classList.remove('hidden');
            } else {
                startBtn.classList.add('hidden');
            }
        }

        if (this.gameStatus === 'playing') {
            el.textContent = 'Click your zone when it lights up!';
        } else if (this.gameStatus === 'finished') {
            el.textContent = 'Game Over!';
        } else if (playerCount > 0) {
            el.textContent = this.isHost()
                ? `${playerCount} player(s) - Click Start Game`
                : 'Waiting for host to start...';
        } else {
            el.textContent = 'Waiting for players...';
        }
    }

    updateConnectionIndicator(connected) {
        const el = document.getElementById('connectionIndicator');
        if (!el) return;

        if (connected) {
            el.classList.remove('disconnected');
            el.classList.add('connected');
        } else {
            el.classList.remove('connected');
            el.classList.add('disconnected');
        }
    }

    clearTimers() {
        if (this.roundTimer) clearTimeout(this.roundTimer);
        if (this.lightTimer) clearTimeout(this.lightTimer);
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.roundTimer = null;
        this.lightTimer = null;
        this.countdownInterval = null;
    }
}

// ============================================
// INITIALIZATION
// ============================================

let reactorGame = null;
let isConnecting = false; // Prevent multiple connect calls

// Global functions for HTML onclick handlers - delegate to game instance
window.handleZoneClick = function(zone) {
    if (reactorGame) reactorGame.handleZoneClick(zone);
};

window.startGame = function() {
    if (reactorGame) reactorGame.startGame();
};

// Stage selection global functions
window.selectStage = function(stageId) {
    if (reactorGame) reactorGame.selectStage(stageId);
};

window.showStageModal = function() {
    if (reactorGame) reactorGame.showStageModal();
};

window.closeStageModal = function() {
    if (reactorGame) reactorGame.closeStageModal();
};

// ============================================
// INITIALIZATION - Same pattern as whiteboard-client.js
// ============================================

async function connectReactor(username, channel, password) {
    // Prevent multiple simultaneous connection attempts
    if (isConnecting) {
        console.warn('[Reactor] Connection already in progress, ignoring duplicate call');
        return;
    }

    if (reactorGame && reactorGame.connected) {
        console.warn('[Reactor] Already connected, ignoring connect call');
        return;
    }

    isConnecting = true;

    try {
        // Create game instance
        reactorGame = new ReactorGame();
        window.reactorGame = reactorGame;

        // Initialize
        await reactorGame.initialize();

        // Connect
        await reactorGame.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });

        // Start
        reactorGame.start();

        // Update URL hash for sharing
        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' + channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }

        // Show share button
        try {
            if (typeof MiniGameUtils !== 'undefined') {
                MiniGameUtils.toggleShareButton(true);
            }
        } catch (e) { /* ignore */ }

        console.log('[Reactor] Connected and ready!');
    } catch (error) {
        console.error('[Reactor] Connection failed:', error);
        alert('Failed to connect: ' + error.message);
        reactorGame = null;
    } finally {
        isConnecting = false;
    }
}

// Initialize connection modal
function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'reactor_',
        channelPrefix: 'reactor-',
        title: '⚡ Join 4-Player Reactor',
        collapsedTitle: '⚡ Reactor',
        onConnect: function(username, channel, password) {
            connectReactor(username, channel, password);
        }
    });
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Reactor] Page loaded');

    // Initialize connection modal
    initializeConnectionModal();

    // Process shared link and setup auto-connect using centralized utility
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'Reactor',
            storagePrefix: 'reactor_',
            connectCallback: async function() {
                console.log('[Reactor] Auto-connect triggered');
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectReactor(username, channel, password);
                } else {
                    console.warn('[Reactor] Auto-connect skipped: missing username or channel');
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

function disconnect() {
    if (reactorGame) {
        reactorGame.disconnect();
    }

    if (window.ConnectionModal && typeof window.ConnectionModal.show === 'function') {
        window.ConnectionModal.show();
    }
    document.getElementById('gameContainer').classList.add('hidden');

    try {
        if (typeof MiniGameUtils !== 'undefined') {
            MiniGameUtils.toggleShareButton(false);
        }
    } catch (e) { /* ignore */ }
}
