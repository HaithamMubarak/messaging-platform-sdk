/*
 * Does a brokered temp key survive a RECONNECT?
 *
 * An open socket appears not to be re-authenticated per frame — a 900s
 * key kept a session working past its own expiry. Reconnect is the
 * different question: if the SDK re-presents the key when the socket
 * comes back, an expired key means the peer silently never returns.
 * That decides whether a refresh-before-reconnect step is required.
 */
const { chromium } = require('playwright');
const https = require('https');

const API = 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service';
const APP = 'https://hmdevonline.com/messaging-platform/apps/rooms';
const REAL_KEY = '38d66874-2b47-4aaf-b9dc-ab0a79f56faf';
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

function mint(ttl) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ ttlSeconds: ttl, singleUse: false });
        const req = https.request(API + '/channels/api-access', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': REAL_KEY, 'Content-Length': body.length } },
            (res) => { let d = ''; res.on('data', c => d += c);
                res.on('end', () => { try { resolve(JSON.parse(d).data.temporaryKey); } catch (e) { reject(new Error(d.slice(0,150))); } }); });
        req.on('error', reject); req.write(body); req.end();
    });
}

(async () => {
    // A SHORT key on purpose: it will be dead well before the reconnect.
    const TTL = 60;
    const key = await mint(TTL);
    console.log(`minted a ${TTL}s temp key — it will be expired at reconnect time`);

    const browser = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    async function open() {
        const ctx = await browser.newContext();
        await ctx.addInitScript((k) => {
            Object.defineProperty(window, 'ROOMS_CONFIG', { configurable: true,
                set(v) { v.apiKey = k; delete window.ROOMS_CONFIG; window.ROOMS_CONFIG = v; },
                get() { return undefined; } });
        }, key);
        return (await ctx.newPage());
    }

    const tutor = await open();
    await tutor.goto(`${APP}/app.html`, { waitUntil: 'domcontentloaded' });
    await tutor.click('#tabRegister');
    await tutor.fill('#aName', 'Recon');
    await tutor.fill('#aEmail', `recon${Date.now()}@example.com`);
    await tutor.fill('#aPass', 'correct horse battery');
    await tutor.click('#btnAuth');
    await tutor.waitForSelector('#listGate:not([hidden])', { timeout: 40000 });
    await tutor.fill('#newTitle', 'Reconnect Room');
    await tutor.click('#btnNewRoom');
    await tutor.waitForSelector('.ck-room', { timeout: 30000 });
    await tutor.evaluate(() => [...document.querySelectorAll('.ck-room__acts .ck-btn')]
        .find(b => /Open/.test(b.textContent)).click());
    await tutor.waitForFunction(() => window.CK && window.CK.lesson && window.CK.lesson.conn, { timeout: 45000 });

    const link = await tutor.evaluate(() => location.origin + location.pathname
        + '#j=' + encodeURIComponent(window.CK.lesson.code) + '&k=' + encodeURIComponent(window.__pass || ''));

    const student = await open();
    await student.goto(link, { waitUntil: 'domcontentloaded' });
    await student.waitForSelector('#joinGate:not([hidden])', { timeout: 30000 });
    await student.fill('#fName', 'Pupil');
    await student.click('#btnJoin');
    await student.waitForFunction(() => window.CK && window.CK.lesson && window.CK.lesson.conn, { timeout: 45000 });
    await tutor.waitForTimeout(6000);
    check(await tutor.evaluate(() => window.CK.lesson.list().length >= 2), 'connected on a 60s temp key');

    // Let the key die.
    console.log('waiting 90s for the key to expire…');
    await tutor.waitForTimeout(90000);

    await tutor.bringToFront();
    await tutor.evaluate(() => window.CK.chans.say('before the drop'));
    await student.bringToFront();
    await student.waitForTimeout(5000);
    check(await student.evaluate(() => (window.CK.chans.log.general || []).some(e => e.text === 'before the drop')),
        'the open socket still delivers after the key has expired');

    // Now force a reconnect by taking the network away and giving it back.
    console.log('dropping the network to force a reconnect…');
    await student.context().setOffline(true);
    await student.waitForTimeout(12000);
    await student.context().setOffline(false);
    await student.waitForTimeout(25000);

    await tutor.bringToFront();
    await tutor.evaluate(() => window.CK.chans.say('after the drop'));
    await student.bringToFront();
    await student.waitForTimeout(12000);

    const back = await student.evaluate(() => (window.CK.chans.log.general || []).some(e => e.text === 'after the drop'));
    check(back, back
        ? 'a peer reconnects and receives again even though its key has expired'
        : 'a peer that reconnects on an EXPIRED key does NOT come back — refresh-before-reconnect is required');

    console.log('\nPASS (' + pass.length + ')'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(f => console.log('  ✗ ' + f));
    await browser.close();
    process.exit(0);
})().catch(e => { console.error('CRASHED', e.message); process.exit(2); });
