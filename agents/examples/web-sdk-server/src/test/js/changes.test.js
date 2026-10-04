/**
 * "What changed" says exactly what the release tags say (plan P5, 2026-10-05).
 *
 * changes.html is written by tools/changes.cjs from this repository's annotated
 * release-YYYY-MM-DD tags. Tag a release and forget to regenerate the page, and this fails;
 * hand-edit an entry, and this fails. The tags are the record, the page their copy.
 */
const assert = require('assert');
const fs = require('fs');
const changes = require('../../../tools/changes.cjs');

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

const page = fs.readFileSync(changes.PAGE, 'utf8').replace(/\r\n/g, '\n');
const tags = changes.releases();

check('changes.html shows every release tag and nothing else (run node tools/changes.cjs)', () => {
    assert.ok(changes.apply(page, tags) === page, 'the page differs from the ' + tags.length + ' release tag(s)');
});

check('until a release is tagged, the page stays out of search', () => {
    if (!tags.length) assert.ok(/<meta name="robots" content="noindex">/.test(page));
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
