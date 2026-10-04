/**
 * One site shell (hub consolidation phase 2, 2026-10-03). Five headers and footers had drifted
 * apart, each with its own nav and logo. tools/site-shell.cjs writes the one header and footer;
 * this fails when a page differs from it, or when a page meant to wear it does not.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const shell = require('../../../tools/site-shell.cjs');

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

const pages = Object.entries(shell.PAGES).map(([rel, section]) => {
    const html = fs.readFileSync(path.join(shell.STATIC, rel), 'utf8').replace(/\r\n/g, '\n');
    return { rel, section, html };
});

check('every shell page wears the current header and footer (run node tools/site-shell.cjs)', () => {
    const stale = pages.filter((p) => shell.apply(p.html, p.section) !== p.html).map((p) => p.rel);
    assert.deepStrictEqual(stale, []);
});

check('no shell page keeps a second, hand-written header or nav', () => {
    for (const p of pages) {
        assert.ok(!/class="mp-top"|class="mp-nav"/.test(p.html), p.rel + ' still has the old .mp-top header');
        assert.strictEqual((p.html.match(/<header class="site-header"/g) || []).length, 1, p.rel + ' has more than one site header');
        assert.strictEqual((p.html.match(/<footer\b/g) || []).length, 1, p.rel + ' has more than one footer');
    }
});

check('each page lights its own section, and only one', () => {
    for (const p of pages) {
        const lit = (p.html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)[0].match(/aria-current="page"/g) || []).length;
        assert.strictEqual(lit, p.section ? 1 : 0, p.rel);
    }
});

check('the shell nav has the six sections and one call to action', () => {
    const nav = shell.header('').match(/<nav[\s\S]*<\/nav>/)[0];
    assert.deepStrictEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]),
        ['Product', 'Demos', 'Apps', 'Games', 'Docs', 'Pricing', 'Start free']);
});

check('the shell styles load the face they name', () => {
    const css = fs.readFileSync(path.join(shell.STATIC, 'css', 'site-shell.css'), 'utf8');
    assert.ok(/family=Manrope/.test(css) && /'Manrope'/.test(css));
});

/*
 * One type system (landing redesign L2): no public page's stylesheets name a face
 * other than Manrope and JetBrains Mono, or a system fallback. The catalogue kept
 * Bricolage + Source Sans for weeks after the rest of the site moved, because no
 * check looked past the SDK. Pages are found, not listed: the shell's pages, and
 * when the sibling repos are present, the apps catalogue and every landing that
 * wears the shell. Each page's own <link rel="stylesheet"> tags say what to read.
 */
const FACES = /^(manrope|jetbrains mono|ui-sans-serif|ui-monospace|system-ui|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica neue|helvetica|arial|sans-serif|monospace|sf mono|sfmono-regular|liberation mono|cascadia code|menlo|consolas|courier new|inherit|initial|apple color emoji|segoe ui emoji|noto color emoji)$/;
const DEV = path.join(shell.STATIC, '..', '..', '..', '..', '..', '..', '..', '..');

function publicPages() {
    const pages = Object.keys(shell.PAGES || {}).map((p) => path.join(shell.STATIC, p));
    const catalogue = path.join(DEV, 'messaging-platform-services', 'docker', 'apps-service', 'index.html');
    if (fs.existsSync(catalogue)) pages.push(catalogue);
    const apps = path.join(DEV, 'messaging-platform-apps', 'apps');
    if (fs.existsSync(apps)) {
        for (const a of fs.readdirSync(apps)) {
            const f = path.join(apps, a, 'index.html');
            if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('site-shell:header')) pages.push(f);
        }
    }
    return pages.filter((p) => fs.existsSync(p));
}

/** A stylesheet href as a file on disk; null for one we cannot see (another host). */
function sheetFile(page, href) {
    if (/^https?:/.test(href)) return null;
    const m = href.match(/^\/messaging-platform\/(?:hub|sdk)\/(.+)$/);
    return m ? path.join(shell.STATIC, m[1]) : path.resolve(path.dirname(page), href.split('?')[0]);
}

function facesIn(css) {
    const named = [];
    for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
        for (const f of m[1].replace(/var\([^)]*\)/g, '').split(',')) {   // a var() fallback is the token's
            const face = f.trim().replace(/^['"]|['"]$/g, '').replace(/\s*!important$/, '').toLowerCase();
            if (face && !face.startsWith('var(') && !FACES.test(face)) named.push(face);
        }
    }
    for (const m of css.matchAll(/family=([A-Za-z+]+)/g)) {
        const face = m[1].replace(/\+/g, ' ').toLowerCase();
        if (!FACES.test(face)) named.push(face + ' (loaded)');
    }
    return named;
}

check('no public page names a face other than Manrope or JetBrains Mono', () => {
    const bad = [];
    for (const page of publicPages()) {
        const html = fs.readFileSync(page, 'utf8');
        const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
        const css = [html.match(/<style[\s\S]*?<\/style>/g) || []].flat().join('\n')
            + sheets.map((h) => sheetFile(page, h)).filter((f) => f && fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
            + sheets.filter((h) => /^https?:/.test(h)).join('\n');
        const faces = [...new Set(facesIn(css))];
        if (faces.length) bad.push(path.basename(path.dirname(page)) + '/' + path.basename(page) + ': ' + faces.join(', '));
    }
    assert.deepStrictEqual(bad, []);
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
