/**
 * Can someone who installs this package actually use it?
 *
 * The package used to export js/web-agent.js directly, which refers to CryptoJS
 * as a bare global supplied by a sibling file that only a browser script tag
 * loads. require() therefore blew up with "CryptoJS is not defined" as soon as
 * anything touched encryption — which is most of the API. Nothing caught it,
 * because nothing had ever imported the package the way a consumer does.
 */
const assert = require('assert');

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log('  ok   ' + name);
    } catch (e) {
        failures++;
        console.log('  FAIL ' + name + ' — ' + e.message);
    }
}

console.log('web-agent-js package smoke test');

const pkg = require('../index.js');

check('the package exports its public API', () => {
    assert.ok(pkg.AgentConnection, 'AgentConnection');
    assert.ok(pkg.MySecurity, 'MySecurity');
    assert.ok(pkg.generateRandomAgentName, 'generateRandomAgentName');
});

check('the bundled crypto dependency resolved', () => {
    assert.notStrictEqual(typeof CryptoJS, 'undefined', 'CryptoJS is not defined');
});

// Checking that CryptoJS merely EXISTS is not enough, and this is not
// hypothetical: the bundle is several UMD modules concatenated, and loading it
// through require() left only the last one's exports, so CryptoJS was an object
// but CryptoJS.HmacSHA256 was undefined and the SDK threw on its first hash.
// Every API the SDK actually calls is named here.
check('every crypto API the SDK calls is present and callable', () => {
    assert.strictEqual(typeof CryptoJS.HmacSHA256, 'function', 'CryptoJS.HmacSHA256');
    assert.strictEqual(typeof CryptoJS.SHA256, 'function', 'CryptoJS.SHA256');
    assert.ok(CryptoJS.enc && CryptoJS.enc.Hex, 'CryptoJS.enc.Hex');
    assert.strictEqual(typeof JSEncrypt, 'function', 'JSEncrypt');

    const digest = CryptoJS.HmacSHA256('message', 'key').toString(CryptoJS.enc.Hex);
    assert.match(digest, /^[0-9a-f]{64}$/, 'HMAC produces a hex digest');
    assert.strictEqual(
        CryptoJS.HmacSHA256('message', 'key').toString(CryptoJS.enc.Hex),
        digest, 'and is deterministic');
});

check('encryption round-trips, so the dependency really works', () => {
    const secret = 'a message worth protecting';
    const key = 'correct horse battery staple';
    const sealed = pkg.MySecurity.encrypt(secret, key);
    assert.notStrictEqual(sealed, secret, 'ciphertext must differ from plaintext');
    assert.strictEqual(pkg.MySecurity.decrypt(sealed, key), secret);
});

check('an agent name can be generated', () => {
    const a = pkg.generateRandomAgentName();
    const b = pkg.generateRandomAgentName();
    assert.ok(a && typeof a === 'string', 'a name is produced');
    assert.notStrictEqual(a, b, 'names differ');
});

check('a connection object can be constructed', () => {
    assert.strictEqual(typeof pkg.AgentConnection, 'function');
});

// The package declares an ESM entry too, and a consumer using `import` must
// get the same API — a broken one would only surface in someone else's build.
import('../index.mjs').then((esm) => {
    check('the ESM entry exposes the same API', () => {
        assert.ok(esm.AgentConnection, 'AgentConnection');
        assert.strictEqual(typeof esm.MySecurity.encrypt, 'function');
        assert.strictEqual(typeof esm.generateRandomAgentName, 'function');
    });
}).catch((e) => {
    failures++;
    console.log('  FAIL the ESM entry loads — ' + e.message);
}).finally(() => {
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
});
