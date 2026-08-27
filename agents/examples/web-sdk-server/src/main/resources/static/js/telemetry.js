// ============================================================================
// Session-health telemetry for the showcase demos.
//
// There are fifty-two end-to-end suites simulating failures and, until this,
// no idea which of them happen in real life. This answers one narrow question:
// how often does a session actually die — the host closing their tab, a
// reconnect never completing — and on what class of device. That number is
// meant to decide what gets built next, so it is worth exactly as much as it
// is honest.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT IN THE SDK PACKAGE
//
// It lives in the showcase, not in `@messaging-platform/web-agent-js`. Shipping
// silent phone-home inside a package other people install would be a breach of
// trust, and it would be discovered — so the published SDK stays mute and the
// site measures its own demos.
//
// ---------------------------------------------------------------------------
// WHAT IT REFUSES TO COLLECT
//
// No channel names, no agent names, no message content, no user-agent string,
// no persistent identifier. The event name comes from a closed set; the device
// is one of three words; the app is the folder the page is served from. The
// session reference is random per tab and is never written to storage, so two
// visits by the same person cannot be joined together.
//
// Opting out is honoured before anything is queued: Do Not Track, Global
// Privacy Control, or `localStorage.sdk_telemetry = 'off'`.
// ============================================================================
(function () {
    'use strict';

    var EVENTS = ['session_started', 'host_lost', 'reconnect_succeeded', 'reconnect_failed'];
    var MAX_QUEUE = 20;
    var FLUSH_MS = 5000;

    var queue = [];
    var timer = null;
    var enabled = allowed();
    var sessionRef = enabled ? rand() : null;

    function allowed() {
        try {
            // Any of the three standard refusals is a refusal.
            if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return false;
            if (navigator.globalPrivacyControl === true) return false;
            if (localStorage.getItem('sdk_telemetry') === 'off') return false;
        } catch (e) { /* storage blocked — fall through and allow */ }
        return true;
    }

    function rand() {
        var s = '';
        for (var i = 0; i < 4; i++) s += Math.random().toString(36).slice(2, 10);
        return s.slice(0, 24);
    }

    /** The folder the page is served from — 'whiteboard', 'chorus', 'index'. */
    function appId() {
        try {
            var parts = location.pathname.split('/').filter(Boolean);
            var last = parts[parts.length - 1] || '';
            if (/\.html?$/.test(last)) parts.pop();
            var name = parts[parts.length - 1] || 'index';
            return name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64) || 'index';
        } catch (e) { return 'unknown'; }
    }

    /**
     * Three buckets, from the viewport and the pointer. Deliberately not the
     * user-agent string: that is a fingerprint, and "phone or not" is the whole
     * question here.
     */
    function deviceClass() {
        try {
            var w = Math.min(screen.width || 0, screen.height || 0);
            var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
            if (!coarse) return 'desktop';
            return w >= 600 ? 'tablet' : 'phone';
        } catch (e) { return null; }
    }

    // The endpoint is told to us by whoever resolved the app config, rather
    // than guessed here: a beacon that posts somewhere the app itself is not
    // talking to is worse than one that stays silent. Until then, nothing is
    // sent — record() still queues, so an event raised before the config lands
    // is not lost.
    var API = null;
    function useBase(base) {
        if (!base || API) return;
        API = String(base).replace(/\/+$/, '') + '/telemetry';
    }

    function record(event, detail) {
        if (!enabled || EVENTS.indexOf(event) === -1) return;
        if (queue.length >= MAX_QUEUE) return;
        queue.push({
            event: event,
            app: appId(),
            device: deviceClass(),
            session: sessionRef,
            detail: detail ? String(detail).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64) : null
        });
        if (!timer) timer = setTimeout(flush, FLUSH_MS);
    }

    function flush(useBeacon) {
        clearTimeout(timer);
        timer = null;
        if (!queue.length) return;
        if (!API) return;   // no endpoint yet — hold the events, do not guess one

        var body = JSON.stringify({ events: queue.splice(0, queue.length) });
        var url = API;
        try {
            // On unload only sendBeacon survives; a fetch is cancelled with the page.
            if (useBeacon && navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
                return;
            }
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
                keepalive: true
            }).catch(function () { /* measurement must never break the page */ });
        } catch (e) { /* same */ }
    }

    if (enabled) {
        window.addEventListener('pagehide', function () { flush(true); });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') flush(true);
        });
    }

    window.SdkTelemetry = {
        record: record,
        flush: flush,
        useBase: useBase,
        enabled: function () { return enabled; },
        /** For the privacy note on the site to link to. */
        optOut: function () {
            try { localStorage.setItem('sdk_telemetry', 'off'); } catch (e) {}
            enabled = false;
            queue.length = 0;
        }
    };
})();
