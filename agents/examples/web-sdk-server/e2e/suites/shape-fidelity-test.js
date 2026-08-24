/**
 * A shape must arrive as the shape that was drawn.
 *
 * The receiving side groups contiguous strokes into a path and renders it with
 * quadratic midpoint smoothing. That is right for a pen — the segments are
 * pointer noise — and ruinous for geometry: it rounded the corners off a
 * rectangle so a square arrived as an arc, and it began each path at the
 * midpoint of the first segment so an arrow did not start where the pointer
 * went down.
 *
 * Both faults were invisible to whoever drew, because local drawing does not
 * smooth. Only the other screen was wrong, which is why this checks the pixels
 * on both.
 */
const { BASE, SHOTS, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { check, report } = results();
const ROOM = 'shape' + Math.floor(Math.random() * 99999);

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

/** Ink at the four corners of a box. A square has all four; an arc has one. */
const CORNERS = (x0, y0, x1, y1) => {
    const cv = document.getElementById('whiteboard');
    const c = cv.getContext('2d');
    const at = (x, y) => {
        const d = c.getImageData(Math.round(x) - 5, Math.round(y) - 5, 11, 11).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 3] > 20) return 1;
        return 0;
    };
    return at(x0, y0) + at(x1, y0) + at(x1, y1) + at(x0, y1);
};
const AT = (x, y) => {
    const cv = document.getElementById('whiteboard');
    const d = cv.getContext('2d').getImageData(x - 6, y - 6, 13, 13).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 3] > 20) return 1;
    return 0;
};

(async () => {
    const b = await chromium.launch(LAUNCH);
    const a = await join(b, 'Drawer');
    const c = await join(b, 'Watcher');
    await a.bringToFront(); await a.waitForTimeout(3000);

    // --- a rectangle keeps its corners on the far side ---------------------
    const BOX = { x0: 500, y0: 300, x1: 900, y1: 600 };
    await a.evaluate((p) => {
        currentTool = 'rect';
        WhiteboardTools.begin({ x: p.x0, y: p.y0 });
        WhiteboardTools.move({ x: p.x1, y: p.y1 });
        WhiteboardTools.end();
    }, BOX);
    await a.waitForTimeout(2200);
    await c.bringToFront(); await c.waitForTimeout(4500);
    const here = await a.evaluate(new Function('p', 'return (' + CORNERS.toString() + ')(p.x0,p.y0,p.x1,p.y1)'), BOX);
    const there = await c.evaluate(new Function('p', 'return (' + CORNERS.toString() + ')(p.x0,p.y0,p.x1,p.y1)'), BOX);
    check(here === 4, `a rectangle has four corners where it was drawn (${here}/4)`);
    check(there === 4, `and still four on the other screen (${there}/4)`);

    // --- a diamond too, whose corners are not axis-aligned -----------------
    const DIA = { x0: 1000, y0: 300, x1: 1340, y1: 600 };
    await a.bringToFront();
    await a.evaluate((p) => {
        currentTool = 'diamond';
        WhiteboardTools.begin({ x: p.x0, y: p.y0 });
        WhiteboardTools.move({ x: p.x1, y: p.y1 });
        WhiteboardTools.end();
    }, DIA);
    await a.waitForTimeout(2200);
    await c.bringToFront(); await c.waitForTimeout(4500);
    const dTip = (p) => p.evaluate(new Function('q', 'return (' + AT.toString() + ')((q.x0+q.x1)/2, q.y0)'), DIA);
    check((await dTip(a)) === 1, 'a diamond has a point at the top where it was drawn');
    check((await dTip(c)) === 1, 'and the same point on the other screen');

    // --- an arrow starts under the pointer ---------------------------------
    const TAIL = { ax: 420, ay: 700, bx: 820, by: 780 };
    await a.bringToFront();
    await a.evaluate((p) => {
        currentTool = 'arrow';
        WhiteboardTools.begin({ x: p.ax, y: p.ay });
        WhiteboardTools.move({ x: p.bx, y: p.by });
        WhiteboardTools.end();
    }, TAIL);
    await a.waitForTimeout(2200);
    await c.bringToFront(); await c.waitForTimeout(4500);
    const tail = (p) => p.evaluate(new Function('q', 'return (' + AT.toString() + ')(q.ax, q.ay)'), TAIL);
    check((await tail(a)) === 1, 'an arrow starts where the pointer went down');
    check((await tail(c)) === 1, 'and starts in the same place on the other screen');

    await c.screenshot({ path: SHOTS + '/shape-fidelity-watcher.png' });
    check([...new Set([...a.errs, ...c.errs])].length === 0,
        `nothing throws (${[...new Set([...a.errs, ...c.errs])].slice(0, 2).join(' | ') || 'clean'})`);

    const failed = report();
    await b.close();
    process.exit(failed ? 1 : 0);
})();
