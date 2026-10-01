/**
 * No page loads the same script twice.
 *
 * profile.html loaded ui.js and landing.js both deferred in the head and again
 * at the end of the body (2026-09-04 to 2026-10-01). The second ui.js threw
 * "Identifier 'UI' has already been declared", and the second landing.js bound
 * the phone menu's toggle again, so one tap opened it and closed it: on a phone
 * the profile page had no navigation at all.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');

function pages(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return /^(node_modules|vendor)$/.test(e.name) ? [] : pages(p);
        return p.endsWith('.html') ? [p] : [];
    });
}

/** Script sources a page loads more than once, query strings ignored. */
function loadedTwice(html) {
    const srcs = [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].replace(/[?#].*$/, ''));
    return [...new Set(srcs.filter((s, i) => srcs.indexOf(s) !== i))];
}

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

console.log('scripts load once');

check('the check itself sees a duplicate', () => {
    assert.deepStrictEqual(loadedTwice('<script src="a.js" defer></script><script src="a.js?v=2"></script>'), ['a.js']);
});

const all = pages(STATIC);
check('there are pages to check', () => assert.ok(all.length > 20, 'found ' + all.length));

check('no page loads a script twice', () => {
    const bad = all.map((p) => [path.relative(STATIC, p), loadedTwice(fs.readFileSync(p, 'utf8'))])
        .filter(([, d]) => d.length).map(([p, d]) => p + ': ' + d.join(', '));
    assert.deepStrictEqual(bad, []);
});

if (failures) { console.log(failures + ' failed'); process.exitCode = 1; }
