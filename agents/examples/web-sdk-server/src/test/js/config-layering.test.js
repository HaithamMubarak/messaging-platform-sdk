/**
 * App config may depend on saved channels. Never the other way round.
 *
 *     app config  ---->  saved channels
 *
 * The first version of the keyring put an `apps: []` array on each channel
 * row. That reads as harmless bookkeeping and is the wrong way round: it made
 * the channel list a function of which apps exist, so exporting "your
 * channels" dragged app state along, and forgetting a channel could leave an
 * app's name behind in it. Apps come and go; a channel outlives them.
 *
 * These tests exist to keep the arrow pointing one way.
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

function load() {
    const win = {};
    const localStorage = makeStore();
    for (const f of ['keyring.js', 'app-config.js']) {
        new Function('window', 'localStorage', read(f))(win, localStorage);
    }
    return { K: win.Keyring, C: win.AppConfig, localStorage };
}

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

console.log('the arrow points one way');

check('a saved channel carries no app state at all', () => {
    const { K } = load();
    const row = K.add('a1', { name: 'room-1', password: 'p' });
    assert.ok(!('apps' in row), 'the channel row grew an app field again: ' + JSON.stringify(row));
    assert.deepStrictEqual(Object.keys(row).sort(),
        ['createdAt', 'id', 'label', 'lastUsedAt', 'name', 'password', 'username']);
});

/*
 * add() is not the only door into the channel list. importData() builds rows
 * too -- from a file, which is the one input that did not come from this code
 * -- and it was pinned by nothing. An `apps` field riding in on a backup would
 * land straight in the list with the shape check above still green.
 */
check('and a row that arrives from a backup file carries none either', () => {
    const { K } = load();
    K.importData('a1', { channels: [{
        name: 'room-1', password: 'p', label: 'One',
        apps: ['chess', 'whiteboard'],       // must not survive the import
        somethingElse: 'also not ours',
    }] });
    const row = K.list('a1')[0];
    assert.ok(!('apps' in row),
        'an imported channel row carried an app field in: ' + JSON.stringify(row));
    assert.deepStrictEqual(Object.keys(row).sort(),
        ['createdAt', 'id', 'label', 'lastUsedAt', 'name', 'password', 'username'],
        'importData built a row with a different shape from add()');
});

/*
 * The same room, saved twice, is one row.
 *
 * A channel is name AND password, and both sides of that comparison were used
 * raw -- so a caller omitting the password and one passing '' described the
 * same passwordless room and did not match each other. add() then failed to
 * find the existing row and appended a second one.
 */
check('a missing password and an empty one are the same room', () => {
    const { K } = load();
    const first = K.add('a1', { name: 'open-room' });                 // no password key
    const again = K.add('a1', { name: 'open-room', password: '' });   // explicitly empty
    assert.strictEqual(K.list('a1').length, 1,
        'the same passwordless room was saved twice: ' + JSON.stringify(K.list('a1')));
    assert.strictEqual(again.id, first.id, 'add() returned a different row for the same room');

    assert.ok(K.has('a1', 'open-room'), 'has() cannot find a room saved without a password');
    assert.ok(K.has('a1', 'open-room', ''), 'has() disagrees with itself about the same room');
    assert.ok(K.touch('a1', 'open-room'), 'touch() cannot find it either');
});

check('but a different password is still a different room', () => {
    const { K } = load();
    K.add('a1', { name: 'room', password: 'one' });
    K.add('a1', { name: 'room', password: 'two' });
    assert.strictEqual(K.list('a1').length, 2,
        'two rooms sharing a name but not a password were merged into one');
});

check('a saved channel keeps the name used in that channel', () => {
    const { K } = load();
    const one = K.add('a1', { name: 'work', password: 'p1', username: 'Amina' });
    const two = K.add('a1', { name: 'friends', password: 'p2', username: 'Mina' });
    K.add('a1', { name: 'work', password: 'p1', username: 'Amina (work)' });
    K.touch('a1', 'friends', 'p2', 'Amina at home');

    const rows = K.list('a1');
    assert.strictEqual(rows.length, 2, 'updating a channel profile duplicated the room');
    assert.strictEqual(rows.filter((r) => r.id === one.id)[0].username, 'Amina (work)');
    assert.strictEqual(rows.filter((r) => r.id === two.id)[0].username, 'Amina at home');
});

check('a newer backup fills a missing channel name but never overwrites one', () => {
    const { K } = load();
    K.add('a1', { name: 'work', password: 'p' });
    let result = K.importData('a1', { channels: [{
        name: 'work', password: 'p', username: 'Amina\nfrom work'
    }] });
    assert.deepStrictEqual(result, { added: 0, skipped: 1, updated: 1, invalid: 0 });
    assert.strictEqual(K.list('a1')[0].username, 'Amina from work');

    result = K.importData('a1', { channels: [{
        name: 'work', password: 'p', username: 'Different person'
    }] });
    assert.deepStrictEqual(result, { added: 0, skipped: 1, updated: 0, invalid: 0 });
    assert.strictEqual(K.list('a1')[0].username, 'Amina from work');
});

check('a channel alias can be reset to the account default', () => {
    const { K } = load();
    const row = K.add('a1', { name: 'work', password: 'p', username: 'Amina' });
    assert.ok(K.setUsername('a1', row.id, ''));
    assert.strictEqual(K.list('a1')[0].username, '');
});

