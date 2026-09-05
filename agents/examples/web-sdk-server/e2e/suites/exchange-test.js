/*
 * Exchange: the add-on marketplace, phase A -- sold by invoice, enforced at
 * the fetch.
 *
 *     node suites/exchange-test.js
 *
 * Talks to messaging-service directly, like till-test. What it insists on:
 *
 *   1. a free add-on's bundle is served with no key;
 *   2. a paid add-on's bundle is a 402 with no key, and the 402 NAMES what
 *      lifts it -- 402, never 403;
 *   3. a licence issued by an admin (Till, app "addon-<id>", provider manual)
 *      opens it;
 *   4. the CONTROL: the same key is refused again once that licence is
 *      revoked. A gate nobody has watched close is decoration;
 *   5. the served manifest points the plugin host at the bundle endpoint
 *      (entry "bundle", exchange true) so the key never rides a URL;
 *   6. a suspended add-on is 410, and gone from the catalogue.
 *
 * Needs an admin: ADMIN_EMAIL / ADMIN_PASSWORD, or ADMIN_API_KEY
 * ("keyId.secret" of an admin developer) for a box with no admin password.
 */
const API = (process.env.TILL_API_BASE || process.env.EXCHANGE_API_BASE
    || 'http://127.0.0.1:8082/messaging-platform/api/v1/messaging-service').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

const pass = [], fail = [];
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    (ok ? pass : fail).push(label);
    return ok;
}
async function call(method, path, body, headers) {
    const res = await fetch(API + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, json, data: json && json.data, text, type: res.headers.get('content-type') || '' };
}
function report() {
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
}

const STAMP = Math.random().toString(36).slice(2, 7);
const FREE = 'exchange.free' + STAMP;
const PAID = 'exchange.paid' + STAMP;
const manifest = (id, name) => ({ id, name, entry: 'index.html', capabilities: [{ cap: 'send:all', reason: 'test' }] });
const BUNDLE = '<!doctype html><title>x</title><script>parent.postMessage({type:"plugin-ready"},"*")</script>';

