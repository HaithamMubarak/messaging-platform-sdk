/**
 * Gavel on a phone: a whole trial, alone, on 320 and 375 px screens.
 *
 * Once you join, js/app-chrome.js moves Invite and the Host badge into Gavel's
 * header. At 320 px that row needed ~354 px, and the right-hand group shrank
 * under its own buttons: Sound was drawn over Invite (in production too), while
 * the page itself did not overflow, so no overflow check saw it. So this asks
 * of every control in the header that it has a box of its own.
 *
 * Then a solo trial from the waiting room (three bot jurors) to the record:
 * the verdict shows, and the case law names the bench that sealed it.
 *
 * Channels are code rooms ('gavel-NNNNNN.gavel'); clean up with
 *   scripts/cleanup_channels.py --prefix '^gavel-[0-9]{6}\.gavel$' --yes
 * (leave any you did not make). SHOTS=<dir> saves screenshots there.
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const path = require('path');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name + '.png'), fullPage: true });

/** Every visible control in the header, and each pair that overlaps by more than a pixel. */
function headerClashes(p) {
    return p.evaluate(() => {
        const header = document.querySelector('.sdk-header');
        const boxes = [...header.querySelectorAll('button, a, .sdk-room, .pk-clock, #gameHostIndicator, h1')]
            .filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0)
            .map((e) => ({ name: e.id || e.tagName.toLowerCase(), r: e.getBoundingClientRect() }));
        const clashes = [];
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
            const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            if (x > 1 && y > 1) clashes.push(`${a.name}/${b.name} by ${Math.round(x)}px`);
        }));
        const offEdge = boxes.filter((b) => b.r.right > innerWidth + 1 || b.r.left < -1).map((b) => b.name);
        return { names: boxes.map((b) => b.name), clashes, offEdge, over: document.documentElement.scrollWidth - innerWidth };
    });
}

async function soloTrial(p) {
    await p.evaluate(() => gavelGame.hostOpenCase({ title: 'The People v. the last biscuit', charge: 'Took it',
        defendant: gavelGame.username, bots: true }));
    await p.evaluate(() => gavelGame.hostPlea(gavelGame.username, { text: 'It was already broken.' }));
    await sleep(9000);                                   // the bots testify
    await p.evaluate(() => gavelGame.pending.slice().forEach((x) => gavelGame.hostAdmit(x.id, true)));
    await p.evaluate(() => gavelGame.hostJury());
    await p.waitForFunction(() => gavelGame.phase === 'sentence', null, { timeout: 20000 });
    await p.evaluate(() => gavelGame.hostSentence('Provides biscuits until March.'));
    await p.waitForFunction(() => gavelGame.caseLaw.length > 0, null, { timeout: 15000 }).catch(() => {});
}

async function onPhone(b, w) {
    const p = await (await b.newContext({ viewport: { width: w, height: 760 }, isMobile: true, hasTouch: true })).newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/apps/mini-games/gavel/index.html', { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
    await p.click('#partyLobby .pl-btn--primary');
    await p.waitForFunction(() => window.gavelGame && gavelGame.connected, null, { timeout: 45000 });
    await sleep(2500);
    await p.click('#plWaiting .pl-btn:has-text("Start playing")').catch(() => {});
    await sleep(800);

    const h = await headerClashes(p);
    r.check(h.names.includes('shareBtn') && h.names.includes('soundBtn'), `${w}px: Sound and Invite are both in the header (${h.names.join(', ')})`);
    r.check(!h.clashes.length && !h.offEdge.length, `${w}px: no two header controls overlap, none off the edge (${h.clashes.join('; ') || 'none'}${h.offEdge.length ? '; off: ' + h.offEdge : ''})`);
    r.check(h.over <= 0, `${w}px: the page does not scroll sideways (${h.over}px)`);

    await soloTrial(p);
    const end = await p.evaluate(() => ({ phase: gavelGame.phase, verdict: !document.getElementById('verdictBox').hidden,
        law: gavelGame.caseLaw.map((c) => c.title + ' / ' + c.bench), me: gavelGame.username,
        over: document.documentElement.scrollWidth - innerWidth }));
    r.check(end.phase === 'done' && end.verdict, `${w}px: a solo trial reaches judgment, verdict shown (${end.phase})`);
    r.check(end.law.some((x) => x === 'The People v. the last biscuit / ' + end.me), `${w}px: and the record names the bench (${JSON.stringify(end.law)})`);
    r.check(end.over <= 0, `${w}px: still no sideways scroll at judgment (${end.over}px)`);
    r.check(errors.length === 0, `${w}px: no page errors ${errors.slice(0, 2).join(' | ')}`);
    await shot(p, 'gavel-phone-' + w);
    console.log('room: ' + await p.evaluate(() => gavelGame.channelName));
    await p.context().close();
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    try {
        for (const w of [320, 375]) await onPhone(b, w);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
