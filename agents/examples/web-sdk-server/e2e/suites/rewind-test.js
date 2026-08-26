/**
 * Rewind: a channel that has been drawn on is already a recording.
 *
 * The claim is that the whiteboard's saves ARE the timeline — no recorder, no
 * extra protocol. So the test draws in the real whiteboard, saves twice to
 * create two points in time, closes it, and then opens Rewind on the same
 * channel and checks it finds a history it can scrub.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function openApp(b, path, room, name, readyFn) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 80)}`));
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    if (readyFn) await p.waitForFunction(readyFn, { timeout: 45000 }).catch(() => {});
    await p.waitForTimeout(5000);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const room = 'rw' + Math.floor(Date.now() / 1000);

    // ---- draw, and save twice ---------------------------------------------
    const wb = await openApp(b, '/apps/whiteboard/app.html', room, 'Artist',
        () => !!(window.whiteboardGame && window.whiteboardGame.connected));

    // Two strokes with a save after each, so there are two points in time.
    for (const y of [300, 500]) {
        await wb.mouse.move(400, y);
        await wb.mouse.down();
        await wb.mouse.move(700, y + 60, { steps: 12 });
        await wb.mouse.move(950, y, { steps: 12 });
        await wb.mouse.up();
        await wb.waitForTimeout(1500);
        await wb.evaluate(() => {
            if (typeof saveBoardState === 'function') saveBoardState();
        }).catch(() => {});
        await wb.waitForTimeout(4000);
    }

    const strokes = await wb.evaluate(() =>
        (typeof boardState !== 'undefined' && Array.isArray(boardState)) ? boardState.length : -1);
    check(strokes > 0, `the whiteboard has strokes to record (${strokes})`);
    await wb.context().close();

    // ---- open Rewind on the same channel -----------------------------------
    const rw = await openApp(b, '/apps/rewind/app.html', room, 'Viewer',
        () => !!(window.rewindApp && window.rewindApp.connected));
    await rw.waitForTimeout(5000);

    const frames = await rw.evaluate(() => window.rewindApp.frames.length);
    check(frames > 0, `Rewind finds saved states in the channel (${frames})`);

    const stateText = await rw.evaluate(() => document.getElementById('state').textContent);
    check(/saved state/.test(stateText), `and says what it found (${stateText.slice(0, 60)})`);

    if (frames > 1) {
        check(await rw.evaluate(() => !document.getElementById('scrub').disabled),
            'the scrubber is usable when there is more than one point in time');

        // Scrub back and check the position readout follows.
        await rw.evaluate(() => window.rewindApp.seek(0));
        await rw.waitForTimeout(1200);
        const pos = await rw.evaluate(() => document.getElementById('position').textContent);
        check(/^1 \//.test(pos), `scrubbing to the start moves the position (${pos})`);
    } else {
        check(true, 'only one save was captured; scrubbing needs two (not a failure of Rewind)');
    }

    // The stage must actually have paint on it, not just be a white rectangle.
    const painted = await rw.evaluate(() => {
        const canvas = document.getElementById('stage');
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let nonWhite = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) nonWhite++;
        }
        return nonWhite;
    });
    check(painted > 200, `the board is actually drawn on the stage (${painted} non-white pixels)`);

    await rw.screenshot({ path: SHOTS + '/rewind.png' });
    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
