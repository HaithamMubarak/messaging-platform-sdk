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

    /** Load one tile as an image the canvas may be read back from. */
    function loadTile(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('tile unavailable'));
            img.src = url;
        });
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
        const sctx = small.getContext('2d');
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

    window.BlockPartyTerrain = { trace, classify, LEGEND };
})();
