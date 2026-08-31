/**
 * Private-by-default room fields for the demos that build their own connect form.
 *
 * The thirteen apps that use `loadConnectionModal()` generate a random channel
 * and password per visitor. Four demos predate it and shipped literal defaults
 * in their markup instead — chat used `default`/`default`, webrtc
 * `demo-webrtc`/`demo123`, and so on. Every stranger who opened one of those
 * pages therefore landed in the *same* room and could read each other's
 * messages and screens: the exact opposite of the channel isolation the site
 * advertises, on pages linked from the landing page.
 *
 * This gives those forms the same behaviour without rewriting them: a returning
 * visitor keeps their own room, a new one gets a fresh private room, and a
 * shared invite link still wins.
 *
 * Usage — load before the app's own script:
 *   <script src="../js/room-defaults.js"></script>
 *   <script>RoomDefaults.apply({ prefix: 'chat_', channelPrefix: 'chat-' });</script>
 *
 * The password lives in sessionStorage, never localStorage: it is the
 * credential that gates the room.
 */
(function (window) {
    'use strict';

    function randomDigits(n) {
        let out = '';
        for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10);
        return out;
    }

    function randomPassword() {
        const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const bytes = new Uint32Array(12);
        (window.crypto || window.msCrypto).getRandomValues(bytes);
        let out = '';
        for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
        return out;
    }

    function read(store, key) {
        try { return store.getItem(key) || ''; } catch (e) { return ''; }
    }

    function write(store, key, value) {
        try { store.setItem(key, value); } catch (e) { /* private mode */ }
    }

    /**
     * @param {object} options
     * @param {string} options.prefix          storage prefix, e.g. 'chat_'
     * @param {string} options.channelPrefix   room-name prefix, e.g. 'chat-'
     * @param {string} [options.channelId]     id of the channel input
     * @param {string} [options.passwordId]    id of the password input
     * @param {string[]} [options.sharedDefaults] legacy values to overwrite
     */
    function apply(options) {
        const opts = options || {};
        const prefix = opts.prefix || 'demo_';
        const channelEl = document.getElementById(opts.channelId || 'channelName');
        const passwordEl = document.getElementById(opts.passwordId || 'channelPassword');
        if (!channelEl && !passwordEl) return;

        // A shared invite link owns the room; never overwrite it.
        if (window.location.hash && /[?&#](c|channel)=/.test(window.location.hash)) return;

        const legacy = opts.sharedDefaults || [];
        const isReplaceable = (el) => !el || !el.value.trim() || legacy.indexOf(el.value.trim()) !== -1;

        // The channel the visitor is already in, if any -- these older forms
        // now follow the same room as the modal apps rather than each keeping
        // a private one. Per-app values are still written, and still used when
        // there is no shared channel yet.
        const AC = window.ActiveChannel;
        if (AC) AC.seedFromLegacy(prefix);
        const active = AC ? AC.read() : null;

        if (channelEl && isReplaceable(channelEl)) {
            const saved = read(localStorage, prefix + 'channel');
            channelEl.value = (active && active.name) || saved
                || ((opts.channelPrefix || 'room-') + randomDigits(8));
            write(localStorage, prefix + 'channel', channelEl.value);
            if (AC) AC.write(channelEl.value, 'defaults');
        }

        if (passwordEl && isReplaceable(passwordEl)) {
            // Only reuse the shared password for the shared room; a password
            // carried onto a different channel opens nothing.
            const sharedPw = (AC && active && channelEl && channelEl.value === active.name)
                ? AC.readPassword() : '';
            const saved = read(sessionStorage, prefix + 'password');
            passwordEl.value = sharedPw || saved || randomPassword();
            write(sessionStorage, prefix + 'password', passwordEl.value);
            if (AC) AC.writePassword(passwordEl.value);
        }
        // A password from an older build must not linger in localStorage.
        try { localStorage.removeItem(prefix + 'password'); } catch (e) { /* ignore */ }
        try { localStorage.removeItem('lastChannelPassword'); } catch (e) { /* ignore */ }
    }

    window.RoomDefaults = { apply, randomPassword };
})(window);
