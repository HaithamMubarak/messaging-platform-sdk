/**
 * Who you are, platform-wide.
 *
 * rooms-service already owns identity — register, login, /me, logout, Google
 * OAuth — and the Rooms app already keeps its bearer in localStorage under
 * `rooms.token`. This is deliberately a thin client over the SAME endpoints
 * and the SAME token key rather than a second account system: signing in on
 * the SDK site signs you in for Rooms, and vice versa, because there is only
 * one token and one origin.
 *
 * An account is never required to use anything here. It gates saving a
 * channel, and nothing else — connecting to a room stays one click for a
 * visitor who has never signed in.
 */
(function (window) {
    'use strict';

    var KEY = 'rooms.token';
    var CACHE = 'mp.me.v1';   // sessionStorage: 20 landing pages should not each hit /me
    var RESUME = 'mp.resumeHash';  // an invite hash held across the OAuth round trip
    var _exportKey = null;         // memory only, for this page's lifetime
    var listeners = [];

    function base() {
        var host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:8094/api';
        return '/messaging-platform/rooms-api/api';
    }

    // OAuth state must carry an on-site path, never a complete URL.  Some
    // callers quite reasonably pass window.location.href, so make that safe
    // here instead of relying on every caller to remember the distinction.
    function localReturnPath(returnTo) {
        var fallback = window.location.pathname + window.location.search;
        var path = returnTo || fallback;
        if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
            try {
                var url = new URL(path);
                var host = window.location.host || window.location.hostname;
                if (!/^https?:$/.test(url.protocol) || url.host !== host) return fallback;
                return url.pathname + url.search;
            } catch (e) {
                return fallback;
            }
        }
        // These are network-path references in a browser, not local paths.
        if (path.indexOf('//') === 0 || path.indexOf('/\\') === 0) return fallback;
        return path.charAt(0) === '/' ? path : '/' + path;
    }

    function token() { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } }
    // This is not a password hash or an authentication mechanism.  It is a
    // small, non-secret fingerprint used only to prove that the cached /me
    // answer belongs to the token currently in localStorage.  Rooms shares
    // that token but has its own account module, so an unbound cache could
    // otherwise make account B operate on account A's browser-local keyring.
    function tokenStamp(t) {
        var a = 2166136261, b = 0x9e3779b9, text = String(t || '');
        for (var i = 0; i < text.length; i++) {
            a = Math.imul(a ^ text.charCodeAt(i), 16777619);
            b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
        }
        return (a >>> 0).toString(36) + '-' + (b >>> 0).toString(36);
    }

    function notify() {
        listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
        try { window.dispatchEvent(new CustomEvent('mp-account-token-changed')); } catch (e2) {}
    }

    function setToken(t) {
        try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) {}
        try { sessionStorage.removeItem(CACHE); } catch (e) {}
        _exportKey = null;   // a key outliving its session is a key left lying about
        notify();
    }

    function call(path, opts) {
        opts = opts || {};
        var headers = { 'Content-Type': 'application/json' };
        var t = token();
        if (t) headers.Authorization = 'Bearer ' + t;
        return fetch(base() + path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                // The service sends a sentence written for a person. Showing
                // "Request failed (400)" instead throws that away.
                if (!r.ok) {
                    var err = new Error(data.error || ('Request failed (' + r.status + ')'));
                    // A caller has to be able to tell a REJECTED session from a
                    // service that is merely unwell; without this the only
                    // signal is a message written for a human to read.
                    err.status = r.status;
                    throw err;
                }
                return data;
            });
        });
    }

    /* The cache exists so twenty landing pages do not each hit /me. It is
     * deliberately short-lived: with no expiry at all, a session revoked in
     * another tab -- or on another machine -- kept rendering as signed in for
     * as long as this tab stayed open, because nothing ever asked again. */
    var CACHE_TTL_MS = 5 * 60 * 1000;

    function cacheMe(user) {
        try {
            if (user) sessionStorage.setItem(CACHE, JSON.stringify({
                at: Date.now(), stamp: tokenStamp(token()), u: user
            }));
            else sessionStorage.removeItem(CACHE);
        } catch (e) {}
    }

    function cachedMe() {
        try {
            var raw = sessionStorage.getItem(CACHE);
            if (!raw) return null;
            var v = JSON.parse(raw);
            // An entry written by an older build carries no timestamp; treat
            // it as stale rather than trusting it for the life of the tab.
            if (!v || typeof v.at !== 'number' || !v.u || v.stamp !== tokenStamp(token())) return null;
            if (Date.now() - v.at > CACHE_TTL_MS) return null;
            return v.u;
        } catch (e) { return null; }
    }

    var Account = {
        signedIn: function () { return !!token(); },
        token: token,

        /** Re-render callers when another same-origin app changes the session. */
        onChange: function (fn) {
            if (typeof fn !== 'function') return function () {};
            listeners.push(fn);
            return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
        },

        /**
         * The signed-in user, or null. Cached for the session so twenty pages
         * with a nav chip do not each ask.
         * @param {boolean} [fresh] skip the cache
         */
        me: function (fresh) {
            if (!token()) { cacheMe(null); return Promise.resolve(null); }
            if (!fresh) {
                var c = cachedMe();
                if (c) return Promise.resolve(c);
            }
            return call('/auth/me').then(function (u) {
                cacheMe(u); return u;
            }).catch(function (e) {
                // An expired or revoked token should sign the person out
                // rather than leave every later call failing on its own.
                //
                // ONLY those. This used to discard the token on any failure at
                // all, so one dropped request, one 502, one moment of flaky
                // wifi logged somebody out permanently -- there is no refresh
                // token here, so the session is simply gone and they have to
                // sign in again. A transient failure must leave it alone.
                if (e && (e.status === 401 || e.status === 403)) {
                    setToken(null);
                    return null;
                }
                // Still signed in as far as we know: report what we last knew
                // rather than flickering the whole site to signed-out.
                return cachedMe();
            });
        },

        login: function (email, password) {
            return call('/auth/login', { method: 'POST', body: { email: email, password: password } })
                .then(function (d) { setToken(d.token); cacheMe(d.user); return d.user; });
        },

        register: function (email, displayName, password) {
            return call('/auth/register', {
                method: 'POST', body: { email: email, displayName: displayName, password: password }
            }).then(function (d) { setToken(d.token); cacheMe(d.user); return d.user; });
        },

        logout: function () {
            var t = token();
            setToken(null);
            if (!t) return Promise.resolve();
            return fetch(base() + '/auth/logout', {
                method: 'POST', headers: { Authorization: 'Bearer ' + t }
            }).catch(function () {});
        },

        /**
         * Ask for a password-reset link.
         *
         * The caller shows the same message whether or not the address is
         * known -- a form that answers differently is a way to ask which
         * emails have accounts here.
         */
        forgot: function (email) {
            return call('/auth/forgot', { method: 'POST', body: { email: email } });
        },

        /** Is Google sign-in configured on this deployment? */
        googleAvailable: function () {
            return fetch(base() + '/auth/google/status')
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) { return !!(d && (d.enabled || d.configured)); })
                .catch(function () { return false; });
        },

        /**
         * Where to send the browser to start Google sign-in.
         *
         * The service accepts only a same-origin path.  This also accepts a
         * same-origin absolute URL for older callers, then reduces it to its
         * path and query before it leaves the page.  A foreign or malformed
         * URL falls back to the page currently being viewed.
         *
         * The fragment is deliberately NOT part of returnTo: the service
         * appends #googleToken to the target, and a target that already had a
         * fragment would produce two. An invite hash is stashed here and put
         * back by adoptFragment() on the way in, so following an invite and
         * signing in on the way does not lose the room.
         */
        googleStartUrl: function (returnTo) {
            try {
                if (window.location.hash) sessionStorage.setItem(RESUME, window.location.hash);
            } catch (e) {}
            var path = localReturnPath(returnTo);
            return base() + '/auth/google/start?returnTo=' + encodeURIComponent(path);
        },

        /**
         * This account's backup key, minted by the service on first ask.
         *
         * Held in memory for the page's lifetime and persisted nowhere. Not
         * because the key outranks the channel passwords already sitting in
         * localStorage -- that would be theatre -- but because a signed-in
         * client is always one request away from it, so caching buys nothing
         * and leaves one more thing lying about.
         */
        exportKey: function () {
            if (!token()) return Promise.resolve(null);
            if (_exportKey) return Promise.resolve(_exportKey);
            return call('/export-key').then(function (d) {
                _exportKey = d && d.key ? d.key : null;
                return _exportKey;
            });
        },

        /** Destroy it. Every existing backup becomes unreadable, by everyone. */
        destroyExportKey: function () {
            _exportKey = null;
            return call('/export-key', { method: 'DELETE' });
        },

        /**
         * A five-minute, single-use proof that the holder is this account.
         *
         * For handing to ANOTHER service that wants to record a link -- the
         * developer portal, Harmony -- so no password ever travels to a
         * service that does not own it. The proof says who you are and
         * nothing else: it cannot be used to sign in, it is spent by the
         * first service that redeems it, and it means nothing after five
         * minutes.
         *
         * Deliberately not cached. A proof that outlives the click that
         * needed it is a proof lying about.
         */
        linkAssertion: function () {
            if (!token()) return Promise.reject(new Error('Sign in first.'));
            return call('/auth/link-assertion', { method: 'POST' })
                .then(function (d) { return d && d.assertion ? d.assertion : null; });
        },

        /** Adopt a session minted elsewhere (the Google callback). */
        adoptToken: function (t) { setToken(t); },

        /** Stable id for keying this account's saved list. */
        idOf: function (user) {
            return (user && (user.id || user.email)) ? String(user.id || user.email) : null;
        }
    };

    // A different tab or the Rooms app may mutate the shared token directly.
    // `storage` never fires in the tab that performed the write; setToken()
    // covers that case and this covers every other same-origin tab.
    if (window.addEventListener) window.addEventListener('storage', function (e) {
        if (e && e.key === KEY) {
            try { sessionStorage.removeItem(CACHE); } catch (ignore) {}
            _exportKey = null;
            notify();
        }
    });

    /**
     * Take the session the Google callback handed back in the fragment.
     *
     * It arrives as #googleToken=... because a fragment never reaches a
     * server and never lands in a log. It is consumed and removed on load, so
     * a refresh or a shared URL cannot replay it -- and any invite hash held
     * before the round trip is put back in its place.
     */
    function adoptFragment() {
        var hash = window.location.hash || '';
        if (hash.indexOf('googleToken=') === -1 && hash.indexOf('googleError=') === -1) return;

        var params = {};
        hash.replace(/^#/, '').split('&').forEach(function (kv) {
            var i = kv.indexOf('=');
            if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
        });

        if (params.googleToken) Account.adoptToken(params.googleToken);
        if (params.googleError) Account.lastError = params.googleError;

        var resume = '';
        try {
            resume = sessionStorage.getItem(RESUME) || '';
            sessionStorage.removeItem(RESUME);
        } catch (e) {}
        try {
            window.history.replaceState(null, '',
                window.location.pathname + window.location.search + resume);
        } catch (e) { window.location.hash = resume; }
    }

    adoptFragment();

    window.MPAccount = Account;
})(window);
