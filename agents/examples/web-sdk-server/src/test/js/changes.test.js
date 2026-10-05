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

check('untagged, the page stays out of search; once a release exists it is indexable and linked', () => {
    const hidden = /<meta name="robots" content="noindex">/.test(page);
    if (!tags.length) { assert.ok(hidden, 'no release yet, so the page must be noindex'); return; }
    assert.ok(!hidden, 'there are releases, so the page must not be noindex');
    assert.ok(require('../../../tools/site-shell.cjs').footer().includes('changes.html'), 'the shell footer does not link it');
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
