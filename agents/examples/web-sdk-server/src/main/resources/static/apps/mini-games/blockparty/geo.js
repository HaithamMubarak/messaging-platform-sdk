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

    const M_PER_DEG_LAT = 110540;    // good to ~0.1% anywhere
    const M_PER_DEG_LON = 111320;    // times cos(latitude)
    const SHARE_THROTTLE_MS = 5000;  // a position update at walking pace
    const SHARE_PRECISION = 5;       // metres: enough to find you, not to watch you

    class Geo {
        constructor(game) {
            this.game = game;
            this.anchor = null;        // { lat, lon, mpc } — mpc = metres per cell
            this.mine = null;          // my last fix: { lat, lon, acc }
            this.sharing = false;
            this.others = new Map();   // name -> { lat, lon, at }
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
            this.anchor = { lat: +(+lat).toFixed(6), lon: +(+lon).toFixed(6), mpc: mpc || 2 };
            this.game.voxels.setGeoAnchor(this.anchor);
            return this.anchor;
        }

        applyAnchor(anchor) {
            this.anchor = anchor || null;
            this.game.voxels.setGeoAnchor(this.anchor);
            this._renderMarkers();
        }

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
            if (msg.hide) this.others.delete(msg.name);
            else this.others.set(msg.name, { lat: msg.lat, lon: msg.lon, acc: msg.acc, at: Date.now() });
            this._renderMarkers();
        }

        forget(name) {
            this.others.delete(name);
            this._renderMarkers();
        }

        /** Where a player is, in world cells — null if they are off the grid. */
        worldPosOf(name) {
            const rec = name === this.game.username ? this.mine : this.others.get(name);
            if (!rec || !this.anchor) return null;
            const p = this.toWorld(rec.lat, rec.lon);
            const half = this.game.voxels.half;
            if (Math.abs(p.x) > half || Math.abs(p.z) > half) return { ...p, outside: true };
            return p;
        }

        _renderMarkers() {
            const v = this.game.voxels;
            if (!this.anchor) { v.clearGeoMarkers(); return; }
            const seen = new Set();
            const put = (name) => {
                const p = this.worldPosOf(name);
                if (!p || p.outside) return;
                seen.add(name);
                v.setGeoMarker(name, p.x, p.z, this.game.generateUserColor(name), name === this.game.username);
            };
            if (this.mine && this.sharing) put(this.game.username);
            this.others.forEach((_rec, name) => put(name));
            v.pruneGeoMarkers(seen);
        }

        /** Fly the camera to where somebody actually is. */
        goTo(name) {
            const p = this.worldPosOf(name);
            if (!p) return null;
            if (p.outside) return { outside: true };
            this.game.voxels.focus(Math.round(p.x), 2, Math.round(p.z), 34, Math.PI * 0.3);
            return p;
        }

        /** A readable rendering of a place, for the UI. */
        static format(lat, lon) {
            const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
            return `${Math.abs(lat).toFixed(5)}°${ns}, ${Math.abs(lon).toFixed(5)}°${ew}`;
        }
    }

    window.BlockPartyGeo = Geo;
})();
