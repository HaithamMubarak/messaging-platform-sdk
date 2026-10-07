/**
 * Minted TURN credentials, and keeping them current.
 *
 * Since 2026-10-07 the platform hands out TURN credentials that expire (the
 * TURN REST API: username "<expiry seconds>:<id>", password HMAC-SHA1 of it
 * under a secret only servers hold). A connection must fetch fresh ones before
 * its run out, and a server holding the secret (the SFU) mints its own.
 *
 *     node test/ice-refresh.test.js
 */
const assert = require('assert');
const crypto = require('crypto');

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log('  ok   ' + name);
    } catch (e) {
        failures++;
        console.log('  FAIL ' + name + ' — ' + e.message);
    }
}

console.log('ICE server refresh and TURN minting');
const quiet = console.log;
console.log = console.warn = () => {};
const { AgentConnection } = require('../index.js');
const { WebRtcHelper } = require('../js/web-agent.webrtc.js');
console.log = quiet;

// Run _scheduleIceRefresh with setTimeout captured; returns the delay asked for, or null.
function scheduledDelay(iceServers, readyState = true) {
    const conn = new AgentConnection();
    conn.readyState = readyState;
    conn.iceServers = iceServers;
    let delay = null;
    const real = global.setTimeout;
    global.setTimeout = (fn, ms) => { delay = ms; return { unref() {} }; };
    try { conn._scheduleIceRefresh(); } finally { global.setTimeout = real; }
    return delay;
}
const now = () => Math.floor(Date.now() / 1000);
const minted = (expiry) => [{ urls: ['stun:a'] }, { urls: ['turn:a'], username: expiry + ':0011aabb', credential: 'x' }];

check('a minted credential is refreshed five minutes before it expires', () => {
    const d = scheduledDelay(minted(now() + 1800));
    assert.ok(d >= 1499000 && d <= 1501000, 'delay ' + d);
});

check('one that is about to expire, or has, is retried in 30 s rather than never', () => {
    assert.strictEqual(scheduledDelay(minted(now() + 60)), 30000);
    assert.strictEqual(scheduledDelay(minted(now() - 600)), 30000);
});

check('a static credential, or a closed connection, schedules nothing', () => {
    assert.strictEqual(scheduledDelay([{ urls: ['turn:a'], username: 'webrtc', credential: 'x' }]), null);
    assert.strictEqual(scheduledDelay(minted(now() + 1800), false), null);
});

// The envelope /ice-servers really answers with (captured from production,
// 2026-10-07): the list is under `data`. The first version of
// refreshIceServers read the envelope itself, so every refresh "failed".
const CAPTURED = JSON.stringify({ status: 'success', statusMessage: null, data: [
    { urls: ['stun:hmdevonline.com:3478'] },
    { urls: ['turn:hmdevonline.com:3478'], username: (now() + 3600) + ':0123456789abcdef', credential: 'c2VjcmV0' }] });

check('refreshIceServers takes the new list from the platform\'s envelope', () => {
    const real = global.XMLHttpRequest;
    let sent = null;
    global.XMLHttpRequest = function () {
        const xhr = this;
        Object.assign(xhr, { status: 0, response: null, setRequestHeader() {},
            open(method, url) { xhr.url = url; },
            send(body) { sent = { url: xhr.url, body }; xhr.status = 200; xhr.response = CAPTURED; xhr.onloadend.call(xhr); } });
    };
    const conn = new AgentConnection();
    Object.assign(conn, { readyState: true, sessionId: 'sess-1', channelId: 'ch', _api: 'https://x.test/api', iceServers: minted(now() + 60) });
    let got;
    const realTimeout = global.setTimeout;
    global.setTimeout = () => ({ unref() {} });
    try { conn.refreshIceServers((servers) => { got = servers; }); }
    finally { global.XMLHttpRequest = real; global.setTimeout = realTimeout; }
    assert.ok(/ice-servers/.test(sent.url), 'url ' + sent.url);
    assert.ok(Array.isArray(got) && got.length === 2, 'callback got ' + JSON.stringify(got));
    assert.strictEqual(conn.iceServers[1].username.slice(-16), '0123456789abcdef');
});

function nodeIceServers(env) {
    const keys = ['TURN_SERVER', 'STUN_SERVER', 'TURN_USERNAME', 'TURN_CREDENTIAL', 'TURN_PASSWORD', 'TURN_AUTH_SECRET', 'TURN_TTL_SECONDS'];
    const saved = {};
    keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
    Object.assign(process.env, env);
    const quietLog = console.log; console.log = console.warn = () => {};
    try {
        return new WebRtcHelper({ agentName: 't' })._buildIceServers();
    } finally {
        console.log = quietLog;
        keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    }
}

check('a server with TURN_AUTH_SECRET mints its own credential, fresh each time', () => {
    const env = { TURN_SERVER: 'turn.test:3478', TURN_AUTH_SECRET: 'north-secret', TURN_CREDENTIAL: 'static-pw', TURN_TTL_SECONDS: '600' };
    const turn = nodeIceServers(env).find((s) => [].concat(s.urls).some((u) => u.startsWith('turn:')));
    assert.ok(/^\d+:[0-9a-f]{16}$/.test(turn.username), 'username ' + turn.username);
    const expiry = Number(turn.username.split(':')[0]);
    assert.ok(Math.abs(expiry - (now() + 600)) <= 2, 'expiry ' + expiry);
    assert.strictEqual(turn.credential, crypto.createHmac('sha1', 'north-secret').update(turn.username).digest('base64'));
    const again = nodeIceServers(env).find((s) => [].concat(s.urls).some((u) => u.startsWith('turn:')));
    assert.notStrictEqual(again.username, turn.username);
});

check('without a secret, the static credential as before', () => {
    const turn = nodeIceServers({ TURN_SERVER: 'turn.test:3478', TURN_USERNAME: 'webrtc', TURN_CREDENTIAL: 'static-pw' })
        .find((s) => [].concat(s.urls).some((u) => u.startsWith('turn:')));
    assert.strictEqual(turn.username, 'webrtc');
    assert.strictEqual(turn.credential, 'static-pw');
});

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exitCode = failures ? 1 : 0;
