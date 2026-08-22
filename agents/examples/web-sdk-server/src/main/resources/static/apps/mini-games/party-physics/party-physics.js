/**
 * party-physics.js
 * Main game class that extends UserConnectionBase
 * Integrates all modules: GameAuthority, GameClient, NetAdapter, InputHandler, MobileControls
 */

// Escapes remote-supplied values (player names) before they are interpolated
// into innerHTML strings, to prevent script injection (XSS).
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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

            // The SDK identifies peers by agent name: DataChannel peerIds and
            // therefore snapshot entity ids and input attribution all use it.
            // Adopt it as this game's player id — it was previously left
            // undefined, which only lined up in solo play.
            this.agentId = (this.channel && this.channel.agentName) || this.username;

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
            // Non-host clients have no authority object; their HUD
            // (HP, stamina, ability cooldown) is driven by snapshots.
            if (!this.netAdapter.isHost) {
                this.updateHUDFromSnapshot(snapshot);
            }
        });

        this.netAdapter.onModeChange((mode) => {
            this.selectedMode = mode;
            this.updateModeUI();
        });

        this.netAdapter.onGameStart((data) => {
            this.applyHostStartData(data);
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
     * Handle user join (UserConnectionBase callback).
     * The SDK passes a detail object { agentName, users, ... } — the agent
     * name doubles as the peer id used by DataChannels and snapshots.
     */
    onUserJoin(detail) {
        const userId = (detail && detail.agentName) ? detail.agentName : detail;
        console.log('[PartyPhysics] User joined:', userId);

        // Forward to NetAdapter
        if (this.netAdapter) {
            this.netAdapter.handleUserJoin(userId, userId);
        }

        showToast(`${userId} joined the game!`, 'info');
    }

    /**
     * Handle user leave (UserConnectionBase callback)
     */
    onUserLeave(detail) {
        const userId = (detail && detail.agentName) ? detail.agentName : detail;
        console.log('[PartyPhysics] User left:', userId);

        // Forward to NetAdapter
        if (this.netAdapter) {
            this.netAdapter.handleUserLeave(userId, userId);
        }

        showToast(`${userId} left the game`, 'warning');

        // Remove from lobby
        this.removeLobbyPlayer(userId);
    }

    /**
     * Handle DataChannel opened (UserConnectionBase callback)
     */
    onDataChannelOpen(peerId) {
        console.log('[PartyPhysics] DataChannel opened with', peerId);

        // The SDK's second argument is the connection time, not the channel —
        // the channel itself lives on the WebRTC helper, keyed by peer.
        if (this.netAdapter) {
            var dc = this.webrtcHelper && this.webrtcHelper.dataChannels
                ? this.webrtcHelper.dataChannels.get(peerId)
                : null;
            this.netAdapter.setupWebRTC(peerId, dc);
        }

        // Guests: if the peer this channel opened with is the room host
        // (per the SDK's join-order rule), remember it — inputs and ability
        // requests are addressed to the host — and tell the host which
        // character we picked so the authority uses the right archetype.
        if (this.netAdapter && !this.isHost()) {
            const hostUser = this.getUserList().find(u => u.isHost);
            if (hostUser && hostUser.name === peerId) {
                this.netAdapter.hostId = peerId;
                this.netAdapter.sendCharSelect(this.selectedCharacter);
            }
        }
    }

    /** The SDK routes DataChannel traffic here; the net layer wants it. */
    onDataChannelMessage(peerId, data) {
        if (this.netAdapter) this.netAdapter.handleDataChannelMessage(peerId, data);
    }

    onDataChannelClose(peerId) {
        if (this.netAdapter) this.netAdapter.teardownWebRTC(peerId);
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

        // Guests tell the host, so the authority spawns the right archetype
        // (with its real stats and special ability)
        if (this.netAdapter && !this.netAdapter.isHost) {
            this.netAdapter.sendCharSelect(archetype);
        }

        console.log('[PartyPhysics] Selected character:', archetype);
    }

    /**
     * A peer told us (the host) which character they picked. The value has
     * already been validated against ARCHETYPES by the net layer, and it is
     * applied only to the sending peer — never on a peer's say-so about
     * someone else. Ignored mid-game.
     */
    setPeerCharacter(peerId, character) {
        if (this.authority && this.authority.isRunning) return;

        const existing = this.lobbyPlayers.get(peerId);
        this.lobbyPlayers.set(peerId, {
            name: existing ? existing.name : peerId,
            character
        });
        this.updateLobbyUI();
        console.log('[PartyPhysics] Peer', peerId, 'selected character:', character);
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
        // Map shape, drawn from the sprite like every other icon on the site.
        let iconName = 'grid';
        if (map.type === 'circular') iconName = 'target';
        if (map.type === 'rectangular') iconName = 'layers';
        if (map.type === 'linear') iconName = 'arrow-right';
        const icon = `<svg class="icon" aria-hidden="true"><use href="#i-${iconName}"></use></svg>`;

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
                    <span>${escapeHtml(data.name)}</span>
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
                this.authority.addPlayer(peerId, data.name, data.character || 'bunny');
                console.log('[PartyPhysics] Added player to authority:', data.name);
            });

            // Start game simulation
            this.authority.startGame();

            // Broadcast to clients, with the authoritative roster (names and
            // characters) plus the chosen map, so guests build the same scene
            if (this.netAdapter) {
                this.netAdapter.broadcastGameStart({
                    players: Array.from(this.lobbyPlayers.entries()).map(([id, p]) => ({
                        peerId: id,
                        name: p.name,
                        character: p.character || 'bunny'
                    })),
                    mode: this.selectedMode,
                    mapId: this.selectedMapId || null
                });
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
     * Merge the host's START_GAME payload (roster, mode, map) into local
     * state before entering the game. Characters are validated against
     * ARCHETYPES; names go through escapeHtml wherever they are rendered.
     */
    applyHostStartData(data) {
        if (!data) return;

        if (Array.isArray(data.players)) {
            data.players.forEach(p => {
                if (!p || typeof p.peerId !== 'string') return;
                const character = (typeof ARCHETYPES !== 'undefined' && ARCHETYPES[p.character]) ?
                    p.character : 'bunny';
                const name = typeof p.name === 'string' ? p.name : p.peerId;
                // Keep my own local choice of name; trust the host for others
                if (p.peerId === this.agentId) return;
                this.lobbyPlayers.set(p.peerId, { name, character });
            });
        }

        if (data.mode === 'fight') {
            this.selectedMode = data.mode;
        }
        if (typeof data.mapId === 'string' && typeof MAPS !== 'undefined' &&
            MAPS.getMapById(data.mapId)) {
            this.selectedMapId = data.mapId;
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

            // Label the ability slot with this character's special and its
            // trigger, so the ability is discoverable in game.
            const myArchetype = (typeof ARCHETYPES !== 'undefined') ?
                ARCHETYPES[this.selectedCharacter] : null;
            const abilityLabel = document.getElementById('abilityLabel');
            if (abilityLabel && myArchetype) {
                abilityLabel.textContent = myArchetype.abilityName;
            }
            const abilityKey = document.getElementById('abilityKey');
            if (abilityKey) {
                abilityKey.textContent = this.mobileControls ? 'Ability' : 'Q';
            }
            this.updateAbilityHUD(0);

            // Tell the local player which random buff they rolled (Frog)
            if (this.client) {
                this.client.onLocalBuff = (buffType) => {
                    const names = {
                        speed: 'Random Buff: speed boost!',
                        power: 'Random Buff: power boost!',
                        shield: 'Random Buff: shield!',
                        heal: 'Random Buff: healed 30 HP!'
                    };
                    showToast(names[buffType] || 'Random Buff!', 'success', 2500);
                };
            }

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
                this.client.createPlayer(peerId, data.name, data.character || 'bunny', isLocal);
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
            // Hit feedback: my HP just dropped → red flash + thud + HP shake.
            if (this._prevHp !== undefined && localPlayer.hp < this._prevHp - 0.5) {
                this.flashHit();
            }
            this._prevHp = localPlayer.hp;

            // Update HP bar
            const hpPercent = (localPlayer.hp / localPlayer.hpMax) * 100;
            document.getElementById('hpFill').style.width = hpPercent + '%';
            document.getElementById('hpValue').textContent = Math.ceil(localPlayer.hp);

            // Update stamina bar
            const staminaPercent = (localPlayer.stamina / localPlayer.staminaMax) * 100;
            document.getElementById('staminaFill').style.width = staminaPercent + '%';
            document.getElementById('staminaValue').textContent = Math.ceil(localPlayer.stamina);

            // Update ability cooldown
            this.updateAbilityHUD(localPlayer.abilityCooldown);
        }

        // Update scoreboard
        this.updateScoreboard();
    }

    /**
     * Update the ability slot in the HUD: "Ready" in green when usable,
     * remaining seconds in orange while cooling down.
     */
    updateAbilityHUD(cooldown) {
        const el = document.getElementById('cooldownValue');
        if (!el) return;

        if (cooldown > 0) {
            el.textContent = cooldown.toFixed(1) + 's';
            el.className = 'ability-cooling';
        } else {
            el.textContent = 'Ready';
            el.className = 'ability-ready';
        }
    }

    /**
     * Drive the HUD from a host snapshot (non-host clients only; the host
     * reads its own authority state in updateGameUI instead).
     */
    updateHUDFromSnapshot(snapshot) {
        if (!snapshot || !snapshot.entities) return;

        const me = snapshot.entities.find(e => e.id === this.agentId);
        if (!me) return;

        // Hit feedback, same rule as the host path
        if (this._prevHp !== undefined && me.hp < this._prevHp - 0.5) {
            this.flashHit();
        }
        this._prevHp = me.hp;

        const archetype = (typeof ARCHETYPES !== 'undefined') ?
            ARCHETYPES[this.selectedCharacter] : null;
        const hpMax = archetype ? archetype.hpMax : 100;
        const staminaMax = archetype ? archetype.staminaMax : 100;

        const hpFill = document.getElementById('hpFill');
        if (hpFill) hpFill.style.width = Math.max(0, (me.hp / hpMax) * 100) + '%';
        const hpValue = document.getElementById('hpValue');
        if (hpValue) hpValue.textContent = Math.ceil(Math.max(0, me.hp));

        const staminaFill = document.getElementById('staminaFill');
        if (staminaFill) staminaFill.style.width = Math.max(0, (me.stamina / staminaMax) * 100) + '%';
        const staminaValue = document.getElementById('staminaValue');
        if (staminaValue) staminaValue.textContent = Math.ceil(Math.max(0, me.stamina));

        this.updateAbilityHUD(me.cd || 0);

        // Scoreboard for guests, from the same snapshot. Names are
        // remote-supplied, so they go through escapeHtml.
        const scoreList = document.getElementById('scoreList');
        if (scoreList) {
            const rows = snapshot.entities.slice().sort((a, b) => b.hp - a.hp);
            scoreList.innerHTML = rows.map(e => {
                const info = this.lobbyPlayers.get(e.id);
                const name = info ? info.name : e.id;
                const cls = 'score-entry' +
                    (e.id === this.agentId ? ' local' : '') +
                    (!e.alive ? ' eliminated' : '');
                return `<div class="${cls}">` +
                    `<span class="player-name">${escapeHtml(name)}</span>` +
                    `<span class="player-hp">${Math.ceil(Math.max(0, e.hp))} HP</span>` +
                    `</div>`;
            }).join('');
        }
    }

    /**
     * Hit feedback: red vignette flash, thud sound, and HP bar shake.
     * Purely local — driven by observing my own HP drop in the game state.
     */
    flashHit() {
        const el = document.createElement('div');
        el.style.cssText =
            'position:fixed;inset:0;pointer-events:none;z-index:9999;' +
            'background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(200,30,30,0.45) 100%);' +
            'transition:opacity 380ms ease-out;';
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '0'; });
        setTimeout(() => el.remove(), 480);

        const hpBar = document.getElementById('hpFill');
        if (hpBar && hpBar.animate) {
            hpBar.animate([
                { transform: 'translateX(0)' },
                { transform: 'translateX(-5px)' },
                { transform: 'translateX(5px)' },
                { transform: 'translateX(0)' },
            ], { duration: 250, easing: 'ease-in-out' });
        }
        if (window.GameKit) GameKit.Sfx.thud();
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
                <span class="player-name">${escapeHtml(player.name)}</span>
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
            title.textContent = 'You Win!';
        } else if (winner) {
            title.textContent = `${winner.name} Wins!`;
        } else {
            title.textContent = 'Game Over!';
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
                    <span class="result-name">${escapeHtml(player.name)}</span>
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

    /**
     * Open the shared room-invite modal (same one fall-guys and race-balls use).
     * The header Share button calls this; it previously did not exist and threw.
     */
    openShareModal() {
        if (!this.connected) {
            if (window.MiniGameUtils && MiniGameUtils.showToast) {
                MiniGameUtils.showToast('Connect first to share', 'warning');
            }
            return;
        }
        if (typeof ShareModal !== 'undefined' && ShareModal.show) {
            ShareModal.show(this.channelName, this.channelPassword, '');
        } else {
            console.warn('[PartyPhysics] ShareModal not available');
        }
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
        title: 'Join Party Physics',
        collapsedTitle: 'Party Physics',
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
            // The export at the bottom of this file runs at load time, when the
            // instance does not exist yet — publish it here, where it does.
            window.partyPhysicsGame = partyPhysicsGame;
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
        if (window.ConnectionModal) ConnectionModal.fail(error);
        if (window.MiniGameUtils && window.MiniGameUtils.showToast) {
            window.MiniGameUtils.showToast('Connection failed: ' + error.message, 'error');
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

// Export for global use. The instance is published in connect(), which is the
// only place it exists; this line just declares the slot.
window.partyPhysicsGame = window.partyPhysicsGame || partyPhysicsGame;

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


