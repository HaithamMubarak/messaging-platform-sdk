/**
 * Every shared script in static/js/ is used by something (2026-10-05).
 *
 * js/save-indicator.js sat unloaded for a week after the boards that used it moved, and
 * nothing noticed. The other half of the lesson came on the same day: the first search
 * for unused scripts looked only in this repo and named js/platform-badge.js, which
 * BlockParty and Rooms load from this site's path (guidelines 6.46). So a script counts as
 * used when a page, script or stylesheet here names it, or, when the private apps repo is
 * checked out beside this one, when an app does. The public build has no apps checkout and
 * skips that half rather than failing.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const APPS = process.env.SIBLING_APPS_DIR
    || path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'messaging-platform-apps');

// Kept on purpose, each with its reason. An entry here is a decision, not a hiding place.
const KEPT = {
    'home-presence.js': 'the live "who is here" widget; plan section 6 P3 (a live hub hero) decides its fate',
};

function files(dir, keep) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        if (/^(node_modules|build|dist|generated[^/]*|\.git)$/.test(d.name)) return [];
        const p = path.join(dir, d.name);
        return d.isDirectory() ? files(p, keep) : (keep.test(d.name) ? [p] : []);
    });
}

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

const scripts = fs.readdirSync(path.join(STATIC, 'js')).filter((f) => f.endsWith('.js'));
const readers = files(STATIC, /\.(html|js|css|json)$/).concat(files(path.join(APPS, 'apps'), /\.(html|js|ts|css)$/));
const text = readers.map((f) => [f, fs.readFileSync(f, 'utf8')]);

check('every script in js/ is loaded or named by a page, script or app', () => {
    const unused = scripts.filter((s) => !KEPT[s]).filter((s) => {
        const own = path.join(STATIC, 'js', s);
        return !text.some(([f, t]) => f !== own && t.includes(s));
    });
    assert.deepStrictEqual(unused, [], 'delete them, or keep one in KEPT with its reason');
});

check('nothing kept on purpose has started being used or been deleted', () => {
    for (const s of Object.keys(KEPT)) {
        assert.ok(scripts.includes(s), s + ' is gone: remove it from KEPT');
        const own = path.join(STATIC, 'js', s);
        assert.ok(!text.some(([f, t]) => f !== own && t.includes(s)), s + ' is used now: remove it from KEPT');
    }
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
