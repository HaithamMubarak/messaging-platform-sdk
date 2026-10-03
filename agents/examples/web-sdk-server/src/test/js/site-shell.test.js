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
    assert.ok(!/Bricolage|Source Sans/.test(fs.readFileSync(path.join(shell.STATIC, 'css', 'hub-product.css'), 'utf8')),
        'hub-product.css names a face nothing loads');
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
