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

    function base() {
        var host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:8094/api';
        return '/messaging-platform/rooms-api/api';
    }

    function token() { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } }
    function setToken(t) {
        try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) {}
        try { sessionStorage.removeItem(CACHE); } catch (e) {}
        _exportKey = null;   // a key outliving its session is a key left lying about
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
                if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
                return data;
            });
        });
    }

    function cacheMe(user) {
        try {
            if (user) sessionStorage.setItem(CACHE, JSON.stringify(user));
            else sessionStorage.removeItem(CACHE);
        } catch (e) {}
    }

    function cachedMe() {
        try {
            var raw = sessionStorage.getItem(CACHE);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    var Account = {
        signedIn: function () { return !!token(); },
        token: token,

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
            }).catch(function () {
                // An expired or revoked token should sign the person out
                // rather than leave every later call failing on its own.
                setToken(null);
                return null;
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
         * returnTo must be a RELATIVE path. The service only honours a
         * returnTo beginning with "/" and otherwise falls back to the Rooms
         * app -- which is open-redirect protection worth keeping, so this
         * sends a path rather than asking the server to accept absolute URLs.
         * Passing window.location.href is what sent everyone to Rooms after
         * signing in from anywhere else.
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
            var path = returnTo || (window.location.pathname + window.location.search);
            if (path.charAt(0) !== '/') path = '/' + path;
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

        /** Adopt a session minted elsewhere (the Google callback). */
        adoptToken: function (t) { setToken(t); },

        /** Stable id for keying this account's saved list. */
        idOf: function (user) {
            return (user && (user.id || user.email)) ? String(user.id || user.email) : null;
        }
    };

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
