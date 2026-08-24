/**
 * The parts of the whiteboard that only exist between two people.
 *
 * A shape commits whole, so until the mouse came up nobody else saw anything:
 * the board sat idle and then a rectangle appeared. And undo was local — it
 * changed the board of whoever pressed it and nothing else, while removing the
 * last strokes by position rather than the ones it actually made, so it could
 * delete a peer's work instead of your own.
 */
const { BASE, SHOTS, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { check, report } = results();
const ROOM = 'collab' + Math.floor(Math.random() * 99999);

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
const strokes = (p) => p.evaluate(() => boardState.length);
const previewInk = (p) => p.evaluate(() => {
    const pv = document.getElementById('whiteboard-preview');
    if (!pv) return 0;
    const d = pv.getContext('2d').getImageData(0, 0, pv.width, pv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
    return n;
});
async function shape(p, tool, x0, y0, x1, y1) {
    await p.evaluate((q) => {
        currentTool = q.t;
        WhiteboardTools.begin({ x: q.x0, y: q.y0 });
        WhiteboardTools.move({ x: q.x1, y: q.y1 });
        WhiteboardTools.end();
    }, { t: tool, x0, y0, x1, y1 });
    await p.waitForTimeout(1800);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const a = await join(b, 'Alice');
    const c = await join(b, 'Bob');

    // --- the room watches a shape being drawn ------------------------------
    // Note: never bring the watcher to the front mid-drag. Focusing it blurs
    // the drawer, which ends the drag — evaluate() reads a background page.
    await a.bringToFront(); await a.waitForTimeout(2500);
    await a.evaluate(() => { currentTool = 'rect'; WhiteboardTools.begin({ x: 400, y: 250 }); });
    for (const x of [560, 700, 840]) {
        await a.evaluate((v) => WhiteboardTools.move({ x: v, y: 560 }), x);
        await a.waitForTimeout(140);
    }
    await a.waitForTimeout(1200);
    check((await previewInk(c)) > 0, 'a shape being dragged is visible to the other person');
    await a.evaluate(() => WhiteboardTools.end());
    await a.waitForTimeout(2500);
    check((await previewInk(c)) === 0, 'and the preview clears once it lands');
    check((await strokes(c)) >= 4, `the finished shape is on their board (${await strokes(c)})`);

    // --- undo belongs to whoever did it ------------------------------------
    await c.bringToFront();
    await shape(c, 'diamond', 900, 250, 1200, 560);     // Bob draws last
    await a.waitForTimeout(2500);
    const both = await strokes(a);
    check(both === 8 && (await strokes(c)) === 8, `both boards agree before the undo (${both})`);

    await a.bringToFront();
    await a.evaluate(() => triggerUndo());
    await a.waitForTimeout(2000);
    await c.waitForTimeout(2500);
    check((await strokes(c)) === 4, `Alice's undo reaches Bob (${await strokes(c)} left)`);
    const mine = await c.evaluate(() => boardState.filter(s => s.by === 'Bob').length);
    const theirs = await c.evaluate(() => boardState.filter(s => s.by === 'Alice').length);
    check(mine === 4 && theirs === 0,
        `and takes only Alice's work, though Bob drew last (Bob ${mine}, Alice ${theirs})`);

    await a.evaluate(() => triggerRedo());
    await a.waitForTimeout(2000);
    await c.waitForTimeout(2500);
    check((await strokes(c)) === 8, `and redo puts it back for both (${await strokes(c)})`);

    await c.screenshot({ path: SHOTS + '/collab-actions-bob.png' });
    check([...new Set([...a.errs, ...c.errs])].length === 0,
        `nothing throws (${[...new Set([...a.errs, ...c.errs])].slice(0, 2).join(' | ') || 'clean'})`);

    const failed = report();
    await b.close();
    process.exit(failed ? 1 : 0);
})();
