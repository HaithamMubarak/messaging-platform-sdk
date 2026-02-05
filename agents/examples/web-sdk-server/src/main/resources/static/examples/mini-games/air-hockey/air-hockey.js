/**
 * Air Hockey Game
 * 2-4 Player multiplayer air hockey using Messaging Platform SDK with BaseGame
 * Features:
 * - Real-time paddle sync via DataChannel
 * - Physics-based puck movement
 * - 2-4 player support (goals on each side)
 * - Score tracking and win conditions
 */

// ============================================
// DEBUG UTILITIES (for iPhone Safari testing)
// ============================================

let debugLogCount = 0;
const MAX_DEBUG_LOGS = 100;

function debugLog(message, data = null) {
    const debugLogEl = document.getElementById('debugLog');
    if (!debugLogEl) return;

    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.style.borderBottom = '1px solid #333';
    logEntry.style.padding = '2px 0';
    logEntry.innerHTML = `[${timestamp}] ${message}${data ? '<br><pre style="margin:2px 0;color:#ff0;">' + JSON.stringify(data, null, 1) + '</pre>' : ''}`;

    debugLogEl.insertBefore(logEntry, debugLogEl.firstChild);

    debugLogCount++;
    if (debugLogCount > MAX_DEBUG_LOGS) {
        debugLogEl.removeChild(debugLogEl.lastChild);
    }

    // Also log to console
    console.log(`[AirHockey Debug] ${message}`, data || '');
}

// Override console.error to also show in debug console
const originalConsoleError = console.error;
console.error = function(...args) {
    debugLog(`❌ ERROR: ${args.join(' ')}`);
    originalConsoleError.apply(console, args);
};

// ============================================
// GAME CONFIGURATION
// ============================================

const GAME_CONFIG = {
    NAME: 'air-hockey',
    VERSION: '1.0.0',

    // Canvas
    CANVAS_WIDTH: 1000,
    CANVAS_HEIGHT: 600,

    // Puck
    PUCK_RADIUS: 15,
    PUCK_MAX_SPEED: 30,             // Increased from 20 for faster, more exciting gameplay
    PUCK_FRICTION: 0.995,

    // Paddle
    PADDLE_RADIUS: 30,
    PADDLE_MASS: 5,

    // Paddle Physics (PC Mouse Control)
    PADDLE_MAX_SPEED: 50,           // Increased from 35 for faster paddle response and tracking
    PADDLE_ACCELERATION: 4,       // Base acceleration multiplier (increased from 1.5 for quicker acceleration)
    PADDLE_FRICTION: 0.60,          // Friction when no input (0-1, higher = less friction, reduced from 0.88 to stop faster)
    PADDLE_DISTANCE_SPEEDUP: 0.15,  // Speed boost per unit of distance from target (reduced from 0.06 for smoother stop)

    // Touch Physics (Mobile Controls - Direction & Speed Based)
    TOUCH_INFLUENCE_RADIUS: 150,    // Distance from paddle to touch that affects movement
    TOUCH_SPEED_MULTIPLIER: 0.15,   // How much touch movement affects paddle velocity
    TOUCH_MAX_INFLUENCE: 20,        // Maximum speed from touch input
    TOUCH_DEAD_ZONE: 5,             // Minimum touch movement to register (prevents jitter)

    // Goals
    GOAL_WIDTH: 150,

    // Game
    DEFAULT_WIN_SCORE: 5,
    SYNC_INTERVAL: 16, // ~60fps for network updates
    HOST_IDLE_TIMEOUT: 5000, // ms of inactivity before host is considered idle
};

// Player colors and positions - Team-based system
// Positions: left/right = team side, then vertical position (top/center/bottom)
const PLAYER_CONFIGS = [
    // Team Left (1-3 players)
    { color: '#3b82f6', name: 'Blue', position: 'left-center', goalSide: 'left', team: 'left' },
    { color: '#10b981', name: 'Green', position: 'left-top', goalSide: 'left', team: 'left' },
    { color: '#06b6d4', name: 'Cyan', position: 'left-bottom', goalSide: 'left', team: 'left' },

    // Team Right (1-3 players)
    { color: '#ef4444', name: 'Red', position: 'right-center', goalSide: 'right', team: 'right' },
    { color: '#f59e0b', name: 'Yellow', position: 'right-top', goalSide: 'right', team: 'right' },
    { color: '#ec4899', name: 'Pink', position: 'right-bottom', goalSide: 'right', team: 'right' },
];

// ============================================
// AIR HOCKEY GAME CLASS
// ============================================

class AirHockeyGame extends AgentInteractionBase {
    constructor() {
        super({
            storagePrefix: 'airhockey',
            customType: 'air-hockey',
            autoCreateDataChannel: true,
            dataChannelName: 'airhockey-data',
            dataChannelOptions: {
                ordered: false,
                maxRetransmits: 0
            }
        });

        // Canvas
        this.canvas = null;
        this.ctx = null;

        // Game state
        this.gameStatus = 'waiting'; // waiting, playing, finished
        this.winScore = GAME_CONFIG.DEFAULT_WIN_SCORE;

        // Players
        this.players = new Map(); // playerId -> { position, color, score, paddle }
        this.playerOrder = []; // Order of joining
        this.connectedPeers = new Set();

        // Puck state
        this.puck = {
            x: GAME_CONFIG.CANVAS_WIDTH / 2,
            y: GAME_CONFIG.CANVAS_HEIGHT / 2,
            vx: 0,
            vy: 0,
            radius: GAME_CONFIG.PUCK_RADIUS
        };

        // My paddle
        this.myPaddle = {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            lastX: 0,
            lastY: 0
        };

        // Mouse position (null = no mouse input yet, prevents paddle jumping to origin on mobile)
        this.mouseX = null;
        this.mouseY = null;

        // Touch input state (physics-based control)
        this.input = {
            isTouching: false,
            touchStartX: 0,
            touchStartY: 0,
            touchCurrentX: 0,
            touchCurrentY: 0,
            touchPrevX: 0,
            touchPrevY: 0,
            lastTouchTime: 0,
            touchVelocityX: 0,
            touchVelocityY: 0
        };

        // Timers
        this.gameLoopId = null;
        this.lastSyncTime = 0;
        this.lastFrameTime = 0;

        // Last sent paddle position (for delta checking)
        this.lastSentPaddle = { x: 0, y: 0 };

        // Goal detection flag (prevent multiple detections)
        this.goalScored = false;

        // Idle detection for host
        this.lastHostActivity = Date.now();
        this.hostIdleCheckInterval = null;
        this.isHostIdle = false;

        // Control panel
        this.controlPanel = null;
    }

