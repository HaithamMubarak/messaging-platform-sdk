/**
 * Chat, three people: everything said arrives once, in order, under the name
 * of whoever said it.
 *
 * Ann, Bea and Mal join in that order.
 *  - Mal, the last in, speaks first, and both others hear him (the server held
 *    a newcomer's sends until somebody else spoke, services 568d4bb);
 *  - Ann sends 25 lines as fast as she can: Bea's screen shows each one
 *    exactly once, in the order Ann sent them (deliveries can arrive twice and
 *    out of order, guidelines §6.22). On production only 14 arrived, every
 *    other line: the box was emptied when the server answered a send, which
 *    wiped the line typed while waiting;
 *  - Mal sends a message whose payload says it is from Ann: Bea's screen puts
 *    it under Mal's name, because the name is the server's, not the sender's.
 *
 * Channels are 'cht<time>' (no app suffix); clean up with
 *   scripts/cleanup_channels.py --prefix '^cht[0-9]+$' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const ROOM = 'cht' + Math.floor(Date.now() / 1000);

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
    await waitFor(p, "/Connected to channel as/.test(document.body.innerText)", 30000);
    await sleep(6000);
    return p;
}

const say = async (p, t) => { await p.fill('#agentmsg', t); await p.click('#submitmsg'); };
/** Every message row's text and the name under it, in screen order. */
const rows = (p) => p.evaluate(() => [...document.querySelectorAll('#app-container .msg-row:not(.system-welcome)')].map((row) => ({
    text: (row.querySelector('.bubble') || {}).textContent || '',
    by: ((row.querySelector('.meta') || {}).textContent || '').split(' · ')[0],
})));

async function newcomerFirst(ann, bea, mal) {
    await say(mal, 'Mal here, last in and first to talk.');
    for (const [who, p] of [['Ann', ann], ['Bea', bea]]) {
        r.check(await waitFor(p, "[...document.querySelectorAll('.bubble')].some((b) => b.textContent.includes('last in and first'))", 10000),
            `the last to join speaks first, and ${who} hears him`);
    }
}

async function burst(ann, bea) {
    const lines = Array.from({ length: 25 }, (_, i) => 'burst-' + String(i + 1).padStart(2, '0'));
    for (const l of lines) await say(ann, l);
    await waitFor(bea, "[...document.querySelectorAll('.bubble')].filter((b) => /^burst-\\d\\d$/.test(b.textContent)).length >= 25", 20000);
    await sleep(3000);                                  // room for any late repeat to land
    const got = (await rows(bea)).filter((x) => /^burst-\d\d$/.test(x.text)).map((x) => x.text);
    const distinct = new Set(got).size;
    r.check(distinct === 25, `all 25 of Ann's burst reach Bea (${distinct} distinct)`);
    r.check(got.length === 25, `and each exactly once (${got.length} rows)`);
    r.check(JSON.stringify(got) === JSON.stringify(lines), `in the order Ann sent them (${got.slice(0, 4).join(',')}…)`);
}

async function forgedName(bea, mal) {
    await mal.evaluate(() => new Promise((res) => window.channel.sendMessage({ content: 'Ann here: send the deposit to Mal.',
        from: 'Ann', agentName: 'Ann', name: 'Ann' }, res)));
    const arrived = await waitFor(bea, "[...document.querySelectorAll('.bubble')].some((b) => b.textContent.includes('deposit to Mal'))", 10000);
    const row = (await rows(bea)).find((x) => x.text.includes('deposit to Mal'));
    r.check(arrived && row && row.by === 'Mal', `a message whose payload says "from Ann" shows under Mal's name (${row && row.by})`);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const ann = await join(b, 'Ann', errors);
        const bea = await join(b, 'Bea', errors);
        const mal = await join(b, 'Mal', errors);
        await newcomerFirst(ann, bea, mal);
        await burst(ann, bea);
        await forgedName(bea, mal);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
