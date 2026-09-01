/**
 * Signing in with Google must bring you back where you were.
 *
 * The service only accepts a same-origin path.  Callers can pass
 * window.location.href, but the client must reduce that absolute URL to its
 * path and query before starting the OAuth round trip.
 *
 * The second half: the callback hands the session back as #googleToken=... in
 * the fragment, and nothing was reading it, so a completed Google sign-in
 * left a token in the address bar and a signed-out page.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'resources', 'static',
    'js', 'mp-account.js'), 'utf8');

function makeStore() {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null),
             setItem: (k, v) => map.set(k, String(v)),
             removeItem: (k) => map.delete(k), _map: map };
}

/** Load the client against a fake page at `href`. */
function load(pathname, search, hash) {
    const localStorage = makeStore(), sessionStorage = makeStore();
    const replaced = [];
    const win = {
        location: { hostname: 'hmdevonline.com', pathname: pathname, search: search || '', hash: hash || '' },
        history: { replaceState: (a, b, url) => replaced.push(url) },
    };
    new Function('window', 'localStorage', 'sessionStorage', 'fetch', SRC)(
        win, localStorage, sessionStorage, () => Promise.reject(new Error('no network in test')));
    return { A: win.MPAccount, localStorage, sessionStorage, replaced };
}

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

console.log('coming back from Google');

check('returnTo is a relative path, which is the only kind the service honours', () => {
    const { A } = load('/messaging-platform/profile.html', '');
    const url = A.googleStartUrl();
    const returnTo = decodeURIComponent(url.split('returnTo=')[1]);
    assert.strictEqual(returnTo, '/messaging-platform/profile.html');
    assert.ok(returnTo.startsWith('/'),
        'an absolute returnTo is ignored and the service sends the user to Rooms');
});

check('it never sends an absolute url, from any page', () => {
    ['/messaging-platform/sdk/playground.html', '/messaging-platform/apps/droppro/'].forEach((p) => {
        const { A } = load(p, '');
        const returnTo = decodeURIComponent(A.googleStartUrl().split('returnTo=')[1]);
        assert.ok(!/^https?:/.test(returnTo), 'sent an absolute url for ' + p);
        assert.strictEqual(returnTo, p);
    });
});

check('a same-origin absolute URL is reduced to its local path', () => {
    const { A } = load('/messaging-platform/profile.html', '?tab=security', '#signin');
    const absolute = 'https://hmdevonline.com/messaging-platform/profile.html?tab=security#signin';
    const returnTo = decodeURIComponent(A.googleStartUrl(absolute).split('returnTo=')[1]);
    assert.strictEqual(returnTo, '/messaging-platform/profile.html?tab=security');
});

check('a foreign absolute URL cannot influence the return target', () => {
    const { A } = load('/messaging-platform/profile.html', '?tab=security');
    const returnTo = decodeURIComponent(A.googleStartUrl('https://elsewhere.example/steal').split('returnTo=')[1]);
    assert.strictEqual(returnTo, '/messaging-platform/profile.html?tab=security');
});

check('the query string survives the round trip', () => {
    const { A } = load('/messaging-platform/sdk/docs.html', '?section=auth');
    assert.strictEqual(decodeURIComponent(A.googleStartUrl().split('returnTo=')[1]),
        '/messaging-platform/sdk/docs.html?section=auth');
});

check('an invite hash is held aside rather than lost or double-fragmented', () => {
    const { A, sessionStorage } = load('/messaging-platform/sdk/apps/whiteboard/app.html', '', '#abc123');
    const returnTo = decodeURIComponent(A.googleStartUrl().split('returnTo=')[1]);
    assert.ok(returnTo.indexOf('#') === -1,
        'a returnTo carrying a fragment produces two fragments once the token is appended');
    assert.strictEqual(sessionStorage._map.get('mp.resumeHash'), '#abc123');
});

console.log('\nthe token in the fragment');

check('a returned token is adopted as the session', () => {
    const { localStorage } = load('/messaging-platform/profile.html', '', '#googleToken=abc.def.ghi');
    assert.strictEqual(localStorage._map.get('rooms.token'), 'abc.def.ghi');
});

check('and is scrubbed from the address bar, so it cannot be replayed', () => {
    const { replaced } = load('/messaging-platform/profile.html', '', '#googleToken=abc.def.ghi');
    assert.strictEqual(replaced.length, 1);
    assert.ok(replaced[0].indexOf('googleToken') === -1, 'the token was left in the url: ' + replaced[0]);
});

check('a held invite hash is put back in its place', () => {
    const localStorage = makeStore(), sessionStorage = makeStore();
    sessionStorage.setItem('mp.resumeHash', '#abc123');
    const replaced = [];
    const win = {
        location: { hostname: 'hmdevonline.com', pathname: '/p.html', search: '', hash: '#googleToken=t' },
        history: { replaceState: (a, b, url) => replaced.push(url) },
    };
    new Function('window', 'localStorage', 'sessionStorage', 'fetch', SRC)(
        win, localStorage, sessionStorage, () => Promise.reject(new Error('none')));
    assert.strictEqual(replaced[0], '/p.html#abc123');
});

check('a cancelled sign-in is reported, not swallowed', () => {
    const { A } = load('/messaging-platform/profile.html', '', '#googleError=Sign-in%20was%20cancelled.');
    assert.strictEqual(A.lastError, 'Sign-in was cancelled.');
});

check('an ordinary invite hash is left completely alone', () => {
    const { replaced, localStorage } = load('/messaging-platform/sdk/apps/whiteboard/app.html', '', '#abc123');
    assert.deepStrictEqual(replaced, [], 'rewrote the url of a page that was not coming back from Google');
    assert.strictEqual(localStorage._map.get('rooms.token'), undefined);
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
