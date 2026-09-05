/*
 * The developer portal's "Add-on sales" page, read the way a person would.
 *
 *     xvfb-run -a node suites/exchange-portal-test.js
 *
 * Serves the static portal from the working tree, signs in as a developer
 * against messaging-service, publishes one paid add-on in their name with
 * one unit sold, and reads the statement back off the page. What it insists
 * on is the honesty of the page: a unit count, the split, and the words
 * "unpriced" -- never a money figure.
 *
 * Needs DEVELOPER_EMAIL / DEVELOPER_PASSWORD (a developer who is also an
 * admin, or ADMIN_EMAIL / ADMIN_PASSWORD too) and messaging-service on
 * EXCHANGE_API_BASE (default 127.0.0.1:8082).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const STATIC = path.join(__dirname, '..', '..', 'src', 'main', 'resources', 'static');
const PORT = 8127;
const API_ROOT = (process.env.EXCHANGE_API_BASE || 'http://127.0.0.1:8082/messaging-platform/api/v1').replace(/\/messaging-service$/, '').replace(/\/$/, '');
const API = API_ROOT + '/messaging-service';
const DEV_EMAIL = process.env.DEVELOPER_EMAIL || process.env.ADMIN_EMAIL;
const DEV_PASSWORD = process.env.DEVELOPER_PASSWORD || process.env.ADMIN_PASSWORD;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || DEV_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEV_PASSWORD;

const pass = [], fail = [];
const check = (ok, what, extra) => { (ok ? pass : fail).push(what); console.log(`${ok ? '  PASS' : '  FAIL'}  ${what}${extra ? '  — ' + extra : ''}`); return ok; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve() {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
            const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
            const file = path.join(STATIC, rel);
            if (!file.startsWith(STATIC)) { res.writeHead(403).end(); return; }
            fs.readFile(file, (err, buf) => {
                if (err) { res.writeHead(404).end('no'); return; }
                res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
                res.end(buf);
            });
        });
        srv.listen(PORT, '127.0.0.1', () => resolve(srv));
    });
}
async function post(url, body, headers) {
    const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
    const login = await post(API_ROOT + '/developer/auth/login', { email: DEV_EMAIL, password: DEV_PASSWORD });
    const token = login.json && login.json.sessionToken;
    const devId = login.json && login.json.developerId;
    // process.exitCode rather than process.exit(): an immediate exit drops
    // stdout that is still buffered when it is a file or a pipe, which is how
    // this suite once reported nothing but its first line.
    if (!check(!!token, 'a developer session is available', 'status ' + login.status)) { process.exitCode = 1; return; }
    const admin = await post(API + '/admin/auth', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const adminToken = admin.json && admin.json.data && admin.json.data.token;
    if (!check(!!adminToken, 'an admin session is available', 'status ' + admin.status + ' ' + JSON.stringify(admin.json).slice(0, 120))) { process.exitCode = 1; return; }
    const asAdmin = { 'X-Admin-Token': adminToken };

    const ID = 'portal.sale' + Math.random().toString(36).slice(2, 6);
    await post(API + '/exchange/admin/addons', { id: ID, name: 'Portal sale', paid: true, authorDeveloperId: devId, version: '1.0.0',
        manifest: { id: ID, name: 'Portal sale', entry: 'index.html' }, bundle: '<!doctype html><title>x</title>' }, asAdmin);
    await post(API + '/till/admin/issue', { app: 'addon-' + ID, plan: 'purchase', seats: 0, provider: 'manual', providerRef: 'INV-portal' }, asAdmin);

    const srv = await serve();
    const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
    const ctx = await browser.newContext();
    await ctx.addInitScript(([t, root]) => {
        // ApiConfig treats this as the ORIGIN and appends /messaging-platform/api/v1 itself.
        window.MESSAGING_API_BASE = new URL(root).origin;
        // The portal keeps its session in sessionStorage; set both so this
        // does not silently break if that choice ever moves.
        [localStorage, sessionStorage].forEach((store) => {
            store.setItem('developer_token', t);
            store.setItem('developer_profile', JSON.stringify({ email: 'dev@example.com', name: 'Dev' }));
        });
    }, [token, API_ROOT]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => check(false, `page threw — ${e.message.slice(0, 90)}`));
    try {
    await page.goto(`http://127.0.0.1:${PORT}/developer/dashboard.html#/sales`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((id) => [...document.querySelectorAll('#salesTable tbody tr')].some((tr) => tr.textContent.includes(id)), ID, { timeout: 20000 }).catch(() => {});

    const seen = await page.evaluate((id) => {
        const row = [...document.querySelectorAll('#salesTable tbody tr')].find((tr) => tr.textContent.includes(id));
        return {
            nav: !!document.querySelector('.nav-item[data-section="sales"]'),
            shown: !document.getElementById('section-sales').hidden,
            row: row ? [...row.children].map((td) => td.textContent) : null,
            summary: document.getElementById('salesSummary').textContent,
            error: document.getElementById('salesError').textContent.trim().slice(0, 160),
        };
    }, ID);
    check(seen.nav && seen.shown, 'the Add-on sales page is reachable from the nav and shown at #/sales');
    check(!!seen.row && seen.row[2] === '1' && seen.row[3] === '1', 'the add-on shows one unit this month and one all time', JSON.stringify(seen.row) + (seen.error ? ' error: ' + seen.error : ''));
    check(/70%/.test(seen.summary) && /unpriced/.test(seen.summary) && !/[£$€]/.test(seen.summary), 'the summary shows the split and says unpriced, with no money figure', seen.summary);
    } catch (e) {
        check(false, 'the page could be read', String(e.message).slice(0, 120) + ' (at ' + page.url() + ')');
    }

    await browser.close();
    srv.close();
    await post(API + `/exchange/admin/addons/${ID}/suspend`, {}, asAdmin);
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exitCode = fail.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
