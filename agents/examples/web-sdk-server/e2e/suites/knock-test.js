/*
 * Knock: a content-free ping to a closed browser.
 *
 *     xvfb-run -a node suites/knock-test.js
 *
 * A real push needs a real push service, which this box cannot have. So the
 * suite stands one up: a local HTTP server that plays the part of FCM, records
 * what arrives, and — this is the point — VERIFIES THE VAPID SIGNATURE the way
 * a push service would. That turns an untestable feature into a testable one,
 * and it catches the exact bug class this codebase has already shipped once:
 * JWS ES256 is a raw r||s signature, and Java's default ECDSA emits DER. A
 * suite that only checked "we POSTed something" would go green with every
 * push in the world being rejected.
 *
 * It also proves the two guards, which are the reason this feature is safe:
 *
 *   * the SSRF gate — an endpoint is a URL a client supplies and the server
 *     fetches, so a host outside the allowlist must be refused at subscribe
 *     time, not at push time;
 *   * the rate cap — something that can ping a phone in a loop is a weapon.
 */
const http = require('http');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { BASE, LAUNCH, results, gotoStable } = require('../lib/harness');

const API = (process.env.KNOCK_API_BASE
    || 'http://127.0.0.1:8082/messaging-platform/api/v1/messaging-service').replace(/\/$/, '');
/** How the CONTAINER reaches this host. compose maps it with extra_hosts. */
const PUSH_HOST = process.env.KNOCK_PUSH_HOST || 'host.docker.internal';
const PUSH_PORT = Number(process.env.KNOCK_PUSH_PORT || 8199);

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
    return ok;
}

async function post(path, body) {
    const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) {}
    return { status: res.status, json, data: json && json.data };
}

/** A stand-in push service. Records every delivery; verifies every signature. */
function fakePushService(port) {
    const received = [];
    const server = http.createServer((req, res) => {
        let body = [];
        req.on('data', c => body.push(c));
        req.on('end', () => {
            received.push({
                url: req.url,
                method: req.method,
                headers: req.headers,
                bodyLength: Buffer.concat(body).length
            });
            // 410 Gone for one specific path, so the dead-subscription path
            // can be exercised without waiting for a real one to expire.
            res.writeHead(req.url.includes('/gone') ? 410 : 201);
            res.end();
        });
    });
    return new Promise(resolve => server.listen(port, '0.0.0.0',
        () => resolve({ server, received })));
}

/**
 * Check a VAPID Authorization header the way a push service does.
 *
 * Returns why it failed rather than just false — "the signature was rejected"
 * and "the header was not even shaped like VAPID" are different bugs.
 */
function verifyVapid(authorization, expectedAudience) {
    if (!authorization) return { ok: false, why: 'no Authorization header' };
    const m = /^vapid t=([^,]+),k=(.+)$/.exec(authorization.trim());
    if (!m) return { ok: false, why: 'header is not "vapid t=<jwt>,k=<key>"' };
    const [, jwt, appServerKey] = m;

    const parts = jwt.split('.');
    if (parts.length !== 3) return { ok: false, why: 'JWT does not have three parts' };
    const [headerB64, claimsB64, sigB64] = parts;

    const fromB64Url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    let header, claims;
    try {
        header = JSON.parse(fromB64Url(headerB64).toString('utf8'));
        claims = JSON.parse(fromB64Url(claimsB64).toString('utf8'));
    } catch (e) {
        return { ok: false, why: 'header or claims are not JSON' };
    }
    if (header.alg !== 'ES256') return { ok: false, why: 'alg is ' + header.alg + ', not ES256' };
    if (claims.aud !== expectedAudience) {
        return { ok: false, why: 'aud is ' + claims.aud + ', expected ' + expectedAudience };
    }
    if (!claims.exp || claims.exp * 1000 < Date.now()) return { ok: false, why: 'already expired' };
    if (!claims.sub) return { ok: false, why: 'no sub — a push service has nobody to contact' };

    const signature = fromB64Url(sigB64);
    if (signature.length !== 64) {
        // The one that matters: 64 bytes is raw r||s. A DER signature is
        // 70-72 bytes and is what a plain SHA256withECDSA produces.
        return { ok: false, why: 'signature is ' + signature.length + ' bytes, not the 64 ES256 requires '
                                 + '(a DER signature would be ~70 — that is the bug)' };
    }

    // Rebuild an SPKI around the raw EC point so node can import it.
    const raw = fromB64Url(appServerKey);
    if (raw.length !== 65 || raw[0] !== 0x04) {
        return { ok: false, why: 'k= is not an uncompressed 65-byte EC point' };
    }
    const spkiPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    const key = crypto.createPublicKey({
        key: Buffer.concat([spkiPrefix, raw]),
        format: 'der',
        type: 'spki'
    });
    const verified = crypto.verify('sha256', Buffer.from(headerB64 + '.' + claimsB64),
        { key, dsaEncoding: 'ieee-p1363' }, signature);
    return verified ? { ok: true, claims } : { ok: false, why: 'signature did not verify' };
}

