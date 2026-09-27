/**
 * BoardReplay: saved whiteboard versions as a timeline (apps/whiteboard/board-replay.js).
 *
 * Shared by the whiteboard's history panel and the Rewind viewer. What would
 * quietly go wrong: versions played in arrival order instead of time order, a
 * version written under another password crashing the timeline instead of
 * being skipped, and a player that can seek past either end.
 */
const assert = require('assert');
const path = require('path');

global.window = global;
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
require(path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'apps', 'whiteboard', 'board-replay.js'));
const R = global.BoardReplay;

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

/** A canvas that records what was drawn. */
function fakeCanvas() {
    const ops = [];
    const ctx = new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : (...args) => ops.push([k].concat(args))),
        set: (t, k, v) => { t[k] = v; ops.push(['set ' + k, v]); return true; },
    });
    return { width: 640, height: 360, ops, getContext: () => ctx };
}

function packed(points) {
    return Buffer.from(new Float32Array(points).buffer).toString('base64');
}

const rows = [
    { id: 12, content: JSON.stringify({ savedAt: 3000, paths: [{ p: packed([0, 0, 960, 540]), c: '#ff0000', s: 4 }] }), metadata: { by: 'Bo' } },
    { id: 10, content: { savedAt: 1000, paths: [] } },
    { id: 11, unreadable: true, content: 'ciphertext' },
    { id: 13, content: 'not json' },
    { id: 14, content: { savedAt: 2000, objects: [{ type: 'text', text: 'hi', x1: 10, y1: 20 }] } },
];

console.log('board replay');

check('versions become frames oldest first, whatever order they arrive in', () => {
    const frames = R.framesOf(rows);
    assert.deepStrictEqual(frames.map((f) => f.id), [10, 14, 12]);
    assert.strictEqual(frames[2].by, 'Bo');
});

check('a version under another password or not JSON is skipped, not fatal', () => {
    assert.strictEqual(R.frameOf(rows[2]), null);
    assert.strictEqual(R.frameOf(rows[3]), null);
});

check('a stroke is drawn scaled to the canvas, in its colour', () => {
    const c = fakeCanvas();
    R.draw(c, R.frameOf(rows[0]));
    assert.ok(c.ops.some((o) => o[0] === 'set strokeStyle' && o[1] === '#ff0000'));
    const line = c.ops.find((o) => o[0] === 'lineTo');
    assert.deepStrictEqual(line.slice(1), [320, 180]);   // 960,540 on 1920x1080 -> the middle of 640x360
});

check('the player opens on the latest and cannot seek past either end', () => {
    const c = fakeCanvas(), seen = [];
    const p = R.player({ canvas: c, onSeek: (f) => seen.push(f && f.id) });
    p.load(R.framesOf(rows));
    assert.strictEqual(p.at, 2);
    p.seek(99); assert.strictEqual(p.at, 2);
    p.seek(-5); assert.strictEqual(p.at, 0);
    assert.deepStrictEqual(seen, [12, 12, 10]);
});

check('with nothing to play, the player draws a blank board and does not throw', () => {
    const c = fakeCanvas();
    const p = R.player({ canvas: c });
    p.load([]);
    p.play();
    assert.strictEqual(p.playing, false);
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
