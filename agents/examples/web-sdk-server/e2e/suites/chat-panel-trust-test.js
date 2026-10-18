/**
 * The shared chat panel, three people: a line is shown under the name of the
 * person who sent it, whatever name the line itself carries.
 *
 * Mara (the host), Odell and Priya, in BlockParty (the panel's one user).
 * A guest's chat line goes STRAIGHT to the host, which relays it to the room.
 * A message sent straight to the host keeps whatever _fromClient its sender
 * wrote (only relayed ones are re-stamped), and the panel named the author
 * from `_fromClient || name` and rendered `name`, both of which the sender
 * writes. So:
 *
 *  - control: Odell's real line reaches Priya under "Odell";
 *  - Odell sends a line naming Mara (in `name` and `_fromClient`): Priya must
 *    not see it under "Mara" (it may arrive, but as Odell's);
 *  - the host mutes Odell (the panel's isMuted hook, set here as a game would);
 *    control: his real line no longer reaches Priya;
 *  - and he cannot dodge the mute by naming Priya: the line reaches nobody.
 *
 * CHAT_PANEL_FILE=<path> serves that chat-panel.js in place of the deployed
 * one, to prove a fix before it ships.
 *
 * Channels are 'bpchat<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^bpchat[0-9]+' --yes
 */
const path = require('path');
const { chromium } = require('playwright');
const { BASE, LAUNCH, results } = require('../lib/harness');
const { joinOne, sleep, waitFor, val, closeAll } = require('../lib/party-room');

const r = results();
const ROOM = 'bpchat' + Math.floor(Date.now() / 1000);
const APPS = (process.env.APPS_BASE_URL || new URL('../apps', BASE + '/').href).replace(/\/$/, '');
const PLAY = APPS + '/blockparty/play.html';
const GAME = 'blockPartyGame';
const LOCAL = process.env.CHAT_PANEL_FILE ? path.resolve(process.env.CHAT_PANEL_FILE) : null;

const prepare = LOCAL && ((ctx) => ctx.route('**/sdk/js/chat-panel.js',
    (route) => route.fulfill({ path: LOCAL, contentType: 'application/javascript' })));

/** Every line on a client's chat log, as "who|text". */
const lines = (c) => c.page.evaluate(() => [...document.querySelectorAll('.chat-panel .chat-line')]
    .map((l) => (l.querySelector('.chat-who')?.textContent || '') + '|' + (l.querySelector('.chat-text')?.textContent || '')));

const hasLine = async (c, text) => (await lines(c)).find((l) => l.endsWith('|' + text)) || null;

/** Odell's line, sent the way the panel sends it, but carrying a name that is not his. */
const forge = (odell, as, text) => val(odell,
    `game.sendData({ type: 'chat', name: ${JSON.stringify(as)}, _fromClient: ${JSON.stringify(as)}, text: ${JSON.stringify(text)} }, 'Mara')`);

async function forgedName(odell, priya) {
    await val(odell, "game.chat.send('real line from odell')");
    r.check(await waitFor(async () => (await hasLine(priya, 'real line from odell')) === 'Odell|real line from odell', 15000, 'control line'),
        "control: Odell's real line reaches Priya under his name");

    await forge(odell, 'Mara', 'forged as mara');
    await sleep(3500);
    const seen = await hasLine(priya, 'forged as mara');
    r.check(!seen || !seen.startsWith('Mara|'), `Odell's line naming Mara is not shown under Mara on Priya's screen (${seen})`);
}

async function forgedMute(mara, odell, priya) {
    await val(mara, "(game.chat.opts.isMuted = (n) => n === 'Odell', true)");
    await val(odell, "game.chat.send('muted real line')");
    await sleep(3500);
    r.check(!(await hasLine(priya, 'muted real line')), "control: muted, Odell's real line does not reach Priya");

    await forge(odell, 'Priya', 'dodged the mute');
    await sleep(3500);
    const onMara = await hasLine(mara, 'dodged the mute');
    const onPriya = await hasLine(priya, 'dodged the mute');
    r.check(!onMara && !onPriya, `naming Priya does not get a muted Odell's line through (host: ${onMara}, Priya: ${onPriya})`);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    let clients = [];
    try {
        console.log('chat-panel.js: ' + (LOCAL || 'deployed'));
        for (const name of ['Mara', 'Odell', 'Priya']) {
            clients.push(await joinOne(b, PLAY, GAME, ROOM, name, 'pw12345', prepare));
            await sleep(2500);
        }
        const [mara, odell, priya] = clients;
        r.check(clients.every((c) => c.connected), 'all three connected');
        r.check(await waitFor(() => val(mara, 'game.isHost()'), 15000, 'host'), 'Mara, first in, is the host');
        await sleep(4000);   // data channels to the host
        await forgedName(odell, priya);
        await forgedMute(mara, odell, priya);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    const errors = clients.flatMap((c) => c.errors.filter((e) => e.startsWith('pageerror')).map((e) => c.name + ': ' + e));
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await closeAll(clients);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
