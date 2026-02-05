/**
 * Mini Fall Guys - Multiplayer Obstacle Race Game
 * Built with Three.js + Cannon.js (cannon-es) Physics
 */

// ============================================
// PHYSICS CONSTANTS
// ============================================
const PHYSICS = {
    gravity: -25,           // Gravity - lighter for rabbit-like hops
    playerMass: 3,          // Player body mass - lighter for bouncy feel
    playerSpeed: 20,        // Movement force (base value)
    jumpForce: 12,          // Jump impulse for manual jumps
    kickForce: 20,          // Kick impulse
    groundFriction: 0.8,    // Ground material friction - high for good grip
    playerFriction: 0.1,    // Player material friction
    restitution: 0.0,       // NO bounce - prevents fusing through surfaces
    linearDamping: 0.1,     // Low air resistance for momentum preservation
    angularDamping: 0.99,   // Rotation damping (keep upright)
    maxSpeed: 14,           // Max horizontal velocity

    // Movement control tuning - momentum-based physics
    groundAcceleration: 0.4,    // Ground movement acceleration
    groundDeceleration: 0.2,    // How fast player slows down when not moving
    airAcceleration: 0.02,      // Air movement control - very low for realistic air physics
    airMaxInfluence: 0.08,      // Maximum speed change allowed while airborne

    // RABBIT HOP RUNNING SYSTEM
    rabbitHopEnabled: true,     // Enable rabbit hop running
    rabbitHopInterval: 0.28,    // Time between hops (seconds) - rabbit rhythm
    rabbitHopForce: 6.0,        // Vertical force for hop - significant bounce
    rabbitHopMinSpeed: 1.5,     // Minimum speed to trigger hop
    rabbitHopSpeedBoost: 1.15,  // Speed multiplier during hop for forward momentum
    rabbitHopCrouchTime: 0.08,  // Brief crouch before hop (visual)

    // Jump timing
    jumpCooldownTime: 0.2,      // Cooldown between manual jumps
    coyoteTime: 0.1,            // Grace period after leaving ground
    jumpBufferTime: 0.1,        // Buffer time for jump input before landing

    // Momentum preservation
    momentumRetention: 0.995,   // Very high momentum retention in air
    landingMomentumLoss: 0.05,  // Small speed loss on landing

    // COLLISION CONSTANTS - Prevent fusing through world
    contactStiffness: 1e10,     // Very high stiffness prevents penetration
    contactRelaxation: 3,       // Lower relaxation = snappier response
    solverIterations: 30        // More iterations for accurate collision
};

// ============================================
// PHYSICS WORLD (Cannon.js)
// ============================================
class PhysicsWorld {
    constructor() {
        console.log('[Physics] Creating Cannon.js world...');

        // Create Cannon.js world
        this.world = new CANNON.World();
        this.world.gravity.set(0, PHYSICS.gravity, 0);

        // Use SAP broadphase for better performance with many objects
        this.world.broadphase = new CANNON.SAPBroadphase(this.world);

        // Higher solver iterations for accurate collision detection - prevents fusing
        this.world.solver.iterations = PHYSICS.solverIterations;

        // Default contact material settings - VERY STIFF to prevent penetration
        this.world.defaultContactMaterial.contactEquationStiffness = PHYSICS.contactStiffness;
        this.world.defaultContactMaterial.contactEquationRelaxation = PHYSICS.contactRelaxation;
        this.world.defaultContactMaterial.friction = 0.5;
        this.world.defaultContactMaterial.restitution = 0;

        // Materials
        this.groundMaterial = new CANNON.Material('ground');
        this.playerMaterial = new CANNON.Material('player');
        this.obstacleMaterial = new CANNON.Material('obstacle');

        // Contact: Player vs Ground - EXTREMELY SOLID, no penetration
        const playerGroundContact = new CANNON.ContactMaterial(
            this.playerMaterial,
            this.groundMaterial,
            {
                friction: PHYSICS.groundFriction,
                restitution: PHYSICS.restitution,
                contactEquationStiffness: PHYSICS.contactStiffness,
                contactEquationRelaxation: PHYSICS.contactRelaxation
            }
        );
        this.world.addContactMaterial(playerGroundContact);

        // Contact: Player vs Obstacle - solid with slight bounce
        const playerObstacleContact = new CANNON.ContactMaterial(
            this.playerMaterial,
            this.obstacleMaterial,
            {
                friction: 0.3,
                restitution: 0.4,  // Some bounce off obstacles
                contactEquationStiffness: PHYSICS.contactStiffness,
                contactEquationRelaxation: PHYSICS.contactRelaxation
            }
        );
        this.world.addContactMaterial(playerObstacleContact);

        // Contact: Player vs Player - solid contact for kicks
        const playerPlayerContact = new CANNON.ContactMaterial(
            this.playerMaterial,
            this.playerMaterial,
            {
                friction: 0.4,
                restitution: 0.2,
                contactEquationStiffness: PHYSICS.contactStiffness,
                contactEquationRelaxation: PHYSICS.contactRelaxation
            }
        );
        this.world.addContactMaterial(playerPlayerContact);

        // Contact: Ground vs Ground - solid, no bounce
        const groundGroundContact = new CANNON.ContactMaterial(
            this.groundMaterial,
            this.groundMaterial,
            {
                friction: 0.6,
                restitution: 0.0,
                contactEquationStiffness: PHYSICS.contactStiffness,
                contactEquationRelaxation: PHYSICS.contactRelaxation
            }
        );
        this.world.addContactMaterial(groundGroundContact);

        this.bodies = [];
        console.log('[Physics] Cannon.js world created with anti-penetration settings');
    }

    addBody(body) {
        this.world.addBody(body);
        this.bodies.push(body);
    }

    removeBody(body) {
        this.world.removeBody(body);
        const idx = this.bodies.indexOf(body);
        if (idx !== -1) this.bodies.splice(idx, 1);
    }

    step(deltaTime) {
        // Fixed timestep for stability
        this.world.step(1/60, deltaTime, 3);
    }
}

// ============================================
// PLAYER CHARACTER CLASS (with Cannon.js physics)
// ============================================
class PlayerCharacter {
    constructor(scene, physicsWorld, colorIndex, username, isLocal = false) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.username = username;
        this.isLocal = isLocal;
        this.colorIndex = colorIndex;
        this.color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
        this.face = PLAYER_FACES[colorIndex % PLAYER_FACES.length];

        // State
        this.isGrounded = false;
        this.isKicking = false;
        this.kickCooldown = 0;
        this.stunned = 0;
        this.canJump = true;
        this.jumpCooldown = 0;
        this.isJumping = false;  // Prevents multi-jump
        this.rotation = 0;  // Y-axis rotation for character facing direction
        this.lastGroundCollision = 0;  // Track last time we touched ground

        // Physics state for momentum-based movement
        this.lastGroundedTime = 0;        // For coyote time implementation
        this.jumpBuffered = false;         // Jump input buffering
        this.jumpBufferTimer = 0;          // Timer for jump buffer
        this.wasGrounded = false;          // Track grounded state changes for landing detection
        this.horizontalMomentum = { x: 0, z: 0 }; // Preserved momentum while airborne
        this.targetVelocity = { x: 0, z: 0 };     // Desired velocity based on input

        // RABBIT HOP state
        this.rabbitHopTimer = 0;           // Timer for rabbit hop cycle
        this.isHopping = false;            // Currently in a hop
        this.hopPhase = 'ready';           // 'ready', 'crouch', 'airborne', 'landing'
        this.crouchTimer = 0;              // Timer for crouch animation before hop

        // Race state
        this.finished = false;
        this.finishTime = 0;
        this.finishPosition = 0;

