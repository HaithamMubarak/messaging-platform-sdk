/**
 * Three real clients in one room of a host-refereed game, for the suites that
 * ask what one player can see or do to another (gavel-test, host-forgery-test,
 * vote-privacy-test). They each carried a copy of this; now they share one.
 *
 * Every client gets a wire spy: `game.__seen` records the sender and type of
 * each data-channel message, so a suite can ask who heard what.
 */
const { BASE, gotoStable, waitForService } = require('./harness');

const NAMES = ['Mara', 'Odell', 'Priya'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if (await fn()) return true; } catch (_) {}
        await sleep(250);
    }
    console.log(`  (timed out waiting for ${label})`);
    return false;
}

/** Record every data-channel message this client's game receives. */
function installSpy(globalName) {
    const game = window[globalName];
    if (!game || game.__spied) return;
    game.__spied = true;
    game.__seen = [];
    const orig = game.onDataChannelMessage.bind(game);
    game.onDataChannelMessage = function (peerId, data) {
        try { game.__seen.push({ from: peerId, t: data && (data.t || data.type) }); } catch (_) {}
        return orig(peerId, data);
    };
}

/**
 * A game with a party lobby (js/party-lobby.js) covers the channel form with
 * "Start a party / Join with a code". The suites need a named room, so they take
 * the lobby's own "Advanced" door to the form, as a person would.
 */
async function useChannelForm(page) {
    const advanced = page.locator('#partyLobby .pl-link', { hasText: 'Advanced' });
    if (await advanced.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
        await advanced.click();
    }
}

async function joinOne(browser, path, globalName, room, name, pass) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    // One retry: a restart between two clients joining is common on a shared box.
    try {
        await gotoStable(page, `${BASE}${path}?debug`, { waitUntil: 'domcontentloaded' });
    } catch (_) {
        await waitForService();
        await gotoStable(page, `${BASE}${path}?debug`, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForSelector('#connectionModal.active', { timeout: 30000 });
    await useChannelForm(page);
    await page.evaluate(() => document.getElementById('tabCustom')?.click());
    await page.fill('#usernameInput', name);
    await page.fill('#channelInput', room);
    await page.fill('#passwordInput', pass);
    await page.click('#connectBtn');

    const connected = await waitFor(async () =>
        !(await page.evaluate(() => document.getElementById('connectionModal')?.classList.contains('active'))),
        45000, `${name} to connect`);
    await page.evaluate(installSpy, globalName);
    return { name, page, ctx, errors, connected, g: globalName };
}

/** Mara, Odell and Priya, in that order, so Mara is the host. */
async function openRoom(browser, path, globalName, room) {
    const pass = 'e2e-pass-' + Math.random().toString(36).slice(2, 8);
    const clients = [];
    for (const name of NAMES) {
        clients.push(await joinOne(browser, path, globalName, room, name, pass));
        await sleep(2200);
    }
    return clients;
}

/** Evaluate `expr` in a client's page with `game` bound to its global. */
const val = (c, expr) => c.page.evaluate(
    new Function('g', `const game = window["${c.g}"]; return (${expr});`), c.g);

async function closeAll(clients) {
    for (const c of clients) { try { await c.ctx.close(); } catch (_) {} }
}

module.exports = { NAMES, sleep, waitFor, openRoom, joinOne, val, closeAll, useChannelForm };