(async () => {
    console.log(`\nKnock E2E — ${API}\n`);
    const { server, received } = await fakePushService(PUSH_PORT);
    const browser = await chromium.launch(LAUNCH);
    const room = 'knock-e2e-' + Math.random().toString(36).slice(2, 7);
    let ctx = null;

    try {
        // ---- a session to act with ---------------------------------------
        ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(60000);
        await gotoStable(page, `${BASE}/apps/evidence-chain/app.html?debug`,
            { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#usernameInput', { timeout: 45000 });
        await page.fill('#usernameInput', 'Knocker');
        await page.fill('#channelInput', room);
        await page.fill('#passwordInput', 'knock-pw-1');
        await page.click('#connectBtn');
        await page.waitForFunction(() => window.ecApp && window.ecApp.connected
            && window.ecApp.channel && window.ecApp.channel.sessionId, { timeout: 45000 });
        const sessionId = await page.evaluate(() => window.ecApp.channel.sessionId);
        check(!!sessionId, 'a channel session is available to act with');

        const sdkReady = await page.evaluate(() =>
            typeof window.ecApp.channel.knockSubscribe === 'function'
            && typeof window.ecApp.channel.knock === 'function');
        check(sdkReady, 'the served SDK exposes knockSubscribe() and knock()');

        // ---- 1. the key a browser subscribes with -------------------------
        console.log('\n[1] the application server key');
        const keyRes = await fetch(API + '/knock/key').then(r => r.json());
        const appKey = keyRes.data && keyRes.data.applicationServerKey;
        const keyBytes = Buffer.from(String(appKey).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        check(keyBytes.length === 65 && keyBytes[0] === 0x04,
            'it is the raw 65-byte EC point PushManager wants, not an SPKI blob',
            keyBytes.length + ' bytes, first byte 0x' + keyBytes[0].toString(16));
        check(keyRes.data && keyRes.data.ephemeral === false,
            'and it is a configured key, not one that dies at the next restart',
            'ephemeral: ' + (keyRes.data && keyRes.data.ephemeral));

        // ---- 2. the SSRF gate --------------------------------------------
        // Before anything else: this is the guard that makes the feature safe.
        console.log('\n[2] the server will not fetch whatever it is handed');
        const evil = await post('/knock/subscribe', {
            sessionId, endpoint: 'http://169.254.169.254/latest/meta-data/',
            p256dh: 'x'.repeat(20), auth: 'y'.repeat(16)
        });
        check(evil.status === 400, 'a cloud metadata endpoint is refused at subscribe time',
            'status ' + evil.status);
        const internal = await post('/knock/subscribe', {
            sessionId, endpoint: 'http://postgres:5432/', p256dh: 'x'.repeat(20), auth: 'y'.repeat(16)
        });
        check(internal.status === 400, 'and so is a service on the internal network',
            'status ' + internal.status);

        // ---- 3. subscribe and knock ---------------------------------------
        console.log('\n[3] a knock actually goes out');
        const endpoint = `http://${PUSH_HOST}:${PUSH_PORT}/push/${Math.random().toString(36).slice(2, 9)}`;
        const sub = await post('/knock/subscribe', {
            sessionId, endpoint, p256dh: 'BOa'.repeat(20), auth: 'abcdefghijklmnop'
        });
        check(sub.status === 200 && sub.data && sub.data.subscribed === true,
            'an allowed endpoint subscribes', 'status ' + sub.status);

        const before = received.length;
        const knock = await post('/knock/send', { sessionId, agent: 'Knocker', tag: 'board-updated' });
        check(knock.data && knock.data.sent === 1, 'the knock reports one device sent',
            JSON.stringify(knock.data && knock.data.results));
        check(received.length === before + 1, 'and the push service received exactly one request',
            (received.length - before) + ' arrived');

        const delivery = received[received.length - 1];

        // ---- 4. what arrived --------------------------------------------
        console.log('\n[4] what a push service actually got');
        check(delivery && delivery.bodyLength === 0,
            'no payload at all — content-free is literal, not a promise about encryption',
            delivery ? delivery.bodyLength + ' bytes' : 'nothing');

        const audience = `http://${PUSH_HOST}:${PUSH_PORT}`;
        const vapid = verifyVapid(delivery && delivery.headers.authorization, audience);
        check(vapid.ok, 'the VAPID signature verifies as a push service would check it', vapid.why);
        check(!!(delivery && delivery.headers.ttl),
            'a TTL is set, so a knock does not arrive tomorrow',
            delivery && delivery.headers.ttl);
        check(delivery && delivery.headers.topic === 'board-updated',
            'the tag becomes a Topic, so repeats collapse into one notification',
            delivery && delivery.headers.topic);

        // The control: prove the verifier above can say no. Otherwise one that
        // returned {ok:true} unconditionally would look green.
        //
        // The tamper flips one character INSIDE the signature and keeps its
        // length. An earlier version inserted a character instead, and passed
        // for the wrong reason: it was caught by the 64-byte length check
        // before any verification happened, which proves nothing about whether
        // the signature is actually checked.
        const auth = String(delivery.headers.authorization);
        const sigPart = auth.split('.')[2].split(',')[0];
        const flipped = sigPart.slice(0, 10)
            + (sigPart[10] === 'A' ? 'B' : 'A')
            + sigPart.slice(11);
        const tamperedVerdict = verifyVapid(auth.replace(sigPart, flipped), audience);
        check(tamperedVerdict.ok === false && /did not verify/.test(tamperedVerdict.why || ''),
            'and the same check rejects a signature with one character changed, '
            + 'failing on the maths rather than the length',
            tamperedVerdict.why);

        // ---- 5. the rate cap ---------------------------------------------
        console.log('\n[5] a ping in a loop is a weapon');
        let capped = null;
        for (let i = 0; i < 8; i++) {
            const res = await post('/knock/send', { sessionId, agent: 'Knocker', tag: 'spam' });
            if (res.data && res.data.rateCapped > 0) { capped = res.data; break; }
        }
        check(!!capped, 'knocking repeatedly hits a cap',
            capped ? 'capped after ' + capped.devices + ' device(s)' : 'never capped in 8 tries');

        // ---- 6. what the caller is allowed to learn ------------------------
        console.log('\n[6] an endpoint is a capability, not a fact about somebody');
        const reach = await post('/knock/reachable', { sessionId });
        const body = JSON.stringify(reach.data || {});
        check(reach.data && Array.isArray(reach.data.reachable) && reach.data.reachable.length >= 1,
            'a member can see who is reachable');
        check(!body.includes(PUSH_HOST) && !body.includes('/push/'),
            'but never anybody\'s endpoint — that would be a direct line to their device');

        // ---- 7. membership ------------------------------------------------
        console.log('\n[7] membership is the authorisation');
        const noSession = await post('/knock/send', { sessionId: 'not-a-session', agent: 'Knocker' });
        check(noSession.status === 401, 'knocking without a session is refused',
            'status ' + noSession.status);
        const strangerBefore = received.length;
        const stranger = await post('/knock/send', { sessionId, agent: 'SomebodyElsewhere' });
        check(stranger.data && stranger.data.devices === 0 && received.length === strangerBefore,
            'and knocking a name that is not in this channel reaches nothing',
            JSON.stringify(stranger.data && stranger.data.devices));

        // ---- 8. a dead subscription is dropped ----------------------------
        console.log('\n[8] a gone subscription is dropped, not retried forever');
        const goneEndpoint = `http://${PUSH_HOST}:${PUSH_PORT}/push/gone-${Math.random().toString(36).slice(2, 7)}`;
        await post('/knock/subscribe', {
            sessionId, endpoint: goneEndpoint, p256dh: 'BOa'.repeat(20), auth: 'abcdefghijklmnop'
        });
        const goneKnock = await post('/knock/send', { sessionId, agent: 'Knocker', tag: 'gone-test' });
        const outcomes = (goneKnock.data && goneKnock.data.results || []).map(r => r.outcome);
        check(outcomes.includes('dropped'),
            'a 410 from the push service drops the subscription on the spot',
            outcomes.join(','));
        const afterDrop = await post('/knock/reachable', { sessionId });
        const devices = afterDrop.data && afterDrop.data.reachable[0] && afterDrop.data.reachable[0].devices;
        check(devices === 1, 'and it is gone from the count', 'devices now ' + devices);

    } catch (err) {
        console.error('\nTEST THREW:', (err && err.stack) || err);
        check(false, 'the suite ran to the end');
    } finally {
        if (ctx) { try { await ctx.close(); } catch (_) {} }
        await browser.close();
        server.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
