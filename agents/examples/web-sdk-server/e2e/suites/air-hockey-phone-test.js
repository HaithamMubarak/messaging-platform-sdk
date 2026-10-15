/**
 * Air Hockey on a phone: the paddle goes where your finger takes it, and stays.
 *
 * Touch "mirrors" the finger: move it 20 px and the paddle moves as far, in
 * table units. It used to add the finger's last SPEED to the paddle every
 * frame; a finger that stops sends no touchmove to zero it, so the paddle kept
 * sliding until it hit the wall. Checked in portrait (where the table is
 * turned a quarter) and in landscape, alone against a bot from the waiting
 * room, with real TouchEvents on the canvas; and nothing overflows.
 *
 * Channels are code rooms ('hockey-NNNNNN.air-hockey'); clean up with
 *   scripts/cleanup_channels.py --prefix '^hockey-[0-9]{6}\.air-hockey$' --yes
 * (leave any you did not make). SHOTS=<dir> saves screenshots there.
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const path = require('path');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });

/** A finger: down at (x, y), then five steps of (sx, sy) screen pixels, then held. */
function drag(page, x, y, sx, sy) {
    return page.evaluate(({ x, y, sx, sy }) => {
        const cv = airHockeyGame.canvas;
        const fire = (type, X, Y) => {
            const t = new Touch({ identifier: 1, target: cv, clientX: X, clientY: Y });
            cv.dispatchEvent(new TouchEvent(type, { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
        };
        fire('touchstart', x, y);
        for (let i = 1; i <= 5; i++) fire('touchmove', x + i * sx, y + i * sy);
    }, { x, y, sx, sy });
}

const myPaddle = (p) => p.evaluate(() => { const me = airHockeyGame.players.get(airHockeyGame.username); return { x: me.paddle.x, y: me.paddle.y }; });

async function onPhone(b, w, h, tag) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true })).newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/apps/mini-games/air-hockey/index.html', { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
    await p.click('#partyLobby .pl-btn--primary');
    await p.waitForFunction(() => window.airHockeyGame && airHockeyGame.connected, null, { timeout: 45000 });
    await sleep(2500);
    await p.click('#plWaiting .pl-btn:has-text("Add a bot")');
    await sleep(800);
    await p.click('#plWaiting .pl-btn:has-text("Start playing")').catch(() => {});
    await p.evaluate(() => airHockeyGame.startGame());
    await sleep(2500);

    // Where a finger starts: the middle of my own half, in screen terms.
    const geo = await p.evaluate(() => {
        const g = airHockeyGame, c = g.canvas.getBoundingClientRect(), me = g.players.get(g.username);
        return { rect: [c.left, c.top, c.width, c.height], portrait: !!g.isPortraitMode, x: me.paddle.x };
    });
    const [L, T, W, H] = geo.rect;
    const sx = 4, sy = 3;                              // 5 steps: 20 px across, 15 px down
    // Table units per screen pixel, in each direction, as the page maps them.
    const expected = geo.portrait
        ? Math.hypot((5 * sy) / H * 1000, (5 * sx) / W * 600)
        : Math.hypot((5 * sx) / W * 1000, (5 * sy) / H * 600);
    const a = await myPaddle(p);
    await drag(p, L + W * 0.3, T + H * 0.5, sx, sy);
    await sleep(300);
    const b1 = await myPaddle(p);
    await sleep(700);                                  // the finger rests
    const b2 = await myPaddle(p);
    const moved = Math.hypot(b1.x - a.x, b1.y - a.y);
    const drift = Math.hypot(b2.x - b1.x, b2.y - b1.y);
    r.check(moved > expected * 0.5 && moved < expected * 1.5,
        `${tag}: the paddle moves as far as the finger (${moved.toFixed(0)} table units for ${expected.toFixed(0)})`);
    r.check(drift < 2, `${tag}: and stays put while the finger rests (drifted ${drift.toFixed(1)})`);
    // While the match runs, the floating chrome steps back from the rink.
    const chrome = () => p.evaluate(() => {
        const op = (sel) => { const e = document.querySelector(sel); return e ? Number(getComputedStyle(e).opacity) : null; };
        return { chip: op('.sdk-home-chip'), code: op('#partyCodeChip'), panel: op('.game-control-panel.collapsed') };
    });
    await sleep(400);
    const during = await chrome();
    r.check(during.chip === 0 && (during.code === null || during.code === 0) && (during.panel === null || during.panel <= 0.4),
        `${tag}: during a match the chips leave the rink and the host's button fades (${JSON.stringify(during)})`);
    await p.evaluate(() => { airHockeyGame.gameStatus = 'waiting'; });
    await sleep(600);
    const between = await chrome();
    // The chip rests at 0.82, not 1 (app-chrome.css); it brightens on hover.
    r.check(between.chip >= 0.8 && (between.panel === null || between.panel === 1),
        `${tag}: and come back between matches (${JSON.stringify(between)})`);
    await p.evaluate(() => { airHockeyGame.gameStatus = 'playing'; });
    await sleep(400);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    r.check(over <= 0, `${tag}: nothing overflows the phone (${over}px over)`);
    await shot(p, 'air-hockey-' + tag);
    r.check(errors.length === 0, `${tag}: no page errors ` + errors.slice(0, 2).join(' | '));
    console.log('room: ' + await p.evaluate(() => airHockeyGame.channelName));
    await p.context().close();
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    try {
        await onPhone(b, 375, 760, 'portrait');
        await onPhone(b, 760, 375, 'landscape');
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
