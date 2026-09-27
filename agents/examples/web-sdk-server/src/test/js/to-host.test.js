/**
 * toHost(): a client's message reaches the host and nobody else.
 *
 * In host mode a client's plain sendData(data) is wrapped with _needsRelay
 * and the host rebroadcasts it, so a vote or a hidden role sent that way lands
 * in every opponent's browser. Five games learned this and each wrote a
 * toHost of its own; this pins the shared one, through the real sendData
 * routing in the real shipped file, with only the WebRTC helper faked.
 */
const assert = require('assert');
const path = require('path');

global.window = global.window || {};
const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const { UserConnectionBase } = require(path.join(STATIC, 'js', 'UserConnectionBase.js'));

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

/** A client in host mode, with a helper that records every send. */
function client(me, host) {
    const s = Object.create(UserConnectionBase.prototype);
    s.options = { customType: 'liar' };
    s.username = me;
    s.relayMode = 'p2p-host';
    s.sent = [];
    s.channel = { getHostAgentName: () => host, isHostAgent: () => me === host, connectedAgents: [host, me] };
    s.webrtcHelper = {
        sendData: (peer, data) => { s.sent.push({ peer, data }); return true; },
        broadcastDataChannel: (data) => { s.sent.push({ peer: '*', data }); return 2; },
    };
    return s;
}

console.log('toHost');

check('the message is addressed to the host, not broadcast or marked for relay', () => {
    const s = client('ana', 'hal');
    assert.strictEqual(s.toHost({ type: 'vote', for: 'bo' }), 1);
    assert.strictEqual(s.sent.length, 1);
    assert.strictEqual(s.sent[0].peer, 'hal');
    assert.strictEqual(s.sent[0].data._needsRelay, undefined);
    assert.strictEqual(s.sent[0].data._app, 'liar');
});

check('the leak it prevents is real: a plain sendData from a client is marked for relay', () => {
    const s = client('ana', 'hal');
    s.sendData({ type: 'vote', for: 'bo' });
    assert.strictEqual(s.sent[0].data._needsRelay, true);
});

check('no host yet: nothing is sent, and it says so with 0', () => {
    const s = client('ana', null);
    s.channel.connectedAgents = [];
    assert.strictEqual(s.toHost({ type: 'vote' }), 0);
    assert.strictEqual(s.sent.length, 0);
});

check('the host sending to itself sends nothing; the app handles its own action', () => {
    const s = client('hal', 'hal');
    assert.strictEqual(s.toHost({ type: 'vote' }), 0);
    assert.strictEqual(s.sent.length, 0);
});

console.log(failures ? '\n' + failures + ' failed' : '\nall passed');
process.exitCode = failures ? 1 : 0;
