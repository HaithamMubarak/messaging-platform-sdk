/**
 * Gavel, alone: one person holds a whole trial with bot jurors.
 *
 * With "Seat 3 bot jurors" ticked the host is the only person, so they are
 * also the defendant. The bots must do what a room would: testify anonymously
 * (the bench admits or strikes it), vote in sealed booths that light one by one,
 * and so reach a verdict the host sentences and records. The courtroom strip
 * must say where the trial is, and that some of the jury are bots.
 *
 * Joins through the party lobby, as a visitor does, so the channel is a code
 * room ('gavel-NNNNNN.gavel'); clean up with
 *   scripts/cleanup_channels.py --prefix '^gavel-[0-9]{6}\.gavel$' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
    return false;
}

async function trial(p) {
    await p.fill('#caseTitle', 'The People v. Nobody');
    await p.fill('#caseCharge', 'Re: the last biscuit');
    await p.check('#botJurors');
    await p.click('#openBtn');
    await sleep(800);
    r.check(await game(p, "window.gavelGame.defendant === window.gavelGame.username && window.gavelGame.phase === 'plea'"),
        'alone, the host is in the dock and the trial opens on the plea');
    r.check(await game(p, "document.querySelector('#courtStepper [aria-current=step]').dataset.phase === 'plea'"),
        'the courtroom strip marks the plea as the current stage');
    r.check(/3 of the jury are bots/.test(await game(p, "document.getElementById('botNote').textContent")),
        'and says that three of the jury are bots');

    await p.fill('#pleaInput', 'I was framed by the toaster.');
    await p.click('#sendPlea');
    await waitFor(p, "window.gavelGame.phase === 'evidence'", 5000);
    const testified = await waitFor(p, 'window.gavelGame.pending.length >= 2', 15000);
    r.check(testified, 'bot witnesses submit anonymous testimony for the bench');
    await p.click('#benchList .gv-ok');
    await sleep(600);
    r.check(await game(p, "!!document.querySelector('#exhibits .gv-exhibit .gv-exhibit__stamp')"),
        'an admitted statement appears as a stamped exhibit');

    await p.click('#juryNowBtn');
    const lit = [];
    for (let i = 0; i < 24 && !(await game(p, "window.gavelGame.phase !== 'jury'")); i++) {
        lit.push(await game(p, "document.querySelectorAll('#booths .gv-booth.is-in').length"));
        await sleep(250);
    }
    r.check(new Set(lit).size >= 2 && Math.max(...lit) >= 2,
        `the sealed booths light one by one as the bots vote (${[...new Set(lit)].join(',')})`);
    r.check(await waitFor(p, "window.gavelGame.phase === 'sentence'", 6000), 'the bots reach a verdict');

    await p.click('#passBtn');
    await sleep(800);
    const done = await game(p, "({ phase: window.gavelGame.phase, stamp: !!document.querySelector('#verdictBox .gv-stamp'), verdict: window.gavelGame.verdict })");
    r.check(done.phase === 'done' && done.stamp, `the verdict is stamped and the case recorded (${JSON.stringify(done)})`);
    r.check(await waitFor(p, 'window.gavelGame.caseLaw.some((c) => c.title === "The People v. Nobody")', 8000),
        'and goes into the case law');
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    try {
        await p.goto(BASE + '/apps/mini-games/gavel/index.html', { waitUntil: 'load' });
        await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
        await p.click('#partyLobby .pl-btn--primary');
        await waitFor(p, 'window.gavelGame && window.gavelGame.connected && window.gavelGame.isHost()', 45000);
        await sleep(2000);
        // Whoever opens a room meets the waiting room first; alone, put it away.
        const waiting = await p.$('#plWaiting');
        r.check(!!waiting && /Seat 3 bot jurors/.test(await waiting.innerText()), 'the waiting room points a lone host at the bot jurors');
        if (waiting) await p.click('#plWaiting .pl-btn:has-text("Start playing")');
        await trial(p);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + await p.evaluate(() => window.gavelGame && window.gavelGame.channelName).catch(() => '?'));
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
