/**
 * The doodle bot: line drawings it can draw on the board, and whether a guess
 * names one.
 *
 * Pure: no DOM and no board. Each doodle is a list of pen paths in a unit box
 * (0..1 both ways, y down); strokesFor() scales them into canvas segments, the
 * same {x1, y1, x2, y2} shape a pen stroke has, and the page (doodle-game.js)
 * draws them one at a time so the room watches it appear. Tested without a
 * browser (src/test/js/doodle-bot.test.js).
 */
(function (root) {
    'use strict';

    /** A closed ring of n points, for heads, suns, wheels and petals. */
    function circle(cx, cy, r, n) {
        const pts = [];
        const steps = n || 20;
        for (let i = 0; i <= steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return pts;
    }

    /** Part of a ring, from angle a0 to a1 in degrees (0 = right, 90 = down). */
    function arc(cx, cy, r, a0, a1, n) {
        const pts = [];
        const steps = n || 12;
        for (let i = 0; i <= steps; i++) {
            const a = (a0 + (a1 - a0) * (i / steps)) * Math.PI / 180;
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return pts;
    }

    /** Short straight rays around a centre: a sun's, a flower's stalks of light. */
    function rays(cx, cy, r0, r1, count) {
        const out = [];
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            out.push([[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]]);
        }
        return out;
    }

    const DOODLES = [
        { name: 'house', answers: ['house', 'home', 'cottage', 'hut'], color: '#e03131', paths: [
            [[0.15, 0.45], [0.5, 0.1], [0.85, 0.45]],
            [[0.22, 0.4], [0.22, 0.92], [0.78, 0.92], [0.78, 0.4]],
            [[0.42, 0.92], [0.42, 0.66], [0.58, 0.66], [0.58, 0.92]],
            [[0.28, 0.5], [0.38, 0.5], [0.38, 0.6], [0.28, 0.6], [0.28, 0.5]],
            [[0.62, 0.5], [0.72, 0.5], [0.72, 0.6], [0.62, 0.6], [0.62, 0.5]]
        ] },
        { name: 'sun', answers: ['sun', 'sunshine', 'sunny'], color: '#f08c00', paths: [
            circle(0.5, 0.5, 0.2, 24)
        ].concat(rays(0.5, 0.5, 0.27, 0.42, 10)) },
        { name: 'cat', answers: ['cat', 'kitten', 'kitty', 'kitteh'], color: '#495057', paths: [
            circle(0.5, 0.55, 0.28, 24),
            [[0.3, 0.37], [0.28, 0.12], [0.45, 0.28]],
            [[0.55, 0.28], [0.72, 0.12], [0.7, 0.37]],
            circle(0.4, 0.5, 0.035, 8), circle(0.6, 0.5, 0.035, 8),
            [[0.47, 0.62], [0.5, 0.65], [0.53, 0.62]],
            [[0.34, 0.62], [0.12, 0.58]], [[0.34, 0.66], [0.12, 0.7]],
            [[0.66, 0.62], [0.88, 0.58]], [[0.66, 0.66], [0.88, 0.7]]
        ] },
        { name: 'fish', answers: ['fish', 'goldfish', 'fishy'], color: '#1c7ed6', paths: [
            [[0.12, 0.5], [0.3, 0.3], [0.55, 0.25], [0.72, 0.38], [0.78, 0.5], [0.72, 0.62], [0.55, 0.75], [0.3, 0.7], [0.12, 0.5]],
            [[0.75, 0.5], [0.92, 0.32], [0.92, 0.68], [0.75, 0.5]],
            circle(0.28, 0.45, 0.03, 8),
            [[0.42, 0.33], [0.46, 0.5], [0.42, 0.67]]
        ] },
        { name: 'tree', answers: ['tree', 'oak', 'forest'], color: '#2f9e44', paths: [
            [[0.44, 0.92], [0.44, 0.6], [0.56, 0.6], [0.56, 0.92]],
            [[0.44, 0.62], [0.25, 0.55], [0.2, 0.38], [0.32, 0.22], [0.5, 0.12], [0.68, 0.22], [0.8, 0.38], [0.75, 0.55], [0.56, 0.62]],
            [[0.1, 0.92], [0.9, 0.92]]
        ] },
        { name: 'star', answers: ['star', 'stars'], color: '#fab005', paths: [
            [[0.5, 0.08], [0.62, 0.38], [0.94, 0.4], [0.69, 0.6], [0.78, 0.92], [0.5, 0.74], [0.22, 0.92], [0.31, 0.6], [0.06, 0.4], [0.38, 0.38], [0.5, 0.08]]
        ] },
        { name: 'heart', answers: ['heart', 'love'], color: '#e64980', paths: [
            [[0.5, 0.88], [0.15, 0.52], [0.12, 0.32], [0.22, 0.18], [0.38, 0.16], [0.5, 0.3], [0.62, 0.16], [0.78, 0.18], [0.88, 0.32], [0.85, 0.52], [0.5, 0.88]]
        ] },
        { name: 'flower', answers: ['flower', 'daisy', 'blossom', 'sunflower'], color: '#ae3ec9', paths: [
            circle(0.5, 0.35, 0.08, 12),
            circle(0.5, 0.15, 0.1, 12), circle(0.69, 0.3, 0.1, 12), circle(0.62, 0.52, 0.1, 12),
            circle(0.38, 0.52, 0.1, 12), circle(0.31, 0.3, 0.1, 12),
            [[0.5, 0.62], [0.5, 0.95]],
            [[0.5, 0.8], [0.65, 0.7], [0.72, 0.74], [0.5, 0.8]]
        ] },
        { name: 'rocket', answers: ['rocket', 'spaceship', 'rocketship', 'spacecraft'], color: '#5f3dc4', paths: [
            [[0.5, 0.05], [0.65, 0.25], [0.65, 0.72], [0.35, 0.72], [0.35, 0.25], [0.5, 0.05]],
            circle(0.5, 0.36, 0.07, 12),
            [[0.35, 0.55], [0.2, 0.75], [0.35, 0.72]],
            [[0.65, 0.55], [0.8, 0.75], [0.65, 0.72]],
            [[0.42, 0.72], [0.38, 0.88], [0.46, 0.8], [0.5, 0.95], [0.54, 0.8], [0.62, 0.88], [0.58, 0.72]]
        ] },
        { name: 'umbrella', answers: ['umbrella', 'parasol', 'brolly'], color: '#0c8599', paths: [
            arc(0.5, 0.48, 0.38, 180, 360, 18),
            [[0.12, 0.48], [0.25, 0.42], [0.37, 0.48], [0.5, 0.42], [0.63, 0.48], [0.75, 0.42], [0.88, 0.48]],
            [[0.5, 0.45], [0.5, 0.85], [0.47, 0.9], [0.42, 0.88]]
        ] },
        { name: 'snowman', answers: ['snowman', 'snow man', 'frosty'], color: '#1971c2', paths: [
            circle(0.5, 0.72, 0.2, 22), circle(0.5, 0.36, 0.14, 18),
            circle(0.45, 0.33, 0.02, 6), circle(0.55, 0.33, 0.02, 6),
            [[0.5, 0.38], [0.62, 0.41], [0.5, 0.41]],
            [[0.36, 0.22], [0.64, 0.22]], [[0.4, 0.22], [0.42, 0.06], [0.58, 0.06], [0.6, 0.22]],
            [[0.32, 0.6], [0.12, 0.48]], [[0.68, 0.6], [0.88, 0.48]]
        ] },
        { name: 'smiley face', answers: ['smiley', 'smile', 'face', 'happy', 'emoji', 'smiley face'], color: '#f59f00', paths: [
            circle(0.5, 0.5, 0.4, 28),
            circle(0.36, 0.4, 0.04, 8), circle(0.64, 0.4, 0.04, 8),
            arc(0.5, 0.5, 0.24, 20, 160, 12)
        ] }
    ];

    /**
     * A doodle's paths as board segments, scaled into a square box
     * {x, y, size} in canvas coordinates. One array of segments per pen path.
     */
    function strokesFor(doodle, box) {
        const at = (p) => [box.x + p[0] * box.size, box.y + p[1] * box.size];
        return doodle.paths.map((path) => {
            const segs = [];
            for (let i = 1; i < path.length; i++) {
                const a = at(path[i - 1]), b = at(path[i]);
                segs.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
            }
            return segs;
        });
    }

    /** Lower case, letters and spaces only, single spaces. */
    function normalise(text) {
        return String(text || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /**
     * Does this guess name the doodle? A whole-word match for any accepted
     * answer, singular or plural, inside whatever else the guess says
     * ("is it a cat??" counts; "catalogue" does not).
     */
    function matches(doodle, text) {
        const said = ' ' + normalise(text) + ' ';
        return doodle.answers.some((ans) => {
            const a = normalise(ans);
            return said.includes(' ' + a + ' ') || said.includes(' ' + a + 's ') || said.includes(' ' + a + 'es ');
        });
    }

    /** A random doodle, not the one just drawn. `random` is injectable for tests. */
    function pick(random, notName) {
        const r = random || Math.random;
        const pool = DOODLES.filter((d) => d.name !== notName);
        return pool[Math.floor(r() * pool.length) % pool.length];
    }

    /** "a cat", "an umbrella": how the reveal names it. */
    function called(doodle) {
        return (/^[aeiou]/.test(doodle.name) ? 'an ' : 'a ') + doodle.name;
    }

    const DoodleBot = { DOODLES, strokesFor, matches, pick, called, normalise, NAME: 'Doodle bot' };
    if (typeof module !== 'undefined' && module.exports) module.exports = DoodleBot;
    else root.DoodleBot = DoodleBot;
})(typeof window !== 'undefined' ? window : this);
