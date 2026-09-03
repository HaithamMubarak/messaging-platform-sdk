/*
 * Hooks (signed webhooks out), Meter (usage that can be billed) and Charter
 * (the compliance export).
 *
 *     node suites/hooks-meter-test.js
 *
 * Hooks stands up a local receiver that checks signatures the way a customer's
 * server would, and — the assertions that matter — proves the accept path
 * FIRST, then that a tampered body is caught, that a failure is retried with
 * the SAME event id, and that the SSRF guard refuses a private target.
 *
 * Meter is smaller and mostly about honesty: the numbers look exactly like an
 * invoice and are not one, so the response has to say so.
 *
 * Needs ADMIN_EMAIL / ADMIN_PASSWORD (a developer session is derived from the
 * admin account) and a service started with hooks.allow-private-targets=true,
 * without which a local receiver is — correctly — unreachable.
 */
const http = require('http');
const crypto = require('crypto');

const API = (process.env.TILL_API_BASE
    || 'http://127.0.0.1:8082/messaging-platform/api/v1/messaging-service').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const RECEIVER_HOST = process.env.HOOKS_RECEIVER_HOST || 'host.docker.internal';
const RECEIVER_PORT = Number(process.env.HOOKS_RECEIVER_PORT || 8198);

const pass = [], fail = [];
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    (ok ? pass : fail).push(label + (extra ? '  — ' + extra : ''));
    return ok;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Developer auth lives at the platform root, not under /messaging-service. */
const PLATFORM = API.replace(/\/messaging-service$/, '');

async function call(method, path, body, headers) {
    const base = path.startsWith('/developer/') ? PLATFORM : API;
    const res = await fetch(base + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) {}
    return { status: res.status, json, data: json && json.data };
}

/** A customer's server. Verifies every signature; can be told to fail. */
function receiver(port) {
    const seen = [];
    let failNext = 0;
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            seen.push({ url: req.url, headers: req.headers, body });
            if (failNext > 0) { failNext--; res.writeHead(500); res.end(); return; }
            res.writeHead(200); res.end();
        });
    });
    return new Promise(resolve => server.listen(port, '0.0.0.0', () => resolve({
        server, seen,
        failFor: n => { failNext = n; }
    })));
}

function verifySignature(header, body, secret) {
    if (!header) return { ok: false, why: 'no X-Hook-Signature' };
    const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header.trim());
    if (!m) return { ok: false, why: 'header is not t=<unix>,v1=<hex>' };
    const [, t, provided] = m;
    const expected = crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
    if (expected.length !== provided.length) return { ok: false, why: 'length mismatch' };
    const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    return ok ? { ok: true } : { ok: false, why: 'signature did not verify' };
}

