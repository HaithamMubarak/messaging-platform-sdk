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

/**
 * The apps repo beside this one: SIBLING_APPS_DIR, else the first ancestor that has a
 * messaging-platform-apps folder. A fixed "seven levels up" found it from the main
 * checkout only; from a worktree (dev/worktrees/<repo>/<branch>/...) it looked in the
 * wrong folder and this test went red on scripts that only the apps load (2026-10-26).
 */
function findApps() {
    const given = process.env.SIBLING_APPS_DIR;
    if (given) return fs.existsSync(path.join(given, 'apps')) ? given : null;
    for (let dir = __dirname; path.dirname(dir) !== dir; dir = path.dirname(dir)) {
        const candidate = path.join(path.dirname(dir), 'messaging-platform-apps');
        if (fs.existsSync(path.join(candidate, 'apps'))) return candidate;
    }
    return null;
}
const APPS = findApps();

// Kept on purpose, each with its reason. An entry here is a decision, not a hiding place.
const KEPT = {
};

// Shared with the apps repo, which loads them from this site or vendors them as
// vendor/sdk-ui/<name>. No page here uses them, so without an apps checkout (the public
// build) they are taken on trust; with one, they must still be used by an app.
const FOR_APPS = {
    'licence-gate.js': 'the licence check; vendored into Baton, Gatehouse, Screener, Signet, SponsorPulse, Turnstile',
    'platform-badge.js': '"Powered by Messaging Platform"; BlockParty loads it from /messaging-platform/sdk/js/, Rooms vendors it',
    'receipts.js': 'the seal record; vendored into Baton, Fieldstamp, Screener, Signet, Turnstile',
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
const appFiles = APPS ? files(path.join(APPS, 'apps'), /\.(html|js|ts|css)$/) : [];
const readers = files(STATIC, /\.(html|js|css|json)$/).concat(appFiles);
const text = readers.map((f) => [f, fs.readFileSync(f, 'utf8')]);
if (!APPS) console.log('  note no apps checkout beside this repo: ' + Object.keys(FOR_APPS).join(', ') + ' taken on trust');

check('every script in js/ is loaded or named by a page, script or app', () => {
    const unused = scripts.filter((s) => !KEPT[s] && !(FOR_APPS[s] && !APPS)).filter((s) => {
        const own = path.join(STATIC, 'js', s);
        return !text.some(([f, t]) => f !== own && t.includes(s));
    });
    assert.deepStrictEqual(unused, [], 'delete them, or keep one in KEPT (or FOR_APPS) with its reason');
});

check('every script kept for the apps still exists, and an app still uses it', () => {
    for (const s of Object.keys(FOR_APPS)) {
        assert.ok(scripts.includes(s), s + ' is gone: remove it from FOR_APPS');
        if (APPS) {
            assert.ok(text.some(([f, t]) => appFiles.includes(f) && t.includes(s)), s + ' is used by no app now: remove it from FOR_APPS');
        }
    }
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
