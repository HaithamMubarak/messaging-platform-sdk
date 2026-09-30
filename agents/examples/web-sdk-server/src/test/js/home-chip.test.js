/**
 * The "SDK / More demos" chip must lead somewhere.
 *
 * It worked out its links by counting "../" from "/apps/", which is right for
 * the SDK site's own demos and wrong for the apps catalogue: every app under
 * /messaging-platform/apps/ sent both links to /messaging-platform/index.html
 * and /messaging-platform/playground.html, two 404s (2026-09-30). And landing
 * pages, which have the site header, got the chip too, unstyled.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'resources', 'static',
    'js', 'app-chrome.js'), 'utf8');

/** Run app-chrome.js on a fake page; returns the chip's hrefs, or null for no chip. */
function chipOn(pathname, opts) {
    const o = opts || {};
    const appended = [];
    const el = () => ({ children: [], setAttribute() {}, appendChild(c) { this.children.push(c); },
                        classList: { contains: () => false, add() {} } });
    const document = {
        readyState: 'complete',
        body: { appendChild: (n) => appended.push(n) },
        createElement: el,
        getElementById: () => null,
        querySelector: (sel) => (sel === '.site-header' && o.siteHeader ? {} : null),
        querySelectorAll: () => [],
    };
    function MutationObserver() { return { observe() {}, disconnect() {} }; }
    new Function('document', 'location', 'MutationObserver', 'setTimeout', SRC)(
        document, { pathname: pathname }, MutationObserver, () => 0);
    const nav = appended.find((n) => n.className === 'sdk-home-chip');
    return nav ? nav.children.map((a) => a.href) : null;
}

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

console.log('the home chip');

check('an app in the apps catalogue links to the hub, not to a 404', () => {
    assert.deepStrictEqual(chipOn('/messaging-platform/apps/signet/app.html'),
        ['/messaging-platform/hub/', '/messaging-platform/hub/playground.html']);
});

check('an SDK demo on the deployed site links to the hub too', () => {
    assert.deepStrictEqual(chipOn('/messaging-platform/sdk/apps/whiteboard.html'),
        ['/messaging-platform/hub/', '/messaging-platform/hub/playground.html']);
});

check('served on its own, the links stay relative to the site root', () => {
    assert.deepStrictEqual(chipOn('/apps/whiteboard.html'), ['../index.html', '../playground.html']);
    assert.deepStrictEqual(chipOn('/apps/mini-games/y/index.html'),
        ['../../../index.html', '../../../playground.html']);
});

check('a landing page, which has the site header, gets no chip', () => {
    assert.strictEqual(chipOn('/messaging-platform/apps/coshell/', { siteHeader: true }), null);
});

if (failures) { console.log(failures + ' failed'); process.exitCode = 1; }
