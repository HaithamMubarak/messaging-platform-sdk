/**
 * A session survives a bad network, and does not survive being revoked.
 *
 * Two faults, opposite in direction, in the same six lines.
 *
 * `me()` used to discard the token in a bare `.catch()` — on ANY failure. One
 * dropped request, one 502, one moment of flaky wifi and the person was signed
 * out permanently: there is no refresh token here, so the session is simply
 * gone and they have to sign in again. That is a lot to lose to a blip.
 *
 * And in the other direction, the `/me` answer was cached in sessionStorage
 * with no expiry and nothing ever asked for a fresh one, so a session revoked
 * in another tab — or on another machine — kept rendering as signed in for as
 * long as the tab stayed open.
 *
 * The rule these pin: only a REJECTED session (401/403) signs somebody out.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'resources',
    'static', 'js', 'mp-account.js'), 'utf8');

function makeStore() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        _map: map,
    };
}

/**
 * Load the client with a scripted fetch.
 * @param {Array} replies one per call: {ok, status, body} or {throw: true}
 */
function load(replies, { token = 'tok-1', cached = null } = {}) {
    const localStorage = makeStore(), sessionStorage = makeStore();
    if (token) localStorage.setItem('rooms.token', token);
    if (cached) sessionStorage.setItem('mp.me.v1', JSON.stringify(cached));

    const calls = [];
    const fetch = (url) => {
        calls.push(url);
        const r = replies.shift() || { ok: true, status: 200, body: {} };
        if (r.throw) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve({
            ok: r.ok !== false, status: r.status || 200,
            json: () => Promise.resolve(r.body || {}),
        });
    };
    const win = {
        location: { hostname: 'hmdevonline.com', pathname: '/messaging-platform/profile.html',
                    search: '', hash: '', host: 'hmdevonline.com' },
        history: { replaceState() {} },
    };
    new Function('window', 'localStorage', 'sessionStorage', 'fetch', SRC)(
        win, localStorage, sessionStorage, fetch);
    return { A: win.MPAccount, localStorage, sessionStorage, calls };
}

const USER = { id: 'u1', email: 'a@b.c', displayName: 'Amina' };
const fresh = (u) => ({ at: Date.now(), u: u });

const checks = [];
const check = (n, f) => checks.push([n, f]);
let failures = 0;

check('a dropped request does not sign anybody out', async () => {
    const { A, localStorage } = load([{ throw: true }]);
    await A.me();
    assert.strictEqual(localStorage.getItem('rooms.token'), 'tok-1',
        'a network failure discarded the session token; there is no refresh '
      + 'token here, so that signs the person out for good');
    assert.strictEqual(A.signedIn(), true);
});

check('nor does a 502 from a service having a bad moment', async () => {
    const { A, localStorage } = load([{ ok: false, status: 502, body: {} }]);
    await A.me();
    assert.strictEqual(localStorage.getItem('rooms.token'), 'tok-1',
        'a 502 discarded the session');
});

check('nor a 500, a 429 or a gateway timeout', async () => {
    for (const status of [500, 429, 504]) {
        const { A, localStorage } = load([{ ok: false, status: status, body: {} }]);
        await A.me();
        assert.strictEqual(localStorage.getItem('rooms.token'), 'tok-1',
            'HTTP ' + status + ' discarded the session');
    }
});

check('but a 401 does — a rejected session is really over', async () => {
    const { A, localStorage } = load([{ ok: false, status: 401, body: {} }]);
    assert.strictEqual(await A.me(), null);
    assert.strictEqual(localStorage.getItem('rooms.token'), null,
        'a rejected token was kept, so every later call fails on its own');
    assert.strictEqual(A.signedIn(), false);
});

check('and so does a 403', async () => {
    const { A, localStorage } = load([{ ok: false, status: 403, body: {} }]);
    assert.strictEqual(await A.me(), null);
    assert.strictEqual(localStorage.getItem('rooms.token'), null);
});

check('through a blip, the site keeps showing who you are', async () => {
    // Flickering every page to signed-out on one failed request is its own
    // bug: the chip, the saved list and the save checkbox all read this.
    const { A } = load([{ throw: true }], { cached: fresh(USER) });
    const u = await A.me(true);          // forced past the cache, and it fails
    assert.ok(u && u.id === 'u1',
        'a transient failure reported signed-out while the session was still good');
});

check('a cached answer goes stale, so a revoked session is noticed', async () => {
    const stale = { at: Date.now() - (6 * 60 * 1000), u: USER };   // 6 minutes old
    const { A, calls } = load([{ ok: false, status: 401, body: {} }], { cached: stale });
    assert.strictEqual(await A.me(), null,
        'a session revoked elsewhere still rendered as signed in');
    assert.strictEqual(calls.length, 1, 'the stale cache was served without asking');
});

check('a fresh cached answer is still served without a request', async () => {
    // The cache exists so twenty landing pages do not each hit /me. Keep that.
    const { A, calls } = load([], { cached: fresh(USER) });
    const u = await A.me();
    assert.ok(u && u.id === 'u1');
    assert.strictEqual(calls.length, 0,
        'every page load now hits /me, which is what the cache was for');
});

check('a cache entry from an older build is not trusted forever', async () => {
    const { A, calls } = load([{ ok: false, status: 401, body: {} }],
        { cached: USER });               // the old shape: no timestamp
    assert.strictEqual(await A.me(), null);
    assert.strictEqual(calls.length, 1, 'an untimestamped entry was trusted');
});

check('signing out still clears the cache as well as the token', async () => {
    const { A, localStorage, sessionStorage } = load([{ ok: true, body: {} }],
        { cached: fresh(USER) });
    await A.logout();
    assert.strictEqual(localStorage.getItem('rooms.token'), null);
    assert.strictEqual(sessionStorage.getItem('mp.me.v1'), null,
        'the cached identity outlived the sign-out');
});

(async () => {
    console.log('the session, through a bad network and a revocation');
    for (const [name, fn] of checks) {
        try { await fn(); console.log('  ok   ' + name); }
        catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
    }
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
