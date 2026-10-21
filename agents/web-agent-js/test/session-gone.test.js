/**
 * The socket learns the session is gone; the page must hear of it.
 *
 * The server now evicts a silent peer in seconds and closes a socket whose
 * session no longer exists (code 4404). Until this, a WebSocket answer of
 * "Agent session not found" was logged and ignored, so a page whose channel
 * was deleted, or that came back after being evicted, carried on as a zombie.
 * And a page that wants to test host loss needs a way to vanish the way a
 * crash does, without the goodbye disconnect() sends.
 *
 *     node test/session-gone.test.js
 */
const assert = require('assert');

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

console.log('Session gone under a live socket');
const quiet = console.log;
console.log = console.warn = console.error = console.debug = () => {};

class FakeSocket {
    constructor(url) { this.url = url; this.readyState = FakeSocket.OPEN; this.sent = []; this.closed = false; }
    send(frame) { this.sent.push(frame); }
    close() { this.closed = true; this.readyState = FakeSocket.CLOSED; }
}
FakeSocket.OPEN = 1;
FakeSocket.CLOSED = 3;
global.WebSocket = FakeSocket;

const { AgentConnection } = require('../index.js');
console.log = quiet;

/** A connection that believes it is in a room, on an open (fake) socket. */
function inRoom() {
    const conn = new AgentConnection();
    conn.readyState = true;
    conn.sessionId = 'sess-1';
    conn.useWebsocket = true;
    conn._websocket = new FakeSocket('ws://x');
    conn._websocketConnected = true;
    conn.events = [];
    for (const type of ['session-not-found', 'disconnect', 'connection-lost']) {
        conn.addEventListener(type, () => conn.events.push(type));
    }
    return conn;
}
const settle = (conn) => { clearTimeout(conn._reconnectTimer); delete conn._reconnectTimer; };

check('an error frame saying the session is gone tells the page and drops the socket', () => {
    const conn = inRoom();
    const socket = conn._websocket;
    conn._handleWebSocketMessage({ status: 'error', statusMessage: 'Agent session not found' });
    settle(conn);
    assert.deepStrictEqual(conn.events, ['session-not-found']);
    assert.strictEqual(conn.readyState, false, 'still believes it is in the room');
    assert.strictEqual(conn._websocket, null, 'the socket was kept');
    assert.ok(socket.closed, 'the socket was not closed');
});

check('any other error frame is left alone', () => {
    const conn = inRoom();
    conn._handleWebSocketMessage({ status: 'error', statusMessage: 'Push failed: too big' });
    assert.deepStrictEqual(conn.events, []);
    assert.strictEqual(conn.readyState, true);
});

check('a socket closed with 4404 tells the page instead of reconnecting the socket', () => {
    const conn = inRoom();
    conn._api = 'http://localhost:1/';
    conn._websocket = null;
    conn._connectWebSocket();
    const socket = conn._websocket;
    assert.ok(socket instanceof FakeSocket, 'no socket was opened');
    socket.onclose({ code: 4404, reason: 'Agent session not found' });
    settle(conn);
    assert.deepStrictEqual(conn.events, ['session-not-found']);
    assert.strictEqual(conn._websocketReconnectAttempts, 0, 'it started the socket reconnect ladder');
});

check('dropWithoutGoodbye goes silent: no disconnect request, socket closed, nothing reconnects', () => {
    const conn = inRoom();
    const socket = conn._websocket;
    const sentBefore = socket.sent.length;
    let requests = 0;
    const realXhr = global.XMLHttpRequest;
    global.XMLHttpRequest = function () { requests++; this.open = this.send = this.setRequestHeader = () => {}; };
    try { conn.dropWithoutGoodbye(); } finally { global.XMLHttpRequest = realXhr; }
    assert.strictEqual(requests, 0, 'it said goodbye over HTTP');
    assert.strictEqual(socket.sent.length, sentBefore, 'it said something on the socket');
    assert.ok(socket.closed, 'the socket stayed open');
    assert.strictEqual(conn.readyState, false);
    assert.deepStrictEqual(conn.events, ['disconnect'], 'the page was not told it is out');
    conn.dropWithoutGoodbye();
    assert.deepStrictEqual(conn.events, ['disconnect'], 'a second call did something');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
