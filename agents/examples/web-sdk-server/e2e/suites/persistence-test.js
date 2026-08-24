/**
 * A board comes back as what it is made of, not as a picture of it.
 *
 * It used to be stored as one full-canvas JPEG, so anybody who joined later or
 * reloaded got pixels: text and sticky notes stopped being objects, and nothing
 * that happened before they arrived could be undone by the person who drew it.
 *
 * The fixture deliberately contains an eraser stroke. Replaying ink over a base
 * image is where this design can drift — an erase has to composite in the same
 * order it originally did — so the restored board is compared against the
 * original as pixels as well as as objects.
 */
const { BASE, SHOTS, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { check, report } = results();
const ROOM = 'persist' + Math.floor(Math.random() * 99999);

async function join(b, name) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message.split('\n')[0].slice(0, 100)));
    p.errs = errs; p.ctx = ctx;
    await p.goto(BASE + '/apps/whiteboard/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 25000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForTimeout(14000);
    return p;
}

/** A coarse ink map, so two boards can be compared without pixel noise. */
const INKMAP = () => {
    const cv = document.getElementById('whiteboard');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const CELL = 16, cols = Math.ceil(cv.width / CELL);
    const map = {};
    for (let y = 0; y < cv.height; y += 2) {
        for (let x = 0; x < cv.width; x += 2) {
            const i = (y * cv.width + x) * 4;
            if (d[i] < 200 && d[i + 3] > 20) map[Math.floor(y / CELL) * cols + Math.floor(x / CELL)] = 1;
        }
    }
    return Object.keys(map);
};

(async () => {
    const b = await chromium.launch(LAUNCH);
    const a = await join(b, 'Author');
    await a.bringToFront(); await a.waitForTimeout(2500);

    // --- build a board with every kind of content -------------------------
    await a.evaluate(() => {
        // freehand ink
        currentTool = 'draw';
        beginAction();
        let px = 200, py = 200;
        for (let i = 0; i < 120; i++) {
            const nx = px + 8, ny = py + Math.sin(i / 6) * 14;
            addStrokeToBoardState({ x1: px, y1: py, x2: nx, y2: ny, color: '#1d4ed8', size: 4, erase: false });
            px = nx; py = ny;
        }
        endAction();
        // an eraser stroke through it: the case that can drift on replay
        beginAction();
        for (let i = 0; i < 30; i++) {
            addStrokeToBoardState({ x1: 500 + i * 6, y1: 150, x2: 506 + i * 6, y2: 280,
                color: '#000', size: 18, erase: true });
        }
        endAction();
        redrawCanvas();
    });
    await a.waitForTimeout(800);
    await a.evaluate(() => {
        currentTool = 'rect';
        WhiteboardTools.begin({ x: 900, y: 200 }); WhiteboardTools.move({ x: 1200, y: 420 }); WhiteboardTools.end();
    });
    await a.waitForTimeout(1200);
    await a.evaluate(() => {
        for (let i = 0; i < 6; i++) {
            addStrokeToBoardState({
                type: i % 2 ? 'note' : 'text',
                x1: 200 + i * 220, y1: 600, x2: 200 + i * 220 + 200, y2: 740,
                text: 'kept as an object ' + i, color: '#b45309', size: 22, erase: false
            });
        }
        redrawCanvas();
    });
    await a.waitForTimeout(1500);

    const made = await a.evaluate(() => ({
        total: boardState.length,
        text: boardState.filter(s => s.type === 'text' || s.type === 'note').length,
        erase: boardState.filter(s => s.erase).length,
        owned: boardState.filter(s => s.op).length
    }));
    check(made.text === 6 && made.erase === 30, `the board has ink, an eraser and notes (${JSON.stringify(made)})`);
    const before = await a.evaluate(INKMAP);
    await a.screenshot({ path: SHOTS + '/persistence-author.png' });

    // let the host persist it
    await a.waitForTimeout(9000);

    // --- somebody else opens the room -------------------------------------
    const c = await join(b, 'Returner');
    await c.bringToFront(); await c.waitForTimeout(12000);

    const got = await c.evaluate(() => ({
        total: boardState.length,
        text: boardState.filter(s => s.type === 'text' || s.type === 'note').length,
        withText: boardState.filter(s => s.type && s.text).length,
        erase: boardState.filter(s => s.erase).length,
        owned: boardState.filter(s => s.op).length,
        authors: [...new Set(boardState.map(s => s.by).filter(Boolean))]
    }));
    check(got.total > 0, `the board comes back as objects, not just pixels (${got.total} entries)`);
    check(got.text === 6 && got.withText === 6,
        `text and sticky notes come back as text and sticky notes (${got.text} with their words)`);
    check(got.erase === 30, `eraser strokes survive as eraser strokes (${got.erase})`);
    check(got.owned > 0 && got.authors.length > 0,
        `restored ink still knows who drew it, so they can still undo it (${JSON.stringify(got.authors)})`);

    // --- and it looks the same --------------------------------------------
    const after = await c.evaluate(INKMAP);
    const setA = new Set(before), setB = new Set(after);
    let shared = 0; setA.forEach(k => { if (setB.has(k)) shared++; });
    const missing = setA.size - shared;
    const drift = setA.size ? missing / setA.size : 1;
    check(drift < 0.1,
        `the restored board matches the original (${(drift * 100).toFixed(1)}% of the ink differs)`);
    await c.screenshot({ path: SHOTS + '/persistence-returner.png' });

    check([...new Set([...a.errs, ...c.errs])].length === 0,
        `nothing throws (${[...new Set([...a.errs, ...c.errs])].slice(0, 2).join(' | ') || 'clean'})`);

    const failed = report();
    await b.close();
    process.exit(failed ? 1 : 0);
})();