        // Create physics body and 3D model
        this.createPhysicsBody();
        this.createModel();
    }

    createPhysicsBody() {
        // Use a simple sphere shape for reliability
        const radius = 0.6;
        const shape = new CANNON.Sphere(radius);

        this.body = new CANNON.Body({
            mass: PHYSICS.playerMass,
            material: this.physicsWorld.playerMaterial
        });

        // Apply damping after creation (for compatibility)
        this.body.linearDamping = PHYSICS.linearDamping;
        this.body.angularDamping = PHYSICS.angularDamping;
        this.body.fixedRotation = true;  // Prevent toppling over

        this.body.addShape(shape);
        this.body.position.set(0, 3, 0);

        // Ground contact detection
        this.body.addEventListener('collide', (e) => {
            // Check if collision is from below (ground)
            const contact = e.contact;
            if (contact) {
                const normal = contact.ni;
                // If normal points mostly upward, we're on ground
                // Use absolute value check for normal direction
                if (normal && Math.abs(normal.y) > 0.5) {
                    // Only mark grounded if we're not moving upward fast (jumping)
                    if (this.body.velocity.y < 5) {
                        this.isGrounded = true;
                        this.canJump = true;
                        this.isJumping = false;  // Reset jump when we touch ground
                        this.lastGroundCollision = Date.now();  // Record collision time
                    }
                }
            }
        });

        this.physicsWorld.addBody(this.body);
    }

    createModel() {
        this.group = new THREE.Group();

        // Body (capsule-like shape using sphere + cylinder + sphere)
        const bodyMaterial = new THREE.MeshPhongMaterial({
            color: this.color.body,
            shininess: 30
        });

        // Main body cylinder
        const bodyGeometry = new THREE.CylinderGeometry(0.5, 0.6, 1.2, 16);
        this.bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
        this.bodyMesh.position.y = 0.6;
        this.bodyMesh.castShadow = true;
        this.group.add(this.bodyMesh);

        // Head (sphere)
        const headGeometry = new THREE.SphereGeometry(0.45, 16, 16);
        this.head = new THREE.Mesh(headGeometry, bodyMaterial);
        this.head.position.y = 1.5;
        this.head.castShadow = true;
        this.group.add(this.head);

        // Face (simple plane with eyes)
        this.createFace();

        // Feet
        const footMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
        const footGeometry = new THREE.SphereGeometry(0.2, 8, 8);

        this.leftFoot = new THREE.Mesh(footGeometry, footMaterial);
        this.leftFoot.position.set(-0.25, 0.1, 0);
        this.leftFoot.scale.set(1, 0.6, 1.3);
        this.group.add(this.leftFoot);

        this.rightFoot = new THREE.Mesh(footGeometry, footMaterial);
        this.rightFoot.position.set(0.25, 0.1, 0);
        this.rightFoot.scale.set(1, 0.6, 1.3);
        this.group.add(this.rightFoot);

        // Arms (small spheres)
        this.leftArm = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 8, 8),
            bodyMaterial
        );
        this.leftArm.position.set(-0.6, 0.8, 0);
        this.group.add(this.leftArm);

        this.rightArm = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 8, 8),
            bodyMaterial
        );
        this.rightArm.position.set(0.6, 0.8, 0);
        this.group.add(this.rightArm);

        // Username label
        this.createNameLabel();

        // Add to scene
        this.scene.add(this.group);
    }

    createFace() {
        // Create canvas for face texture
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Background (transparent)
        ctx.clearRect(0, 0, 128, 128);

        // Draw eyes
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.face.eyes, 64, 64);

        // Create texture
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        // Create face plane
        const faceMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });
        const faceGeometry = new THREE.PlaneGeometry(0.6, 0.6);
        this.facePlane = new THREE.Mesh(faceGeometry, faceMaterial);
        this.facePlane.position.set(0, 1.5, 0.46);
        this.group.add(this.facePlane);
    }

    createNameLabel() {
        // Create canvas for name
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.roundRect(0, 10, 256, 44, 10);
        ctx.fill();

        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const displayName = this.username.length > 12
            ? this.username.substring(0, 12) + '...'
            : this.username;
        ctx.fillText(displayName, 128, 32);

        // Create texture and sprite
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        this.nameSprite = new THREE.Sprite(spriteMaterial);
        this.nameSprite.position.y = 2.3;
        this.nameSprite.scale.set(2, 0.5, 1);
        this.group.add(this.nameSprite);
    }

    update(deltaTime, inputState, platforms, obstacles, otherPlayers) {
        if (this.finished) {
            this.animateIdle(deltaTime);
            return;
        }

        // Reduce cooldowns
        if (this.kickCooldown > 0) this.kickCooldown -= deltaTime;
        if (this.jumpCooldown > 0) this.jumpCooldown -= deltaTime;
        if (this.jumpBufferTimer > 0) this.jumpBufferTimer -= deltaTime;
        if (this.rabbitHopTimer > 0) this.rabbitHopTimer -= deltaTime;

        if (this.stunned > 0) {
            this.stunned -= deltaTime;
            // Visual shake when stunned
            this.group.position.x = this.body.position.x + (Math.random() - 0.5) * 0.1;
            this.group.position.y = this.body.position.y;
            this.group.position.z = this.body.position.z;
            return;
        }

        // Store previous grounded state for landing detection
        this.wasGrounded = this.isGrounded;

        // Ground state management - trust collision events
        const verticalVelocity = this.body.velocity.y;
        const now = Date.now();
        const timeSinceGroundTouch = now - this.lastGroundCollision;

        // If we recently touched ground (collision event), we're grounded
        if (timeSinceGroundTouch < 80) {
            if (verticalVelocity < 4) {  // Not actively jumping upward fast
                this.isGrounded = true;
                this.lastGroundedTime = now;
            }
        } else if (timeSinceGroundTouch > 120) {
            // No recent collision - check if falling
            if (verticalVelocity < -1) {
                this.isGrounded = false;
            }
        }

        // Coyote time - allow jumping shortly after leaving ground
        const timeSinceGrounded = now - this.lastGroundedTime;
        const inCoyoteTime = !this.isGrounded && timeSinceGrounded < PHYSICS.coyoteTime * 1000;
        this.canJump = this.isGrounded || inCoyoteTime;

        // Detect landing (transition from air to ground)
        if (this.isGrounded && !this.wasGrounded) {
            this.onLanding();
        }

        // Apply input (only for local player)
        if (this.isLocal && inputState) {
            this.applyInput(inputState, deltaTime);
        }

        // Apply momentum preservation in air
        if (!this.isGrounded) {
            // Preserve horizontal momentum with slight decay
            this.body.velocity.x *= PHYSICS.momentumRetention;
            this.body.velocity.z *= PHYSICS.momentumRetention;
        }

        // Limit max horizontal speed (with different limits for ground vs air)
        const vel = this.body.velocity;
        const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        const effectiveMaxSpeed = this.isGrounded ? PHYSICS.maxSpeed : PHYSICS.maxSpeed * 1.2; // Allow slightly higher speed in air to preserve momentum
        if (horizontalSpeed > effectiveMaxSpeed) {
            const scale = effectiveMaxSpeed / horizontalSpeed;
            this.body.velocity.x *= scale;
            this.body.velocity.z *= scale;
        }

        // Sync Three.js mesh with Cannon.js body (use set() for compatibility)
        const bodyPos = this.body.position;
        this.group.position.set(bodyPos.x, bodyPos.y, bodyPos.z);

        // Rotate towards movement direction (smoother rotation)
        if (Math.abs(vel.x) > 0.5 || Math.abs(vel.z) > 0.5) {
            const targetRotation = Math.atan2(vel.x, vel.z);
            // Slower rotation while airborne for more realistic feel
            const rotationSpeed = this.isGrounded ? 0.15 : 0.08;
            this.rotation = this.lerpAngle(this.rotation, targetRotation, rotationSpeed);
        }
        this.group.rotation.y = this.rotation;

        // Check for player collisions (kicking)
        if (this.isLocal && otherPlayers) {
            this.handlePlayerCollisions(otherPlayers);
        }

        // Animate
        this.animate(deltaTime);
    }

    applyInput(input, deltaTime) {
        // Calculate desired movement direction
        let moveX = 0;
        let moveZ = 0;

        if (input.forward) moveZ = -1;
        if (input.backward) moveZ = 1;
        if (input.left) moveX = -1;
        if (input.right) moveX = 1;

        // Normalize diagonal movement
        if (moveX !== 0 && moveZ !== 0) {
            const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
            moveX /= length;
            moveZ /= length;
        }

        const hasMovementInput = moveX !== 0 || moveZ !== 0;

        // RABBIT HOP SYSTEM - continuous hopping while movement keys are held
        if (this.isGrounded && hasMovementInput && PHYSICS.rabbitHopEnabled) {
            // Calculate target velocity
            this.targetVelocity.x = moveX * PHYSICS.maxSpeed;
            this.targetVelocity.z = moveZ * PHYSICS.maxSpeed;

            // Always accelerate towards target on ground
            const accelFactor = PHYSICS.groundAcceleration;
            this.body.velocity.x += (this.targetVelocity.x - this.body.velocity.x) * accelFactor;
            this.body.velocity.z += (this.targetVelocity.z - this.body.velocity.z) * accelFactor;

            // Reset hop phase to ready when grounded (in case it was airborne)
            if (this.hopPhase === 'airborne') {
                this.hopPhase = 'ready';
                this.rabbitHopTimer = 0;
                this.isHopping = false;
            }

            // Start crouch if ready and timer expired
            if (this.hopPhase === 'ready' && this.rabbitHopTimer <= 0) {
                this.hopPhase = 'crouch';
                this.crouchTimer = PHYSICS.rabbitHopCrouchTime;
            }

            // Handle crouch phase
            if (this.hopPhase === 'crouch') {
                this.crouchTimer -= deltaTime;
                if (this.crouchTimer <= 0) {
                    // Execute the hop!
                    this.body.velocity.y = PHYSICS.rabbitHopForce;
                    this.body.velocity.x = this.targetVelocity.x * PHYSICS.rabbitHopSpeedBoost;
                    this.body.velocity.z = this.targetVelocity.z * PHYSICS.rabbitHopSpeedBoost;
                    this.isHopping = true;
                    this.hopPhase = 'airborne';
                    this.isGrounded = false;
                    this.rabbitHopTimer = PHYSICS.rabbitHopInterval;
                }
            }
        } else if (this.isGrounded && !hasMovementInput) {
            // No movement input while grounded - decelerate
            const decelFactor = 1 - PHYSICS.groundDeceleration;
            this.body.velocity.x *= decelFactor;
            this.body.velocity.z *= decelFactor;

            if (Math.abs(this.body.velocity.x) < 0.1) this.body.velocity.x = 0;
            if (Math.abs(this.body.velocity.z) < 0.1) this.body.velocity.z = 0;

            // Reset hop state
            this.hopPhase = 'ready';
            this.isHopping = false;
        } else if (!this.isGrounded) {
            // IN AIR: Very limited control - preserve momentum
            if (hasMovementInput) {
                const maxAirInfluence = PHYSICS.maxSpeed * PHYSICS.airMaxInfluence;
                const airAccel = PHYSICS.airAcceleration;
                const desiredChangeX = moveX * PHYSICS.maxSpeed * airAccel;
                const desiredChangeZ = moveZ * PHYSICS.maxSpeed * airAccel;

                const actualChangeX = Math.max(-maxAirInfluence, Math.min(maxAirInfluence, desiredChangeX));
                const actualChangeZ = Math.max(-maxAirInfluence, Math.min(maxAirInfluence, desiredChangeZ));

                this.body.velocity.x += actualChangeX;
                this.body.velocity.z += actualChangeZ;
            }
        }

        // Manual jump handling (separate from rabbit hop)
        if (input.jump) {
            this.jumpBuffered = true;
            this.jumpBufferTimer = PHYSICS.jumpBufferTime;
        }

        // Execute manual jump if buffered and can jump (higher than rabbit hop)
        if (this.jumpBuffered && this.canJump && this.jumpCooldown <= 0 && !this.isJumping) {
            // Manual jump is stronger than rabbit hop
            this.body.velocity.y = PHYSICS.jumpForce;

            this.canJump = false;
            this.isGrounded = false;
            this.isJumping = true;
            this.isHopping = false;
            this.jumpBuffered = false;
            this.jumpCooldown = PHYSICS.jumpCooldownTime;
            this.rabbitHopTimer = 0;
            this.hopPhase = 'airborne';

            // Preserve horizontal momentum
            this.horizontalMomentum.x = this.body.velocity.x;
            this.horizontalMomentum.z = this.body.velocity.z;
        }

        // Clear jump buffer if expired
        if (this.jumpBufferTimer <= 0) {
            this.jumpBuffered = false;
        }

        // Kick
        if (input.kick && this.kickCooldown <= 0) {
            this.performKick();
        }
    }


    /**
     * Called when player lands on ground
     */
    onLanding() {
        this.isJumping = false;
        this.canJump = true;
        this.lastGroundedTime = Date.now();

        // Handle rabbit hop landing - immediately ready for next hop
        this.isHopping = false;
        this.hopPhase = 'ready';  // Immediately ready for next hop
        this.rabbitHopTimer = 0;  // Reset timer so next hop can start immediately

        // Apply slight momentum loss on landing for realistic feel
        const momentumRetain = 1 - PHYSICS.landingMomentumLoss;
        this.body.velocity.x *= momentumRetain;
        this.body.velocity.z *= momentumRetain;

        // Small vertical velocity absorption to prevent bouncing
        if (this.body.velocity.y < 0) {
            this.body.velocity.y = 0;
        }

        // Execute buffered jump immediately if player was holding jump while landing
        if (this.jumpBuffered && this.jumpBufferTimer > 0) {
            // Will be processed in next applyInput call
        }
    }

    performKick() {
        this.isKicking = true;
        this.kickCooldown = 0.5;

        // Kick animation
        setTimeout(() => {
            this.isKicking = false;
        }, 200);
    }

    handlePlayerCollisions(otherPlayers) {
        if (!this.isKicking) return null;

        const myPos = this.body.position;

        for (const [name, player] of otherPlayers) {
            if (name === this.username) continue;

            const otherPos = player.body.position;
            const dx = otherPos.x - myPos.x;
            const dz = otherPos.z - myPos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < 2.0 && Math.abs(otherPos.y - myPos.y) < 1.5) {
                // Calculate kick direction
                const kickDir = new THREE.Vector3(dx, 0, dz).normalize();

                return {
                    target: name,
                    force: {
                        x: kickDir.x * PHYSICS.kickForce,
                        y: 8,
                        z: kickDir.z * PHYSICS.kickForce
                    }
                };
            }
        }

        return null;
    }

    applyKickForce(force) {
        // Apply impulse via Cannon.js
        this.body.velocity.x += force.x;
        this.body.velocity.y += force.y;
        this.body.velocity.z += force.z;
        this.stunned = 0.5;
    }

    animate(deltaTime) {
        const time = Date.now() * 0.005;
        const vel = this.body.velocity;
        const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        const moving = horizontalSpeed > 0.5;

        // RABBIT HOP ANIMATION
        if (this.hopPhase === 'crouch' && this.isGrounded) {
            // Crouch pose - preparing to hop
            const crouchAmount = 0.15;
            this.bodyMesh.position.y = 0.6 - crouchAmount;
            this.head.position.y = 1.5 - crouchAmount;

            // Legs bend for crouch
            this.leftFoot.position.y = 0.05;
            this.rightFoot.position.y = 0.05;
            this.leftFoot.position.z = 0.1;
            this.rightFoot.position.z = 0.1;

            // Arms back for momentum
            this.leftArm.position.y = 0.7;
            this.rightArm.position.y = 0.7;
            this.leftArm.position.z = 0.15;
            this.rightArm.position.z = 0.15;

            // Body tilts forward
            this.bodyMesh.rotation.x = 0.15;
            this.head.rotation.x = 0.1;

        } else if (this.isHopping || (!this.isGrounded && moving)) {
            // Airborne hop pose - rabbit-like tucked legs
            const verticalVel = vel.y;
            const airTime = time * 3;

            if (verticalVel > 1) {
                // Rising - legs tucked back like a rabbit
                this.leftFoot.position.y = 0.25;
                this.rightFoot.position.y = 0.25;
                this.leftFoot.position.z = 0.2;  // Legs tucked back
                this.rightFoot.position.z = 0.2;
                this.leftFoot.position.x = -0.2;
                this.rightFoot.position.x = 0.2;

                // Arms forward for balance
                this.leftArm.position.y = 0.9;
                this.rightArm.position.y = 0.9;
                this.leftArm.position.z = -0.1;
                this.rightArm.position.z = -0.1;

                // Body leaning forward
                this.bodyMesh.rotation.x = 0.1;
                this.head.rotation.x = 0.05;

            } else if (verticalVel < -1) {
                // Falling - legs extend forward to prepare for landing
                this.leftFoot.position.y = 0.08;
                this.rightFoot.position.y = 0.08;
                this.leftFoot.position.z = -0.1;  // Legs forward
                this.rightFoot.position.z = -0.1;
                this.leftFoot.position.x = -0.25;
                this.rightFoot.position.x = 0.25;

                // Arms out for balance
                this.leftArm.position.y = 0.85 + Math.sin(airTime) * 0.03;
                this.rightArm.position.y = 0.85 + Math.cos(airTime) * 0.03;
                this.leftArm.position.z = 0;
                this.rightArm.position.z = 0;

                // Body slightly back
                this.bodyMesh.rotation.x = -0.05;
                this.head.rotation.x = 0;

            } else {
                // Peak of hop - stretched out
                this.leftFoot.position.y = 0.15;
                this.rightFoot.position.y = 0.15;
                this.leftFoot.position.z = 0.1;
                this.rightFoot.position.z = 0.1;
            }

            // Reset body bob during hop
            this.bodyMesh.position.y = 0.6;
            this.head.position.y = 1.5;

        } else if (moving && this.isGrounded && this.hopPhase === 'ready') {
            // Brief ground contact between hops - quick transition animation
            const speedFactor = Math.min(horizontalSpeed / PHYSICS.maxSpeed, 1.0);

            // Legs in landing/ready position
            this.leftFoot.position.y = 0.08;
            this.rightFoot.position.y = 0.08;
            this.leftFoot.position.z = 0;
            this.rightFoot.position.z = 0;
            this.leftFoot.position.x = -0.25;
            this.rightFoot.position.x = 0.25;

            // Arms relaxed
            this.leftArm.position.y = 0.8;
            this.rightArm.position.y = 0.8;
            this.leftArm.position.z = 0;
            this.rightArm.position.z = 0;

            // Slight forward tilt based on speed
            const tiltAmount = speedFactor * 0.06;
            this.bodyMesh.rotation.x = tiltAmount;
            this.head.rotation.x = tiltAmount * 0.5;

            this.bodyMesh.position.y = 0.6;
            this.head.position.y = 1.5;

        } else if (!this.isGrounded) {
            // Airborne from manual jump (not hopping)
            const airTime = time * 2;
            const verticalVel = vel.y;

            if (verticalVel > 2) {
                this.leftFoot.position.y = 0.15;
                this.rightFoot.position.y = 0.15;
            } else if (verticalVel < -2) {
                this.leftFoot.position.y = 0.08;
                this.rightFoot.position.y = 0.08;
                this.leftFoot.position.x = -0.3;
                this.rightFoot.position.x = 0.3;
            } else {
                this.leftFoot.position.y = 0.12;
                this.rightFoot.position.y = 0.12;
            }

            this.leftArm.position.y = 0.95 + Math.sin(airTime) * 0.05;
            this.rightArm.position.y = 0.95 + Math.cos(airTime) * 0.05;
            this.leftArm.position.z = 0;
            this.rightArm.position.z = 0;

            this.bodyMesh.rotation.x = 0;
            this.head.rotation.x = 0;
            this.bodyMesh.position.y = 0.6;
            this.head.position.y = 1.5;

        } else {
            // Idle animation
            this.animateIdle(deltaTime);

            // Reset positions
            this.leftFoot.position.x = -0.25;
            this.rightFoot.position.x = 0.25;
            this.leftFoot.position.z = 0;
            this.rightFoot.position.z = 0;
            this.leftArm.position.z = 0;
            this.rightArm.position.z = 0;
            this.bodyMesh.rotation.x = 0;
            this.head.rotation.x = 0;
        }

        // Kick animation (overrides other leg animations)
        if (this.isKicking) {
            this.rightFoot.position.z = 0.5;
            this.rightFoot.position.y = 0.3;
        }
    }

    animateIdle(deltaTime) {
        const time = Date.now() * 0.002;
        // Gentle breathing animation
        const breathe = Math.sin(time) * 0.025;
        this.bodyMesh.position.y = 0.6 + breathe;
        this.head.position.y = 1.5 + breathe;

        // Slight arm sway
        this.leftArm.position.y = 0.8 + Math.sin(time * 0.8) * 0.01;
        this.rightArm.position.y = 0.8 + Math.sin(time * 0.8 + 1) * 0.01;

        // Reset foot positions
        this.leftFoot.position.y = 0.1;
        this.rightFoot.position.y = 0.1;
    }

    setPosition(x, y, z) {
        this.body.position.set(x, y, z);
        this.body.velocity.set(0, 0, 0);
        this.group.position.set(x, y, z);

        // Reset all physics state
        this.canJump = true;
        this.isGrounded = true;
        this.isJumping = false;
        this.jumpBuffered = false;
        this.jumpBufferTimer = 0;
        this.wasGrounded = true;
        this.jumpCooldown = 0;
        this.lastGroundedTime = Date.now();
        this.lastGroundCollision = Date.now();
        this.horizontalMomentum = { x: 0, z: 0 };
        this.targetVelocity = { x: 0, z: 0 };

        // Reset rabbit hop state
        this.rabbitHopTimer = 0;
        this.isHopping = false;
        this.hopPhase = 'ready';
        this.crouchTimer = 0;
    }

    setRemoteState(state) {
        // For remote players, just update visual position (they don't have physics simulation)
        const targetPos = new THREE.Vector3(state.x, state.y, state.z);
        this.group.position.lerp(targetPos, 0.3);
        this.body.position.set(state.x, state.y, state.z);
        this.rotation = state.rotation || 0;
        this.isGrounded = state.grounded || false;
        this.finished = state.finished || false;
    }

    getState() {
        const pos = this.body.position;
        const vel = this.body.velocity;
        return {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            vx: vel.x,
            vy: vel.y,
            vz: vel.z,
            rotation: this.rotation,
            grounded: this.isGrounded,
            finished: this.finished
        };
    }

    lerpAngle(a, b, t) {
        const diff = b - a;
        const adjusted = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
        return a + adjusted * t;
    }

    dispose() {
        this.scene.remove(this.group);
        // Remove physics body
        if (this.physicsWorld && this.body) {
            this.physicsWorld.removeBody(this.body);
        }
        // Dispose geometries and materials
        this.group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
    }
}

