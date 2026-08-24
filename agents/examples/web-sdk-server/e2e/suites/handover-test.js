/**
 * A board outlives the person who started it.
 *
 * Only the host writes to storage. While a board was stored as one JPEG,
 * somebody who joined late held no board state at all — so the moment the host
 * left and they inherited the job, their first save wrote everyone else's work
 * back as pixels with an empty stroke list. Text stopped being text, ink forgot
 * its author, and nobody could tell until they looked closely.
 *
 * The handover is where that loss happened, so it gets its own room and its own
 * run rather than being tacked onto a board that has already been through
 * something else.
 */
const { BASE, SHOTS, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { check, report } = results();
const ROOM = 'handover' + Math.floor(Math.random() * 99999);

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
const state = (p) => p.evaluate(() => ({
    total: boardState.length,
    notes: boardState.filter(s => s.type === 'text' || s.type === 'note').length,
    authors: [...new Set(boardState.map(s => s.by).filter(Boolean))].sort(),
    host: !!(window.channel && channel.isHostAgent && channel.isHostAgent())
}));
async function contribute(p, who, x) {
    await p.evaluate((q) => {
        currentTool = 'rect';
        WhiteboardTools.begin({ x: q.x, y: 250 });
        WhiteboardTools.move({ x: q.x + 220, y: 450 });
        WhiteboardTools.end();
        addStrokeToBoardState({ type: 'note', x1: q.x, y1: 600, x2: q.x + 200, y2: 740,
            text: 'note from ' + q.who, color: '#f59e0b', size: 20, erase: false });
        redrawCanvas();
    }, { x, who });
    await p.waitForTimeout(1800);
}

(async () => {
    const b = await chromium.launch(LAUNCH);

    const alice = await join(b, 'Alice');
    await alice.bringToFront();
    await contribute(alice, 'Alice', 200);
    const started = await state(alice);
    check(started.host && started.notes === 1, `the first person hosts and draws (${JSON.stringify(started)})`);
    await alice.waitForTimeout(9000);   // her save

    const bob = await join(b, 'Bob');
    await bob.bringToFront(); await bob.waitForTimeout(12000);
    const joined = await state(bob);
    check(joined.notes === 1 && joined.authors.includes('Alice'),
        `somebody joining gets her work as objects (${JSON.stringify(joined.authors)})`);

    // the host leaves
    await alice.evaluate(() => { if (typeof disconnect === 'function') disconnect(); });
    await alice.waitForTimeout(1500);
    await alice.ctx.close();
    await bob.bringToFront(); await bob.waitForTimeout(20000);
    const inherited = await state(bob);
    check(inherited.host, 'the survivor takes over as host');
    check(inherited.notes === 1 && inherited.authors.includes('Alice'),
        `and still holds her work as objects, not pixels (${inherited.total} entries)`);

    // the new host adds to it, and saves everything — including work not his
    await contribute(bob, 'Bob', 800);
    await bob.waitForTimeout(10000);
    const both = await state(bob);
    check(both.notes === 2 && both.authors.length === 2,
        `the new host's board carries both people (${JSON.stringify(both.authors)})`);

    const carol = await join(b, 'Carol');
    await carol.bringToFront(); await carol.waitForTimeout(13000);
    const arrived = await state(carol);
    check(arrived.notes === 2, `somebody arriving after the handover gets both notes (${arrived.notes})`);
    check(arrived.authors.length === 2,
        `with both authors intact, so either can still undo their own (${JSON.stringify(arrived.authors)})`);

    await carol.screenshot({ path: SHOTS + '/handover-carol.png' });
    const errs = [...new Set([...bob.errs, ...carol.errs])];
    check(errs.length === 0, `nothing throws (${errs.slice(0, 2).join(' | ') || 'clean'})`);

    const failed = report();
    await b.close();
    process.exit(failed ? 1 : 0);
})();
