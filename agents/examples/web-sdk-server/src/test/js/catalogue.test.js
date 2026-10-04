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
// The private apps repo, when a checkout sits beside this one (the public build has none).
const APPS_DIR = process.env.SIBLING_APPS_DIR
    || path.join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'messaging-platform-apps');

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

/*
 * The products are not in catalogue.json since 2026-10-05 (plan P1): apps-service publishes
 * products.json, written from each app's app.json, and js/catalogue.js merges it. When the
 * services checkout sits beside this one its ids count as live; the public build has none.
 */
const PRODUCTS_JSON = path.join(APPS_DIR, '..', 'messaging-platform-services', 'docker', 'apps-service', 'products.json');
const productIds = fs.existsSync(PRODUCTS_JSON) ? JSON.parse(fs.readFileSync(PRODUCTS_JSON, 'utf8')).products.map((p) => p.id) : null;
const liveId = (id) => live.some((l) => l.id === id) || (productIds ? productIds.includes(id) : true);

console.log('catalogue');

// Plan P4 (2026-10-05): the Demos page's Source buttons open GitHub at cat.github + source[0].
// The base must be this repo (the shell's GitHub link), its develop branch (what production
// runs), and the static folder these source paths are relative to, or every link 404s.
check('the Source links open this repo on GitHub, at the files the catalogue names', () => {
    const repo = require('../../../tools/site-shell.cjs').footer().match(/href="(https:\/\/github\.com\/[^"/]+\/[^"/]+)"/)[1];
    assert.strictEqual(cat.github, repo + '/blob/develop/agents/examples/web-sdk-server/src/main/resources/static/');
    const rel = path.relative(path.join(__dirname, '..', '..', '..', '..', '..', '..'), STATIC).split(path.sep).join('/');
    assert.ok(cat.github.endsWith('/blob/develop/' + rel + '/'), 'the GitHub path is not where static/ lives in this repo: ' + rel);
});

check('catalogue.json describes no product: they come from the apps catalogue', () => {
    assert.deepStrictEqual(cat.entries.filter((e) => e.shelf === 'products').map((e) => e.id), []);
});

check('every product the hub features is one the apps catalogue publishes', () => {
    if (!productIds) { console.log('    (skipped: no services checkout beside this one)'); return; }
    assert.deepStrictEqual((cat.built || []).filter((id) => !productIds.includes(id)), []);
});

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

// Landing redesign L4 (2026-10-04): each Demos card shows the SDK call it teaches. A call on a
// card that the demo never makes would teach the wrong thing, so its method must be called in
// the entry's own source; and "Start with these three" may only name demos on the Learn shelf.
check('every Learn card shows a call its own source makes', () => {
    const bad = live.filter((e) => e.shelf === 'learn').filter((e) => {
        const method = ((e.call || '').match(/(\w+)\s*\(/) || [])[1];
        return !method || !new RegExp('\\b' + method + '\\s*\\(').test(e.source.map(read).join('\n'));
    }).map((e) => e.id + ': ' + (e.call || 'no call'));
    assert.deepStrictEqual(bad, []);
});

check('"Start with these three" names three Learn demos', () => {
    const learn = live.filter((e) => e.shelf === 'learn').map((e) => e.id);
    assert.strictEqual((cat.start || []).length, 3);
    assert.deepStrictEqual(cat.start.map((s) => s.id).filter((id) => !learn.includes(id)), []);
});

// A "Product: X" link goes to an app the apps repo publishes (checked when it is beside us).
check('every "Product:" link names a published app', () => {
    const apps = path.join(APPS_DIR, 'apps');
    if (!fs.existsSync(apps)) return;
    const bad = live.filter((e) => e.product).filter((e) => {
        const m = e.product.url.match(/^\/messaging-platform\/apps\/([a-z0-9-]+)\/$/);
        return !m || !fs.existsSync(path.join(apps, m[1], 'index.html'));
    }).map((e) => e.id + ': ' + e.product.url);
    assert.deepStrictEqual(bad, []);
});

check('a moved entry says where it went, and that place is a live entry', () => {
    const bad = cat.entries.filter((e) => e.status === 'moved')
        .filter((e) => !e.note || (e.movedTo && !liveId(e.movedTo)));
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
// Landing redesign L2 (2026-10-04): the cards became six primitive tabs, each with one "Open the
// ... demo" button. The promise moves with them: every primitive opens a live demo.
check('every hub primitive tab opens a live demo', () => {
    const live = new Set(cat.entries.filter((e) => e.status !== 'moved').map((e) => folderOf(e.url)).filter(Boolean));
    const panels = read('hub.html').split('class="home-tab" role="tabpanel"').slice(1);
    const cards = panels.map((p) => (p.match(/<a class="mp-btn mp-btn--primary" href="([^"]+)"/) || [])[1]).filter(Boolean);
    assert.ok(cards.length >= 6, 'found only ' + cards.length + ' primitive tabs with a demo');
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

/*
 * The hub and the Games page state counts the SDK cannot see: products (the apps catalogue's
 * cards, rendered from app.json) and Party Arcade's games (its catalog.ts). Plan 4.8: counts
 * come from data. They are written as text and checked here against that data when the
 * sibling checkouts are present, the way verify-catalogue checks the catalogue's own prose.
 */
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const SERVICES_INDEX = path.join(APPS_DIR, '..', 'messaging-platform-services', 'docker', 'apps-service', 'index.html');
const PA_CATALOG = path.join(APPS_DIR, 'apps', 'party-arcade', 'src', 'shared', 'catalog.ts');

function claims(page, noun) {
    const text = read(page).replace(/<[^>]+>/g, ' ');
    return [...text.matchAll(new RegExp('\\b(\\d+|' + Object.keys(WORDS).join('|') + ')\\s+' + noun, 'gi'))]
        .map((m) => [m[0], /^\d/.test(m[1]) ? +m[1] : WORDS[m[1].toLowerCase()]]);
}

check('the hub and Games page count products and games from the data', () => {
    if (!fs.existsSync(SERVICES_INDEX) || !fs.existsSync(PA_CATALOG)) { console.log('    (skipped: no apps/services checkout beside this one)'); return; }
    const products = (fs.readFileSync(SERVICES_INDEX, 'utf8').match(/data-card="/g) || []).length;
    const games = (fs.readFileSync(PA_CATALOG, 'utf8').match(/\{\s*id:\s*'[^']+'/g) || []).length;
    const bad = [];
    for (const [said, n] of claims('hub.html', 'products')) if (n !== products) bad.push(`hub.html says "${said}", the catalogue has ${products}`);
    for (const page of ['hub.html', 'games.html']) {
        for (const [said, n] of claims(page, 'games')) if (n !== games) bad.push(`${page} says "${said}", Party Arcade has ${games}`);
    }
    assert.deepStrictEqual(bad, []);
});

check('the Demos page counts its demos and templates from the data', () => {
    const shelf = (name) => live.filter((e) => e.shelf === name).length;
    const bad = [];
    for (const [noun, n] of [['demos', shelf('learn')], ['templates', shelf('templates')]]) {
        for (const [said, k] of claims('playground.html', noun)) if (k !== n) bad.push(`playground.html says "${said}", the catalogue has ${n}`);
    }
    assert.ok(claims('playground.html', 'demos').length, 'playground.html no longer says how many demos it has');
    assert.deepStrictEqual(bad, []);
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
