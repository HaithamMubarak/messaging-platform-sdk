/**
 * Dead Drop: the only app here that works with nobody else online.
 *
 * The claim is specific — leave something, close the tab entirely, and somebody
 * opening the same link later finds it. So the test does exactly that: the
 * first browser context is destroyed before the second one is created, which
 * means no peer, no relay, and nothing in memory. If it comes back, it came
 * back out of channel storage.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function open(b, room, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 80)}`));
    await p.goto(BASE + '/apps/dead-drop/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.deadDropApp && window.deadDropApp.connected, { timeout: 45000 })
        .catch(() => {});
    await p.waitForTimeout(3500);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const room = 'dd' + Math.floor(Date.now() / 1000);
    const NOTE = 'the key is under the third flowerpot';

    // ---- leave something, then leave entirely ------------------------------
    const first = await open(b, room, 'Leaver');
    check(await first.evaluate(() => !!window.deadDropApp), 'the app starts');

    await first.fill('#noteText', NOTE);
    await first.click('#leaveBtn');
    await first.waitForTimeout(4000);

    const leftCount = await first.evaluate(() => window.deadDropApp.drops.length);
    check(leftCount === 1, `the drop is in the box (${leftCount})`);
    await first.context().close();     // nobody is online now

    // ---- somebody else opens the same link ---------------------------------
    const second = await open(b, room, 'Collector');
    await second.waitForTimeout(3000);

    const found = await second.evaluate(() => window.deadDropApp.drops.map(d => d.text));
    check(found.length === 1 && found[0] === NOTE,
        `it is there for somebody arriving later with nobody else online (${JSON.stringify(found)})`);

    const shown = await second.evaluate(() =>
        (document.getElementById('drops').innerText || '').includes('flowerpot'));
    check(shown, 'and it is rendered, not just held in memory');

    // ---- read-once leaves a receipt rather than the contents ---------------
    await second.fill('#noteText', 'this one is read once');
    await second.check('#readOnce');
    await second.click('#leaveBtn');
    await second.waitForTimeout(4000);

    const onceId = await second.evaluate(() => {
        const d = window.deadDropApp.drops.find(x => x.readOnce);
        return d ? d.id : null;
    });
    check(!!onceId, 'a read-once drop can be left');

    await second.evaluate((id) => window.deadDropApp.collect(id), onceId);
    await second.waitForTimeout(4000);

    const tomb = await second.evaluate((id) => {
        const d = window.deadDropApp.drops.find(x => x.id === id);
        return d ? { by: d.collectedBy, stillHasText: !!d.text } : null;
    }, onceId);
    check(tomb && tomb.by === 'Collector',
        `collecting records who took it (${tomb && tomb.by})`);

    const hidden = await second.evaluate(() =>
        !(document.getElementById('drops').innerText || '').includes('this one is read once'));
    check(hidden, 'and a collected read-once drop no longer shows its contents');

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
