/*
 * Is an expired temp key checked at CONNECT?
 *
 * The reconnect test showed a peer resuming on a dead key. Two readings:
 * (a) the key is never re-checked and access outlives it, or (b) the
 * SESSION is the credential after connect and reconnect resumes it.
 * They differ enormously for brokering: under (a) revoking a key does
 * not revoke access at all.
 *
 * This settles it by attempting a FRESH connect — no existing session —
 * with a key that is already dead.
 */
const { chromium } = require('playwright');
const https = require('https');
const API = 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service';
const REAL_KEY = '38d66874-2b47-4aaf-b9dc-ab0a79f56faf';
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

function post(path, body, key) {
    return new Promise((resolve) => {
        const b = JSON.stringify(body);
        const req = https.request(API + path, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': key, 'Content-Length': b.length } },
            (res) => { let d = ''; res.on('data', c => d += c);
                res.on('end', () => resolve({ status: res.statusCode, body: d })); });
        req.on('error', (e) => resolve({ status: 0, body: e.message }));
        req.write(b); req.end();
    });
}

(async () => {
    const mint = await post('/channels/api-access', { ttlSeconds: 15, singleUse: false }, REAL_KEY);
    const key = JSON.parse(mint.body).data.temporaryKey;
    console.log('minted a 15s key:', key.slice(0, 20) + '…');

    // Works while alive?
    const alive = await post('/connect', { channelName: 'expiry-probe-' + Date.now(), channelPassword: 'pw12345678', agentName: 'probe-a' }, key);
    check(alive.status === 200, `a live temp key connects (HTTP ${alive.status})`);

    console.log('waiting 40s for it to expire…');
    await new Promise(r => setTimeout(r, 40000));

    // A FRESH connect on the dead key — no session to ride on.
    const dead = await post('/connect', { channelName: 'expiry-probe-' + Date.now(), channelPassword: 'pw12345678', agentName: 'probe-b' }, key);
    const refused = dead.status === 401 || dead.status === 403
        || /invalid|expired|unauthor/i.test(dead.body);
    check(refused,
        refused
            ? `an EXPIRED key is refused on a fresh connect (HTTP ${dead.status})`
            : `an EXPIRED key STILL CONNECTS (HTTP ${dead.status}) — key expiry does not end access`);
    console.log('  dead-key connect response:', dead.body.slice(0, 160));

    console.log('\nPASS (' + pass.length + ')'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(f => console.log('  ✗ ' + f));
    process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e.message); process.exit(2); });
