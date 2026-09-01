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
        ['createdAt', 'id', 'label', 'lastUsedAt', 'name', 'password']);
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
        ['createdAt', 'id', 'label', 'lastUsedAt', 'name', 'password'],
        'importData built a row with a different shape from add()');
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
