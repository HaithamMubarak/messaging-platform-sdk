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
    await p.waitForSelector('#usernameInput', { state: 'attached', timeout: 45000 });
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
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
    let soloRoom = '';
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

    // A message shows up in the log on the other side, and is drawn travelling.
    await second.evaluate(() => {
        window.__packets = 0;
        new MutationObserver((ms) => ms.forEach((m) => { window.__packets += m.addedNodes.length; }))
            .observe(document.getElementById('packets'), { childList: true });
    });
    await first.evaluate(() => window.underTheHood.ping());
    await second.waitForTimeout(3000);
    const logged = await second.evaluate(() =>
        (document.getElementById('log').innerText || '').includes('ping'));
    check(logged, 'a ping from one tab appears in the other tab\'s log');
    check(await second.evaluate(() => window.__packets) > 0, 'and flies across the other tab\'s map as a packet');

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

    // The survivor is usually the new host itself ("You have the crown now").
    check(await survivor.evaluate(() => /(has|have) the crown now/.test(document.getElementById('log').innerText)),
        'the survivor\'s timeline says who has the crown now');
    check(await survivor.evaluate(() => !document.getElementById('stepAsideBtn').disabled), 'and its Pass the crown button is live');

    // ---- rejoin: back in, at the back of the line ----------------------------
    check(await hostPage.isVisible('#rejoinBtn'), 'the tab that stepped aside is offered Rejoin');
    // A real click: the join form common-utils re-opens on disconnect must not cover it.
    const pressed = await hostPage.click('#rejoinBtn', { timeout: 10000 }).then(() => true, () => false);
    check(pressed, 'and can press it: the join form is not covering the page');
    await hostPage.waitForFunction(() => window.underTheHood.connected, null, { timeout: 45000 }).catch(() => {});
    await hostPage.waitForTimeout(5000);
    const after = await hostPage.evaluate(() => ({ users: window.underTheHood.getConnectedUsers().length,
        host: window.underTheHood._getHostName(), mine: window.underTheHood.isHost(),
        guestCanPass: !document.getElementById('stepAsideBtn').disabled }));
    check(after.users === 2 && !after.mine && after.host === hostNow,
        `Rejoin puts it back in the room behind the new host (${JSON.stringify(after)})`);
    check(!after.guestCanPass, 'and a guest cannot pass a crown it does not hold');

    // ---- one person, two tabs -------------------------------------------------
    // These tabs joined by name, so there is no code to open: the page says so.
    await survivor.click('#anotherTabBtn');
    check(/no code/.test(await survivor.evaluate(() => document.getElementById('sideHint').textContent)),
        'a room joined by name explains why it has no tab to open');
    const lobbyCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const solo = await lobbyCtx.newPage();
    await solo.goto(BASE + '/apps/under-the-hood/app.html', { waitUntil: 'load' });
    await solo.waitForSelector('#partyLobby:not(.pl-loading)');
    await solo.click('#partyLobby .pl-btn--primary');
    await solo.waitForFunction(() => window.underTheHood && window.underTheHood.connected, null, { timeout: 45000 }).catch(() => {});
    const opened = await solo.evaluate(() => {
        let url = null;
        window.open = (u) => { url = u; return null; };
        document.getElementById('anotherTabBtn').click();
        return url;
    });
    check(/\?code=\d{12}&newname=1$/.test(opened || ''), `a code room opens its own code in a new tab, under a new name (${opened})`);
    soloRoom = await solo.evaluate(() => window.underTheHood.channelName);
    await lobbyCtx.close();

    await survivor.screenshot({ path: SHOTS + '/under-the-hood.png' });
    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    console.log('rooms: ' + room + ' ' + soloRoom);
    process.exitCode = fail.length ? 1 : 0;   // exit() would drop buffered stdout
})();
