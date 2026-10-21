/**
 * Channel life, as the web agent asks for it.
 *
 * A connect that creates a channel may ask for a shorter life than the 24 h
 * default (messaging-service, ChannelService.allowedAgeMs), so an abandoned
 * game room stops holding quota. The agent must send channelAgeMs when given
 * one, keep it for a reconnect (which may recreate the channel), and send
 * nothing when not given one, so old callers see the same payload as before.
 * A local server stands in for the service and records each connect body.
 */
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

const connects = [];
const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        if (/\/connect(\?|$)/.test(req.url)) connects.push(JSON.parse(body || '{}'));   // the agent adds ?use-pubkey=...
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unauthorized', statusMessage: 'stand-in: refuse so the agent stops here' }));
    });
});

function waitFor(n, ms) {
    const end = Date.now() + ms;
    return new Promise((resolve, reject) => (function poll() {
        if (connects.length >= n) return resolve();
        if (Date.now() > end) return reject(new Error('no connect request arrived'));
        setTimeout(poll, 20);
    })());
}

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const api = `http://127.0.0.1:${server.address().port}`;
    const quiet = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
    ['log', 'info', 'debug', 'warn'].forEach(k => { console[k] = () => {}; });

    await check('channelAgeMs goes with a connect by channel id', async () => {
        new AgentConnection().connect({ api, apiKey: 'temp-key', channelId: 'room-1', agentName: 'u-ann', channelAgeMs: 7200000 });
        await waitFor(1, 3000);
        assert.strictEqual(connects[0].channelAgeMs, 7200000);
    });

    await check('channelAgeMs goes with a connect by name and password', async () => {
        new AgentConnection().connect({ api, apiKey: 'temp-key', channelName: 'room', channelPassword: 'pw', agentName: 'u-bob', channelAgeMs: 600000 });
        await waitFor(2, 3000);
        assert.strictEqual(connects[1].channelAgeMs, 600000);
        assert.strictEqual(connects[1].channelName, 'room');
    });

    await check('an agent that asks for nothing sends no channelAgeMs at all', async () => {
        new AgentConnection().connect({ api, apiKey: 'temp-key', channelId: 'room-2', agentName: 'plain' });
        await waitFor(3, 3000);
        assert.ok(!('channelAgeMs' in connects[2]), 'payload: ' + JSON.stringify(connects[2]));
    });

    await check('a reconnect without the option still asks for the same life', async () => {
        const agent = new AgentConnection();
        agent.connect({ api, apiKey: 'temp-key', channelId: 'room-3', agentName: 'u-cy', channelAgeMs: 900000 });
        await waitFor(4, 3000);
        agent.readyState = false;
        agent.connect({ api, apiKey: 'temp-key', channelId: 'room-3', agentName: 'u-cy' });
        await waitFor(5, 3000);
        assert.strictEqual(connects[4].channelAgeMs, 900000);
    });

    Object.assign(console, quiet);
    server.close();
    console.log(failures ? failures + ' FAILED' : 'channel-age: all passed');
    process.exitCode = failures ? 1 : 0;
})();