(async () => {
    console.log(`\nExchange E2E — ${API}\n`);

    const auth = ADMIN_API_KEY
        ? await call('POST', '/admin/auth', { apiKey: ADMIN_API_KEY })
        : await call('POST', '/admin/auth', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const adminToken = auth.data && (auth.data.token || auth.data.sessionToken);
    if (!check(!!adminToken, 'an admin session is available', 'status ' + auth.status)) return report();
    const asAdmin = { 'X-Admin-Token': adminToken };

    // ---- publish one free and one paid add-on --------------------------
    const pubFree = await call('POST', '/exchange/admin/addons',
        { id: FREE, name: 'Free one', summary: 'free', paid: false, version: '1.0.0', manifest: manifest(FREE, 'Free one'), bundle: BUNDLE }, asAdmin);
    check(pubFree.status === 201, 'a free add-on publishes', 'status ' + pubFree.status + ' ' + (pubFree.json && pubFree.json.message));
    const pubPaid = await call('POST', '/exchange/admin/addons',
        { id: PAID, name: 'Paid one', summary: 'paid', paid: true, version: '1.0.0', manifest: manifest(PAID, 'Paid one'), bundle: BUNDLE }, asAdmin);
    check(pubPaid.status === 201, 'a paid add-on publishes', 'status ' + pubPaid.status);
    const noAdmin = await call('POST', '/exchange/admin/addons', { id: 'x.y.z', name: 'x', version: '1', manifest: {}, bundle: 'x' });
    check(noAdmin.status === 401, 'publishing without an admin token is 401', 'status ' + noAdmin.status);

    // ---- catalogue and manifest ----------------------------------------
    const cat = await call('GET', '/exchange/addons');
    const ids = ((cat.data && cat.data.addons) || []).map((a) => a.id);
    check(ids.includes(FREE) && ids.includes(PAID), 'both appear in the public catalogue');
    const man = await call('GET', `/exchange/addons/${PAID}/manifest`);
    check(man.status === 200 && man.json && man.json.entry === 'bundle' && man.json.exchange === true && man.json.paid === true,
        'the served manifest says entry "bundle" and exchange: true, so the host POSTs for the bytes');

    // ---- the gate ------------------------------------------------------
    const freeFetch = await call('POST', `/exchange/addons/${FREE}/bundle`, {});
    check(freeFetch.status === 200 && freeFetch.text === BUNDLE && /text\/html/.test(freeFetch.type),
        'a free bundle is served with no key, as text/html');

    const noKey = await call('POST', `/exchange/addons/${PAID}/bundle`, {});
    check(noKey.status === 402, 'a paid bundle with no key is 402', 'status ' + noKey.status);
    check(!!(noKey.json && noKey.json.lifts && /addon-/.test(noKey.json.lifts)),
        'the 402 names what lifts it', noKey.json && noKey.json.lifts);
    const wrongKey = await call('POST', `/exchange/addons/${PAID}/bundle`, { key: 'TILL-NOPE-000' });
    check(wrongKey.status === 402 && wrongKey.json && wrongKey.json.reason === 'unknown_or_revoked',
        'a made-up key is 402 unknown_or_revoked', JSON.stringify(wrongKey.json));

    // ---- a purchase is a Till licence for app addon-<id> ---------------
    const issued = await call('POST', '/till/admin/issue',
        { app: 'addon-' + PAID, plan: 'purchase', seats: 0, issuedTo: 'buyer@example.com', provider: 'manual', providerRef: 'INV-' + STAMP }, asAdmin);
    const key = issued.data && issued.data.key;
    const licenceId = issued.data && issued.data.licence && issued.data.licence.id;
    check(!!key && !!licenceId, 'an admin issues the purchase as a Till licence (provider manual)', 'status ' + issued.status);

    const withKey = await call('POST', `/exchange/addons/${PAID}/bundle`, { key });
    check(withKey.status === 200 && withKey.text === BUNDLE, 'the purchased key opens the bundle', 'status ' + withKey.status);

    const purchases = await call('GET', `/exchange/admin/addons/${PAID}/purchases`, undefined, asAdmin);
    const list = (purchases.data && purchases.data.purchases) || [];
    check(list.length === 1 && list[0].provider === 'manual' && !JSON.stringify(list).includes(key),
        'the admin purchase list shows the licence without its key');

    // ---- the control: revoke, and the same key is refused ---------------
    const revoked = await call('POST', '/till/admin/revoke', { id: licenceId }, asAdmin);
    check(revoked.status === 200, 'the licence is revoked');
    const afterRevoke = await call('POST', `/exchange/addons/${PAID}/bundle`, { key });
    check(afterRevoke.status === 402 && afterRevoke.json && afterRevoke.json.reason === 'revoked',
        'CONTROL: the same key is 402 revoked once the licence is taken away', JSON.stringify(afterRevoke.json));

    // ---- suspension -----------------------------------------------------
    const susp = await call('POST', `/exchange/admin/addons/${FREE}/suspend`, undefined, asAdmin);
    check(susp.status === 200, 'an add-on can be suspended');
    const gone = await call('POST', `/exchange/addons/${FREE}/bundle`, {});
    check(gone.status === 410, 'a suspended add-on is 410 at the fetch', 'status ' + gone.status);
    const cat2 = await call('GET', '/exchange/addons');
    check(!((cat2.data && cat2.data.addons) || []).some((a) => a.id === FREE), 'and gone from the catalogue');

    // ---- statements need a developer session ----------------------------
    const anon = await call('GET', '/exchange/statements');
    check(anon.status === 401, 'statements without a developer session are 401', 'status ' + anon.status);

    // ---- a developer's statement: units, a split, and no amount ---------
    const DEV_EMAIL = process.env.DEVELOPER_EMAIL || ADMIN_EMAIL;
    const DEV_PASSWORD = process.env.DEVELOPER_PASSWORD || ADMIN_PASSWORD;
    if (DEV_EMAIL && DEV_PASSWORD) {
        const devBase = API.replace(/\/messaging-service$/, '');
        const login = await fetch(devBase + '/developer/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: DEV_EMAIL, password: DEV_PASSWORD }),
        }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
        // The developer login answers flat: { developerId, sessionToken, ... }.
        const devToken = login.json && (login.json.sessionToken || (login.json.data && login.json.data.sessionToken));
        const devId = login.json && (login.json.developerId || (login.json.data && login.json.data.developerId));
        if (check(!!devToken, 'a developer session is available for statements', 'status ' + login.status)) {
            const MINE = 'exchange.mine' + STAMP;
            const authorId = devId || (auth.data.admin && auth.data.admin.id);
            await call('POST', '/exchange/admin/addons',
                { id: MINE, name: 'Mine', paid: true, authorDeveloperId: authorId, version: '1.0.0', manifest: manifest(MINE, 'Mine'), bundle: BUNDLE }, asAdmin);
            await call('POST', '/till/admin/issue', { app: 'addon-' + MINE, plan: 'purchase', seats: 0, provider: 'manual', providerRef: 'INV-2' }, asAdmin);
            const st = await call('GET', '/exchange/statements', undefined, { Authorization: 'Bearer ' + devToken });
            const line = st.data && (st.data.lines || []).find((l) => l.addon === MINE);
            check(!!line && line.unitsThisMonth === 1 && line.unitsAllTime === 1,
                'the statement counts the one unit sold', JSON.stringify(st.data && st.data.lines));
            check(st.data && st.data.amount === null && st.data.authorSharePercent === 70,
                'the statement carries a split and NO amount', 'amount=' + (st.data && st.data.amount));
            await call('POST', `/exchange/admin/addons/${MINE}/suspend`, undefined, asAdmin);
        }
    }

    // Tidy: suspend the paid one too so the catalogue does not accumulate test rows.
    await call('POST', `/exchange/admin/addons/${PAID}/suspend`, undefined, asAdmin);
    report();
})().catch((e) => { console.error(e); process.exit(1); });
