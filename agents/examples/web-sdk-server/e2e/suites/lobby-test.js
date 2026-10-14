/**
 * The party lobby (js/party-lobby.js): the first screen of every demo.
 *
 * Asks of each demo, on a laptop and a phone: is the lobby shown once its
 * stylesheet is in; does it carry the demo's picture and what it teaches (read
 * from data/catalogue.json); is the main button on screen and focused; does the
 * host page leave it alone (the whiteboard is light, chat centres its text);
 * no sideways overflow, no tap target under 32px, no page errors. Then that
 * both other ways in still work: "Advanced", and typing into the form under it,
 * which is how every other suite here reaches the channel form.
 *
 * With LOBBY_JOIN=1 it also joins two real rooms (Pulse through the modal,
 * Chat through its own form) and goes back to the first. Those make channels
 * under the demo key: clean them with
 *   scripts/cleanup_channels.py --prefix '^(pulse|chat)-\d{6}(\.pulse)?$' --yes
 */
const { BASE, SHOTS, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const path = require('path');

const PAGES = {
    chat: 'chat.html', hood: 'under-the-hood/app.html', pulse: 'pulse/index.html', whiteboard: 'whiteboard/app.html',
    evidence: 'evidence-chain/app.html', drop: 'drop/index.html', call: 'call/index.html',
    hockey: 'mini-games/air-hockey/index.html', gavel: 'mini-games/gavel/index.html', chess: 'chess/index.html'
};
const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 375, height: 812 } };
// The lobby's own palette and alignment: what a host page's rules must not change.
const OWN_LOOK = 'rgb(238, 242, 248) / rgb(45, 212, 191) / rgb(16, 24, 39) / left';
const r = results();

async function open(browser, size, page) {
    const ctx = await browser.newContext({ viewport: SIZES[size] });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/' + page, { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(800);   // the catalogue fetch fills the picture and footer
    return { ctx, p, errors };
}

function measure() {
    const o = document.getElementById('partyLobby');
    if (!o) return null;
    const primary = o.querySelector('.pl-btn--primary');
    const img = o.querySelector('.pl-preview__img');
    const title = o.querySelector('.pl-title');
    return {
        shown: !o.classList.contains('pl-loading'), primary: primary.textContent,
        primaryBottom: primary.getBoundingClientRect().bottom, vh: innerHeight,
        img: !!(img && img.complete && img.naturalWidth), teach: !o.querySelector('.pl-teach').hidden,
        focus: document.activeElement === primary,
        over: Math.max(document.documentElement.scrollWidth - innerWidth, o.scrollWidth - o.clientWidth),
        small: [...o.querySelectorAll('button, a, input')].filter((e) => {
            const b = e.getBoundingClientRect(); return b.width && (b.height < 32 || b.width < 32);
        }).length,
        look: [getComputedStyle(title).color, getComputedStyle(primary).backgroundColor,
            getComputedStyle(o.querySelector('.pl-card')).backgroundColor, getComputedStyle(title).textAlign].join(' / ')
    };
}

async function layout(browser, name, size) {
    const { ctx, p, errors } = await open(browser, size, PAGES[name]);
    const m = await p.evaluate(measure);
    const tag = name + ' @' + size + ': ';
    r.check(!!m && m.shown, tag + 'lobby shown once its stylesheet is in');
    if (m) {
        r.check(m.img && m.teach, tag + 'picture and "what this demo teaches" from the catalogue');
        r.check(m.look === OWN_LOOK, tag + 'the host page does not restyle it (' + m.look + ')');
        r.check(m.primaryBottom <= m.vh && m.focus, tag + '"' + m.primary + '" on screen and focused');
        r.check(m.over <= 0 && m.small === 0, tag + 'no overflow (' + m.over + 'px), no small targets (' + m.small + ')');
    }
    r.check(errors.length === 0, tag + 'no page errors ' + errors.slice(0, 2).join(' | '));
    await p.screenshot({ path: path.join(SHOTS, 'lobby-' + name + '-' + size + '.png') });
    await ctx.close();
}

/** "Advanced" opens the form; typing into the form underneath, as the suites do, steps the lobby aside. */
async function doors(browser, name) {
    const chat = name === 'chat';
    let { ctx, p } = await open(browser, 'desktop', PAGES[name]);
    await p.click('#partyLobby .pl-link');
    r.check(!(await p.$('#partyLobby')) && await p.isVisible(chat ? '#sidebar-details' : '#connectionModal'),
        name + ': Advanced closes the lobby and shows the form');
    await ctx.close();
    ({ ctx, p } = await open(browser, 'desktop', PAGES[name]));
    await p.evaluate(() => document.getElementById('tabCustom') && document.getElementById('tabCustom').click());
    await p.fill(chat ? '#channelName' : '#channelInput', 'lobby-typed');
    r.check(!(await p.$('#partyLobby')), name + ': typing into the form underneath steps the lobby aside');
    await ctx.close();
}

