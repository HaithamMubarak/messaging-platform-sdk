/**
 * The channels you have saved.
 *
 * Kept in localStorage, keyed by account — never on our servers. That is a
 * deliberate product decision, not an omission: the platform stores nothing
 * about which rooms you keep, and if you lose the list, somebody else in the
 * room shares the link again.
 *
 * Two consequences to be honest about rather than paper over:
 *
 *  - A saved channel's password rests in localStorage in the clear. Saving a
 *    room means being able to reopen it without being asked for anything, and
 *    a list that survives the tab has to live somewhere the tab can read on
 *    load. Any script on this origin can read it, exactly as it can already
 *    read the session token that sits beside it.
 *  - Keying by account is a courtesy, not access control. Two people on one
 *    machine get separate lists and do not see each other's rows, but
 *    localStorage has no permissions; a shared computer is handled by signing
 *    out, not by cryptography.
 *
 * Nothing here is read or written unless somebody is signed in: the anonymous
 * tier has an active channel (active-channel.js) and no saved list at all.
 */
(function (window) {
    'use strict';

    var PREFIX = 'mp.keyring.v1.';

    function keyFor(accountId) { return PREFIX + accountId; }

    function get(key) {
        try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    }
    function set(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* private mode, quota */ }
    }

    function blank() { return { version: 1, channels: [], updatedAt: Date.now() }; }

    /**
     * Read the saved list. Never throws: a corrupt value costs the user their
     * list, so the previous good copy is tried before giving up, and the bad
     * value is kept aside rather than destroyed.
     */
    function load(accountId) {
        if (!accountId) return blank();
        var key = keyFor(accountId);
        var raw = get(key);
        if (!raw) return blank();
        try {
            var v = JSON.parse(raw);
            if (v && Array.isArray(v.channels)) return v;
        } catch (e) { /* fall through to the backup */ }
        var bak = get(key + '.bak');
        if (bak) {
            try {
                var b = JSON.parse(bak);
                if (b && Array.isArray(b.channels)) return b;
            } catch (e2) { /* nothing readable */ }
        }
        set(key + '.corrupt', raw);
        return blank();
    }

    function save(accountId, data) {
        if (!accountId) return;
        var key = keyFor(accountId);
        var previous = get(key);
        if (previous) set(key + '.bak', previous);
        data.updatedAt = Date.now();
        set(key, JSON.stringify(data));
    }

    function sameChannel(a, name, password) {
        return a.name === name && a.password === password;
    }

    var Keyring = {
        list: function (accountId) { return load(accountId).channels; },

        /** Is this exact room (name AND password) already saved? */
        has: function (accountId, name, password) {
            return load(accountId).channels.some(function (c) {
                return sameChannel(c, name, password);
            });
        },

        /**
         * Save a room. A channel is identified by name AND password, because
         * a different password is a different room -- saving the same name
         * twice under two passwords is two entries, not an overwrite.
         */
        add: function (accountId, entry) {
            if (!accountId || !entry || !entry.name) return null;
            var data = load(accountId);
            var existing = data.channels.filter(function (c) {
                return sameChannel(c, entry.name, entry.password);
            })[0];
            if (existing) {
                existing.lastUsedAt = Date.now();
                if (entry.app && existing.apps.indexOf(entry.app) === -1) existing.apps.push(entry.app);
                save(accountId, data);
                return existing;
            }
            var row = {
                id: 'k_' + Math.random().toString(36).slice(2, 10),
                label: entry.label || entry.name,   // the name is the default label
                name: entry.name,
                password: entry.password || '',
                apps: entry.app ? [entry.app] : [],
                createdAt: Date.now(),
                lastUsedAt: Date.now()
            };
            data.channels.unshift(row);
            save(accountId, data);
            return row;
        },

        /** Rename is label-only: the channel name is identity, not a nickname. */
        rename: function (accountId, id, label) {
            var data = load(accountId);
            var row = data.channels.filter(function (c) { return c.id === id; })[0];
            if (!row) return false;
            row.label = String(label || '').slice(0, 80) || row.name;
            save(accountId, data);
            return true;
        },

        remove: function (accountId, id) {
            var data = load(accountId);
            var before = data.channels.length;
            data.channels = data.channels.filter(function (c) { return c.id !== id; });
            if (data.channels.length === before) return false;
            save(accountId, data);
            return true;
        },

        touch: function (accountId, name, password, app) {
            var data = load(accountId);
            var row = data.channels.filter(function (c) {
                return sameChannel(c, name, password);
            })[0];
            if (!row) return false;
            row.lastUsedAt = Date.now();
            if (app && row.apps.indexOf(app) === -1) row.apps.push(app);
            save(accountId, data);
            return true;
        },

        /** Everything, for an export file. */
        exportData: function (accountId) { return load(accountId); },

        /**
         * Merge an imported list in. Import never destroys: a room already
         * saved is left alone rather than replaced, so importing an older
         * backup cannot silently undo newer work.
         * @returns {{added:number, skipped:number}}
         */
        importData: function (accountId, incoming) {
            if (!accountId || !incoming || !Array.isArray(incoming.channels)) {
                return { added: 0, skipped: 0 };
            }
            var data = load(accountId);
            var added = 0, skipped = 0;
            incoming.channels.forEach(function (c) {
                if (!c || !c.name) { skipped++; return; }
                var dup = data.channels.some(function (e) {
                    return sameChannel(e, c.name, c.password);
                });
                if (dup) { skipped++; return; }
                data.channels.push({
                    id: 'k_' + Math.random().toString(36).slice(2, 10),
                    label: c.label || c.name,
                    name: c.name,
                    password: c.password || '',
                    apps: Array.isArray(c.apps) ? c.apps : [],
                    createdAt: c.createdAt || Date.now(),
                    lastUsedAt: c.lastUsedAt || Date.now()
                });
                added++;
            });
            if (added) save(accountId, data);
            return { added: added, skipped: skipped };
        },

        /** Sign-out on a shared machine. */
        clear: function (accountId) {
            if (!accountId) return;
            try {
                localStorage.removeItem(keyFor(accountId));
                localStorage.removeItem(keyFor(accountId) + '.bak');
            } catch (e) {}
        },

        KEY_PREFIX: PREFIX
    };

    window.Keyring = Keyring;
})(window);
