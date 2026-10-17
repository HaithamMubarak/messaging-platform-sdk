/**
 * Chat's Knock: "who rang" is the platform's word, not the ring's.
 *
 * Ann, Bob and Mal in one chat. Rings are stored in channel storage, which
 * keeps no author, so a ring that SAYS "Bob" could be anybody's.
 *  - Bob rings Ann: Ann's list says "Bob rang ✓" (sealed with Attest);
 *  - Mal stores a ring for Ann that says it is from Bob: Ann's list shows it
 *    as "Mal rang · not signed" (the server stamps who wrote it), never as
 *    Bob's.
 *
 * Channels are 'chk<time>' (no app suffix); clean up with
 *   scripts/cleanup_channels.py --prefix '^chk[0-9]+$' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const ROOM = 'chk' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
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
    await waitFor(p, '/Connected to channel as/.test(document.body.innerText)', 30000);
    await sleep(5000);
    return p;
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const ann = await join(b, 'Ann', errors);
        const bob = await join(b, 'Bob', errors);
        const mal = await join(b, 'Mal', errors);

        await bob.evaluate(() => ChatKnock.ring('Ann'));
        await mal.evaluate(() => new Promise((res) => window.channel.storageAdd({ storageKey: 'chat.rings',
            content: { to: 'Ann', from: 'Bob', at: Date.now(), salt: 'forged' } }, res)));
        await sleep(3000);

        await ann.click('#knock-open');
        const ok = await waitFor(ann, "document.querySelectorAll('#knockRings li').length >= 2", 10000);
        const rows = await game(ann, "[...document.querySelectorAll('#knockRings li')].map((li) => li.textContent.split(' · ')[0] + (li.textContent.includes('not signed') ? ' · not signed' : ''))");
        r.check(ok && rows.some((t) => /^Bob rang ✓$/.test(t)), `Bob's real ring shows as Bob's, signed (${JSON.stringify(rows)})`);
        r.check(rows.some((t) => /^Mal rang · not signed$/.test(t)) && rows.filter((t) => /^Bob rang ✓$/.test(t)).length === 1,
            "Mal's ring in Bob's name shows only as an unsigned claim");
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
