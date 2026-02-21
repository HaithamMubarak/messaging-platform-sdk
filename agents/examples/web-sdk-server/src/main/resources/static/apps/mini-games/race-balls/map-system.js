/**
 * Race Balls - JSON Map System
 *
 * Contract:
 * - loadRaceMapConfig({ url, fetchImpl }) -> normalized map config
 * - validate + normalize: enforce required fields, apply defaults, and provide friendly errors.
 *
 * This module is intentionally standalone so maps can be added by dropping new JSON files.
 */

(function (global) {
    'use strict';

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function isObj(v) {
        return v && typeof v === 'object' && !Array.isArray(v);
    }

    function asNumber(v, fallback) {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    }

    function asString(v, fallback) {
        return (typeof v === 'string' && v.trim().length) ? v : fallback;
    }

    function readVec3(v, fallback) {
        if (isObj(v)) {
            return {
                x: asNumber(v.x, fallback.x),
                y: asNumber(v.y, fallback.y),
                z: asNumber(v.z, fallback.z),
            };
        }
        // Support legacy spawn format: {x,y,z} at top-level
        return { x: fallback.x, y: fallback.y, z: fallback.z };
    }

    function readEuler(v, fallback) {
        if (isObj(v)) {
            return {
                x: asNumber(v.x, fallback.x),
                y: asNumber(v.y, fallback.y),
                z: asNumber(v.z, fallback.z),
            };
        }
        return { x: fallback.x, y: fallback.y, z: fallback.z };
    }

    function readSize(v, fallback) {
        if (isObj(v)) {
            return {
                width: asNumber(v.width, fallback.width),
                height: asNumber(v.height, fallback.height),
                depth: asNumber(v.depth, fallback.depth),
            };
        }
        return { width: fallback.width, height: fallback.height, depth: fallback.depth };
    }

    function validateAndNormalizeRaceMap(raw) {
        const errors = [];

        if (!isObj(raw)) {
            throw new Error('Map JSON must be an object');
        }

        const schemaVersion = asNumber(raw.schemaVersion, 1);
        if (schemaVersion !== 1) {
            errors.push(`Unsupported schemaVersion: ${raw.schemaVersion}. Expected 1.`);
        }

        // ----------------------------
        // Metadata
        // ----------------------------
        const metadata = isObj(raw.metadata) ? raw.metadata : {};
        const id = asString(metadata.id, null);
        const name = asString(metadata.name, null);
        const mode = asString(metadata.mode, 'race');
        const maxPlayers = Math.floor(asNumber(metadata.maxPlayers, 4));

        if (!id) errors.push('metadata.id is required');
        if (!name) errors.push('metadata.name is required');
        if (mode !== 'race') errors.push(`metadata.mode must be "race" (got ${JSON.stringify(mode)})`);
        if (!Number.isFinite(maxPlayers) || maxPlayers < 1 || maxPlayers > 64) errors.push('metadata.maxPlayers must be between 1 and 64');

        // ----------------------------
        // Physics defaults
        // ----------------------------
        const pd = isObj(raw.physicsDefaults) ? raw.physicsDefaults : {};
        const physicsDefaults = {
            gravity: asNumber(pd.gravity, -20),
            friction: asNumber(pd.friction ?? pd.defaultFriction, 0.35),
            restitution: asNumber(pd.restitution ?? pd.defaultRestitution, 0.25),
            linearDamping: asNumber(pd.linearDamping, 0.35),
            angularDamping: asNumber(pd.angularDamping, 0.35),
            maxNormalSpeed: asNumber(pd.maxNormalSpeed, 10),
            maxBoostSpeed: asNumber(pd.maxBoostSpeed, 16),
        };

        // Clamp a few obvious cases
        physicsDefaults.friction = clamp(physicsDefaults.friction, 0, 2);
        physicsDefaults.restitution = clamp(physicsDefaults.restitution, 0, 2);

        // ----------------------------
        // Spawns
        // Support both:
        // - spawns: [{position, rotation}]
        // - spawns: [{x,y,z}] (legacy)
        // ----------------------------
        const rawSpawns = Array.isArray(raw.spawns) ? raw.spawns : [];
        const spawns = rawSpawns.map((s, idx) => {
            const pos = readVec3(isObj(s) ? (s.position ?? s) : null, { x: -3 + idx * 2, y: 2, z: 2 });
            const rot = readEuler(isObj(s) ? s.rotation : null, { x: 0, y: 0, z: 0 });
            return { position: pos, rotation: rot };
        });

        if (spawns.length === 0) {
            errors.push('spawns must be a non-empty array');
        }

        // ----------------------------
        // Friction/material types
        // frictionTypes: { normal: { friction, restitution, color } }
        // Also allow alias materials in the future.
        // ----------------------------
        const ft = isObj(raw.frictionTypes) ? raw.frictionTypes : {};
        const frictionTypes = {};
        for (const [key, infoRaw] of Object.entries(ft)) {
            const info = isObj(infoRaw) ? infoRaw : {};
            frictionTypes[key] = {
                friction: clamp(asNumber(info.friction, physicsDefaults.friction), 0, 2),
                restitution: clamp(asNumber(info.restitution, physicsDefaults.restitution), 0, 2),
                color: asString(info.color, '#4a5568'),
                name: asString(info.name, key),
            };
        }
        if (!frictionTypes.normal) {
            // Always ensure 'normal' exists as a fallback.
            frictionTypes.normal = {
                friction: 0.5,
                restitution: 0.2,
                color: '#4a5568',
                name: 'Normal'
            };
        }

        // Create array of valid friction type keys for validation
        const ftypes = Object.keys(frictionTypes);

        // ----------------------------
        // Track & ground
        // ----------------------------
        const track = isObj(raw.track) ? raw.track : {};
        const rawSegments = Array.isArray(track.groundSegments) ? track.groundSegments : [];
        const groundSegments = rawSegments.map((seg, i) => {
            const s = isObj(seg) ? seg : {};
            const id = asString(s.id, `ground-${i}`);
            const position = readVec3(s.position, { x: 0, y: 0, z: 0 });
            const size = readSize(s.size, { width: 10, height: 1, depth: 10 });
            const rotation = readEuler(s.rotation, { x: 0, y: 0, z: 0 });
            const frictionType = asString(s.frictionType, 'normal');
            if (!frictionTypes[frictionType]) {
                errors.push(`Unknown frictionType "${frictionType}" in track.groundSegments[${i}] (${id})`);
            }
            return { id, position, size, rotation, frictionType };
        });

        // ----------------------------
        // Obstacles (boxes / barriers)
        // ----------------------------
        function normalizeBoxArray(rawArr, label, defaultColor) {
            const arr = Array.isArray(rawArr) ? rawArr : [];
            return arr.map((o, i) => {
                const ob = isObj(o) ? o : {};
                const id = asString(ob.id, `${label}-${i}`);
                const position = readVec3(ob.position, { x: 0, y: 1, z: 0 });
                const size = readSize(ob.size, { width: 1, height: 1, depth: 1 });
                const rotation = readEuler(ob.rotation, { x: 0, y: 0, z: 0 });
                const color = asString(ob.color, defaultColor);
                const physics = isObj(ob.physics) ? ob.physics : null;
                const physicsOverrides = physics ? {
                    frictionType: physics.frictionType ? asString(physics.frictionType, null) : null,
                    restitution: (physics.restitution != null) ? clamp(asNumber(physics.restitution, physicsDefaults.restitution), 0, 2) : null,
                    friction: (physics.friction != null) ? clamp(asNumber(physics.friction, physicsDefaults.friction), 0, 2) : null,
                } : null;
                if (physicsOverrides?.frictionType && !frictionTypes[physicsOverrides.frictionType]) {
                    errors.push(`Unknown physics.frictionType "${physicsOverrides.frictionType}" in ${label}[${i}] (${id})`);
                }
                return { id, type: asString(ob.type, 'box'), position, size, rotation, color, physics: physicsOverrides };
            });
        }

        const obstacles = normalizeBoxArray(raw.obstacles, 'obstacle', '#718096');
        const walls = normalizeBoxArray(raw.walls, 'wall', '#2d3748');

        // ----------------------------
        // Bounce elements (pads/walls)
        // For backward compatibility, also accept "bouncers".
        // ----------------------------
        const rawBounce = Array.isArray(raw.bounceElements) ? raw.bounceElements : (Array.isArray(raw.bouncers) ? raw.bouncers : []);
        const bounceElements = rawBounce.map((b, i) => {
            const bb = isObj(b) ? b : {};
            const id = asString(bb.id, `bounce-${i}`);
            const position = readVec3(bb.position, { x: 0, y: 0, z: 0 });
            const size = readSize(bb.size, { width: 1, height: 1, depth: 1 });
            const rotation = readEuler(bb.rotation, { x: 0, y: 0, z: 0 });
            const restitution = clamp(asNumber(bb.restitution, 1.2), 0, 2);
            const color = asString(bb.color, '#e53e3e');
            return { id, type: asString(bb.type, 'rubber'), position, size, rotation, restitution, color };
        });

        // ----------------------------
        // Dizzy Obstacles
        // Special obstacles that temporarily disable player control on touch.
        // ----------------------------
        const rawDizzy = Array.isArray(raw.dizzyObstacles) ? raw.dizzyObstacles : [];
        const dizzyObstacles = rawDizzy.map((d, i) => {
            const dd = isObj(d) ? d : {};
            const id = asString(dd.id, `dizzy-${i}`);
            const position = readVec3(dd.position, { x: 0, y: 0, z: 0 });
            const size = readSize(dd.size, { width: 1, height: 2, depth: 1 });
            const rotation = readEuler(dd.rotation, { x: 0, y: 0, z: 0 });
            const dizzyDurationSeconds = Math.max(0.1, asNumber(dd.dizzyDurationSeconds ?? dd.duration, 3));
            const color = asString(dd.color, '#a855f7'); // Purple by default
            const frictionType = asString(dd.physics?.frictionType, 'normal');
            if (!ftypes.includes(frictionType)) errors.push(`dizzyObstacles[${i}]: unknown frictionType "${frictionType}"`);
            return { id, position, size, rotation, dizzyDurationSeconds, color, physics: { frictionType } };
        });

        // ----------------------------
        // Pickups
        // Accept both restoreAmount (legacy) and staminaRestoreAmount (new).
        // ----------------------------
        const rawPickups = Array.isArray(raw.pickups) ? raw.pickups : [];
        const pickups = rawPickups.map((p, i) => {
            const pu = isObj(p) ? p : {};
            const id = asString(pu.id, `pickup-${i}`);
            const position = readVec3(pu.position, { x: 0, y: 1.5, z: 0 });
            const radius = Math.max(0.05, asNumber(pu.radius, 0.5));
            const staminaRestoreAmount = clamp(asNumber(pu.staminaRestoreAmount ?? pu.restoreAmount, 20), 0, 100);
            const respawnSeconds = (pu.respawnSeconds == null) ? null : Math.max(0, asNumber(pu.respawnSeconds, 0));
            const color = asString(pu.color, '#48bb78');
            const kind = asString(pu.kind ?? pu.type ?? 'energy', 'energy');
            return { id, kind, position, radius, staminaRestoreAmount, respawnSeconds, color };
        });

        // ----------------------------
        // Checkpoints + finish
        // ----------------------------
        const rawCps = Array.isArray(raw.checkpoints) ? raw.checkpoints : [];
        const checkpoints = rawCps.map((c, i) => {
            const cp = isObj(c) ? c : {};
            const id = asString(cp.id, `cp-${i + 1}`);
            const position = readVec3(cp.position, { x: 0, y: 2, z: 0 });
            const radius = Math.max(0.2, asNumber(cp.radius, 6));
            const order = Math.floor(asNumber(cp.order, i));
            return { id, position, radius, order };
        }).sort((a, b) => a.order - b.order);

        // Validate unique checkpoint orders
        const orderSet = new Set();
        for (const cp of checkpoints) {
            if (orderSet.has(cp.order)) errors.push(`Duplicate checkpoint order ${cp.order}`);
            orderSet.add(cp.order);
        }

        const finishRaw = isObj(raw.finishLine) ? raw.finishLine : null;
        const finishLine = finishRaw ? {
            position: readVec3(finishRaw.position, { x: 0, y: 2, z: 0 }),
            radius: Math.max(0.2, asNumber(finishRaw.radius, 5)),
            requiredCheckpoints: Math.floor(asNumber(finishRaw.requiredCheckpoints, checkpoints.length)),
        } : null;

        if (!finishLine) {
            errors.push('finishLine is required');
        }

        // ----------------------------
        // Uniqueness: ids across arrays
        // ----------------------------
        function checkUniqueIds(items, label) {
            const set = new Set();
            for (const it of items) {
                if (!it || !it.id) continue;
                if (set.has(it.id)) errors.push(`Duplicate id "${it.id}" in ${label}`);
                set.add(it.id);
            }
        }
        checkUniqueIds(groundSegments, 'track.groundSegments');
        checkUniqueIds(obstacles, 'obstacles');
        checkUniqueIds(walls, 'walls');
        checkUniqueIds(bounceElements, 'bounceElements');
        checkUniqueIds(dizzyObstacles, 'dizzyObstacles');
        checkUniqueIds(pickups, 'pickups');
        checkUniqueIds(checkpoints, 'checkpoints');

        if (errors.length) {
            const msg = 'Invalid map config:\n' + errors.map(e => `- ${e}`).join('\n');
            const err = new Error(msg);
            err.name = 'RaceMapValidationError';
            err.details = errors;
            throw err;
        }

        return {
            schemaVersion,
            metadata: { id, name, mode, maxPlayers, description: asString(metadata.description, '') },
            physicsDefaults,
            spawns,
            frictionTypes,
            track: { groundSegments },
            walls,
            obstacles,
            bounceElements,
            dizzyObstacles,
            pickups,
            checkpoints,
            finishLine,
            lighting: isObj(raw.lighting) ? raw.lighting : null,
            skybox: isObj(raw.skybox) ? raw.skybox : null,
        };
    }

    async function loadRaceMapConfig(opts) {
        const url = opts?.url || 'map-default.json';
        const fetchImpl = opts?.fetchImpl || fetch;

        const resp = await fetchImpl(url);
        if (!resp.ok) {
            throw new Error(`Failed to load map: ${url} (${resp.status})`);
        }
        const raw = await resp.json();
        return validateAndNormalizeRaceMap(raw);
    }

    global.RaceMapSystem = {
        loadRaceMapConfig,
        validateAndNormalizeRaceMap,
    };
})(typeof window !== 'undefined' ? window : globalThis);
