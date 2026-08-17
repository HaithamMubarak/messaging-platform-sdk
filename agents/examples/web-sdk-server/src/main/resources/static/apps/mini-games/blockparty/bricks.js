/**
 * BlockParty — LEGO-style brick pieces
 *
 * A brick is one piece that covers several cells: a 2x4 occupies eight cells of
 * the voxel grid but places, moves and breaks as a single thing. That is the
 * whole difference from a stack of cubes, and everything here exists to serve
 * it — a catalogue of footprints, and geometry that carries studs.
 *
 * Geometry is one merged buffer per footprint (body + studs), cached, so a
 * brick costs one draw call rather than one per stud. three r128 does not ship
 * BufferGeometryUtils in the core build, hence the small merge below.
 *
 * Footprints are stored as w×d in cells and are never rotated in geometry —
 * rotating a piece swaps w and d, which keeps every brick axis-aligned and
 * keeps cell maths integral.
 */
(function () {
    'use strict';

    // Studs: a real brick's stud is about 1/3 of its width and rises a little
    // proud of the top face.
    const STUD_R = 0.29;
    const STUD_H = 0.17;
    const STUD_SEGS = 12;

    // Order matters only for the palette; footprints are what get stored.
    const BRICKS = [
        { id: '1x1', w: 1, d: 1, name: '1 × 1' },
        { id: '1x2', w: 1, d: 2, name: '1 × 2' },
        { id: '1x3', w: 1, d: 3, name: '1 × 3' },
        { id: '1x4', w: 1, d: 4, name: '1 × 4' },
        { id: '2x2', w: 2, d: 2, name: '2 × 2' },
        { id: '2x3', w: 2, d: 3, name: '2 × 3' },
        { id: '2x4', w: 2, d: 4, name: '2 × 4' },
        { id: '2x6', w: 2, d: 6, name: '2 × 6' }
    ];

    const cache = new Map();

    /**
     * Merge geometries into one, keeping position and normal only — the
     * materials here are flat-coloured, so there is nothing for UVs to do.
     */
    function mergeGeometries(list) {
        const geos = list.map(g => (g.index ? g.toNonIndexed() : g));
        let total = 0;
        geos.forEach(g => { total += g.attributes.position.count; });

        const position = new Float32Array(total * 3);
        const normal = new Float32Array(total * 3);
        let offset = 0;
        geos.forEach(g => {
            position.set(g.attributes.position.array, offset * 3);
            normal.set(g.attributes.normal.array, offset * 3);
            offset += g.attributes.position.count;
        });

        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(position, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
        out.computeBoundingSphere();
        geos.forEach(g => g.dispose());
        return out;
    }

    /**
     * Geometry for a w×d brick, its origin at the piece's minimum corner so a
     * mesh can sit at (x0, y, z0) with no offset maths at the call site.
     */
    function geometry(w, d) {
        const key = w + 'x' + d;
        if (cache.has(key)) return cache.get(key);

        const parts = [];
        const body = new THREE.BoxGeometry(w, 1, d);
        body.translate(w / 2, 0.5, d / 2);
        parts.push(body);

        for (let i = 0; i < w; i++) {
            for (let j = 0; j < d; j++) {
                const stud = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, STUD_SEGS);
                stud.translate(i + 0.5, 1 + STUD_H / 2, j + 0.5);
                parts.push(stud);
            }
        }

        const geo = mergeGeometries(parts);
        cache.set(key, geo);
        return geo;
    }

    function byId(id) { return BRICKS.find(b => b.id === id) || BRICKS[0]; }

    // A rotated piece is the same brick with its footprint transposed.
    function footprint(brick, rotated) {
        return rotated ? { w: brick.d, d: brick.w } : { w: brick.w, d: brick.d };
    }

    // Every cell a piece at (x, y, z) with footprint w×d covers.
    function cellsOf(x, y, z, w, d) {
        const out = [];
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < d; j++) out.push([x + i, y, z + j]);
        }
        return out;
    }

    // Piece ids only need to be unique across a room; the player's name plus a
    // monotonic counter does that without any coordination.
    let counter = 0;
    function newId(username) {
        counter += 1;
        return `${username || 'p'}#${Date.now().toString(36)}${counter.toString(36)}`;
    }

    window.BlockPartyBricks = { BRICKS, geometry, byId, footprint, cellsOf, newId, STUD_H };
})();