// ============================================
// INPUT HANDLER CLASS
// ============================================
class InputHandler {
    constructor() {
        this.keys = {};
        this.inputState = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            kick: false
        };

        this.joystickActive = false;
        this.joystickStartX = 0;
        this.joystickStartY = 0;

        this.setupKeyboard();
        this.setupMobile();
    }

    setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            this.updateInputState();

            // Prevent default for game keys
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            this.updateInputState();
        });
    }

    setupMobile() {
        const joystickArea = document.getElementById('joystickArea');
        const joystickStick = document.getElementById('joystickStick');
        const jumpBtn = document.getElementById('jumpBtn');
        const kickBtn = document.getElementById('kickBtn');

        if (joystickArea) {
            joystickArea.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.joystickActive = true;
                const touch = e.touches[0];
                const rect = joystickArea.getBoundingClientRect();
                this.joystickStartX = rect.left + rect.width / 2;
                this.joystickStartY = rect.top + rect.height / 2;
            }, { passive: false });

            joystickArea.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (!this.joystickActive) return;

                const touch = e.touches[0];
                let dx = touch.clientX - this.joystickStartX;
                let dy = touch.clientY - this.joystickStartY;

                // Clamp to circle
                const distance = Math.sqrt(dx * dx + dy * dy);
                const maxDistance = 40;
                if (distance > maxDistance) {
                    dx = (dx / distance) * maxDistance;
                    dy = (dy / distance) * maxDistance;
                }

                // Move stick visual
                if (joystickStick) {
                    joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
                }

                // Update input state
                const threshold = 15;
                this.inputState.left = dx < -threshold;
                this.inputState.right = dx > threshold;
                this.inputState.forward = dy < -threshold;
                this.inputState.backward = dy > threshold;
            }, { passive: false });

            joystickArea.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.joystickActive = false;
                if (joystickStick) {
                    joystickStick.style.transform = 'translate(0, 0)';
                }
                this.inputState.left = false;
                this.inputState.right = false;
                this.inputState.forward = false;
                this.inputState.backward = false;
            }, { passive: false });
        }

        if (jumpBtn) {
            jumpBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.inputState.jump = true;
            }, { passive: false });
            jumpBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.inputState.jump = false;
            }, { passive: false });
        }

        if (kickBtn) {
            kickBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.inputState.kick = true;
            }, { passive: false });
            kickBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.inputState.kick = false;
            }, { passive: false });
        }

        // Show mobile controls on touch devices
        if ('ontouchstart' in window) {
            document.getElementById('mobileControls')?.classList.remove('hidden');
        }
    }

    updateInputState() {
        // Only update from keyboard if not using joystick
        if (!this.joystickActive) {
            this.inputState.forward = this.keys['KeyW'] || this.keys['ArrowUp'] || false;
            this.inputState.backward = this.keys['KeyS'] || this.keys['ArrowDown'] || false;
            this.inputState.left = this.keys['KeyA'] || this.keys['ArrowLeft'] || false;
            this.inputState.right = this.keys['KeyD'] || this.keys['ArrowRight'] || false;
        }
        this.inputState.jump = this.keys['Space'] || false;
        this.inputState.kick = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || false;
    }

    getState() {
        return { ...this.inputState };
    }

    clearJump() {
        this.inputState.jump = false;
        this.keys['Space'] = false;
    }

    clearKick() {
        this.inputState.kick = false;
        this.keys['ShiftLeft'] = false;
        this.keys['ShiftRight'] = false;
    }
}

