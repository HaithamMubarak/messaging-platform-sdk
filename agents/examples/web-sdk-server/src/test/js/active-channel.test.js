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

/*
 * Re-pinned 2026-10-01. These two checks guarded "two separate accounts,
 * neither signs you in to the other". The portal was unified with the Platform
 * identity on purpose (303cd91, 6be0160): your Platform account becomes your
 * developer identity once API access is approved. What still holds, and is
 * worth guarding, is the boundary: being signed in to the Platform account
 * never opens developer keys, which keep their own scoped session, and the
 * portal says which ways in it accepts. Each assertion below went red when
 * the phrase it pins was removed.
 */
check('the account doors are labelled, and the profile states the developer boundary', () => {
    const chip = fs.readFileSync(path.join(STATIC, 'js', 'profile-chip.js'), 'utf8');
    assert.ok(chip.includes("a.textContent = 'Platform account'"),
        'the shared account entry no longer says which account it opens');
    assert.ok(chip.includes("Sign in to your Platform account"),
        'the signed-out account entry has no accessible platform-account label');

    const ambiguousPortal = htmlFiles(STATIC).filter((f) => {
        const t = fs.readFileSync(f, 'utf8');
        return t.includes('developer/index.html') && t.includes('>Portal<');
    }).map((f) => path.relative(STATIC, f));
    assert.deepStrictEqual(ambiguousPortal, [],
        'these pages still hide the Developer Portal behind an ambiguous label: ' + ambiguousPortal.join(', '));

    const profile = fs.readFileSync(path.join(STATIC, 'profile.html'), 'utf8').replace(/\s+/g, ' ');
    assert.ok(profile.includes('when API access is approved'),
        'the profile page no longer says developer access depends on approval');
    assert.ok(/own scoped session/.test(profile),
        'the profile page no longer says developer keys stay behind their own session');
});

/*
 * The slice is called "label BOTH doors", and the check above only ever looked
 * at one of them. The Developer Portal is the other door, and the connection
 * modal is the platform-account door that a visitor is far more likely to meet
 * first -- it is on every demo page, where profile.html is on none of them.
 */
check('the Developer Portal says how you get in, and keeps keys apart from the Platform session', () => {
    // Normalised: this copy is prose in an indented HTML block, so where the
    // lines happen to wrap must not decide whether the check passes.
    const read = (page) => fs.readFileSync(path.join(STATIC, page), 'utf8').replace(/\s+/g, ' ');
    const signIn = read('developer/index.html');
    assert.ok(/Google identity/.test(signIn) && /developer credentials/.test(signIn),
        'the portal sign-in page does not say which ways in it accepts');
    const dash = read('developer/dashboard.html');
    assert.ok(/separately scoped developer session/.test(dash),
        'the dashboard no longer says API keys keep their own session');
    assert.ok(/without sharing passwords, sessions, or API keys/.test(dash),
        'the dashboard no longer says what linking the identity does NOT share');
    for (const [page, t] of [['developer/index.html', signIn], ['developer/dashboard.html', dash]]) {
        assert.ok(t.includes('/messaging-platform/profile.html'),
            page + ' never points at the Platform profile, so the two doors stay unrelated');
    }
});

check('the connection modal names the Platform account rather than "an account"', () => {
    const modal = fs.readFileSync(path.join(STATIC, 'js', 'connection-modal.js'), 'utf8');
    assert.ok(modal.includes('Platform account'),
        'the modal asks people to "sign in" without saying to what');
    assert.ok(modal.includes('Developer'),
        'the modal never distinguishes itself from the Developer Portal account');

    // Rule 5 is stated here in prose; keep the prose honest.
    assert.ok(/do not\s+need either to join a room/.test(modal.replace(/\s+/g, ' ')),
        'the modal no longer promises that joining a room needs no account');
});

/*
 * Rule 5: an account gates SAVING, never CONNECTING.
 *
 * What a first-time, signed-out visitor meets has to stay one click. Nothing
 * asserted this once: the whole front door could be deleted, or its handler
 * could grow an "if (!accountId) return showSignin()", and all seven suites
 * stayed green while every demo quietly closed.
 *
 * The door was a collapsed quick card (a name and Connect) until 2026-10-05,
 * when the dialog stopped collapsing. It is now the name above the tabs and
 * the Code tab's Join, with a new room's code already filled in. These two
 * checks moved with it; the promise is the same.
 */
