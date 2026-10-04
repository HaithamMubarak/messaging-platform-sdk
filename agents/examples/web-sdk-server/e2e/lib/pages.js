/**
 * Every page the site serves, found on disk.
 *
 * The sweeps used to carry six hand-typed copies of this list. When hub phase 4
 * deleted eleven demos, those copies went on asking for the dead pages, and the
 * new ones (Call, Gavel, the hub's own pages) were never swept. A list written
 * by hand covers what somebody remembered; this one covers what is published.
 */
const fs = require('fs');
const path = require('path');

const STATIC = path.join(__dirname, '..', '..', 'src', 'main', 'resources', 'static');

/**
 * Not pages a visitor reaches under the SDK prefix: build output, a developer's
 * icon tool, and profile.html, which is published at /messaging-platform/
 * profile.html. Its relative `sdk/` links only resolve there; loaded from
 * /sdk/ it is unstyled, which is a routing question, not this page's.
 */
const NEVER = [/^generated-web-agent-js\//, /^apps\/terminal\/icons\//, /^profile\.html$/];

function walk(dir, rel, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? rel + '/' + entry.name : entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), r, out);
        else if (entry.name.endsWith('.html')) out.push(r);
    }
    return out;
}

/**
 * Site-relative paths of every published page, sorted.
 * `skip` takes more patterns, each with the reason in the caller.
 */
function discoverPages(skip = []) {
    const rules = NEVER.concat(skip);
    return walk(STATIC, '', []).filter((p) => !rules.some((re) => re.test(p))).sort();
}

module.exports = { discoverPages, STATIC };
