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
    /**
     * The coastlines on a canvas, as a path.
     *
     * A region is a Web Mercator tile, so a point's place in the region is just
     * its place in the tile. `size` is how many pixels that whole tile covers
     * and `view` is the canvas it is being drawn on — which is the same square
     * for the ground, and a much larger area for a map pulled out past the
     * world's own edges. Everything is measured against the canvas rather than
     * against the region, so a map showing ten thousand kilometres draws the
     * ten thousand kilometres rather than the region's own coast shrunk to a
     * dot.
     *
     * Coastlines carry far more detail than any one view can show, and a
     * continent whose shore runs off the edge carries most of it out of sight
     * entirely. Both are dropped as the path is built: inside the view, points
     * closer together than a third of a pixel; outside it, points are pulled
     * into a box a few views wide and snapped to a coarse grid, so a coastline
     * a continent away collapses to a handful of points while a ring that
     * encloses the view still encloses it — which is all the fill needs.
     */
    function ringPath(earth, region, size, view) {
        const { z, x, y } = region;
        view = view || {};
        const W = view.w || size, H = view.h || size;
        const ox = view.ox || 0, oy = view.oy || 0;

        const px = (lon) => ox + (M().lonToTileX(lon, z) - x) * size;
        const py = (lat) => oy + (M().latToTileY(lat, z) - y) * size;
        // What the canvas covers, in tiles and then in degrees — the cull box
        // is the view's, not the region's, or a map pulled out would show one
        // tile's worth of coast floating in an empty sea.
        const tx0 = x + (0 - ox) / size, tx1 = x + (W - ox) / size;
        const ty0 = y + (0 - oy) / size, ty1 = y + (H - oy) / size;
        const west = M().tileXToLon(tx0, z), east = M().tileXToLon(tx1, z);
        const north = M().tileYToLat(ty0, z), south = M().tileYToLat(ty1, z);
        const mLon = Math.abs(east - west) * 0.02, mLat = Math.abs(north - south) * 0.02;

        const small = Math.min(W, H);
        const pad = small * 0.05, GRID = small / 20, MIN = small / 480;
        const FARX = W * 4, FARY = H * 4;
        const clampX = (v) => v < -FARX ? -FARX : v > W + FARX ? W + FARX : v;
        const clampY = (v) => v < -FARY ? -FARY : v > H + FARY ? H + FARY : v;

        const path = new Path2D();
        let rings = 0, points = 0;
        for (let r = 0; r < earth.rings.length; r++) {
            const b = earth.box[r];
            if (b[2] < west - mLon || b[0] > east + mLon) continue;
            if (b[3] < south - mLat || b[1] > north + mLat) continue;

            const ring = earth.rings[r];
            let started = false, lx = 0, ly = 0;
            for (let i = 0; i < ring.length; i += 2) {
                let X = px(ring[i]), Y = py(ring[i + 1]);
                const inside = X > -pad && X < W + pad && Y > -pad && Y < H + pad;
                if (!inside) {
                    X = Math.round(clampX(X) / GRID) * GRID;
                    Y = Math.round(clampY(Y) / GRID) * GRID;
                }
                if (started && Math.abs(X - lx) < MIN && Math.abs(Y - ly) < MIN) continue;
                if (started) path.lineTo(X, Y); else path.moveTo(X, Y);
                started = true; lx = X; ly = Y; points++;
            }
            if (!started) continue;
            path.closePath();
            rings++;
        }
        path.rings = rings;
        path.points = points;
        return path;
    }

    /** Which cells of a region are land. */
    function landMask(earth, region, cells) {
        const canvas = document.createElement('canvas');
        canvas.width = cells; canvas.height = cells;
        // Read back rather than displayed: without this the canvas is kept on
        // the GPU and every getImageData stalls waiting for it.
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cells, cells);

        const path = ringPath(earth, region, cells);
        // Even-odd, so a lake inside a landmass is water rather than more land.
        ctx.fillStyle = '#fff';
        ctx.fill(path, 'evenodd');
        // A hairline along every coast as well, so an island smaller than one
        // cell still shows up rather than being lost to rounding.
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.8;
        ctx.stroke(path);

        const data = ctx.getImageData(0, 0, cells, cells).data;
        const mask = new Uint8Array(cells * cells);
        for (let i = 0, p = 0; i < mask.length; i++, p += 4) mask[i] = data[p] > 127 ? 1 : 0;
        return { mask, rings: path.rings, points: path.points };
    }

    // The skeleton: bare ground, water, and the line between them. Grey and
    // slate rather than green and blue — this is a map to build on, not scenery.
    const PAINT = { land: '#9aa3af', sea: '#46546b', coast: '#dfe6f2', grid: 'rgba(15,22,38,0.16)' };

    /**
     * The place, painted rather than built: land, water and coast on one
     * canvas, to be laid over the ground the way a map is laid on a table.
     *
     * Drawn at four times the world's own resolution, so the shoreline stays a
     * line rather than a staircase when you stand next to it. `cells` grid
     * lines are ruled over it, so the ground still reads as ground you can
     * place a block on.
     */
    function groundCanvas(earth, region, cells, opts) {
        opts = opts || {};
        const px = opts.px || Math.min(2048, cells * 4);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = px;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = PAINT.sea;
        ctx.fillRect(0, 0, px, px);

        const path = ringPath(earth, region, px);
        ctx.fillStyle = PAINT.land;
        ctx.fill(path, 'evenodd');
        ctx.strokeStyle = PAINT.coast;
        ctx.lineWidth = Math.max(1, px / 400);
        ctx.stroke(path);

        // One line per cell, so a block lands somewhere you can see.
        const step = px / cells;
        ctx.strokeStyle = PAINT.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= cells; i++) {
            const at = Math.round(i * step) + 0.5;
            ctx.moveTo(at, 0); ctx.lineTo(at, px);
            ctx.moveTo(0, at); ctx.lineTo(px, at);
        }
        ctx.stroke();
        return canvas;
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
        const { mask, rings, points } = landMask(earth, geo.region, cells);

        // Count first: a window with no coastline in it has no shape to draw.
        let land = 0;
        for (let i = 0; i < mask.length; i++) if (mask[i]) land++;
        const sea = cells * cells - land;

        // This style is called "the real coastline", and a window that is all
        // land — which is most places anybody pins to, since a coastline has
        // to be within a couple of hundred metres to fall inside the world —
        // has no coastline in it. Filling all 25,921 cells with land anyway
        // laid a featureless green plate over the map the player had just
        // imported, one block thick, hiding the streets underneath it. All sea
        // is the same story in blue. Nothing to draw means nothing drawn; the
        // painted ground already shows this place perfectly well.
        if (land === 0 || sea === 0) {
            return {
                blocks: [], pieces: [], land, sea, rings, points, style: 'earth',
                featureless: land === 0 ? 'sea' : 'land'
            };
        }

        const blocks = [];
        for (let iz = 0; iz < cells; iz++) {
            for (let ix = 0; ix < cells; ix++) {
                const isLand = mask[iz * cells + ix];
                const wx = ix - half, wz = iz - half;
                if (isLand) blocks.push([wx, 0, wz, LAND]);
                else blocks.push([wx, 0, wz, SEA, null, SEA_SHAPE]);
            }
        }
        return { blocks, pieces: [], land, sea, rings, points, style: 'earth' };
    }

    window.BlockPartyEarth = { load, shapeFor, landMask, groundCanvas, ringPath, decode, PAINT, ASSET };
})();
