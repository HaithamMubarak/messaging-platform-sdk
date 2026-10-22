/**
 * A named host, as the web agent follows it.
 *
 * Without one, every client takes as host whichever agent connected first, so
 * anyone who reached a room before its rightful host was the host. A channel's
 * owner can name the host (messaging-service, POST /channels/managed/host):
 * the connect state then carries hostAgent, and the host's own agent info
 * carries host:true (its CONNECT event and the agent list). The agent must take
 * that name as the host whether or not it is here, and promote nobody while it
 * is away. Channels without one must elect exactly as before.
 *
 * A local server stands in for the service: connect, list-agents, and pull,
 * each answered from the scenario the test sets up.
 */
delete globalThis.WebSocket;   // HTTP polling: the stand-in serves pull, not a socket
const assert = require('assert');
const http = require('http');
const { AgentConnection } = require('../index.js');

let failures = 0;
async function check(name, fn) {
    try {
        await fn();
        process.stdout.write('  ok   ' + name + '\n');
    } catch (e) {
        failures++;
        process.stdout.write('  FAIL ' + name + ' — ' + e.message + '\n');
    }
}

/** What the stand-in answers: the connect state, the agent list, and events to hand out once. */
let room = { hostAgent: null, agents: [], events: [] };
const sessions = {};   // sessionId -> the room it joined: an earlier scenario's agent, still polling, keeps its own
const ok = (data) => JSON.stringify({ status: 'success', data });
const info = (name, time, extra) => Object.assign({ agentName: name, connectionTime: time }, extra || {});

const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const json = JSON.parse(body || '{}');
        if (/\/connect(\?|$)/.test(req.url)) {
            const state = { globalOffset: 0, localOffset: 0 };
            if (room.hostAgent) state.hostAgent = room.hostAgent;
            const sessionId = 's-' + Math.random();
            sessions[sessionId] = room;
            return res.end(ok({ sessionId, channelId: 'room-id', date: Date.now(), state }));
        }
        const mine = sessions[json.sessionId] || { agents: [], events: [] };
        if (/\/list-agents(\?|$)/.test(req.url)) return res.end(ok(mine.agents));
        if (/\/pull(\?|$)/.test(req.url)) {
            const events = mine.events.splice(0);
            return setTimeout(() => res.end(ok({ events, ephemeralEvents: [] })), events.length ? 0 : 200);
        }
        res.end(ok(null));
    });
});

function until(cond, ms, what) {
    const end = Date.now() + ms;
    return new Promise((resolve, reject) => (function poll() {
        if (cond()) return resolve();
        if (Date.now() > end) return reject(new Error('timed out waiting for ' + what));
        setTimeout(poll, 25);
    })());
}

async function join(api, name) {
    const agent = new AgentConnection();
    agent.connect({ api, apiKey: 'temp-key', channelId: 'room-id', agentName: name, autoReceive: true });
    await until(() => agent.readyState && Object.keys(agent._connectedAgentsMap).length > 0, 5000, name + ' to connect');
    return agent;
}

const connectEvent = (from, agentInfo) => ({ type: 'connect', from, to: '*', date: Date.now(), content: JSON.stringify(agentInfo), ephemeral: true });

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const api = `http://127.0.0.1:${server.address().port}`;
    const quiet = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
    ['log', 'info', 'debug', 'warn'].forEach(k => { console[k] = () => {}; });
    const agents = [];

    await check('control: with no named host, the first to connect is host, as before', async () => {
        room = { hostAgent: null, agents: [info('guest', 1), info('later', 2)], events: [] };
        const a = await join(api, 'guest');
        agents.push(a);
        assert.strictEqual(a.getHostAgentName(), 'guest');
        assert.strictEqual(a.isHostAgent(), true);
    });

    await check('a named host is the host while it is away, and the first in is not', async () => {
        room = { hostAgent: 'u-host', agents: [info('squatter', 1), info('guest', 2)], events: [] };
        const a = await join(api, 'squatter');
        agents.push(a);
        assert.strictEqual(a.getHostAgentName(), 'u-host');
        assert.strictEqual(a.isHostAgent(), false, 'first in, but not the host');
    });

    await check('when the named host arrives it is the host of every pair it is in', async () => {
        room = { hostAgent: 'u-host', agents: [info('squatter', 1), info('later', 3)], events: [] };
        const a = await join(api, 'squatter');
        agents.push(a);
        room.events.push(connectEvent('u-host', info('u-host', 5, { host: true })));
        await until(() => a.connectedAgents.includes('u-host'), 5000, 'the host to arrive');
        assert.strictEqual(a.getHostAgentName(), 'u-host');
        assert.strictEqual(a.isHostAgent('u-host'), false, 'squatter connected first, yet is not host of the pair');
        assert.strictEqual(a.isHostAgent('later'), true, 'a pair without the host still goes by time');
    });

    await check('nobody is promoted when the named host leaves', async () => {
        room = { hostAgent: 'u-host', agents: [info('u-host', 1, { host: true }), info('guest', 2)], events: [] };
        const a = await join(api, 'guest');
        agents.push(a);
        room.events.push({ type: 'disconnect', from: 'u-host', to: '*', date: Date.now(), ephemeral: true });
        await until(() => !a.connectedAgents.includes('u-host'), 5000, 'the host to leave');
        assert.strictEqual(a.getHostAgentName(), 'u-host');
        assert.strictEqual(a.isHostAgent(), false, 'the guest left alone is still not the host');
    });

    await check('a host named after this agent joined is learned from its connect event', async () => {
        room = { hostAgent: null, agents: [info('guest', 1)], events: [] };
        const a = await join(api, 'guest');
        agents.push(a);
        assert.strictEqual(a.getHostAgentName(), 'guest', 'before: elected as usual');
        room.events.push(connectEvent('u-host', info('u-host', 9, { host: true })));
        await until(() => a.connectedAgents.includes('u-host'), 5000, 'the host to arrive');
        assert.strictEqual(a.getHostAgentName(), 'u-host');
    });

    await check('the agent list marks the host for an agent whose connect state did not', async () => {
        room = { hostAgent: null, agents: [info('guest', 1), info('u-host', 2, { host: true })], events: [] };
        const a = await join(api, 'guest');
        agents.push(a);
        assert.strictEqual(a.getHostAgentName(), 'u-host');
    });

    agents.forEach(a => { a.autoReceive = false; });
    Object.assign(console, quiet);
    server.close();
    console.log(failures ? failures + ' FAILED' : 'named-host: all passed');
    process.exitCode = failures ? 1 : 0;
    setTimeout(() => process.exit(), 300).unref();
})();