// ============================================
// GAME WORLD CLASS (with Cannon.js physics)
// ============================================
class GameWorld {
    constructor(scene, physicsWorld, mapData) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.mapData = mapData;
        this.platforms = [];
        this.obstacles = [];
        this.decorations = [];
        this.physicsBodies = [];

        this.buildWorld();
    }

    buildWorld() {
        // Build platforms/sections
        for (const section of this.mapData.sections) {
            this.createPlatform(section);
        }

        // Build obstacles
        for (const obstacle of this.mapData.obstacles) {
            this.createObstacle(obstacle);
        }

        // Build decorations
        for (const decoration of this.mapData.decorations) {
            this.createDecoration(decoration);
        }

        // Create finish line
        this.createFinishLine();

        // Create boundaries (invisible)
        for (const boundary of this.mapData.boundaries) {
            this.createBoundary(boundary);
        }
    }

    createPlatform(data) {
        // Three.js mesh
        const geometry = new THREE.BoxGeometry(data.size.width, data.size.height, data.size.depth);
        const material = new THREE.MeshPhongMaterial({
            color: data.color,
            shininess: 10
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(data.position.x, data.position.y, data.position.z);

        if (data.rotation) {
            mesh.rotation.set(data.rotation.x || 0, data.rotation.y || 0, data.rotation.z || 0);
        }

        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.scene.add(mesh);

        // Cannon.js physics body (static)
        const shape = new CANNON.Box(new CANNON.Vec3(
            data.size.width / 2,
            data.size.height / 2,
            data.size.depth / 2
        ));

        const body = new CANNON.Body({
            mass: 0, // Static body
            material: this.physicsWorld.groundMaterial
        });
        body.addShape(shape);
        body.position.set(data.position.x, data.position.y, data.position.z);

        if (data.rotation) {
            const euler = new CANNON.Vec3(data.rotation.x || 0, data.rotation.y || 0, data.rotation.z || 0);
            body.quaternion.setFromEuler(euler.x, euler.y, euler.z);
        }

        this.physicsWorld.addBody(body);
        this.physicsBodies.push(body);

        this.platforms.push({
            mesh: mesh,
            body: body,
            type: data.type
        });
    }

    createObstacle(data) {
        let mesh;
        let body;

        switch (data.type) {
            case 'spinningBar':
                ({ mesh, body } = this.createSpinningBar(data));
                break;
            case 'pendulum':
                ({ mesh, body } = this.createPendulum(data));
                break;
            case 'pusher':
                ({ mesh, body } = this.createPusher(data));
                break;
            case 'barrier':
                ({ mesh, body } = this.createBarrier(data));
                break;
            default:
                return;
        }

        this.obstacles.push({
            mesh: mesh,
            body: body,
            type: data.type,
            data: data,
            size: data.size
        });
    }

    createSpinningBar(data) {
        const group = new THREE.Group();

        // Center pole
        const poleGeometry = new THREE.CylinderGeometry(0.3, 0.3, 4, 8);
        const poleMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        group.add(pole);

        // Spinning bar
        const barGeometry = new THREE.BoxGeometry(data.size.width, data.size.height, data.size.depth);
        const barMaterial = new THREE.MeshPhongMaterial({ color: data.color });
        const bar = new THREE.Mesh(barGeometry, barMaterial);
        bar.castShadow = true;
        group.add(bar);

        group.position.set(data.position.x, data.position.y, data.position.z);
        group.userData = { rotationSpeed: data.rotationSpeed };
        this.scene.add(group);

        // Physics body for spinning bar - BOUNCY obstacle
        const shape = new CANNON.Box(new CANNON.Vec3(
            data.size.width / 2,
            data.size.height / 2,
            data.size.depth / 2
        ));
        const body = new CANNON.Body({
            mass: 0,  // Static body
            material: this.physicsWorld.obstacleMaterial  // Bouncy!
        });
        body.addShape(shape);
        body.position.set(data.position.x, data.position.y, data.position.z);
        this.physicsWorld.addBody(body);
        this.physicsBodies.push(body);

        return { mesh: group, body: body };
    }

    createPendulum(data) {
        const group = new THREE.Group();

        // Rope
        const ropeGeometry = new THREE.CylinderGeometry(0.1, 0.1, data.size.height, 8);
        const ropeMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
        const rope = new THREE.Mesh(ropeGeometry, ropeMaterial);
        rope.position.y = -data.size.height / 2;
        group.add(rope);

        // Ball
        const ballGeometry = new THREE.SphereGeometry(data.size.radius, 16, 16);
        const ballMaterial = new THREE.MeshPhongMaterial({ color: data.color });
        const ball = new THREE.Mesh(ballGeometry, ballMaterial);
        ball.position.y = -data.size.height;
        ball.castShadow = true;
        group.add(ball);

        group.position.set(data.position.x, data.position.y, data.position.z);
        group.userData = {
            swingSpeed: data.swingSpeed,
            swingAngle: data.swingAngle,
            baseX: data.position.x,
            baseY: data.position.y,
            baseZ: data.position.z,
            height: data.size.height
        };
        this.scene.add(group);

        // Physics body for pendulum ball - BOUNCY obstacle
        const ballShape = new CANNON.Sphere(data.size.radius);
        const body = new CANNON.Body({
            mass: 0,  // Static body
            material: this.physicsWorld.obstacleMaterial  // Bouncy!
        });
        body.addShape(ballShape);
        body.position.set(data.position.x, data.position.y - data.size.height, data.position.z);
        this.physicsWorld.addBody(body);
        this.physicsBodies.push(body);

        return { mesh: group, body: body };
    }

    createPusher(data) {
        const geometry = new THREE.BoxGeometry(data.size.width, data.size.height, data.size.depth);
        const material = new THREE.MeshPhongMaterial({ color: data.color });
        const mesh = new THREE.Mesh(geometry, material);

        mesh.position.set(data.position.x, data.position.y, data.position.z);
        mesh.castShadow = true;
        mesh.userData = {
            startX: data.position.x,
            pushDistance: data.pushDistance,
            pushSpeed: data.pushSpeed,
            pushDelay: data.pushDelay || 0
        };
        this.scene.add(mesh);

        // Physics body for pusher - BOUNCY obstacle
        const shape = new CANNON.Box(new CANNON.Vec3(
            data.size.width / 2,
            data.size.height / 2,
            data.size.depth / 2
        ));
        const body = new CANNON.Body({
            mass: 0,  // Static body, position updated manually
            material: this.physicsWorld.obstacleMaterial  // Bouncy!
        });
        body.addShape(shape);
        body.position.set(data.position.x, data.position.y, data.position.z);
        this.physicsWorld.addBody(body);
        this.physicsBodies.push(body);

        return { mesh: mesh, body: body };
    }

    createBarrier(data) {
        const geometry = new THREE.BoxGeometry(data.size.width, data.size.height, data.size.depth);
        const material = new THREE.MeshPhongMaterial({ color: data.color });
        const mesh = new THREE.Mesh(geometry, material);

        mesh.position.set(data.position.x, data.position.y, data.position.z);
        mesh.castShadow = true;
        this.scene.add(mesh);

        // Physics body for barrier (static)
        const shape = new CANNON.Box(new CANNON.Vec3(
            data.size.width / 2,
            data.size.height / 2,
            data.size.depth / 2
        ));
        const body = new CANNON.Body({
            mass: 0,
            material: this.physicsWorld.groundMaterial
        });
        body.addShape(shape);
        body.position.set(data.position.x, data.position.y, data.position.z);
        this.physicsWorld.addBody(body);
        this.physicsBodies.push(body);

        return { mesh: mesh, body: body };
    }

    createDecoration(data) {
        switch (data.type) {
            case 'flag':
                this.createFlag(data);
                break;
            case 'banner':
                this.createBanner(data);
                break;
        }
    }

    createFlag(data) {
        const group = new THREE.Group();

        // Pole
        const poleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
        const poleMaterial = new THREE.MeshPhongMaterial({ color: 0x888888 });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.y = 2.5;
        group.add(pole);

        // Flag
        const flagGeometry = new THREE.PlaneGeometry(2, 1.5);
        const flagMaterial = new THREE.MeshPhongMaterial({
            color: data.color,
            side: THREE.DoubleSide
        });
        const flag = new THREE.Mesh(flagGeometry, flagMaterial);
        flag.position.set(1, 4, 0);
        group.add(flag);

        group.position.set(data.position.x, data.position.y, data.position.z);
        this.scene.add(group);
        this.decorations.push(group);
    }

    createBanner(data) {
        // Create canvas for banner
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(0, 0, 512, 128);

        // Border
        ctx.strokeStyle = '#b8860b';
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, 504, 120);

        // Text
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 64px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(data.text || 'FINISH', 256, 64);

        // Create texture
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide
        });
        const geometry = new THREE.PlaneGeometry(10, 2.5);
        const banner = new THREE.Mesh(geometry, material);

        banner.position.set(data.position.x, data.position.y, data.position.z);
        this.scene.add(banner);
        this.decorations.push(banner);
    }

    createFinishLine() {
        const finishData = this.mapData.finishLine;

        // Checkerboard pattern
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const tileSize = 32;
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#000000';
                ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 1);

        const geometry = new THREE.PlaneGeometry(finishData.width, finishData.depth);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide
        });

        const finishLine = new THREE.Mesh(geometry, material);
        finishLine.rotation.x = -Math.PI / 2;
        finishLine.position.set(
            finishData.position.x,
            finishData.position.y + 0.01,
            finishData.position.z
        );

        this.scene.add(finishLine);
        this.finishLineZ = finishData.position.z;
    }

    createBoundary(data) {
        // Invisible wall
        const halfWidth = data.size.width / 2;
        const halfHeight = data.size.height / 2;
        const halfDepth = data.size.depth / 2;

        this.platforms.push({
            mesh: null,
            type: 'boundary',
            boundingBox: {
                min: new THREE.Vector3(
                    data.position.x - halfWidth,
                    data.position.y - halfHeight,
                    data.position.z - halfDepth
                ),
                max: new THREE.Vector3(
                    data.position.x + halfWidth,
                    data.position.y + halfHeight,
                    data.position.z + halfDepth
                )
            }
        });
    }

    update(deltaTime) {
        const time = Date.now() * 0.001;

        for (const obstacle of this.obstacles) {
            switch (obstacle.type) {
                case 'spinningBar':
                    obstacle.mesh.rotation.y += obstacle.data.rotationSpeed * deltaTime;
                    // Update physics body rotation
                    if (obstacle.body) {
                        obstacle.body.quaternion.setFromEuler(0, obstacle.mesh.rotation.y, 0);
                    }
                    break;

                case 'pendulum':
                    const swingAngle = Math.sin(time * obstacle.data.swingSpeed) * obstacle.data.swingAngle;
                    obstacle.mesh.rotation.z = swingAngle;
                    // Update physics body position for pendulum ball
                    if (obstacle.body && obstacle.mesh.userData) {
                        const ud = obstacle.mesh.userData;
                        const ballX = ud.baseX + Math.sin(swingAngle) * ud.height;
                        const ballY = ud.baseY - Math.cos(swingAngle) * ud.height;
                        const ballZ = ud.baseZ || obstacle.mesh.position.z || 0;
                        obstacle.body.position.set(ballX, ballY, ballZ);
                    }
                    break;

                case 'pusher':
                    const pusherTime = time + obstacle.data.pushDelay;
                    const pushOffset = Math.sin(pusherTime * obstacle.data.pushSpeed) * obstacle.data.pushDistance;
                    obstacle.mesh.position.x = obstacle.mesh.userData.startX + pushOffset;
                    // Update physics body position
                    if (obstacle.body) {
                        obstacle.body.position.x = obstacle.mesh.position.x;
                    }
                    break;
            }
        }

        // Animate flags
        for (const decoration of this.decorations) {
            if (decoration.children) {
                const flag = decoration.children[1];
                if (flag) {
                    flag.rotation.y = Math.sin(time * 3) * 0.2;
                }
            }
        }
    }

    getFinishLineZ() {
        return this.finishLineZ;
    }

    getRespawnPoint(playerZ) {
        const respawnPoints = this.mapData.respawnPoints;

        // Find the best respawn point - one that is behind the player's progress
        // Player travels in negative Z direction, so "behind" means higher Z value
        // Sort by Z descending (furthest back first)
        const sortedPoints = [...respawnPoints].sort((a, b) => b.z - a.z);

        // Find first point that is behind (or at) the player's Z position
        for (const point of sortedPoints) {
            if (point.z >= playerZ) {
                return point;
            }
        }

        // If player is before all checkpoints, use the start
        return respawnPoints[0];
    }

    dispose() {
        // Clean up physics bodies
        for (const body of this.physicsBodies) {
            this.physicsWorld.removeBody(body);
        }
        this.physicsBodies = [];

        // Clean up all meshes
        for (const platform of this.platforms) {
            if (platform.mesh) {
                this.scene.remove(platform.mesh);
                platform.mesh.geometry.dispose();
                platform.mesh.material.dispose();
            }
        }

        for (const obstacle of this.obstacles) {
            if (obstacle.mesh) {
                this.scene.remove(obstacle.mesh);
            }
        }

        for (const decoration of this.decorations) {
            this.scene.remove(decoration);
        }
    }
}

