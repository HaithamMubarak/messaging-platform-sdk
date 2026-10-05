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
    const stale = pages.filter((p) => shell.apply(p.html, p.section, shell.pairFor(p.rel)) !== p.html).map((p) => p.rel);
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

// The faces are served from this site since 2026-10-05 (css/fonts.css), so the promise is no
// longer "imports Google's Manrope": the shell imports fonts.css, which declares Manrope from a
// file that exists, and every shell page preloads that file.
check('the shell styles load the face they name', () => {
    const css = fs.readFileSync(path.join(shell.STATIC, 'css', 'site-shell.css'), 'utf8');
    assert.ok(/@import url\('\/messaging-platform\/hub\/css\/fonts\.css'\)/.test(css) && /'Manrope'/.test(css), 'site-shell.css does not import fonts.css');
    const fonts = fs.readFileSync(path.join(shell.STATIC, 'css', 'fonts.css'), 'utf8');
    const face = fonts.match(/font-family:\s*"Manrope";[\s\S]*?url\("\/messaging-platform\/hub\/([^"]+)"\)/);
    assert.ok(face && fs.existsSync(path.join(shell.STATIC, face[1])), 'fonts.css declares no Manrope from a file that exists');
    for (const p of pages) assert.ok(p.html.includes(`href="/messaging-platform/hub/${face[1]}" as="font"`), p.rel + ' does not preload ' + face[1]);
});

// The server caches /fonts/** for a year (WebConfig), which is safe only while a changed font is a
// new URL: every face fonts.css loads must sit in a version folder (fonts/5.3.0/...), and exist.
check('every font URL sits in a version folder, so the year-long cache cannot pin a stale face', () => {
    const fonts = fs.readFileSync(path.join(shell.STATIC, 'css', 'fonts.css'), 'utf8');
    const urls = [...fonts.matchAll(/url\("\/messaging-platform\/hub\/([^"]+\.woff2)"\)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 2, 'fonts.css loads no woff2');
    for (const u of urls) {
        assert.ok(/^fonts\/\d+\.\d+\.\d+\//.test(u), u + ' is not in a version folder');
        assert.ok(fs.existsSync(path.join(shell.STATIC, u)), u + ' does not exist');
    }
});

/*
 * One type system (landing redesign L2): no public page's stylesheets name a face
 * other than Manrope and JetBrains Mono, or a system fallback. The catalogue kept
 * Bricolage + Source Sans for weeks after the rest of the site moved, because no
 * check looked past the SDK. Pages are found, not listed: the shell's pages, and
 * when the sibling repos are present, the apps catalogue and every landing that
 * wears the shell. Each page's own <link rel="stylesheet"> tags say what to read.
 */
// "Manrope Fallback" is Arial sized to Manrope's metrics (design-tokens.css, L5), not another face.
const FACES = /^(manrope|manrope fallback|jetbrains mono|ui-sans-serif|ui-monospace|system-ui|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica neue|helvetica|arial|sans-serif|monospace|sf mono|sfmono-regular|liberation mono|cascadia code|menlo|consolas|courier new|inherit|initial|apple color emoji|segoe ui emoji|noto color emoji)$/;
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

/*
 * Party Arcade imports its CSS from script (a Vite app), so its sheets are read
 * from src/client. The owner kept its display face for the hero (plan section 7,
 * Q1): Space Grotesk and the Georgia italic in the headline; Trebuchet MS is
 * the in-game map HUD, and two symbol fonts are glyph fallbacks.
 */
const ALLOWED = { 'party-arcade': ['space grotesk', 'space grotesk (loaded)', 'georgia', 'serif', 'trebuchet ms', 'segoe ui symbol', 'noto sans symbols 2'] };

function pageCss(page, html) {
    const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
    const own = path.join(path.dirname(page), 'src', 'client');
    const bundled = fs.existsSync(own) ? fs.readdirSync(own).filter((f) => f.endsWith('.css')).map((f) => path.join(own, f)) : [];
    return [html.match(/<style[\s\S]*?<\/style>/g) || []].flat().join('\n')
        + sheets.map((h) => sheetFile(page, h)).filter((f) => f && fs.existsSync(f)).concat(bundled).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
        + sheets.filter((h) => /^https?:/.test(h)).join('\n');
}

check('no public page names a face other than Manrope or JetBrains Mono', () => {
    const bad = [];
    for (const page of publicPages()) {
        const html = fs.readFileSync(page, 'utf8');
        const allowed = ALLOWED[path.basename(path.dirname(page))] || [];
        const faces = [...new Set(facesIn(pageCss(page, html)))].filter((f) => !allowed.includes(f));
        if (faces.length) bad.push(path.basename(path.dirname(page)) + '/' + path.basename(page) + ': ' + faces.join(', '));
    }
    assert.deepStrictEqual(bad, []);
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
