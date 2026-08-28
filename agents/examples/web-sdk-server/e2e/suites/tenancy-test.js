/*
 * Do two tenants on different plans actually get different allowances?
 *
 * This regressed silently once and nothing noticed. Developer.plan is a
 * LAZY association and the quota interceptor runs outside a transaction,
 * so reading it threw, the code fell back to the default, and every
 * developer was metered against Free's limit whatever plan they were on.
 * The console showed the right plan NAME above the wrong number, and the
 * only visible symptom was two tenants reporting an identical ceiling.
 *
 * That is the assertion here: not "a limit exists" — a limit that is the
 * SAME for a Free and a paid tenant is exactly the bug.
 */
/*
 * The messaging API is served by the gateway, not by the SDK site that BASE
 * points at, so this suite has its own base. Defaults to the local gateway;
 * override with API_BASE to check production.
 */
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8082';
const http = API_BASE.startsWith('https') ? require('https') : require('http');

const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

// Per-app tenants. Keys identify an app to the platform; they are not
// secrets in the sense a password is, and these are the local dev tenants.
const TENANTS = [
    { name: 'owner',       key: '38d66874-2b47-4aaf-b9dc-ab0a79f56faf', plan: 'Free' },
    { name: 'rooms-dev',   key: 'f719cc10-daf4-4753-9587-65ae5d777ff4', plan: 'Starter' },
    { name: 'droppro-dev', key: '627820c1-851e-47b3-8f12-cfc0d4f0d811', plan: 'Free' },
];

function head(key) {
    return new Promise((resolve) => {
        const url = new URL(API_BASE);
        const req = http.request({
            hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: '/messaging-platform/api/v1/messaging-service/health',
            method: 'GET', headers: { 'X-Api-Key': key },
        }, (res) => {
            res.resume();
            resolve({
                status: res.statusCode,
                limit: Number(res.headers['x-quota-limit'] || 0),
                used: res.headers['x-quota-used'],
            });
        });
        req.on('error', () => resolve({ status: 0, limit: 0 }));
        req.end();
    });
}

(async () => {
    const seen = {};
    for (const t of TENANTS) {
        const r = await head(t.key);
        seen[t.name] = r;
        check(r.limit > 0, `${t.name} is metered at all (limit ${r.limit || 'MISSING'})`);
    }

    const free = seen['droppro-dev'];
    const paid = seen['rooms-dev'];
    if (free && paid) {
        check(paid.limit !== free.limit,
            paid.limit !== free.limit
                ? `a paid tenant gets a different allowance (${paid.limit} vs ${free.limit})`
                : `a paid tenant and a free one report the SAME limit (${paid.limit}) — plan limits are not reaching the meter`);
        check(paid.limit > free.limit,
            `and a larger one (${paid.limit} > ${free.limit})`);
    }

    // Usage is per developer, not pooled: the owner has months of traffic and
    // a fresh tenant has almost none. Identical counters would mean the meter
    // is attributing everything to one account, which is the state this whole
    // change exists to end.
    const ownerUsed = Number(seen['owner'].used || 0);
    const roomsUsed = Number(paid.used || 0);
    check(ownerUsed !== roomsUsed,
        `usage is attributed per tenant (owner ${ownerUsed}, rooms-dev ${roomsUsed})`);

    console.log('\nPASS (' + pass.length + ')'); pass.forEach((p) => console.log('  ✓ ' + p));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach((f) => console.log('  ✗ ' + f));
    process.exit(fail.length ? 1 : 0);
})();
