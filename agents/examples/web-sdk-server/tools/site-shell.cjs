#!/usr/bin/env node
/**
 * The one site shell (hub consolidation phase 2, 2026-10-03; plan in messaging-platform-ops
 * AI/product/HUB-SITE-CONSOLIDATION-PLAN-OCT03-2026.md section 7).
 *
 * Five page shells had grown, each with its own header, footer, logo and nav. This writes ONE
 * header and ONE footer into every public page, between markers, so a page is static HTML (no
 * script needed to see the nav) and the markup still has a single source: this file.
 *
 *   node tools/site-shell.cjs                      write the SDK site's pages (PAGES below)
 *   node tools/site-shell.cjs --check              fail if any of them differs from the canonical shell
 *   node tools/site-shell.cjs [--check] --section=apps <file>...   any other page (apps catalogue,
 *                                                  app landings in the apps repo), one section for all
 *
 * Links are root-absolute (/messaging-platform/...) so the same markup works in every repo and
 * service. The styles are css/site-shell.css; the phone menu is js/site-shell.js (or landing.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STATIC = path.join(__dirname, '..', 'src', 'main', 'resources', 'static');
const HUB = '/messaging-platform/hub/';
const GITHUB = 'https://github.com/HaithamMubarak/messaging-platform-sdk';

/** Top nav: section id, label, href. */
const NAV = [
    ['product', 'Product', HUB],
    ['demos', 'Demos', HUB + 'playground.html'],
    ['apps', 'Apps', '/messaging-platform/apps/'],
    ['games', 'Games', HUB + 'games.html'],
    ['docs', 'Docs', HUB + 'docs.html'],
    ['pricing', 'Pricing', HUB + 'pricing.html'],
];

const FOOTER = [
    ['Product', [['Overview', HUB], ['Pricing', HUB + 'pricing.html'], ['Quickstart', HUB + 'quickstart.html'],
        ['Status', '/messaging-platform/apps/status/']]],
    ['Developers', [['Documentation', HUB + 'docs.html'], ['SDK guide', HUB + 'sdk-guide.html'],
        ['Developer portal', HUB + 'developer/index.html'], ['GitHub', GITHUB]]],
    ['Explore', [['Demos', HUB + 'playground.html'], ['Apps', '/messaging-platform/apps/'],
        ['Games', HUB + 'games.html'], ['Proof', '/messaging-platform/apps/proof/']]],   // Games reaches Party Arcade (plan 3.3)
    ['Legal', [['Privacy', HUB + 'privacy.html'], ['Terms', HUB + 'terms.html'], ['Support', GITHUB + '/issues']]],
];

/** The SDK site's shell pages and the nav section each belongs to ('' = none lit). The error pages are
 *  not here: they are self-contained on purpose (rendered at any depth, under any prefix; see error/404.html). */
const PAGES = {
    'hub.html': 'product', 'games.html': 'games', 'playground.html': 'demos', 'docs.html': 'docs', 'sdk-guide.html': 'docs', 'quickstart.html': 'docs',
    'pricing.html': 'pricing', 'privacy.html': '', 'terms.html': '',
    'profile.html': '',
    'apps/evidence-chain/index.html': 'demos', 'apps/terminal/index.html': 'demos',
    'apps/under-the-hood/index.html': 'demos', 'apps/whiteboard/index.html': 'demos',
};

const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="6" fill="#14b8a6"/>'
    + '<path d="M6 9.5A2.5 2.5 0 0 1 8.5 7h7A2.5 2.5 0 0 1 18 9.5v3a2.5 2.5 0 0 1-2.5 2.5H11l-3.2 2.4A.5.5 0 0 1 7 17V15h-.5A.5.5 0 0 1 6 14.5z" fill="#fff"/>'
    + '<circle cx="9.6" cy="11" r="1" fill="#0b1120"/><circle cx="12" cy="11" r="1" fill="#0b1120"/><circle cx="14.4" cy="11" r="1" fill="#0b1120"/></svg>';
const MENU = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

const MARK = { header: ['<!-- site-shell:header (tools/site-shell.cjs; do not edit here) -->', '<!-- /site-shell:header -->'],
    footer: ['<!-- site-shell:footer (tools/site-shell.cjs; do not edit here) -->', '<!-- /site-shell:footer -->'] };

function header(section) {
    const links = NAV.map(([id, label, href]) =>
        `<a href="${href}"${id === section ? ' aria-current="page"' : ''}>${label}</a>`).join('\n            ');
    return `${MARK.header[0]}
<header class="site-header" id="siteHeader">
    <div class="site-header__inner">
        <a class="brand" href="${HUB}">${LOGO}<span>Messaging Platform</span></a>
        <button class="nav-toggle" id="navToggle" type="button" aria-expanded="false" aria-controls="siteNav" aria-label="Open menu">${MENU}</button>
        <nav class="site-nav" id="siteNav" aria-label="Main">
            ${links}
            <a class="site-nav__cta btn--gradient" href="${HUB}developer/index.html?start=free">Start free</a>
        </nav>
    </div>
</header>
${MARK.header[1]}`;
}

