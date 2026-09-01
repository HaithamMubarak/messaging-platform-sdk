/**
 * RULE 7 — a channel is a credential; the room is `channel + "." + appId`.
 *
 * One channel used to mean one room shared by every app at once. That was
 * never decided, it was what shipped, and it does not work: host authority is
 * channel-wide while apps are not, and the customType filter throws foreign
 * traffic away — so a peer from another app in your room is not a
 * collaborator, it is an inert seat. It stalls a game waiting on a quorum that
 * cannot act, absorbs a dealt mission, and (because WebRTC media never passes
 * through the message filter at all) can be handed a live camera stream.
 *
 * The room is now derived at one choke point, `UserConnectionBase.wireRoom`.
 * Everything above it — the visible field, the keyring row, `mp.active.v1`,
 * the invite hash — keeps the BARE channel. These pin both halves of that:
 * the suffix is applied on the wire, and it is applied NOWHERE else.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');

/* The real class, loaded the way a page loads it. */
function loadClass() {
    const src = fs.readFileSync(path.join(STATIC, 'js', 'UserConnectionBase.js'), 'utf8');
    const win = { addEventListener() {}, removeEventListener() {} };
    const sandbox = {
        window: win, document: { addEventListener() {} },
        console: { log() {}, warn() {}, error() {} },
        navigator: { onLine: true },
    };
    new Function('window', 'document', 'console', 'navigator', 'globalThis',
        src + '\n;window.__UCB = UserConnectionBase;')(
        sandbox.window, sandbox.document, sandbox.console, sandbox.navigator, sandbox);
    return win.__UCB;
}

const UCB = loadClass();

/** wireRoom as connect() calls it: options plus the declared-app flag. */
function room(channel, opts, declared) {
    return UCB.wireRoom(channel, { ...(opts || {}), _appDeclared: declared !== false });
}

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

console.log('the room an app joins');

check('a declared app gets a room of its own', () => {
    assert.strictEqual(room('standup', { customType: 'whiteboard' }), 'standup.whiteboard');
    assert.strictEqual(room('standup', { customType: 'chess' }), 'standup.chess');
});

check('two apps on one channel are in DIFFERENT rooms — this is the decision', () => {
    const a = room('standup', { customType: 'whiteboard' });
    const b = room('standup', { customType: 'chess' });
    assert.notStrictEqual(a, b,
        'two apps on one channel landed in the same room, which is the bug Rule 7 exists to remove');
});

check('and two people in the SAME app on one channel still meet', () => {
    assert.strictEqual(room('standup', { customType: 'whiteboard' }),
                       room('standup', { customType: 'whiteboard' }),
        'the channel stopped following a person between browsers, which is the feature');
});

check('a caller that declares no app keeps the room it always had', () => {
    // A third-party caller outside this repo must not have its wire room
    // changed by a version bump. `customType` defaults to 'session', so this
    // turns on DECLARED, never on truthiness.
    assert.strictEqual(room('standup', { customType: 'session' }, false), 'standup');
    assert.strictEqual(room('standup', {}, false), 'standup');
});

check('a tool that watches a room names it exactly', () => {
    assert.strictEqual(room('standup.whiteboard', { promiscuous: true }), 'standup.whiteboard',
        'a promiscuous page was confined to one app room, which it cannot be');
    assert.strictEqual(room('standup', { customType: 'whiteboard', rawRoom: true }), 'standup');
});

check('a dotted appId is refused rather than silently colliding', () => {
    // Without this, `a.b` + `c` and `a` + `b.c` are one room and two apps
    // share it without either being told.
    assert.throws(() => room('standup', { customType: 'mini.games' }), /customType must match/);
    assert.throws(() => room('standup', { customType: 'Whiteboard' }), /customType must match/);
    assert.throws(() => room('standup', { customType: 'white board' }), /customType must match/);
    assert.throws(() => room('standup', { customType: 'app_1' }), /customType must match/);
});

check('the channel itself may contain dots without ambiguity', () => {
    // The segment after the LAST dot identifies the app, and an appId cannot
    // contain one, so a dotted channel name stays unambiguous.
    const r = room('my.room', { customType: 'whiteboard' });
    assert.strictEqual(r, 'my.room.whiteboard');
    assert.strictEqual(r.slice(r.lastIndexOf('.') + 1), 'whiteboard');
});

console.log('\nthe suffix exists on the wire and nowhere else');

check('connect records the BARE channel, and joins the suffixed room', () => {
    const src = fs.readFileSync(path.join(STATIC, 'js', 'UserConnectionBase.js'), 'utf8');
    assert.ok(/this\.channelName = channelName;\s*\/\/ bare, always/.test(src),
        'this.channelName is no longer the bare channel, so the UI, the keyring '
      + 'and every invite would start showing a wire room name');
    assert.ok(/channelName: wireRoom,/.test(src),
        'the join call no longer sends the derived room');
});

check('the keyring stores channels, not rooms', () => {
    for (const file of ['keyring.js', 'active-channel.js', 'app-config.js', 'mp.js']) {
        const src = fs.readFileSync(path.join(STATIC, 'js', file), 'utf8');
        assert.ok(!/wireRoom/.test(src),
            file + ' derives a wire room. Only the connect layer may: a saved '
          + 'channel that recorded one app\'s room could never be opened in another app.');
    }
});

check('an invite carries the bare channel, so both ends derive the same room', () => {
    const modal = fs.readFileSync(path.join(STATIC, 'js', 'connection-modal.js'), 'utf8');
    assert.ok(!/wireRoom/.test(modal),
        'the modal builds a wire room; an invite would then carry one app\'s room '
      + 'and be undecodable by any other app, breaking Rule 6');
});

console.log('\nevery app on this site can actually derive a room');

check('no page declares a customType that wireRoom would refuse', () => {
    // wireRoom THROWS on a bad appId, and it throws inside connect() -- so a
    // customType with a capital letter or a space is not a lint problem, it is
    // a page that cannot connect at all. Catch it here instead.
    const walk = (dir, out = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full, out);
            else if (/\.(js|html)$/.test(e.name)) out.push(full);
        }
        return out;
    };
    const bad = [];
    for (const file of walk(STATIC)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/customType:\s*'([^']*)'/g)) {
            const appId = m[1];
            // The default lives in UserConnectionBase and is never declared.
            if (file.endsWith('UserConnectionBase.js')) continue;
            if (!/^[a-z0-9-]+$/.test(appId)) {
                bad.push(path.relative(STATIC, file) + ": '" + appId + "'");
            }
        }
    }
    assert.deepStrictEqual(bad, [],
        'these declare a customType that wireRoom refuses, so the page throws on '
      + 'connect: ' + bad.join(', '));
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