check('the one-click way in an anonymous visitor meets still exists', () => {
    const modal = fs.readFileSync(path.join(STATIC, 'js', 'connection-modal.js'), 'utf8');
    for (const needle of ['id="usernameInput"', 'id="partyCodeInput"', 'id="codeJoinBtn"']) {
        assert.ok(modal.includes(needle), 'the Code tab lost ' + needle + ', so the one-click path is gone');
    }
    // A first visit is offered a room, so Join works before anything is typed.
    assert.ok(/var fresh = freshRoom\(\);/.test(modal) && /chEl\.value = .*\|\| fresh\.channel/.test(modal),
        'a first visit is no longer offered a room to join');
});

check('and joining from it is not gated on an account', () => {
    const modal = fs.readFileSync(path.join(STATIC, 'js', 'connection-modal.js'), 'utf8');
    // Both halves of Join: the tab's click handler and the modal's join callback.
    const bodies = [['function join() {', '\n        }'], ['join: function () {', '\n            }']].map(([from, to]) => {
        const start = modal.indexOf(from);
        assert.ok(start > 0, 'Join no longer has a handler (' + from + ')');
        return modal.slice(start, modal.indexOf(to, start));
    });
    assert.ok(bodies.some((b) => /attempt\(/.test(b)) && bodies.some((b) => /o\.join\(\)/.test(b)),
        'Join no longer actually connects');
    for (const body of bodies) {
        for (const gate of ['accountId', 'MPAccount', 'signedIn', 'panelSignin', 'showTab']) {
            assert.ok(!body.includes(gate),
                'Join now consults ' + gate + ' -- an account has started gating '
              + 'CONNECTING, which rule 5 forbids; it may gate saving only');
        }
    }
});

check('an account gates the SAVE control, and only that', () => {
    const modal = fs.readFileSync(path.join(STATIC, 'js', 'connection-modal.js'), 'utf8');
    // The save checkbox is the one control allowed to care whether you are
    // signed in. If this stops being true, the line below has moved and the
    // check above is no longer describing the real boundary.
    assert.ok(/chk\.disabled = !accountId/.test(modal),
        'the save checkbox is no longer what an account gates');
});

/*
 * The save checkbox shows whether the channel IS saved -- refreshSaveRow ticks
 * it from Keyring.has -- so unticking it has to be able to unsay it. It used to
 * call touch(), which only bumps lastUsedAt on a row that is already there: the
 * channel stayed saved and the box came back ticked next time. A control that
 * reports state and cannot change it is lying about what it is.
 */
check('the account chip is a real target on a touch screen', () => {
    // It is an <a class="mp-chip">, not a .btn, so every rule in the
    // coarse-pointer block missed it and it stayed the height of the initial
    // circle inside it -- about 24px. It is the only way to reach the platform
    // account from most pages.
    const ui = fs.readFileSync(path.join(STATIC, 'css', 'ui.css'), 'utf8');
    const i = ui.indexOf('@media (pointer: coarse)');
    assert.ok(i > 0, 'the coarse-pointer block is gone');
    const block = ui.slice(i, ui.indexOf('\n}', i));
    assert.ok(/\.mp-chip\s*\{[^}]*min-height:\s*44px/.test(block),
        'the account chip is not given a 44px target on a touch screen');
});

check('unticking "save this channel" actually unsaves it', () => {
    const modal = fs.readFileSync(path.join(STATIC, 'js', 'connection-modal.js'), 'utf8');
    const start = modal.indexOf("var chk = document.getElementById('saveChannelChk');");
    assert.ok(start > 0, 'the save checkbox is no longer read on connect');
    const body = modal.slice(start, start + 1600);

    assert.ok(/Keyring\.add\(/.test(body), 'ticking it no longer saves');
    assert.ok(/Keyring\.remove\(/.test(body),
        'unticking the box does not remove the saved channel, so the box ticks '
      + 'itself again next time and the control does nothing');
    assert.ok(/AppConfig\.forgetChannel\(/.test(body),
        'the channel was removed but the app references pointing at it by id '
      + 'were left aimed at a row that no longer exists');
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
