/**
 * Append-only keys and server-stamped writers, as the client sees them.
 *
 * The service (messaging-service, 2026-10-15) locks a key when its first add
 * carries appendOnly:true, answers 409 to put/deleteByKey on it, and stamps
 * each version with writtenBy. The SDK used to drop the flag on the floor and
 * hand a 409 back as raw JSON text, so an app could not tell "this log is
 * locked" from any other failure. A local server stands in for the service;
 * its answers follow ChannelStorageController and JsonResponse.error.
 */
const assert = require('assert');
const http = require('http');
const { AgentConnection } = require('../index.js');

let failures = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('  ok   ' + name);
    } catch (e) {
        failures++;
        console.log('  FAIL ' + name + ' — ' + e.message);
    }
}

const seen = [];
const LOCKED = 'Storage key is append-only: log';
const version = (id, by, text) => ({
    id, storageKey: 'log', version: 0, createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z',
    content: Buffer.from(JSON.stringify(text)).toString('base64'), metadata: {}, writtenBy: by, appendOnly: true
});

const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        const json = JSON.parse(body || '{}');
        seen.push({ path: req.url, body: json });
        const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (/\/storage\/(put|deleteByKey)$/.test(req.url)) {
            return send(409, { status: 'error', statusMessage: LOCKED, data: null });
        }
        if (/\/storage\/add$/.test(req.url)) {
            return send(200, { status: 'success', data: { id: 7, storageKey: 'log', writtenBy: 'host', appendOnly: !!json.appendOnly } });
        }
        if (/\/storage\/getList$/.test(req.url)) {
            return send(200, { status: 'success', data: { storageKey: 'log', versionCount: 2,
                versions: [version(2, 'guest', { by: 'Ann', text: 'second' }), version(1, null, 'first')] } });
        }
        send(404, { status: 'error', statusMessage: 'no such route' });
    });
});

function agentFor(port) {
    const agent = new AgentConnection();
    agent._api = `http://127.0.0.1:${port}`;
    agent.readyState = true;
    agent.sessionId = 'session-1';
    return agent;
}
const call = (fn) => new Promise(resolve => fn(resolve));

(async () => {
    console.log('web-agent-js storage authority test');
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const agent = agentFor(server.address().port);

    await check('storageAdd passes appendOnly to /storage/add', async () => {
        const res = await call(cb => agent.storageAdd({ storageKey: 'log', content: 'a', appendOnly: true }, cb));
        assert.strictEqual(res.status, 'success');
        assert.strictEqual(seen.at(-1).body.appendOnly, true);
        assert.strictEqual(res.data.data.appendOnly, true, 'the answer says the key is locked');
    });

    await check('storageAdd without appendOnly sends no flag', async () => {
        await call(cb => agent.storageAdd({ storageKey: 'log', content: 'a' }, cb));
        assert.ok(!('appendOnly' in seen.at(-1).body), JSON.stringify(seen.at(-1).body));
    });

    await check('a put on a locked key answers appendOnly with the server sentence', async () => {
        const res = await call(cb => agent.storagePut({ storageKey: 'log', content: 'forged' }, cb));
        assert.deepStrictEqual([res.status, res.httpStatus, res.appendOnly, res.data], ['error', 409, true, LOCKED]);
        assert.strictEqual(res.statusMessage, LOCKED, 'statusMessage, which apps already log');
    });

    await check('a deleteByKey on a locked key answers the same', async () => {
        const res = await call(cb => agent.storageDeleteByKey('log', cb));
        assert.deepStrictEqual([res.status, res.httpStatus, res.appendOnly, res.data], ['error', 409, true, LOCKED]);
        assert.strictEqual(res.statusMessage, LOCKED, 'statusMessage, which apps already log');
    });

    await check('storageGetList keeps writtenBy and appendOnly on each version', async () => {
        const res = await call(cb => agent.storageGetList('log', cb));
        const v = res.data.data.versions;
        assert.deepStrictEqual(v.map(x => [x.writtenBy, x.appendOnly]), [['guest', true], [null, true]]);
    });

    await check('storageReadEntries decodes values and keeps the server writer', async () => {
        const entries = await agent.storageReadEntries('log');
        assert.deepStrictEqual(entries.map(e => [e.value, e.writtenBy, e.appendOnly, e.id]),
            [[{ by: 'Ann', text: 'second' }, 'guest', true, 2], ['first', null, true, 1]]);
    });

    await check('storageReadList still resolves the bare values', async () => {
        assert.deepStrictEqual(await agent.storageReadList('log'), [{ by: 'Ann', text: 'second' }, 'first']);
    });

    server.close();
    console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
    process.exitCode = failures ? 1 : 0;
})();
