/**
 * Does the work survive an empty room?
 *
 * collab-doc kept its state only in the peers holding it, so the last tab
 * closing took the document with it. It now writes an
 * encrypted blob to channel storage, host-only, and reads it back when it
 * rejoins an otherwise empty room.
 *
 * The shape of the test is the shape of the claim: put something on the board,
 * leave entirely, come back, and look for it.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function open(b, path, room, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 70)}`));
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => {
        const a = window.collabDoc;
        return !!(a && a.connected);
    }, { timeout: 45000 }).catch(() => {});
    await p.waitForTimeout(3500);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    // ---- collab-doc --------------------------------------------------------
    {
        const room = 'ps-doc' + Math.floor(Date.now() / 1000);
        const first = await open(b, '/apps/collab-doc/index.html', room, 'Writer');
        const TEXT = 'this sentence has to outlive the room';

        await first.evaluate((t) => {
            window.collabDoc.editor.setValue(t);
            if (window.collabDoc._store) window.collabDoc._store.touch();
        }, TEXT);
        // Force the write rather than waiting out the debounce.
        const saved = await first.evaluate(() => new Promise((res) => {
            if (!window.collabDoc._store) return res(false);
            window.collabDoc._store.flush(res);
        }));
        check(saved, 'collab-doc: the host saves the document to channel storage');
        await first.context().close();

        // Room is now empty. Everything is gone unless it was stored.
        const second = await open(b, '/apps/collab-doc/index.html', room, 'Writer2');
        await second.waitForTimeout(4000);
        const got = await second.evaluate(() => window.collabDoc.editor.getValue());
        check(got.includes(TEXT), `collab-doc: it comes back after the room emptied (${JSON.stringify(got.slice(0, 45))})`);
        await second.context().close();
    }

    // ---- the indicator, because silent saving is untrustworthy ------------
    {
        const room = 'ps-ind' + Math.floor(Date.now() / 1000);
        const p = await open(b, '/apps/collab-doc/index.html', room, 'Watcher');

        await p.evaluate(() => {
            window.collabDoc.editor.setValue('a change the indicator has to notice');
            if (window.collabDoc._store) window.collabDoc._store.touch();
        });
        await p.waitForTimeout(600);

        const pending = await p.evaluate(() => {
            const el = document.querySelector('.save-indicator');
            return el && !el.hidden ? el.textContent : null;
        });
        check(/unsaved/i.test(pending || ''),
            `a change says the work is not saved yet (${pending})`);

        // Then let the debounce fire and the save land.
        await p.waitForTimeout(6000);
        const saved = await p.evaluate(() => {
            const el = document.querySelector('.save-indicator');
            return el ? el.textContent : null;
        });
        check(/saved/i.test(saved || ''), `and says so once it is kept (${saved})`);
        await p.context().close();
    }

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
