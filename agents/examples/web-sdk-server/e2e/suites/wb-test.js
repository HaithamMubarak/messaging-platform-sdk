/**
 * Whiteboard end-to-end: two clients, the new tools, undo, and the sync.
 * Run: xvfb-run -a --server-args="-screen 0 1440x900x24" node wb-test.js
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const ROOM = 'wb' + Math.floor(Math.random() * 100000);
const URL = BASE + '/apps/whiteboard/app.html?debug';

const pass = [], fail = [];
const check = (ok, what) => (ok ? pass : fail).push(what);

async function join(ctx, name) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
    p.errs = errs;
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 20000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForTimeout(7000);
    return p;
}

const strokes = (p) => p.evaluate(() => (typeof boardState !== 'undefined' ? boardState.length : -1));

(async () => {
    const b = await chromium.launch({ headless: false, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await join(ctx, 'Alice');
    const c = await join(ctx, 'Bob');
    await a.bringToFront();
    await a.waitForTimeout(2000);

    const box = await a.evaluate(() => {
        const r = document.getElementById('whiteboard').getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const at = (fx, fy) => ({ x: box.x + box.w * fx, y: box.y + box.h * fy });

    const drag = async (p, tool, from, to, opts) => {
        await p.evaluate((t) => setTool(t), tool);
        const f = at(from[0], from[1]), t = at(to[0], to[1]);
        await p.mouse.move(f.x, f.y);
        await p.mouse.down();
        for (let i = 1; i <= 8; i++) {
            await p.mouse.move(f.x + (t.x - f.x) * i / 8, f.y + (t.y - f.y) * i / 8);
            await p.waitForTimeout(15);
        }
        await p.mouse.up();
        await p.waitForTimeout(300);
    };

    // --- freehand ------------------------------------------------------------
    let before = await strokes(a);
    await drag(a, 'draw', [0.30, 0.30], [0.45, 0.42]);
    check((await strokes(a)) > before, 'pen draws');

    // --- shapes --------------------------------------------------------------
    for (const [tool, from, to] of [
        ['rect',    [0.20, 0.55], [0.36, 0.72]],
        ['ellipse', [0.42, 0.55], [0.56, 0.70]],
        ['arrow',   [0.60, 0.30], [0.75, 0.45]],
        ['line',    [0.60, 0.62], [0.78, 0.62]],
        ['diamond', [0.80, 0.55], [0.92, 0.70]]
    ]) {
        before = await strokes(a);
        await drag(a, tool, from, to);
        const after = await strokes(a);
        check(after > before, `${tool} commits (${after - before} segments)`);
    }

    // --- text ----------------------------------------------------------------
    before = await strokes(a);
    await a.evaluate(() => setTool('text'));
    const tp = at(0.24, 0.20);
    await a.mouse.click(tp.x, tp.y);
    await a.waitForTimeout(400);
    check(!!(await a.$('.wb-typing')), 'text tool opens a box where you clicked');
    await a.keyboard.type('Shapes, text and notes');
    await a.keyboard.press('Control+Enter');
    await a.waitForTimeout(500);
    check((await strokes(a)) > before, 'text commits to the board');

    // --- sticky note ---------------------------------------------------------
    before = await strokes(a);
    await a.evaluate(() => setColor('#FFC107', document.querySelectorAll('.wb-color')[4]));
    await a.evaluate(() => setTool('note'));
    const np = at(0.62, 0.12);
    await a.mouse.click(np.x, np.y);
    await a.waitForTimeout(400);
    await a.keyboard.type('A sticky note, synced to the room like everything else.');
    await a.keyboard.press('Control+Enter');
    await a.waitForTimeout(600);
    check((await strokes(a)) > before, 'sticky note commits');

    // --- it reached the other person ----------------------------------------
    await c.waitForTimeout(2500);
    const bobHas = await strokes(c);
    check(bobHas > 10, `the second client received the board (${bobHas} strokes)`);
    const bobText = await c.evaluate(() =>
        boardState.filter(s => s.type === 'text' || s.type === 'note').length);
    check(bobText >= 2, `text and note survived the wire (${bobText})`);

    // --- undo ----------------------------------------------------------------
    const undoDisabled = await a.evaluate(() => document.getElementById('undoBtn').disabled);
    check(!undoDisabled, 'undo is enabled once there is something to undo');
    before = await strokes(a);
    await a.keyboard.press('Control+z');
    await a.waitForTimeout(600);
    const afterUndo = await strokes(a);
    check(afterUndo < before, `Ctrl+Z takes the last thing back (${before} → ${afterUndo})`);
    await a.keyboard.press('Control+Shift+z');
    await a.waitForTimeout(600);
    check((await strokes(a)) > afterUndo, 'Ctrl+Shift+Z puts it back');

    // --- the shortcut sheet --------------------------------------------------
    await a.keyboard.press('?');
    await a.waitForTimeout(400);
    check(await a.evaluate(() => !document.getElementById('shortcutSheet').hidden), '? opens the shortcut sheet');
    await a.screenshot({ path: OUT + 'wb-shortcuts.png' });
    await a.keyboard.press('Escape');
    await a.waitForTimeout(300);
    check(await a.evaluate(() => document.getElementById('shortcutSheet').hidden), 'Escape closes it');

    // --- tool shortcuts ------------------------------------------------------
    await a.keyboard.press('r');
    await a.waitForTimeout(200);
    check(await a.evaluate(() => currentTool === 'rect'), 'R picks the rectangle');
    await a.keyboard.press('p');
    await a.waitForTimeout(200);
    check(await a.evaluate(() => currentTool === 'draw'), 'P goes back to the pen');

    // --- hold space to pan ---------------------------------------------------
    // This lived inside the toolbar-dragging function; dropping the dragging
    // took panning with it once, so it is worth a check of its own.
    const panBefore = await a.evaluate(() => ({ x: viewportTransform.panX, y: viewportTransform.panY }));
    await a.keyboard.down('Space');
    await a.waitForTimeout(250);
    check(await a.evaluate(() => spaceKeyPressed === true), 'holding Space arms the pan');
    const p1 = at(0.5, 0.5), p2 = at(0.35, 0.4);
    await a.mouse.move(p1.x, p1.y);
    await a.mouse.down();
    for (let i = 1; i <= 6; i++) {
        await a.mouse.move(p1.x + (p2.x - p1.x) * i / 6, p1.y + (p2.y - p1.y) * i / 6);
        await a.waitForTimeout(20);
    }
    await a.mouse.up();
    await a.keyboard.up('Space');
    await a.waitForTimeout(400);
    const panAfter = await a.evaluate(() => ({ x: viewportTransform.panX, y: viewportTransform.panY }));
    check(panAfter.x !== panBefore.x || panAfter.y !== panBefore.y,
        `Space + drag moves the board (${Math.round(panBefore.x)},${Math.round(panBefore.y)} → ${Math.round(panAfter.x)},${Math.round(panAfter.y)})`);
    check(await a.evaluate(() => spaceKeyPressed === false), 'letting go of Space disarms it');
    await a.evaluate(() => resetZoom());
    await a.waitForTimeout(400);

    // --- the page does not scroll -------------------------------------------
    const scrolls = await a.evaluate(() =>
        document.documentElement.scrollHeight > window.innerHeight + 2);
    check(!scrolls, 'the page itself does not scroll');

    // --- nothing green and dashed -------------------------------------------
    const borders = await a.evaluate(() => Array.from(document.querySelectorAll('canvas'))
        .map(c => getComputedStyle(c).borderStyle).filter(v => v && v !== 'none'));
    check(borders.every(v => v !== "dashed"), "no debug borders on any canvas");

    await a.screenshot({ path: OUT + 'wb-board.png' });
    await c.screenshot({ path: OUT + 'wb-board-peer.png' });

    // footer open, for the people/chat shot
    await a.evaluate(() => toggleFooter());
    await a.waitForTimeout(600);
    await a.screenshot({ path: OUT + 'wb-footer.png' });

    console.log('\nPASS (' + pass.length + ')');
    pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(f => console.log('  ✗ ' + f));
    const errs = [...new Set([...a.errs, ...c.errs])];
    console.log('\nconsole errors (' + errs.length + '):');
    errs.slice(0, 12).forEach(e => console.log('  ! ' + e));
    await b.close();
})();
