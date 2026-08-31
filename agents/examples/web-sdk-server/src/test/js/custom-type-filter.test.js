/**
 * A custom message must reach only the app that sent its kind.
 *
 * Every app declares a `customType` on connect and the platform echoes it
 * back on receive, but nothing read it: onGameMessage was handed every custom
 * message on the channel whoever sent it. That was survivable only while each
 * app generated its own channel name, so two apps in one room was an accident.
 *
 * It is not a theoretical problem. These `data.type` values are used by more
 * than one app today:
 *
 *   stroke-batch  whiteboard, pictionary
 *   game-sync     chess, pictionary
 *   game-start    air-hockey, pictionary, reactor
 *   game-state    air-hockey, reactor
 *   game-end      air-hockey, pictionary, reactor
 *   new-game      air-hockey, chess
 *
 * So a whiteboard and a pictionary in one room means the whiteboard applying
 * pictionary's strokes. This test drives the real dispatch path in the real
 * shipped file -- not a copy of the rule -- and fails if the filter is removed.
 */
const assert = require('assert');
const path = require('path');

// The file assigns to `window` at load; give it somewhere to land.
global.window = global.window || {};
const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const { UserConnectionBase } = require(path.join(STATIC, 'js', 'UserConnectionBase.js'));

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

/** A session with the given options, without running the real constructor. */
function session(options) {
    const s = Object.create(UserConnectionBase.prototype);
    s.options = options;
    return s;
}

console.log('custom message routing');

check('a message from another app is refused', () => {
    assert.strictEqual(session({ customType: 'whiteboard' }).acceptsCustomType('pictionary'), false);
});

check('a message from our own app is accepted', () => {
    assert.strictEqual(session({ customType: 'whiteboard' }).acceptsCustomType('whiteboard'), true);
});

check('an unattributable message is accepted, so older senders keep working', () => {
    const s = session({ customType: 'whiteboard' });
    assert.strictEqual(s.acceptsCustomType(undefined), true);
    assert.strictEqual(s.acceptsCustomType(''), true);
});

check('an app that declares no customType still sees everything', () => {
    assert.strictEqual(session({}).acceptsCustomType('chess'), true);
});

check('promiscuous sees other apps, which is what Under the Hood is for', () => {
    assert.strictEqual(
        session({ customType: 'hood', promiscuous: true }).acceptsCustomType('air-hockey'), true);
});

/*
 * The predicate being right is not the same as the dispatcher calling it, and
 * the bug being fixed was precisely a check that existed nowhere. So drive the
 * listener the platform actually invokes and assert on what came out.
 */
check('the dispatcher applies it: a foreign app never reaches onGameMessage', () => {
    let listener = null;
    const s = session({ customType: 'whiteboard' });
    s.channel = { addEventListener: (name, fn) => { if (name === 'message') listener = fn; } };
    s.username = 'Amina';
    s.relayMode = 'none';

    const delivered = [];
    s.onGameMessage = (d) => delivered.push(d);
    s.onChat = () => {};

    // Only the message listener is under test; the others need no wiring.
    UserConnectionBase.prototype._setupChannelEvents.call(s);
    assert.ok(listener, 'no message listener was registered');

    listener({ response: { data: [
        { type: 'custom', customType: 'pictionary', from: 'Dawit',
          content: JSON.stringify({ type: 'stroke-batch', points: [1, 2] }) },
        { type: 'custom', customType: 'whiteboard', from: 'Dawit',
          content: JSON.stringify({ type: 'stroke-batch', points: [3, 4] }) },
    ] } });

    assert.strictEqual(delivered.length, 1, 'expected exactly one message through');
    assert.strictEqual(delivered[0].customType, 'whiteboard');
    assert.deepStrictEqual(delivered[0].data.points, [3, 4],
        'the wrong app\'s stroke was applied');
});

/*
 * The P2P data channel is the DEFAULT transport (relayMode p2p-host / p2p-mesh),
 * and it never touches the custom-message envelope -- so it carries no
 * customType and the filter above cannot see it. `_app` is stamped on the way
 * out and checked on the way in. These tests exist because the first version
 * of this fix covered only the envelope and left the common path open.
 */
console.log('\np2p data channel');

