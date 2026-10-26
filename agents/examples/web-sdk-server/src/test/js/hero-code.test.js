/**
 * The hub hero's code (2026-10-26) is the quickstart, shortened: every call it makes and every
 * string it passes must be in the program it names (agents/examples/quickstart, run live against
 * the platform). A page that shows a call the SDK does not have teaches it (guidelines 6.47).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const QUICKSTART = path.join(__dirname, '..', '..', '..', '..', 'quickstart');
const hub = fs.readFileSync(path.join(STATIC, 'hub.html'), 'utf8');

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const panes = [...hub.matchAll(/<pre class="home-code__pane"[^>]*data-source="([^"]+)"[^>]*>([\s\S]*?)<\/pre>/g)]
    .map((m) => ({ source: m[1], code: text(m[2]) }));

check('the hero shows JavaScript, Python and Java, each naming its quickstart program', () => {
    assert.deepStrictEqual(panes.map((p) => p.source), ['quickstart.js', 'quickstart.py', 'Quickstart.java']);
    for (const p of panes) assert.ok(fs.existsSync(path.join(QUICKSTART, p.source)), p.source + ' does not exist');
});

check('every call and every string in the hero is in its quickstart program', () => {
    for (const p of panes) {
        const program = fs.readFileSync(path.join(QUICKSTART, p.source), 'utf8');
        const code = p.code.split('\n').filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n');
        const calls = [...code.matchAll(/\.?([A-Za-z_]\w*)\(/g)].map((m) => m[1]).filter((n) => !/^(if|for|print)$/.test(n));
        const strings = [...code.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
        for (const c of calls) assert.ok(program.includes(c + '('), `${p.source}: the hero calls ${c}(), the program does not`);
        for (const s of strings) assert.ok(program.includes(s), `${p.source}: the hero passes "${s}", the program does not`);
        assert.ok(calls.length >= 4 && strings.length >= 3, p.source + ': nothing was checked');
    }
});

check('each sample is at most eleven lines (site.css holds the pane at eleven)', () => {
    for (const p of panes) assert.ok(p.code.split('\n').length <= 11, p.source + ' has ' + p.code.split('\n').length + ' lines');
});

check('the Python install line is the README\'s', () => {
    const readme = fs.readFileSync(path.join(QUICKSTART, 'README.md'), 'utf8');
    const pip = panes[1].code.split('\n')[0].replace(/^#\s*/, '');
    assert.ok(readme.includes(pip), 'the hero installs with "' + pip + '"');
});

// The trust strip beside it: each item a link to its evidence, and no number typed into the HTML
// (the health and the counts are fetched; an invented customer count is what this replaced).
check('the trust strip links every signal and types no number by hand', () => {
    const strip = hub.match(/<ul class="home-trust"[\s\S]*?<\/ul>/)[0];
    const items = strip.match(/<li>[\s\S]*?<\/li>/g);
    assert.ok(items.length >= 3, 'the strip has ' + items.length + ' items');
    for (const li of items) assert.ok(/<a href="[^"]+">/.test(li), 'an item links nowhere: ' + text(li));
    assert.ok(!/\d/.test(text(strip)), 'the strip types a number: ' + text(strip).replace(/\s+/g, ' '));
    assert.ok(hub.includes("/messaging-platform/api/v1/messaging-service/health"), 'the strip does not check the API');
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
