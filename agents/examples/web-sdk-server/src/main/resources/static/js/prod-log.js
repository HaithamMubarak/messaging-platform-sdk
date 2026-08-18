/**
 * Production log gate.
 *
 * Silences the noisy console.log / console.debug calls that the demos and games
 * emit, so the browser console is clean in production. Warnings and errors are
 * always preserved. Enable verbose logging on demand with either:
 *   - a `?debug` (or `&debug`) query parameter, or
 *   - localStorage.setItem('debug', '1')
 *
 * Include this as the FIRST script on a page so it gates everything loaded after.
 */
(function () {
    try {
        var verbose = /[?&]debug\b/.test(location.search);
        try { verbose = verbose || localStorage.getItem('debug') === '1'; } catch (e) { /* storage blocked */ }
        if (verbose) {
            if (console.info) console.info('[prod-log] verbose logging enabled');
            return;
        }
        var noop = function () {};
        ['log', 'debug'].forEach(function (method) {
            if (typeof console[method] === 'function') console[method] = noop;
        });
    } catch (e) {
        /* never let logging setup break the page */
    }
})();