    async onInitialize() {
        console.log('[AirHockey] Initializing...');

        // Log device and browser information for debugging
        const ua = navigator.userAgent;
        const deviceInfo = {
            userAgent: ua,
            platform: navigator.platform,
            isMobile: /iPhone|iPad|iPod|Android/i.test(ua),
            isIOS: /iPhone|iPad|iPod/i.test(ua),
            isAndroid: /Android/i.test(ua),
            isSafari: /Safari/i.test(ua) && !/Chrome/i.test(ua),
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0
        };

        debugLog('🔍 Device Info', deviceInfo);
        console.log('[AirHockey] Device Info:', deviceInfo);

        // Setup canvas
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Set canvas internal dimensions (game logic uses these)
        this.canvas.width = GAME_CONFIG.CANVAS_WIDTH;
        this.canvas.height = GAME_CONFIG.CANVAS_HEIGHT;

        // Portrait mode flag
        this.isPortraitMode = false;

        // Listen for orientation/resize changes
        window.addEventListener('resize', () => this.handleResize());
        window.addEventListener('orientationchange', () => {
            debugLog('📱 Orientation changed');
            setTimeout(() => this.handleResize(), 150);
        });

        // Setup input handlers
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });

        debugLog('✅ Touch handlers registered');

        // Setup UI
        this.setupUI();
    }

    setupResponsiveCanvas() {
        const isMobile = window.innerWidth <= 768;
        const isPortrait = window.innerHeight > window.innerWidth;

        // Get game arena dimensions
        const gameArena = document.querySelector('.game-arena');
        if (!gameArena) return;

        const arenaRect = gameArena.getBoundingClientRect();

        // If arena is not visible yet, skip (will be called again on resize)
        if (arenaRect.width < 50 || arenaRect.height < 50) {
            console.log('[AirHockey] Arena not visible yet, skipping responsive setup');
            return;
        }

        const availableWidth = arenaRect.width - 20;
        const availableHeight = arenaRect.height - 20;

        console.log('[AirHockey] setupResponsiveCanvas:', {
            isMobile, isPortrait, availableWidth, availableHeight
        });

        this.isPortraitMode = isMobile && isPortrait;

        // Reset canvas styles first
        this.canvas.style.transform = '';
        this.canvas.style.width = '';
        this.canvas.style.height = '';
        this.canvas.classList.remove('rotated');
        gameArena.classList.remove('portrait-mode');

        if (this.isPortraitMode) {
            // Portrait mode: rotate canvas 90 degrees
            // After rotation, canvas width becomes height and vice versa
            const rotatedWidth = GAME_CONFIG.CANVAS_HEIGHT;
            const rotatedHeight = GAME_CONFIG.CANVAS_WIDTH;

            const scaleX = availableWidth / rotatedWidth;
            const scaleY = availableHeight / rotatedHeight;
            const scale = Math.min(scaleX, scaleY);

            console.log('[AirHockey] Portrait mode, scale:', scale);

            // Apply rotation and scaling
            this.canvas.style.transform = `rotate(90deg) scale(${scale})`;
            this.canvas.style.transformOrigin = 'center center';
            this.canvas.classList.add('rotated');
            gameArena.classList.add('portrait-mode');
        } else {
            // Landscape or desktop mode
            const scaleX = availableWidth / GAME_CONFIG.CANVAS_WIDTH;
            const scaleY = availableHeight / GAME_CONFIG.CANVAS_HEIGHT;
            const scale = Math.min(scaleX, scaleY, 1);

            console.log('[AirHockey] Landscape mode, scale:', scale);

            if (scale < 1) {
                this.canvas.style.transform = `scale(${scale})`;
                this.canvas.style.transformOrigin = 'center center';
            }
        }
    }

    handleResize() {
        // Debounce resize handling
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = setTimeout(() => {
            this.setupResponsiveCanvas();
        }, 100);
    }

    onConnect(detail) {
        console.log('[AirHockey] Connected:', detail);

        // Hide connection modal and show game
        setTimeout(() => {
            if (window.ConnectionModal) {
                window.ConnectionModal.hide();
            }
            document.getElementById('gameContainer').classList.remove('hidden');

            // Setup responsive canvas after container is visible
            setTimeout(() => {
                this.setupResponsiveCanvas();
            }, 50);
        }, 100);

        // Update room display
        document.getElementById('roomName').textContent = this.channelName;
        this.updateConnectionIndicator(true);

        // Add self
        this.addPlayer(this.username);

        // Check if there are other players already in the channel
        const otherPlayers = this.getConnectedUsers().filter(u => u !== this.username);
        if (otherPlayers.length > 0) {
            // Show loader while establishing DataChannel connections with existing players
            console.log('[AirHockey] Other players present, showing connection loader:', otherPlayers);
            this.showConnectionLoader(`Connecting to ${otherPlayers.length} player${otherPlayers.length > 1 ? 's' : ''}...`);
        }

        // Show waiting room
        this.showWaitingRoom();

        // Update control panel to reflect host status (shows host badge if player is host)
        this.updateControlPanel();

        // Start render loop (always running for smooth visuals)
        this.startRenderLoop();
    }

    onPlayerJoining(detail) {
        console.log('[AirHockey] Player joining:', detail.agentName);

        // Only show joining message if game hasn't started
        if (this.gameStatus !== 'playing') {
            this.showToast(`${detail.agentName} is joining...`, 'info', 2000);
        }

        // Note: Loader is NOT shown here - it shows on the joining player's screen, not existing players
    }

    onPlayerJoin(detail) {
        console.log('[AirHockey] Player joined successfully:', detail.agentName);

        // Hide the connection loader - DataChannel is now open
        this.hideConnectionLoader();

        // Only show join toast if game hasn't started
        if (this.gameStatus !== 'playing') {
            this.showToast(`✅ ${detail.agentName} joined!`, 'success');
        } else {
            // Game is playing - pause it when a new player joins
            console.log('[AirHockey] Player joined during game - pausing game');
            this.showToast(`🎮 ${detail.agentName} joined! Game paused.`, 'info');

            if (this.isHost()) {
                // Pause the game
                this.pauseGameForPlayerJoin();
            }
        }

        this.addPlayer(detail.agentName);
        this.updatePlayersList();
        this.updateScoreBoard();

        // If host, broadcast updated player assignments to all players
        if (this.isHost()) {
            this.broadcastPlayerAssignments();
        }
    }

    broadcastPlayerAssignments() {
        const assignments = [];
        this.players.forEach((player, playerId) => {
            assignments.push({
                playerId: playerId,
                position: player.position,
                color: player.color,
                colorName: player.colorName,
                goalSide: player.goalSide,
                team: player.team,  // Include team field for consistency
                score: player.score
            });
        });

        this.sendData({
            type: 'player-assignments',
            assignments: assignments,
            playerOrder: this.playerOrder
        });
    }

    onPlayerLeave(detail) {
        console.log('[AirHockey] Player left:', detail.agentName);
        this.showToast(`${detail.agentName} left`, 'info');

        this.removePlayer(detail.agentName);
        this.updatePlayersList();
        this.updateScoreBoard();

        // If only one player remains and game is playing, stop the game
        if (this.players.size < 2 && this.gameStatus === 'playing') {
            console.log('[AirHockey] Not enough players, stopping game');
            this.showToast('Not enough players - game stopped', 'warning');
            this.gameStatus = 'waiting';
            this.resetPuck();
        }

        // Host change is handled automatically by BaseGame -> onBecomeHost()
    }

    onBecomeHost() {
        console.log('[AirHockey] Became host - showing start button');

        // Update control panel (control panel handles host indicator)
        this.updateControlPanel();


        // Update host controls visibility
        this.updateHostControls();

        // Always show start button when becoming host (if game not playing)
        const startBtn = document.getElementById('startButton');
        if (startBtn) {
            if (this.gameStatus !== 'playing') {
                startBtn.classList.remove('hidden');
            }
        }

        // Start idle monitoring if game is playing
        if (this.gameStatus === 'playing') {
            this.lastHostActivity = Date.now();
            this.startHostIdleMonitoring();
        }
    }

    onDataChannelOpen(peerId) {
        console.log('[AirHockey] DataChannel open with', peerId);
        this.connectedPeers.add(peerId);
        this.updatePlayersList();

        // If host, send current game state and player assignments
        // Channel is guaranteed to be ready when this event fires
        if (this.isHost()) {
            this.sendPlayerAssignments(peerId);
            if (this.gameStatus === 'playing') {
                this.sendGameState(peerId);
            }
        }
    }

    onDataChannelClose(peerId) {
        console.log('[AirHockey] DataChannel closed with', peerId);
        this.connectedPeers.delete(peerId);
        this.updatePlayersList();
    }

    onDataChannelMessage(peerId, data) {
        switch (data.type) {
            case 'paddle-update':
                this.handlePaddleUpdate(peerId, data);
                break;
            case 'puck-update':
                if (!this.isHost()) {
                    this.puck.x = data.x;
                    this.puck.y = data.y;
                    this.puck.vx = data.vx;
                    this.puck.vy = data.vy;
                    // Reset goal flag when puck is reset to center
                    const centerX = GAME_CONFIG.CANVAS_WIDTH / 2;
                    const centerY = GAME_CONFIG.CANVAS_HEIGHT / 2;
                    if (Math.abs(data.x - centerX) < 50 && Math.abs(data.y - centerY) < 50) {
                        this.goalScored = false;
                    }
                }
                break;
            case 'game-start':
                this.handleGameStart(data);
                break;
            case 'game-end':
                this.handleGameEnd(data);
                break;
            case 'game-pause':
                this.handleGamePause(data);
                break;
            case 'game-pause-player-join':
                this.handleGamePausePlayerJoin(data);
                break;
            case 'game-resume':
                this.handleGameResume(data);
                break;
            case 'game-resume-after-join':
                this.handleGameResumeAfterJoin(data);
                break;
            case 'goal':
                this.handleGoal(data);
                break;
            case 'game-state':
                this.handleGameState(data);
                break;
            case 'settings-change':
                this.handleSettingsChange(data);
                break;
            case 'player-assignments':
                this.handlePlayerAssignments(data);
                break;
            case 'reset-ball':
                this.handleResetBall(data);
                break;
            case 'new-game':
                this.handleNewGame(data);
                break;
        }
    }

    isHostPeer(peerId) {
        return this.playerOrder.length > 0 && this.playerOrder[0] === peerId;
    }

    // ============================================
    // PLAYER MANAGEMENT
    // ============================================

    addPlayer(playerId) {
        if (this.players.has(playerId)) return;
        if (this.players.size >= 6) {
            console.warn('[AirHockey] Max players reached (6)');
            return;
        }

        // Count players on each team
        let leftTeamCount = 0;
        let rightTeamCount = 0;
        const usedPositions = new Set();

        this.players.forEach(p => {
            usedPositions.add(p.position);
            if (p.team === 'left') leftTeamCount++;
            if (p.team === 'right') rightTeamCount++;
        });

        // Balance teams: assign to team with fewer players
        const assignToTeam = (leftTeamCount <= rightTeamCount) ? 'left' : 'right';

        // Find next available position on the assigned team
        let config = null;
        for (let i = 0; i < PLAYER_CONFIGS.length; i++) {
            const candidate = PLAYER_CONFIGS[i];
            if (candidate.team === assignToTeam && !usedPositions.has(candidate.position)) {
                config = candidate;
                break;
            }
        }

        if (!config) {
            console.warn('[AirHockey] No available position for player');
            return;
        }

        const paddle = this.getInitialPaddlePosition(config.position);

        this.players.set(playerId, {
            position: config.position,
            color: config.color,
            colorName: config.name,
            goalSide: config.goalSide,
            team: config.team,
            score: 0,
            paddle: paddle
        });

        if (!this.playerOrder.includes(playerId)) {
            this.playerOrder.push(playerId);
        }
        console.log(`[AirHockey] Player added: ${playerId} as ${config.name} (${config.position}, Team: ${config.team})`);
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        this.connectedPeers.delete(playerId);
        const idx = this.playerOrder.indexOf(playerId);
        if (idx > -1) this.playerOrder.splice(idx, 1);
    }

    sendPlayerAssignments(toPlayer) {
        // Send all player assignments to the joining player
        const assignments = [];
        this.players.forEach((player, playerId) => {
            assignments.push({
                playerId: playerId,
                position: player.position,
                color: player.color,
                colorName: player.colorName,
                goalSide: player.goalSide,
                team: player.team,  // Include team field for consistency
                score: player.score
            });
        });

        this.sendData({
            type: 'player-assignments',
            assignments: assignments,
            playerOrder: this.playerOrder
        }, toPlayer);
    }

    handlePlayerAssignments(data) {
        if (this.isHost()) return; // Host doesn't accept assignments from others

        // Clear and rebuild player list from host's assignments
        const myPlayer = this.players.get(this.username);
        this.players.clear();
        this.playerOrder = data.playerOrder || [];

        data.assignments.forEach(info => {
            const paddle = this.getInitialPaddlePosition(info.position);

            // If this is our own player, preserve the paddle position
            if (info.playerId === this.username && myPlayer) {
                paddle.x = myPlayer.paddle.x;
                paddle.y = myPlayer.paddle.y;
            }

            this.players.set(info.playerId, {
                position: info.position,
                color: info.color,
                colorName: info.colorName,
                goalSide: info.goalSide,
                team: info.team || info.goalSide, // Fallback to goalSide for backward compatibility
                score: info.score || 0,
                paddle: paddle
            });
        });

        this.updatePlayersList();
        this.updateScoreBoard();
        console.log('[AirHockey] Received player assignments:', this.players.size, 'players');
    }

    getInitialPaddlePosition(position) {
        const cx = GAME_CONFIG.CANVAS_WIDTH / 2;
        const cy = GAME_CONFIG.CANVAS_HEIGHT / 2;
        const w = GAME_CONFIG.CANVAS_WIDTH;
        const h = GAME_CONFIG.CANVAS_HEIGHT;
        const offset = 100;
        const verticalSpacing = h / 3;

        switch (position) {
            // Left team positions
            case 'left-center':
                return { x: offset, y: cy, vx: 0, vy: 0 };
            case 'left-top':
                return { x: offset, y: verticalSpacing, vx: 0, vy: 0 };
            case 'left-bottom':
                return { x: offset, y: h - verticalSpacing, vx: 0, vy: 0 };

            // Right team positions
            case 'right-center':
                return { x: w - offset, y: cy, vx: 0, vy: 0 };
            case 'right-top':
                return { x: w - offset, y: verticalSpacing, vx: 0, vy: 0 };
            case 'right-bottom':
                return { x: w - offset, y: h - verticalSpacing, vx: 0, vy: 0 };

            // Legacy positions (backward compatibility)
            case 'left':
                return { x: offset, y: cy, vx: 0, vy: 0 };
            case 'right':
                return { x: w - offset, y: cy, vx: 0, vy: 0 };
            case 'top':
                return { x: cx, y: offset, vx: 0, vy: 0 };
            case 'bottom':
                return { x: cx, y: h - offset, vx: 0, vy: 0 };

            default:
                return { x: cx, y: cy, vx: 0, vy: 0 };
        }
    }

    getMyPlayer() {
        return this.players.get(this.username);
    }

    // ============================================
    // UI SETUP
    // ============================================

    setupUI() {
        // Initialize control panel
        this.initializeControlPanel();

        // Hide the sidebar share button since control panel has its own share button
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) {
            shareBtn.style.display = 'none';
        }

        // Win score selector
        const winScoreSelect = document.getElementById('winScore');
        if (winScoreSelect) {
            winScoreSelect.addEventListener('change', (e) => {
                if (this.isHost()) {
                    this.winScore = parseInt(e.target.value);
                    document.getElementById('winScoreDisplay').textContent = this.winScore;
                    this.sendData({
                        type: 'settings-change',
                        winScore: this.winScore
                    });
                }
            });
        }

        // Fullscreen toggle button (mobile only)
        const fullscreenBtn = document.getElementById('fullscreenToggle');
        if (fullscreenBtn) {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                fullscreenBtn.style.display = 'flex';
            }
        }

        // Lobby share button
        const lobbyShareBtn = document.getElementById('lobbyShareBtn');
        if (lobbyShareBtn) {
            lobbyShareBtn.addEventListener('click', () => {
                if (typeof ShareModal !== 'undefined') {
                    ShareModal.show(this.channelName, this.channelPassword);
                }
            });
        }

        // Initialize host controls visibility
        this.updateHostControls();
    }

    /**
     * Update visibility of host-only controls based on game state
     */
    updateHostControls() {
        console.log('[AirHockey] updateHostControls called:', {
            isHost: this.isHost(),
            gameStatus: this.gameStatus,
            username: this.username,
            playerOrder: this.playerOrder,
            controlPanelExists: !!this.controlPanel,
            controlPanelIsHost: this.controlPanel ? this.controlPanel.config.isHost : 'N/A'
        });

        // Hide sidebar host controls (we're using control panel instead)
        const hostControls = document.getElementById('hostControls');
        if (hostControls) {
            hostControls.style.display = 'none';
        }

        // Update control panel custom buttons visibility
        if (!this.controlPanel) {
            console.warn('[AirHockey] Control panel not initialized!');
            return;
        }

        // Update control panel's host status first
        const isHost = this.isHost();
        this.controlPanel.config.isHost = isHost;

        console.log('[AirHockey] Updated control panel isHost to:', isHost);

        // Find custom buttons in config
        const resetBallBtn = this.controlPanel.config.customButtons.find(btn => btn.id === 'reset-ball');
        const newGameBtn = this.controlPanel.config.customButtons.find(btn => btn.id === 'new-game');

        if (resetBallBtn) {
            // Reset Ball button: show only during active game and if host
            resetBallBtn.visible = isHost && this.gameStatus === 'playing';
            console.log('[AirHockey] Reset Ball button:', {
                isHost: isHost,
                gameStatus: this.gameStatus,
                visible: resetBallBtn.visible
            });
        }

        if (newGameBtn) {
            // New Game button: show only when game is playing or finished and if host
            newGameBtn.visible = isHost && (this.gameStatus === 'playing' || this.gameStatus === 'finished');
            console.log('[AirHockey] New Game button:', {
                isHost: isHost,
                gameStatus: this.gameStatus,
                visible: newGameBtn.visible
            });
        }

        // Update control panel UI to reflect changes
        this.controlPanel.updateUI();

        // Show/hide Pause button based on game state
        // Pause button should only be visible during active game
        const pauseBtn = this.controlPanel.btnPause;
        if (pauseBtn) {
            if (this.gameStatus === 'playing') {
                pauseBtn.style.display = 'flex';
            } else {
                pauseBtn.style.display = 'none';
            }
            console.log('[AirHockey] Pause button display:', pauseBtn.style.display);
        }

        console.log('[AirHockey] Control panel UI updated');
    }

    /**
     * Initialize floating control panel
     */
    initializeControlPanel() {
        if (typeof GameControlPanel === 'undefined') {
            console.warn('[AirHockey] GameControlPanel not loaded');
            return;
        }

        this.controlPanel = new GameControlPanel({
            gameName: 'Air Hockey',
            gameIcon: '🏒',  // Air hockey icon
            agentName: this.username,  // Current player name
            isHost: this.isHost(),
            isPaused: this.isPaused(),
            roomCode: this.channelName,
            roomPassword: this.channelPassword,  // For share modal
            shareUrl: window.location.href,
            startCollapsed: false,  // Start expanded in lobby, will collapse when game starts

            // Custom buttons for host-only controls
            customButtons: [
                {
                    id: 'reset-ball',
                    icon: '🏒',
                    label: 'Reset Ball',
                    onClick: () => {
                        if (this.isHost()) {
                            this.resetBallToCenter();
                        }
                    },
                    visible: false,  // Will be updated based on game state
                    hostOnly: true,
                    class: 'btn-warning-style'
                },
                {
                    id: 'new-game',
                    icon: '🆕',
                    label: 'New Game',
                    onClick: () => {
                        if (this.isHost()) {
                            this.startNewGame();
                        }
                    },
                    visible: false,  // Will be updated based on game state
                    hostOnly: true,
                    class: 'btn-primary-style'
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
                // Share modal is handled by control panel directly
                // This callback is optional for additional actions
            },

            onLeave: () => {
                // Use the same disconnect function as the existing leave button
                if (typeof disconnect === 'function') {
                    disconnect();
                } else {
                    // Fallback
                    if (this.gameLoopId) {
                        cancelAnimationFrame(this.gameLoopId);
                    }
                    if (this.agent) {
                        this.agent.disconnect();
                    }
                    if (window.ConnectionModal) {
                        ConnectionModal.show();
                    }
                    document.getElementById('gameContainer').classList.add('hidden');
                }
            }
        });


        // Initial update to ensure UI reflects current state
        this.updateControlPanel();

        // Initial update of host controls after panel is created
        this.updateHostControls();
    }

    /**
     * Update control panel state
     */
    updateControlPanel() {
        if (this.controlPanel) {
            this.controlPanel.updateState({
                isHost: this.isHost(),
                isPaused: this.isPaused(),
                roomCode: this.channelName,
                roomPassword: this.channelPassword,
                agentName: this.username
            });

            // Force update host controls after state change
            this.updateHostControls();
        }
    }

    /**
     * Pause game from control panel (user-initiated)
     */
    pauseGameFromControlPanel() {
        if (!this.isHost() || this.gameStatus !== 'playing') return;

        console.log('[AirHockey] Pausing game (control panel)');
        this.pauseGame('⏸️ Game Paused by Host');

        // Broadcast pause to all players
        this.sendData({
            type: 'game-pause',
            reason: 'Host paused the game'
        });

        // Stop puck movement
        if (this.isHost()) {
            this.puck.vx = 0;
            this.puck.vy = 0;
        }
    }

    /**
     * Resume game from control panel (user-initiated)
     */
    resumeGameFromControlPanel() {
        if (!this.isHost() || this.gameStatus !== 'playing') return;

        console.log('[AirHockey] Resuming game (control panel)');
        this.resumeGame();

        // Broadcast resume to all players
        this.sendData({
            type: 'game-resume'
        });
    }

    showWaitingRoom() {
        this.updatePlayersList();
        this.updateScoreBoard();

        // Only show waiting room UI if game is not playing
        if (this.gameStatus === 'playing') {
            console.log('[AirHockey] Game already playing, skipping waiting room UI');
            return;
        }

        // Share button is in control panel, not needed in sidebar

        const controlPanel = document.querySelector('.control-panel');
        if (controlPanel) controlPanel.classList.remove('hidden');

        const startBtn = document.getElementById('startButton');
        const settingsDiv = document.querySelector('.game-settings');

        if (this.isHost()) {
            if (startBtn) {
                startBtn.classList.remove('hidden');
                startBtn.disabled = false; // Host can start anytime
            }
            if (settingsDiv) settingsDiv.style.display = 'block';
        } else {
            if (startBtn) startBtn.classList.add('hidden');
            if (settingsDiv) settingsDiv.style.display = 'none';
        }
    }

    // ============================================
    // GAME FLOW
    // ============================================

    // ============================================
    // GAME FLOW
    // ============================================

    startGame() {
        if (!this.isHost()) return;

        console.log('[AirHockey] Starting game...');

        const wasPlaying = this.gameStatus === 'playing';
        const wasPaused = this.isPaused();

        this.gameStatus = 'playing';

        // If we were already playing and paused, we're resuming - keep scores and positions
        if (wasPlaying && wasPaused) {
            console.log('[AirHockey] Resuming game after player join');

            // Resume the game
            this.resumeGame();

            // Broadcast game resume with current state
            this.sendData({
                type: 'game-resume-after-join',
                puck: this.puck
            });

            // Hide control panel
            const controlPanel = document.querySelector('.control-panel');
            if (controlPanel) controlPanel.classList.add('hidden');

            const startBtn = document.getElementById('startButton');
            if (startBtn) startBtn.textContent = 'Start Game'; // Reset button text

            this.showToast('🏒 Game Resumed!', 'success');

            return;
        }

        // Otherwise, this is a fresh start - reset everything
        console.log('[AirHockey] Starting fresh game');

        // Read win score from dropdown (in case it wasn't changed but has a different value)
        const winScoreSelect = document.getElementById('winScore');
        if (winScoreSelect) {
            this.winScore = parseInt(winScoreSelect.value) || GAME_CONFIG.DEFAULT_WIN_SCORE;
        }
        console.log('[AirHockey] Win score:', this.winScore);

        // Reset goal flag
        this.goalScored = false;

        // Reset scores
        this.players.forEach(p => p.score = 0);

        // Reset all paddle positions to their initial positions
        this.players.forEach(player => {
            const initialPos = this.getInitialPaddlePosition(player.position);
            player.paddle.x = initialPos.x;
            player.paddle.y = initialPos.y;
            player.paddle.vx = 0;
            player.paddle.vy = 0;
            player.paddle.lastX = initialPos.x;
            player.paddle.lastY = initialPos.y;
        });

        // Reset puck to center
        this.resetPuck();

        // Broadcast game start with paddle positions
        const paddlePositions = {};
        this.players.forEach((player, playerId) => {
            paddlePositions[playerId] = {
                x: player.paddle.x,
                y: player.paddle.y,
                vx: 0,
                vy: 0
            };
        });

        this.sendData({
            type: 'game-start',
            winScore: this.winScore,
            puck: this.puck,
            paddles: paddlePositions
        });

        // Hide control panel
        const controlPanel = document.querySelector('.control-panel');
        if (controlPanel) controlPanel.classList.add('hidden');

        // Collapse floating control panel when game starts (for cleaner gameplay view)
        if (this.controlPanel && !this.controlPanel.isCollapsed) {
            this.controlPanel.collapse();
        }

        this.updateScoreBoard();

        // Show appropriate message based on player count
        if (this.players.size === 1) {
            this.showToast('🎯 Training Mode - Full playground access!', 'success');
        } else {
            this.showToast('🏒 Game Started!', 'success');
        }

        // Start game loop
        this.startGameLoop();

        // Update host controls visibility
        this.updateHostControls();

        // Start idle monitoring if host
        if (this.isHost()) {
            this.lastHostActivity = Date.now();
            this.startHostIdleMonitoring();
        }
    }

    handleGameStart(data) {
        console.log('[AirHockey] Game starting!');
        this.gameStatus = 'playing';
        this.winScore = data.winScore || GAME_CONFIG.DEFAULT_WIN_SCORE;

        // Reset scores
        this.players.forEach(p => p.score = 0);

        // Reset all paddle positions to their initial positions
        this.players.forEach(player => {
            const initialPos = this.getInitialPaddlePosition(player.position);
            player.paddle.x = initialPos.x;
            player.paddle.y = initialPos.y;
            player.paddle.vx = 0;
            player.paddle.vy = 0;
            player.paddle.lastX = initialPos.x;
            player.paddle.lastY = initialPos.y;
        });

        // Apply paddle positions from host if provided
        if (data.paddles) {
            Object.entries(data.paddles).forEach(([playerId, paddleData]) => {
                const player = this.players.get(playerId);
                if (player) {
                    player.paddle.x = paddleData.x;
                    player.paddle.y = paddleData.y;
                    player.paddle.vx = paddleData.vx || 0;
                    player.paddle.vy = paddleData.vy || 0;
                    player.paddle.lastX = paddleData.x;
                    player.paddle.lastY = paddleData.y;
                }
            });
        }

        // Set puck position
        if (data.puck) {
            this.puck = { ...this.puck, ...data.puck };
        }

        // Hide control panel
        const controlPanel = document.querySelector('.control-panel');
        if (controlPanel) controlPanel.classList.add('hidden');

        // Collapse floating control panel when game starts (for cleaner gameplay view)
        if (this.controlPanel && !this.controlPanel.isCollapsed) {
            this.controlPanel.collapse();
        }

        this.updateScoreBoard();
        document.getElementById('winScoreDisplay').textContent = this.winScore;
        this.showToast('🏒 Game Started!', 'success');

        // Update host controls visibility
        this.updateHostControls();

        // Start idle monitoring if host
        if (this.isHost()) {
            this.lastHostActivity = Date.now();
            this.startHostIdleMonitoring();
        }
    }

    endGame(winner) {
        this.gameStatus = 'finished';

        // Stop idle monitoring
        this.stopHostIdleMonitoring();

        this.sendData({
            type: 'game-end',
            winner: winner
        });

        this.handleGameEnd({ winner });
    }

    handleGameEnd(data) {
        this.gameStatus = 'finished';

        // Stop idle monitoring
        this.stopHostIdleMonitoring();

        const winner = data.winner;
        const player = this.players.get(winner);
        const colorName = player ? player.colorName : winner;

        this.showGoalOverlay(`🏆 ${colorName} Wins!`, winner);
        this.showToast(`🏆 ${winner} wins the game!`, 'success');

        // Show control panel after delay
        setTimeout(() => {
            this.hideGoalOverlay();

            // Reset goal flag
            this.goalScored = false;

            // Reset game status
            this.gameStatus = 'waiting';

            const controlPanel = document.querySelector('.control-panel');
            if (controlPanel) controlPanel.classList.remove('hidden');

            if (this.isHost()) {
                const startBtn = document.getElementById('startButton');
                if (startBtn) {
                    startBtn.classList.remove('hidden');
                    startBtn.disabled = false; // Enable button so host can start new game
                }
            }

            // Update host controls to show New Game button
            this.updateHostControls();

            this.updatePlayersList();
            this.updateGameMessage();
        }, 3000);
    }

    handleSettingsChange(data) {
        if (data.winScore) {
            this.winScore = data.winScore;
            document.getElementById('winScoreDisplay').textContent = this.winScore;
            document.getElementById('winScore').value = this.winScore;
        }
    }

    sendGameState(toPlayer) {
        this.sendData({
            type: 'game-state',
            gameStatus: this.gameStatus,
            winScore: this.winScore,
            puck: this.puck,
            scores: Array.from(this.players.entries()).map(([id, p]) => [id, p.score])
        }, toPlayer);
    }

    handleGameState(data) {
        this.gameStatus = data.gameStatus;
        this.winScore = data.winScore;

        if (data.puck) {
            this.puck = { ...this.puck, ...data.puck };
        }

        if (data.scores) {
            data.scores.forEach(([playerId, score]) => {
                const player = this.players.get(playerId);
                if (player) player.score = score;
            });
        }

        this.updateScoreBoard();
    }

    // ============================================
    // IDLE DETECTION & PAUSE/RESUME
    // ============================================

    /**
     * Start monitoring host activity for idle detection
     */
    startHostIdleMonitoring() {
        if (this.hostIdleCheckInterval) {
            clearInterval(this.hostIdleCheckInterval);
        }

        this.hostIdleCheckInterval = setInterval(() => {
            if (this.isHost() && this.gameStatus === 'playing') {
                const timeSinceActivity = Date.now() - this.lastHostActivity;

                if (timeSinceActivity > GAME_CONFIG.HOST_IDLE_TIMEOUT && !this.isHostIdle) {
                    // Host has become idle
                    this.isHostIdle = true;
                    this.pauseGameDueToIdle();
                } else if (timeSinceActivity <= GAME_CONFIG.HOST_IDLE_TIMEOUT && this.isHostIdle) {
                    // Host is active again
                    this.isHostIdle = false;
                    this.resumeGameFromIdle();
                }
            }
        }, 1000); // Check every second
    }

    /**
     * Stop monitoring host activity
     */
    stopHostIdleMonitoring() {
        if (this.hostIdleCheckInterval) {
            clearInterval(this.hostIdleCheckInterval);
            this.hostIdleCheckInterval = null;
        }
    }

    /**
     * Record host activity (called on movement)
     */
    recordHostActivity() {
        if (this.isHost()) {
            this.lastHostActivity = Date.now();
        }
    }

    /**
     * Pause game due to host being idle
     */
    pauseGameDueToIdle() {
        console.log('[AirHockey] Host idle - pausing game');
        this.pauseGame('⏸️ Host is idle - Game Paused');

        // Broadcast pause to all players
        this.sendData({
            type: 'game-pause',
            reason: 'Host is idle'
        });

        // Stop puck movement
        if (this.isHost()) {
            this.puck.vx = 0;
            this.puck.vy = 0;
        }
    }

    /**
     * Resume game when host becomes active
     */
    resumeGameFromIdle() {
        console.log('[AirHockey] Host active - resuming game');
        this.resumeGame();

        // Broadcast resume to all players
        this.sendData({
            type: 'game-resume'
        });
    }

    /**
     * Pause game when a new player joins during gameplay
     */
    pauseGameForPlayerJoin() {
        console.log('[AirHockey] Pausing game - new player joined');
        this.pauseGame('🎮 New Player Joined - Game Paused');

        // Broadcast pause to all players
        this.sendData({
            type: 'game-pause-player-join',
            reason: 'New player joined'
        });

        // Stop puck movement
        this.puck.vx = 0;
        this.puck.vy = 0;

        // Show control panel with start button
        const controlPanel = document.querySelector('.control-panel');
        if (controlPanel) {
            controlPanel.classList.remove('hidden');
        }

        const startBtn = document.getElementById('startButton');
        if (startBtn && this.isHost()) {
            startBtn.classList.remove('hidden');
            startBtn.disabled = false;
            startBtn.textContent = 'Resume Game';
        }

        // Hide settings during resume
        const settingsDiv = document.querySelector('.game-settings');
        if (settingsDiv) {
            settingsDiv.style.display = 'none';
        }

        // Update player list to show new player
        this.updatePlayersList();

        // Update game message
        const gameMessage = document.getElementById('gameMessage');
        if (gameMessage) {
            gameMessage.textContent = 'New player joined! Host can resume when ready.';
            gameMessage.style.display = 'block';
        }
    }

    /**
     * Handle game pause message from host
     */
    handleGamePause(data) {
        console.log('[AirHockey] Game paused by host:', data.reason);
        this.pauseGame(data.reason || '⏸️ Game Paused');

        // Update control panel
        this.updateControlPanel();

        // Stop puck movement
        this.puck.vx = 0;
        this.puck.vy = 0;
    }

    /**
     * Handle game pause due to player joining
     */
    handleGamePausePlayerJoin(data) {
        console.log('[AirHockey] Game paused - player joined:', data.reason);
        this.pauseGame('🎮 New Player Joined - Game Paused');

        // Stop puck movement
        this.puck.vx = 0;
        this.puck.vy = 0;

        // Show control panel with start button
        const controlPanel = document.querySelector('.control-panel');
        if (controlPanel) {
            controlPanel.classList.remove('hidden');
        }

        const startBtn = document.getElementById('startButton');
        if (startBtn) {
            if (this.isHost()) {
                startBtn.classList.remove('hidden');
                startBtn.disabled = false;
                startBtn.textContent = 'Resume Game';
            } else {
                startBtn.classList.add('hidden');
            }
        }

        // Hide settings during resume
        const settingsDiv = document.querySelector('.game-settings');
        if (settingsDiv) {
            settingsDiv.style.display = 'none';
        }

        // Update player list
        this.updatePlayersList();

        // Update game message
        const gameMessage = document.getElementById('gameMessage');
        if (gameMessage) {
            gameMessage.textContent = 'New player joined! Host can resume when ready.';
            gameMessage.style.display = 'block';
        }

        // Update control panel
        this.updateControlPanel();
    }

    /**
     * Handle game resume message from host
     */
    handleGameResume(data) {
        console.log('[AirHockey] Game resumed by host');
        this.resumeGame();

        // Update control panel
        this.updateControlPanel();
    }

    /**
     * Handle game resume after player joined
     */
    handleGameResumeAfterJoin(data) {
        console.log('[AirHockey] Game resumed after player join');
        this.resumeGame();

        // Set puck position from host
        if (data.puck) {
            this.puck = { ...this.puck, ...data.puck };
        }

        // Hide control panel
        const controlPanel = document.querySelector('.control-panel');
        if (controlPanel) {
            controlPanel.classList.add('hidden');
        }

        this.showToast('🏒 Game Resumed!', 'success');

        // Update control panel
        this.updateControlPanel();
    }

    // ============================================
    // GAME LOOP
    // ============================================

    startRenderLoop() {
        const render = (timestamp) => {
            this.render();
            this.gameLoopId = requestAnimationFrame(render);
        };
        this.gameLoopId = requestAnimationFrame(render);
    }

    startGameLoop() {
        this.lastFrameTime = performance.now();
        this.lastSyncTime = performance.now();
    }

    render() {
        const now = performance.now();
        const dt = Math.min((now - this.lastFrameTime) / 16.67, 2); // Cap delta time
        this.lastFrameTime = now;

        // Check if connection modal is open
        const connectionModal = document.getElementById('gameConnectionModal');
        this.isConnectionModalOpen = connectionModal && connectionModal.style.display !== 'none';

        // Check if game is paused (by BaseGame, e.g., during host migration)
        const isPaused = this.isPaused();

        // Only update paddle and physics if NOT paused and modal is NOT open
        if (!isPaused && !this.isConnectionModalOpen) {
            this.updateMyPaddle(dt);
        }

        // If playing and host, update physics (but only if not paused)
        if (this.gameStatus === 'playing' && this.isHost() && !isPaused) {
            this.updatePhysics(dt);
        }

        // Sync state periodically (only if not paused by modal or BaseGame)
        if (!isPaused && !this.isConnectionModalOpen && now - this.lastSyncTime >= GAME_CONFIG.SYNC_INTERVAL) {
            this.syncState();
            this.lastSyncTime = now;
        }

        // Draw
        this.draw();
    }

    updateMyPaddle(dt) {
        const player = this.getMyPlayer();
        if (!player) return;

        // Don't allow movement if game is not playing
        if (this.gameStatus !== 'playing') {
            return;
        }

        // Record host activity
        this.recordHostActivity();

        // Different physics for touch vs mouse input
        if (this.input.isTouching) {
            // Mobile: Touch-based physics (direction & speed)
            this.updatePaddleWithTouch(player, dt);
        } else if (this.mouseX !== null && this.mouseY !== null) {
            // PC: Mouse-based physics (follow cursor)
            // Only update if we have valid mouse coordinates
            this.updatePaddleWithMouse(player, dt);
        }
        // If neither touch nor mouse is active, paddle stays at current position

        // Update my paddle reference
        this.myPaddle = player.paddle;
    }

    updatePaddleWithMouse(player, dt) {
        // PC controls - paddle moves toward mouse cursor (existing physics)
        const targetX = this.mouseX;
        const targetY = this.mouseY;

        // Constrain target to player's zone
        const constrained = this.constrainPaddlePosition(targetX, targetY, player.position);

        // Calculate distance to target
        const dx = constrained.x - player.paddle.x;
        const dy = constrained.y - player.paddle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 1) { // Only move if we're not already at target
            // Normalize direction
            const dirX = dx / distance;
            const dirY = dy / distance;

            // Calculate speed based on distance (farther = faster)
            const speedMultiplier = 1 + (distance * GAME_CONFIG.PADDLE_DISTANCE_SPEEDUP);
            const acceleration = GAME_CONFIG.PADDLE_ACCELERATION * speedMultiplier;

            // Apply acceleration in the direction of target
            player.paddle.vx += dirX * acceleration;
            player.paddle.vy += dirY * acceleration;
        } else {
            // Apply friction when close to target
            player.paddle.vx *= GAME_CONFIG.PADDLE_FRICTION * 0.5;
            player.paddle.vy *= GAME_CONFIG.PADDLE_FRICTION * 0.5;
        }

        // Apply friction (air resistance)
        player.paddle.vx *= GAME_CONFIG.PADDLE_FRICTION;
        player.paddle.vy *= GAME_CONFIG.PADDLE_FRICTION;

        // Stop completely if moving very slowly (prevents micro-vibrations/jitter)
        const currentSpeed = Math.sqrt(player.paddle.vx * player.paddle.vx + player.paddle.vy * player.paddle.vy);
        if (currentSpeed < 0.1) {
            player.paddle.vx = 0;
            player.paddle.vy = 0;
        }

        // Limit maximum speed
        if (currentSpeed > GAME_CONFIG.PADDLE_MAX_SPEED) {
            const scale = GAME_CONFIG.PADDLE_MAX_SPEED / currentSpeed;
            player.paddle.vx *= scale;
            player.paddle.vy *= scale;
        }

        // Update position based on velocity
        player.paddle.x += player.paddle.vx;
        player.paddle.y += player.paddle.vy;

        // Constrain final position to boundaries
        const finalConstrained = this.constrainPaddlePosition(player.paddle.x, player.paddle.y, player.position);
        player.paddle.x = finalConstrained.x;
        player.paddle.y = finalConstrained.y;
    }

    updatePaddleWithTouch(player, dt) {
        // Mobile controls - paddle MIRRORS finger movement (not chasing finger)
        // When finger moves 10px right, paddle moves 10px right

        // Apply the touch movement delta directly to paddle position
        // touchVelocityX/Y contains the movement since last frame
        const moveX = this.input.touchVelocityX;
        const moveY = this.input.touchVelocityY;

        // Apply movement directly to position (1:1 mapping)
        player.paddle.x += moveX;
        player.paddle.y += moveY;

        // Store velocity for puck collision physics (but don't accumulate it)
        player.paddle.vx = moveX;
        player.paddle.vy = moveY;


        // Constrain final position to boundaries
        const finalConstrained = this.constrainPaddlePosition(player.paddle.x, player.paddle.y, player.position);
        player.paddle.x = finalConstrained.x;
        player.paddle.y = finalConstrained.y;
    }

    constrainPaddlePosition(x, y, position) {
        const r = GAME_CONFIG.PADDLE_RADIUS;
        const w = GAME_CONFIG.CANVAS_WIDTH;
        const h = GAME_CONFIG.CANVAS_HEIGHT;
        const halfW = w / 2;

        let minX = r, maxX = w - r;
        let minY = r, maxY = h - r;

        // Training mode: If only one player, allow full playground access
        if (this.players.size === 1) {
            // No constraints - player can move anywhere for training
            return {
                x: Math.max(minX, Math.min(maxX, x)),
                y: Math.max(minY, Math.min(maxY, y))
            };
        }

        // Team-based constraints: left team stays on left half, right team stays on right half
        if (position.startsWith('left-')) {
            maxX = halfW - r;
        } else if (position.startsWith('right-')) {
            minX = halfW + r;
        }
        // Legacy support for old position names
        else if (position === 'left') {
            maxX = halfW - r;
        } else if (position === 'right') {
            minX = halfW + r;
        } else if (position === 'top') {
            maxY = h / 2 - r;
        } else if (position === 'bottom') {
            minY = h / 2 + r;
        }

        return {
            x: Math.max(minX, Math.min(maxX, x)),
            y: Math.max(minY, Math.min(maxY, y))
        };
    }

    updatePhysics(dt) {
        // Update puck position
        this.puck.x += this.puck.vx * dt;
        this.puck.y += this.puck.vy * dt;

        // Apply friction
        this.puck.vx *= GAME_CONFIG.PUCK_FRICTION;
        this.puck.vy *= GAME_CONFIG.PUCK_FRICTION;

        // Stop puck completely if moving very slowly (prevents micro-vibrations)
        const puckSpeed = Math.sqrt(this.puck.vx ** 2 + this.puck.vy ** 2);
        if (puckSpeed < 0.05) {
            this.puck.vx = 0;
            this.puck.vy = 0;
        }

        // Clamp speed
        if (puckSpeed > GAME_CONFIG.PUCK_MAX_SPEED) {
            this.puck.vx = (this.puck.vx / puckSpeed) * GAME_CONFIG.PUCK_MAX_SPEED;
            this.puck.vy = (this.puck.vy / puckSpeed) * GAME_CONFIG.PUCK_MAX_SPEED;
        }

        // Wall collisions
        this.handleWallCollisions();

        // Paddle collisions
        this.handlePaddleCollisions();

        // Check for goals
        this.checkGoals();
    }

    handleWallCollisions() {
        const r = this.puck.radius;
        const w = GAME_CONFIG.CANVAS_WIDTH;
        const h = GAME_CONFIG.CANVAS_HEIGHT;
        const goalWidth = GAME_CONFIG.GOAL_WIDTH;
        const goalTop = (h - goalWidth) / 2;
        const goalBottom = (h + goalWidth) / 2;
        const goalLeft = (w - goalWidth) / 2;
        const goalRight = (w + goalWidth) / 2;

        // Left wall - open for goal area (puck goes through for goal)
        if (this.puck.x - r < 0) {
            // Only bounce if NOT in goal area
            if (this.puck.y < goalTop || this.puck.y > goalBottom) {
                this.puck.x = r;
                this.puck.vx *= -0.8;
            }
            // If in goal area, let it through (goal will be detected)
        }

        // Right wall - open for goal area
        if (this.puck.x + r > w) {
            if (this.puck.y < goalTop || this.puck.y > goalBottom) {
                this.puck.x = w - r;
                this.puck.vx *= -0.8;
            }
        }

        // Top wall - only open for goal in 3+ player mode
        if (this.puck.y - r < 0) {
            if (this.players.size >= 3 && this.puck.x > goalLeft && this.puck.x < goalRight) {
                // Goal area - let through
            } else {
                this.puck.y = r;
                this.puck.vy *= -0.8;
            }
        }

        // Bottom wall - only open for goal in 4 player mode
        if (this.puck.y + r > h) {
            if (this.players.size >= 4 && this.puck.x > goalLeft && this.puck.x < goalRight) {
                // Goal area - let through
            } else {
                this.puck.y = h - r;
                this.puck.vy *= -0.8;
            }
        }
    }

    handlePaddleCollisions() {
        this.players.forEach((player, playerId) => {
            const paddle = player.paddle;

            // Current distance check
            const dx = this.puck.x - paddle.x;
            const dy = this.puck.y - paddle.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = this.puck.radius + GAME_CONFIG.PADDLE_RADIUS;

            // BULLET PHYSICS: Check if puck's trajectory crossed through paddle
            // Calculate paddle's previous position (before last movement)
            const prevPaddleX = paddle.lastX || paddle.x;
            const prevPaddleY = paddle.lastY || paddle.y;

            // Check if puck is moving fast and might have tunneled through paddle
            const puckSpeed = Math.sqrt(this.puck.vx ** 2 + this.puck.vy ** 2);
            const paddleSpeed = Math.sqrt((paddle.vx || 0) ** 2 + (paddle.vy || 0) ** 2);
            const isFastMoving = puckSpeed > 5 || paddleSpeed > 5;

            let collision = false;

            if (isFastMoving) {
                // Perform continuous collision detection
                // Check line segment (puck's path) vs circle (paddle's path)
                const puckPrevX = this.puck.x - this.puck.vx;
                const puckPrevY = this.puck.y - this.puck.vy;

                // Calculate closest point on puck's path to paddle center
                const pathDx = this.puck.x - puckPrevX;
                const pathDy = this.puck.y - puckPrevY;
                const pathLen = Math.sqrt(pathDx * pathDx + pathDy * pathDy);

                if (pathLen > 0) {
                    const t = Math.max(0, Math.min(1,
                        ((paddle.x - puckPrevX) * pathDx + (paddle.y - puckPrevY) * pathDy) / (pathLen * pathLen)
                    ));

                    const closestX = puckPrevX + t * pathDx;
                    const closestY = puckPrevY + t * pathDy;
                    const closestDist = Math.sqrt((closestX - paddle.x) ** 2 + (closestY - paddle.y) ** 2);

                    if (closestDist < minDist) {
                        // Collision detected along path
                        collision = true;
                        // Move puck to collision point
                        this.puck.x = closestX;
                        this.puck.y = closestY;
                    }
                }
            }

            // Standard collision check
            if (!collision && dist < minDist && dist > 0) {
                collision = true;
            }

            if (collision && dist > 0) {
                // Normalize collision vector
                const nx = dx / dist;
                const ny = dy / dist;

                // Separate puck from paddle
                this.puck.x = paddle.x + nx * minDist;
                this.puck.y = paddle.y + ny * minDist;

                // Calculate relative velocity
                const dvx = this.puck.vx - (paddle.vx || 0);
                const dvy = this.puck.vy - (paddle.vy || 0);

                // Relative velocity in collision normal direction
                const dvn = dvx * nx + dvy * ny;

                // Only resolve if objects are approaching
                if (dvn < 0) {
                    // Collision response with restitution
                    const restitution = 1.2;
                    const impulse = -(1 + restitution) * dvn;

                    // Reduced paddle velocity transfer (0.3 instead of 0.5) to minimize ball vibration
                    this.puck.vx += impulse * nx + (paddle.vx || 0) * 0.3;
                    this.puck.vy += impulse * ny + (paddle.vy || 0) * 0.3;
                }
            }

            // Store paddle's current position for next frame's bullet physics check
            paddle.lastX = paddle.x;
            paddle.lastY = paddle.y;
        });
    }

    checkGoals() {
        // Prevent multiple goal detections
        if (this.goalScored) return;

        const r = this.puck.radius;
        const w = GAME_CONFIG.CANVAS_WIDTH;
        const h = GAME_CONFIG.CANVAS_HEIGHT;
        const goalWidth = GAME_CONFIG.GOAL_WIDTH;
        const goalTop = (h - goalWidth) / 2;
        const goalBottom = (h + goalWidth) / 2;

        let scoredOn = null;

        // Left goal - Team Left's goal
        if (this.puck.x < -r && this.puck.y > goalTop && this.puck.y < goalBottom) {
            scoredOn = 'left';
        }
        // Right goal - Team Right's goal
        else if (this.puck.x > w + r && this.puck.y > goalTop && this.puck.y < goalBottom) {
            scoredOn = 'right';
        }

        if (scoredOn) {
            this.goalScored = true; // Prevent multiple detections
            this.onGoalScored(scoredOn);
        }
    }

    onGoalScored(goalSide) {
        // Team-based scoring: when a goal is scored on a team, the opposing team gets a point
        // goalSide = 'left' or 'right' (which team's goal was scored on)

        const scoringTeam = (goalSide === 'left') ? 'right' : 'left';

        let scorer = null;

        // All players on the scoring team get a point
        this.players.forEach((player, playerId) => {
            if (player.team === scoringTeam) {
                player.score++;
                if (!scorer) scorer = playerId; // Track first player for display
            }
        });

        // Broadcast goal
        this.sendData({
            type: 'goal',
            scoredOn: goalSide,
            scoringTeam: scoringTeam,
            scorer: scorer,
            scores: Array.from(this.players.entries()).map(([id, p]) => [id, p.score])
        });

        this.handleGoal({
            scoredOn: goalSide,
            scoringTeam: scoringTeam,
            scorer: scorer,
            scores: Array.from(this.players.entries()).map(([id, p]) => [id, p.score])
        });
    }

    handleGoal(data) {
        // Mark goal as scored (prevents duplicate detection)
        this.goalScored = true;

        // Update scores
        if (data.scores) {
            data.scores.forEach(([playerId, score]) => {
                const player = this.players.get(playerId);
                if (player) player.score = score;
            });
        }

        // Display team-based goal message
        const teamName = data.scoringTeam ? `Team ${data.scoringTeam.charAt(0).toUpperCase() + data.scoringTeam.slice(1)}` : 'Team';
        this.showGoalOverlay('⚽ GOAL!', `${teamName} scores!`);
        this.updateScoreBoard();

        // Check for winner (any player reaching win score)
        let winner = null;
        this.players.forEach((player, playerId) => {
            if (player.score >= this.winScore) {
                winner = playerId;
            }
        });

        if (winner) {
            setTimeout(() => {
                this.hideGoalOverlay();
                if (this.isHost()) {
                    this.endGame(winner);
                }
            }, 1500);
        } else {
            // Reset puck after delay
            setTimeout(() => {
                this.hideGoalOverlay();
                if (this.isHost()) {
                    this.resetPuck();
                    this.sendData({
                        type: 'puck-update',
                        ...this.puck
                    });
                }
            }, 1500);
        }
    }

    resetPuck() {
        // Random horizontal position in middle half of playground (25% - 75% of width)
        const minX = GAME_CONFIG.CANVAS_WIDTH * 0.25;
        const maxX = GAME_CONFIG.CANVAS_WIDTH * 0.75;
        this.puck.x = minX + Math.random() * (maxX - minX);

        // Center vertically
        this.puck.y = GAME_CONFIG.CANVAS_HEIGHT / 2;

        // Move vertically (perpendicular to goals) to prevent immediate scoring
        // Randomly choose up or down direction
        const direction = Math.random() < 0.5 ? -1 : 1; // -1 = up, 1 = down
        const speed = 4; // Slow initial speed for fair play

        // Vertical movement only (vx = 0, only vy has velocity)
        this.puck.vx = 0;
        this.puck.vy = direction * speed;

        // Reset goal detection flag
        this.goalScored = false;
    }

    resetBallToCenter() {
        if (!this.isHost()) return;

        console.log('[AirHockey] Host resetting ball to center');

        // Reset puck to center with no velocity
        this.puck.x = GAME_CONFIG.CANVAS_WIDTH / 2;
        this.puck.y = GAME_CONFIG.CANVAS_HEIGHT / 2;
        this.puck.vx = 0;
        this.puck.vy = 0;
        this.goalScored = false;

        // Broadcast reset to all players
        this.sendData({
            type: 'reset-ball',
            x: this.puck.x,
            y: this.puck.y
        });

        this.showToast('🏒 Ball reset to center', 'info');
    }

    handleResetBall(data) {
        // Client receives reset ball command from host
        this.puck.x = data.x;
        this.puck.y = data.y;
        this.puck.vx = 0;
        this.puck.vy = 0;
        this.goalScored = false;
        this.showToast('🏒 Ball reset to center', 'info');
    }

    startNewGame() {
        if (!this.isHost()) return;

        console.log('[AirHockey] Host starting new game');

        // Don't stop render loop - it should always run
        // Just reset game state
        this.gameStatus = 'waiting';
        this.goalScored = false;

        // Reset scores
        this.players.forEach(p => p.score = 0);

        // Reset puck
        this.puck.x = GAME_CONFIG.CANVAS_WIDTH / 2;
        this.puck.y = GAME_CONFIG.CANVAS_HEIGHT / 2;
        this.puck.vx = 0;
        this.puck.vy = 0;

        // Reset all paddles to initial positions
        this.players.forEach(player => {
            const initialPos = this.getInitialPaddlePosition(player.position);
            player.paddle.x = initialPos.x;
            player.paddle.y = initialPos.y;
            player.paddle.vx = 0;
            player.paddle.vy = 0;
        });

        // Broadcast new game to all players
        this.sendData({
            type: 'new-game'
        });

        // Update UI
        this.updateScoreBoard();
        this.showWaitingRoom();
        this.updateHostControls();

        this.showToast('🏒 New game ready!', 'success');
    }

    handleNewGame(data) {
        console.log('[AirHockey] Received new game command from host');

        // Don't stop render loop - it should always run
        // Just reset game state
        this.gameStatus = 'waiting';
        this.goalScored = false;

        // Reset scores
        this.players.forEach(p => p.score = 0);

        // Reset puck
        this.puck.x = GAME_CONFIG.CANVAS_WIDTH / 2;
        this.puck.y = GAME_CONFIG.CANVAS_HEIGHT / 2;
        this.puck.vx = 0;
        this.puck.vy = 0;

        // Reset all paddles to initial positions
        this.players.forEach(player => {
            const initialPos = this.getInitialPaddlePosition(player.position);
            player.paddle.x = initialPos.x;
            player.paddle.y = initialPos.y;
            player.paddle.vx = 0;
            player.paddle.vy = 0;
        });

        // Update UI
        this.updateScoreBoard();
        const controlPanel = document.querySelector('.control-panel');
        if (controlPanel) controlPanel.classList.remove('hidden');

        this.updateHostControls();

        this.showToast('🏒 New game ready!', 'success');
    }

    syncState() {
        // Only sync when connected and game is playing
        if (!this.connected || this.gameStatus !== 'playing') return;

        const player = this.getMyPlayer();
        if (!player) return;

        // Only send paddle update if position has changed significantly
        const dx = Math.abs(player.paddle.x - (this.lastSentPaddle?.x || 0));
        const dy = Math.abs(player.paddle.y - (this.lastSentPaddle?.y || 0));

        if (dx > 1 || dy > 1) {
            this.sendData({
                type: 'paddle-update',
                x: player.paddle.x,
                y: player.paddle.y,
                vx: player.paddle.vx,
                vy: player.paddle.vy
            });
            this.lastSentPaddle = { x: player.paddle.x, y: player.paddle.y };
        }

        // If host, also send puck (always send for smooth movement on clients)
        if (this.isHost()) {
            this.sendData({
                type: 'puck-update',
                ...this.puck
            });
        }
    }

    handlePaddleUpdate(playerId, data) {
        const player = this.players.get(playerId);
        if (player) {
            player.paddle.x = data.x;
            player.paddle.y = data.y;
            player.paddle.vx = data.vx || 0;
            player.paddle.vy = data.vy || 0;
        }
    }

    // ============================================
    // RENDERING
    // ============================================

    draw() {
        const ctx = this.ctx;
        const w = GAME_CONFIG.CANVAS_WIDTH;
        const h = GAME_CONFIG.CANVAS_HEIGHT;

        // Clear canvas
        ctx.fillStyle = '#1a2744';
        ctx.fillRect(0, 0, w, h);

        // Draw rink
        this.drawRink();

        // Draw paddles
        this.drawPaddles();

        // Draw puck
        this.drawPuck();
    }

    drawRink() {
        const ctx = this.ctx;
        const w = GAME_CONFIG.CANVAS_WIDTH;
        const h = GAME_CONFIG.CANVAS_HEIGHT;
        const goalWidth = GAME_CONFIG.GOAL_WIDTH;

        // Center line (vertical - divides teams)
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // Center circle
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 80, 0, Math.PI * 2);
        ctx.stroke();

        // Goals - only left and right (team goals)
        const goalTop = (h - goalWidth) / 2;
        const goalBottom = (h + goalWidth) / 2;

        // Left goal (Team Left)
        ctx.fillStyle = this.getGoalColor('left');
        ctx.fillRect(0, goalTop, 10, goalWidth);

        // Right goal (Team Right)
        ctx.fillStyle = this.getGoalColor('right');
        ctx.fillRect(w - 10, goalTop, 10, goalWidth);
    }

    getGoalColor(side) {
        // Get a representative color from the team defending this goal
        let color = 'rgba(255, 255, 255, 0.3)';
        this.players.forEach(player => {
            if (player.team === side) {
                color = player.color; // Use the first player's color found on this team
            }
        });
        return color;
    }

    drawPaddles() {
        const ctx = this.ctx;

        this.players.forEach((player, playerId) => {
            const paddle = player.paddle;
            const isMe = playerId === this.username;

            // Glow effect
            ctx.shadowColor = player.color;
            ctx.shadowBlur = isMe ? 20 : 10;

            // Paddle body
            ctx.fillStyle = player.color;
            ctx.beginPath();
            ctx.arc(paddle.x, paddle.y, GAME_CONFIG.PADDLE_RADIUS, 0, Math.PI * 2);
            ctx.fill();

            // Inner circle
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.beginPath();
            ctx.arc(paddle.x, paddle.y, GAME_CONFIG.PADDLE_RADIUS * 0.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.shadowBlur = 0;

            // Player name
            ctx.fillStyle = '#fff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(
                isMe ? 'You' : playerId.substring(0, 10),
                paddle.x,
                paddle.y - GAME_CONFIG.PADDLE_RADIUS - 10
            );
        });
    }

    drawPuck() {
        const ctx = this.ctx;

        // Glow
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 15;

        // Puck body
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(this.puck.x, this.puck.y, this.puck.radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner detail
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(this.puck.x, this.puck.y, this.puck.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
    }

    // ============================================
    // INPUT HANDLING
    // ============================================

    handleMouseMove(e) {
        // Record host activity (even if paused, so host can resume by moving)
        this.recordHostActivity();

        const rect = this.canvas.getBoundingClientRect();

        // If in portrait mode with rotation, transform coordinates differently
        if (this.isPortraitMode) {
            // Canvas is rotated 90 degrees clockwise via CSS transform: rotate(90deg)
            // The visual canvas is rotated, so we need to map screen coords to rotated canvas coords
            //
            // After CSS rotate(90deg) clockwise:
            // - Screen X (left-right) maps to canvas Y (but inverted: left->bottom, right->top)
            // - Screen Y (top-bottom) maps to canvas X (top->left, bottom->right)

            const normalizedX = (e.clientX - rect.left) / rect.width;  // 0 to 1 (left to right on screen)
            const normalizedY = (e.clientY - rect.top) / rect.height;  // 0 to 1 (top to bottom on screen)

            // Mapping for 90deg clockwise rotation:
            // Screen Y (0=top, 1=bottom) -> Canvas X (0=left, 1=right) - same direction
            // Screen X (0=left, 1=right) -> Canvas Y (0=top, 1=bottom) - inverted
            const canvasX = normalizedY * GAME_CONFIG.CANVAS_WIDTH;
            const canvasY = (1 - normalizedX) * GAME_CONFIG.CANVAS_HEIGHT;

            this.mouseX = canvasX;
            this.mouseY = canvasY;
        } else {
            // Normal mode - direct mapping
            let x = (e.clientX - rect.left) * (GAME_CONFIG.CANVAS_WIDTH / rect.width);
            let y = (e.clientY - rect.top) * (GAME_CONFIG.CANVAS_HEIGHT / rect.height);
            this.mouseX = x;
            this.mouseY = y;
        }
    }

    handleTouchMove(e) {
        e.preventDefault();
        if (!e.touches || e.touches.length === 0) return;

        // Record host activity (even if paused, so host can resume by moving)
        this.recordHostActivity();

        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];

        // Calculate touch position in canvas coordinates
        let canvasX, canvasY;

        if (this.isPortraitMode) {
            const normalizedX = (touch.clientX - rect.left) / rect.width;
            const normalizedY = (touch.clientY - rect.top) / rect.height;
            canvasX = normalizedY * GAME_CONFIG.CANVAS_WIDTH;
            canvasY = (1 - normalizedX) * GAME_CONFIG.CANVAS_HEIGHT;
        } else {
            // Normal mode - direct mapping
            canvasX = (touch.clientX - rect.left) * (GAME_CONFIG.CANVAS_WIDTH / rect.width);
            canvasY = (touch.clientY - rect.top) * (GAME_CONFIG.CANVAS_HEIGHT / rect.height);
        }

        // Calculate time delta for velocity
        const now = Date.now();
        const timeDelta = Math.max(now - this.input.lastTouchTime, 1); // Prevent division by zero

        // Calculate velocity from touch movement
        const dx = canvasX - this.input.touchCurrentX;
        const dy = canvasY - this.input.touchCurrentY;

        // Velocity in pixels per millisecond, scaled up
        this.input.touchVelocityX = (dx / timeDelta) * 16; // Scale to ~60fps
        this.input.touchVelocityY = (dy / timeDelta) * 16;

        // Update touch state
        this.input.touchPrevX = this.input.touchCurrentX;
        this.input.touchPrevY = this.input.touchCurrentY;
        this.input.touchCurrentX = canvasX;
        this.input.touchCurrentY = canvasY;
        this.input.lastTouchTime = now;

        // Debug logging (throttled - only every 10th event)
        if (!this._touchMoveCount) this._touchMoveCount = 0;
        this._touchMoveCount++;
        if (this._touchMoveCount % 10 === 0) {
            debugLog('Touch move', {
                x: Math.round(canvasX),
                y: Math.round(canvasY),
                vx: Math.round(this.input.touchVelocityX * 10) / 10,
                vy: Math.round(this.input.touchVelocityY * 10) / 10
            });
        }
    }

    handleTouchStart(e) {
        debugLog('🤚 Touch Start', {
            touches: e.touches ? e.touches.length : 0,
            portrait: this.isPortraitMode
        });

        e.preventDefault();
        if (!e.touches || e.touches.length === 0) return;

        // Record host activity (even if paused, so host can resume by moving)
        this.recordHostActivity();

        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];

        // Calculate touch position in canvas coordinates
        let canvasX, canvasY;

        if (this.isPortraitMode) {
            const normalizedX = (touch.clientX - rect.left) / rect.width;
            const normalizedY = (touch.clientY - rect.top) / rect.height;
            canvasX = normalizedY * GAME_CONFIG.CANVAS_WIDTH;
            canvasY = (1 - normalizedX) * GAME_CONFIG.CANVAS_HEIGHT;
        } else {
            canvasX = (touch.clientX - rect.left) * (GAME_CONFIG.CANVAS_WIDTH / rect.width);
            canvasY = (touch.clientY - rect.top) * (GAME_CONFIG.CANVAS_HEIGHT / rect.height);
        }

        // Initialize touch drag system
        this.input.isTouching = true;
        this.input.touchStartX = canvasX;
        this.input.touchStartY = canvasY;
        this.input.touchCurrentX = canvasX;
        this.input.touchCurrentY = canvasY;
        this.input.lastTouchTime = Date.now();

        debugLog('Touch position', { x: Math.round(canvasX), y: Math.round(canvasY) });
    }

    handleTouchEnd(e) {
        debugLog('🤚 Touch End');

        e.preventDefault();

        // Completely stop the paddle - no drift, stays at current position
        const player = this.getMyPlayer();
        if (player && this.input.isTouching) {
            // Zero out velocity completely - paddle stays where it is
            player.paddle.vx = 0;
            player.paddle.vy = 0;
        }

        // Reset touch state
        this.input.isTouching = false;
        this.input.touchVelocityX = 0;
        this.input.touchVelocityY = 0;

        // Paddle stays at current position - no movement
    }

    // ============================================
    // UI UPDATES
    // ============================================

    updatePlayersList() {
        const container = document.getElementById('playersList');
        if (!container) return;

        let html = '';
        this.players.forEach((player, playerId) => {
            const isMe = playerId === this.username;
            const hasP2P = isMe || this.connectedPeers.has(playerId);

            html += `
                <div class="player-item">
                    <div class="player-color" style="background: ${player.color}"></div>
                    <div class="player-name">${playerId}${isMe ? ' (You)' : ''} ${!isMe ? (hasP2P ? '🔗' : '⏳') : ''}</div>
                </div>
            `;
        });

        container.innerHTML = html;
        const playerCountEl = document.getElementById('playerCount');
        if (playerCountEl) {
            playerCountEl.textContent = `Players: ${this.players.size}`;
        }
    }

    updateScoreBoard() {
        const container = document.getElementById('scoreBoard');
        if (!container) return;

        let html = '';
        this.players.forEach((player, playerId) => {
            html += `
                <div class="score-item">
                    <div class="score-color" style="background: ${player.color}"></div>
                    <span class="score-name">${player.colorName}</span>
                    <span class="score-value">${player.score}</span>
                </div>
            `;
        });

        container.innerHTML = html;
        this.updateLeaderboard();
    }

    updateLeaderboard() {
        const container = document.getElementById('leaderboard');
        if (!container) return;

        const sorted = Array.from(this.players.entries())
            .sort((a, b) => b[1].score - a[1].score);

        container.innerHTML = sorted.map(([playerId, player], i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
            return `
                <div class="leaderboard-item">
                    <span class="leaderboard-rank">${medal || (i + 1)}</span>
                    <div class="leaderboard-color" style="background: ${player.color}"></div>
                    <span class="leaderboard-name">${playerId}</span>
                    <span class="leaderboard-score">${player.score}</span>
                </div>
            `;
        }).join('');
    }

    updateGameMessage() {
        const el = document.getElementById('gameMessage');
        if (!el) return;

        const playerCount = this.players.size;

        if (playerCount < 1) {
            el.textContent = 'Waiting for players...';
        } else if (playerCount === 1) {
            el.textContent = '🎯 Training Mode - You can move to both sides! ' +
                           (this.isHost() ? 'Click Start Game when ready' : 'Waiting for host to start...');
        } else {
            el.textContent = this.isHost() ? 'Click Start Game when ready' : 'Waiting for host to start...';
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

    showGoalOverlay(mainText, subText) {
        const overlay = document.getElementById('goalOverlay');
        const scorerEl = document.getElementById('goalScorer');
        const textEl = overlay.querySelector('.goal-text');

        if (textEl) textEl.textContent = mainText;
        if (scorerEl) scorerEl.textContent = subText || '';
        if (overlay) overlay.classList.remove('hidden');
    }

    hideGoalOverlay() {
        const overlay = document.getElementById('goalOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    // ============================================
    // OVERRIDE BASE CLASS HOST INDICATOR METHODS
    // ============================================

    /**
     * Override AgentSessionBase's showHostIndicator to prevent it from showing
     * We use the control panel's host badge instead
     */
    showHostIndicator() {
        // Do nothing - control panel handles host indication
    }

    /**
     * Override AgentSessionBase's hideHostIndicator to prevent any issues
     * We use the control panel's host badge instead
     */
    hideHostIndicator() {
        // Do nothing - control panel handles host indication
    }

    /**
     * Override AgentSessionBase's updateHostIndicator to prevent it from updating
     * We use the control panel's host badge instead
     */
    updateHostIndicator() {
        // Do nothing - control panel handles host indication
        // Control panel is updated via updateControlPanel() instead
    }
}

// ============================================
// INITIALIZATION
// ============================================

let airHockeyGame = null;
let isConnecting = false;

// Global functions

window.startGame = function() {
    if (airHockeyGame) airHockeyGame.startGame();
};

// ============================================
// INITIALIZATION - Same pattern as whiteboard-client.js
// ============================================

async function connectAirHockey(username, channel, password) {
    if (isConnecting) {
        console.warn('[AirHockey] Connection already in progress');
        return;
    }

    if (airHockeyGame && airHockeyGame.connected) {
        console.warn('[AirHockey] Already connected');
        return;
    }

    isConnecting = true;

    try {
        airHockeyGame = new AirHockeyGame();
        window.airHockeyGame = airHockeyGame;

        await airHockeyGame.initialize();
        await airHockeyGame.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });
        airHockeyGame.start();

        // Update URL with auth for sharing
        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' + channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }

        console.log('[AirHockey] Connected and ready!');
    } catch (error) {
        console.error('[AirHockey] Connection failed:', error);
        alert('Failed to connect: ' + error.message);
        airHockeyGame = null;
    } finally {
        isConnecting = false;
    }
}

// Initialize connection modal
function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'airhockey_',
        channelPrefix: 'hockey-',
        title: '🏒 Join Air Hockey',
        collapsedTitle: '🏒 Air Hockey',
        onConnect: function(username, channel, password) {
            connectAirHockey(username, channel, password);
        }
    });
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    console.log('[AirHockey] Page loaded');

    // Initialize connection modal
    initializeConnectionModal();

    // Process shared link and setup auto-connect using centralized utility
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'AirHockey',
            storagePrefix: 'airhockey_',
            connectCallback: async function() {
                console.log('[AirHockey] Auto-connect triggered');
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectAirHockey(username, channel, password);
                } else {
                    console.warn('[AirHockey] Auto-connect skipped: missing username or channel');
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

function resetBall() {
    if (airHockeyGame && airHockeyGame.isHost()) {
        airHockeyGame.resetBallToCenter();
    }
}

function newGame() {
    if (airHockeyGame && airHockeyGame.isHost()) {
        airHockeyGame.startNewGame();
    }
}

function disconnect() {
    if (airHockeyGame) {
        if (airHockeyGame.gameLoopId) {
            cancelAnimationFrame(airHockeyGame.gameLoopId);
        }
        airHockeyGame.disconnect();
    }

    if (window.ConnectionModal) {
        ConnectionModal.show();
    }
    document.getElementById('gameContainer').classList.add('hidden');
}

// ============================================
// FULLSCREEN TOGGLE (Mobile only)
// ============================================

function toggleFullscreen() {
    const body = document.body;
    const fullscreenIcon = document.getElementById('fullscreenIcon');
    const exitFullscreenIcon = document.getElementById('exitFullscreenIcon');

    // Toggle fullscreen mode class
    body.classList.toggle('fullscreen-mode');
    const isFullscreen = body.classList.contains('fullscreen-mode');

    // Toggle icon visibility
    if (fullscreenIcon && exitFullscreenIcon) {
        if (isFullscreen) {
            fullscreenIcon.style.display = 'none';
            exitFullscreenIcon.style.display = 'block';
        } else {
            fullscreenIcon.style.display = 'block';
            exitFullscreenIcon.style.display = 'none';
        }
    }

    // Trigger canvas resize to adapt to new layout
    if (airHockeyGame && airHockeyGame.setupResponsiveCanvas) {
        setTimeout(() => {
            airHockeyGame.setupResponsiveCanvas();
        }, 50);
    }

    console.log('[AirHockey] Fullscreen mode:', isFullscreen);
}

