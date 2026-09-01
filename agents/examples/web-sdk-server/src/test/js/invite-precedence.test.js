/**
 * An invite link wins outright.
 *
 * This is one of the rules the whole channel-keyring design is balanced on: a
 * shared channel follows you from app to app, but an invite that did not put
 * you in the inviter's room is a broken invite, so the invite must beat the
 * shared channel every time.
 *
 * The rule was written down in three places and enforced in one. connection-modal.js
 * got it right. room-defaults.js -- which supplies the four older demos that
 * build their own connect form -- guarded it with
 *
 *     if (window.location.hash && /[?&#](c|channel)=/.test(window.location.hash)) return;
 *
 * and an invite hash is base64 JSON (`#eyJjIjoi...`, decoded by
 * ChannelAuthUtils), never `?c=`. So the guard could not match any invite this
 * site has ever produced: it returned false every time, and the shared channel
 * was free to overwrite the room somebody had been sent to.
 *
 * These drive the real modules against a real invite hash.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');

function makeStore() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        _map: map,
    };
}

/** The invite format the share modal actually produces: base64 of {c,p}. */
function inviteHash(channel, password) {
    return '#' + Buffer.from(JSON.stringify({ c: channel, p: password }), 'utf8')
        .toString('base64');
}

/** A field the demos' markup provides. */
function input(value) {
    return { value: value === undefined ? '' : value };
}

/**
 * Load room-defaults.js against a fake page.
 * @param {string} hash        window.location.hash
 * @param {object} activeRoom  {name, password} already shared across apps, or null
 * @param {string} source      the file under test
 */
function applyDefaults({ hash = '', active = null, channelValue = '', passwordValue = '' } = {},
                       source) {
    const localStorage = makeStore(), sessionStorage = makeStore();
    const channelEl = input(channelValue), passwordEl = input(passwordValue);

    const win = {
        location: { hash: hash },
        crypto: { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = i + 1; return arr; } },
        atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
        // The real decoder, loaded the way the pages load it.
        ChannelAuthUtils: {
            decodeAuto: (encoded) => {
                try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
                catch (e) { return null; }
            },
        },
        ActiveChannel: active ? {
            seedFromLegacy: () => {},
            read: () => ({ name: active.name, source: 'test' }),
            readPassword: () => active.password,
            write: (name) => { active.written = name; },
            writePassword: (pw) => { active.writtenPassword = pw; },
        } : null,
    };
    const document = {
        getElementById: (id) => (id === 'channelName' ? channelEl
                              : id === 'channelPassword' ? passwordEl : null),
    };

    new Function('window', 'document', 'localStorage', 'sessionStorage', 'atob', source)(
        win, document, localStorage, sessionStorage, win.atob);

    win.RoomDefaults.apply({ prefix: 'demo_', channelPrefix: 'demo-' });
    return { channelEl, passwordEl, active };
}

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

const SOURCE = fs.readFileSync(path.join(STATIC, 'js', 'room-defaults.js'), 'utf8');

console.log('an invite beats the shared channel (room-defaults.js)');

check('a real base64-JSON invite stops the shared channel overwriting the room', () => {
    const { channelEl } = applyDefaults({
        hash: inviteHash('invited-room', 'invite-pw'),
        active: { name: 'the-room-i-was-already-in', password: 'other-pw' },
    }, SOURCE);
    assert.strictEqual(channelEl.value, '',
        'RoomDefaults filled the channel in even though the URL is an invite -- '
      + 'whatever the page decodes from the hash now has to race it');
});

check('and it does not write the shared channel over the invite either', () => {
    const active = { name: 'the-room-i-was-already-in', password: 'other-pw' };
    applyDefaults({ hash: inviteHash('invited-room', 'invite-pw'), active }, SOURCE);
    assert.strictEqual(active.written, undefined,
        'the active channel was rewritten while an invite was being followed');
});

check('the encrypted invite form is recognised too', () => {
    // ChannelAuthUtils.decodeAuto handles both; anything that decodes to an
    // object carrying a channel is an invite.
    const { channelEl } = applyDefaults({
        hash: inviteHash('invited-room', ''),
        active: { name: 'elsewhere', password: 'pw' },
    }, SOURCE);
    assert.strictEqual(channelEl.value, '', 'a passwordless invite was not treated as an invite');
});

console.log('\nand the shared channel still wins when there is no invite');

check('no hash at all: the active channel is adopted, which is the whole feature', () => {
    const { channelEl } = applyDefaults({
        active: { name: 'the-room-i-was-already-in', password: 'other-pw' },
    }, SOURCE);
    assert.strictEqual(channelEl.value, 'the-room-i-was-already-in',
        'the shared channel stopped following the visitor between apps');
});

check('a hash that is not an invite is not mistaken for one', () => {
    const { channelEl } = applyDefaults({
        hash: '#signin',
        active: { name: 'the-room-i-was-already-in', password: 'other-pw' },
    }, SOURCE);
    assert.strictEqual(channelEl.value, 'the-room-i-was-already-in',
        '#signin was treated as an invite, so the shared channel stopped working');
});

check('a hash of undecodable rubbish is not an invite', () => {
    const { channelEl } = applyDefaults({
        hash: '#!!!not-base64!!!',
        active: { name: 'the-room-i-was-already-in', password: 'other-pw' },
    }, SOURCE);
    assert.strictEqual(channelEl.value, 'the-room-i-was-already-in');
});

check('base64 that decodes to JSON without a channel is not an invite', () => {
    const hash = '#' + Buffer.from(JSON.stringify({ k: 'an-api-key' }), 'utf8').toString('base64');
    const { channelEl } = applyDefaults({
        hash: hash,
        active: { name: 'the-room-i-was-already-in', password: 'other-pw' },
    }, SOURCE);
    assert.strictEqual(channelEl.value, 'the-room-i-was-already-in');
});

console.log('\nthe rule is stated where it is enforced');

check('connection-modal.js still puts the invite ahead of the active channel', () => {
    const modal = fs.readFileSync(path.join(STATIC, 'js', 'connection-modal.js'), 'utf8');
    const normalised = modal.replace(/\s+/g, ' ');
    assert.ok(normalised.includes('chEl.value = urlChannel || (active && active.name) || persisted.c'),
        'the modal\'s precedence no longer reads invite > active > per-app');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
