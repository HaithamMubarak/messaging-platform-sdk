#!/usr/bin/env node
/*
 * "What changed", written from this repository's release tags (plan P5, 2026-10-05).
 *
 * The apps catalogue kept hand-written release notes until the landing redesign dropped
 * them (plan Q2): nobody updated them, so they went stale the way hand-written lists do.
 * Here the record is the tags themselves. An ANNOTATED tag named release-YYYY-MM-DD is a
 * release; its message is the public note (first line the title, the rest the body). This
 * writes static/changes.html between markers, newest first. Only this repository's tags
 * are read: it is the public one, so nothing private can reach the page.
 *
 *     git tag -a release-2026-10-05 -m "Title" -m "What a visitor would notice ..."
 *     node tools/changes.cjs             write the page
 *     node tools/changes.cjs --check     exit 1 if the page differs from the tags
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PAGE = path.join(__dirname, '..', 'src', 'main', 'resources', 'static', 'changes.html');
const MARK = ['<!-- changes:begin (tools/changes.cjs; do not edit here) -->', '<!-- changes:end -->'];
const GITHUB = 'https://github.com/HaithamMubarak/messaging-platform-sdk';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Annotated release-YYYY-MM-DD tags, newest first, as { name, date, title, body }. */
function releases() {
    const SEP = '\u001e', END = '\u001f';
    const out = execFileSync('git', ['for-each-ref', 'refs/tags/release-*', '--sort=-refname',
        `--format=%(refname:short)${SEP}%(objecttype)${SEP}%(contents:subject)${SEP}%(contents:body)${END}`],
        { cwd: __dirname, encoding: 'utf8' });
    return out.split(END).map((r) => r.replace(/^\s+/, '')).filter(Boolean).map((r) => {
        const [name, type, title, body] = r.split(SEP);
        return { name, annotated: type === 'tag', date: name.slice('release-'.length), title, body: (body || '').trim() };
    }).filter((r) => r.annotated && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
}

function render(list) {
    if (!list.length) {
        return `<p class="changes-empty">Nothing has been tagged as a release yet. Until the first one, the
            <a href="${GITHUB}/commits/develop">commit history on GitHub</a> is the record.</p>`;
    }
    return '<ol class="changes">' + list.map((r) => `
            <li id="${esc(r.name)}"><time datetime="${r.date}">${r.date}</time><h2>${esc(r.title)}</h2>${r.body
                ? r.body.split(/\n\s*\n/).map((p) => `<p>${esc(p.replace(/\s*\n\s*/g, ' '))}</p>`).join('') : ''}
                <a href="${GITHUB}/releases/tag/${encodeURIComponent(r.name)}">${esc(r.name)} on GitHub</a></li>`).join('') + '\n        </ol>';
}

function apply(html, list) {
    const a = html.indexOf(MARK[0]), b = html.indexOf(MARK[1]);
    if (a < 0 || b < a) throw new Error('changes.html: markers not found');
    return html.slice(0, a + MARK[0].length) + '\n        ' + render(list) + '\n        ' + html.slice(b);
}

if (require.main === module) {
    const raw = fs.readFileSync(PAGE, 'utf8'), lf = raw.replace(/\r\n/g, '\n');
    const out = apply(lf, releases());
    if (process.argv.includes('--check')) {
        console.log(out === lf ? 'changes.html matches the release tags' : 'changes.html differs from the release tags: run node tools/changes.cjs');
        process.exitCode = out === lf ? 0 : 1;
    } else if (out !== lf) {
        fs.writeFileSync(PAGE, raw.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out);
        console.log('wrote changes.html');
    }
}

module.exports = { releases, render, apply, PAGE };