// ============================================
// MAIN GAME CLASS
// ============================================
class FallGuysGame extends AgentInteractionBase {
    constructor() {
        super({
            storagePrefix: 'fallguys',
            customType: 'fall-guys',
            autoCreateDataChannel: true,
            dataChannelName: 'game-data',
            dataChannelOptions: {
                ordered: false,
                maxRetransmits: 0
            }
        });

        // Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Cannon.js Physics
        this.physicsWorld = null;

        // Game state
        this.gameWorld = null;
        this.localPlayer = null;
        this.remotePlayers = new Map();
        this.inputHandler = null;

        // Race state
        this.gameState = 'waiting'; // waiting, countdown, racing, finished
        this.raceStartTime = 0;
        this.countdownValue = 0;
        this.finishOrder = [];

        // Player colors
        this.playerColors = new Map();

        // Update rate limiting
        this.lastUpdateSent = 0;
        this.updateInterval = 50; // 20 updates per second

        // Animation frame
        this.animationFrameId = null;
        this.lastFrameTime = 0;

        // wasHost is now tracked by BaseGame

        // Respawn cooldown
        this.respawnCooldown = false;
    }

    async onInitialize() {
        console.log('[FallGuys] Initializing...');

        // Initialize Physics World (Cannon.js)
        this.physicsWorld = new PhysicsWorld();

        // Initialize Three.js
        this.initThreeJS();

        // Initialize input handler
        this.inputHandler = new InputHandler();

        // Initialize modals
        await this.initializeModals();

        // Setup UI
        this.setupUI();

        // Start render loop (but not game logic yet)
        this.startRenderLoop();

        console.log('[FallGuys] Initialized');
    }

