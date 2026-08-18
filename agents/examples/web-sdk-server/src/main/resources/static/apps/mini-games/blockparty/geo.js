/**
 * BlockParty — the world as a place
 *
 * The grid stops being abstract once it is pinned to somewhere real. A room
 * picks an anchor — a latitude and longitude that sits at world origin — and a
 * scale in metres per block. Every cell then *is* a piece of ground: you can
 * fly to your own street and build on it, walk to where another player is
 * standing and add to what they made, and come back tomorrow to the same spot.
 *
 * The projection is a local equirectangular one. Over a world 161 blocks wide
 * that is a few hundred metres at most, where the error against a proper
 * geodesic is millimetres — and it is reversible, cheap, and easy to reason
 * about, which matters more here than geodetic purity.
 *
 * Location is private. Nothing is read until a player asks for it, nothing is
 * shared until they say so, and what is shared is rounded — a room needs to
 * know which building you are at, not which chair.
 */
(function () {
    'use strict';

    // Web Mercator, the projection every slippy map uses. It lives here rather
    // than in the minimap because the world's *regions* are defined by it: the
    // Earth is cut into tiles, and one tile is one BlockParty world.
    const lonToTileX = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
    const latToTileY = (lat, z) => {
        const r = lat * Math.PI / 180;
        return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
    };
    const tileXToLon = (x, z) => x / Math.pow(2, z) * 360 - 180;
    const tileYToLat = (y, z) => {
        const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
        return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    };

    const M_PER_DEG_LAT = 110540;    // good to ~0.1% anywhere
    const M_PER_DEG_LON = 111320;    // times cos(latitude)
    const SHARE_THROTTLE_MS = 5000;  // a position update at walking pace
    const SHARE_PRECISION = 5;       // metres: enough to find you, not to watch you
    const VISIT_LIMIT = 12;          // how many places back each player is remembered
    const SAME_PLACE_DEG = 1e-4;     // ~11m: closer than this is the same visit

    class Geo {
        constructor(game) {
            this.game = game;
            this.anchor = null;        // { lat, lon, mpc } — mpc = metres per cell
            this.mine = null;          // my last fix: { lat, lon, acc }
            this.sharing = false;
            this.others = new Map();   // name -> { lat, lon, at } — sharing right now
            // Where everyone was the last time they said. This outlives their
            // sharing, their session and the browser: a room that has been used
            // for a week remembers where its people stood, which is what makes
            // "go to where they were" possible when they are not here.
            this.lastSeen = new Map();  // name -> { lat, lon, acc, at }
            // Where everyone has *taken the room*, newest first. A position is
            // where somebody is standing; a visit is somewhere they decided to
            // go, which is the thing worth offering back as "take me there
            // again". Kept per player, capped, and stored with the room.
            this.visits = new Map();    // name -> [{ lat, lon, mpc, at }]
            this._seenDirty = false;
            this._watchId = null;
            this._lastShared = 0;
        }

        get available() { return !!navigator.geolocation; }
        get anchored() { return !!this.anchor; }

        // ---- projection --------------------------------------------------

        /** Real coordinates to world cells. */
        toWorld(lat, lon) {
            if (!this.anchor) return null;
            const { lat: aLat, lon: aLon, mpc } = this.anchor;
            const east = (lon - aLon) * M_PER_DEG_LON * Math.cos(aLat * Math.PI / 180);
            const north = (lat - aLat) * M_PER_DEG_LAT;
            // North is -Z, so that a map of the world reads the usual way up.
            return { x: east / mpc, z: -north / mpc };
        }

        /** World cells back to real coordinates. */
        toLatLon(x, z) {
            if (!this.anchor) return null;
            const { lat: aLat, lon: aLon, mpc } = this.anchor;
            const north = -z * mpc, east = x * mpc;
            return {
                lat: aLat + north / M_PER_DEG_LAT,
                lon: aLon + east / (M_PER_DEG_LON * Math.cos(aLat * Math.PI / 180))
            };
        }

        /** How far across the world is, in metres. */
        span() {
            const half = this.game.voxels.half;
            return this.anchor ? Math.round((half * 2 + 1) * this.anchor.mpc) : 0;
        }

        // ---- the anchor --------------------------------------------------

        /**
         * Pin the world to a place. Host-only: it moves everybody's idea of
         * where the world is, so it travels with the world snapshot.
         */
        setAnchor(lat, lon, mpc) {
            // Snap to the region that contains this point, so the same place
            // always produces the same world rather than one offset by however
            // far the person who pinned it was standing.
            const region = this.regionFor(+lat, +lon, mpc || 2);
            this.region = region;
            this.anchor = {
                lat: +region.lat.toFixed(6), lon: +region.lon.toFixed(6),
                mpc: region.mpc, region: region.key, z: region.z, tx: region.x, ty: region.y
            };
            this.game.voxels.setGeoAnchor(this.anchor);
            return this.anchor;
        }

        applyAnchor(anchor) {
            this.anchor = anchor || null;
            this.region = anchor && anchor.z !== undefined
                ? this.regionAt(anchor.z, anchor.tx, anchor.ty) : null;
            this.game.voxels.setGeoAnchor(this.anchor);
            this._renderMarkers();
        }

        /** Which stored world this place is. */
        regionKey() { return this.anchor && this.anchor.region ? this.anchor.region : null; }

        // ---- my position -------------------------------------------------

        /** Ask the browser once. Returns a promise; rejects if refused. */
        locate() {
            return new Promise((resolve, reject) => {
                if (!this.available) return reject(new Error('This browser has no location service'));
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        this.mine = {
                            lat: pos.coords.latitude, lon: pos.coords.longitude,
                            acc: Math.round(pos.coords.accuracy || 0)
                        };
                        resolve(this.mine);
                    },
                    (err) => reject(new Error(err.message || 'Location refused')),
                    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
                );
            });
        }

        /**
         * Start sharing. Positions are rounded before they leave the browser,
         * and the watch is stopped the moment sharing is turned off.
         */
        startSharing() {
            if (!this.available || this.sharing) return false;
            this.sharing = true;
            this._watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    this.mine = {
                        lat: pos.coords.latitude, lon: pos.coords.longitude,
                        acc: Math.round(pos.coords.accuracy || 0)
                    };
                    this._share();
                },
                () => this.stopSharing(),
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
            );
            return true;
        }

        stopSharing() {
            if (this._watchId !== null) navigator.geolocation.clearWatch(this._watchId);
            this._watchId = null;
            if (this.sharing) {
                this.sharing = false;
                this.game.sendGeo({ name: this.game.username, hide: true });
            }
            this.game._syncGeoUI();
        }

        /** Round to roughly SHARE_PRECISION metres before telling anyone. */
        _blur(lat, lon) {
            const dLat = SHARE_PRECISION / M_PER_DEG_LAT;
            const dLon = SHARE_PRECISION / (M_PER_DEG_LON * Math.cos(lat * Math.PI / 180));
            return { lat: Math.round(lat / dLat) * dLat, lon: Math.round(lon / dLon) * dLon };
        }

        _share() {
            if (!this.sharing || !this.mine) return;
            const now = Date.now();
            if (now - this._lastShared < SHARE_THROTTLE_MS) return;
            this._lastShared = now;
            const blurred = this._blur(this.mine.lat, this.mine.lon);
            this.game.sendGeo({
                name: this.game.username,
                lat: +blurred.lat.toFixed(6), lon: +blurred.lon.toFixed(6),
                acc: this.mine.acc
            });
            this._renderMarkers();
        }

        // ---- everybody else ----------------------------------------------

        receive(msg) {
            if (!msg || !msg.name) return;
            if (msg.visit) this.recordVisit(msg.name, msg.visit);
            if (msg.hide) {
                this.others.delete(msg.name);
            } else {
                const rec = { lat: msg.lat, lon: msg.lon, acc: msg.acc, at: Date.now() };
                this.others.set(msg.name, rec);
                this.remember(msg.name, rec);
            }
            this._renderMarkers();
            this.game._syncGeoUI();
        }

        /** Note where somebody was, for after they have gone. */
        remember(name, rec) {
            this.lastSeen.set(name, { lat: rec.lat, lon: rec.lon, acc: rec.acc, at: rec.at || Date.now() });
            this._seenDirty = true;
            this.game.scheduleGeoSave();
        }

        /**
         * Note somewhere a player took the room to.
         *
         * Arriving twice at the same place is one visit, not two: travelling is
         * how you change scale, so a run of scale changes over one spot would
         * otherwise fill the whole history with the same street.
         */
        recordVisit(name, visit) {
            if (!name || !visit || !isFinite(visit.lat) || !isFinite(visit.lon)) return null;
            const rec = {
                lat: +(+visit.lat).toFixed(6), lon: +(+visit.lon).toFixed(6),
                mpc: +visit.mpc || 0, at: visit.at || Date.now(),
                region: visit.region || null
            };
            const list = this.visits.get(name) || [];
            const same = list[0] && Math.abs(list[0].lat - rec.lat) < SAME_PLACE_DEG
                && Math.abs(list[0].lon - rec.lon) < SAME_PLACE_DEG;
            if (same) list[0] = Object.assign(list[0], { mpc: rec.mpc, at: rec.at, region: rec.region });
            else list.unshift(rec);
            if (list.length > VISIT_LIMIT) list.length = VISIT_LIMIT;
            this.visits.set(name, list);
            this.game.scheduleGeoSave();
            return rec;
        }

        /** Where somebody has been, newest first. */
        visitsOf(name) { return this.visits.get(name) || []; }

        /** Everyone with a history, whether or not they are still here. */
        travellers() { return Array.from(this.visits.keys()); }

        exportVisits() {
            const out = {};
            this.visits.forEach((list, name) => { out[name] = list; });
            return out;
        }

        importVisits(data) {
            if (!data) return;
            Object.keys(data).forEach(name => {
                const incoming = Array.isArray(data[name]) ? data[name] : [];
                const merged = incoming.concat(this.visits.get(name) || [])
                    .filter(r => r && isFinite(r.lat) && isFinite(r.lon));
                // Newest first, and one entry per place rather than one per
                // arrival — two peers each remember the same journey.
                merged.sort((a, b) => (b.at || 0) - (a.at || 0));
                const kept = [];
                merged.forEach(r => {
                    if (kept.some(k => Math.abs(k.lat - r.lat) < SAME_PLACE_DEG
                        && Math.abs(k.lon - r.lon) < SAME_PLACE_DEG)) return;
                    kept.push(r);
                });
                if (kept.length > VISIT_LIMIT) kept.length = VISIT_LIMIT;
                this.visits.set(name, kept);
            });
        }

        /** They left the room, but not the record of where they were. */
        forget(name) {
            this.others.delete(name);
            this._renderMarkers();
            this.game._syncGeoUI();
        }

        /** Everything worth writing down, for channel storage. */
        exportSeen() {
            const out = {};
            this.lastSeen.forEach((rec, name) => { out[name] = rec; });
            return out;
        }

        importSeen(data) {
            if (!data) return;
            Object.keys(data).forEach(name => {
                const rec = data[name];
                if (!rec || typeof rec.lat !== 'number') return;
                const known = this.lastSeen.get(name);
                if (!known || (rec.at || 0) > (known.at || 0)) this.lastSeen.set(name, rec);
            });
            this._renderMarkers();
            this.game._syncGeoUI();
        }

        /** Live position if they are sharing, otherwise the last one known. */
        placeOf(name) {
            const live = name === this.game.username ? (this.sharing ? this.mine : null) : this.others.get(name);
            if (live) return { rec: live, live: true };
            const seen = this.lastSeen.get(name);
            if (seen) return { rec: seen, live: false };
            // My own device knows where I am even when I am not telling anyone.
            if (name === this.game.username && this.mine) return { rec: this.mine, live: false, private: true };
            return null;
        }

        /** Everyone this room can point at, live or remembered. */
        roster() {
            const names = new Set();
            if (this.mine) names.add(this.game.username);
            this.others.forEach((_r, n) => names.add(n));
            this.lastSeen.forEach((_r, n) => names.add(n));
            return Array.from(names).map(name => {
                const place = this.placeOf(name);
                return place ? {
                    name, live: place.live, private: !!place.private,
                    at: place.rec.at, acc: place.rec.acc,
                    // The raw fix as well as the world cell: a map that can pan
                    // past this world's edges still has to draw the people who
                    // are past them.
                    lat: place.rec.lat, lon: place.rec.lon,
                    pos: this.worldPosOf(name)
                } : null;
            }).filter(Boolean);
        }

        /** Where a player is, in world cells — null if they are off the grid. */
        worldPosOf(name) {
            const place = this.placeOf(name);
            const rec = place && place.rec;
            if (!rec || !this.anchor) return null;
            const p = this.toWorld(rec.lat, rec.lon);
            const half = this.game.voxels.half;
            if (Math.abs(p.x) > half || Math.abs(p.z) > half) return { ...p, outside: true };
            return p;
        }

        _renderMarkers() {
            const v = this.game.voxels;
            if (!this.anchor) { v.clearGeoMarkers(); return; }
            const shown = new Set();
            this.roster().forEach(entry => {
                const p = entry.pos;
                if (!p || p.outside) return;
                shown.add(entry.name);
                // A live pin is solid; a remembered one is faded, so you can
                // tell "they are there" from "they were there".
                v.setGeoMarker(entry.name, p.x, p.z, this.game.generateUserColor(entry.name),
                    entry.name === this.game.username, entry.live);
            });
            v.pruneGeoMarkers(shown);
        }

        /**
         * How far away somebody is, and in which direction — for the ones who
         * are not in this region at all.
         */
        offsetTo(name) {
            const place = this.placeOf(name);
            if (!place || !this.anchor) return null;
            const dLat = place.rec.lat - this.anchor.lat;
            const dLon = place.rec.lon - this.anchor.lon;
            const north = dLat * M_PER_DEG_LAT;
            const east = dLon * M_PER_DEG_LON * Math.cos(this.anchor.lat * Math.PI / 180);
            const metres = Math.round(Math.hypot(north, east));
            const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
            const bearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
            return { metres, bearing: Math.round(bearing), dir: compass[Math.round(bearing / 45) % 8] };
        }

        /**
         * Fly the camera to where somebody actually is.
         *
         * If they are not in this region — which happens the moment somebody
         * stands on the far side of the boundary — say so along with how far
         * and which way, so the room can decide to travel there instead.
         */
        goTo(name) {
            const p = this.worldPosOf(name);
            if (!p) return null;
            if (p.outside) return Object.assign({ outside: true }, this.offsetTo(name) || {});
            this.game.voxels.focus(Math.round(p.x), 2, Math.round(p.z), 34, Math.PI * 0.3);
            return p;
        }

        /** Redraw the pins — after a move, or when the roster changes. */
        refresh() { this._renderMarkers(); }

        /** Where somebody is, as coordinates — for travelling to their region. */
        coordsOf(name) {
            const place = this.placeOf(name);
            return place ? { lat: place.rec.lat, lon: place.rec.lon } : null;
        }

        /** "just now", "12m ago", "3h ago" — how stale a position is. */
        static ago(at) {
            if (!at) return '';
            const s = Math.max(0, Math.round((Date.now() - at) / 1000));
            if (s < 45) return 'just now';
            if (s < 3600) return Math.round(s / 60) + 'm ago';
            if (s < 86400) return Math.round(s / 3600) + 'h ago';
            return Math.round(s / 86400) + 'd ago';
        }

        // ---- the Earth, cut into worlds ---------------------------------
        /**
         * The Earth is bigger than one world, so it is divided into them.
         *
         * A region is a Web Mercator tile: at a given scale, the tile that
         * contains a point *is* the world you build in there, and its centre is
         * the anchor. Two players who ask for the same place at the same scale
         * therefore get the same world, which is what lets a build be somewhere
         * rather than merely somewhere-relative-to-whoever-pinned-it.
         */
        regionFor(lat, lon, mpc) {
            const cells = this.game.voxels.half * 2 + 1;
            const z = Geo.zoomForScale(lat, mpc, cells);
            const x = Math.floor(lonToTileX(lon, z));
            const y = Math.floor(latToTileY(lat, z));
            return this.regionAt(z, x, y);
        }

        /**
         * A region and the world that covers it, exactly.
         *
         * The scale is derived from the tile rather than chosen freely: the
         * world is made to fit its region precisely, so every point in the
         * region is somewhere you can build and no two regions overlap. Picking
         * a round metres-per-block instead would leave a margin of real ground
         * that belongs to a region but falls off the edge of its world — which
         * is exactly where somebody standing near a boundary ends up.
         */
        regionAt(z, x, y) {
            const north = tileYToLat(y, z), south = tileYToLat(y + 1, z);
            const west = tileXToLon(x, z), east = tileXToLon(x + 1, z);
            const lat = (north + south) / 2;
            const cells = this.game.voxels.half * 2 + 1;
            const mpc = +(Geo.tileMetres(z, lat) / cells).toFixed(3);
            return {
                z, x, y, mpc,
                lat, lon: (west + east) / 2,
                key: `${z}_${x}_${y}`
            };
        }

        /** How much ground one tile covers at this zoom and latitude. */
        static tileMetres(z, lat) {
            return 156543.033928 * Math.cos(lat * Math.PI / 180) * 256 / Math.pow(2, z);
        }

        /** The zoom whose tile is about as wide as the world is. */
        static zoomForScale(lat, mpc, cells) {
            const spanM = Math.max(1, cells * mpc);
            const z = Math.log2(156543.033928 * Math.cos(lat * Math.PI / 180) * 256 / spanM);
            return Math.max(0, Math.min(19, Math.round(z)));
        }

        /** Step one region north, south, east or west. */
        /** The region one step north, south, east or west of this one. */
        neighbour(dir) {
            if (!this.region) return null;
            const { z, x, y } = this.region;
            const span = Math.pow(2, z);
            const wrap = (v) => ((v % span) + span) % span;
            const d = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[dir] || [0, 0];
            return this.regionAt(z, wrap(x + d[0]), Math.max(0, Math.min(span - 1, y + d[1])));
        }

        static get MERCATOR() { return { lonToTileX, latToTileY, tileXToLon, tileYToLat }; }

        /**
         * Read a place a person typed.
         *
         * Decimal pairs are what the UI asks for, but coordinates are copied
         * from everywhere — a map URL, a phone's share sheet, a paper chart —
         * so degrees/minutes/seconds and N/S/E/W suffixes are accepted too.
         * Returns null rather than guessing when it cannot tell.
         */
        static parse(text) {
            const raw = String(text || '').trim();
            if (!raw) return null;

            // "51°30'26.6\"N 0°7'39.9\"W" and its many typographic variants.
            const dms = /(-?\d+(?:\.\d+)?)\s*[°d:\s]\s*(?:(\d+(?:\.\d+)?)\s*['′m:\s]\s*)?(?:(\d+(?:\.\d+)?)\s*["″s]?\s*)?([NnSsEeWw])/g;
            const found = [];
            let m;
            while ((m = dms.exec(raw)) !== null) {
                const deg = Math.abs(+m[1]) + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600;
                const hemi = m[4].toUpperCase();
                // The hemisphere letter is the sign; a stray minus in front of
                // a "51°N" is a contradiction, not a second negation.
                const value = (hemi === 'S' || hemi === 'W') ? -deg : deg;
                found.push({ value, axis: (hemi === 'N' || hemi === 'S') ? 'lat' : 'lon' });
            }
            if (found.length >= 2) {
                const lat = (found.find(f => f.axis === 'lat') || found[0]).value;
                const lon = (found.find(f => f.axis === 'lon') || found[1]).value;
                return Geo.validate(lat, lon);
            }

            // Otherwise: two numbers, however they are separated.
            const nums = raw.match(/-?\d+(?:\.\d+)?/g);
            if (!nums || nums.length < 2) return null;
            return Geo.validate(+nums[0], +nums[1]);
        }

        /** A pair of numbers is only a place if it is on the Earth. */
        static validate(lat, lon) {
            if (!isFinite(lat) || !isFinite(lon)) return null;
            if (Math.abs(lat) > 85.05 || Math.abs(lon) > 180) return null;
            return { lat, lon };
        }

        /** A readable rendering of a place, for the UI. */
        static format(lat, lon) {
            const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
            return `${Math.abs(lat).toFixed(5)}°${ns}, ${Math.abs(lon).toFixed(5)}°${ew}`;
        }
    }

    window.BlockPartyGeo = Geo;
})();
