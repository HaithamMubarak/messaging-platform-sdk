/**
 * BlockParty — tracing the real world into blocks
 *
 * The room is already pinned to a region of the Earth and the minimap already
 * draws that region from map tiles. This reads those same tiles as *data*:
 * every pixel is classified — sea, river, park, road, building, bare ground —
 * and laid down as blocks, so the world becomes a voxel copy of the real place.
 *
 * Because a region is a Web Mercator tile and the world covers it exactly, the
 * mapping is direct: the tile's pixels are the world's cells. Zoom out to a
 * continent and you get coastlines; zoom into a street and you get the street.
 *
 * The classification is by colour against the standard OSM rendering, which is
 * a picture rather than a database — so this is a good likeness, not a survey.
 * Water and land separate cleanly; a cycle path and a footpath do not.
 */
(function () {
    'use strict';

    // Reference colours from the standard OpenStreetMap rendering, and what
    // each one becomes in the world.
    const LEGEND = [
        { name: 'water',    rgb: [170, 211, 223], colour: 4,  height: 0, shape: 1 },
        { name: 'water',    rgb: [181, 208, 208], colour: 4,  height: 0, shape: 1 },
        { name: 'grass',    rgb: [205, 235, 176], colour: 3,  height: 0, shape: 1 },
        { name: 'grass',    rgb: [173, 209, 158], colour: 3,  height: 0, shape: 1 },
        { name: 'forest',   rgb: [173, 209, 158], colour: 3,  height: 1, shape: 0 },
        { name: 'sand',     rgb: [245, 233, 198], colour: 2,  height: 0, shape: 1 },
        { name: 'building', rgb: [217, 208, 201], colour: 9,  height: 2, shape: 0 },
        { name: 'building', rgb: [196, 182, 171], colour: 9,  height: 2, shape: 0 },
        { name: 'road',     rgb: [255, 255, 255], colour: 8,  height: 0, shape: 1 },
        { name: 'road',     rgb: [249, 178, 156], colour: 1,  height: 0, shape: 1 },
        { name: 'road',     rgb: [252, 214, 164], colour: 1,  height: 0, shape: 1 },
        { name: 'rail',     rgb: [153, 153, 153], colour: 11, height: 0, shape: 1 },
        // The purple wash a country border is drawn in. It sits over whatever
        // is beneath it, so it reads as its own thing rather than as ground.
        { name: 'border',   rgb: [172, 132, 172], colour: 6,  height: 1, shape: 0 },
        { name: 'border',   rgb: [190, 155, 190], colour: 6,  height: 1, shape: 0 },
        { name: 'ground',   rgb: [242, 239, 233], colour: null, height: 0, shape: 0 }
    ];

    // Land or sea — all a coastline is, is where this changes.
    function isLand(kind) { return kind.name !== 'water'; }

    /** Nearest legend entry to a pixel, weighted the way the eye judges it. */
    function classify(r, g, b) {
        let best = LEGEND[LEGEND.length - 1], bestD = Infinity;
        for (const entry of LEGEND) {
            const dr = r - entry.rgb[0], dg = g - entry.rgb[1], db = b - entry.rgb[2];
            const d = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
            if (d < bestD) { bestD = d; best = entry; }
        }
        return best;
    }

    const TILE_TIMEOUT_MS = 12000;

    /**
     * Load one tile as an image the canvas may be read back from.
     *
     * Image requests do not have a browser-level timeout. A stalled tile used
     * to leave the whole ground promise pending forever, which made Streets
     * look broken even though the coastline fallback was ready. Settle every
     * request so the caller can finish with the tiles that did arrive.
     */
    function loadTile(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                img.onload = null;
                img.onerror = null;
                fn(value);
            };
            const timer = setTimeout(() => finish(reject, new Error('tile timed out')), TILE_TIMEOUT_MS);
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.referrerPolicy = 'origin';
            img.onload = () => finish(resolve, img);
            img.onerror = () => finish(reject, new Error('tile unavailable'));
            img.src = url;
        });
    }

    /**
     * Stitch a rectangular window of map tiles onto one canvas.
     *
     * The window is given in tile units at zoom `z` and may be fractional, so
     * a caller can ask for "the region tile" (exactly one) or "nine of them
     * across, centred here" (the ground beyond the build area) with the same
     * call. Tiles that fail to load leave their patch empty rather than
     * failing the whole stitch — a hole in the sea is better than no ground.
     */
    async function stitchWindow(z, x0, y0, w, h, px, load) {
        load = load || loadTile;
        const n = Math.pow(2, z);
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = Math.round(px * (h / w));
        const ctx = canvas.getContext('2d');
        const scale = px / w;                    // screen pixels per tile

        const tx0 = Math.floor(x0), tx1 = Math.ceil(x0 + w);
        const ty0 = Math.floor(y0), ty1 = Math.ceil(y0 + h);
        const jobs = [];
        for (let tx = tx0; tx < tx1; tx++) {
            for (let ty = ty0; ty < ty1; ty++) {
                // X wraps round the planet; Y does not — past the poles there
                // is no tile to ask for.
                if (ty < 0 || ty >= n) continue;
                const wx = ((tx % n) + n) % n;
                jobs.push({ tx, ty, wx });
            }
        }
        let got = 0;
        // In parallel: a nine-across window is a dozen tiles, and doing them
        // one after another is the difference between "on arrival" and "after
        // you have already started building".
        await Promise.all(jobs.map(async (j) => {
            const url = `https://tile.openstreetmap.org/${z}/${j.wx}/${j.ty}.png`;
            try {
                const img = await load(url, z, j.wx, j.ty);
                ctx.drawImage(img, (j.tx - x0) * scale, (j.ty - y0) * scale, scale, scale);
                got++;
            } catch (e) { /* a missing tile leaves bare ground */ }
        }));
        if (!got) throw new Error('No map tiles could be loaded here');
        return { canvas, tiles: got, zoom: z };
    }

    /** A canvas's context, for the one call that does not already hold one. */
    function ctx0(canvas) { return canvas.getContext('2d'); }

    /**
     * Settle a stitched map into the world it is going to be the floor of.
     *
     * Two things happen here. Anywhere no tile arrived gets bare paper rather
     * than transparency, so a hole reads as unmapped ground. And the whole
     * thing is *darkened* toward the world's own night-ish palette by
     * `strength` — the map is the floor, not the subject, and the blocks
     * standing on it have to stay the brightest thing in the scene.
     */
    function settle(ctx, canvas, strength) {
        const s = strength == null ? 0.7 : strength;
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#cdc9c1';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        if (s < 1) {
            ctx.fillStyle = `rgba(15,22,38,${(1 - s).toFixed(3)})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        return s;
    }

    /**
     * The region as a picture to lay on the floor: the real streets, parks and
     * buildings of this place, ruled with one line per cell so it still reads
     * as ground you can put a block on.
     *
     * This is the same tile data the trace turns into blocks — the difference
     * is that this stays a picture. Nobody has to clear a hundred thousand
     * cubes before they can build.
     */
    async function groundTiles(region, cells, opts) {
        opts = opts || {};
        const finer = opts.finer == null ? 1 : opts.finer;
        const z = Math.min(19, region.z + finer);
        const step = Math.pow(2, z - region.z);
        const px = Math.min(2048, Math.max(512, 256 * step));
        const { canvas, tiles } = await stitchWindow(
            z, region.x * step, region.y * step, step, step, px, opts.loader);

        const ctx = canvas.getContext('2d');
        const strength = settle(ctx, canvas, opts.strength);

        if (cells) {
            const stepPx = canvas.width / cells;
            // The cell grid has to stay visible against whatever the map turned
            // out to be: dark lines on a bright map, light ones once it has
            // been dimmed into the world.
            ctx.strokeStyle = strength >= 0.85 ? 'rgba(15,22,38,0.14)' : 'rgba(255,255,255,0.13)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i <= cells; i++) {
                const at = Math.round(i * stepPx) + 0.5;
                ctx.moveTo(at, 0); ctx.lineTo(at, canvas.height);
                ctx.moveTo(0, at); ctx.lineTo(canvas.width, at);
            }
            ctx.stroke();
        }
        return { canvas, tiles, zoom: z };
    }

    /**
     * The same place, but the ground *beyond* the build area — the plain that
     * runs `span` worlds out in every direction. Drawn from coarser tiles,
     * because it is only ever seen at a distance and through fog, and because
     * nine worlds of street-level tiles would be hundreds of requests.
     */
    async function surroundTiles(region, span, opts) {
        opts = opts || {};
        // Three zooms out is one tile per eight regions, so nine regions
        // across is a shade over one tile — four requests, not eighty-one.
        const back = opts.back == null ? 3 : opts.back;
        const z = Math.max(0, region.z - back);
        const k = Math.pow(2, region.z - z);          // regions per coarse tile
        const half = (span - 1) / 2;
        const x0 = (region.x - half) / k, y0 = (region.y - half) / k;
        const w = span / k;
        const { canvas, tiles } = await stitchWindow(z, x0, y0, w, w, 1024, opts.loader);

        settle(ctx0(canvas), canvas, opts.strength);
        return { canvas, tiles, zoom: z };
    }

    /**
     * Trace the room's current region into block rows.
     *
     * `loader` is injectable so this can be exercised without a network — the
     * tests hand it painted canvases instead of map tiles.
     */
    async function trace(game, opts) {
        opts = opts || {};
        const geo = game.geo;
        if (!geo || !geo.anchor || !geo.region) throw new Error('Pin the world to a place first');

        const region = geo.region;
        const cells = game.voxels.half * 2 + 1;
        const load = opts.loader || loadTile;

        // At a scale where one block is a kilometre, filling in every field and
        // rooftop would just be noise — what carries at that size is the shape
        // of the place: coastlines and borders. So past a threshold the trace
        // draws the outline and leaves the inside empty.
        const mpc = (geo.anchor && geo.anchor.mpc) || 2;
        const style = opts.style && opts.style !== 'auto' ? opts.style
            : (mpc >= 100 ? 'outline' : 'full');

        // One zoom finer than the region gives four tiles and twice the detail
        // to downsample from, which is what keeps a coastline from stepping —
        // and an outline, which is all coastline, is worth two.
        const finer = opts.detail === false ? 0 : (style === 'outline' ? 2 : 1);
        const z = Math.min(19, region.z + finer);
        const step = Math.pow(2, z - region.z);
        const x0 = region.x * step, y0 = region.y * step;

        const px = 256 * step;
        const canvas = document.createElement('canvas');
        canvas.width = px; canvas.height = px;
        const ctx = canvas.getContext('2d');

        let got = 0;
        for (let tx = 0; tx < step; tx++) {
            for (let ty = 0; ty < step; ty++) {
                const url = `https://tile.openstreetmap.org/${z}/${x0 + tx}/${y0 + ty}.png`;
                try {
                    const img = await load(url, z, x0 + tx, y0 + ty);
                    ctx.drawImage(img, tx * 256, ty * 256, 256, 256);
                    got++;
                } catch (e) { /* a missing tile leaves bare ground */ }
            }
        }
        if (!got) throw new Error('No map tiles could be loaded here');

        // Downsample the tiles onto the world grid: one cell per world column.
        const small = document.createElement('canvas');
        small.width = cells; small.height = cells;
        // Read back rather than displayed: without this the canvas is kept
        // on the GPU and every getImageData stalls waiting for it.
        const sctx = small.getContext('2d', { willReadFrequently: true });
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(canvas, 0, 0, cells, cells);

        let data;
        try {
            data = sctx.getImageData(0, 0, cells, cells).data;
        } catch (e) {
            // The canvas is tainted, which means the tiles came back without
            // permission to read them.
            throw new Error('These map tiles cannot be read (no CORS headers)');
        }

        const half = game.voxels.half;
        const blocks = [];
        const counts = {};

        // Read every cell once, so the second pass can look at neighbours.
        const grid = new Array(cells * cells);
        for (let i2 = 0, p = 0; i2 < grid.length; i2++, p += 4) {
            grid[i2] = data[p + 3] < 40 ? null : classify(data[p], data[p + 1], data[p + 2]);
        }

        const put = (ix, iz, colour, height, shape) => {
            const x = ix - half, z2 = iz - half;
            for (let y = 0; y <= height; y++) {
                const sh = y === height ? shape : 0;
                blocks.push(sh ? [x, y, z2, colour, null, sh] : [x, y, z2, colour]);
            }
        };

        for (let iz = 0; iz < cells; iz++) {
            for (let ix = 0; ix < cells; ix++) {
                const kind = grid[iz * cells + ix];
                if (!kind) continue;
                counts[kind.name] = (counts[kind.name] || 0) + 1;

                if (style === 'outline') {
                    // A border stands as itself; everything else is drawn only
                    // where the land meets the sea.
                    if (kind.name === 'border') { put(ix, iz, 6, 1, 0); continue; }
                    const land = isLand(kind);
                    let edge = false;
                    for (let d = 0; d < 4 && !edge; d++) {
                        const nx = ix + (d === 0 ? 1 : d === 1 ? -1 : 0);
                        const nz = iz + (d === 2 ? 1 : d === 3 ? -1 : 0);
                        // The rim of the tile counts as an edge only for land,
                        // so a world of open sea stays empty rather than boxed.
                        if (nx < 0 || nz < 0 || nx >= cells || nz >= cells) continue;
                        const n = grid[nz * cells + nx];
                        if (n && isLand(n) !== land) edge = true;
                    }
                    if (edge) put(ix, iz, land ? 8 : 4, land ? 1 : 0, land ? 0 : 1);
                    continue;
                }

                if (kind.colour === null) continue;               // bare ground stays bare
                put(ix, iz, kind.colour, kind.height, kind.shape);
            }
        }
        return { blocks, pieces: [], counts, zoom: z, tiles: got, style };
    }

    window.BlockPartyTerrain = { trace, classify, LEGEND, stitchWindow, groundTiles, surroundTiles };
})();
