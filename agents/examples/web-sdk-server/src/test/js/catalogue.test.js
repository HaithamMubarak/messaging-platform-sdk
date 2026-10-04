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

// Moved entries are skipped: their pages were deleted in phase 4 and the gateway 301s the URLs.
check('every SDK page, about page, link and image a live entry names exists', () => {
    const missing = [];
    cat.entries.filter((e) => e.status !== 'moved').forEach((e) => {
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

/**
 * The folder a demo lives in ("apps/rewind/"), so its index and app pages count as the same demo.
 * A demo that was one file straight under apps/ ("apps/storage-demo.html") is that file: its folder
 * would be apps/ itself, and every demo would count as moved.
 */
const folderOf = (url) => {
    const rel = sdkFile(url);
    if (!rel) return null;
    return /^apps\/[^/]+\.html$/.test(rel) ? rel : rel.replace(/[^/]*$/, '');
};
const movedFolders = cat.entries.filter((e) => e.status === 'moved').map((e) => folderOf(e.url)).filter(Boolean);

// Hub consolidation, phase 1 (2026-10-03): the hand-written "What you can build" grid linked to two
// moved demos (collab-doc, rewind) for a week while every catalogue check stayed green.
check('every hub capability card that opens an SDK page opens a live demo', () => {
    const live = new Set(cat.entries.filter((e) => e.status !== 'moved').map((e) => folderOf(e.url)).filter(Boolean));
    const cards = [...read('hub.html').matchAll(/<a class="mp-card" href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(cards.length >= 6, 'found only ' + cards.length + ' capability cards');
    for (const href of cards.filter((h) => h.startsWith(SDK))) {
        assert.ok(live.has(folderOf(href)), href + ' is not a live catalogue entry');
    }
});

check('the sitemap lists no moved demo', () => {
    const map = read('sitemap.xml');
    for (const folder of movedFolders) assert.ok(!map.includes(SDK + folder), 'sitemap.xml still lists ' + folder);
});

/** Every HTML page under static/, except the moved demos' own folders and generated code. */
function livePages(dir = '') {
    return fs.readdirSync(path.join(STATIC, dir), { withFileTypes: true }).flatMap((d) => {
        const rel = dir + d.name + (d.isDirectory() ? '/' : '');
        if (movedFolders.includes(rel) || /^generated|node_modules/.test(rel)) return [];
        if (d.isDirectory()) return livePages(rel);
        return rel.endsWith('.html') ? [rel] : [];
    });
}

// Found by discovery, not a hand list (guidelines 6.25): phase 4 moved seven demos, and a list
// of six pages would have missed every demo page that still pointed at one of them.
check('no live page links to a moved demo', () => {
    const bad = [];
    for (const page of livePages()) {
        const html = read(page);
        for (const folder of movedFolders) {
            const name = folder.replace(/^apps\//, '');
            if (html.includes(SDK + folder) || html.includes('../' + name) || html.includes('"' + folder)) bad.push(page + ' -> ' + folder);
        }
    }
    assert.deepStrictEqual(bad, []);
});

/*
 * The apps link SDK demos too, and nothing here looked: Drop Pro pointed at the retired Dead
 * Drop through a redirect for a phase (landing redesign L1, 2026-10-04). The apps repo is
 * private, so the public build skips this when no checkout sits beside it.
 */
const APPS_DIR = process.env.SIBLING_APPS_DIR
    || path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'messaging-platform-apps');

function appPages(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        if (/^(vendor|node_modules|test|tests|dist|libs)$/.test(d.name)) return [];
        const full = path.join(dir, d.name);
        if (d.isDirectory()) return appPages(full);
        return d.name.endsWith('.html') ? [full] : [];
    });
}

check('no app page links to a moved demo', () => {
    const apps = path.join(APPS_DIR, 'apps');
    if (!fs.existsSync(apps)) { console.log('    (skipped: no apps checkout at ' + APPS_DIR + ')'); return; }
    const bad = [];
    for (const page of appPages(apps)) {
        const html = fs.readFileSync(page, 'utf8');
        for (const folder of movedFolders) {
            if (html.includes(SDK + folder) || html.includes('/sdk/' + folder)) bad.push(path.relative(apps, page) + ' -> ' + folder);
        }
    }
    assert.deepStrictEqual(bad, []);
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