function footer() {
    const cols = FOOTER.map(([title, links]) => `<div><h2>${title}</h2><ul>${links.map(([label, href]) =>
        `<li><a href="${href}">${label}</a></li>`).join('')}</ul></div>`).join('\n            ');
    return `${MARK.footer[0]}
<footer class="site-shell-footer">
    <div class="site-shell-footer__inner">
        <div class="site-shell-footer__cols">
            <div class="site-shell-footer__about"><a class="brand" href="${HUB}">${LOGO}<span>Messaging Platform</span></a>
                <p>Realtime infrastructure for developers: messaging, presence, shared state and WebRTC through one SDK.</p></div>
            ${cols}
        </div>
        <div class="site-shell-footer__legal"><span>&copy; 2026 Messaging Platform</span>
            <span>Public beta: APIs may still change, and there is no uptime guarantee yet.</span></div>
    </div>
</footer>
${MARK.footer[1]}`;
}

/** Replace a marked block, or (first run) the page's own header/footer, or insert where it belongs. */
function placeBlock(html, kind, block) {
    const [open, close] = MARK[kind];
    const i = html.indexOf(open.slice(0, 22));
    if (i >= 0) {
        const j = html.indexOf(close, i);
        if (j < 0) throw new Error(`unterminated ${kind} block`);
        return html.slice(0, i) + block + html.slice(j + close.length);
    }
    if (kind === 'header') {
        const m = html.match(/<header class="(?:site-header|mp-top)[^"]*"[\s\S]*?<\/header>/);
        if (m) return html.replace(m[0], () => block);
        return html.replace(/(<body[^>]*>)/, (b) => `${b}\n${block}`);
    }
    const all = [...html.matchAll(/<footer\b[\s\S]*?<\/footer>/g)];
    if (all.length) { const last = all[all.length - 1]; return html.slice(0, last.index) + block + html.slice(last.index + last[0].length); }
    if (html.includes('</main>')) return html.replace('</main>', () => `</main>\n${block}`);
    return html.replace('</body>', () => `${block}\n</body>`);
}

/** The font preload and the stylesheet everywhere; the menu script and the account chip where the page does not bring its own. */
function placeAssets(html) {
    const add = (needle, tag, before) => (html.includes(needle) ? html : html.replace(before, () => `${tag}\n${before}`));
    // Manrope (Latin) is fetched with the page, not found three stylesheets later: fonts.css
    // uses font-display: optional, so a face that misses first paint is not swapped in.
    html = add('manrope-latin-wght-normal.woff2', `<link rel="preload" href="${HUB}fonts/manrope-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>`, '</head>');
    html = add('css/site-shell.css', `<link rel="stylesheet" href="${HUB}css/site-shell.css">`, '</head>');
    if (!/js\/landing\.js/.test(html)) html = add('js/site-shell.js', `<script src="${HUB}js/site-shell.js" defer></script>`, '</body>');
    html = add('mp-account.js', `<script src="${HUB}js/mp-account.js" defer></script>`, '</body>');
    return add('profile-chip.js', `<script src="${HUB}js/profile-chip.js" defer></script>`, '</body>');
}

function apply(html, section) {
    return placeAssets(placeBlock(placeBlock(html, 'header', header(section)), 'footer', footer()));
}

function run(files, check) {
    let bad = 0;
    for (const [file, section] of files) {
        const raw = fs.readFileSync(file, 'utf8');
        const crlf = raw.includes('\r\n');
        const lf = raw.replace(/\r\n/g, '\n');
        const out = apply(lf, section);
        if (out === lf) continue;
        if (check) { bad++; console.log(`  differs from the shell: ${file}`); continue; }
        fs.writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out);
        console.log(`  wrote ${path.relative(process.cwd(), file)}`);
    }
    return bad;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const sectionArg = args.find((a) => a.startsWith('--section='));
    const extra = args.filter((a) => !a.startsWith('--'));
    const files = extra.length
        ? extra.map((f) => [path.resolve(f), sectionArg ? sectionArg.split('=')[1] : ''])
        : Object.entries(PAGES).map(([rel, s]) => [path.join(STATIC, rel), s]);
    const bad = run(files, check);
    if (check) console.log(bad ? `${bad} page(s) out of date: run node tools/site-shell.cjs` : `all ${files.length} pages wear the shell`);
    process.exitCode = bad ? 1 : 0;
}

module.exports = { apply, header, footer, PAGES, NAV, STATIC };
