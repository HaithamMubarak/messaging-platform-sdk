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

    function base() {
        var host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:8094/api';
        return '/messaging-platform/rooms-api/api';
    }

    function token() { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } }
    function setToken(t) {
        try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) {}
        try { sessionStorage.removeItem(CACHE); } catch (e) {}
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

        /** Is Google sign-in configured on this deployment? */
        googleAvailable: function () {
            return fetch(base() + '/auth/google/status')
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) { return !!(d && (d.enabled || d.configured)); })
                .catch(function () { return false; });
        },

        /** Where to send the browser to start Google sign-in. */
        googleStartUrl: function (returnTo) {
            return base() + '/auth/google/start?returnTo=' +
                encodeURIComponent(returnTo || window.location.href);
        },

        /** Stable id for keying this account's saved list. */
        idOf: function (user) {
            return (user && (user.id || user.email)) ? String(user.id || user.email) : null;
        }
    };

    window.MPAccount = Account;
})(window);