check('an outbound payload is stamped with the sending app', () => {
    const s = session({ customType: 'whiteboard' });
    assert.strictEqual(UserConnectionBase.prototype._stampApp.call(s, { type: 'stroke-batch' })._app,
        'whiteboard');
});

/*
 * Testing _stampApp directly proves the helper works, not that anything calls
 * it -- deleting the call in sendData left every other test green. So drive
 * sendData and inspect what actually reached the transport.
 */
check('sendData stamps what it hands to the transport', () => {
    const s = session({ customType: 'whiteboard' });
    s.relayMode = 'p2p-mesh';
    let sent = null;
    s.webrtcHelper = { broadcastDataChannel: (d) => { sent = d; return 1; } };

    UserConnectionBase.prototype.sendData.call(s, { type: 'stroke-batch' });
    assert.ok(sent, 'nothing reached the transport');
    assert.strictEqual(sent._app, 'whiteboard',
        'the payload went out unattributed, so no receiver can filter it');
});

check('stamping does not mutate the caller\'s object', () => {
    const s = session({ customType: 'whiteboard' });
    const original = { type: 'stroke-batch' };
    UserConnectionBase.prototype._stampApp.call(s, original);
    assert.strictEqual(original._app, undefined);
});

check('non-objects pass through untouched', () => {
    const s = session({ customType: 'whiteboard' });
    const call = (v) => UserConnectionBase.prototype._stampApp.call(s, v);
    assert.strictEqual(call(null), null);
    assert.strictEqual(call('raw'), 'raw');
    assert.deepStrictEqual(call([1, 2]), [1, 2]);
});

/**
 * Drives the real webrtcHelper listener.
 * @param opts   options for the receiving session
 * @param inbound payload arriving from a peer
 * @param asHost  whether this session is the channel host
 */
function deliverOverDataChannel(opts, inbound, asHost) {
    let listener = null;
    const s = session(opts);
    s.username = 'Amina';
    s.relayMode = 'p2p-host';
    s.webrtcHelper = {
        on: (name, fn) => { if (name === 'datachannel-message') listener = fn; },
        sendData: (to, d) => { s._relayed.push({ to, d }); return true; },
    };
    s._relayed = [];
    s.applied = [];
    s.onDataChannelMessage = (peerId, data) => s.applied.push({ peerId, data });
    s.isHost = () => !!asHost;
    s.getConnectedUsers = () => ['Amina', 'Dawit', 'Rosa'];

    UserConnectionBase.prototype._setupWebRtcEvents.call(s);
    assert.ok(listener, 'no datachannel-message listener was registered');
    listener('Dawit', inbound);
    return s;
}

check('a foreign app\'s p2p payload is not acted on', () => {
    const s = deliverOverDataChannel({ customType: 'whiteboard' },
        { type: 'stroke-batch', _app: 'pictionary' }, false);
    assert.strictEqual(s.applied.length, 0, 'the wrong app\'s stroke was applied');
});

check('our own app\'s p2p payload is acted on', () => {
    const s = deliverOverDataChannel({ customType: 'whiteboard' },
        { type: 'stroke-batch', _app: 'whiteboard' }, false);
    assert.strictEqual(s.applied.length, 1);
});

check('an unstamped p2p payload is accepted, so older peers keep working', () => {
    const s = deliverOverDataChannel({ customType: 'whiteboard' },
        { type: 'stroke-batch' }, false);
    assert.strictEqual(s.applied.length, 1);
});

/*
 * The one that is easy to get wrong. Host authority is channel-wide but apps
 * are not: if a whiteboard happens to be host in a room a pictionary is also
 * using, refusing to FORWARD pictionary's traffic would cut pictionary's peers
 * off from each other. Forwarding is owed to the room; acting on the contents
 * is not.
 */
check('a host still relays a foreign app it will not act on', () => {
    const s = deliverOverDataChannel({ customType: 'whiteboard', useHostMode: true },
        { type: 'stroke-batch', _app: 'pictionary', _needsRelay: true }, true);
    assert.strictEqual(s.applied.length, 0, 'host acted on another app\'s message');
    assert.ok(s._relayed.length > 0, 'host swallowed another app\'s message instead of relaying it');
    assert.strictEqual(s._relayed[0].d._app, 'pictionary', 'attribution lost in relay');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
