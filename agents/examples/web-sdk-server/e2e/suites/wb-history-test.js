/**
 * The whiteboard's history, from the panel a person actually uses.
 *
 * listBoardVersions() and restoreBoardVersion() shipped with no way to reach
 * them — a feature nobody could use. This drives the panel: draw, save, draw
 * again, save again, then open history and put the earlier version back.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
    const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, 'threw: ' + e.message.split('\n')[0].slice(0, 80)));

    const room = 'wbh' + Math.floor(Date.now() / 1000);
    await p.goto(BASE + '/apps/whiteboard/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', 'Artist');
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.whiteboardGame && window.whiteboardGame.connected, { timeout: 45000 })
        .catch(() => {});
    await p.waitForTimeout(5000);

    check(await p.evaluate(() => typeof window.openHistory === 'function'),
        'the history panel is reachable from the page');

    // Two saves, so there is a past to go back to.
    async function strokeAndSave(y) {
        await p.mouse.move(400, y);
        await p.mouse.down();
        await p.mouse.move(800, y + 50, { steps: 12 });
        await p.mouse.up();
        await p.waitForTimeout(1500);
        await p.evaluate(() => saveBoardStateToStorage());
        await p.waitForTimeout(4000);
    }
    await strokeAndSave(300);
    const afterFirst = await p.evaluate(() => boardState.length);
    await strokeAndSave(520);
    const afterSecond = await p.evaluate(() => boardState.length);

    check(afterSecond > afterFirst,
        `the second stroke added to the board (${afterFirst} -> ${afterSecond})`);

    // Open the panel and read it as a person would.
    await p.click('#historyBtn');
    await p.waitForTimeout(3500);

    const shown = await p.evaluate(() => ({
        open: document.getElementById('historyModal').style.display === 'flex',
        rows: document.querySelectorAll('.wb-history__row').length,
        state: document.getElementById('historyState').textContent,
        restores: document.querySelectorAll('.wb-history__row button').length
    }));

    check(shown.open, 'the panel opens');
    check(shown.rows >= 2, `it lists the saved versions (${shown.rows})`);
    check(/version/i.test(shown.state), `and explains what restoring does (${shown.state.slice(0, 50)})`);
    check(shown.restores >= 1, 'every version but the current one offers a Restore');

    await p.screenshot({ path: SHOTS + '/whiteboard-history.png' });

    // Restore the older one and check the board actually goes back.
    await p.evaluate(() => {
        const buttons = document.querySelectorAll('.wb-history__row button');
        buttons[buttons.length - 1].click();      // the oldest listed
    });
    await p.waitForTimeout(8000);

    const afterRestore = await p.evaluate(() => boardState.length);
    check(afterRestore > 0 && afterRestore < afterSecond,
        `restoring an earlier version puts the board back (${afterSecond} -> ${afterRestore})`);

    const closed = await p.evaluate(() =>
        document.getElementById('historyModal').style.display !== 'flex');
    check(closed, 'and the panel closes when it has done its job');

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
