/**
 * One catalogue, and it has to be true (static/data/catalogue.json).
 *
 * Four lists used to describe the same demos and disagreed: Air Hockey was
 * "two-player" in one and 2–6 in another, Evidence Chain -- the Attest demo --
 * claimed only "storage versions", Dead Drop never mentioned the Vault it is
 * built on. So the list is one file, both pages render it, and this fails:
 *
 *   - when an entry claims a primitive its own source never calls;
 *   - when a page, image or source file an entry names does not exist;
 *   - when an entry names a shelf, primitive or move target that is not defined;
 *   - when the Playground or the hub grows a hand-written card or list again;
 *   - when the Playground's filter chips and the defined primitives differ.
 *
 * Entries with no `source` are apps whose code lives in the apps repo; their
 * pages are served by apps-service, so only their shape is checked here.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const read = (rel) => fs.readFileSync(path.join(STATIC, rel), 'utf8');
const cat = JSON.parse(read('data/catalogue.json'));
const SDK = '/messaging-platform/sdk/';

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

/** An SDK URL maps to a file under static/; anything else is not ours to resolve. */
function sdkFile(url) {
    if (!url || !url.startsWith(SDK)) return null;
    let rel = url.slice(SDK.length).split(/[?#]/)[0];
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    return rel;
}

const live = cat.entries.filter((e) => e.status === 'live');

console.log('catalogue');

check('every live entry has the fields the pages render', () => {
    const bad = live.filter((e) => !e.id || !e.name || !e.url || !e.image || !e.blurb || !e.text
        || !['learn', 'play', 'use'].includes(e.audience) || !cat.shelves[e.shelf]);
    assert.deepStrictEqual(bad.map((e) => e.id), []);
});

check('ids are unique', () => {
    const ids = cat.entries.map((e) => e.id);
    assert.deepStrictEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

check('every claimed primitive is defined', () => {
    const bad = live.flatMap((e) => (e.primitives || []).filter((p) => !cat.primitives[p]).map((p) => e.id + ':' + p));
    assert.deepStrictEqual(bad, []);
});

check('every claim is backed by a call in the entry\'s own source', () => {
    const bad = [];
    live.filter((e) => e.source).forEach((e) => {
        const code = e.source.map(read).join('\n');
        e.primitives.forEach((p) => {
            if (!new RegExp(cat.primitives[p].evidence).test(code)) bad.push(e.id + ' claims ' + p);
        });
    });
    assert.deepStrictEqual(bad, []);
});

check('every SDK page, about page, link and image an entry names exists', () => {
    const missing = [];
    cat.entries.forEach((e) => {
        const urls = [e.url, e.about].concat((e.links || []).map((l) => l.url));
        urls.map(sdkFile).filter(Boolean).forEach((rel) => {
            if (!fs.existsSync(path.join(STATIC, rel))) missing.push(e.id + ': ' + rel);
        });
        if (e.image && !e.image.startsWith('/') && !fs.existsSync(path.join(STATIC, e.image))) missing.push(e.id + ': ' + e.image);
        (e.source || []).forEach((rel) => { if (!fs.existsSync(path.join(STATIC, rel))) missing.push(e.id + ': ' + rel); });
    });
    assert.deepStrictEqual(missing, []);
});

// Moved here from StaticSiteTest, which read the hand-written cards and would
// now check nothing: every card shows a screenshot with a real description,
// and a shelf that names a number ("Eight demos") has that many entries.
check('every live entry has a screenshot with a real description, not just a name', () => {
    const bad = live.filter((e) => !e.imageAlt || e.imageAlt.length <= 30).map((e) => e.id);
    assert.deepStrictEqual(bad, []);
});

check('a shelf that counts its entries counts them correctly', () => {
    const words = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    const bad = [];
    Object.keys(cat.shelves).forEach((name) => {
        const text = (cat.shelves[name].title + ' ' + cat.shelves[name].lead).toLowerCase();
        const n = live.filter((e) => e.shelf === name).length;
        words.forEach((w, i) => { if (new RegExp('\\b' + w + '\\b').test(text) && i + 2 !== n) bad.push(name + ' says ' + w + ', has ' + n); });
    });
    assert.deepStrictEqual(bad, []);
});

check('every highlight names a live entry', () => {
    assert.deepStrictEqual((cat.highlights || []).filter((id) => !live.some((e) => e.id === id)), []);
});

check('a moved entry says where it went, and that place is a live entry', () => {
    const bad = cat.entries.filter((e) => e.status === 'moved')
        .filter((e) => !e.note || (e.movedTo && !live.some((l) => l.id === e.movedTo)));
    assert.deepStrictEqual(bad.map((e) => e.id), []);
});

check('the Playground has no hand-written cards: it renders the catalogue', () => {
    const page = read('playground.html');
    assert.ok(!/<article[^>]*class="[^"]*\bentry\b/.test(page), 'playground.html still holds <article class="… entry">');
    assert.ok(/js\/catalogue\.js/.test(page), 'playground.html does not load js/catalogue.js');
});

check('the Playground hand-writes no filter chip but "Everything": the rest come from the primitives', () => {
    const chips = [...read('playground.html').matchAll(/data-filter="([a-z0-9]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(chips, ['all']);
    assert.ok(/cat\.primitives/.test(read('js/playground.js')), 'playground.js does not build chips from cat.primitives');
});

check('the hub has no inline demo or app list: it renders the catalogue', () => {
    const page = read('hub.html');
    assert.ok(!/const\s+(demos|apps)\s*=\s*\[/.test(page), 'hub.html still declares const demos/apps = [...]');
    assert.ok(/js\/catalogue\.js/.test(page), 'hub.html does not load js/catalogue.js');
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
