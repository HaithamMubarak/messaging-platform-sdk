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
    if (typeof globalScope.location === 'undefined') {
        globalScope.location = { protocol: 'http:', hostname: 'localhost', host: 'localhost', href: 'http://localhost/' };
    }
    if (typeof globalScope.document === 'undefined') {
        globalScope.document = { addEventListener: function () {}, removeEventListener: function () {} };
    }
}

if (typeof globalScope.CryptoJS === 'undefined') {
    // The UMD header returns the library when `exports` is present.
    globalScope.CryptoJS = require('./js/web-agent.libs.js');
}

module.exports = require('./js/web-agent.js');