check('a channel alias cannot cross a Platform account boundary', () => {
    const { K } = load();
    K.add('a1', { name: 'work', password: 'p', username: 'Amina' });
    K.add('a2', { name: 'work', password: 'p', username: 'Basil' });
    assert.strictEqual(K.list('a1')[0].username, 'Amina');
    assert.strictEqual(K.list('a2')[0].username, 'Basil');
});

check('the connection picker restores the channel-specific name', () => {
    const modal = read('connection-modal.js');
    assert.ok(/recordConnect\(channel, password, username\)/.test(modal),
        'the connected name is not passed into the saved channel');
    assert.ok(/if \(userEl\) userEl\.value = joinAs/.test(modal),
        'choosing a saved channel does not restore its name');
});

check('legacy rows and failed attempts cannot leak or overwrite an identity', () => {
    const modal = read('connection-modal.js');
    assert.ok(/var joinAs = row\.username \|\| accountDefaultName\(\)/.test(modal),
        'a legacy row keeps the alias selected immediately before it');
    const attempt = modal.slice(modal.indexOf('function attempt(username)'),
        modal.indexOf('if (connectBtn && onConnect)', modal.indexOf('function attempt(username)')));
    assert.ok(attempt.indexOf('persistValues(username, channel, password)')
        > attempt.indexOf("!modal.classList.contains('active')"),
        'a failed connection attempt rewrites the persisted identity');
    assert.ok(/function usernameKey\([\s\S]*accountId/.test(modal),
        'a signed-in account still uses the browser-global username key');
});

check('the keyring source never mentions apps', () => {
    // A comment is fine; a field or parameter is the regression.
    const src = read('keyring.js');
    assert.ok(!/\bapps\s*:/.test(src), 'keyring.js declares an apps field');
    assert.ok(!/entry\.app\b/.test(src), 'keyring.js reads an app off its input');
});

check('an export of your channels is exactly that', () => {
    const { K, C } = load();
    const row = K.add('a1', { name: 'room-1', password: 'p' });
    C.noteChannel('a1', 'whiteboard', row.id);
    const dump = JSON.stringify(K.exportData('a1'));
    assert.ok(dump.indexOf('whiteboard') === -1, 'app state leaked into the channel export');
});

console.log('\napp config depends on channels, by reference');

check('an app records the channel it used', () => {
    const { K, C } = load();
    const row = K.add('a1', { name: 'room-1', password: 'p' });
    C.noteChannel('a1', 'whiteboard', row.id);
    assert.strictEqual(C.get('a1', 'whiteboard').lastChannelId, row.id);
});

check('which apps used a channel is derived by asking the apps', () => {
    const { K, C } = load();
    const row = K.add('a1', { name: 'room-1', password: 'p' });
    C.noteChannel('a1', 'whiteboard', row.id);
    C.noteChannel('a1', 'chess', row.id);
    assert.deepStrictEqual(C.appsUsing('a1', row.id), ['chess', 'whiteboard']);
});

check('it stores an id, not a copy of the room', () => {
    const { K, C, localStorage } = load();
    const row = K.add('a1', { name: 'secret-room', password: 'hunter2' });
    C.noteChannel('a1', 'whiteboard', row.id);
    const cfg = localStorage._map.get('mp.appconfig.v1.a1');
    assert.ok(cfg.indexOf('secret-room') === -1 && cfg.indexOf('hunter2') === -1,
        'app config copied the room instead of referencing it: ' + cfg);
});

check('renaming a channel needs no app to be told', () => {
    const { K, C } = load();
    const row = K.add('a1', { name: 'room-1', password: 'p' });
    C.noteChannel('a1', 'whiteboard', row.id);
    K.rename('a1', row.id, 'Team Friday');
    assert.deepStrictEqual(C.appsUsing('a1', row.id), ['whiteboard']);
    assert.strictEqual(K.list('a1')[0].label, 'Team Friday');
});

check('forgetting a channel clears the references pointing at it', () => {
    const { K, C } = load();
    const row = K.add('a1', { name: 'room-1', password: 'p' });
    C.noteChannel('a1', 'whiteboard', row.id);
    K.remove('a1', row.id);
    C.forgetChannel('a1', row.id);
    assert.deepStrictEqual(C.appsUsing('a1', row.id), []);
    assert.strictEqual(C.get('a1', 'whiteboard').lastChannelId, undefined);
});

check('two accounts keep separate app state', () => {
    const { K, C } = load();
    const row = K.add('a1', { name: 'room-1', password: 'p' });
    C.noteChannel('a1', 'whiteboard', row.id);
    assert.deepStrictEqual(C.appsUsing('a2', row.id), []);
});

console.log('\nthe wiring');

function htmlFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? htmlFiles(full) : (e.name.endsWith('.html') ? [full] : []);
    });
}

check('the app-facing API loads wherever the keyring does', () => {
    const STATIC = path.join(DIR, '..');
    const missing = htmlFiles(STATIC).filter((f) => {
        const t = fs.readFileSync(f, 'utf8');
        return t.includes('app-config.js') && !t.includes('mp.js');
    }).map((f) => path.relative(STATIC, f));
    assert.deepStrictEqual(missing, [],
        'an app on these pages would have to reach into storage itself: ' + missing.join(', '));
});

check('every page with the keyring also has app config', () => {
    const STATIC = path.join(DIR, '..');
    const missing = htmlFiles(STATIC).filter((f) => {
        const t = fs.readFileSync(f, 'utf8');
        return t.includes('keyring.js') && !t.includes('app-config.js');
    }).map((f) => path.relative(STATIC, f));
    assert.deepStrictEqual(missing, [], 'app chips would be permanently empty on: ' + missing.join(', '));
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
