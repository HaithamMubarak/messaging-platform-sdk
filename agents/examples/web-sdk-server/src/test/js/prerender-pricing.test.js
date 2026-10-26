/**
 * The pricing page's plans are prerendered from data/plans.json (tools/prerender-pricing.cjs,
 * 2026-10-26), so a visitor without script sees them. This fails when the page and the snapshot
 * differ, and when the page drops a region the script refreshes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pre = require('../../../tools/prerender-pricing.cjs');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const page = fs.readFileSync(path.join(STATIC, 'pricing.html'), 'utf8').replace(/\r\n/g, '\n');
const data = JSON.parse(fs.readFileSync(path.join(STATIC, 'data', 'plans.json'), 'utf8'));

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

check('pricing.html shows the plans in data/plans.json (run node tools/prerender-pricing.cjs)', () => {
    assert.ok(pre.apply(page, data) === page, 'the page differs from the snapshot');
});

check('without script, every plan, its price and the comparison are in the HTML', () => {
    for (const p of data.plans) {
        assert.ok(page.includes('<h3>' + p.name + '</h3>'), p.name + ' is not in the page');
        assert.ok(page.includes('<div class="mp-plan-price">' + p.priceLabel + '<small>'), p.name + "'s price is not in the page");
    }
    assert.ok(/<table class="mp-caps">/.test(page), 'no comparison table');
    assert.ok(!/needs JavaScript/.test(page), 'the page still says it needs JavaScript');
});

check('the page and the script fill the same regions', () => {
    for (const name of pre.REGIONS) assert.ok(page.includes(pre.mark(name)[0]), name + ' has no markers');
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