    initThreeJS() {
        const container = document.getElementById('gameContainer');

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 250);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 10, 15);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;
        this.scene.add(directionalLight);

        // Ground plane (for aesthetics, below kill zone)
        const groundGeometry = new THREE.PlaneGeometry(100, 300);
        const groundMaterial = new THREE.MeshPhongMaterial({
            color: 0x3a7bd5,
            side: THREE.DoubleSide
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(0, -20, -100);
        this.scene.add(ground);

        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    async initializeModals() {
        // Modals are initialized in DOMContentLoaded via loadConnectionModal
        // ShareModal is also loaded there
        console.log('[FallGuys] Modals will be initialized from DOMContentLoaded');
    }

    setupUI() {
        // Update connection status
        this.updateConnectionStatus(false);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ============================================
    // Connection Events
    // ============================================

    onConnect(detail) {
        console.log('[FallGuys] Connected:', detail);
        this.updateConnectionStatus(true);

        // Hide connection modal
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.remove('active');

        // Show share button
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) shareBtn.style.display = 'block';

        // Assign color to self
        const colorIndex = this.getNextColorIndex();
        this.playerColors.set(this.username, colorIndex);

        // Build the game world
        console.log('[FallGuys] Creating game world...');
        console.log('[FallGuys] Scene:', this.scene);
        console.log('[FallGuys] Physics world:', this.physicsWorld);
        console.log('[FallGuys] Map data:', MAP_DATA.obstacleRush);

        this.gameWorld = new GameWorld(this.scene, this.physicsWorld, MAP_DATA.obstacleRush);
        console.log('[FallGuys] Game world created:', this.gameWorld);
        console.log('[FallGuys] Platforms:', this.gameWorld.platforms.length);

        // Create local player
        console.log('[FallGuys] Creating local player...');
        this.localPlayer = new PlayerCharacter(
            this.scene,
            this.physicsWorld,
            colorIndex,
            this.username,
            true
        );
        this.localPlayer.setPosition(0, 2, 0);
        console.log('[FallGuys] Local player created:', this.localPlayer);
        console.log('[FallGuys] Player position:', this.localPlayer.body.position);

        // Update UI
        this.updatePlayerList();
        this.updateHostControls();

        // Show waiting room
        document.getElementById('waitingRoom')?.classList.remove('hidden');
    }

    onPlayerJoining(detail) {
        console.log('[FallGuys] Player joining:', detail.agentName);
        this.showToast(`${detail.agentName} is joining...`, 'info', 2000);

        // Show loader while waiting for DataChannel to open
        this.showConnectionLoader(`Connecting to ${detail.agentName}...`);
    }

    onPlayerJoin(detail) {
        console.log('[FallGuys] Player joined:', detail.agentName);

        // Hide the connection loader - DataChannel is now open
        this.hideConnectionLoader();

        this.showToast(`${detail.agentName} joined the race!`, 'info');

        // Assign color
        const colorIndex = this.getNextColorIndex();
        this.playerColors.set(detail.agentName, colorIndex);

        // Create remote player character
        const remotePlayer = new PlayerCharacter(
            this.scene,
            this.physicsWorld,
            colorIndex,
            detail.agentName,
            false
        );
        remotePlayer.setPosition(
            (Math.random() - 0.5) * 10,
            2,
            (Math.random() - 0.5) * 5
        );
        this.remotePlayers.set(detail.agentName, remotePlayer);

        // Update UI
        this.updatePlayerList();
        this.updateHostControls();

        // If host, send current lobby state to new player (and broadcast to all)
        if (this.isHost()) {
            // Small delay to let DataChannel establish
            setTimeout(() => {
                this.broadcastLobbyState();
            }, 500);
        }
    }

    onPlayerLeave(detail) {
        console.log('[FallGuys] Player left:', detail.agentName);
        this.showToast(`${detail.agentName} left the race`, 'warning');

        // Remove player
        const remotePlayer = this.remotePlayers.get(detail.agentName);
        if (remotePlayer) {
            remotePlayer.dispose();
            this.remotePlayers.delete(detail.agentName);
        }

        this.playerColors.delete(detail.agentName);

        // Update UI
        this.updatePlayerList();

        // Host change is handled automatically by BaseGame -> onBecomeHost()
        // Update host controls after a short delay
        setTimeout(() => {
            this.updateHostControls();
        }, 150);
    }

    onBecomeHost() {
        console.log('[FallGuys] I am now the host');
        // Toast is already shown by BaseGame, just update controls
        this.updateHostControls();
    }

    onDataChannelOpen(peerId) {
        console.log('[FallGuys] DataChannel opened with:', peerId);

        // When DataChannel opens, if I'm host, send lobby state to this peer
        // Small delay to ensure connection is fully ready
        setTimeout(() => {
            if (this.isHost()) {
                console.log('[FallGuys] Host sending lobby state to', peerId);
                this.broadcastLobbyState();
            } else {
                // If not host, announce myself to the new peer
                console.log('[FallGuys] Announcing myself to', peerId);
                this.sendData({
                    type: 'playerAnnounce',
                    username: this.username,
                    colorIndex: this.playerColors.get(this.username),
                    ready: this.playersReady.get(this.username) || false
                });
            }
        }, 200);
    }

    onDataChannelMessage(peerId, data) {
        // peerId is the sender, data is the message object
        const from = peerId;

        switch (data.type) {
            case 'playerState':
                this.handleRemotePlayerState(from, data);
                break;
            case 'lobbyState':
                this.handleLobbyState(data);
                break;
            case 'playerAnnounce':
                this.handlePlayerAnnounce(data);
                break;
            case 'countdown':
                this.handleCountdown(data.value);
                break;
            case 'raceStart':
                this.handleRaceStart(data.startTime);
                break;
            case 'playerFinish':
                this.handlePlayerFinish(from, data.time, data.position);
                break;
            case 'kick':
                this.handleKick(from, data.target, data.force);
                break;
            case 'gameState':
                this.handleGameStateSync(data);
                break;
            case 'restart':
                this.handleRestart();
                break;
        }
    }

    // ============================================
    // Game Loop
    // ============================================

    startRenderLoop() {
        let lastTime = performance.now();

        const animate = (currentTime) => {
            this.animationFrameId = requestAnimationFrame(animate);

            const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
            lastTime = currentTime;

            // Update game logic if racing
            if (this.gameState === 'racing') {
                this.updateGame(deltaTime);
            }

            // Update world animations
            if (this.gameWorld) {
                this.gameWorld.update(deltaTime);
            }

            // Update camera
            this.updateCamera();

            // Render
            this.renderer.render(this.scene, this.camera);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }

    updateGame(deltaTime) {
        if (!this.localPlayer) return;

        // Step the physics simulation
        if (this.physicsWorld) {
            this.physicsWorld.step(deltaTime);
        }

        // Get input
        const inputState = this.inputHandler.getState();

        // Update local player
        this.localPlayer.update(
            deltaTime,
            inputState,
            this.gameWorld?.platforms,
            this.gameWorld?.obstacles,
            this.remotePlayers
        );

        // Clear one-shot inputs
        if (inputState.jump) this.inputHandler.clearJump();
        if (inputState.kick) this.inputHandler.clearKick();

        // Check for kick hit
        const kickResult = this.localPlayer.handlePlayerCollisions(this.remotePlayers);
        if (kickResult) {
            this.sendData({
                type: 'kick',
                target: kickResult.target,
                force: kickResult.force
            });
        }

        // Check for death (fall off map) - use Cannon body position
        if (this.localPlayer.body.position.y < MAP_DATA.obstacleRush.killZoneY) {
            this.respawnPlayer();
        }

        // Check for finish - use Cannon body position
        if (!this.localPlayer.finished &&
            this.localPlayer.body.position.z <= this.gameWorld.getFinishLineZ()) {
            this.playerFinished();
        }

        // Update timer display
        this.updateTimerDisplay();

        // Update race position
        this.updateRacePosition();

        // Send state to other players
        this.sendPlayerState();

        // Update remote players
        for (const [name, player] of this.remotePlayers) {
            player.update(deltaTime, null, null, null, null);
        }
    }

    updateCamera() {
        if (!this.localPlayer) return;

        // Follow camera behind and above player (use Cannon.js body position)
        const bodyPos = this.localPlayer.body.position;
        const targetPos = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z);
        const cameraOffset = new THREE.Vector3(0, 5, 10);

        // Calculate target camera position
        const targetCameraPos = targetPos.clone().add(cameraOffset);

        // Smooth camera movement
        this.camera.position.lerp(targetCameraPos, 0.1);

        // Look at player (slightly above feet)
        const lookAtPos = targetPos.clone();
        lookAtPos.y += 1;
        this.camera.lookAt(lookAtPos);
    }

    // ============================================
    // Game Actions
    // ============================================

    hostStartGame() {
        if (!this.isHost()) {
            this.showToast('Only the host can start the race', 'warning');
            return;
        }

        // Start countdown
        this.startCountdown();
    }


    startCountdown() {
        this.gameState = 'countdown';
        this.countdownValue = 3;

        // Hide waiting room
        document.getElementById('waitingRoom')?.classList.add('hidden');

        // Show game UI
        document.getElementById('timerDisplay')?.classList.remove('hidden');
        document.getElementById('racePosition')?.classList.remove('hidden');

        // Reset player positions
        this.resetPlayerPositions();

        // Broadcast and start
        const countdownInterval = setInterval(() => {
            if (this.countdownValue > 0) {
                this.showToast(`${this.countdownValue}...`, 'info');
                this.sendData({
                    type: 'countdown',
                    value: this.countdownValue
                });
                this.countdownValue--;
            } else {
                clearInterval(countdownInterval);
                this.showToast('GO! 🏃', 'success');

                const startTime = Date.now();
                this.sendData({
                    type: 'raceStart',
                    startTime: startTime
                });
                this.handleRaceStart(startTime);
            }
        }, 1000);
    }

    handleCountdown(value) {
        if (this.gameState !== 'countdown' && this.gameState !== 'waiting') return;

        this.gameState = 'countdown';
        document.getElementById('waitingRoom')?.classList.add('hidden');
        document.getElementById('timerDisplay')?.classList.remove('hidden');
        document.getElementById('racePosition')?.classList.remove('hidden');

        this.showToast(`${value}...`, 'info');
    }

    handleRaceStart(startTime) {
        this.gameState = 'racing';
        this.raceStartTime = startTime;
        this.finishOrder = [];

        // Reset player state
        if (this.localPlayer) {
            this.localPlayer.finished = false;
        }

        // Show mobile controls
        if ('ontouchstart' in window) {
            document.getElementById('mobileControls')?.classList.remove('hidden');
        }
    }

    resetPlayerPositions() {
        // Position players at start line
        const startPositions = [
            { x: -4, z: 3 },
            { x: 4, z: 3 },
            { x: -2, z: 5 },
            { x: 2, z: 5 },
            { x: 0, z: 7 },
            { x: -6, z: 5 },
            { x: 6, z: 5 },
            { x: 0, z: 3 }
        ];

        let index = 0;

        // Position local player
        if (this.localPlayer) {
            const pos = startPositions[index % startPositions.length];
            this.localPlayer.setPosition(pos.x, 2, pos.z);
            this.localPlayer.body.velocity.set(0, 0, 0);
            this.localPlayer.finished = false;
            index++;
        }

        // Position remote players
        for (const [name, player] of this.remotePlayers) {
            const pos = startPositions[index % startPositions.length];
            player.setPosition(pos.x, 2, pos.z);
            player.body.velocity.set(0, 0, 0);
            player.finished = false;
            index++;
        }
    }

    playerFinished() {
        if (this.localPlayer.finished) return;

        this.localPlayer.finished = true;
        const finishTime = Date.now() - this.raceStartTime;
        const position = this.finishOrder.length + 1;

        this.finishOrder.push({
            name: this.username,
            time: finishTime
        });

        this.localPlayer.finishTime = finishTime;
        this.localPlayer.finishPosition = position;

        // Broadcast
        this.sendData({
            type: 'playerFinish',
            time: finishTime,
            position: position
        });

        this.showToast(`You finished ${this.getOrdinal(position)}!`, 'success');

        // Check if race is complete
        this.checkRaceComplete();
    }

    handlePlayerFinish(playerName, time, position) {
        const player = this.remotePlayers.get(playerName);
        if (player) {
            player.finished = true;
            player.finishTime = time;
            player.finishPosition = position;
        }

        // Add to finish order if not already
        if (!this.finishOrder.find(p => p.name === playerName)) {
            this.finishOrder.push({
                name: playerName,
                time: time
            });
        }

        this.showToast(`${playerName} finished ${this.getOrdinal(position)}!`, 'info');

        this.checkRaceComplete();
    }

    checkRaceComplete() {
        const totalPlayers = 1 + this.remotePlayers.size;

        if (this.finishOrder.length >= totalPlayers) {
            // All players finished
            setTimeout(() => {
                this.showFinishScreen();
            }, 1000);
        }
    }

    showFinishScreen() {
        this.gameState = 'finished';

        // Hide mobile controls
        document.getElementById('mobileControls')?.classList.add('hidden');

        // Build results
        const resultsDiv = document.getElementById('finishResults');
        if (resultsDiv) {
            resultsDiv.innerHTML = '';

            // Sort by time
            const sortedResults = [...this.finishOrder].sort((a, b) => a.time - b.time);

            sortedResults.forEach((result, index) => {
                const item = document.createElement('div');
                item.className = 'finish-result-item' + (index === 0 ? ' winner' : '');

                const position = index + 1;
                const minutes = Math.floor(result.time / 60000);
                const seconds = Math.floor((result.time % 60000) / 1000);
                const ms = result.time % 1000;

                item.innerHTML = `
                    <span class="position">${this.getOrdinal(position)}</span>
                    <span class="player-name">${result.name}</span>
                    <span class="time">${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}</span>
                `;

                resultsDiv.appendChild(item);
            });
        }

        // Show overlay
        document.getElementById('finishOverlay')?.classList.remove('hidden');

        // Show play again button for host
        if (this.isHost()) {
            document.getElementById('playAgainBtn')?.classList.remove('hidden');
        }
    }

    hostRestartGame() {
        if (!this.isHost()) return;

        this.sendData({ type: 'restart' });
        this.handleRestart();
    }

    handleRestart() {
        // Reset game state
        this.gameState = 'waiting';
        this.finishOrder = [];
        this.raceStartTime = 0;

        // Reset ready states
        for (const [name, ready] of this.playersReady) {
            this.playersReady.set(name, false);
        }

        // Reset players
        if (this.localPlayer) {
            this.localPlayer.finished = false;
            this.localPlayer.setPosition(0, 2, 0);
            this.localPlayer.body.velocity.set(0, 0, 0);
        }

        for (const [name, player] of this.remotePlayers) {
            player.finished = false;
            player.setPosition((Math.random() - 0.5) * 10, 2, (Math.random() - 0.5) * 5);
            player.body.velocity.set(0, 0, 0);
        }

        // Update UI
        const readyBtn = document.getElementById('readyBtn');
        if (readyBtn) {
            readyBtn.textContent = 'Ready Up!';
            readyBtn.classList.remove('ready');
        }

        document.getElementById('finishOverlay')?.classList.add('hidden');
        document.getElementById('waitingRoom')?.classList.remove('hidden');
        document.getElementById('timerDisplay')?.classList.add('hidden');
        document.getElementById('racePosition')?.classList.add('hidden');
        document.getElementById('playAgainBtn')?.classList.add('hidden');

        this.updatePlayerList();
    }

    respawnPlayer() {
        // Prevent respawn spam
        if (this.respawnCooldown) return;
        this.respawnCooldown = true;

        const respawnPoint = this.gameWorld.getRespawnPoint(this.localPlayer.body.position.z);
        console.log('[FallGuys] Respawning at:', respawnPoint);

        // Respawn above the platform
        this.localPlayer.setPosition(respawnPoint.x, respawnPoint.y + 3, respawnPoint.z);
        this.localPlayer.body.velocity.set(0, 0, 0);
        this.localPlayer.isGrounded = false;
        this.showToast('Respawned!', 'warning');

        // Cooldown to prevent spam
        setTimeout(() => {
            this.respawnCooldown = false;
        }, 1000);
    }

    handleKick(from, target, force) {
        if (target === this.username) {
            // I was kicked
            this.localPlayer.applyKickForce(force);
            this.showToast(`Kicked by ${from}!`, 'warning');
        }
    }

    // ============================================
    // Network
    // ============================================

    sendPlayerState() {
        const now = Date.now();
        if (now - this.lastUpdateSent < this.updateInterval) return;
        this.lastUpdateSent = now;

        if (!this.localPlayer) return;

        this.sendData({
            type: 'playerState',
            ...this.localPlayer.getState()
        });
    }

    handleRemotePlayerState(playerName, state) {
        const player = this.remotePlayers.get(playerName);
        if (player) {
            player.setRemoteState(state);
        }
    }

    sendGameState(targetPlayer) {
        // Send current game state to late joiner
        setTimeout(() => {
            this.sendData({
                type: 'gameState',
                gameState: this.gameState,
                raceStartTime: this.raceStartTime,
                finishOrder: this.finishOrder,
                playersReady: Array.from(this.playersReady.entries())
            }, targetPlayer);
        }, 500);
    }

    broadcastLobbyState() {
        // Broadcast current lobby state (player list, colors, ready states) to all
        console.log('[FallGuys] Broadcasting lobby state');
        this.sendData({
            type: 'lobbyState',
            players: Array.from(this.playerColors.entries()),
            readyStates: Array.from(this.playersReady.entries()),
            gameState: this.gameState
        });
    }

    handleLobbyState(data) {
        console.log('[FallGuys] Received lobby state:', data);

        // Update player colors from host (host is authoritative)
        if (data.players) {
            for (const [name, colorIndex] of data.players) {
                // Update or set the color for this player
                const existingColor = this.playerColors.get(name);

                if (name === this.username) {
                    // Update my own color if host assigned different one
                    if (existingColor !== colorIndex) {
                        console.log('[FallGuys] Host assigned me color:', colorIndex);
                        this.playerColors.set(name, colorIndex);

                        // Recreate local player with correct color
                        if (this.localPlayer) {
                            const pos = this.localPlayer.body.position;
                            this.localPlayer.dispose();
                            this.localPlayer = new PlayerCharacter(
                                this.scene,
                                this.physicsWorld,
                                colorIndex,
                                this.username,
                                true
                            );
                            this.localPlayer.setPosition(pos.x, pos.y, pos.z);
                        }
                    }
                } else {
                    // Remote player
                    this.playerColors.set(name, colorIndex);

                    // Create or recreate remote player with correct color
                    if (this.remotePlayers.has(name)) {
                        const existingPlayer = this.remotePlayers.get(name);
                        if (existingPlayer.colorIndex !== colorIndex) {
                            // Color changed, recreate player
                            const pos = existingPlayer.body.position;
                            existingPlayer.dispose();
                            const remotePlayer = new PlayerCharacter(
                                this.scene,
                                this.physicsWorld,
                                colorIndex,
                                name,
                                false
                            );
                            remotePlayer.setPosition(pos.x, pos.y, pos.z);
                            this.remotePlayers.set(name, remotePlayer);
                        }
                    } else {
                        // Create new remote player
                        const remotePlayer = new PlayerCharacter(
                            this.scene,
                            this.physicsWorld,
                            colorIndex,
                            name,
                            false
                        );
                        remotePlayer.setPosition(
                            (Math.random() - 0.5) * 10,
                            2,
                            (Math.random() - 0.5) * 5
                        );
                        this.remotePlayers.set(name, remotePlayer);
                    }
                }
            }
        }

        // Update ready states
        if (data.readyStates) {
            for (const [name, ready] of data.readyStates) {
                this.playersReady.set(name, ready);
            }
        }

        // Handle game state from host - but don't auto-start racing for late joiners
        if (data.gameState) {
            console.log('[FallGuys] Host game state:', data.gameState);

            if (data.gameState === 'racing' || data.gameState === 'countdown') {
                // Game already started - late joiner should wait or spectate
                this.gameState = 'waiting';  // Keep them in waiting state
                this.showToast('Game in progress - please wait for next round', 'warning');

                // Hide waiting room and show spectate message
                document.getElementById('waitingRoom')?.classList.remove('hidden');
            } else if (data.gameState === 'finished') {
                // Game finished - wait for restart
                this.gameState = 'waiting';
                this.showToast('Round finished - waiting for next round', 'info');
            } else {
                // Game is in waiting state - normal lobby
                this.gameState = data.gameState;
            }
        }

        // Update UI
        this.updatePlayerList();
        this.updateHostControls();
    }

    handlePlayerAnnounce(data) {
        const { username, colorIndex, ready } = data;
        console.log('[FallGuys] Player announced:', username, colorIndex, ready);

        // Skip if it's ourselves
        if (username === this.username) return;

        // Check if color needs to be updated
        const existingColor = this.playerColors.get(username);
        const needsColorUpdate = existingColor !== undefined && existingColor !== colorIndex;

        this.playerColors.set(username, colorIndex);
        this.playersReady.set(username, ready);

        // Create or update remote player
        if (this.remotePlayers.has(username)) {
            if (needsColorUpdate) {
                // Color changed, recreate player
                const existingPlayer = this.remotePlayers.get(username);
                const pos = existingPlayer.body.position;
                existingPlayer.dispose();
                const remotePlayer = new PlayerCharacter(
                    this.scene,
                    this.physicsWorld,
                    colorIndex,
                    username,
                    false
                );
                remotePlayer.setPosition(pos.x, pos.y, pos.z);
                this.remotePlayers.set(username, remotePlayer);
            }
        } else {
            // Create new remote player
            const remotePlayer = new PlayerCharacter(
                this.scene,
                this.physicsWorld,
                colorIndex,
                username,
                false
            );
            remotePlayer.setPosition(
                (Math.random() - 0.5) * 10,
                2,
                (Math.random() - 0.5) * 5
            );
            this.remotePlayers.set(username, remotePlayer);
        }

        this.updatePlayerList();
        this.updateHostControls();
    }

    handleGameStateSync(data) {
        console.log('[FallGuys] Received game state sync:', data.gameState);

        // Don't auto-start racing for late joiners
        if (data.gameState === 'racing' || data.gameState === 'countdown') {
            // Game in progress - keep late joiner in waiting state
            this.gameState = 'waiting';
            this.showToast('Race in progress - wait for next round', 'warning');
            return;  // Don't update UI to racing state
        }

        this.gameState = data.gameState;
        this.raceStartTime = data.raceStartTime;
        this.finishOrder = data.finishOrder || [];

        if (data.playersReady) {
            for (const [name, ready] of data.playersReady) {
                this.playersReady.set(name, ready);
            }
        }

        // Update UI based on state
        if (this.gameState === 'finished') {
            this.showFinishScreen();
        }

        this.updatePlayerList();
    }

    // ============================================
    // UI Updates
    // ============================================

    updateConnectionStatus(connected) {
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');

        if (dot) dot.classList.toggle('connected', connected);
        if (text) text.textContent = connected ? 'Connected' : 'Disconnected';
    }

    updatePlayerList() {
        const listDiv = document.getElementById('playerList');
        if (!listDiv) return;

        listDiv.innerHTML = '';

        // Add local player
        this.addPlayerToList(listDiv, this.username, this.playerColors.get(this.username), true);

        // Add remote players
        for (const [name, colorIndex] of this.playerColors) {
            if (name !== this.username) {
                this.addPlayerToList(listDiv, name, colorIndex, false);
            }
        }

        // Update player count
        const countEl = document.getElementById('playerCountValue');
        if (countEl) {
            countEl.textContent = 1 + this.remotePlayers.size;
        }
    }

    addPlayerToList(container, name, colorIndex, isLocal) {
        const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
        const ready = this.playersReady.get(name) || false;
        const isHostPlayer = this.channel?.isHostAgent?.() && isLocal;

        const item = document.createElement('div');
        item.className = 'player-item' + (ready ? ' ready' : '') + (isHostPlayer ? ' host' : '');

        item.innerHTML = `
            <div class="player-color" style="background: #${color.body.toString(16).padStart(6, '0')}"></div>
            <span>${name}${isLocal ? ' (You)' : ''}</span>
            ${ready ? ' ✓' : ''}
        `;

        container.appendChild(item);
    }

    updateHostControls() {
        const isHost = this.isHost();
        console.log('[FallGuys] updateHostControls - isHost:', isHost);

        // Show/hide host-only elements by setting display directly
        document.querySelectorAll('.host-only').forEach(el => {
            if (isHost) {
                el.style.display = 'inline-block';
                el.classList.remove('hidden');
            } else {
                el.style.display = 'none';
            }
        });

        // Update start button state
        const startBtn = document.getElementById('startBtn');
        if (startBtn && isHost) {
            startBtn.disabled = !this.checkAllReady();
            startBtn.style.display = 'inline-block';
            console.log('[FallGuys] Start button visible, disabled:', startBtn.disabled);
        }
    }

    updateTimerDisplay() {
        if (this.gameState !== 'racing') return;

        const elapsed = Date.now() - this.raceStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);

        const timerEl = document.getElementById('timerValue');
        if (timerEl) {
            timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    updateRacePosition() {
        if (!this.localPlayer || this.gameState !== 'racing') return;

        // Calculate position based on Z position (progress)
        let position = 1;
        const myZ = this.localPlayer.body.position.z;

        for (const [name, player] of this.remotePlayers) {
            if (!player.finished && player.body.position.z < myZ) {
                position++;
            }
        }

        const posEl = document.getElementById('positionNumber');
        if (posEl) {
            posEl.textContent = this.getOrdinal(position);
        }
    }

    // ============================================
    // Utilities
    // ============================================

    getNextColorIndex() {
        const usedColors = new Set(this.playerColors.values());
        for (let i = 0; i < PLAYER_COLORS.length; i++) {
            if (!usedColors.has(i)) return i;
        }
        return Math.floor(Math.random() * PLAYER_COLORS.length);
    }

    getOrdinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    openShareModal() {
        if (this.connected && typeof ShareModal !== 'undefined') {
            ShareModal.show(this.channelName, this.channelPassword);
        } else if (!this.connected) {
            this.showToast('Connect first to share', 'warning');
        } else {
            console.warn('[FallGuys] ShareModal not available');
        }
    }

    // ============================================
    // Cleanup
    // ============================================

    disconnect() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.localPlayer) {
            this.localPlayer.dispose();
            this.localPlayer = null;
        }

        for (const [name, player] of this.remotePlayers) {
            player.dispose();
        }
        this.remotePlayers.clear();

        if (this.gameWorld) {
            this.gameWorld.dispose();
            this.gameWorld = null;
        }

        super.disconnect();
    }
}

