/**
 * Whiteboard, alone: Guess the Doodle.
 *
 * A visitor opens a board from the party lobby and, from the empty board's own
 * hint, starts the game. The bot draws line by line with its own cursor; a
 * wrong guess is refused with a shake; the right one, typed in the card, wins
 * with the score and a line in the chat, and the next doodle starts by itself;
 * Reveal names it and finishes the drawing; Stop takes the card away. The card
 * fits a 375 and a 320 px phone.
 *
 * Channels are code rooms ('whiteboard-NNNNNN.whiteboard'); clean up with
 *   scripts/cleanup_channels.py --prefix '^whiteboard-[0-9]{6}\.whiteboard$' --yes
 * SHOTS=<dir> saves screenshots there.
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const path = require('path');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(200); }
    return false;
}

async function open(b, viewport) {
    const p = await (await b.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 })).newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(e.message));
    await p.goto(BASE + '/apps/whiteboard/app.html', { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
    await p.click('#partyLobby .pl-btn--primary');
    await waitFor(p, 'typeof connected !== "undefined" && connected', 45000);
    await sleep(2500);
    return p;
}

async function drawsAndRefuses(p) {
    await p.click('#emptyHint .wb-btn--primary');
    r.check(await waitFor(p, "!!document.querySelector('.remote-cursor[data-name=\"Doodle bot\"]')", 4000), 'the bot draws with its own named cursor');
    const a = await game(p, "boardState.filter((s) => s.by === 'Doodle bot').length");
    await sleep(900);
    const b = await game(p, "boardState.filter((s) => s.by === 'Doodle bot').length");
    r.check(b > a && a > 0, `it draws line by line, not all at once (${a} then ${b} segments)`);
    r.check(await game(p, "document.getElementById('emptyHint').hidden"), 'and the empty-board hint gets out of its way');
    // The page's older layers redefine --text at light-theme values; the card
    // must wear the dark chrome's own palette, or its words vanish (§6.64).
    const ink = await game(p, "getComputedStyle(document.getElementById('doodleLine')).color.match(/\\d+/g).slice(0, 3).map(Number)");
    r.check(ink.every((v) => v > 180), `the card's words are light on its dark face (rgb ${ink.join(',')})`);
    await shot(p, 'wb-doodle-drawing');

    await p.fill('#doodleGuess', 'a xylophone');
    await p.click('#doodleForm .wb-btn--primary');
    await sleep(200);
    r.check(await game(p, "!DoodleGame.round.winner && document.getElementById('doodleCard').classList.contains('is-wrong')"),
        'a wrong guess is refused, with a shake');
}

async function wins(p) {
    const name = await game(p, 'DoodleGame.round.doodle.name');
    await p.fill('#doodleGuess', 'it is a ' + name + '!');
    await p.click('#doodleForm .wb-btn--primary');
    await sleep(300);
    const won = await game(p, "({ line: document.getElementById('doodleLine').textContent, score: document.getElementById('doodleScore').textContent, done: DoodleGame.round.drawn === DoodleGame.round.total, cursor: !!document.querySelector('.remote-cursor[data-name=\"Doodle bot\"]') })");
    r.check(/got it/.test(won.line) && /Guessed 1 of 1/.test(won.score), `the right guess wins (${won.line} · ${won.score})`);
    r.check(won.done && !won.cursor, 'and the bot finishes its drawing and puts its pen down');
    r.check(await game(p, "[...document.querySelectorAll('#chatMessages .chat-message')].some((m) => /got it/.test(m.textContent))"),
        'the win is said in the chat');
    await shot(p, 'wb-doodle-won');
    r.check(await waitFor(p, "DoodleGame.round && !DoodleGame.round.winner && DoodleGame.round.doodle.name !== " + JSON.stringify(name), 6000),
        'the next doodle starts by itself, and it is a different one');
}

async function revealsAndStops(p) {
    await p.click('#doodleReveal');
    await sleep(200);
    const rv = await game(p, "({ line: document.getElementById('doodleLine').textContent, next: !document.getElementById('doodleNext').hidden, done: DoodleGame.round.drawn === DoodleGame.round.total })");
    r.check(/^It was an? /.test(rv.line) && rv.next && rv.done, `Reveal names it and offers another (${rv.line})`);
    await p.click('#doodleStop');
    r.check(await game(p, "document.getElementById('doodleCard').hidden && !DoodleGame.round"), 'Stop takes the card away');
}

async function phone(b, width) {
    const p = await open(b, { width, height: 760 });
    await game(p, 'DoodleGame.start()');
    await sleep(1500);
    const m = await game(p, "(() => { const c = document.getElementById('doodleCard').getBoundingClientRect(); const rail = document.querySelector('.wb-rail').getBoundingClientRect(); return { over: document.documentElement.scrollWidth - innerWidth, l: Math.round(c.left), r: Math.round(c.right), clearOfRail: c.bottom <= rail.top || c.top >= rail.bottom }; })()");
    r.check(m.over <= 0 && m.l >= 0 && m.r <= width, `at ${width}px the card fits and nothing overflows (${JSON.stringify(m)})`);
    r.check(m.clearOfRail, `at ${width}px the card stays clear of the tool rail`);
    await shot(p, 'wb-doodle-phone-' + width);
    await game(p, 'DoodleGame.stop()');
    r.check(p.errors.length === 0, `no page errors at ${width}px ` + p.errors.slice(0, 2).join(' | '));
    console.log('room: ' + await game(p, 'channelName'));
    await p.context().close();
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    let p;
    try {
        p = await open(b, { width: 1440, height: 900 });
        await drawsAndRefuses(p);
        await wins(p);
        await revealsAndStops(p);
        r.check(p.errors.length === 0, 'no page errors ' + p.errors.slice(0, 2).join(' | '));
        console.log('room: ' + await game(p, 'channelName'));
        await phone(b, 375);
        await phone(b, 320);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
