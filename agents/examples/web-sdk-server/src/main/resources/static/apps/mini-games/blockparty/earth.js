/**
 * BlockParty — the shape of the Earth
 *
 * The world is the real world, but only its shape: ground and sea, and the
 * coastline between them. Nothing else — no roads, no rooftops, no parks. That
 * is the canvas people build their own world on top of.
 *
 * The shape comes from Natural Earth's 10m land polygons (public domain),
 * carried as vectors rather than as a picture, so a coastline is drawn at the
 * resolution of whatever region is open: the whole planet, or two hundred
 * metres of harbour wall. A raster big enough to do that would be gigabytes.
 *
 * Polygons are stored delta-encoded at 1e-4 degrees — about eleven metres,
 * finer than the survey they came from — which fits the world's coastlines in
 * a couple of megabytes, and one megabyte and a half over the wire.
 */
(function () {
    'use strict';

    const M = () => window.BlockPartyGeo.MERCATOR;
    const ASSET = 'earth-land.json';

    // Land and sea, as blocks: land stands a full block, the sea lies flat, so
    // the coast is a step you can see from across the world and build along.
    const LAND = 3, SEA = 4, SEA_SHAPE = 1;

    let loading = null;

    /**
     * Undo the delta encoding: signed values, five bits at a time, ASCII-safe.
     * The same scheme Google's polylines use, at our own precision.
     */
    function decode(str, factor) {
        const out = [];
        let i = 0, lon = 0, lat = 0;
        while (i < str.length) {
            for (let k = 0; k < 2; k++) {
                let shift = 0, result = 0, b;
                do {
                    b = str.charCodeAt(i++) - 63;
                    result |= (b & 0x1f) << shift;
                    shift += 5;
                } while (b >= 0x20);
                const d = (result & 1) ? ~(result >> 1) : (result >> 1);
                if (k === 0) lon += d; else lat += d;
            }
            out.push(lon / factor, lat / factor);
        }
        return Float64Array.from(out);
    }

    /** Fetch the coastlines once per page. */
    function load() {
        if (!loading) {
            loading = fetch(ASSET)
                .then(r => { if (!r.ok) throw new Error('The Earth data is missing'); return r.json(); })
                .then(raw => {
                    const factor = Math.pow(10, raw.p);
                    return { rings: raw.r.map(s => decode(s, factor)), box: raw.b, source: raw.source };
                })
                .catch(e => { loading = null; throw e; });
        }
        return loading;
    }

    /**
     * Which cells of the current region are land.
     *
     * A region *is* a Web Mercator tile and the world covers it exactly, so a
     * point's place in the world is just its place in the tile — no fitting,
     * no offsets. The coastlines are filled into a canvas the size of the world
     * in cells and read back, which is both crisp and fast enough to do on
     * every arrival.
     */
    function landMask(earth, region, cells) {
        const { z, x, y } = region;
        const west = M().tileXToLon(x, z), east = M().tileXToLon(x + 1, z);
        const north = M().tileYToLat(y, z), south = M().tileYToLat(y + 1, z);
        // A margin, so a coastline that only clips the corner still counts.
        const mLon = (east - west) * 0.02, mLat = (north - south) * 0.02;

        const canvas = document.createElement('canvas');
        canvas.width = cells; canvas.height = cells;
        // Read back rather than displayed: without this the canvas is kept
        // on the GPU and every getImageData stalls waiting for it.
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cells, cells);

        const px = (lon) => (M().lonToTileX(lon, z) - x) * cells;
        const py = (lat) => (M().latToTileY(lat, z) - y) * cells;

        // Coastlines carry far more detail than a 161-cell world can show, and
        // a continent whose shore runs off the edge carries most of it out of
        // sight entirely. Both are dropped as the path is built: inside the
        // view, points closer together than a third of a cell; outside it,
        // everything but a coarse trace of the shape — which is all that is
        // needed for the polygon to still enclose what it encloses.
        // Outside the view a point is pulled in to a box a few worlds wide
        // before being snapped to a coarse grid: a coastline a continent away
        // then collapses to a handful of points on that box, while a ring that
        // encloses the view still encloses it, which is all the fill needs.
        const pad = cells * 0.05, GRID = 8, MIN = 0.34;
        const FAR = cells * 4, lo = -FAR, hi = cells + FAR;
        const clamp = (v) => v < lo ? lo : v > hi ? hi : v;
        const t0 = (window.performance || Date).now();
        ctx.beginPath();
        let drawn = 0, points = 0;
        for (let r = 0; r < earth.rings.length; r++) {
            const b = earth.box[r];
            if (b[2] < west - mLon || b[0] > east + mLon) continue;
            if (b[3] < south - mLat || b[1] > north + mLat) continue;

            const ring = earth.rings[r];
            let started = false, lx = 0, ly = 0;
            for (let i = 0; i < ring.length; i += 2) {
                let X = px(ring[i]), Y = py(ring[i + 1]);
                const inside = X > -pad && X < cells + pad && Y > -pad && Y < cells + pad;
                if (!inside) {
                    X = Math.round(clamp(X) / GRID) * GRID;
                    Y = Math.round(clamp(Y) / GRID) * GRID;
                }
                if (started && Math.abs(X - lx) < MIN && Math.abs(Y - ly) < MIN) continue;
                if (started) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
                started = true; lx = X; ly = Y; points++;
            }
            if (!started) continue;
            ctx.closePath();
            drawn++;
        }
        // Even-odd, so a lake inside a landmass is water rather than more land.
        const t1 = (window.performance || Date).now();
        ctx.fillStyle = '#fff';
        ctx.fill('evenodd');
        // A hairline along every coast as well, so an island smaller than one
        // block still shows up rather than being lost to rounding.
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        const t2 = (window.performance || Date).now();
        const data = ctx.getImageData(0, 0, cells, cells).data;
        const mask = new Uint8Array(cells * cells);
        for (let i = 0, p = 0; i < mask.length; i++, p += 4) mask[i] = data[p] > 127 ? 1 : 0;
        const t3 = (window.performance || Date).now();
        return {
            mask, rings: drawn, points,
            timing: { path: Math.round(t1 - t0), raster: Math.round(t2 - t1), read: Math.round(t3 - t2) }
        };
    }

    /**
     * The current region as blocks: ground and sea, and nothing else.
     */
    async function shapeFor(game, opts) {
        opts = opts || {};
        const geo = game.geo;
        if (!geo || !geo.region) throw new Error('Pin the world to a place first');

        const earth = opts.data || await load();
        const cells = game.voxels.half * 2 + 1;
        const half = game.voxels.half;
        const { mask, rings, points, timing } = landMask(earth, geo.region, cells);

        const blocks = [];
        let land = 0;
        for (let iz = 0; iz < cells; iz++) {
            for (let ix = 0; ix < cells; ix++) {
                const isLand = mask[iz * cells + ix];
                const wx = ix - half, wz = iz - half;
                if (isLand) { blocks.push([wx, 0, wz, LAND]); land++; }
                else blocks.push([wx, 0, wz, SEA, null, SEA_SHAPE]);
            }
        }
        return { blocks, pieces: [], land, sea: cells * cells - land, rings, points, timing, style: 'earth' };
    }

    window.BlockPartyEarth = { load, shapeFor, landMask, decode, ASSET };
})();