// ============================================
// INITIALIZE GAME
// ============================================
let fallGuysGame;
let isConnecting = false;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[FallGuys] Page loaded');

    // Load connection modal
    window.loadConnectionModal({
        localStoragePrefix: 'fallguys_',
        channelPrefix: 'fallguys-',
        title: '🏃 Mini Fall Guys',
        collapsedTitle: '🏃 Mini Fall Guys',
        onConnect: async function(username, channel, password) {
            await connectFallGuys(username, channel, password);
        }
    });

31    // Process shared link and setup auto-connect using centralized utility
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'FallGuys',
            storagePrefix: 'fallguys_',
            connectCallback: async function() {
                console.log('[FallGuys] Auto-connect triggered');
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectFallGuys(username, channel, password);
                } else {
                    console.warn('[FallGuys] Auto-connect skipped: missing username or channel');
                }
            }
        });
    }

    // Ensure modal is visible
    setTimeout(() => {
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.add('active');
    }, 200);

    console.log('[FallGuys] Ready!');
});

async function connectFallGuys(username, channel, password) {
    // Check and set flag immediately to prevent double-click
    if (isConnecting) {
        console.warn('[FallGuys] Connection already in progress - ignoring duplicate request');
        return;
    }

    if (fallGuysGame && fallGuysGame.connected) {
        console.warn('[FallGuys] Already connected');
        return;
    }

    // Set flag IMMEDIATELY to block subsequent calls
    isConnecting = true;

    // Disable connect button to provide visual feedback
    const connectBtn = document.getElementById('connectBtn') || document.querySelector('[onclick*="connect"]');
    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.style.opacity = '0.5';
        connectBtn.style.cursor = 'not-allowed';
    }

    try {
        console.log('[FallGuys] Starting connection...');
        fallGuysGame = new FallGuysGame();
        window.fallGuysGame = fallGuysGame;

        await fallGuysGame.initialize();
        await fallGuysGame.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });
        fallGuysGame.start();

        // Update URL with auth for sharing
        try {
            if (window.ShareModal && ShareModal.updateUrlWithAuth) {
                ShareModal.updateUrlWithAuth({ channel, password });
            }
        } catch (e) { /* ignore */ }

        console.log('[FallGuys] Connected and ready!');
    } catch (error) {
        console.error('[FallGuys] Connection failed:', error);
        alert('Failed to connect: ' + error.message);
        fallGuysGame = null;

        // Re-enable connect button on error
        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.style.opacity = '1';
            connectBtn.style.cursor = 'pointer';
        }
    } finally {
        isConnecting = false;
    }
}

// Global connect function for modal
window.connect = async function() {
    const userEl = document.getElementById('usernameInput');
    const chEl = document.getElementById('channelInput');
    const pwEl = document.getElementById('passwordInput');

    if (!userEl || !chEl || !pwEl) return;

    const username = userEl.value.trim();
    const channel = chEl.value.trim();
    const password = pwEl.value.trim();

    if (!username || !channel) {
        alert('Please enter username and channel name');
        return;
    }

    await connectFallGuys(username, channel, password);
};

