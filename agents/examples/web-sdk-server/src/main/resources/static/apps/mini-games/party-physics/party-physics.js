/**
 * party-physics.js
 * Main game class that extends UserConnectionBase
 * Integrates all modules: GameAuthority, GameClient, NetAdapter, InputHandler, MobileControls
 */

class PartyPhysicsGame extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'partyPhysics',
            customType: 'partyPhysics',
            usePubKey: false,
            autoCreateDataChannel: true
        });

        // Core modules
        this.authority = null; // GameAuthority (host only)
        this.client = null; // GameClient (rendering)
        this.netAdapter = null; // NetAdapter (networking)
        this.inputHandler = null; // InputHandler (keyboard)
        this.mobileControls = null; // MobileControls (touch)

        // Game state
        this.selectedCharacter = 'bunny';
        this.selectedMode = 'fight';
        this.lobbyPlayers = new Map(); // peerId -> {name, character}

        // Update loop
        this.updateInterval = null;
        this.inputInterval = null;

        console.log('[PartyPhysics] Created');
    }

    /**
     * Called after successful connection (UserConnectionBase callback)
     */
    async onConnect() {
        console.log('[PartyPhysics] onConnect called - Connected to channel');

        try {
            // Update UI
            document.getElementById('connectionStatus').classList.add('connected');
            document.getElementById('statusText').textContent = 'Connected';
            document.getElementById('shareBtn').style.display = 'block';

            console.log('[PartyPhysics] UI updated');

            // Initialize NetAdapter
            console.log('[PartyPhysics] Creating NetAdapter...');
            this.netAdapter = new NetAdapter(this);
            this.netAdapter.initChannel(this.channel, this.agentId);
            console.log('[PartyPhysics] NetAdapter initialized');

            // Setup network callbacks
            this.setupNetworkCallbacks();

            // Initialize GameClient (Three.js rendering)
            console.log('[PartyPhysics] Creating GameClient...');
            this.client = new GameClient('gameContainer');
            await this.client.init();
            this.client.startRendering();
            console.log('[PartyPhysics] GameClient initialized and rendering started');

            // Initialize InputHandler
            console.log('[PartyPhysics] Creating InputHandler...');
            this.inputHandler = new InputHandler();
            console.log('[PartyPhysics] InputHandler initialized');

            // Initialize mobile controls if on mobile
            if (typeof MobileControls !== 'undefined' && MobileControls.isMobile()) {
                this.mobileControls = new MobileControls(this.inputHandler);
                this.mobileControls.init();
                console.log('[PartyPhysics] MobileControls initialized');
            }

            // Check if I'm host (UserConnectionBase has this method!)
            if (this.isHost()) {
                console.log('[PartyPhysics] I am the host');

                // Announce as host via NetAdapter
                if (this.netAdapter) {
                    this.netAdapter.announceHost('party-game-' + Date.now(), this.selectedMode);
                }

                // Show host controls
                document.querySelectorAll('.host-only').forEach(el => {
                    el.style.display = '';
                });

                // Load maps for default mode (fight)
                this.loadMapsForMode(this.selectedMode);

                showToast('You are the host!', 'success');
            }

            // Show waiting room
            console.log('[PartyPhysics] Showing waiting room...');
            const waitingRoom = document.getElementById('waitingRoom');
            if (waitingRoom) {
                waitingRoom.classList.remove('hidden');
            }

            // Show player in lobby
            this.lobbyPlayers.set(this.agentId, {
                name: this.username,
                character: this.selectedCharacter
            });
            this.updateLobbyUI();

            console.log('[PartyPhysics] onConnect completed successfully');

        } catch (error) {
            console.error('[PartyPhysics] onConnect failed:', error);
            showToast('Game initialization failed: ' + error.message, 'error');
            // Don't throw - let user stay in lobby even if rendering fails
        }
    }

    /**
     * Setup network callbacks
     */
    setupNetworkCallbacks() {
        this.netAdapter.onSnapshot((snapshot) => {
            if (this.client) {
                this.client.processSnapshot(snapshot);
            }
        });

        this.netAdapter.onModeChange((mode) => {
            this.selectedMode = mode;
            this.updateModeUI();
        });

        this.netAdapter.onGameStart((data) => {
            this.onGameStart();
        });

        this.netAdapter.onGameEnd((data) => {
            this.onGameEnd(data.winnerId);
        });

        this.netAdapter.onUserJoin((data) => {
            this.addLobbyPlayer(data.peerId, data.name, data.character);
        });

        this.netAdapter.onUserLeave((data) => {
            this.removeLobbyPlayer(data.peerId);
        });
    }

    /**
     * Handle user join (UserConnectionBase callback)
     */
    onUserJoin(userId, username) {
        console.log('[PartyPhysics] User joined:', username);

        // Forward to NetAdapter
        if (this.netAdapter) {
            this.netAdapter.handleUserJoin(userId, username);
        }

        showToast(`${username} joined the game!`, 'info');
    }

    /**
     * Handle user leave (UserConnectionBase callback)
     */
    onUserLeave(userId, username) {
        console.log('[PartyPhysics] User left:', username);

        // Forward to NetAdapter
        if (this.netAdapter) {
            this.netAdapter.handleUserLeave(userId, username);
        }

        showToast(`${username} left the game`, 'warning');

        // Remove from lobby
        this.removeLobbyPlayer(userId);
    }

    /**
     * Handle DataChannel opened (UserConnectionBase callback)
     */
    onDataChannelOpen(peerId, dataChannel) {
        console.log('[PartyPhysics] DataChannel opened with', peerId);

        // Forward to NetAdapter for WebRTC setup
        if (this.netAdapter) {
            this.netAdapter.setupWebRTC(peerId, dataChannel);
        }
    }

    /**
     * Select character
     */
    selectCharacter(archetype) {
        this.selectedCharacter = archetype;

        // Update UI
        document.querySelectorAll('.character-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-archetype="${archetype}"]`)?.classList.add('active');

        // Update own player info
        if (this.lobbyPlayers.has(this.agentId)) {
            this.lobbyPlayers.set(this.agentId, {
                name: this.username,
                character: archetype
            });
            this.updateLobbyUI();
        }

        console.log('[PartyPhysics] Selected character:', archetype);
    }

    /**
     * Select mode (host only - UI only for now)
     */
    selectMode(mode) {
        // Check if I'm the host (first player by ID)
        const playerIds = Array.from(this.lobbyPlayers.keys()).sort();
        const hostId = playerIds[0];

        if (hostId !== this.agentId) {
            console.log('[PartyPhysics] Only host can change mode');
            return;
        }

        this.selectedMode = mode;

        // Update UI
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');

        // Show map selection and load maps for this mode
        this.loadMapsForMode(mode);

        console.log('[PartyPhysics] Selected mode:', mode);
    }

    /**
     * Load and display maps for the selected mode
     */
    loadMapsForMode(mode) {
        console.log('[PartyPhysics] loadMapsForMode called with mode:', mode);

        const mapSelection = document.getElementById('mapSelection');
        const mapGrid = document.getElementById('mapGrid');

        if (!mapSelection) {
            console.error('[PartyPhysics] mapSelection element not found!');
            return;
        }
        if (!mapGrid) {
            console.error('[PartyPhysics] mapGrid element not found!');
            return;
        }

        // Show map selection
        mapSelection.classList.remove('hidden');
        console.log('[PartyPhysics] Map selection shown');

        // Get maps for this mode
        const maps = MAPS.getMapsForMode(mode);
        console.log('[PartyPhysics] Found maps:', maps);

        // Clear existing maps
        mapGrid.innerHTML = '';

        // Create map cards
        maps.forEach((map, index) => {
            const card = this.createMapCard(map, index === 0);
            mapGrid.appendChild(card);
        });

        // Auto-select first map
        if (maps.length > 0) {
            this.selectedMapId = maps[0].id;
        }

        console.log('[PartyPhysics] Loaded', maps.length, 'maps for mode:', mode);
    }

    /**
     * Create a map card element
     */
    createMapCard(map, isSelected = false) {
        const card = document.createElement('div');
        card.className = 'map-card' + (isSelected ? ' active' : '');
        card.dataset.mapId = map.id;
        card.onclick = () => this.selectMap(map.id);

        // Determine icon based on map type
        let icon = '🗺️';
        if (map.type === 'circular') icon = '⭕';
        if (map.type === 'rectangular') icon = '▭';
        if (map.type === 'linear') icon = '➡️';

        // Determine difficulty
        let difficulty = 'easy';
        let difficultyText = 'Easy';
        if (map.hazardous || (map.barriers && map.barriers.length > 3)) {
            difficulty = 'hard';
            difficultyText = 'Hard';
        } else if (map.walls || map.barriers) {
            difficulty = 'medium';
            difficultyText = 'Medium';
        }

        card.innerHTML = `
            <div class="map-preview">${icon}</div>
            <div class="map-info">
                <div class="map-name">${map.name}</div>
                <div class="map-description">${map.description || 'Classic arena'}</div>
                <div class="map-difficulty ${difficulty}">${difficultyText}</div>
            </div>
        `;

        return card;
    }

    /**
     * Select a map (host only)
     */
    selectMap(mapId) {
        const playerIds = Array.from(this.lobbyPlayers.keys()).sort();
        const hostId = playerIds[0];

        if (hostId !== this.agentId) {
            console.log('[PartyPhysics] Only host can change map');
            return;
        }

        this.selectedMapId = mapId;

        // Update UI
        document.querySelectorAll('.map-card').forEach(card => {
            card.classList.remove('active');
        });
        document.querySelector(`[data-map-id="${mapId}"]`)?.classList.add('active');

        console.log('[PartyPhysics] Selected map:', mapId);
    }

    /**
     * Broadcast player info to lobby
     */
    broadcastPlayerInfo() {
        this.channel.broadcast('PLAYER_JOIN', {
            peerId: this.agentId,
            name: this.username,
            character: this.selectedCharacter
        });

        this.addLobbyPlayer(this.agentId, this.username, this.selectedCharacter);
    }

    /**
     * Add player to lobby list
     */
    addLobbyPlayer(peerId, name, character) {
        this.lobbyPlayers.set(peerId, { name, character });
        this.updateLobbyUI();
    }

    /**
     * Remove player from lobby list
     */
    removeLobbyPlayer(peerId) {
        this.lobbyPlayers.delete(peerId);
        this.updateLobbyUI();
    }

    /**
     * Update lobby UI
     */
    updateLobbyUI() {
        const playerList = document.getElementById('playerList');
        if (!playerList) return;

        playerList.innerHTML = '';

        // Determine host (first player alphabetically by ID)
        const playerIds = Array.from(this.lobbyPlayers.keys()).sort();
        const hostId = playerIds[0];

        this.lobbyPlayers.forEach((data, peerId) => {
            // Safe check for ARCHETYPES
            const character = data.character || 'bunny';
            const archetype = (typeof ARCHETYPES !== 'undefined' && ARCHETYPES[character]) ?
                ARCHETYPES[character] : { icon: '🐰', name: 'Bunny' };

            const isLocal = peerId === this.agentId;
            const isHost = peerId === hostId;

            const item = document.createElement('div');
            item.className = 'player-item' + (isLocal ? ' local' : '');
            item.innerHTML = `
                <div class="player-name-char">
                    <span class="player-char-icon">${archetype.icon || '🐰'}</span>
                    <span>${data.name}</span>
                </div>
                ${isHost ? '<span class="host-badge">HOST</span>' : ''}
            `;
            playerList.appendChild(item);
        });

        // Update player count
        const playerCountEl = document.getElementById('playerCountValue');
        if (playerCountEl) {
            playerCountEl.textContent = this.lobbyPlayers.size;
        }

        // Show host controls if I'm the host
        if (hostId === this.agentId) {
            document.querySelectorAll('.host-only').forEach(el => {
                el.style.display = '';
            });
        }
    }

    /**
     * Update mode UI
     */
    updateModeUI() {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-mode="${this.selectedMode}"]`)?.classList.add('active');
    }

    /**
     * Show waiting room
     */
    showWaitingRoom() {
        document.getElementById('waitingRoom').classList.remove('hidden');
        document.getElementById('gameUI').classList.add('hidden');
        document.getElementById('finishOverlay').classList.add('hidden');

        if (this.mobileControls) {
            this.mobileControls.hide();
        }
    }

    /**
     * Hide waiting room
     */
    hideWaitingRoom() {
        document.getElementById('waitingRoom').classList.add('hidden');
    }

    /**
     * Start game (host only)
     */
    async hostStartGame() {
        // Use UserConnectionBase.isHost() to check
        if (!this.isHost()) {
            console.warn('[PartyPhysics] Not host, cannot start game');
            showToast('Only host can start the game', 'error');
            return;
        }

        // Allow single player testing
        if (this.lobbyPlayers.size < 1) {
            showToast('Need at least 1 player to start!', 'error');
            return;
        }

        console.log('[PartyPhysics] Host starting game');

        try {
            // Initialize GameAuthority (physics simulation)
            console.log('[PartyPhysics] Initializing GameAuthority...');
            this.authority = new GameAuthority();
            await this.authority.init();
            this.authority.setMode(this.selectedMode);
            console.log('[PartyPhysics] GameAuthority initialized');

            // Add all lobby players to authority
            this.lobbyPlayers.forEach((data, peerId) => {
                this.authority.addPlayer(peerId, data.name, data.character);
                console.log('[PartyPhysics] Added player to authority:', data.name);
            });

            // Start game simulation
            this.authority.startGame();

            // Broadcast to clients
            if (this.netAdapter) {
                this.netAdapter.broadcastGameStart();
            }

            // Start local rendering and game
            await this.onGameStart();

            // Start update loops
            this.startHostUpdateLoop();

            showToast('Game started!', 'success');
            console.log('[PartyPhysics] Game started successfully');

        } catch (error) {
            console.error('[PartyPhysics] Failed to start game:', error);
            showToast('Failed to start game: ' + error.message, 'error');
        }
    }

    /**
     * Game start handler
     */
    async onGameStart() {
        console.log('[PartyPhysics] Game starting');

        try {
            // Hide waiting room
            this.hideWaitingRoom();

            // Show game UI
            document.getElementById('gameUI').classList.remove('hidden');
            document.getElementById('playerStats').classList.remove('hidden');
            document.getElementById('scoreboard').classList.remove('hidden');

            // Show camera panel
            const cameraPanel = document.getElementById('cameraPanel');
            if (cameraPanel) {
                cameraPanel.classList.remove('hidden');
                console.log('[PartyPhysics] Camera panel shown');
            }

            // Create arena in Three.js - use selected map if available
            console.log('[PartyPhysics] Creating arena...');
            const selectedMap = this.selectedMapId ? MAPS.getMapById(this.selectedMapId) : null;
            await this.client.createArena(selectedMap || this.selectedMode);
            console.log('[PartyPhysics] Arena created');

            // Create players in 3D scene
            console.log('[PartyPhysics] Creating player meshes...');
            this.lobbyPlayers.forEach((data, peerId) => {
                const isLocal = peerId === this.agentId;
                this.client.createPlayer(peerId, data.name, data.character, isLocal);
                console.log('[PartyPhysics] Created player mesh:', data.name, isLocal ? '(local)' : '(remote)');
            });

            // Enable input
            this.inputHandler.enable();
            console.log('[PartyPhysics] Input enabled');

            // Show mobile controls if needed
            if (this.mobileControls) {
                this.mobileControls.show();
                console.log('[PartyPhysics] Mobile controls shown');
            }

            // Start input sending loop
            this.startInputLoop();
            console.log('[PartyPhysics] Input loop started');

            showToast('Game started! Good luck!', 'success');
            console.log('[PartyPhysics] onGameStart completed');

        } catch (error) {
            console.error('[PartyPhysics] onGameStart failed:', error);
            showToast('Failed to start game rendering: ' + error.message, 'error');
        }
    }

    /**
     * Start host update loop
     */
    startHostUpdateLoop() {
        let lastTime = performance.now();

        this.updateInterval = setInterval(() => {
            const now = performance.now();
            const dt = (now - lastTime) / 1000;
            lastTime = now;

            // Update authority
            const snapshot = this.authority.update(dt);

            // Send snapshot if generated
            if (snapshot) {
                this.netAdapter.sendSnapshot(snapshot);

                // Also process locally
                if (this.client) {
                    this.client.processSnapshot(snapshot);
                }
            }

            // Update UI
            this.updateGameUI();

            // Check if game finished
            if (this.authority.gameState.phase === 'FINISHED') {
                this.stopHostUpdateLoop();
                const alivePlayers = Array.from(this.authority.gameState.players.values())
                    .filter(p => p.isAlive);
                const winnerId = alivePlayers[0]?.peerId || null;
                this.netAdapter.broadcastGameEnd(winnerId);
                this.onGameEnd(winnerId);
            }
        }, 1000 / 60); // 60Hz
    }

    /**
     * Stop host update loop
     */
    stopHostUpdateLoop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Start input sending loop
     */
    startInputLoop() {
        this.inputInterval = setInterval(() => {
            let input;

            if (this.mobileControls && this.mobileControls.enabled) {
                input = this.mobileControls.getInputPacket();
            } else {
                input = this.inputHandler.getInputState();
            }

            // Send to host
            if (!this.netAdapter.isHost) {
                this.netAdapter.sendInput(input);
            } else if (this.authority) {
                // Host processes own input directly
                this.authority.processInput(this.agentId, input);
            }
        }, 1000 / 30); // 30Hz input rate
    }

    /**
     * Stop input loop
     */
    stopInputLoop() {
        if (this.inputInterval) {
            clearInterval(this.inputInterval);
            this.inputInterval = null;
        }
    }

    /**
     * Update game UI (HP, stamina, scoreboard)
     */
    updateGameUI() {
        if (!this.authority) return;

        const localPlayer = this.authority.gameState.players.get(this.agentId);
        if (localPlayer) {
            // Update HP bar
            const hpPercent = (localPlayer.hp / localPlayer.hpMax) * 100;
            document.getElementById('hpFill').style.width = hpPercent + '%';
            document.getElementById('hpValue').textContent = Math.ceil(localPlayer.hp);

            // Update stamina bar
            const staminaPercent = (localPlayer.stamina / localPlayer.staminaMax) * 100;
            document.getElementById('staminaFill').style.width = staminaPercent + '%';
            document.getElementById('staminaValue').textContent = Math.ceil(localPlayer.stamina);

            // Update ability cooldown
            const cooldownText = localPlayer.abilityCooldown > 0 ?
                `${localPlayer.abilityCooldown.toFixed(1)}s` : 'Ready!';
            document.getElementById('cooldownValue').textContent = cooldownText;
        }

        // Update scoreboard
        this.updateScoreboard();
    }

    /**
     * Update scoreboard
     */
    updateScoreboard() {
        if (!this.authority) return;

        const scoreList = document.getElementById('scoreList');
        if (!scoreList) return;

        scoreList.innerHTML = '';

        // Sort players by HP descending
        const players = Array.from(this.authority.gameState.players.values())
            .sort((a, b) => b.hp - a.hp);

        players.forEach(player => {
            const isLocal = player.peerId === this.agentId;
            const entry = document.createElement('div');
            entry.className = 'score-entry' + (isLocal ? ' local' : '') + (!player.isAlive ? ' eliminated' : '');
            entry.innerHTML = `
                <span class="player-name">${player.name}</span>
                <span class="player-hp">${Math.ceil(player.hp)} HP</span>
            `;
            scoreList.appendChild(entry);
        });
    }

    /**
     * Game end handler
     */
    onGameEnd(winnerId) {
        console.log('[PartyPhysics] Game ended, winner:', winnerId);

        // Stop loops
        this.stopInputLoop();
        this.stopHostUpdateLoop();

        // Disable input
        this.inputHandler.disable();

        // Hide mobile controls
        if (this.mobileControls) {
            this.mobileControls.hide();
        }

        // Show finish overlay
        this.showFinishOverlay(winnerId);
    }

    /**
     * Show finish overlay
     */
    showFinishOverlay(winnerId) {
        const overlay = document.getElementById('finishOverlay');
        const title = document.getElementById('finishTitle');
        const results = document.getElementById('finishResults');

        // Determine winner
        const winner = this.lobbyPlayers.get(winnerId);
        const isLocalWinner = winnerId === this.agentId;

        if (isLocalWinner) {
            title.textContent = '🏆 You Win!';
        } else if (winner) {
            title.textContent = `🏆 ${winner.name} Wins!`;
        } else {
            title.textContent = '🏆 Game Over!';
        }

        // Show results
        results.innerHTML = '';

        if (this.authority) {
            const players = Array.from(this.authority.gameState.players.values())
                .sort((a, b) => {
                    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
                    return b.hp - a.hp;
                });

            players.forEach((player, index) => {
                const isLocal = player.peerId === this.agentId;
                const isWinner = player.peerId === winnerId;
                const entry = document.createElement('div');
                entry.className = 'result-entry' + (isWinner ? ' winner' : '');
                entry.innerHTML = `
                    <span class="result-position">${index + 1}.</span>
                    <span class="result-name">${player.name}</span>
                    <span>${Math.ceil(player.hp)} HP</span>
                `;
                results.appendChild(entry);
            });
        }

        overlay.classList.remove('hidden');
    }

    /**
     * Restart game (host only)
     */
    hostRestartGame() {
        if (!this.authority) return;

        console.log('[PartyPhysics] Restarting game');

        // Hide finish overlay
        document.getElementById('finishOverlay').classList.add('hidden');

        // Reset authority
        this.authority.stopGame();

        // Show waiting room
        this.showWaitingRoom();

        // Cleanup client
        if (this.client) {
            this.client.cleanup();
            this.client.init();
            this.client.startRendering();
        }
    }

    /**
     * Disconnect
     */
    disconnect() {
        console.log('[PartyPhysics] Disconnecting');

        // Stop loops
        this.stopInputLoop();
        this.stopHostUpdateLoop();

        // Disable input
        if (this.inputHandler) {
            this.inputHandler.disable();
        }

        // Cleanup client
        if (this.client) {
            this.client.cleanup();
        }

        // Call parent disconnect
        super.disconnect();
    }
}

// Export for global use
if (typeof window !== 'undefined') {
    window.PartyPhysicsGame = PartyPhysicsGame;
}

// ============================================
// INITIALIZATION
// ============================================

let partyPhysicsGame = null;

// Global showToast helper
function showToast(message, type = 'info', duration = 3000) {
    if (window.MiniGameUtils && window.MiniGameUtils.showToast) {
        window.MiniGameUtils.showToast(message, type, duration);
    } else {
        console.log(`[Toast] ${message}`);
    }
}

// Initialize connection modal
function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'partyPhysics_',
        channelPrefix: 'party-',
        title: '🎉 Join Party Physics',
        collapsedTitle: '🎉 Party Physics',
        onConnect: async function(username, channel, password) {
            await connectPartyPhysics(username, channel, password);
        }
    });
}

// Connect to game
async function connectPartyPhysics(username, channel, password) {
    console.log('[PartyPhysics] Connecting...', { username, channel });

    try {
        // Create game instance if not exists
        if (!partyPhysicsGame) {
            console.log('[PartyPhysics] Creating game instance...');
            partyPhysicsGame = new PartyPhysicsGame();
        }

        // Connect to channel - UserConnectionBase will automatically call this.onConnect() after success
        await partyPhysicsGame.connect({
            username,
            channelName: channel,
            channelPassword: password
        });

        console.log('[PartyPhysics] Connected successfully');


        // Hide connection modal
        if (window.ConnectionModal) {
            window.ConnectionModal.hide();
        }

    } catch (error) {
        console.error('[PartyPhysics] Connection failed:', error);
        if (window.MiniGameUtils && window.MiniGameUtils.showToast) {
            window.MiniGameUtils.showToast('Connection failed: ' + error.message, 'error');
        } else {
            alert('Connection failed: ' + error.message);
        }
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    console.log('[PartyPhysics] Page loaded');

    // Initialize connection modal
    initializeConnectionModal();

    // Process shared link and setup auto-connect using centralized utility
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'PartyPhysics',
            storagePrefix: 'partyPhysics_',
            connectCallback: async function() {
                console.log('[PartyPhysics] Auto-connect triggered');
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectPartyPhysics(username, channel, password);
                } else {
                    console.warn('[PartyPhysics] Auto-connect skipped: missing username or channel');
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

// Export for global use
window.partyPhysicsGame = partyPhysicsGame;

// ============================================
// CAMERA CONTROL PANEL FUNCTIONS
// ============================================

function toggleCameraPanel() {
    const panel = document.getElementById('cameraPanel');
    const toggle = panel.querySelector('.panel-toggle');
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? '+' : '−';
}

function resetCamera() {
    if (!partyPhysicsGame || !partyPhysicsGame.client) return;

    // Reset to defaults
    partyPhysicsGame.client.cameraDistance = 12;
    partyPhysicsGame.client.cameraHeight = 8;
    partyPhysicsGame.client.cameraAngle = 0;
    partyPhysicsGame.client.cameraPitch = 0.5;
    partyPhysicsGame.client.cameraFollowEnabled = true;

    // Update sliders
    document.getElementById('distanceSlider').value = 12;
    document.getElementById('heightSlider').value = 8;
    document.getElementById('pitchSlider').value = 0.5;
    document.getElementById('cameraFollowToggle').checked = true;

    // Update labels
    document.getElementById('distanceValue').textContent = '12';
    document.getElementById('heightValue').textContent = '8';
    document.getElementById('pitchValue').textContent = '0.5';

    console.log('[CameraPanel] Camera reset to defaults');
}

function setupCameraPanel() {
    // Camera follow toggle
    const followToggle = document.getElementById('cameraFollowToggle');
    followToggle.addEventListener('change', (e) => {
        if (partyPhysicsGame && partyPhysicsGame.client) {
            partyPhysicsGame.client.cameraFollowEnabled = e.target.checked;
            console.log('[CameraPanel] Camera follow:', e.target.checked ? 'enabled' : 'disabled');
        }
    });

    // Distance slider
    const distanceSlider = document.getElementById('distanceSlider');
    const distanceValue = document.getElementById('distanceValue');

    distanceSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        distanceValue.textContent = value.toFixed(1);
        if (partyPhysicsGame && partyPhysicsGame.client) {
            partyPhysicsGame.client.cameraDistance = value;
        }
    });

    // Height slider
    const heightSlider = document.getElementById('heightSlider');
    const heightValue = document.getElementById('heightValue');

    heightSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        heightValue.textContent = value.toFixed(1);
        if (partyPhysicsGame && partyPhysicsGame.client) {
            partyPhysicsGame.client.cameraHeight = value;
        }
    });

    // Pitch slider
    const pitchSlider = document.getElementById('pitchSlider');
    const pitchValue = document.getElementById('pitchValue');

    pitchSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        pitchValue.textContent = value.toFixed(1);
        if (partyPhysicsGame && partyPhysicsGame.client) {
            partyPhysicsGame.client.cameraPitch = value;
        }
    });

    // Make camera panel draggable
    const cameraPanel = document.getElementById('cameraPanel');
    const panelHeader = cameraPanel?.querySelector('.panel-header');

    // Stop all mouse events on the panel from reaching the canvas
    if (cameraPanel) {
        cameraPanel.addEventListener('mousedown', (e) => e.stopPropagation());
        cameraPanel.addEventListener('mousemove', (e) => e.stopPropagation());
        cameraPanel.addEventListener('wheel', (e) => e.stopPropagation());
    }

    if (panelHeader && cameraPanel) {
        let isDraggingPanel = false;
        let panelOffsetX = 0;
        let panelOffsetY = 0;

        panelHeader.addEventListener('mousedown', (e) => {
            // Only drag by header, not toggle button
            if (e.target.classList.contains('panel-toggle')) return;

            isDraggingPanel = true;
            panelOffsetX = e.clientX - cameraPanel.offsetLeft;
            panelOffsetY = e.clientY - cameraPanel.offsetTop;
            cameraPanel.classList.add('dragging');
            panelHeader.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDraggingPanel) return;

            const newLeft = e.clientX - panelOffsetX;
            const newTop = e.clientY - panelOffsetY;

            // Keep panel within viewport
            const maxLeft = window.innerWidth - cameraPanel.offsetWidth;
            const maxTop = window.innerHeight - cameraPanel.offsetHeight;

            cameraPanel.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
            cameraPanel.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
            cameraPanel.style.right = 'auto'; // Remove right positioning
        });

        document.addEventListener('mouseup', () => {
            if (isDraggingPanel) {
                isDraggingPanel = false;
                cameraPanel.classList.remove('dragging');
                panelHeader.style.cursor = 'move';
            }
        });

        console.log('[CameraPanel] Panel drag functionality enabled');
    }

    console.log('[CameraPanel] Camera controls initialized');
}

// Initialize camera panel when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    setupCameraPanel();
});

// Show camera panel when game starts
window.addEventListener('game-started', () => {
    const panel = document.getElementById('cameraPanel');
    if (panel) {
        panel.classList.remove('hidden');
    }
});


