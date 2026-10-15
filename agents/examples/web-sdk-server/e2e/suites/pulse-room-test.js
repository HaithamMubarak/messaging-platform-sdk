/**
 * Pulse, three people: only the host sets what the room sees, the lead
 * changing hands is news, and the bell names a winner on every screen.
 *
 *  - Mal broadcasts a forged poll ("HACKED") and a question signed "Hana"; Bea
 *    keeps the host's poll. Before the fix any guest's 'state' was believed;
 *  - control: the host's real state still reaches Bea;
 *  - Bea votes for the first option, then Hana and Cal for the second: Bea
 *    sees the second option flash "New leader!";
 *  - the host brings the bell forward; Bea's screen names the winner under the
 *    poll and marks its bar.
 *
 * Channels are 'plr<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^plr[0-9]+' --yes
 * SHOTS=<dir> saves screenshots there.
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');
const path = require('path');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });
const ROOM = 'plr' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(150); }
    return false;
}

async function join(b, name, errors, viewport) {
    const p = await (await b.newContext({ viewport: viewport || { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/pulse/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.pulseApp && pulseApp.connected', 45000);
    await sleep(4000);
    return p;
}

async function forgedState(hana, bea, mal) {
    const real = await game(hana, 'pulseApp.poll.question');
    await mal.evaluate(() => pulseApp.sendCustomEventMessage({ type: 'state',
        poll: { question: 'HACKED: vote for Mal', options: [{ id: 'm', label: 'Mal' }], votes: {}, closesAt: Date.now() + 999999 },
        questions: [{ id: 'x', text: 'fake question', by: 'Hana', at: Date.now(), votes: [], answered: false }], versions: [] }, '*'));
    await sleep(3000);
    const seen = await game(bea, '({ q: pulseApp.poll && pulseApp.poll.question, fake: pulseApp.questions.some((x) => x.text === "fake question") })');
    r.check(seen.q === real && !seen.fake, `a guest's forged poll and question do not reach Bea (${JSON.stringify(seen)})`);
    await hana.evaluate(() => pulseApp.ask('a real question from the host'));
    r.check(await waitFor(bea, 'pulseApp.questions.some((x) => x.text === "a real question from the host")', 8000), "control: the host's real state still does");
}

async function leadChanges(hana, bea, cal) {
    const [a, b] = await game(hana, 'pulseApp.poll.options.map((o) => o.id)');
    await bea.evaluate((id) => pulseApp.vote(id), a);
    await waitFor(bea, `pulseApp._tally()[${JSON.stringify(a)}] === 1`, 8000);
    await hana.evaluate((id) => pulseApp.vote(id), b);
    await cal.evaluate((id) => pulseApp.vote(id), b);
    r.check(await waitFor(bea, `(() => { const el = document.querySelector('.poll-option[data-option=${JSON.stringify(b)}]'); return !!el && el.classList.contains('took-lead') && /New leader!/.test(el.textContent); })()`, 8000),
        'when the lead changes hands, Bea sees "New leader!" on the new leader');
    await shot(bea, 'pulse-new-leader');
    return b;
}

async function bell(hana, bea, winner) {
    await hana.evaluate(() => { pulseApp.poll.closesAt = Date.now() + 3000; pulseApp._hostBroadcast(); });
    r.check(await waitFor(bea, "!!document.querySelector('.poll__result') && /wins, with 2 of 3 votes/.test(document.querySelector('.poll__result').textContent)", 12000),
        "the bell names the winner under the poll on Bea's screen");
    // After a redraw or two: the poll redraws every second, and a mark added once was wiped.
    await sleep(2500);
    r.check(await game(bea, `(() => { const el = document.querySelector('.poll-option[data-option=${JSON.stringify(winner)}]'); return el.classList.contains('is-winner') && /Winner/.test(el.textContent); })()`),
        "and marks the winner's bar, and keeps it marked");
    await shot(bea, 'pulse-winner');
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const hana = await join(b, 'Hana', errors);
        const bea = await join(b, 'Bea', errors);
        const mal = await join(b, 'Mal', errors);
        const cal = await join(b, 'Cal', errors, { width: 320, height: 760 });   // a phone
        await sleep(2500);
        await forgedState(hana, bea, mal);
        const winner = await leadChanges(hana, bea, cal);
        await bell(hana, bea, winner);
        const over = await game(cal, 'document.documentElement.scrollWidth - innerWidth');
        r.check(over <= 0 && await game(cal, "!!document.querySelector('.poll__result')"), `on Cal's 320 px phone the result shows and nothing overflows (${over}px over)`);
        await shot(cal, 'pulse-winner-phone');
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
