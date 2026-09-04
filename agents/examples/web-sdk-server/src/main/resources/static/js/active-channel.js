/**
 * The channel you are in, shared across every app on this origin.
 *
 * Until now each demo passed its own `localStoragePrefix` into
 * `loadConnectionModal()` — `whiteboard_`, `rewind_`, `drop_` — so the channel
 * you chose in one app was invisible to the next, and opening a second app
 * dropped you into a freshly generated room on your own. Every surface here is
 * a path on one origin (demos under /messaging-platform/sdk/, apps under
 * /messaging-platform/apps/), so localStorage was always shared; only the
 * per-app prefix kept the channel apart.
 *
 * This module owns the shared keys so the modal and the older RoomDefaults
 * forms cannot drift apart on what "the current channel" means:
 *
 *   localStorage  mp.active.v1[.<account>] the active channel — { name, source, ts }
 *   localStorage  mp.username    display name, shared across guest apps
 *   sessionStorage mp.active.pw[.<account>] its password: a credential, so it dies with
 *                                the browser session exactly as before
 *
 * The per-app keys are still written, untouched, so this can be rolled back
 * without stranding anybody in a room they cannot name.
 *
 * ORIGIN RULE: this works *because* every surface is a path under
 * https://hmdevonline.com. Anything ever served from a subdomain gets its own
 * empty localStorage and silently loses the shared channel. New surfaces get
 * paths, not subdomains.
 */
(function (window) {
    'use strict';

    var ACTIVE = 'mp.active.v1';
    var USERNAME = 'mp.username';
    var PASSWORD = 'mp.active.pw';

    // Guests deliberately share one active room.  Signed-in people must not:
    // a browser can host two Platform accounts in one session and a room
    // password is not something the next account should inherit.
    function scoped(key, accountId) {
        return accountId ? key + '.' + encodeURIComponent(String(accountId)) : key;
    }

    function get(store, key) {
        try { return store.getItem(key) || ''; } catch (e) { return ''; }
    }

    function set(store, key, value) {
        try { store.setItem(key, value); } catch (e) { /* private mode, quota */ }
    }

    /** The active channel, or null. Never throws on a corrupt value. */
    function read(accountId) {
        var raw = get(localStorage, scoped(ACTIVE, accountId));
        if (!raw) return null;
        try {
            var v = JSON.parse(raw);
            return (v && typeof v.name === 'string' && v.name) ? v : null;
        } catch (e) {
            // A half-written or hand-edited value should cost the user a
            // regenerated room, not a modal that will not open.
            return null;
        }
    }

    /**
     * Record where the user is now.
     * @param {string} name    channel name
     * @param {string} [source] 'invite' | 'saved' | 'generated' | 'typed'
     */
    function write(name, source, accountId) {
        if (!name) return;
        set(localStorage, scoped(ACTIVE, accountId), JSON.stringify({
            name: String(name),
            source: source || 'typed',
            ts: Date.now()
        }));
    }

    function readPassword(accountId) { return get(sessionStorage, scoped(PASSWORD, accountId)); }
    function writePassword(pw, accountId) { set(sessionStorage, scoped(PASSWORD, accountId), pw || ''); }

    function readUsername() { return get(localStorage, USERNAME); }
    function writeUsername(u) { if (u) set(localStorage, USERNAME, u); }

    /**
     * First run after the update: adopt whatever room this app already had.
     *
     * localStorage carries no timestamps, so "the channel you used most
     * recently across all apps" is not a question the browser can answer. The
     * honest rule is the one a user can predict: your first app visit after
     * the update keeps the channel it already had, and the first channel you
     * connect to anywhere after that becomes the shared one.
     *
     * @param {string} prefix the app's legacy storage prefix, e.g. 'whiteboard_'
     * @returns {boolean} whether anything was adopted
     */
    function seedFromLegacy(prefix, accountId) {
        if (!prefix || read(accountId)) return false;
        var name = get(localStorage, prefix + 'channel');
        if (!name) return false;
        write(name, 'legacy', accountId);
        var pw = get(sessionStorage, prefix + 'password');
        if (pw && !readPassword(accountId)) writePassword(pw, accountId);
        return true;
    }

    /** Forget the active channel. Used by sign-out and shared-device mode. */
    function clear(accountId) {
        try {
            localStorage.removeItem(scoped(ACTIVE, accountId));
            sessionStorage.removeItem(scoped(PASSWORD, accountId));
        } catch (e) { /* ignore */ }
    }

    window.ActiveChannel = {
        read: read,
        write: write,
        readPassword: readPassword,
        writePassword: writePassword,
        readUsername: readUsername,
        writeUsername: writeUsername,
        seedFromLegacy: seedFromLegacy,
        clear: clear,
        KEYS: { active: ACTIVE, username: USERNAME, password: PASSWORD, scoped: scoped }
    };
})(window);
