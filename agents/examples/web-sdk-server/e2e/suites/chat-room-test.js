/**
 * Chat, two people: who is typing, links you can open, and reactions.
 *
 *  - Bob types and Ann's screen says "Bob is typing…"; when his message lands
 *    the line clears (an ephemeral custom message, so a reload never replays it);
 *  - a link in a message is a link (http/https only, the trailing full stop
 *    left out), and markup in a message stays text;
 *  - Bob reacts ❤️ to Ann's message and Ann sees it under the bubble, with his
 *    name on it; Bob takes it back and it goes;
 *  - Cal, arriving afterwards, sees the reaction too: it is kept with the
 *    messages, not sent once and lost.
 *
 * Channels are 'chr<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^chr[0-9]+' --yes
 * SHOTS=<dir> saves screenshots there.
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const path = require('path');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });
const ROOM = 'chr' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(200); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1200, height: 820 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/chat.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#start', { state: 'attached', timeout: 25000 });
    await p.evaluate(({ room, name }) => {
        document.getElementById('partyLobby')?.remove();
        document.getElementById('channelName').value = room;
        document.getElementById('channelPassword').value = 'pw12345';
        document.getElementById('agentName').value = name;
        document.getElementById('start').click();
    }, { room: ROOM, name });
    // readyState and the session come a few seconds before a send is answered,
    // and a send before that is dropped without a callback. Wait for the page's
    // own "Connected" event, then as long again as chat-test does.
    await waitFor(p, "/Connected to channel as/.test(document.body.innerText)", 30000);
    await sleep(6000);
    return p;
}

const say = async (p, t) => { await p.fill('#agentmsg', t); await p.click('#submitmsg'); await sleep(500); };
const bubbleWith = (text) => `[...document.querySelectorAll('.msg-row')].find((r) => r.textContent.includes(${JSON.stringify(text)}))`;

async function typingAndLinks(ann, bob) {
    // Ann speaks first. Until the first joiner says something, the second
    // joiner's sends are held by the server (a platform fault, filed
    // separately on 2026-10-15), and that is not what this suite is about.
    await say(ann, 'hello Bob');
    await waitFor(bob, `!!${bubbleWith('hello Bob')}`, 8000);
    // A short message is one line. Its bubble's width limit used to be a share of a column
    // that shrinks to fit it, and "hello Bob" came out 56 px wide and three lines tall.
    const h = await game(ann, `Math.round(${bubbleWith('hello Bob')}.querySelector('.bubble').getBoundingClientRect().height)`);
    r.check(h < 50, `a short message sits on one line (${h} px tall)`);
    await bob.click('#agentmsg');
    await bob.keyboard.type('see https://example.com/page. and <b>bold</b>', { delay: 20 });
    r.check(await waitFor(ann, "/Bob is typing/.test(document.getElementById('typingLine').textContent)", 6000),
        "Ann's screen says Bob is typing");
    await bob.click('#submitmsg');
    r.check(await waitFor(ann, `!!${bubbleWith('example.com')}`, 8000), "Bob's message arrives");
    r.check(await waitFor(ann, "document.getElementById('typingLine').textContent === ''", 3000), 'and the typing line clears');
    const link = await game(ann, `(() => { const a = ${bubbleWith('example.com')}.querySelector('.bubble a'); return a ? { href: a.getAttribute('href'), target: a.target, rel: a.rel } : null; })()`);
    r.check(link && link.href === 'https://example.com/page' && link.target === '_blank' && /noopener/.test(link.rel),
        `a link is a link, without the full stop after it (${JSON.stringify(link)})`);
    r.check(await game(ann, `!${bubbleWith('example.com')}.querySelector('.bubble b') && ${bubbleWith('example.com')}.textContent.includes('<b>bold</b>')`),
        'and markup in a message stays text');
}

async function reactions(ann, bob) {
    await say(ann, 'lunch at noon');
    await waitFor(bob, `!!${bubbleWith('lunch at noon')}`, 8000);
    const row = bob.locator('.msg-row', { hasText: 'lunch at noon' });
    await row.hover();
    await row.locator('.react-tray button[aria-label="React ❤️"]').click();
    r.check(await waitFor(ann, `(() => { const c = ${bubbleWith('lunch at noon')}.querySelector('.react-chip'); return !!c && c.textContent === '❤️ 1' && c.title === 'Bob'; })()`, 8000),
        "Bob's ❤️ shows under Ann's message on her screen, with his name");
    await shot(ann, 'chat-reaction');
    await row.locator('.react-chip').click();
    r.check(await waitFor(ann, `!${bubbleWith('lunch at noon')}.querySelector('.react-chip')`, 8000), 'and taking it back removes it');
    await row.hover();
    await row.locator('.react-tray button[aria-label="React 🎉"]').click();
    await waitFor(ann, `!!${bubbleWith('lunch at noon')}.querySelector('.react-chip')`, 8000);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const ann = await join(b, 'Ann', errors);
        const bob = await join(b, 'Bob', errors);
        await typingAndLinks(ann, bob);
        await reactions(ann, bob);
        const cal = await join(b, 'Cal', errors);
        r.check(await waitFor(cal, `(() => { const r = ${bubbleWith('lunch at noon')}; const c = r && r.querySelector('.react-chip'); return !!c && c.textContent === '🎉 1'; })()`, 10000),
            'Cal, arriving later, sees the reaction kept with the message');
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