(async () => {
    console.log(`\nHooks + Meter E2E — ${API}\n`);
    const rx = await receiver(RECEIVER_PORT);

    try {
        if (!EMAIL || !PASSWORD) {
            check(false, 'developer credentials are available', 'set ADMIN_EMAIL / ADMIN_PASSWORD');
            return report();
        }
        const auth = await call('POST', '/developer/auth/login', { email: EMAIL, password: PASSWORD });
        // The developer login answers with a FLAT object, not the
        // {status, data} envelope the messaging-service endpoints use. Reading
        // only `data` here returned undefined against a 200 and made a working
        // login look like a failed one.
        const token = (auth.data && (auth.data.token || auth.data.sessionToken))
            || (auth.json && auth.json.sessionToken);
        if (!check(!!token, 'a developer session is available', 'status ' + auth.status)) return report();
        const asDev = { Authorization: 'Bearer ' + token };

        // ---- 1. the SSRF guard --------------------------------------------
        // First, because it is the guard that makes an outbound-webhook feature
        // safe rather than a request forgery service with a nice API.
        console.log('\n[1] the server will not POST wherever it is told');
        const metadata = await call('POST', '/hooks', { url: 'http://169.254.169.254/latest/meta-data/' }, asDev);
        check(metadata.status === 400, 'a link-local metadata address is refused',
            'status ' + metadata.status + ' ' + (metadata.json && metadata.json.statusMessage));

        // ---- 2. register ---------------------------------------------------
        console.log('\n[2] an endpoint, and its one-time secret');
        const url = `http://${RECEIVER_HOST}:${RECEIVER_PORT}/hooks`;
        const created = await call('POST', '/hooks', { url, events: '*' }, asDev);
        const secret = created.data && created.data.secret;
        const endpointId = created.data && created.data.endpoint && created.data.endpoint.id;
        check(created.status === 201 && !!secret && !!endpointId,
            'the endpoint registers and hands back a signing secret',
            'status ' + created.status);

        const listed = await call('GET', '/hooks', undefined, asDev);
        check(!JSON.stringify(listed.data).includes(secret),
            'and no later response can produce that secret again');

        // ---- 3. delivery ----------------------------------------------------
        console.log('\n[3] a test event, signed');
        const before = rx.seen.length;
        const test = await call('POST', '/hooks/test', {}, asDev);
        check(test.data && test.data.queued >= 1, 'the test event is queued',
            JSON.stringify(test.data && test.data.queued));

        for (let i = 0; i < 40 && rx.seen.length === before; i++) await sleep(500);
        check(rx.seen.length > before, 'and the receiver got it',
            (rx.seen.length - before) + ' delivered');

        const delivery = rx.seen[rx.seen.length - 1];
        const verdict = verifySignature(delivery && delivery.headers['x-hook-signature'],
            delivery && delivery.body, secret);
        check(verdict.ok, 'the signature verifies against the secret we were given', verdict.why);
        check(!!(delivery && delivery.headers['x-hook-id'] && delivery.headers['x-hook-event']),
            'and the delivery names its event and id in headers',
            delivery && delivery.headers['x-hook-event']);

        // The control: prove the check above can fail, on the maths.
        const tampered = verifySignature(delivery.headers['x-hook-signature'],
            delivery.body.replace('work', 'work '), secret);
        check(tampered.ok === false && /did not verify/.test(tampered.why),
            'a body edited after signing does not verify', tampered.why);

        // ---- 4. retries carry the same id -----------------------------------
        console.log('\n[4] at-least-once, with an id the receiver can dedupe on');
        rx.failFor(1);
        const retryBefore = rx.seen.length;
        await call('POST', '/hooks/test', {}, asDev);
        for (let i = 0; i < 60 && rx.seen.length < retryBefore + 2; i++) await sleep(500);
        const attempts = rx.seen.slice(retryBefore);
        check(attempts.length >= 2, 'a 500 is retried', attempts.length + ' attempts');
        if (attempts.length >= 2) {
            check(attempts[0].headers['x-hook-id'] === attempts[1].headers['x-hook-id'],
                'and the retry carries the SAME event id — that is what makes dedupe possible',
                attempts[0].headers['x-hook-id']);
            check(attempts[1].headers['x-hook-attempt'] === '2',
                'while the attempt counter goes up, so a receiver can tell',
                attempts[1].headers['x-hook-attempt']);
        }

        const history = await call('GET', `/hooks/${endpointId}/deliveries?limit=10`, undefined, asDev);
        const rows = (history.data && history.data.deliveries) || [];
        check(rows.some(r => r.status === 'delivered'), 'the delivery log records what happened',
            rows.map(r => r.status).join(','));
        check(rows.some(r => r.lastError || r.attempts > 1),
            'including the failure, rather than only the eventual success');

        // ---- 5. Meter -------------------------------------------------------
        console.log('\n[5] usage that could be billed, and says it is not');
        const usage = await call('GET', '/meter/usage', undefined, asDev);
        check(usage.status === 200 && usage.data && typeof usage.data.apiCalls === 'number',
            'a billing period reads back', 'calls: ' + (usage.data && usage.data.apiCalls));
        check(usage.data && usage.data.charged === false && usage.data.final === false,
            'and says plainly that it is open and nothing was charged',
            JSON.stringify({ final: usage.data && usage.data.final,
                             charged: usage.data && usage.data.charged }));
        const closed = await call('GET', '/meter/usage?period=2020-01', undefined, asDev);
        check(closed.data && closed.data.final === true,
            'a past period is marked final', closed.data && closed.data.period);
        const bad = await call('GET', '/meter/usage?period=not-a-month', undefined, asDev);
        check(bad.status === 400, 'and a malformed period is refused rather than guessed',
            'status ' + bad.status);

        const noAuth = await call('GET', '/meter/usage');
        check(noAuth.status === 401, 'usage is not readable without a session',
            'status ' + noAuth.status);

        // ---- 6. Charter -------------------------------------------------------
        //
        // The enterprise question is "what do you hold about us, who touched
        // it, and can we check the record was not edited". Charter answers it
        // by assembly, so the assertions are about SCOPE and HONESTY rather
        // than about anything new working.
        console.log('\n[6] one answer to the compliance question');
        const mine = await call('GET', '/charter/export', undefined, asDev);
        check(mine.status === 200 && mine.data && mine.data.charterVersion === 1,
            'a tenant can export their own charter', 'status ' + mine.status);
        check(mine.data && mine.data.notIncluded && mine.data.notIncluded.length >= 4,
            'and it states what it does NOT contain, rather than reading as complete',
            JSON.stringify((mine.data.notIncluded || []).map(x => x.what)));
        check(/sha256\(prev/.test((mine.data && mine.data.howToVerify) || ''),
            'with the rule for re-deriving a chain, so verifying needs no help from us');

        const noAuthCharter = await call('GET', '/charter/export');
        check(noAuthCharter.status === 401, 'a charter is not readable without a session',
            'status ' + noAuthCharter.status);

        // Scope is the property that matters. Export two tenants and make sure
        // neither bundle contains the other's channels — a compliance export is
        // the single most useful thing to obtain about somebody else's account.
        const adminAuth = await call('POST', '/admin/auth', { email: EMAIL, password: PASSWORD });
        const adminToken = adminAuth.data && (adminAuth.data.token || adminAuth.data.sessionToken);
        if (!check(!!adminToken, 'an admin session is available to compare tenants')) {
            // fall through — the rest of this section needs it
        } else {
            const asAdmin = { 'X-Admin-Token': adminToken };
            const a = await call('GET', '/charter/admin/export?developerId=2', undefined, asAdmin);
            const b = await call('GET', '/charter/admin/export?developerId=4', undefined, asAdmin);
            const idsOf = r => ((r.data && r.data.channels) || []).map(c => c.channelId);
            const aIds = idsOf(a), bIds = idsOf(b);
            check(a.status === 200 && b.status === 200, 'two tenants export',
                aIds.length + ' and ' + bIds.length + ' channels');
            const overlap = aIds.filter(id => bIds.indexOf(id) !== -1);
            check(overlap.length === 0,
                'and neither bundle contains a single channel belonging to the other',
                overlap.slice(0, 3).join(','));
            // A test that passed because both were empty would prove nothing.
            check(aIds.length > 0 && bIds.length > 0,
                'with both bundles non-empty, so the check above means something',
                aIds.length + '/' + bIds.length);

            // The chain summary must be self-sufficient: genesis re-derives here.
            const withChain = ((b.data && b.data.channels) || [])
                .filter(c => c.attestChains && c.attestChains.length)[0];
            if (withChain) {
                const chain = withChain.attestChains[0];
                const expected = crypto.createHash('sha256')
                    .update(withChain.channelId + '|' + chain.chainKey).digest('hex');
                check(chain.genesis === expected,
                    'the genesis in the bundle is the one a verifier would compute',
                    chain.genesis.slice(0, 16) + '… vs ' + expected.slice(0, 16) + '…');
                check(/^[0-9a-f]{64}$/.test(chain.head || ''),
                    'and the chain head is carried so the export can be checked cold');
            } else {
                check(false, 'a tenant with an Attest chain was found to check the genesis against');
            }
        }

        // ---- 7. cleanup ------------------------------------------------------
        const deleted = await call('DELETE', `/hooks/${endpointId}`, undefined, asDev);
        check(deleted.status === 200, 'the endpoint can be removed');

    } catch (err) {
        console.error('\nTEST THREW:', (err && err.stack) || err);
        check(false, 'the suite ran to the end');
    } finally {
        rx.server.close();
    }
    report();
})();

function report() {
    console.log('\nPASS (' + pass.length + ')');
    pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length === 0 ? 0 : 1);
}
