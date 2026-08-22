/**
 * GameAuthority.js
 * Host-authoritative game simulation with Rapier physics
 * This module runs only on the HOST and handles all physics, collisions, and game logic
 */

class GameAuthority {
    constructor() {
        this.isInitialized = false;
        this.isRunning = false;

        // Physics world (Rapier)
        this.world = null;
        this.gravity = { x: 0, y: -9.81, z: 0 };

        // Game state
        this.gameState = {
            gameId: this.generateGameId(),
            mode: 'fight',
            phase: 'LOBBY',
            players: new Map(),
            projectiles: [],
            pickups: [],
            eliminations: [],
            randomSeed: Math.floor(Math.random() * 1000000)
        };

        // Physics bodies
        this.playerBodies = new Map(); // peerId -> { body, collider }
        this.arenaBodies = [];
        this.projectileBodies = [];

        // Timing
        this.fixedDt = 1/60; // 60Hz simulation
        this.accumulator = 0;
        this.lastTime = 0;
        this.snapshotRate = 1/20; // 20Hz snapshots
        this.snapshotAccumulator = 0;

        // Input buffer
        this.inputBuffer = new Map(); // peerId -> [inputs]

        // Effect events queued for the next snapshot (ability visuals, hits).
        // The authority decides what happened; clients only render these.
        this.pendingEvents = [];

        console.log('[GameAuthority] Created with gameId:', this.gameState.gameId);
    }

