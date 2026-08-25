#!/usr/bin/env node
/**
 * Do the Markdown docs point at files that exist?
 *
 * The docs had drifted: links to examples that were never added, and references
 * to files that moved. Nothing noticed, because nothing read the docs as data.
 * Only repo-relative links are checked — external URLs are not fetched here.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist']);

// Docs copied into the served folder at build time are checked at their source
// in the repository root; their copies resolve against a different directory,
// so checking both would demand a link that is correct in two places at once.
const GENERATED = [
    'agents/examples/web-sdk-server/src/main/resources/static/USER-GUIDE.md',
    'agents/examples/web-sdk-server/src/main/resources/static/DEVELOPER-GUIDE.md',
];

// Some docs live in the repository root but are READ from the served static
// folder, which the build copies them into. Their relative links have to be
// correct where a reader opens them, so they are resolved against that folder
// rather than against the file's own directory.
const SERVED_FROM = {
    'USER-GUIDE.md': 'agents/examples/web-sdk-server/src/main/resources/static',
    'WEB-AGENT-GUIDE.md': 'agents/examples/web-sdk-server/src/main/resources/static',
    'DEVELOPER-GUIDE.md': 'agents/examples/web-sdk-server/src/main/resources/static',
};

const docs = [];
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP.has(entry.name)) walk(full);
        } else if (entry.name.endsWith('.md')) {
            const rel = path.relative(ROOT, full).split(path.sep).join('/');
            if (!GENERATED.includes(rel)) docs.push(full);
        }
    }
})(ROOT);

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const broken = [];
let checked = 0;

/**
 * Blank out fenced and inline code so their contents are never read as links.
 * A C++ lambda `[](int){...}` in a code fence looks exactly like a Markdown
 * link to the naive regex, and reporting it as a broken link to "int" trains
 * people to ignore the check.
 */
function withoutCode(text) {
    return text
        .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/~~~[\s\S]*?~~~/g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

for (const doc of docs) {
    const text = withoutCode(fs.readFileSync(doc, 'utf8'));
    let m;
    while ((m = LINK.exec(text)) !== null) {
        const href = m[1];
        // External, anchors, and mail links are out of scope for this check.
        if (/^(https?:|mailto:|#|<)/.test(href)) continue;
        const target = href.split('#')[0];
        if (!target) continue;
        checked++;
        const relDoc = path.relative(ROOT, doc).split(path.sep).join('/');
        const servedDir = SERVED_FROM[relDoc];
        const base = servedDir ? path.join(ROOT, servedDir) : path.dirname(doc);
        const resolved = target.startsWith('/')
            ? path.join(ROOT, target)
            : path.resolve(base, target);
        if (!fs.existsSync(resolved)) {
            broken.push(`${path.relative(ROOT, doc)} -> ${href}`);
        }
    }
}

console.log(`checked ${checked} repo-relative links across ${docs.length} Markdown files`);
if (broken.length) {
    console.error(`\n${broken.length} broken link(s):`);
    broken.forEach(b => console.error('  ' + b));
    process.exit(1);
}
console.log('all resolve');
