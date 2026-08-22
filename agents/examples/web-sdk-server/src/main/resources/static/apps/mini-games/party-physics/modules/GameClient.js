/**
 * GameClient.js
 * Client-side rendering and interpolation (no authoritative physics)
 * Uses Three.js for rendering
 */

class GameClient {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error('Container not found: ' + containerId);
        }

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Game objects
        this.players = new Map(); // peerId -> { mesh, nameTag, interpolation }
        this.arena = null;
        this.projectiles = [];
        this.effects = []; // short-lived ability visuals { mesh, parent, ttl, life, update }

        // Snapshot buffer for interpolation
        this.snapshotBuffer = [];
        this.interpolationDelay = 100; // ms

        // Local player
        this.localPeerId = null;

        // Animation loop
        this.animationId = null;
        this.lastRenderTime = 0;

        // Camera controls
        this.cameraDistance = 12; // Closer camera (was 25)
        this.cameraHeight = 8; // Lower camera (was 15)
        this.cameraAngle = 0; // Rotation around player
        this.cameraPitch = 0.5; // Look down angle
        this.cameraFollowEnabled = true; // Follow player by default
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        console.log('[GameClient] Created');
    }

    /**
     * Initialize Three.js scene
     */
    init() {
        console.log('[GameClient] Initializing Three.js...');

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 50, 150);

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, this.cameraHeight, this.cameraDistance);
        this.camera.lookAt(0, 0, 0);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Filmic tone mapping softens the plasticky look (guarded for old three).
        if (THREE.ACESFilmicToneMapping !== undefined) {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.05;
        }
        this.container.appendChild(this.renderer.domElement);

        // Lighting
        this.setupLighting();

        // Camera controls
        this.setupCameraControls();

        // Handle resize
        window.addEventListener('resize', () => this.onResize());

        console.log('[GameClient] Three.js initialized');
    }

    /**
     * Setup camera controls (mouse drag to rotate, scroll to zoom)
     */
    setupCameraControls() {
        const canvas = this.renderer.domElement;

        // Ensure canvas can receive events
        canvas.style.cursor = 'grab';
        canvas.style.touchAction = 'none';

        // Mouse drag to rotate camera - only when clicking directly on canvas
        canvas.addEventListener('mousedown', (e) => {
            // Only start drag if clicking directly on the canvas element
            if (e.button === 0 && e.target === canvas) {
                this.isDragging = true;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                canvas.style.cursor = 'grabbing';
            }
        });

        // Use window for mousemove to handle dragging outside canvas
        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const deltaX = e.clientX - this.lastMouseX;
                const deltaY = e.clientY - this.lastMouseY;

                // Rotate camera around player
                this.cameraAngle -= deltaX * 0.005;
                this.cameraPitch = Math.max(0.1, Math.min(1.5, this.cameraPitch + deltaY * 0.003));

                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
            }
        });

        // Use window for mouseup to handle releasing outside canvas
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                canvas.style.cursor = 'grab';
            }
        });

        // Mouse wheel to zoom (on canvas only)
        canvas.addEventListener('wheel', (e) => {
            if (e.target === canvas) {
                e.preventDefault();
                this.cameraDistance = Math.max(5, Math.min(30, this.cameraDistance + e.deltaY * 0.01));
            }
        }, { passive: false });

        console.log('[GameClient] Camera controls enabled: Drag to rotate, Scroll to zoom');
    }

    /**
     * Setup scene lighting
     */
    setupLighting() {
        // Ambient floor kept low — the hemisphere provides the soft fill, so
        // characters keep contrast instead of looking uniformly lit.
        const ambient = new THREE.AmbientLight(0xffffff, 0.35);
        this.scene.add(ambient);

        // Directional light (sun) — slightly warm for a party-day feel.
        const sun = new THREE.DirectionalLight(0xfff2dd, 1.0);
        sun.position.set(20, 40, 20);
        sun.castShadow = true;
        sun.shadow.camera.left = -50;
        sun.shadow.camera.right = 50;
        sun.shadow.camera.top = 50;
        sun.shadow.camera.bottom = -50;
        sun.shadow.camera.near = 0.1;
        sun.shadow.camera.far = 100;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.bias = -0.0004;   // avoids shadow acne on the round bodies
        this.scene.add(sun);

        // Hemisphere light (sky blue / warm ground bounce).
        const hemi = new THREE.HemisphereLight(0x87CEEB, 0x8a7a5a, 0.5);
        this.scene.add(hemi);

        // Cool rim light from behind — separates characters from the floor.
        const rim = new THREE.DirectionalLight(0xa8c8ff, 0.35);
        rim.position.set(-25, 20, -25);
        this.scene.add(rim);
    }

    /**
     * Create arena based on mode
     */
    createArena(modeOrMap) {
        // Clear existing arena
        if (this.arena) {
            this.arena.forEach(obj => this.scene.remove(obj));
        }
        this.arena = [];

        // Accept either a map object or a mode string
        let map;
        if (typeof modeOrMap === 'object' && modeOrMap !== null) {
            map = modeOrMap;
        } else {
            map = MAPS[modeOrMap];
        }
        if (!map) return;

        console.log('[GameClient] Creating arena:', map.name || modeOrMap);

        if (map.type === 'circular') {
            this.createCircularArena(map);
        } else if (map.type === 'rectangular') {
            this.createRectangularArena(map);
        } else if (map.type === 'linear') {
            this.createRaceArena(map);
        }
    }

    /**
     * Create circular fight arena
     */
    createCircularArena(map) {
        // Main platform
        const platformGeometry = new THREE.CylinderGeometry(
            map.platform.radius,
            map.platform.radius,
            map.platform.height,
            map.platform.segments || 32
        );
        const platformMaterial = new THREE.MeshStandardMaterial({
            color: map.platform.color || 0x90EE90,
            roughness: 0.8,
            metalness: 0.2
        });
        const platform = new THREE.Mesh(platformGeometry, platformMaterial);
        platform.position.y = -map.platform.height / 2;
        platform.receiveShadow = true;
        platform.castShadow = true;
        this.scene.add(platform);
        this.arena.push(platform);

        // Outer ring
        if (map.outerRing) {
            const ringGeometry = new THREE.TorusGeometry(
                map.outerRing.radius,
                map.outerRing.thickness,
                16, 32
            );
            const ringMaterial = new THREE.MeshStandardMaterial({
                color: map.outerRing.color || 0xD4AF37,
                roughness: 0.3,
                metalness: 0.8
            });
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = map.outerRing.height || 1;
            ring.castShadow = true;
            this.scene.add(ring);
            this.arena.push(ring);
        }

        // Elevated platforms
        if (map.elevatedPlatforms) {
            map.elevatedPlatforms.forEach(plat => {
                const geo = new THREE.CylinderGeometry(plat.radius, plat.radius, plat.height, 16);
                const mat = new THREE.MeshStandardMaterial({
                    color: plat.color,
                    roughness: 0.7,
                    metalness: 0.3
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(plat.x, plat.y, plat.z);
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                this.scene.add(mesh);
                this.arena.push(mesh);
            });
        }

        // Jump pads (glowing green circles)
        if (map.jumpPads) {
            map.jumpPads.forEach(pad => {
                const geo = new THREE.CylinderGeometry(pad.radius, pad.radius, 0.2, 16);
                const mat = new THREE.MeshStandardMaterial({
                    color: pad.color,
                    emissive: pad.color,
                    emissiveIntensity: 0.5,
                    roughness: 0.3,
                    metalness: 0.5
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(pad.x, pad.y, pad.z);
                this.scene.add(mesh);
                this.arena.push(mesh);
            });
        }

        // Pillars
        if (map.pillars) {
            map.pillars.forEach(pillar => {
                const geo = new THREE.CylinderGeometry(pillar.radius, pillar.radius, pillar.height, 12);
                const mat = new THREE.MeshStandardMaterial({
                    color: pillar.color,
                    roughness: 0.8,
                    metalness: 0.2
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(pillar.x, pillar.y, pillar.z);
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                this.scene.add(mesh);
                this.arena.push(mesh);
            });
        }

        console.log('[GameClient] Circular arena created with', this.arena.length, 'objects');
    }

    /**
     * Create rectangular dodgeball arena with professional features
     */
    createRectangularArena(map) {
        // Main platform
        const platformGeometry = new THREE.BoxGeometry(
            map.platform.width,
            map.platform.height,
            map.platform.depth
        );
        const platformMaterial = new THREE.MeshStandardMaterial({
            color: map.platform.color || 0x4169E1,
            roughness: 0.8,
            metalness: 0.2
        });
        const platform = new THREE.Mesh(platformGeometry, platformMaterial);
        platform.position.y = -map.platform.height / 2;
        platform.receiveShadow = true;
        platform.castShadow = true;
        this.scene.add(platform);
        this.arena.push(platform);

        // Center line
        if (map.centerLine) {
            const lineGeo = new THREE.BoxGeometry(
                map.centerLine.width,
                map.centerLine.height,
                map.centerLine.depth
            );
            const lineMat = new THREE.MeshStandardMaterial({
                color: map.centerLine.color,
                emissive: map.centerLine.color,
                emissiveIntensity: 0.3
            });
            const line = new THREE.Mesh(lineGeo, lineMat);
            line.position.set(map.centerLine.x, map.centerLine.y, map.centerLine.z);
            this.scene.add(line);
            this.arena.push(line);
        }

        // Walls
        if (map.walls) {
            map.walls.forEach(wall => {
                const wallGeometry = new THREE.BoxGeometry(
                    wall.width,
                    wall.height,
                    wall.depth
                );
                const wallMaterial = new THREE.MeshStandardMaterial({
                    color: wall.color || 0x8B4513,
                    roughness: 0.7,
                    metalness: 0.1
                });
                const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
                wallMesh.position.set(wall.x, wall.y, wall.z);
                wallMesh.castShadow = true;
                wallMesh.receiveShadow = true;
                this.scene.add(wallMesh);
                this.arena.push(wallMesh);
            });
        }

        // Barriers (cover for dodging)
        if (map.barriers) {
            map.barriers.forEach(barrier => {
                const barGeo = new THREE.BoxGeometry(
                    barrier.width,
                    barrier.height,
                    barrier.depth
                );
                const barMat = new THREE.MeshStandardMaterial({
                    color: barrier.color,
                    roughness: 0.6,
                    metalness: 0.3
                });
                const barMesh = new THREE.Mesh(barGeo, barMat);
                barMesh.position.set(barrier.x, barrier.y, barrier.z);
                barMesh.castShadow = true;
                barMesh.receiveShadow = true;
                this.scene.add(barMesh);
                this.arena.push(barMesh);
            });
        }

        // Power zones (glowing circles on floor)
        if (map.powerZones) {
            map.powerZones.forEach(zone => {
                const zoneGeo = new THREE.CylinderGeometry(zone.radius, zone.radius, 0.1, 16);
                const zoneMat = new THREE.MeshStandardMaterial({
                    color: zone.color,
                    emissive: zone.color,
                    emissiveIntensity: 0.5,
                    transparent: true,
                    opacity: 0.7
                });
                const zoneMesh = new THREE.Mesh(zoneGeo, zoneMat);
                zoneMesh.position.set(zone.x, zone.y, zone.z);
                this.scene.add(zoneMesh);
                this.arena.push(zoneMesh);
            });
        }

        console.log('[GameClient] Rectangular arena created with', this.arena.length, 'objects');
    }

    /**
     * Create race track arena
     */
    createRaceArena(map) {
        // Create segments
        const segmentMaterial = new THREE.MeshStandardMaterial({
            color: 0x90EE90,
            roughness: 0.8
        });

        map.segments.forEach(segment => {
            if (segment.type === 'platform') {
                const geometry = new THREE.BoxGeometry(
                    segment.width,
                    segment.height,
                    segment.depth
                );
                const mesh = new THREE.Mesh(geometry, segmentMaterial);
                // Use the Y position from the map data (already adjusted)
                mesh.position.set(segment.x, segment.y, segment.z);
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                this.scene.add(mesh);
                this.arena.push(mesh);
            } else if (segment.type === 'gapPlatforms') {
                // Create individual jumping platforms
                segment.platforms.forEach(platform => {
                    const geometry = new THREE.BoxGeometry(
                        platform.width,
                        platform.height,
                        platform.depth
                    );
                    const mesh = new THREE.Mesh(geometry, segmentMaterial);
                    // Use the Y position from the map data (already adjusted)
                    mesh.position.set(platform.x, platform.y, platform.z);
                    mesh.receiveShadow = true;
                    mesh.castShadow = true;
                    this.scene.add(mesh);
                    this.arena.push(mesh);
                });
            }
        });

        console.log('[GameClient] Race arena created with', this.arena.length, 'platforms');
    }

    /**
     * Create anime-style animal character (Party Animals style!)
     */
    createPlayer(peerId, name, archetype, isLocal = false) {
        console.log('[GameClient] Creating ANIME animal character:', name, archetype);

        const archetypeData = ARCHETYPES[archetype];
        if (!archetypeData) return;

        // Create player group
        const group = new THREE.Group();

        // Main body material (soft, smooth anime look)
        const bodyMaterial = new THREE.MeshToonMaterial({
            color: archetypeData.color,
            shininess: 30
        });

        // BODY - Big round belly (anime style)
        const bodyGeometry = new THREE.SphereGeometry(0.4, 16, 16);
        bodyGeometry.scale(1, 1.3, 0.9); // Slightly egg-shaped
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.3;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // HEAD - HUGE round head (anime proportion)
        const headGeometry = new THREE.SphereGeometry(0.35, 20, 20);
        const head = new THREE.Mesh(headGeometry, bodyMaterial);
        head.position.y = 0.85;
        head.castShadow = true;
        group.add(head);

        // SNOUT/MUZZLE - Cute protruding face
        const snoutGeometry = new THREE.SphereGeometry(0.2, 12, 12);
        snoutGeometry.scale(0.8, 0.7, 1.2);
        const snoutMaterial = new THREE.MeshToonMaterial({
            color: this.lightenColor(archetypeData.color, 40)
        });
        const snout = new THREE.Mesh(snoutGeometry, snoutMaterial);
        snout.position.set(0, 0.8, 0.3);
        snout.castShadow = true;
        group.add(snout);

        // NOSE - Black shiny nose
        const noseGeometry = new THREE.SphereGeometry(0.08, 8, 8);
        const noseMaterial = new THREE.MeshToonMaterial({ color: 0x000000 });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.position.set(0, 0.8, 0.45);
        group.add(nose);

        // EYES - BIG anime eyes with white shine
        const eyeWhiteGeometry = new THREE.SphereGeometry(0.12, 12, 12);
        const eyeWhiteMaterial = new THREE.MeshToonMaterial({ color: 0xFFFFFF });

        const leftEyeWhite = new THREE.Mesh(eyeWhiteGeometry, eyeWhiteMaterial);
        leftEyeWhite.position.set(-0.15, 0.95, 0.25);
        leftEyeWhite.scale.set(1, 1.2, 0.8);
        group.add(leftEyeWhite);

        const rightEyeWhite = new THREE.Mesh(eyeWhiteGeometry, eyeWhiteMaterial);
        rightEyeWhite.position.set(0.15, 0.95, 0.25);
        rightEyeWhite.scale.set(1, 1.2, 0.8);
        group.add(rightEyeWhite);

        // Eye pupils - Black with shine
        const pupilGeometry = new THREE.SphereGeometry(0.08, 10, 10);
        const pupilMaterial = new THREE.MeshToonMaterial({ color: 0x000000 });

        const leftPupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
        leftPupil.position.set(-0.15, 0.95, 0.32);
        group.add(leftPupil);

        const rightPupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
        rightPupil.position.set(0.15, 0.95, 0.32);
        group.add(rightPupil);

        // Eye shine/highlight (anime sparkle!)
        const shineGeometry = new THREE.SphereGeometry(0.03, 6, 6);
        const shineMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });

        const leftShine = new THREE.Mesh(shineGeometry, shineMaterial);
        leftShine.position.set(-0.13, 1.0, 0.35);
        group.add(leftShine);

        const rightShine = new THREE.Mesh(shineGeometry, shineMaterial);
        rightShine.position.set(0.17, 1.0, 0.35);
        group.add(rightShine);

        // EARS - Animal-specific (use archetype icon as hint)
        this.createEars(group, archetype, bodyMaterial);

        // ARMS - Short stubby arms (cute!)
        const armGeometry = new THREE.CapsuleGeometry(0.12, 0.3, 6, 12);
        const leftArm = new THREE.Mesh(armGeometry, bodyMaterial);
        leftArm.position.set(-0.45, 0.25, 0);
        leftArm.rotation.z = 0.3;
        leftArm.castShadow = true;
        group.add(leftArm);

        const rightArm = new THREE.Mesh(armGeometry, bodyMaterial);
        rightArm.position.set(0.45, 0.25, 0);
        rightArm.rotation.z = -0.3;
        rightArm.castShadow = true;
        group.add(rightArm);

        // PAWS/HANDS - Round paw at end of arm
        const pawGeometry = new THREE.SphereGeometry(0.1, 10, 10);
        const leftPaw = new THREE.Mesh(pawGeometry, bodyMaterial);
        leftPaw.position.set(-0.5, 0.0, 0);
        leftPaw.castShadow = true;
        group.add(leftPaw);

        const rightPaw = new THREE.Mesh(pawGeometry, bodyMaterial);
        rightPaw.position.set(0.5, 0.0, 0);
        rightPaw.castShadow = true;
        group.add(rightPaw);

        // LEGS - Short thick legs
        const legGeometry = new THREE.CapsuleGeometry(0.13, 0.4, 6, 12);
        const leftLeg = new THREE.Mesh(legGeometry, bodyMaterial);
        leftLeg.position.set(-0.18, -0.25, 0);
        leftLeg.castShadow = true;
        group.add(leftLeg);

        const rightLeg = new THREE.Mesh(legGeometry, bodyMaterial);
        rightLeg.position.set(0.18, -0.25, 0);
        rightLeg.castShadow = true;
        group.add(rightLeg);

        // FEET - Big round feet
        const footGeometry = new THREE.SphereGeometry(0.12, 10, 10);
        footGeometry.scale(1, 0.6, 1.2);
        const leftFoot = new THREE.Mesh(footGeometry, bodyMaterial);
        leftFoot.position.set(-0.18, -0.5, 0.05);
        leftFoot.castShadow = true;
        group.add(leftFoot);

        const rightFoot = new THREE.Mesh(footGeometry, bodyMaterial);
        rightFoot.position.set(0.18, -0.5, 0.05);
        rightFoot.castShadow = true;
        group.add(rightFoot);

        // TAIL - Cute fluffy tail
        this.createTail(group, archetype, bodyMaterial);

        // BELLY PATCH - Lighter colored belly
        const bellyGeometry = new THREE.SphereGeometry(0.25, 12, 12);
        bellyGeometry.scale(0.9, 1.1, 0.5);
        const bellyMaterial = new THREE.MeshToonMaterial({
            color: this.lightenColor(archetypeData.color, 60)
        });
        const belly = new THREE.Mesh(bellyGeometry, bellyMaterial);
        belly.position.set(0, 0.2, 0.35);
        group.add(belly);

        // Name tag
        const nameTag = this.createNameTag(name, isLocal);
        nameTag.position.y = 1.6;
        group.add(nameTag);

        this.scene.add(group);

        // Store player data with animation state
        this.players.set(peerId, {
            mesh: group,
            nameTag,
            archetype,
            body,
            head,
            leftArm,
            rightArm,
            leftLeg,
            rightLeg,
            leftPaw,
            rightPaw,
            animationState: {
                walkCycle: 0,
                isMoving: false,
                lastVelocity: { x: 0, z: 0 }
            },
            interpolation: {
                lastPos: { x: 0, y: 0, z: 0 },
                lastRot: { x: 0, y: 0, z: 0, w: 1 },
                targetPos: { x: 0, y: 0, z: 0 },
                targetRot: { x: 0, y: 0, z: 0, w: 1 }
            }
        });

        // Track local player for camera follow
        if (isLocal) {
            this.localPeerId = peerId;
        }

        console.log('[GameClient] ANIME animal character created!');
    }

    /**
     * Create animal-specific ears
     */
    createEars(group, archetype, bodyMaterial) {
        const earMaterial = bodyMaterial;

        switch(archetype) {
            case 'bear': // Round ears on top
                const bearEarGeo = new THREE.SphereGeometry(0.12, 10, 10);
                const leftBearEar = new THREE.Mesh(bearEarGeo, earMaterial);
                leftBearEar.position.set(-0.25, 1.15, 0.1);
                leftBearEar.castShadow = true;
                group.add(leftBearEar);

                const rightBearEar = new THREE.Mesh(bearEarGeo, earMaterial);
                rightBearEar.position.set(0.25, 1.15, 0.1);
                rightBearEar.castShadow = true;
                group.add(rightBearEar);
                break;

            case 'bunny': // Long upright ears
                const bunnyEarGeo = new THREE.CapsuleGeometry(0.08, 0.4, 6, 10);
                const leftBunnyEar = new THREE.Mesh(bunnyEarGeo, earMaterial);
                leftBunnyEar.position.set(-0.15, 1.3, 0);
                leftBunnyEar.rotation.z = -0.2;
                leftBunnyEar.castShadow = true;
                group.add(leftBunnyEar);

                const rightBunnyEar = new THREE.Mesh(bunnyEarGeo, earMaterial);
                rightBunnyEar.position.set(0.15, 1.3, 0);
                rightBunnyEar.rotation.z = 0.2;
                rightBunnyEar.castShadow = true;
                group.add(rightBunnyEar);
                break;

            case 'bull': // Small horns
                const hornGeo = new THREE.ConeGeometry(0.08, 0.25, 8);
                const hornMaterial = new THREE.MeshToonMaterial({ color: 0x8B4513 });
                const leftHorn = new THREE.Mesh(hornGeo, hornMaterial);
                leftHorn.position.set(-0.2, 1.2, 0.05);
                leftHorn.rotation.z = -0.5;
                leftHorn.castShadow = true;
                group.add(leftHorn);

                const rightHorn = new THREE.Mesh(hornGeo, hornMaterial);
                rightHorn.position.set(0.2, 1.2, 0.05);
                rightHorn.rotation.z = 0.5;
                rightHorn.castShadow = true;
                group.add(rightHorn);
                break;

            case 'monkey': // Round ears on side
                const monkeyEarGeo = new THREE.SphereGeometry(0.1, 10, 10);
                monkeyEarGeo.scale(1.2, 1, 0.3);
                const leftMonkeyEar = new THREE.Mesh(monkeyEarGeo, earMaterial);
                leftMonkeyEar.position.set(-0.35, 0.9, 0.1);
                leftMonkeyEar.castShadow = true;
                group.add(leftMonkeyEar);

                const rightMonkeyEar = new THREE.Mesh(monkeyEarGeo, earMaterial);
                rightMonkeyEar.position.set(0.35, 0.9, 0.1);
                rightMonkeyEar.castShadow = true;
                group.add(rightMonkeyEar);
                break;

            case 'frog': // No ears, but big eye bumps!
                // Eyes are already big, no extra ears needed
                break;
        }
    }

    /**
     * Create animal-specific tail
     */
    createTail(group, archetype, bodyMaterial) {
        switch(archetype) {
            case 'bear': // Short stubby tail
                const bearTailGeo = new THREE.SphereGeometry(0.12, 10, 10);
                const bearTail = new THREE.Mesh(bearTailGeo, bodyMaterial);
                bearTail.position.set(0, 0.1, -0.4);
                bearTail.castShadow = true;
                group.add(bearTail);
                break;

            case 'bunny': // Fluffy round tail
                const bunnyTailGeo = new THREE.SphereGeometry(0.15, 12, 12);
                const bunnyTail = new THREE.Mesh(bunnyTailGeo, bodyMaterial);
                bunnyTail.position.set(0, 0.2, -0.35);
                bunnyTail.castShadow = true;
                group.add(bunnyTail);
                break;

            case 'bull': // Thin tail with tuft
                const bullTailGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.4, 8);
                const bullTail = new THREE.Mesh(bullTailGeo, bodyMaterial);
                bullTail.position.set(0, 0.15, -0.4);
                bullTail.rotation.x = 0.5;
                bullTail.castShadow = true;
                group.add(bullTail);

                // Tuft at end
                const tuftGeo = new THREE.SphereGeometry(0.1, 8, 8);
                const tuft = new THREE.Mesh(tuftGeo, bodyMaterial);
                tuft.position.set(0, -0.05, -0.55);
                tuft.castShadow = true;
                group.add(tuft);
                break;

            case 'monkey': // Long curly tail
                const monkeyTailGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8);
                const monkeyTail = new THREE.Mesh(monkeyTailGeo, bodyMaterial);
                monkeyTail.position.set(0, 0.3, -0.5);
                monkeyTail.rotation.x = 1.0;
                monkeyTail.castShadow = true;
                group.add(monkeyTail);
                break;

            case 'frog': // No tail!
                break;
        }
    }

    /**
     * Helper: Lighten a color (for belly patch, snout)
     */
    lightenColor(hex, percent) {
        const color = new THREE.Color(hex);
        const hsl = { h: 0, s: 0, l: 0 };
        color.getHSL(hsl);
        hsl.l = Math.min(1, hsl.l + percent / 100);
        color.setHSL(hsl.h, hsl.s, hsl.l);
        return color.getHex();
    }

    /**
     * Create name tag sprite
     */
    createNameTag(name, isLocal) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        // Background
        context.fillStyle = isLocal ? 'rgba(255, 215, 0, 0.8)' : 'rgba(0, 0, 0, 0.6)';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Text
        context.fillStyle = 'white';
        context.font = 'bold 32px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(name, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(2, 0.5, 1);

        return sprite;
    }

    /**
     * Remove player
     */
    removePlayer(peerId) {
        const player = this.players.get(peerId);
        if (player) {
            this.scene.remove(player.mesh);
            this.players.delete(peerId);
            console.log('[GameClient] Player removed:', peerId);
        }
    }

    /**
     * Process snapshot from host
     */
    processSnapshot(snapshot) {
        // Add to buffer
        this.snapshotBuffer.push(snapshot);

        // Keep buffer limited
        if (this.snapshotBuffer.length > 10) {
            this.snapshotBuffer.shift();
        }

        // Ability/effect events decided by the authority — render them now
        if (snapshot.events && snapshot.events.length > 0) {
            snapshot.events.forEach(ev => this.playEvent(ev));
        }
    }

    /**
     * Render one authority-decided effect event.
     * Clients never decide outcomes; they only draw what the host broadcast.
     */
    playEvent(ev) {
        const sfx = (window.GameKit && window.GameKit.Sfx) ? window.GameKit.Sfx : null;

        switch (ev.type) {
            case 'groundSlam':
                this.spawnShockwaveRing(ev.x, ev.y, ev.z, ev.radius || 5, 0xffaa33);
                if (sfx) sfx.thud();
                break;

            case 'blinkDash':
                this.spawnDashStreak(ev.x, ev.y, ev.z, ev.dirX, ev.dirZ, 0xff8fd0);
                if (sfx) sfx.tone(600, 0.12, 'sine', 0.12, 1200);
                break;

            case 'charge':
                this.spawnAura(ev.peerId, 0xff3322, ev.duration || 0.9);
                if (sfx) sfx.tone(160, 0.3, 'sawtooth', 0.12, 320);
                break;

            case 'chargeHit':
                this.spawnBurst(ev.x, ev.y, ev.z, 0xffdd44);
                if (sfx) sfx.hit(2);
                break;

            case 'doubleJump':
                this.spawnShockwaveRing(ev.x, ev.y - 0.6, ev.z, 1.5, 0xffffff);
                if (sfx) sfx.tone(500, 0.1, 'triangle', 0.1, 900);
                break;

            case 'buff': {
                const colors = {
                    speed: 0x33ddff, power: 0xff8833,
                    shield: 0x4466ff, heal: 0x33dd66
                };
                this.spawnAura(ev.peerId, colors[ev.buff] || 0x33dd66,
                    Math.max(ev.duration, 1));
                if (sfx) sfx.ding();
                // Let the game layer toast the local player about their roll
                if (ev.peerId === this.localPeerId && this.onLocalBuff) {
                    this.onLocalBuff(ev.buff);
                }
                break;
            }
        }
    }

    /**
     * Expanding, fading ring lying flat on the ground.
     */
    spawnShockwaveRing(x, y, z, radius, color) {
        const geo = new THREE.RingGeometry(0.6, 1.0, 32);
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.85,
            side: THREE.DoubleSide, depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, Math.max(y - 0.4, 0.05), z);
        this.scene.add(mesh);

        this.effects.push({
            mesh, parent: this.scene, ttl: 0.5, life: 0.5,
            update: (e, t) => { // t: 1 -> 0 remaining life fraction
                const s = 1 + (1 - t) * radius;
                e.mesh.scale.set(s, s, 1);
                e.mesh.material.opacity = 0.85 * t;
            }
        });
    }

    /**
     * Fading streak along the dash direction.
     */
    spawnDashStreak(x, y, z, dirX, dirZ, color) {
        const LENGTH = 5;
        const geo = new THREE.CylinderGeometry(0.18, 0.18, LENGTH, 8);
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.7, depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        // Cylinder axis is Y; rotate it to lie along the dash direction
        mesh.position.set(x + dirX * LENGTH / 2, y, z + dirZ * LENGTH / 2);
        mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(dirX, 0, dirZ).normalize()
        );
        this.scene.add(mesh);

        this.effects.push({
            mesh, parent: this.scene, ttl: 0.35, life: 0.35,
            update: (e, t) => { e.mesh.material.opacity = 0.7 * t; }
        });
    }

    /**
     * Expanding, fading impact sphere.
     */
    spawnBurst(x, y, z, color) {
        const geo = new THREE.SphereGeometry(0.4, 12, 12);
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.9, depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        this.scene.add(mesh);

        this.effects.push({
            mesh, parent: this.scene, ttl: 0.4, life: 0.4,
            update: (e, t) => {
                const s = 1 + (1 - t) * 3;
                e.mesh.scale.set(s, s, s);
                e.mesh.material.opacity = 0.9 * t;
            }
        });
    }

    /**
     * Translucent glow attached to a player for a duration
     * (Bull's charge, Frog's buffs).
     */
    spawnAura(peerId, color, duration) {
        const player = this.players.get(peerId);
        if (!player) return;

        const geo = new THREE.SphereGeometry(0.9, 16, 16);
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.3, depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 0.4;
        player.mesh.add(mesh);

        this.effects.push({
            mesh, parent: player.mesh, ttl: duration, life: duration,
            update: (e, t) => {
                // Gentle pulse; fade out over the last quarter
                const pulse = 1 + 0.08 * Math.sin((e.life - e.ttl) * 12);
                e.mesh.scale.set(pulse, pulse, pulse);
                e.mesh.material.opacity = 0.3 * Math.min(1, t * 4);
            }
        });
    }

    /**
     * Advance and expire active effects (called from the render loop).
     */
    updateEffects(dt) {
        if (this.effects.length === 0) return;

        for (let i = this.effects.length - 1; i >= 0; i--) {
            const e = this.effects[i];
            e.ttl -= dt;
            if (e.ttl <= 0) {
                e.parent.remove(e.mesh);
                if (e.mesh.geometry) e.mesh.geometry.dispose();
                if (e.mesh.material) e.mesh.material.dispose();
                this.effects.splice(i, 1);
            } else {
                e.update(e, e.ttl / e.life);
            }
        }
    }

    /**
     * Update camera to follow local player from behind
     */
    updateCamera() {
        if (!this.cameraFollowEnabled || !this.localPeerId) return;

        const player = this.players.get(this.localPeerId);
        if (!player) return;

        const targetPos = player.mesh.position;

        // Extract Y-axis facing angle from quaternion
        const q = player.mesh.quaternion;
        const facingAngle = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));

        // Smoothly interpolate camera angle towards character facing + manual offset
        if (this._lastCameraFacing === undefined) this._lastCameraFacing = facingAngle;
        // Shortest-angle lerp
        let angleDiff = facingAngle - this._lastCameraFacing;
        if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        this._lastCameraFacing += angleDiff * 0.08;

        const totalAngle = this._lastCameraFacing + this.cameraAngle;

        // Position camera behind and above the character
        const behindX = -Math.sin(totalAngle) * this.cameraDistance;
        const behindZ = -Math.cos(totalAngle) * this.cameraDistance;
        const camX = targetPos.x + behindX;
        const camY = targetPos.y + this.cameraHeight;
        const camZ = targetPos.z + behindZ;

        // Smooth camera movement
        this.camera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.08);

        // Look at player (slightly above feet)
        this.camera.lookAt(targetPos.x, targetPos.y + 1, targetPos.z);
    }

    /**
     * Interpolate player positions
     */
    interpolatePlayers() {
        const now = Date.now();
        const renderTime = now - this.interpolationDelay;

        // Find two snapshots to interpolate between
        let snapshot0 = null;
        let snapshot1 = null;

        for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
            if (this.snapshotBuffer[i].t <= renderTime && this.snapshotBuffer[i + 1].t >= renderTime) {
                snapshot0 = this.snapshotBuffer[i];
                snapshot1 = this.snapshotBuffer[i + 1];
                break;
            }
        }

        if (!snapshot0 || !snapshot1) {
            // Use latest snapshot if available
            if (this.snapshotBuffer.length > 0) {
                snapshot1 = this.snapshotBuffer[this.snapshotBuffer.length - 1];
                snapshot0 = snapshot1;
            } else {
                return;
            }
        }

        // Interpolation factor
        const t = snapshot0.t === snapshot1.t ? 1 :
            (renderTime - snapshot0.t) / (snapshot1.t - snapshot0.t);

        // Interpolate each entity
        snapshot1.entities.forEach(entity => {
            const player = this.players.get(entity.id);
            if (!player) return;

            // Find corresponding entity in snapshot0
            const entity0 = snapshot0.entities.find(e => e.id === entity.id);
            if (!entity0) return;

            // Interpolate position
            const pos = {
                x: this.lerp(entity0.p.x, entity.p.x, t),
                y: this.lerp(entity0.p.y, entity.p.y, t),
                z: this.lerp(entity0.p.z, entity.p.z, t)
            };

            player.mesh.position.set(pos.x, pos.y, pos.z);

            // Apply rotation from snapshot (quaternion)
            if (entity.r && entity.r.w !== undefined) {
                player.mesh.quaternion.set(entity.r.x, entity.r.y, entity.r.z, entity.r.w);
            }
        });
    }

    /**
     * Linear interpolation
     */
    lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * Start rendering loop
     */
    startRendering() {
        if (this.animationId !== null) return;

        console.log('[GameClient] Starting render loop');
        this.lastRenderTime = performance.now();
        this.renderLoop();
    }

    /**
     * Render loop
     */
    renderLoop() {
        this.animationId = requestAnimationFrame(() => this.renderLoop());

        const now = performance.now();
        const dt = (now - this.lastRenderTime) / 1000;
        this.lastRenderTime = now;

        // Interpolate player positions
        this.interpolatePlayers();

        // Animate character limbs (walking animation)
        this.animateCharacters(dt);

        // Advance ability effect visuals
        this.updateEffects(dt);

        // Update camera
        this.updateCamera();

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Animate character limbs based on movement (ANIME STYLE - BOUNCY!)
     */
    animateCharacters(dt) {
        this.players.forEach((player, peerId) => {
            if (!player.leftLeg || !player.rightLeg) return;

            const mesh = player.mesh;
            const vel = mesh.position.clone().sub(player.animationState.lastVelocity);
            const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

            // Check if moving
            player.animationState.isMoving = speed > 0.01;

            if (player.animationState.isMoving) {
                // Walking animation - BOUNCY anime style!
                player.animationState.walkCycle += dt * 10; // Faster animation for cuteness

                const swingAmount = 0.5; // Exaggerated leg swing
                const cycle = player.animationState.walkCycle;

                // Legs swing with bounce
                player.leftLeg.rotation.x = Math.sin(cycle) * swingAmount;
                player.rightLeg.rotation.x = Math.sin(cycle + Math.PI) * swingAmount;

                // Arms swing opposite - more exaggerated
                if (player.leftArm && player.rightArm) {
                    player.leftArm.rotation.x = Math.sin(cycle + Math.PI) * swingAmount * 0.7;
                    player.rightArm.rotation.x = Math.sin(cycle) * swingAmount * 0.7;

                    // Arms also swing out slightly
                    player.leftArm.rotation.z = 0.3 + Math.sin(cycle) * 0.2;
                    player.rightArm.rotation.z = -0.3 + Math.sin(cycle + Math.PI) * 0.2;
                }

                // Paws bounce up and down
                if (player.leftPaw && player.rightPaw) {
                    player.leftPaw.position.y = 0.0 + Math.abs(Math.sin(cycle)) * 0.1;
                    player.rightPaw.position.y = 0.0 + Math.abs(Math.sin(cycle + Math.PI)) * 0.1;
                }

                // BODY BOUNCE - Big anime bounce!
                if (player.body) {
                    player.body.position.y = 0.3 + Math.abs(Math.sin(cycle * 2)) * 0.12;
                    // Slight tilt when walking
                    player.body.rotation.z = Math.sin(cycle) * 0.1;
                }

                // HEAD BOUNCE with slight delay for cuteness
                if (player.head) {
                    player.head.position.y = 0.85 + Math.abs(Math.sin(cycle * 2 + 0.2)) * 0.1;
                    // Head tilts slightly opposite to body
                    player.head.rotation.z = Math.sin(cycle) * -0.08;
                }

            } else {
                // Return to idle - smooth spring back
                const springBack = 0.85;

                player.leftLeg.rotation.x *= springBack;
                player.rightLeg.rotation.x *= springBack;

                if (player.leftArm && player.rightArm) {
                    player.leftArm.rotation.x *= springBack;
                    player.rightArm.rotation.x *= springBack;
                    player.leftArm.rotation.z = player.leftArm.rotation.z * springBack + 0.3 * (1 - springBack);
                    player.rightArm.rotation.z = player.rightArm.rotation.z * springBack + (-0.3) * (1 - springBack);
                }

                if (player.leftPaw && player.rightPaw) {
                    player.leftPaw.position.y *= springBack;
                    player.rightPaw.position.y *= springBack;
                }

                if (player.body) {
                    player.body.position.y = player.body.position.y * springBack + 0.3 * (1 - springBack);
                    player.body.rotation.z *= springBack;
                }

                if (player.head) {
                    player.head.position.y = player.head.position.y * springBack + 0.85 * (1 - springBack);
                    player.head.rotation.z *= springBack;
                }
            }

            // Store current position for next frame
            player.animationState.lastVelocity = mesh.position.clone();
        });
    }

    /**
     * Stop rendering
     */
    stopRendering() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
            console.log('[GameClient] Render loop stopped');
        }
    }

    /**
     * Handle window resize
     */
    onResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    /**
     * Cleanup
     */
    cleanup() {
        this.stopRendering();

        // Remove lingering ability effects
        this.effects.forEach(e => e.parent.remove(e.mesh));
        this.effects = [];

        // Remove players
        this.players.forEach((player, peerId) => {
            this.scene.remove(player.mesh);
        });
        this.players.clear();

        // Remove arena
        if (this.arena) {
            this.arena.forEach(obj => this.scene.remove(obj));
            this.arena = [];
        }

        // Remove renderer
        if (this.renderer) {
            this.container.removeChild(this.renderer.domElement);
            this.renderer.dispose();
        }

        console.log('[GameClient] Cleaned up');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameClient };
}

