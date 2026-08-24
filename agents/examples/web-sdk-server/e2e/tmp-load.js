const { BASE } = require('./lib/harness');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
  for (const [name, path] of [
      ['fall-guys',    'mini-games/fall-guys/index.html'],
      ['party-physics','mini-games/party-physics/index.html'],
      ['race-balls',   'mini-games/race-balls/index.html'],
      ['blockparty',   'mini-games/blockparty/play.html']]) {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
      const t0 = Date.now();
      let ok = true;
      try {
        await p.goto(BASE + '/apps/' + path, { waitUntil: 'domcontentloaded', timeout: 40000 });
        await p.waitForSelector('#usernameInput', { timeout: 40000, state: 'attached' });
        await p.waitForSelector('#connectBtn', { timeout: 40000 });
      } catch (e) { ok = false; }
      times.push(ok ? Date.now() - t0 : -1);
      await p.close();
    }
    const good = times.filter(t => t > 0);
    console.log(`${name.padEnd(15)} to a usable connect button: ${times.map(t => t < 0 ? 'FAILED' : (t/1000).toFixed(1)+'s').join(', ')}` +
      (good.length ? `   worst ${(Math.max(...good)/1000).toFixed(1)}s` : ''));
  }
  await b.close();
})();