const modalClosed = () => !document.getElementById('connectionModal').classList.contains('active');

async function joinPulse(browser) {
    const { ctx, p } = await open(browser, 'desktop', PAGES.pulse);
    await p.click('#partyLobby .pl-btn--primary');
    await p.waitForFunction(modalClosed, null, { timeout: 30000 }).catch(() => {});
    // The modal records the room and shows its code on its next 300 ms poll after closing.
    await p.waitForSelector('#partyCodeChip', { timeout: 5000 }).catch(() => {});
    const room = await p.evaluate(() => document.getElementById('channelInput').value);
    r.check(await p.isVisible('#partyCodeChip'), 'pulse: Start a poll joins a room and shows its code (' + room + ')');
    await p.goto(BASE + '/apps/' + PAGES.pulse, { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)');
    r.check(await p.isVisible('.pl-btn--resume'), 'pulse: a returning visitor is offered their last room');
    await p.click('.pl-btn--resume');
    await p.waitForFunction(modalClosed, null, { timeout: 30000 }).catch(() => {});
    r.check(await p.evaluate(modalClosed) && room === await p.evaluate(() => document.getElementById('channelInput').value),
        'pulse: "Back to your last room" rejoins it');
    await ctx.close();
}

async function joinChat(browser) {
    const { ctx, p } = await open(browser, 'desktop', PAGES.chat);
    await p.click('#partyLobby .pl-btn--primary');
    await p.waitForFunction(() => !document.getElementById('close').disabled, null, { timeout: 30000 }).catch(() => {});
    await p.waitForSelector('#partyChip', { timeout: 5000 }).catch(() => {});
    r.check(await p.evaluate(() => !document.getElementById('close').disabled) && await p.isVisible('#partyChip'),
        'chat: Start a chat connects through chat.html\'s own form and shows the code');
    await ctx.close();
}

/**
 * The waiting room, after "Play now": the code, the link, a QR, who is here
 * (live), the demo's way to play alone, and "Start playing". Only for the one
 * who started the room; a friend joining with the code goes straight in.
 */
async function waitingRoom(browser) {
    const host = await open(browser, 'desktop', PAGES.hockey);
    await host.p.click('#partyLobby .pl-btn--primary');
    await host.p.waitForSelector('#plWaiting', { timeout: 30000 }).catch(() => {});
    const shown = await host.p.evaluate(() => {
        const w = document.getElementById('plWaiting');
        const code = new URLSearchParams(location.search).get('code');
        return w && { code, groups: [...w.querySelectorAll('.pl-wait__group')].map((g) => g.textContent).join(''),
            qr: !!w.querySelector('.pl-wait__qr canvas, .pl-wait__qr img'), seats: w.querySelectorAll('.pl-wait__seat').length };
    });
    r.check(!!shown && shown.groups === shown.code && shown.qr && shown.seats === 1,
        'Play now opens the waiting room: the room\'s code, a QR, and an empty seat ' + JSON.stringify(shown));

    const friend = await open(browser, 'desktop', PAGES.hockey + '?code=' + (shown && shown.code));
    await friend.p.click('#partyLobby .pl-btn--quiet');   // Join, the code already in the box
    const arrived = await host.p.waitForFunction(() => document.querySelectorAll('#plWaiting .pl-wait__person').length >= 2,
        null, { timeout: 30000 }).then(() => true, () => false);
    r.check(arrived, 'a friend joining with the code appears in the host\'s "who is here", live');
    await friend.p.waitForTimeout(1500);
    r.check(!(await friend.p.$('#plWaiting')), 'and the friend, who joined, gets no waiting room');

    await host.p.click('#plWaiting .pl-btn:has-text("Add a bot")');
    await host.p.waitForTimeout(800);
    r.check(await host.p.evaluate(() => !!window.airHockeyGame.players.get('Bot Barry')), 'Air Hockey\'s "Add a bot" works from the waiting room');
    await host.p.click('#plWaiting .pl-btn:has-text("Start playing")');
    r.check(!(await host.p.$('#plWaiting')), '"Start playing" puts the waiting room away');
    await friend.ctx.close();
    await host.ctx.close();

    const solo = await open(browser, 'desktop', PAGES.pulse);
    await solo.p.click('#partyLobby .pl-btn--primary');
    await solo.p.waitForTimeout(6000);
    r.check(!(await solo.p.$('#plWaiting')), 'a demo played alone (Pulse) opens straight into the app');
    await solo.ctx.close();
}

(async () => {
    const browser = await chromium.launch(LAUNCH);
    for (const name of Object.keys(PAGES)) for (const size of Object.keys(SIZES)) await layout(browser, name, size);
    for (const name of ['chat', 'pulse', 'hockey']) await doors(browser, name);
    if (process.env.LOBBY_JOIN) { await joinPulse(browser); await joinChat(browser); await waitingRoom(browser); }
    await browser.close();
    process.exitCode = r.report() ? 1 : 0;
})();
