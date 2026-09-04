/**
 * What an app is allowed to see.
 *
 * The platform owns the person and the saved-channel list; an app references
 * the person by id and borrows channels. This API is the sanctioned way to do
 * both, and its shape is load-bearing: it must never return a channel
 * password, so that the day the list moves behind its own origin and
 * connect() starts exchanging a join token, every caller written against it
 * keeps working unchanged.
 *
 * These tests defend that shape. They do NOT claim an app cannot go around it
 * — on one origin it can, and mp.js says so in its own header.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

function makeStore() {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null),
             setItem: (k, v) => map.set(k, String(v)),
             removeItem: (k) => map.delete(k), _map: map };
}

/** Everything loaded together, with a stubbed signed-in account. */
function load(user) {
    const win = {};
    const localStorage = makeStore();
    for (const f of ['keyring.js', 'app-config.js']) {
        new Function('window', 'localStorage', read(f))(win, localStorage);
    }
    win.MPAccount = {
        signedIn: () => !!user,
        me: () => Promise.resolve(user),
        idOf: (u) => (u ? String(u.id) : null),
    };
    new Function('window', read('mp.js'))(win);
    return { MP: win.MP, K: win.Keyring, C: win.AppConfig, localStorage };
}

const USER = { id: 'u_1', displayName: 'Amina', email: 'amina@example.com',
               googleSub: 'g-123', passwordHash: 'never', };

let failures = 0;
const checks = [];
function check(name, fn) { checks.push([name, fn]); }

check('a channel reference carries no password', async () => {
    const { MP, K } = load(USER);
    K.add('u_1', { name: 'room-1', password: 'hunter2' });
    const rows = await MP.channels.list();
    assert.strictEqual(rows.length, 1);
    assert.ok(!('password' in rows[0]),
        'list() returned a password: ' + JSON.stringify(rows[0]));
    assert.deepStrictEqual(Object.keys(rows[0]).sort(),
        ['id', 'label', 'lastUsedAt', 'name']);
});

check('and no serialisation of the list contains one', async () => {
    const { MP, K } = load(USER);
    K.add('u_1', { name: 'room-1', password: 'hunter2' });
    const dump = JSON.stringify(await MP.channels.list());
    assert.ok(dump.indexOf('hunter2') === -1, 'the password leaked through list(): ' + dump);
});

check('the profile is narrow: id and display name only', async () => {
    const { MP } = load(USER);
    const p = await MP.profile.current();
    assert.deepStrictEqual(Object.keys(p).sort(), ['displayName', 'id']);
    const dump = JSON.stringify(p);
    // googleSub is an account-merge key: leaking it lets one app correlate a
    // person across services.
    ['g-123', 'amina@example.com', 'never'].forEach((secret) => {
        assert.ok(dump.indexOf(secret) === -1, 'profile leaked ' + secret);
    });
});

check('email is a separate, explicit call', async () => {
    const { MP } = load(USER);
    assert.strictEqual(await MP.profile.email(), 'amina@example.com');
});

check('signed out, there is no person and no list', async () => {
    const { MP } = load(null);
    assert.strictEqual(await MP.profile.current(), null);
    assert.deepStrictEqual(await MP.channels.list(), []);
});

check('connect hands the room to the SDK and returns only what the SDK returns', async () => {
    const { MP, K } = load(USER);
    const row = K.add('u_1', { name: 'room-1', password: 'hunter2' });
    let handed = null;
    const result = await MP.channels.connect(row.id, {
        appId: 'whiteboard',
        connect: (args) => { handed = args; return 'a-connection'; },
    });
    assert.strictEqual(result, 'a-connection');
    assert.strictEqual(handed.channelName, 'room-1');
    assert.strictEqual(handed.channelPassword, 'hunter2',
        'the SDK still needs the password today; only the CALLER must not get it');
});

check('connect uses the saved per-channel profile name by default', async () => {
    const { MP, K } = load(USER);
    const row = K.add('u_1', {
        name: 'room-1', password: 'hunter2', username: 'Amina from work'
    });
    let handed = null;
    await MP.channels.connect(row.id, {
        appId: 'whiteboard', connect: (args) => { handed = args; }
    });
    assert.strictEqual(handed.username, 'Amina from work');
});

check('connect never RETURNS the password to its caller', async () => {
    const { MP, K } = load(USER);
    const row = K.add('u_1', { name: 'room-1', password: 'hunter2' });
    const result = await MP.channels.connect(row.id, {
        appId: 'whiteboard', connect: () => ({ ok: true }),
    });
    assert.ok(JSON.stringify(result).indexOf('hunter2') === -1);
});

check('connect refuses an unknown channel rather than inventing one', async () => {
    const { MP } = load(USER);
    await assert.rejects(() => MP.channels.connect('k_nope', { connect: () => 1 }),
        /not saved on this device/);
});

check('connect refuses when there is nowhere to hand the room', async () => {
    const { MP, K } = load(USER);
    const row = K.add('u_1', { name: 'room-1', password: 'p' });
    await assert.rejects(() => MP.channels.connect(row.id, {}), /connect function/);
});

check('connecting records the app against the channel, one way only', async () => {
    const { MP, K, C } = load(USER);
    const row = K.add('u_1', { name: 'room-1', password: 'p' });
    await MP.channels.connect(row.id, { appId: 'chess', connect: () => 1 });
    assert.deepStrictEqual(C.appsUsing('u_1', row.id), ['chess']);
    assert.ok(!('apps' in K.list('u_1')[0]), 'the channel row grew app state');
});

check('a failed connect leaves recency, alias and app history untouched', async () => {
    const { MP, K, C } = load(USER);
    const row = K.add('u_1', { name: 'room-1', password: 'p', username: 'Before' });
    const before = K.list('u_1')[0].lastUsedAt;
    await assert.rejects(() => MP.channels.connect(row.id, {
        appId: 'chess', username: 'After', connect: () => Promise.reject(new Error('offline'))
    }), /offline/);
    const after = K.list('u_1')[0];
    assert.strictEqual(after.username, 'Before');
    assert.strictEqual(after.lastUsedAt, before);
    assert.deepStrictEqual(C.appsUsing('u_1', row.id), []);
});

check('an app can keep its own settings, keyed by the platform person', async () => {
    const { MP } = load(USER);
    await MP.app.set('chess', { boardTheme: 'wood' });
    assert.strictEqual((await MP.app.get('chess')).boardTheme, 'wood');
});

check('the guarantee it advertises is the one it can keep', () => {
    const { MP } = load(USER);
    assert.strictEqual(MP.guarantees.passwordsNeverReturned, true);
    // The day this flips to true without a frame on another origin, somebody
    // is claiming a wall they do not have.
    assert.strictEqual(MP.guarantees.appsCannotReadStorage, false);
    assert.ok(/not\s+a\s+wall/i.test(MP.guarantees.statement),
        'the advertised statement stopped admitting it is a policy');

    /*
     * Pinning the two keys that exist only stops those two flipping. A NEW
     * key -- `channelsEncryptedAtRest: true`, say -- is a fresh claim nobody
     * checked, and it would be advertised to every app with this suite green.
     * The set is the guarantee, not just its current values.
     */
    assert.deepStrictEqual(Object.keys(MP.guarantees).sort(),
        ['appsCannotReadStorage', 'passwordsNeverReturned', 'statement'],
        'MP.guarantees grew or lost a claim. A new guarantee is a new promise: '
      + 'prove the code keeps it, then add it here deliberately.');
});

(async () => {
    console.log('what an app may see');
    for (const [name, fn] of checks) {
        try { await fn(); console.log('  ok   ' + name); }
        catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
    }
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
