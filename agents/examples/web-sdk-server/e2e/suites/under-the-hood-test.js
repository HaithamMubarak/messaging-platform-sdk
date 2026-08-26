/**
 * Under the Hood: does the instrument panel actually read the machinery?
 *
 * The claim is that everything shown is read from the same SDK an app uses, so
 * the test checks the readings agree with reality: two tabs see each other, both
 * name the SAME host (independently — that is what election means), the topology
 * is drawn, and making the host leave produces a new one.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function open(b, room, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 80)}`));
    await p.goto(BASE + '/apps/under-the-hood/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.underTheHood && window.underTheHood.connected, { timeout: 45000 })
        .catch(() => {});
    await p.waitForTimeout(3500);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const room = 'uh' + Math.floor(Date.now() / 1000);
    const first = await open(b, room, 'Alpha');
    const second = await open(b, room, 'Beta');
    await first.waitForTimeout(5000);

    check(await first.evaluate(() => !!window.underTheHood), 'the panel starts');

    const counts = await Promise.all([
        first.evaluate(() => window.underTheHood.getConnectedUsers().length),
        second.evaluate(() => window.underTheHood.getConnectedUsers().length)
    ]);
    check(counts[0] === 2 && counts[1] === 2, `both tabs see two people (${counts.join(', ')})`);

    // Election means everyone independently arrives at the same answer.
    const hosts = await Promise.all([
        first.evaluate(() => window.underTheHood._getHostName()),
        second.evaluate(() => window.underTheHood._getHostName())
    ]);
    check(hosts[0] && hosts[0] === hosts[1],
        `both tabs independently name the same host (${JSON.stringify(hosts)})`);

    const hostFlags = await Promise.all([
        first.evaluate(() => window.underTheHood.isHost()),
        second.evaluate(() => window.underTheHood.isHost())
    ]);
    check(hostFlags.filter(Boolean).length === 1,
        `exactly one tab believes it is the host (${JSON.stringify(hostFlags)})`);

    // The roster and diagram are rendered, not just computed.
    const rosterNames = await first.evaluate(() =>
        Array.from(document.querySelectorAll('.hood-peer__name')).map(n => n.textContent));
    check(rosterNames.includes('Alpha') && rosterNames.includes('Beta'),
        `the roster lists both by name (${JSON.stringify(rosterNames)})`);

    const nodes = await first.evaluate(() => document.querySelectorAll('#topology .hood-node').length);
    check(nodes === 2, `the topology draws a node per peer (${nodes})`);

    const note = await first.evaluate(() => document.getElementById('topologyNote').textContent);
    check(/star|mesh/i.test(note), `and says which shape it is (${note})`);

    // A message shows up in the log on the other side.
    await first.evaluate(() => window.underTheHood.ping());
    await second.waitForTimeout(3000);
    const logged = await second.evaluate(() =>
        (document.getElementById('log').innerText || '').includes('ping'));
    check(logged, 'a ping from one tab appears in the other tab\'s log');

    // ---- the point of the app: watch an election happen --------------------
    const hostWas = hosts[0];
    const hostPage = hostFlags[0] ? first : second;
    const survivor = hostFlags[0] ? second : first;

    await hostPage.evaluate(() => window.underTheHood.stepAside());
    await survivor.waitForTimeout(14000);

    const hostNow = await survivor.evaluate(() => window.underTheHood._getHostName());
    const survivorIsHost = await survivor.evaluate(() => window.underTheHood.isHost());
    check(hostNow !== hostWas || survivorIsHost,
        `the host stepping aside produces a new one (${hostWas} -> ${hostNow}, survivor host: ${survivorIsHost})`);

    await survivor.screenshot({ path: SHOTS + '/under-the-hood.png' });
    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
