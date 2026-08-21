/** Lightweight local landmark discovery for every BlockParty region. */
(function () {
    'use strict';
    const POIS = [
        { id: 'plaza', x: 0, z: 0, name: 'Central Plaza' },
        { id: 'north', x: -42, z: -34, name: 'North Lookout' },
        { id: 'east', x: 43, z: -22, name: 'East Crossing' },
        { id: 'south', x: 24, z: 42, name: 'South Garden' },
        { id: 'west', x: -40, z: 16, name: 'West Bridge' }
    ];
    class PoiController {
        constructor(game) {
            this.game = game;
            try { this.found = new Set(JSON.parse(localStorage.getItem('bp_pois') || '[]')); } catch (_) { this.found = new Set(); }
            POIS.forEach(p => game.voxels.setGeoMarker('__poi_' + p.id, p.x, p.z, this.found.has(p.id) ? '#34d399' : '#a78bfa', false, true));
        }
        update(pos) {
            POIS.forEach(p => {
                if (this.found.has(p.id) || Math.hypot(pos.x - p.x, pos.z - p.z) > 4) return;
                this.found.add(p.id);
                try { localStorage.setItem('bp_pois', JSON.stringify(Array.from(this.found))); } catch (_) {}
                this.game.voxels.setGeoMarker('__poi_' + p.id, p.x, p.z, '#34d399', false, true);
                this.game.showToast(`📍 Discovered: ${p.name} (${this.found.size}/${POIS.length})`, 'success', 2800);
            });
        }
    }
    window.BlockPartyPois = PoiController;
})();
