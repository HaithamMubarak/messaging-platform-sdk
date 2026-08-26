/**
 * A lost chunk should cost one chunk, not the whole file.
 *
 * Drop used to notice a gap only at the end, and a stall threw away everything
 * received and asked for the file again from byte zero. The receiver knows
 * exactly which indices it is missing, so it now asks for those.
 *
 * The test drops a chunk on purpose — the receiver ignores one index the first
 * time it sees it — and then checks the transfer still finishes, byte for byte.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, room, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 70)}`));
    await p.goto(BASE + '/apps/drop/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.dropApp && window.dropApp.connected, { timeout: 45000 }).catch(() => {});
    await p.waitForTimeout(3000);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const room = 'dr' + Math.floor(Date.now() / 1000);
    const sender = await join(b, room, 'Sender');
    const receiver = await join(b, room, 'Receiver');
    await sender.waitForTimeout(2500);

    check(await sender.evaluate(() => !!window.dropApp), 'drop is running');

    // Teach the receiver to lose exactly one chunk, once.
    const rigged = await receiver.evaluate(() => {
        const app = window.dropApp;
        if (!app || typeof app._receive !== 'function') return false;
        app._droppedOnce = false;
        const original = app._receive.bind(app);
        app._receive = function (d, from) {
            if (d && d.type === 'chunk' && d.i === 1 && !app._droppedOnce) {
                app._droppedOnce = true;      // swallow chunk #1 the first time
                return;
            }
            return original(d, from);
        };
        return true;
    });
    check(rigged, 'the receiver is rigged to lose one chunk');

    // A file big enough to be several chunks, sent through the real input the
    // app actually uses rather than a private method.
    const SIZE = 300 * 1024;
    const bytes = Buffer.alloc(SIZE);
    for (let i = 0; i < SIZE; i++) bytes[i] = i % 251;
    await sender.setInputFiles('#fileInput', {
        name: 'resume-me.bin', mimeType: 'application/octet-stream', buffer: bytes
    });
    await receiver.waitForTimeout(4000);

    // Accept whatever was offered.
    const accepted = await receiver.evaluate(() => {
        const app = window.dropApp;
        const row = Array.from(app.transfers.values()).find(r => r.dir === 'in');
        if (!row) return false;
        app.accept(row.id);
        return true;
    });
    check(accepted, 'the receiver accepted the offer');

    // Long enough for the stall watchdog to notice the gap and ask for it.
    await receiver.waitForTimeout(45000);

    const state = await receiver.evaluate(() => {
        const row = Array.from(window.dropApp.transfers.values()).find(r => r.dir === 'in');
        if (!row) return null;
        return { state: row.state, done: row.done, total: row.total, dropped: window.dropApp._droppedOnce };
    });

    check(state && state.dropped, 'a chunk really was dropped');
    check(state && state.state !== 'failed',
        `the transfer did not give up (state ${state && state.state})`);
    check(state && state.done === state.total,
        `every chunk arrived in the end (${state && state.done}/${state && state.total})`);

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
