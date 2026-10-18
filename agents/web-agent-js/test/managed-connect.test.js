/**
 * Managed channels, as the web agent sends them.
 *
 * A managed channel admits only agents its owner registered, each with a key
 * (messaging-service, ManagedChannelService). The agent must send agentKey
 * with connect when given one, send nothing extra when not (ordinary channels
 * see the same payload as before), and never write the key to the console.
 * A local server stands in for the service and records each connect body.
 */
const assert = require('assert');
const http = require('http');
const { AgentConnection } = require('../index.js');

const KEY = 'k-0123456789abcdef0123456789';
let failures = 0;
async function check(name, fn) {
    try {
        await fn();
        process.stdout.write('  ok   ' + name + '\n');   // not console: the console is captured below
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
    const logged = [];
    const keep = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
    ['log', 'info', 'debug', 'warn'].forEach(k => { console[k] = (...a) => { logged.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); keep[k](...a); }; });

    await check('a managed agent sends its agentKey with connect', async () => {
        new AgentConnection().connect({ api, apiKey: 'temp-key', channelId: 'room-1', agentName: 'u-ann', agentKey: KEY });
        await waitFor(1, 3000);
        assert.strictEqual(connects[0].agentKey, KEY);
        assert.strictEqual(connects[0].agentName, 'u-ann');
    });

    await check('an ordinary agent sends no agentKey at all', async () => {
        new AgentConnection().connect({ api, apiKey: 'temp-key', channelId: 'room-2', agentName: 'plain' });
        await waitFor(2, 3000);
        assert.ok(!('agentKey' in connects[1]), 'payload: ' + JSON.stringify(connects[1]));
    });

    await check('the key never reaches the console', async () => {
        assert.ok(logged.some(l => l.includes('agentName') && l.includes('u-ann')), 'the connect payload was logged (else this proves nothing)');
        assert.ok(!logged.some(l => l.includes(KEY)), 'a log line carried the key');
    });

    Object.assign(console, keep);
    server.close();
    console.log(failures ? failures + ' FAILED' : 'managed-connect: all passed');
    process.exitCode = failures ? 1 : 0;
})();
