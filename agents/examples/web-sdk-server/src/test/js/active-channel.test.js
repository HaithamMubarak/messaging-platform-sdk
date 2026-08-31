/**
 * One channel, followed from app to app.
 *
 * Each demo used to pass its own `localStoragePrefix` into the modal, so the
 * room you picked in the whiteboard was invisible to chess and every app
 * generated its own. Every surface is a path on one origin, so localStorage
 * was always shared -- only the prefix kept the channel apart.
 *
 * These drive the real module. The precedence rule is the load-bearing part:
 * an invite must still win outright, because an invite that did not put you in
 * the inviter's room is a broken invite.
 */
const assert = require('assert');
const path = require('path');

/* A localStorage/sessionStorage pair, with the throwing variant a private
 * window gives you, since the modal must survive that. */
function makeStore(throws) {
    const map = new Map();
    return {
        getItem: (k) => { if (throws) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
        setItem: (k, v) => { if (throws) throw new Error('denied'); map.set(k, String(v)); },
        removeItem: (k) => { if (throws) throw new Error('denied'); map.delete(k); },
        _map: map,
    };
}

function load({ localThrows = false, sessionThrows = false } = {}) {
    const win = {};
    const localStorage = makeStore(localThrows);
    const sessionStorage = makeStore(sessionThrows);
    const src = require('fs').readFileSync(
        path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js', 'active-channel.js'), 'utf8');
    new Function('window', 'localStorage', 'sessionStorage', src)(win, localStorage, sessionStorage);
    return { AC: win.ActiveChannel, localStorage, sessionStorage };
}

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

console.log('the shared active channel');

check('a channel written in one app is what the next app reads', () => {
    const { AC } = load();
    AC.write('whiteboard-48213977', 'typed');
    assert.strictEqual(AC.read().name, 'whiteboard-48213977');
});

check('nothing is remembered before anything is written', () => {
    assert.strictEqual(load().AC.read(), null);
});

check('a corrupt value costs a regenerated room, not a broken modal', () => {
    const { AC, localStorage } = load();
    localStorage.setItem('mp.active.v1', '{not json');
    assert.strictEqual(AC.read(), null);
});

check('a value with no channel name is not a channel', () => {
    const { AC, localStorage } = load();
    localStorage.setItem('mp.active.v1', JSON.stringify({ source: 'typed', ts: 1 }));
    assert.strictEqual(AC.read(), null);
});

check('the password lives in sessionStorage, as it always has', () => {
    const { AC, localStorage, sessionStorage } = load();
    AC.writePassword('mJq7xKp2Rw4t');
    assert.strictEqual(sessionStorage._map.get('mp.active.pw'), 'mJq7xKp2Rw4t');
    assert.ok(![...localStorage._map.values()].includes('mJq7xKp2Rw4t'),
        'the channel password reached localStorage, where it outlives the session');
});

check('a name chosen in one app is kept in the next', () => {
    const { AC } = load();
    AC.writeUsername('Amina');
    assert.strictEqual(AC.readUsername(), 'Amina');
});

console.log('\nadopting what each app already had');

check('the first app visit after the update keeps its own room', () => {
    const { AC, localStorage, sessionStorage } = load();
    localStorage.setItem('whiteboard_channel', 'whiteboard-11112222');
    sessionStorage.setItem('whiteboard_password', 'oldpass');
    assert.strictEqual(AC.seedFromLegacy('whiteboard_'), true);
    assert.strictEqual(AC.read().name, 'whiteboard-11112222');
    assert.strictEqual(AC.readPassword(), 'oldpass');
});

check('and a second app does NOT then overwrite it with its own', () => {
    const { AC, localStorage } = load();
    localStorage.setItem('whiteboard_channel', 'whiteboard-11112222');
    AC.seedFromLegacy('whiteboard_');
    localStorage.setItem('chess_channel', 'chess-99998888');
    assert.strictEqual(AC.seedFromLegacy('chess_'), false);
    assert.strictEqual(AC.read().name, 'whiteboard-11112222',
        'the second app hijacked the shared channel');
});

check('an app with no history adopts nothing', () => {
    const { AC } = load();
    assert.strictEqual(AC.seedFromLegacy('drop_'), false);
    assert.strictEqual(AC.read(), null);
});

check('clear forgets the room and its password', () => {
    const { AC } = load();
    AC.write('room-1', 'typed');
    AC.writePassword('p');
    AC.clear();
    assert.strictEqual(AC.read(), null);
    assert.strictEqual(AC.readPassword(), '');
});

console.log('\na browser that refuses to store anything');

check('a private window degrades to session-only rather than throwing', () => {
    const { AC } = load({ localThrows: true, sessionThrows: true });
    assert.doesNotThrow(() => {
        AC.write('room-1', 'typed');
        AC.writePassword('p');
        AC.writeUsername('Amina');
        AC.seedFromLegacy('whiteboard_');
    });
    assert.strictEqual(AC.read(), null);
    assert.strictEqual(AC.readPassword(), '');
});

console.log('\nthe wiring, which is where this silently stops working');

const fs = require('fs');
const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');

function htmlFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? htmlFiles(full) : (e.name.endsWith('.html') ? [full] : []);
    });
}

