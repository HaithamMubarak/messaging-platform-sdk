/**
 * Chat, two people, and the one who joined SECOND speaks first.
 *
 * Until 2026-10-15 that message was held: the client's pull long-polls over
 * the same WebSocket, and the server ran that pull on the socket's inbound
 * thread, so the push waited behind it until the other person's message woke
 * it. The first joiner never saw it, because the second joiner's connect had
 * just woken their pull. (Fixed in messaging-service; its own guard is
 * PushBehindPullTest.)
 *
 *  - Bob, the second to join, sends first: the send is answered within 5 s;
 *  - Ann sees Bob's message without saying anything herself;
 *  - and the room still works the other way round.
 *
 * Channels are 'chs<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^chs[0-9]+' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const ROOM = 'chs' + Math.floor(Date.now() / 1000);
const bubbleWith = (text) => `[...document.querySelectorAll('.msg-row')].some((r) => r.textContent.includes(${JSON.stringify(text)}))`;

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await p.evaluate(expr)) return true; await sleep(200); }
    return false;
}

async function join(b, name) {
    const p = await (await b.newContext()).newPage();
    await p.goto(BASE + '/apps/chat.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#start', { state: 'attached', timeout: 25000 });
    await p.evaluate(({ room, name }) => {
        document.getElementById('partyLobby')?.remove();
        document.getElementById('channelName').value = room;
        document.getElementById('channelPassword').value = 'pw12345';
        document.getElementById('agentName').value = name;
        document.getElementById('start').click();
    }, { room: ROOM, name });
    // Same settling as chat-room-test: the page's own "Connected", then a send
    // is answered a few seconds later.
    await waitFor(p, '/Connected to channel as/.test(document.body.innerText)', 30000);
    await sleep(6000);
    return p;
}

/** Send through the page's own channel; resolves with the callback's status and how long it took. */
const send = (p, text) => p.evaluate((text) => new Promise((res) => {
    const t0 = Date.now();
    window.channel.sendMessage(text, (reply) => res({ status: reply && reply.status, ms: Date.now() - t0 }));
    setTimeout(() => res({ status: 'no answer', ms: Date.now() - t0 }), 10000);
}), text);

(async () => {
    const b = await chromium.launch(LAUNCH);
    try {
        const ann = await join(b, 'Ann');
        const bob = await join(b, 'Bob');
        console.log('room', ROOM);

        const first = await send(bob, 'bob speaks first');
        r.check(first.status === 'success' && first.ms < 5000,
            `the second joiner's first send is answered (${first.status} in ${first.ms} ms)`);
        r.check(await waitFor(ann, bubbleWith('bob speaks first'), 8000),
            "and Ann sees it without saying anything herself");

        const reply = await send(ann, 'ann answers');
        r.check(reply.status === 'success', `Ann's reply is answered (${reply.status} in ${reply.ms} ms)`);
        r.check(await waitFor(bob, bubbleWith('ann answers'), 8000), 'and Bob sees it');
    } catch (e) {
        r.check(false, 'suite crashed: ' + e.message.split('\n')[0]);
    } finally {
        await b.close();
    }
    process.exitCode = r.report() ? 1 : 0;
})();
