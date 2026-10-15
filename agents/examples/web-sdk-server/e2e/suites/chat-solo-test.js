/**
 * Chat, alone, on a phone: the waiting room's "Add a companion" brings a real
 * second connection. Say hello and you see it typing, then it greets you by
 * name; /roll 20 rolls a die; anything else it reacts to, under your message.
 * The composer stays clear of the site's chip, and nothing overflows a 375 or
 * a 320 px phone.
 *
 * Channels are code rooms ('chat-NNNNNN', no app suffix); clean up with
 *   scripts/cleanup_channels.py --prefix '^chat-[0-9]{6}$' --yes
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

const say = async (p, t) => { await p.fill('#agentmsg', t); await p.click('#submitmsg'); };
const fromCompanion = (re) => `[...document.querySelectorAll('.msg-row.msg-left .bubble')].some((b) => ${re}.test(b.textContent))`;

async function talk(p, width) {
    await say(p, 'hello');
    r.check(await waitFor(p, "/Companion-\\w+ is typing/.test(document.getElementById('typingLine').textContent)", 8000),
        `${width}px: you see the companion typing`);
    const me = await game(p, 'window.channel.agentName');
    r.check(await waitFor(p, fromCompanion('/^Hi ' + me.replace(/[^\w-]/g, '.') + '!/'), 10000), `${width}px: and it greets you by name`);
    await say(p, '/roll 20');
    r.check(await waitFor(p, fromCompanion('/rolled \\d+ \\(1–20\\)/'), 10000), `${width}px: /roll 20 rolls a twenty-sided die`);
    await say(p, 'the build is green');
    r.check(await waitFor(p, "(() => { const r = [...document.querySelectorAll('.msg-row')].find((x) => x.textContent.includes('the build is green')); const c = r && r.querySelector('.react-chip'); return !!c && /👍 1/.test(c.textContent) && /^Companion-/.test(c.title); })()", 10000),
        `${width}px: anything else, it reacts to under your message`);
    r.check(await waitFor(p, "document.getElementById('typingLine').textContent === ''", 3000), `${width}px: and once it has reacted, it is no longer typing`);
}

async function alone(b, width) {
    const p = await (await b.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true })).newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/apps/chat.html', { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
    await p.click('#partyLobby .pl-btn--primary');
    await waitFor(p, '/Connected to channel as/.test(document.body.innerText)', 45000);
    await sleep(1500);
    r.check(/Add a companion/.test(await p.innerText('#plWaiting').catch(() => '')), `${width}px: the waiting room offers a companion`);
    await p.click('#plWaiting .pl-btn:has-text("Add a companion")');
    r.check(await waitFor(p, '!!(window.ChatExtras && ChatExtras.companion && ChatExtras.companion.readyState)', 30000), `${width}px: the companion joins the room`);
    await sleep(5000);
    await talk(p, width);
    // Where you are when you type: the end of the page. The chip is fixed to the screen,
    // so mid-scroll it floats over whatever passes under it; at the end it must not cover the composer.
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(400);
    const m = await game(p, "(() => { const c = document.querySelector('.composer').getBoundingClientRect(); const chip = document.querySelector('.sdk-home-chip'); const k = chip ? chip.getBoundingClientRect() : null; return { over: document.documentElement.scrollWidth - innerWidth, clear: !k || k.top >= c.bottom || k.bottom <= c.top || k.right <= c.left || k.left >= c.right }; })()");
    r.check(m.over <= 0, `${width}px: nothing overflows the phone (${m.over}px over)`);
    r.check(m.clear, `${width}px: the composer is clear of the site's chip`);
    await shot(p, 'chat-solo-' + width);
    r.check(errors.length === 0, `${width}px: no page errors ` + errors.slice(0, 2).join(' | '));
    console.log('room: ' + await game(p, "document.getElementById('channelName').value"));
    await game(p, 'ChatExtras.removeCompanion()');
    await p.context().close();
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    try {
        await alone(b, 375);
        await alone(b, 320);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
