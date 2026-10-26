#!/usr/bin/env node
/*
 * The pricing page's plans as static HTML (2026-10-26).
 *
 * pricing.html drew its plans and comparison only from script, so a visitor without it, and
 * every crawler, saw an empty page with "This table needs JavaScript". This writes what
 * js/pricing.js renders from the data/plans.json snapshot into the page between markers, with
 * pricing.js's own functions, so the markup has one source. In the browser pricing.js then
 * refreshes the same regions from GET /billing/plans; while the snapshot matches the service,
 * nothing on screen changes.
 *
 *     node tools/prerender-pricing.cjs             write the page from the snapshot
 *     node tools/prerender-pricing.cjs --refresh   first copy the live plans into the snapshot
 *     node tools/prerender-pricing.cjs --check     exit 1 if the page differs from the snapshot
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STATIC = path.join(__dirname, '..', 'src', 'main', 'resources', 'static');
const PAGE = path.join(STATIC, 'pricing.html');
const PLANS = path.join(STATIC, 'data', 'plans.json');
const LIVE = 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service/billing/plans';
const REGIONS = ['notice', 'plans', 'enforced', 'compare'];

global.window = global.window || {};
require(path.join(STATIC, 'js', 'plan-format.js'));
const { regions } = require(path.join(STATIC, 'js', 'pricing.js'));

const mark = (name) => [`<!-- prerender:${name} (tools/prerender-pricing.cjs; do not edit here) -->`, `<!-- /prerender:${name} -->`];

/** The page with each region's markup between its markers; a missing marker is an error, not a skip. */
function apply(html, data) {
    const r = regions(data);
    for (const name of REGIONS) {
        const [open, close] = mark(name);
        const i = html.indexOf(open), j = html.indexOf(close);
        if (i < 0 || j < i) throw new Error(`pricing.html has no ${name} markers`);
        html = html.slice(0, i + open.length) + r[name] + html.slice(j);
    }
    return html;
}

/** The snapshot's plans replaced by the service's, in the shape the page renders. */
async function refresh() {
    const res = await fetch(LIVE, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${LIVE} answered ${res.status}`);
    const list = (await res.json()).data.plans;
    if (!Array.isArray(list) || !list.length) throw new Error('the service listed no plans');
    const raw = fs.readFileSync(PLANS, 'utf8');
    const data = JSON.parse(raw);
    data.plans = list.map(window.PlanFormat.fromApi).map(({ id, name, status, priceLabel, period, audience, featured, cta, limits, enforced }) =>
        ({ id, name, status, priceLabel, period, audience, featured, cta, limits, enforced }));
    const out = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(PLANS, raw.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out);
    console.log(`  refreshed ${data.plans.length} plans from the service`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--refresh')) await refresh();
    const raw = fs.readFileSync(PAGE, 'utf8');
    const crlf = raw.includes('\r\n');
    const lf = raw.replace(/\r\n/g, '\n');
    const out = apply(lf, JSON.parse(fs.readFileSync(PLANS, 'utf8')));
    if (args.includes('--check')) {
        console.log(out === lf ? 'pricing.html matches data/plans.json' : 'pricing.html is out of date: run node tools/prerender-pricing.cjs');
        process.exitCode = out === lf ? 0 : 1;
        return;
    }
    if (out !== lf) fs.writeFileSync(PAGE, crlf ? out.replace(/\n/g, '\r\n') : out);
    console.log(out === lf ? '  pricing.html already current' : '  wrote pricing.html');
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });

module.exports = { apply, mark, REGIONS };
