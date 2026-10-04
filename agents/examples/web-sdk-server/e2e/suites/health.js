/**
 * Boot health across every page on the site: does it load, does it error, does
 * it ask for anything that 404s, and does it show a connect card?
 */
const { BASE, SHOTS, LAUNCH } = require('../lib/harness');
const { discoverPages } = require('../lib/pages');
const { chromium } = require('playwright');
const ROOT = BASE + '/';

// Every published page, found on disk (lib/pages.js): a hand-kept list here
// went on asking for demos that had been deleted.
const PAGES = discoverPages();

(async () => {
    const b = await chromium.launch(LAUNCH);
    const rows = [];
    for (const path of PAGES) {
        const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
        const errs = [], missing = [];
        p.on('pageerror', e => errs.push(e.message.split('\n')[0].slice(0, 100)));
        p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
        p.on('requestfailed', r => {
            const u = r.url();
            if (u.startsWith(BASE)) missing.push(u.slice(BASE.length));
        });
        let status = '?';
        try {
            const res = await p.goto(ROOT + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
            status = res ? res.status() : 'ERR';
            await p.waitForTimeout(5000);
        } catch (e) { status = 'TIMEOUT'; }

        const facts = await p.evaluate(() => ({
            connect: !!document.getElementById('connectBtn'),
            title: (document.title || '').slice(0, 46),
            h1: (document.querySelector('h1') || {}).textContent ?
                document.querySelector('h1').textContent.trim().slice(0, 40) : '(none)',
            // Terminal output is content, not chrome: a shell that prints
            // "Connected \u2713" is not the site decorating itself. Counted by
            // walking text nodes and skipping anything inside a terminal,
            // because innerText is unreliable across xterm's subtree (its
            // accessibility layer and its render layer hold the same text).
            emoji: (() => {
                const RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
                const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let n = 0, node;
                while ((node = w.nextNode())) {
                    const p = node.parentElement;
                    if (!p || p.closest('.xterm, script, style, noscript')) continue;
                    if (!p.offsetParent && p.tagName !== 'BODY') continue;
                    n += (node.textContent.match(RE) || []).length;
                }
                return n;
            })(),
            tokens: !!getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()
        })).catch(() => ({}));

        rows.push({
            path, status,
            errs: [...new Set(errs)],
            missing: [...new Set(missing)],
            connect: facts.connect, emoji: facts.emoji, tokens: facts.tokens, h1: facts.h1
        });
        await p.close();
    }
    await b.close();

    console.log('\n' + 'PAGE'.padEnd(42) + 'HTTP  TOK  CONN  EMOJI  ERRS  MISSING');
    rows.forEach(r => {
        console.log(
            r.path.padEnd(42) +
            String(r.status).padEnd(6) +
            (r.tokens ? 'y' : 'N').padEnd(5) +
            (r.connect ? 'y' : '-').padEnd(6) +
            // The terminal app's count is whatever its shells have printed, which
            // differs every run and is content, not chrome. Reporting a number
            // there implies a finding that is not there.
            (r.path.endsWith('terminal/app.html') ? 'term' : String(r.emoji ?? '?')).padEnd(7) +
            String(r.errs.length).padEnd(6) +
            String(r.missing.length)
        );
    });
    const unwell = rows.filter(r => r.errs.length || r.missing.length || r.status !== 200);
    if (unwell.length) {
        console.log('\n=== detail: pages with errors or missing files ===');
        unwell.forEach(r => {
            console.log('\n' + r.path + '  [' + r.status + ']');
            r.errs.slice(0, 4).forEach(e => console.log('   ! ' + e));
            r.missing.slice(0, 4).forEach(m => console.log('   404 ' + m));
        });
    }
    console.log('\n' + (unwell.length === 0
        ? 'all ' + rows.length + ' pages load clean: no console errors, no missing files'
        : unwell.length + ' of ' + rows.length + ' pages have errors or missing files'));
    process.exit(unwell.length ? 1 : 0);
})();
