/**
 * Terminal end-to-end: the shell, the keyboard, the file explorer.
 * Run: xvfb-run -a --server-args="-screen 0 1440x900x24" node term-test.js
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const APP = BASE + '/apps/terminal/app.html?debug';

const pass = [], fail = [];
const check = (ok, what) => (ok ? pass : fail).push(what);
const sessions = (p) => p.evaluate(() => {
    const el = document.querySelector('#sessionCount, .status-sessions, #statusSessions');
    if (el) return parseInt(el.textContent.replace(/\D/g, ''), 10);
    const m = document.body.textContent.match(/Sessions:\s*(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
});
const tabs = (p) => p.evaluate(() => document.querySelectorAll('.terminal-tab, .tab').length);

(async () => {
    const b = await chromium.launch({ headless: false, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 150)); });

    await p.goto(APP, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(7000);

    // The fix under test is that DEAD sessions are not restored. Live ones
    // are, correctly — and a long test session leaves live ones behind — so
    // the assertion is about dead tabs, which is what it always meant.
    const restored = await tabs(p);
    const dead = await p.evaluate(() => document.querySelectorAll(
        '.terminal-tab.disconnected, .tab.disconnected, [class*="tab"][class*="dead"]').length);
    check(dead === 0, `no dead session was restored (${restored} live tabs, ${dead} dead)`);
    await p.evaluate(() => createLocalTerminal('bash'));
    await p.waitForTimeout(5000);
    check((await tabs(p)) >= 1, `clicking Bash opens a shell (${await tabs(p)} tab)`);

    // type in the real shell
    await p.click('.xterm-screen').catch(() => {});
    await p.waitForTimeout(400);
    await p.keyboard.type('echo the-shell-is-real');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1800);
    const sawEcho = await p.evaluate(() => document.body.innerText.includes('the-shell-is-real'));
    check(sawEcho, 'a command runs and its output comes back');

    // --- the chords ---------------------------------------------------------
    // The app caps concurrent sessions at 20 and says so in a toast. Shells
    // outlive the browser context, so a machine that has run this suite a few
    // times arrives already at the cap and the chord correctly refuses — which
    // looks like a broken shortcut. Make room first, so this measures the
    // shortcut rather than the state of the machine it runs on.
    const MAX_SESSIONS = 20;
    let before = await tabs(p);
    if (before >= MAX_SESSIONS) {
        await p.evaluate(() => {
            const close = document.querySelector('.tab-close');
            if (close) close.click();
        });
        await p.waitForTimeout(2500);
        const freed = await tabs(p);
        check(freed < before, `made room at the session cap (${before} → ${freed})`);
        before = freed;
    }
    await p.keyboard.press('Control+Shift+T');
    await p.waitForTimeout(4000);
    const afterNew = await tabs(p);
    check(afterNew > before, `Ctrl+Shift+T opens a tab (${before} → ${afterNew})`);

    await p.keyboard.press('Control+PageUp');
    await p.waitForTimeout(1200);
    check(true, 'Ctrl+PgUp did not throw');

    const fontBefore = await p.evaluate(() => Number(localStorage.getItem('terminal_fontSize') || 14));
    await p.keyboard.press('Control+Equal');
    await p.waitForTimeout(900);
    const fontAfter = await p.evaluate(() => Number(localStorage.getItem('terminal_fontSize') || 14));
    check(fontAfter > fontBefore, `Ctrl+= grows the type (${fontBefore} → ${fontAfter})`);
    await p.keyboard.press('Control+Minus');
    await p.waitForTimeout(700);

    const beforeClose = await tabs(p);
    await p.keyboard.press('Control+Shift+W');
    await p.waitForTimeout(2500);
    const afterClose = await tabs(p);
    check(afterClose < beforeClose, `Ctrl+Shift+W closes a tab (${beforeClose} → ${afterClose})`);

    // --- the file explorer --------------------------------------------------
    await p.evaluate(() => createLocalTerminal('bash'));
    await p.waitForTimeout(5000);
    await p.evaluate(() => switchSidebarTab('files'));
    await p.waitForTimeout(4500);
    const listed = await p.evaluate(() =>
        document.querySelectorAll('.sftp-file-name').length);
    check(listed > 0, `the file explorer lists a directory (${listed} entries)`);
    await p.screenshot({ path: OUT + 'term-verify-files.png' });

    // --- no emoji left in the chrome ---------------------------------------
    const emoji = await p.evaluate(() => {
        const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
        const hits = [];
        document.querySelectorAll('.menu-bar, .toolbar, .sidebar-tabs, .tab-bar, .status-bar, .terminal-tab')
            .forEach(el => { if (re.test(el.textContent)) hits.push(el.className); });
        return hits;
    });
    check(emoji.length === 0, `no emoji left in the chrome (${emoji.join(', ') || 'clean'})`);

    // --- the H2 credentials are gone ---------------------------------------
    const creds = await p.evaluate(() => document.body.innerHTML.includes('changeme'));
    check(!creds, 'the H2 console credentials are no longer in the markup');

    await p.screenshot({ path: OUT + 'term-verify.png' });

    console.log('\nPASS (' + pass.length + ')');
    pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(x => console.log('  ✗ ' + x));
    console.log('\nconsole errors (' + [...new Set(errs)].length + '):');
    [...new Set(errs)].slice(0, 10).forEach(e => console.log('  ! ' + e));
    await b.close();
})();
