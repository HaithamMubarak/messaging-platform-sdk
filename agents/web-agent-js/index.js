/**
 * Package entry point.
 *
 * Two things had to be true for `require('@messaging-platform/web-agent-js')`
 * to work, and neither was:
 *
 * 1. js/web-agent.js refers to CryptoJS as a bare global. In a browser that is
 *    supplied by web-agent.libs.js from its own script tag; under require()
 *    nothing loads it, so the first call that touched encryption — most of the
 *    API — failed with "CryptoJS is not defined".
 *
 * 2. web-agent.libs.js bundles more than CryptoJS: it also carries the RSA
 *    implementation, which reads `navigator` at load time and seeds its entropy
 *    pool from window.crypto plus mousemove events. Loading it in Node threw
 *    "navigator is not defined" before any of our code ran.
 *
 * So this file establishes the small browser surface those bundled libraries
 * expect, then loads them. The entropy path is wired to Node's real webcrypto
 * rather than being stubbed out — a fake random source in a crypto library is
 * far worse than a missing one. Nothing is fetched at runtime; the libraries
 * ship inside this package.
 *
 * In a browser this file is unnecessary — keep using the script tags — and it
 * is careful to leave a real `window` alone if one exists.
 */
'use strict';

const globalScope =
    typeof globalThis !== 'undefined' ? globalThis :
    typeof global !== 'undefined' ? global :
    typeof self !== 'undefined' ? self : this;

// Only shim when there is no real browser here.
if (typeof globalScope.window === 'undefined') {
    // The RSA code branches on appName; "Netscape" selects its portable path.
    if (typeof globalScope.navigator === 'undefined') {
        globalScope.navigator = { appName: 'Netscape', userAgent: 'node' };
    }
    // getRandomValues must be genuine. Node 20 has webcrypto on globalThis; on
    // older runtimes fall back to the crypto module, never to Math.random().
    let webcrypto = globalScope.crypto;
    if (!webcrypto || typeof webcrypto.getRandomValues !== 'function') {
        webcrypto = require('crypto').webcrypto;
        globalScope.crypto = webcrypto;
    }
    globalScope.window = globalScope;
    // The library registers a mousemove listener to gather extra entropy. There
    // is no pointer here; the webcrypto source above is what actually seeds it.
    if (typeof globalScope.addEventListener !== 'function') {
        globalScope.addEventListener = function () {};
        globalScope.removeEventListener = function () {};
    }
    // A bundled transport reads location.protocol/hostname to decide whether to
    // use a secure socket scheme. Off-browser there is no page origin, so it is
    // told it is not on a secure origin and callers pass absolute URLs instead.
    // The SDK talks to the service through XMLHttpRequest, which Node has no
    // notion of — so the package could be imported but not actually used.
    if (typeof globalScope.XMLHttpRequest === 'undefined') {
        globalScope.XMLHttpRequest = require('./node-xhr.js');
    }
    if (typeof globalScope.location === 'undefined') {
        globalScope.location = { protocol: 'http:', hostname: 'localhost', host: 'localhost', href: 'http://localhost/' };
    }
    if (typeof globalScope.document === 'undefined') {
        globalScope.document = { addEventListener: function () {}, removeEventListener: function () {} };
    }
}

if (typeof globalScope.CryptoJS === 'undefined') {
    // Evaluate the bundle the way a browser does, not the way require() does.
    //
    // web-agent.libs.js is several UMD modules concatenated — CryptoJS core,
    // its HMAC and SHA extensions, and JSEncrypt. Each one begins with the
    // usual "if exports exists, module.exports = ..." dance, so under require()
    // every module overwrites the previous one's exports and only the last
    // survives: CryptoJS.HmacSHA256 was simply missing, and the SDK threw on
    // its first hash. Running the source with module/exports/define out of
    // scope takes the browser branch instead, where every module attaches to
    // one shared global, which is what the extensions expect.
    var fs = require('fs');
    var libsSource = fs.readFileSync(require.resolve('./js/web-agent.libs.js'), 'utf8');
    // `require` stays available: one of the bundled libraries (js-md5) detects
    // Node deliberately and uses the built-in crypto module for its digest,
    // which is faster and no less correct than its own implementation.
    var asBrowserScript = new Function('module', 'exports', 'define', 'require', libsSource);
    asBrowserScript.call(globalScope, undefined, undefined, undefined, require);
}

module.exports = require('./js/web-agent.js');