    /**
     * Initialize Rapier physics
     */
    async init() {
        if (this.isInitialized) return;

        console.log('[GameAuthority] Initializing Rapier physics...');
        console.log('[GameAuthority] Initial check - window.RAPIER:', typeof window.RAPIER, window.RAPIER);

        try {
            // Wait for Rapier to load from CDN (loaded as ES module)
            if (typeof window.RAPIER === 'undefined') {
                console.log('[GameAuthority] window.RAPIER is undefined, waiting...');

                // Wait for the rapier-loaded event from the module loader
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        console.error('[GameAuthority] TIMEOUT! Final check - window.RAPIER:', typeof window.RAPIER);
                        reject(new Error('Rapier failed to load from CDN after 15 seconds. Check network connection.'));
                    }, 15000);

                    // Check if already loaded
                    if (typeof window.RAPIER !== 'undefined') {
                        console.log('[GameAuthority] window.RAPIER already loaded!');
                        clearTimeout(timeout);
                        resolve();
                        return;
                    }

                    // Wait for event
                    const eventHandler = () => {
                        console.log('[GameAuthority] rapier-loaded event fired!');
                        console.log('[GameAuthority] window.RAPIER in event handler:', typeof window.RAPIER);
                        clearTimeout(timeout);
                        resolve();
                    };

                    window.addEventListener('rapier-loaded', eventHandler, { once: true });
                    console.log('[GameAuthority] Event listener added for rapier-loaded');

                    // Also poll as backup
                    let attempts = 0;
                    const pollInterval = setInterval(() => {
                        attempts++;

                        if (attempts % 10 === 0) {
                            console.log(`[GameAuthority] Poll ${attempts}: window.RAPIER =`, typeof window.RAPIER);
                        }

                        if (typeof window.RAPIER !== 'undefined') {
                            console.log('[GameAuthority] Rapier detected via polling at attempt', attempts);
                            clearInterval(pollInterval);
                            clearTimeout(timeout);
                            window.removeEventListener('rapier-loaded', eventHandler);
                            resolve();
                        }

                        if (attempts % 20 === 0) {
                            console.log(`[GameAuthority] Still waiting... (${attempts * 100}ms)`);
                        }
                    }, 100);
                });
            }

            console.log('[GameAuthority] Rapier is available!');
            console.log('[GameAuthority] window.RAPIER =', window.RAPIER);

            // Store reference (Rapier is already initialized by the loader)
            const RAPIER = window.RAPIER;

            // Create physics world
            console.log('[GameAuthority] Creating physics world...');
            this.world = new RAPIER.World(this.gravity);
            console.log('[GameAuthority] Physics world created');

            // Configure solver
            this.world.integrationParameters.maxCcdSubsteps = 4;

            console.log('[GameAuthority] Rapier initialized successfully');
            this.isInitialized = true;
        } catch (error) {
            console.error('[GameAuthority] Failed to initialize Rapier:', error);
            console.error('[GameAuthority] Error details:', error.message);
            throw error;
        }
    }

    /**
     * Generate unique game ID
     */
    generateGameId() {
        return 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Set game mode
     */
    setMode(mode) {
        if (['fight', 'dodgeball', 'race'].includes(mode)) {
            this.gameState.mode = mode;
            console.log('[GameAuthority] Mode set to:', mode);
        }
    }

    /**
     * Add player to game
     */
    addPlayer(peerId, username, archetype = 'bunny') {
        const archetypeData = ARCHETYPES[archetype];
        if (!archetypeData) {
            console.error('[GameAuthority] Unknown archetype:', archetype);
            return;
        }

        const player = {
            peerId,
            name: username,
            archetype,
            hp: archetypeData.hpMax,
            hpMax: archetypeData.hpMax,
            stamina: archetypeData.staminaMax,
            staminaMax: archetypeData.staminaMax,
            isAlive: true,
            position: { x: 0, y: 5, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            velocity: { x: 0, y: 0, z: 0 },
            facingAngle: 0, // Y-axis rotation angle (radians) - managed separately from physics
            lastInputSeq: 0,
            abilityCooldown: 0,
            jumpPadCooldown: 0, // Prevent jump pad spam
            stunned: 0,
            charging: 0, // seconds left of Bull's Charge (deals stun on contact)
            buffs: [],
            score: 0
        };

        this.gameState.players.set(peerId, player);
        console.log('[GameAuthority] Player added:', username, archetype);

        return player;
    }

    /**
     * Remove player from game
     */
    removePlayer(peerId) {
        // Remove physics body
        if (this.playerBodies.has(peerId)) {
            const { body } = this.playerBodies.get(peerId);
            this.world.removeRigidBody(body);
            this.playerBodies.delete(peerId);
        }

        // Remove from game state
        this.gameState.players.delete(peerId);
        console.log('[GameAuthority] Player removed:', peerId);
    }

    /**
     * Start game
     */
    startGame() {
        if (this.isRunning) {
            console.warn('[GameAuthority] Game already running');
            return;
        }

        console.log('[GameAuthority] Starting game with mode:', this.gameState.mode);

        // Reset state
        this.gameState.phase = 'RUNNING';
        this.gameState.eliminations = [];

        // Create arena
        this.createArena();

        // Create player physics bodies
        this.createPlayerBodies();

        // Start simulation
        this.isRunning = true;
        this.lastTime = performance.now();

        console.log('[GameAuthority] Game started with', this.gameState.players.size, 'players');
    }

    /**
     * Create arena physics
     */
    createArena() {
        const map = this.selectedMap || MAPS[this.gameState.mode];
        if (!map) return;

        console.log('[GameAuthority] Creating arena:', map.name || this.gameState.mode);

        // Clear existing arena bodies
        this.arenaBodies.forEach(body => this.world.removeRigidBody(body));
        this.arenaBodies = [];

        const RAPIER = window.RAPIER;

        if (map.type === 'circular') {
            // Create circular platform
            const platformDesc = RAPIER.RigidBodyDesc.fixed();
            const platformBody = this.world.createRigidBody(platformDesc);

            const platformShape = RAPIER.ColliderDesc.cylinder(
                map.platform.height / 2,
                map.platform.radius
            ).setTranslation(0, -map.platform.height / 2, 0);

            this.world.createCollider(platformShape, platformBody);
            this.arenaBodies.push(platformBody);

            // Create elevated platforms (for fight mode)
            if (map.elevatedPlatforms) {
                map.elevatedPlatforms.forEach(plat => {
                    const platDesc = RAPIER.RigidBodyDesc.fixed();
                    const platBody = this.world.createRigidBody(platDesc);

                    const platShape = RAPIER.ColliderDesc.cylinder(
                        plat.height / 2,
                        plat.radius
                    ).setTranslation(plat.x, plat.y, plat.z);

                    this.world.createCollider(platShape, platBody);
                    this.arenaBodies.push(platBody);
                });
                console.log('[GameAuthority] Created', map.elevatedPlatforms.length, 'elevated platforms');
            }

            // Create pillars (decorative but solid)
            if (map.pillars) {
                map.pillars.forEach(pillar => {
                    const pillarDesc = RAPIER.RigidBodyDesc.fixed();
                    const pillarBody = this.world.createRigidBody(pillarDesc);

                    const pillarShape = RAPIER.ColliderDesc.cylinder(
                        pillar.height / 2,
                        pillar.radius
                    ).setTranslation(pillar.x, pillar.y, pillar.z);

                    this.world.createCollider(pillarShape, pillarBody);
                    this.arenaBodies.push(pillarBody);
                });
                console.log('[GameAuthority] Created', map.pillars.length, 'pillars');
            }

            console.log('[GameAuthority] Created circular arena, radius:', map.platform.radius);
        } else if (map.type === 'rectangular') {
            // Create rectangular platform
            const platformDesc = RAPIER.RigidBodyDesc.fixed();
            const platformBody = this.world.createRigidBody(platformDesc);

            const platformShape = RAPIER.ColliderDesc.cuboid(
                map.platform.width / 2,
                map.platform.height / 2,
                map.platform.depth / 2
            ).setTranslation(0, -map.platform.height / 2, 0);

            this.world.createCollider(platformShape, platformBody);
            this.arenaBodies.push(platformBody);

            // Create walls
            if (map.walls) {
                map.walls.forEach(wall => {
                    const wallDesc = RAPIER.RigidBodyDesc.fixed();
                    const wallBody = this.world.createRigidBody(wallDesc);

                    const wallShape = RAPIER.ColliderDesc.cuboid(
                        wall.width / 2,
                        wall.height / 2,
                        wall.depth / 2
                    ).setTranslation(wall.x, wall.y, wall.z);

                    this.world.createCollider(wallShape, wallBody);
                    this.arenaBodies.push(wallBody);
                });
                console.log('[GameAuthority] Created', map.walls.length, 'walls');
            }

            // Create barriers (cover in dodgeball mode)
            if (map.barriers) {
                map.barriers.forEach(barrier => {
                    const barrierDesc = RAPIER.RigidBodyDesc.fixed();
                    const barrierBody = this.world.createRigidBody(barrierDesc);

                    const barrierShape = RAPIER.ColliderDesc.cuboid(
                        barrier.width / 2,
                        barrier.height / 2,
                        barrier.depth / 2
                    ).setTranslation(barrier.x, barrier.y, barrier.z);

                    this.world.createCollider(barrierShape, barrierBody);
                    this.arenaBodies.push(barrierBody);
                });
                console.log('[GameAuthority] Created', map.barriers.length, 'barriers');
            }

            console.log('[GameAuthority] Created rectangular arena');
        } else if (map.type === 'linear') {
            // Create race track segments
            if (map.segments) {
                map.segments.forEach(segment => {
                    if (segment.type === 'platform') {
                        const segDesc = RAPIER.RigidBodyDesc.fixed();
                        const segBody = this.world.createRigidBody(segDesc);

                        const segShape = RAPIER.ColliderDesc.cuboid(
                            segment.width / 2,
                            segment.height / 2,
                            segment.depth / 2
                        ).setTranslation(segment.x, segment.y, segment.z);

                        this.world.createCollider(segShape, segBody);
                        this.arenaBodies.push(segBody);

                        // Create obstacle colliders for this segment
                        if (segment.obstacles) {
                            segment.obstacles.forEach(obs => {
                                if (obs.type === 'wall') {
                                    const obsDesc = RAPIER.RigidBodyDesc.fixed();
                                    const obsBody = this.world.createRigidBody(obsDesc);

                                    const obsShape = RAPIER.ColliderDesc.cuboid(
                                        obs.width / 2,
                                        obs.height / 2,
                                        obs.depth / 2
                                    ).setTranslation(obs.x, obs.y, obs.z);

                                    this.world.createCollider(obsShape, obsBody);
                                    this.arenaBodies.push(obsBody);
                                }
                            });
                        }
                    } else if (segment.type === 'gapPlatforms' && segment.platforms) {
                        // Create individual jump platforms
                        segment.platforms.forEach(plat => {
                            const platDesc = RAPIER.RigidBodyDesc.fixed();
                            const platBody = this.world.createRigidBody(platDesc);

                            const platShape = RAPIER.ColliderDesc.cuboid(
                                plat.width / 2,
                                plat.height / 2,
                                plat.depth / 2
                            ).setTranslation(plat.x, plat.y, plat.z);

                            this.world.createCollider(platShape, platBody);
                            this.arenaBodies.push(platBody);
                        });
                    }
                });
                console.log('[GameAuthority] Created race track with', this.arenaBodies.length, 'platforms');
            }
        }
    }

    /**
     * Create player physics bodies
     */
    createPlayerBodies() {
        const map = this.selectedMap || MAPS[this.gameState.mode];
        const spawnPoints = map?.spawnPoints || [{ x: 0, y: 2, z: 0 }];
        let spawnIndex = 0;

        const RAPIER = window.RAPIER;

        this.gameState.players.forEach((player, peerId) => {
            const archetype = ARCHETYPES[player.archetype];
            const spawn = spawnPoints[spawnIndex % spawnPoints.length];
            spawnIndex++;

            // Create dynamic rigid body
            const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(spawn.x, spawn.y, spawn.z)
                .setLinearDamping(2.0)
                .setAngularDamping(4.0)
                .setCcdEnabled(true)
                .lockRotations(); // Lock ALL rotations - we handle facing manually

            const body = this.world.createRigidBody(bodyDesc);

            // Create capsule collider
            const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.3)
                .setDensity(archetype.mass)
                .setFriction(0.5)
                .setRestitution(0.1);

            const collider = this.world.createCollider(colliderDesc, body);

            this.playerBodies.set(peerId, { body, collider });

            // Update player position
            player.position = { x: spawn.x, y: spawn.y, z: spawn.z };
            player.rotation = { x: 0, y: 0, z: 0, w: 1 };
            player.velocity = { x: 0, y: 0, z: 0 };
        });

        console.log('[GameAuthority] Created', this.playerBodies.size, 'player bodies');
    }

    /**
     * Process input from client
     */
    processInput(peerId, input) {
        if (!this.inputBuffer.has(peerId)) {
            this.inputBuffer.set(peerId, []);
        }
        this.inputBuffer.get(peerId).push(input);
    }

    /**
     * Update loop (called by host)
     */
    update(dt) {
        if (!this.isRunning || !this.isInitialized) return null;

        // Fixed timestep accumulator
        this.accumulator += dt;

        while (this.accumulator >= this.fixedDt) {
            this.stepPhysics(this.fixedDt);
            this.accumulator -= this.fixedDt;
        }

        // Snapshot generation
        this.snapshotAccumulator += dt;
        if (this.snapshotAccumulator >= this.snapshotRate) {
            this.snapshotAccumulator = 0;
            return this.generateSnapshot();
        }

        return null;
    }

    /**
     * Step physics simulation
     */
    stepPhysics(dt) {
        // Process inputs
        this.processInputs();

        // Step Rapier world
        this.world.step();

        // Update player states from physics
        this.updatePlayerStates();

        // Check map feature interactions (jump pads, boost pads, etc.)
        this.checkMapFeatures();

        // Resolve active ability states (Bull's Charge contact checks)
        this.updateAbilityStates(dt);

        // Update cooldowns and buffs
        this.updateTimers(dt);

        // Check eliminations
        this.checkEliminations();

        // Check win condition
        this.checkWinCondition();
    }

    /**
     * Check for player interactions with map features
     */
    checkMapFeatures() {
        const map = this.selectedMap || MAPS[this.gameState.mode];
        if (!map) return;

        this.gameState.players.forEach((player, peerId) => {
            if (!player.isAlive) return;

            const playerPhysics = this.playerBodies.get(peerId);
            if (!playerPhysics) return;

            const pos = playerPhysics.body.translation();

            // Check jump pads (Fight mode)
            if (map.jumpPads) {
                map.jumpPads.forEach(pad => {
                    const dx = pos.x - pad.x;
                    const dz = pos.z - pad.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);

                    // Player is on jump pad and cooldown expired
                    if (dist < pad.radius && Math.abs(pos.y - pad.y) < 1 && player.jumpPadCooldown <= 0) {
                        // Apply upward force
                        playerPhysics.body.applyImpulse({ x: 0, y: pad.force, z: 0 }, true);
                        player.jumpPadCooldown = 0.5; // 0.5 second cooldown
                        console.log('[GameAuthority] Player', player.name, 'activated jump pad!');
                    }
                });
            }

            // Check boost pads (Race mode)
            if (map.boostPads) {
                map.boostPads.forEach(pad => {
                    const inX = Math.abs(pos.x - pad.x) < pad.width / 2;
                    const inZ = pos.z > pad.z - pad.depth / 2 && pos.z < pad.z + pad.depth / 2;

                    // Player is on boost pad
                    if (inX && inZ && Math.abs(pos.y - pad.y) < 1) {
                        // Apply forward boost
                        const vel = playerPhysics.body.linvel();
                        playerPhysics.body.setLinvel({
                            x: vel.x,
                            y: vel.y,
                            z: vel.z * pad.speedMultiplier
                        }, true);
                    }
                });
            }

            // Check hazard zones (Race mode - slow down)
            if (map.hazardZones) {
                map.hazardZones.forEach(zone => {
                    const inX = Math.abs(pos.x - zone.x) < zone.width / 2;
                    const inZ = pos.z > zone.z - zone.depth / 2 && pos.z < zone.z + zone.depth / 2;

                    // Player is in hazard zone
                    if (inX && inZ && Math.abs(pos.y - zone.y) < 1) {
                        // Slow down player
                        const vel = playerPhysics.body.linvel();
                        playerPhysics.body.setLinvel({
                            x: vel.x * zone.slowMultiplier,
                            y: vel.y,
                            z: vel.z * zone.slowMultiplier
                        }, true);
                    }
                });
            }

            // Check power zones (Dodgeball mode)
            if (map.powerZones) {
                map.powerZones.forEach(zone => {
                    const dx = pos.x - zone.x;
                    const dz = pos.z - zone.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);

                    // Player is in power zone
                    if (dist < zone.radius && Math.abs(pos.y - zone.y) < 1) {
                        // Apply temporary buff (simplified - just log for now)
                        // TODO: Implement buff system
                        if (!player.buffs) player.buffs = [];
                        const hasBuff = player.buffs.find(b => b.type === zone.type);
                        if (!hasBuff) {
                            player.buffs.push({ type: zone.type, duration: 10 });
                            console.log('[GameAuthority] Player', player.name, 'got', zone.type, 'buff!');
                        }
                    }
                });
            }
        });
    }

    /**
     * Process buffered inputs
     */
    processInputs() {
        this.inputBuffer.forEach((inputs, peerId) => {
            const player = this.gameState.players.get(peerId);
            const playerPhysics = this.playerBodies.get(peerId);

            if (!player || !playerPhysics || !player.isAlive) {
                inputs.length = 0; // Clear inputs
                return;
            }

            const archetype = ARCHETYPES[player.archetype];

            // Process each input
            inputs.forEach(input => {
                if (input.seq <= player.lastInputSeq) return; // Old input
                player.lastInputSeq = input.seq;

                const body = playerPhysics.body;

                // Stunned players (hit by Bull's Charge) can't act — inputs
                // are consumed but ignored until the stun wears off.
                if (player.stunned > 0) return;

                // Update character facing direction (visual only, not physics)
                if (input.moveX !== 0 || input.moveY !== 0) {
                    player.facingAngle = Math.atan2(input.moveX, input.moveY);
                }

                // Movement - walk speed (very slow and controlled)
                if (input.moveX !== 0 || input.moveY !== 0) {
                    const speedMult = this.getBuffMultiplier(player, 'speed');
                    const force = {
                        x: input.moveX * archetype.speed * 0.5 * speedMult,  // Reduced to 0.5 for walk speed
                        y: 0,
                        z: input.moveY * archetype.speed * 0.5 * speedMult
                    };
                    body.applyImpulse(force, true);
                }

                // Jump - gentle jump
                if (input.jump && this.isGrounded(body)) {
                    body.applyImpulse({ x: 0, y: 2, z: 0 }, true);  // Reduced to 2 for slower jump
                }

                // Dash - noticeable but controlled
                if (input.dash && player.stamina >= STAMINA_COSTS.DASH) {
                    player.stamina -= STAMINA_COSTS.DASH;
                    const dashForce = {
                        x: input.moveX * archetype.speed * 8,  // Reduced to 8
                        y: 0.5,  // Reduced to 0.5
                        z: input.moveY * archetype.speed * 8
                    };
                    body.applyImpulse(dashForce, true);
                }

                // Punch
                if (input.punch && player.stamina >= STAMINA_COSTS.PUNCH) {
                    player.stamina -= STAMINA_COSTS.PUNCH;
                    this.performPunch(peerId, archetype);
                }

                // Ability — the client only requests it; the authority checks
                // cooldown AND stamina before anything happens.
                if (input.ability && player.abilityCooldown <= 0 &&
                    player.stamina >= archetype.abilityStaminaCost) {
                    this.performAbility(peerId, archetype);
                }
            });

            // Clear processed inputs
            inputs.length = 0;
        });
    }

    /**
     * Check if body is grounded
     */
    isGrounded(body) {
        // Simple Y velocity check
        const vel = body.linvel();
        return Math.abs(vel.y) < 0.1 && body.translation().y < 3;
    }

    /**
     * Perform punch attack
     */
    performPunch(peerId, archetype) {
        const player = this.gameState.players.get(peerId);
        const playerPhysics = this.playerBodies.get(peerId);
        if (!player || !playerPhysics) return;

        const pos = playerPhysics.body.translation();
        const damage = DAMAGE.PUNCH_BASE * archetype.strength *
            this.getBuffMultiplier(player, 'power');

        // Check for nearby players
        this.gameState.players.forEach((targetPlayer, targetId) => {
            if (targetId === peerId || !targetPlayer.isAlive) return;

            const targetPhysics = this.playerBodies.get(targetId);
            if (!targetPhysics) return;

            const targetPos = targetPhysics.body.translation();
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < 2) { // Punch range
                // Distance falloff: a point-blank punch hits full force, a
                // fingertip graze at max range does ~40% — rewards commitment.
                const falloff = 1 - (dist / 2) * 0.6;

                // Apply damage (target's shield buff, if any, absorbs part)
                this.applyDamage(targetPlayer, damage * falloff);

                // Apply knockback: harder launch + upward pop scaling with
                // strength, so heavy archetypes send victims properly flying.
                const knockback = {
                    x: (dx / dist) * archetype.strength * 26 * falloff,
                    y: (4 + archetype.strength * 3) * falloff,
                    z: (dz / dist) * archetype.strength * 26 * falloff
                };
                targetPhysics.body.applyImpulse(knockback, true);

                // Brief hit spin makes the ragdoll tumble readable.
                targetPhysics.body.applyTorqueImpulse({
                    x: (Math.random() - 0.5) * 4 * falloff,
                    y: (Math.random() - 0.5) * 6 * falloff,
                    z: (Math.random() - 0.5) * 4 * falloff
                }, true);

                console.log('[GameAuthority] Punch hit:', targetPlayer.name,
                    'damage:', (damage * falloff).toFixed(1), 'falloff:', falloff.toFixed(2));
            }
        });
    }

    /**
     * Perform character ability. Host-authoritative: this only runs on the
     * authority, after the cooldown and stamina gates in processInputs.
     * Each ability queues an effect event so every client can render it.
     */
    performAbility(peerId, archetype) {
        const player = this.gameState.players.get(peerId);
        const playerPhysics = this.playerBodies.get(peerId);
        if (!player || !playerPhysics) return;

        // Consume stamina and set cooldown
        player.stamina -= archetype.abilityStaminaCost;
        player.abilityCooldown = archetype.abilityCooldown;

        console.log('[GameAuthority] Ability used:', archetype.abilityName, 'by', player.name);

        switch (archetype.abilityFn) {
            case 'groundSlam': this.abilityGroundSlam(peerId, player, playerPhysics); break;
            case 'blinkDash': this.abilityBlinkDash(peerId, player, playerPhysics); break;
            case 'charge': this.abilityCharge(peerId, player, playerPhysics, archetype); break;
            case 'doubleJump': this.abilityDoubleJump(peerId, player, playerPhysics); break;
            case 'randomBuff': this.abilityRandomBuff(peerId, player, playerPhysics); break;
            default:
                console.warn('[GameAuthority] Unknown ability:', archetype.abilityFn);
        }
    }

    /**
     * Queue an effect event for the next snapshot broadcast.
     */
    emitEvent(event) {
        this.pendingEvents.push(event);
    }

    /**
     * Forward direction from the player's facing angle.
     * facingAngle = atan2(moveX, moveY) and movement maps moveX->x, moveY->z,
     * so forward in world space is (sin(a), 0, cos(a)).
     */
    getFacingDir(player) {
        return {
            x: Math.sin(player.facingAngle),
            z: Math.cos(player.facingAngle)
        };
    }

    /**
     * Multiplier from an active buff of the given type (1 if none).
     */
    getBuffMultiplier(player, type) {
        if (!player.buffs) return 1;
        const buff = player.buffs.find(b => b.type === type && b.mult);
        return buff ? buff.mult : 1;
    }

    /**
     * Apply damage to a player, letting an active shield buff absorb part.
     */
    applyDamage(targetPlayer, amount) {
        const shieldMult = this.getBuffMultiplier(targetPlayer, 'shield');
        targetPlayer.hp -= amount * shieldMult;
    }

    /**
     * Bear - Ground Slam: shockwave around the bear. Everyone nearby takes
     * damage and is launched away, scaled by proximity. The bear itself is
     * driven into the ground for readability.
     */
    abilityGroundSlam(peerId, player, playerPhysics) {
        const RADIUS = 5;
        const pos = playerPhysics.body.translation();

        // Slam the bear down (visible even when nobody is in range)
        playerPhysics.body.applyImpulse({ x: 0, y: -6, z: 0 }, true);

        this.gameState.players.forEach((targetPlayer, targetId) => {
            if (targetId === peerId || !targetPlayer.isAlive) return;
            const targetPhysics = this.playerBodies.get(targetId);
            if (!targetPhysics) return;

            const targetPos = targetPhysics.body.translation();
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > RADIUS) return;

            const falloff = 1 - (dist / RADIUS) * 0.7;
            const ang = Math.random() * Math.PI * 2; // overlap fallback
            const dirX = dist > 0.01 ? dx / dist : Math.cos(ang);
            const dirZ = dist > 0.01 ? dz / dist : Math.sin(ang);

            this.applyDamage(targetPlayer, 18 * falloff);
            targetPhysics.body.applyImpulse({
                x: dirX * 32 * falloff,
                y: 7 * falloff,
                z: dirZ * 32 * falloff
            }, true);
            targetPhysics.body.applyTorqueImpulse({
                x: (Math.random() - 0.5) * 5 * falloff,
                y: (Math.random() - 0.5) * 5 * falloff,
                z: (Math.random() - 0.5) * 5 * falloff
            }, true);
        });

        this.emitEvent({
            type: 'groundSlam', peerId,
            x: pos.x, y: pos.y, z: pos.z, radius: RADIUS
        });
    }

    /**
     * Bunny - Blink Dash: a long, near-instant dash in the facing direction.
     * Velocity is set directly (not an impulse) so the burst length does not
     * depend on current momentum.
     */
    abilityBlinkDash(peerId, player, playerPhysics) {
        const dir = this.getFacingDir(player);
        const vel = playerPhysics.body.linvel();
        const SPEED = 24;

        playerPhysics.body.setLinvel({
            x: dir.x * SPEED,
            y: Math.max(vel.y, 1),
            z: dir.z * SPEED
        }, true);

        const pos = playerPhysics.body.translation();
        this.emitEvent({
            type: 'blinkDash', peerId,
            x: pos.x, y: pos.y, z: pos.z,
            dirX: dir.x, dirZ: dir.z
        });
    }

    /**
     * Bull - Charge: forward burst; while charging, the first player the bull
     * runs into takes damage, is knocked flying, and is stunned (inputs
     * ignored) for 1.5s. Contact is resolved in updateAbilityStates.
     */
    abilityCharge(peerId, player, playerPhysics, archetype) {
        const dir = this.getFacingDir(player);

        playerPhysics.body.applyImpulse({
            x: dir.x * archetype.speed * 22,
            y: 0.5,
            z: dir.z * archetype.speed * 22
        }, true);

        player.charging = 0.9; // seconds of active charge

        const pos = playerPhysics.body.translation();
        this.emitEvent({
            type: 'charge', peerId,
            x: pos.x, y: pos.y, z: pos.z,
            dirX: dir.x, dirZ: dir.z, duration: 0.9
        });
    }

    /**
     * Monkey - Double Jump: an extra jump that works in mid-air. Downward
     * velocity is cancelled first so the second jump is always a crisp hop.
     */
    abilityDoubleJump(peerId, player, playerPhysics) {
        const vel = playerPhysics.body.linvel();
        playerPhysics.body.setLinvel({ x: vel.x, y: Math.max(vel.y, 0), z: vel.z }, true);
        playerPhysics.body.applyImpulse({ x: 0, y: 3, z: 0 }, true);

        const pos = playerPhysics.body.translation();
        this.emitEvent({
            type: 'doubleJump', peerId,
            x: pos.x, y: pos.y, z: pos.z
        });
    }

    /**
     * Frog - Random Buff: one of four boosts, chosen by the authority.
     * speed/power/shield last 6 seconds and hook into movement, punch damage,
     * and damage taken respectively; heal is instant.
     */
    abilityRandomBuff(peerId, player, playerPhysics) {
        const options = [
            { type: 'speed', mult: 1.6, duration: 6 },
            { type: 'power', mult: 1.7, duration: 6 },
            { type: 'shield', mult: 0.4, duration: 6 },
            { type: 'heal' }
        ];
        const pick = options[Math.floor(Math.random() * options.length)];

        if (pick.type === 'heal') {
            player.hp = Math.min(player.hpMax, player.hp + 30);
        } else {
            if (!player.buffs) player.buffs = [];
            // Refresh rather than stack an existing buff of the same type
            const existing = player.buffs.find(b => b.type === pick.type);
            if (existing) {
                existing.duration = pick.duration;
            } else {
                player.buffs.push({ ...pick });
            }
        }

        const pos = playerPhysics.body.translation();
        this.emitEvent({
            type: 'buff', peerId, buff: pick.type,
            duration: pick.duration || 0,
            x: pos.x, y: pos.y, z: pos.z
        });
    }

    /**
     * Resolve active ability states each physics step.
     * Currently: Bull's Charge contact detection.
     */
    updateAbilityStates(dt) {
        this.gameState.players.forEach((player, peerId) => {
            if (player.charging <= 0) return;
            player.charging = Math.max(0, player.charging - dt);
            if (!player.isAlive) { player.charging = 0; return; }

            const chargerPhysics = this.playerBodies.get(peerId);
            if (!chargerPhysics) { player.charging = 0; return; }
            const pos = chargerPhysics.body.translation();

            this.gameState.players.forEach((targetPlayer, targetId) => {
                if (player.charging <= 0) return; // already hit someone
                if (targetId === peerId || !targetPlayer.isAlive) return;
                const targetPhysics = this.playerBodies.get(targetId);
                if (!targetPhysics) return;

                const targetPos = targetPhysics.body.translation();
                const dx = targetPos.x - pos.x;
                const dz = targetPos.z - pos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > 1.6) return;

                // Contact: damage, launch along the impact direction, stun
                const dirX = dist > 0.01 ? dx / dist : 0;
                const dirZ = dist > 0.01 ? dz / dist : 1;
                this.applyDamage(targetPlayer,
                    14 * this.getBuffMultiplier(player, 'power'));
                targetPhysics.body.applyImpulse({
                    x: dirX * 28, y: 5, z: dirZ * 28
                }, true);
                targetPlayer.stunned = 1.5;
                player.charging = 0; // charge ends on first hit

                this.emitEvent({
                    type: 'chargeHit', peerId, targetId,
                    x: targetPos.x, y: targetPos.y, z: targetPos.z
                });
                console.log('[GameAuthority] Charge hit:', targetPlayer.name, 'stunned');
            });
        });
    }

    /**
     * Update player states from physics
     */
    updatePlayerStates() {
        this.playerBodies.forEach((physics, peerId) => {
            const player = this.gameState.players.get(peerId);
            if (!player) return;

            const body = physics.body;
            const pos = body.translation();
            const vel = body.linvel();

            player.position = { x: pos.x, y: pos.y, z: pos.z };
            player.velocity = { x: vel.x, y: vel.y, z: vel.z };

            // Build rotation from facingAngle (Y-axis only, capsule stays upright)
            const halfAngle = player.facingAngle / 2;
            player.rotation = {
                x: 0,
                y: Math.sin(halfAngle),
                z: 0,
                w: Math.cos(halfAngle)
            };
        });
    }

    /**
     * Update timers and cooldowns
     */
    updateTimers(dt) {
        this.gameState.players.forEach(player => {
            // Regenerate stamina
            if (player.stamina < player.staminaMax) {
                const archetype = ARCHETYPES[player.archetype];
                player.stamina = Math.min(
                    player.staminaMax,
                    player.stamina + archetype.staminaRegenRate * dt
                );
            }

            // Update cooldowns
            if (player.abilityCooldown > 0) {
                player.abilityCooldown = Math.max(0, player.abilityCooldown - dt);
            }

            // Update jump pad cooldown
            if (player.jumpPadCooldown > 0) {
                player.jumpPadCooldown = Math.max(0, player.jumpPadCooldown - dt);
            }

            // Update stun (Bull's Charge)
            if (player.stunned > 0) {
                player.stunned = Math.max(0, player.stunned - dt);
            }

            // Tick down and expire buffs (Frog's Random Buff, power zones)
            if (player.buffs && player.buffs.length > 0) {
                player.buffs.forEach(b => { b.duration -= dt; });
                player.buffs = player.buffs.filter(b => b.duration > 0);
            }
        });
    }

    /**
     * Check for eliminations
     */
    checkEliminations() {
        this.gameState.players.forEach((player, peerId) => {
            if (!player.isAlive) return;

            // Check HP
            if (player.hp <= 0) {
                this.eliminatePlayer(peerId, 'hp');
                return;
            }

            // Check out of bounds
            if (player.position.y < DAMAGE.OUT_OF_BOUNDS_Y) {
                this.eliminatePlayer(peerId, 'fall');
            }
        });
    }

    /**
     * Eliminate player
     */
    eliminatePlayer(peerId, reason) {
        const player = this.gameState.players.get(peerId);
        if (!player) return;

        player.isAlive = false;
        this.gameState.eliminations.push({
            peerId,
            name: player.name,
            reason,
            time: Date.now()
        });

        console.log('[GameAuthority] Player eliminated:', player.name, 'reason:', reason);
    }

    /**
     * Check win condition
     */
    checkWinCondition() {
        if (this.gameState.phase !== 'RUNNING') return;

        const alivePlayers = Array.from(this.gameState.players.values())
            .filter(p => p.isAlive);

        // Only check win condition if there are 2+ total players
        // For single player testing, the game continues indefinitely
        if (this.gameState.players.size >= 2 && alivePlayers.length <= 1) {
            this.gameState.phase = 'FINISHED';
            console.log('[GameAuthority] Game finished, winner:', alivePlayers[0]?.name || 'None');
        }
    }

    /**
     * Generate snapshot for clients
     */
    generateSnapshot() {
        const entities = [];

        this.gameState.players.forEach((player, peerId) => {
            entities.push({
                id: peerId,
                type: 'player',
                p: player.position,
                r: player.rotation,
                v: player.velocity,
                hp: player.hp,
                stamina: player.stamina,
                cd: player.abilityCooldown,
                stun: player.stunned,
                alive: player.isAlive
            });
        });

        // Flush queued effect events (abilities, hits) into this snapshot
        const events = this.pendingEvents;
        this.pendingEvents = [];

        return {
            t: Date.now(),
            entities,
            events
        };
    }

    /**
     * Get full state for resync
     */
    getFullState() {
        return {
            gameId: this.gameState.gameId,
            mode: this.gameState.mode,
            phase: this.gameState.phase,
            players: Array.from(this.gameState.players.entries()).map(([id, p]) => ({
                id,
                ...p
            })),
            eliminations: this.gameState.eliminations,
            seed: this.gameState.randomSeed
        };
    }

    /**
     * Stop game
     */
    stopGame() {
        this.isRunning = false;
        this.gameState.phase = 'LOBBY';
        console.log('[GameAuthority] Game stopped');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameAuthority };
}