check('every page using the modal or RoomDefaults also loads the module', () => {
    const missing = htmlFiles(STATIC).filter((f) => {
        const t = fs.readFileSync(f, 'utf8');
        return (t.includes('connection-modal.js') || t.includes('room-defaults.js'))
            && !t.includes('active-channel.js');
    }).map((f) => path.relative(STATIC, f));
    assert.deepStrictEqual(missing, [],
        'these pages would silently keep a private channel: ' + missing.join(', '));
});

check('and loads it BEFORE them, or window.ActiveChannel is not there yet', () => {
    // Script TAGS only. Every one of these pages also mentions
    // connection-modal.js in a comment near the top ("injected dynamically
    // by connection-modal.js"), and a raw substring search reads that as a
    // load and reports three pages that are perfectly ordered.
    const scriptSrcs = (t) => [...t.matchAll(/<script[^>]+src="([^"]+)"/g)]
        .map((m) => m[1].split('/').pop());

    const wrong = htmlFiles(STATIC).filter((f) => {
        const srcs = scriptSrcs(fs.readFileSync(f, 'utf8'));
        const ac = srcs.indexOf('active-channel.js');
        if (ac === -1) return false;
        return ['connection-modal.js', 'room-defaults.js']
            .some((dep) => { const i = srcs.indexOf(dep); return i !== -1 && i < ac; });
    }).map((f) => path.relative(STATIC, f));
    assert.deepStrictEqual(wrong, [], 'loaded too late in: ' + wrong.join(', '));
});

console.log('\nthe account layer');

check('every page with a nav gets the profile chip, and the account client with it', () => {
    const wrong = htmlFiles(STATIC).filter((f) => {
        const t = fs.readFileSync(f, 'utf8');
        if (!t.includes('class="site-nav"')) return false;
        return !t.includes('profile-chip.js') || !t.includes('mp-account.js');
    }).map((f) => path.relative(STATIC, f));
    assert.deepStrictEqual(wrong, [],
        'these landing pages would have no way to sign in: ' + wrong.join(', '));
});

check('every page with the modal can reach the saved list', () => {
    const wrong = htmlFiles(STATIC).filter((f) => {
        const t = fs.readFileSync(f, 'utf8');
        if (!t.includes('connection-modal.js')) return false;
        return !t.includes('keyring.js') || !t.includes('mp-account.js');
    }).map((f) => path.relative(STATIC, f));
    assert.deepStrictEqual(wrong, [],
        'the Saved tab would be permanently empty on: ' + wrong.join(', '));
});

check('the profile page is reachable at the PLATFORM root, not under /sdk/', () => {
    // The gateway lives in the sibling services repo, which a clean checkout
    // of this one alone will not have. Skip rather than fail there -- but
    // when it IS present, a missing route means profile.html 404s in
    // production while every page links to it.
    const conf = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..',
        'messaging-platform-services', 'docker', 'gateway', 'nginx.conf');
    if (!fs.existsSync(conf)) { console.log('       (services repo not present, skipped)'); return; }
    assert.ok(/location = \/messaging-platform\/profile\.html/.test(fs.readFileSync(conf, 'utf8')),
        'the gateway has no route for /messaging-platform/profile.html, so it 404s');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
