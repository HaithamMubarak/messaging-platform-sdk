/**
 * The host of a game must be someone playing it.
 *
 * Host election was room-wide: `connectedAgents[0]`, the first agent in the
 * channel, whatever app they were running. That is correct while every room
 * holds one app, and wrong the moment a channel is shared across apps --
 *
 *   - a whiteboard user who joined first becomes host of everything, so a
 *     chess client gets isHost() === false AND a host name pointing at
 *     somebody who will never act as chess host: the game has no host at all;
 *   - and the reverse, a chess player joining first, means the whiteboard's
 *     host-only saveBoardStateToStorage() never runs, so the board is never
 *     written and Rewind has nothing to replay.
 *
 * The tag needed to fix it already travelled: the service stamps
 * customEventType onto AgentInfo beside a server-set connectionTime and
 * broadcasts it. The client simply never sent one.
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

/*
 * web-agent.js is a browser bundle; the election functions are what is under
 * test, so borrow them onto a stand-in rather than booting the whole agent.
 */
const fs = require('fs');
const agentSrc = fs.readFileSync(
    path.join(STATIC, 'generated-web-agent-js', 'js', 'web-agent.js'), 'utf8');

function extract(name) {
    const start = agentSrc.indexOf(`AgentConnection.prototype.${name} = function`);
    assert.notStrictEqual(start, -1, `${name} not found in the shipped bundle`);
    // Keep the parameter list: rebuilding isHostAgent without its peer
    // argument silently turned a passing test into a ReferenceError.
    const params = agentSrc.slice(agentSrc.indexOf('(', start) + 1,
                                  agentSrc.indexOf(')', start));
    // Walk braces from the first { after the signature to find the body's end.
    let i = agentSrc.indexOf('{', start), depth = 0, end = -1;
    for (let j = i; j < agentSrc.length; j++) {
        if (agentSrc[j] === '{') depth++;
        else if (agentSrc[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
    const body = agentSrc.slice(i + 1, end);
    return new Function('return function ' + name + '(' + params + ') {' + body + '}')();
}

const getHostAgentName = extract('getHostAgentName');
const isHostAgent = extract('isHostAgent');

/** A connection whose roster is `agents`, connected as `me` running `app`. */
function conn(me, app, agents) {
    return { agentName: me, customEventType: app, _connectedAgentsMap: agents,
             getHostAgentName, isHostAgent };
}

const AGENT = (t, app) => ({ connectionTime: t, customEventType: app });

console.log('app-scoped host election');

/*
 * The exact scenario from the bug: a whiteboard user joined first, a chess
 * player second. Room-wide election makes the whiteboard user host of chess.
 */
const MIXED = {
    Amina: AGENT(1000, 'whiteboard'),
    Dawit: AGENT(2000, 'chess'),
    Rosa:  AGENT(3000, 'chess'),
};

check('the chess host is a chess player, not whoever joined the room first', () => {
    assert.strictEqual(conn('Dawit', 'chess', MIXED).getHostAgentName(), 'Dawit');
});

check('and the whiteboard host is the whiteboard user', () => {
    assert.strictEqual(conn('Amina', 'whiteboard', MIXED).getHostAgentName(), 'Amina');
});

check('an app alone among strangers is its own host, so its saves still run', () => {
    // Exactly the whiteboard-never-saves case: a chess player joined first.
    const room = { Dawit: AGENT(1000, 'chess'), Amina: AGENT(2000, 'whiteboard') };
    assert.strictEqual(conn('Amina', 'whiteboard', room).isHostAgent(), true);
});

check('the later chess player is not host', () => {
    assert.strictEqual(conn('Rosa', 'chess', MIXED).isHostAgent(), false);
});

check('earliest connection wins within an app', () => {
    assert.strictEqual(conn('Rosa', 'chess', MIXED).getHostAgentName(), 'Dawit');
});

/* Backwards compatibility: the rules that keep two agents from both believing
 * they are host. */

check('one untagged peer drops the whole room to room-wide election', () => {
    // A peer on an older build elects room-wide, so everyone must, or the
    // untagged agent and a tagged one would each elect themselves.
    const room = {
        Amina: AGENT(1000, 'whiteboard'),
        Legacy: { connectionTime: 500 },          // no customEventType
        Dawit: AGENT(2000, 'chess'),
    };
    assert.strictEqual(conn('Dawit', 'chess', room).getHostAgentName(), 'Legacy');
    assert.strictEqual(conn('Amina', 'whiteboard', room).getHostAgentName(), 'Legacy');
});

check('a connection that declared no app elects room-wide', () => {
    assert.strictEqual(conn('Dawit', '', MIXED).getHostAgentName(), 'Amina');
});

check('an empty roster has no host rather than a wrong one', () => {
    assert.strictEqual(conn('Amina', 'whiteboard', {}).getHostAgentName(), null);
    assert.strictEqual(conn('Amina', 'whiteboard', {}).isHostAgent(), true);
});

check('equal connection times fall back to alphabetical, not to chance', () => {
    const room = { Rosa: AGENT(1000, 'chess'), Dawit: AGENT(1000, 'chess') };
    assert.strictEqual(conn('Rosa', 'chess', room).getHostAgentName(), 'Dawit');
});

check('a roster with no usable times still names a host', () => {
    const room = { Rosa: { customEventType: 'chess' }, Dawit: { customEventType: 'chess' } };
    assert.strictEqual(conn('Rosa', 'chess', room).getHostAgentName(), 'Dawit');
});

/* The pairwise check drives WebRTC dial order and must stay room-level. */
check('the pairwise host check is untouched and stays room-wide', () => {
    assert.strictEqual(conn('Amina', 'whiteboard', MIXED).isHostAgent('Dawit'), true);
    assert.strictEqual(conn('Dawit', 'chess', MIXED).isHostAgent('Amina'), false);
});

console.log('\nwiring');

function session(options) {
    const s = Object.create(UserConnectionBase.prototype);
    s.options = options;
    return s;
}

check('_getHostName asks the connection, not the room roster', () => {
    const s = session({ customType: 'chess' });
    s.channel = { getHostAgentName: () => 'Dawit', connectedAgents: ['Amina', 'Dawit'] };
    assert.strictEqual(UserConnectionBase.prototype._getHostName.call(s), 'Dawit',
        'addressed the host of the room instead of the host of this app');
});

check('_getHostName still works against a connection that cannot scope', () => {
    const s = session({ customType: 'chess' });
    s.channel = { connectedAgents: ['Amina', 'Dawit'] };   // older bundle
    assert.strictEqual(UserConnectionBase.prototype._getHostName.call(s), 'Amina');
});

/*
 * The tag has to be SENT or none of the above has anything to work with -- and
 * a promiscuous page must not send one, because the same field is the delivery
 * filter and declaring an app is how a page stops hearing the others.
 */
function connectOptions(options) {
    const s = session(options);
    let sent = null;
    s.channel = { connect: (o) => { sent = o; }, addEventListener: () => {} };
    s.username = 'Amina';
    // connect() does async setup around this; call the payload site directly by
    // driving the documented shape instead.
    return { s, get sent() { return sent; } };
}

check('the shipped connect payload declares the app', () => {
    const src = require('fs').readFileSync(path.join(STATIC, 'js', 'UserConnectionBase.js'), 'utf8');
    assert.ok(/customEventType:\s*this\.options\.promiscuous\s*\?\s*''\s*:\s*\(this\.options\.customType\s*\|\|\s*''\)/.test(src),
        'connect() no longer sends customEventType, so nothing downstream can scope anything');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
