/**
 * HostedRoom (config-loader.js): which room a page connects to when its app's
 * authority opens its room through the backend.
 *
 * The page with no link is the host: it opens a room (POST /app/api/host) and
 * connects with the host key, and a reload gets the same room back instead of
 * a new one the guests do not know. A page opened with a shared link joins the
 * room the link names as a guest, with what the person typed, and never opens
 * a room of its own. The host's own address carries its room in the same
 * shape as a link, so that must not turn the host into a guest.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js');

function makeStore() {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

/** A page: config-loader.js with a fake backend that counts the rooms it opens. store is the tab's, device the browser's. */
function page(hash, store, device) {
    const opened = [];
    const win = { location: { hostname: 'localhost', pathname: '/', hash: hash || '' } };
    win.ChannelAuthUtils = { decodeAuto: (s) => (s.startsWith('auth:') ? { c: s.slice(5), p: 'pw' } : null) };
    const fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        opened.push(url);
        const n = opened.length;
        return { ok: true, json: async () => ({ status: 'success', data: { channelName: body.app + '-room' + n,
            channelPassword: 'pw' + n, hostAgent: body.agentName, agentKey: 'key' + n, agentKeyTtlSeconds: 3600 } }) };
    };
    const quiet = { log() {}, warn() {}, error() {} };
    new Function('window', 'sessionStorage', 'localStorage', 'fetch', 'console', fs.readFileSync(path.join(DIR, 'config-loader.js'), 'utf8'))(
        win, store || makeStore(), device || makeStore(), fetch, quiet);
    return { win, opened };
}

let failures = 0;
async function check(name, fn) {
    try { await fn(); console.log('  ok   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

(async () => {
    console.log('hosted-room test');

    await check('a page with no link opens a room and connects as its host, with the host key', async () => {
        const p = page('');
        const args = await p.win.HostedRoom.connectArgs('myapp', 'Lead', 'typed', 'typed-pw');
        assert.deepStrictEqual(args, { username: 'Lead', channelName: 'myapp-room1', channelPassword: 'pw1', agentKey: 'key1' });
        assert.strictEqual(p.opened.length, 1);
        assert.ok(/\/app\/api\/host$/.test(p.opened[0]), p.opened[0]);
    });

    await check('a reload in the same tab gets the same room back, not a new one', async () => {
        const store = makeStore();
        await page('', store).win.HostedRoom.connectArgs('myapp', 'Lead', '', '');
        const again = page('#auth:myapp-room1#myapp-room1', store);   // the host's own address after connect
        const args = await again.win.HostedRoom.connectArgs('myapp', 'Lead', 'myapp-room1', 'pw1');
        assert.strictEqual(again.opened.length, 0, 'opened another room');
        assert.deepStrictEqual(args, { username: 'Lead', channelName: 'myapp-room1', channelPassword: 'pw1', agentKey: 'key1' });
    });

    await check('a page opened with a link joins that room as a guest and opens nothing', async () => {
        const p = page('#auth:myapp-room9#myapp-room9');
        const args = await p.win.HostedRoom.connectArgs('myapp', 'Staff', 'myapp-room9', 'pw9');
        assert.deepStrictEqual(args, { username: 'Staff', channelName: 'myapp-room9', channelPassword: 'pw9' });
        assert.strictEqual(p.opened.length, 0);
    });

    await check('a host key that has lapsed is not reused: the page opens a new room', async () => {
        const store = makeStore();
        store.setItem('hosted-room.myapp', JSON.stringify({ channelName: 'old', hostAgent: 'Lead', expiresAt: Date.now() + 1000 }));
        const p = page('', store);
        const args = await p.win.HostedRoom.connectArgs('myapp', 'Lead', '', '');
        assert.strictEqual(args.channelName, 'myapp-room1');
    });

    await check('another name in the same tab gets its own room', async () => {
        const store = makeStore();
        await page('', store).win.HostedRoom.connectArgs('myapp', 'Lead', '', '');
        const p = page('', store);
        const args = await p.win.HostedRoom.connectArgs('myapp', 'Other', '', '');
        assert.strictEqual(p.opened.length, 1);
        assert.strictEqual(args.username, 'Other');
    });

    // keep: 'device' -- a host whose tab closed comes back to its room (an event's organiser)
    const DEVICE = { keep: 'device' };

    await check('kept by device, a new tab under the same label gets the same room and key back', async () => {
        const device = makeStore();
        const first = await page('', makeStore(), device).win.HostedRoom.connectArgs('myapp', 'Org', 'event-1', 'typed', DEVICE);
        const p = page('', makeStore(), device);
        const again = await p.win.HostedRoom.connectArgs('myapp', 'Org', 'event-1', 'typed', DEVICE);
        assert.strictEqual(p.opened.length, 0, 'opened another room');
        assert.deepStrictEqual(again, first);
    });

    await check('kept by device, the hosted room’s own name (what the keyring saves) finds it too', async () => {
        const device = makeStore();
        const first = await page('', makeStore(), device).win.HostedRoom.connectArgs('myapp', 'Org', 'event-1', 'typed', DEVICE);
        const p = page('', makeStore(), device);
        const again = await p.win.HostedRoom.connectArgs('myapp', 'Org', first.channelName, first.channelPassword, DEVICE);
        assert.strictEqual(p.opened.length, 0);
        assert.strictEqual(again.agentKey, first.agentKey);
    });

    await check('kept by device, a new label is a new event in a new room', async () => {
        const device = makeStore();
        await page('', makeStore(), device).win.HostedRoom.connectArgs('myapp', 'Org', 'event-1', '', DEVICE);
        const p = page('', makeStore(), device);
        const other = await p.win.HostedRoom.connectArgs('myapp', 'Org', 'event-2', '', DEVICE);
        assert.strictEqual(p.opened.length, 1);
    });

    await check('kept by tab (the default), another tab of the same browser opens its own room', async () => {
        const device = makeStore();
        await page('', makeStore(), device).win.HostedRoom.connectArgs('myapp', 'Lead', 'x', '');
        const p = page('', makeStore(), device);
        await p.win.HostedRoom.connectArgs('myapp', 'Lead', 'x', '');
        assert.strictEqual(p.opened.length, 1);
    });

    console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
    process.exitCode = failures ? 1 : 0;
})();
