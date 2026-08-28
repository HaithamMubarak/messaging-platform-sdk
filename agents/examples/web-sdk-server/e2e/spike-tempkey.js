/*
 * STEP 0 SPIKE — go/no-go on brokered credentials.
 *
 * Drives a real Rooms session using a TEMPORARY key instead of the
 * hardcoded public one, and then holds the session open past the point
 * where a short-lived key would have expired. If the SDK cannot survive
 * on a temp key, the whole brokering design is wrong and no code should
 * be written against it.
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
        const req = https.request(API + '/channels/api-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': REAL_KEY, 'Content-Length': body.length },
        }, (res) => {
            let d = '';
            res.on('data', (c) => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d).data.temporaryKey); } catch (e) { reject(new Error(d.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

(async () => {
    const TTL = Number(process.env.SPIKE_TTL || 900);
    const HOLD_MS = Number(process.env.SPIKE_HOLD_MS || 16 * 60 * 1000);

    /*
     * CONTROL. Running the identical hold test on the real key is the only way
     * to know whether a failure belongs to brokering or to something else in
     * the app. Without it, "delivery stopped at 3m" reads as a verdict on temp
     * keys when it may be nothing of the sort.
     */
    const useReal = process.env.SPIKE_KEY === 'real';
    const tempKey = useReal ? REAL_KEY : await mint(TTL);
    console.log(useReal
        ? 'CONTROL RUN — using the real long-lived key'
        : 'minted temp key, ttl=' + TTL + 's');

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
            // Chromium throttles setInterval in a background tab to about once
            // a minute. Rooms heartbeats presence every 7s against a 25s TTL,
            // so a backgrounded peer is reaped by everyone else — which looks
            // exactly like the channel dying. These flags isolate the app's
            // behaviour from the browser's power saving.
            .concat(process.env.SPIKE_NOTHROTTLE === '1'
                ? ['--disable-background-timer-throttling',
                   '--disable-backgrounding-occluded-windows',
                   '--disable-renderer-backgrounding']
                : []),
    });

    // Swap the hardcoded key for the temp key BEFORE any app script runs.
    async function open(name) {
        const ctx = await browser.newContext();
        await ctx.addInitScript((k) => {
            Object.defineProperty(window, 'ROOMS_CONFIG', {
                configurable: true,
                set(v) { v.apiKey = k; delete window.ROOMS_CONFIG; window.ROOMS_CONFIG = v; },
                get() { return undefined; },
            });
        }, tempKey);
        const p = await ctx.newPage();
        p.on('pageerror', (e) => check(false, `${name} threw — ${e.message.slice(0, 80)}`));
        return p;
    }

    // A tutor with an account, using the temp key for the platform.
    const tutor = await open('tutor');
    await tutor.goto(`${APP}/app.html`, { waitUntil: 'domcontentloaded' });
    check(await tutor.evaluate((k) => window.ROOMS_CONFIG.apiKey === k, tempKey),
        useReal ? 'control: running on the real key' : 'the app is running on the temporary key');

    await tutor.click('#tabRegister');
    await tutor.fill('#aName', 'Spike');
    await tutor.fill('#aEmail', `spike${Date.now()}@example.com`);
    await tutor.fill('#aPass', 'correct horse battery');
    await tutor.click('#btnAuth');
    await tutor.waitForSelector('#listGate:not([hidden])', { timeout: 40000 });
    await tutor.fill('#newTitle', 'Spike Room');
    await tutor.click('#btnNewRoom');
    await tutor.waitForSelector('.ck-room', { timeout: 30000 });
    await tutor.evaluate(() => {
        [...document.querySelectorAll('.ck-room__acts .ck-btn')].find((b) => /Open/.test(b.textContent)).click();
    });
    await tutor.waitForFunction(() => window.CK && window.CK.lesson && window.CK.lesson.conn, { timeout: 45000 });
    check(true, 'a channel connects on a temporary key');

    const link = await tutor.evaluate(() => location.origin + location.pathname
        + '#j=' + encodeURIComponent(window.CK.lesson.code) + '&k=' + encodeURIComponent(window.__pass || ''));

    const student = await open('student');
    await student.goto(link, { waitUntil: 'domcontentloaded' });
    await student.waitForSelector('#joinGate:not([hidden])', { timeout: 30000 });
    await student.fill('#fName', 'Pupil');
    await student.click('#btnJoin');
    await student.waitForFunction(() => window.CK && window.CK.lesson && window.CK.lesson.conn, { timeout: 45000 });
    await tutor.waitForTimeout(7000);
    check(await tutor.evaluate(() => window.CK.lesson.list().length >= 2),
        'two peers see each other on temporary keys');

    // ---- the actual question: does it survive past the TTL? -------------
    const started = Date.now();
    console.log(`holding the session for ${Math.round(HOLD_MS / 60000)} minutes (ttl was ${TTL}s)…`);
    let firstFailureAt = null;
    while (Date.now() - started < HOLD_MS) {
        await tutor.waitForTimeout(60000);
        const mins = Math.round((Date.now() - started) / 60000);
        const stamp = 'still here at ' + mins + 'm';
        await tutor.bringToFront();
        await tutor.evaluate((t) => window.CK.chans.say(t), stamp);
        // Bring the receiver to the front before reading. Chromium throttles
        // timers and sockets hard in a background tab, so a receiver that is
        // never focused stops polling — which looks exactly like the channel
        // dying and is purely an artefact of the harness.
        await student.bringToFront();
        await student.waitForTimeout(5000);
        const got = await student.evaluate((t) => (window.CK.chans.log.general || []).some((e) => e.text === t), stamp);
        const diag = await student.evaluate(() => {
            const c = window.CK.lesson.conn || {};
            return {
                connected: !!c.connected,
                agents: (window.CK.lesson.list() || []).length,
                seen: (window.CK.seen || []).length,
                senderOwnLog: (window.CK.chans.log.general || []).length,
            };
        });
        const sender = await tutor.evaluate(() => ({
            connected: !!(window.CK.lesson.conn || {}).connected,
            agents: (window.CK.lesson.list() || []).length,
            ownLog: (window.CK.chans.log.general || []).length,
        }));
        console.log(`  ${mins}m — delivered:${got}  tutor{conn:${sender.connected},peers:${sender.agents},log:${sender.ownLog}}  student{conn:${diag.connected},peers:${diag.agents},msgs:${diag.seen},log:${diag.senderOwnLog}}`);
        if (!got && firstFailureAt === null) firstFailureAt = mins;
    }

    const what = useReal ? 'the real key' : 'a temp key';
    check(firstFailureAt === null,
        firstFailureAt === null
            ? `the session kept working for ${Math.round(HOLD_MS / 60000)}m on ${what}`
            : `delivery stopped at ${firstFailureAt}m on ${what}`);

    console.log('\nPASS (' + pass.length + ')'); pass.forEach((p) => console.log('  ✓ ' + p));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach((f) => console.log('  ✗ ' + f));
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('CRASHED', e); process.exit(2); });
