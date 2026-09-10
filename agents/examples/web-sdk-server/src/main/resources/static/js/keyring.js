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
 *
 * LAYERING: this file knows nothing about apps, and must not learn. Which app
 * used which channel is an APP's business and lives in app-config.js, which
 * points at channels by id. Apps come and go; a channel outlives them, and an
 * export of your channels should be exactly that.
 */
(function (window) {
    'use strict';

    var PREFIX = 'mp.keyring.v1.';
    var MAX_CHANNELS = 500;
    var MAX_NAME = 160;
    var MAX_PASSWORD = 512;
    var ACCOUNT_KEYS = {}; // accountId -> export key
    var ENCRYPTED_PREFIX = 'k1|';
    var CORRUPT_BACKUP_PREFIX = 'corrupt';

    function accountIdKey(accountId) { return String(accountId).replace(/\./g, '__dot__'); }
    function keyFor(accountId) { return PREFIX + accountIdKey(accountId); }

    /** Tiny deterministic key fingerprint so wrong-user ciphertext can be rejected. */
    function fingerprint(key) {
        if (!key) return 'unknown';
        var h = 2166136261;
        for (var i = 0; i < key.length; i++) {
            h ^= key.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return ('00000000' + h.toString(16)).slice(-8);
    }

    /**
     * Legacy-suitable symmetric obfuscation. This is intentionally not used for
     * Drive backups (which are AES-GCM), and only gates casual local readers.
     */
    function xorEncryptDecrypt(text, key) {
        if (!text || !key) return text;
        var out = '';
        for (var i = 0; i < text.length; i++) {
            out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return out;
    }

    function serialize(accountId, data) {
        var key = ACCOUNT_KEYS[accountIdKey(accountId)] || '';
        var json = JSON.stringify(data);
        if (!key) return json;
        try {
            return ENCRYPTED_PREFIX + fingerprint(key) + '|' + btoa(xorEncryptDecrypt(json, key));
        } catch (e) {
            return json;
        }
    }

    function isEncrypted(raw, accountId) {
        if (!raw || typeof raw !== 'string') return false;
        if (raw.indexOf(ENCRYPTED_PREFIX) !== 0) return false;
        var payload = raw.slice(ENCRYPTED_PREFIX.length);
        var sep = payload.indexOf('|');
        if (sep <= 0) return false;
        return !accountId || payload.slice(0, sep) === fingerprint(ACCOUNT_KEYS[accountIdKey(accountId)]);
    }

    function decodeEncrypted(raw, accountId) {
        if (!raw || raw.indexOf(ENCRYPTED_PREFIX) !== 0) return null;
        var key = ACCOUNT_KEYS[accountIdKey(accountId)] || '';
        if (!key) return null;
        var payload = raw.slice(ENCRYPTED_PREFIX.length);
        var sep = payload.indexOf('|');
        if (sep <= 0) return null;
        var fp = payload.slice(0, sep);
        if (fp !== fingerprint(key)) return null;
        var body = payload.slice(sep + 1);
        var json = xorEncryptDecrypt(atob(body), key);
        return JSON.parse(json);
    }

    function get(key) {
        try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    }
    function set(key, value) {
        try {
            localStorage.setItem(key, value);
            return localStorage.getItem(key) === value;
        } catch (e) { return false; }
    }

    function storageError() {
        var e = new Error('This browser could not save your channels. Free some storage or leave private browsing, then try again.');
        e.code = 'MP_STORAGE_UNAVAILABLE';
        return e;
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
        try {
            var decoded = decodeEncrypted(raw, accountId);
            if (decoded && Array.isArray(decoded.channels)) {
                return decoded;
            }
        } catch (e2) { /* fall through */ }
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
        if (!accountId) return false;
        var key = keyFor(accountId);
        var previous = get(key);
        data.updatedAt = Date.now();
        var next = serialize(accountId, data);
        // Write the primary before replacing the recovery copy. A full quota
        // must not turn one failed save into the loss of both good versions.
        if (!set(key, next)) return false;
        if (previous) set(key + '.bak', previous);
        return true;
    }

    function ensureEncrypted(accountId) {
        if (!accountId) return false;
        if (!ACCOUNT_KEYS[accountIdKey(accountId)]) return false;
        var key = keyFor(accountId);
        var raw = get(key);
        if (!raw || isEncrypted(raw, accountId)) return false;
        var data = load(accountId);
        if (data && Array.isArray(data.channels)) {
            return save(accountId, data);
        }
        return false;
    }

    /**
     * Is this the same room?
     *
     * A channel is identified by name AND password. Both sides are normalised
     * because a caller that omits the password entirely and one that passes ''
     * mean the same thing -- a room with no password -- and comparing them raw
     * made them different rooms. add() would then not find the existing row
     * and would append a second one, so the same room saved twice through the
     * public API produced two entries.
     */
    function sameChannel(a, name, password) {
        return a.name === name && (a.password || '') === (password || '');
    }

    // This is the name this person uses in one particular channel, not their
    // Platform account name. Keep it beside the saved credential so selecting
    // a channel restores the identity that belongs there.
    function username(value) {
        return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 80);
    }

    function text(value, max) {
        return typeof value === 'string' && value.length <= max ? value : null;
    }

    function importedChannel(c) {
        if (!c) return null;
        var name = text(c.name, MAX_NAME);
        var password = typeof c.password === 'undefined' ? '' : text(c.password, MAX_PASSWORD);
        if (!name || password === null) return null;
        return {
            name: name,
            password: password,
            label: text(c.label, 80) || name,
            username: username(c.username),
            createdAt: typeof c.createdAt === 'number' && isFinite(c.createdAt) ? c.createdAt : Date.now(),
            lastUsedAt: typeof c.lastUsedAt === 'number' && isFinite(c.lastUsedAt) ? c.lastUsedAt : Date.now()
        };
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
                if (username(entry.username)) existing.username = username(entry.username);
                existing.lastUsedAt = Date.now();
                if (!save(accountId, data)) throw storageError();
                return existing;
            }
            var row = {
                id: 'k_' + Math.random().toString(36).slice(2, 10),
                label: entry.label || entry.name,   // the name is the default label
                name: entry.name,
                password: entry.password || '',
                username: username(entry.username),
                createdAt: Date.now(),
                lastUsedAt: Date.now()
            };
            data.channels.unshift(row);
            if (!save(accountId, data)) throw storageError();
            return row;
        },

        /** Rename is label-only: the channel name is identity, not a nickname. */
        rename: function (accountId, id, label) {
            var data = load(accountId);
            var row = data.channels.filter(function (c) { return c.id === id; })[0];
            if (!row) return false;
            row.label = String(label || '').slice(0, 80) || row.name;
            if (!save(accountId, data)) throw storageError();
            return true;
        },

        /** Set the identity used only in this channel; blank means account default. */
        setUsername: function (accountId, id, value) {
            var data = load(accountId);
            var row = data.channels.filter(function (c) { return c.id === id; })[0];
            if (!row) return false;
            row.username = username(value);
            if (!save(accountId, data)) throw storageError();
            return true;
        },

        remove: function (accountId, id) {
            var data = load(accountId);
            var before = data.channels.length;
            data.channels = data.channels.filter(function (c) { return c.id !== id; });
            if (data.channels.length === before) return false;
            if (!save(accountId, data)) throw storageError();
            return true;
        },

        /** Mark a channel as used just now. Returns the row, or null. */
        touch: function (accountId, name, password, profileName) {
            var data = load(accountId);
            var row = data.channels.filter(function (c) {
                return sameChannel(c, name, password);
            })[0];
            if (!row) return null;
            if (username(profileName)) row.username = username(profileName);
            row.lastUsedAt = Date.now();
            if (!save(accountId, data)) throw storageError();
            return row;
        },

        /** Everything, for an export file. */
        exportData: function (accountId) { return load(accountId); },

        /** Validate and describe an import before the user commits it. */
        previewImport: function (accountId, incoming) {
            var result = { added: 0, skipped: 0, updated: 0, invalid: 0 };
            if (!accountId || !incoming || !Array.isArray(incoming.channels)) return result;
            var existing = load(accountId).channels;
            incoming.channels.slice(0, MAX_CHANNELS).forEach(function (raw) {
                var c = importedChannel(raw);
                if (!c) { result.invalid++; return; }
                var dup = existing.filter(function (e) { return sameChannel(e, c.name, c.password); })[0];
                if (!dup) { result.added++; return; }
                if (!username(dup.username) && c.username) result.updated++;
                result.skipped++;
            });
            result.invalid += Math.max(0, incoming.channels.length - MAX_CHANNELS);
            return result;
        },

        /**
         * Merge an imported list in. Import never destroys: a room already
         * saved is left alone rather than replaced, so importing an older
         * backup cannot silently undo newer work. One safe exception: a
         * missing local per-channel name is filled from the backup. It never
         * replaces a name the current device already has.
         * @returns {{added:number, skipped:number, updated:number, invalid:number}}
         */
        importData: function (accountId, incoming) {
            if (!accountId || !incoming || !Array.isArray(incoming.channels)) {
                return { added: 0, skipped: 0, updated: 0, invalid: 0 };
            }
            var data = load(accountId);
            var added = 0, skipped = 0, updated = 0, invalid = 0;
            incoming.channels.slice(0, MAX_CHANNELS).forEach(function (raw) {
                var c = importedChannel(raw);
                if (!c) { invalid++; return; }
                var dup = data.channels.filter(function (e) {
                    return sameChannel(e, c.name, c.password);
                })[0];
                if (dup) {
                    if (!username(dup.username) && username(c.username)) {
                        dup.username = username(c.username);
                        updated++;
                    }
                    skipped++;
                    return;
                }
                data.channels.push({
                    id: 'k_' + Math.random().toString(36).slice(2, 10),
                    label: c.label,
                    name: c.name,
                    password: c.password || '',
                    username: username(c.username),
                    createdAt: c.createdAt,
                    lastUsedAt: c.lastUsedAt
                });
                added++;
            });
            if ((added || updated) && !save(accountId, data)) throw storageError();
            invalid += Math.max(0, incoming.channels.length - MAX_CHANNELS);
            return { added: added, skipped: skipped, updated: updated, invalid: invalid };
        },

        /** Sign-out on a shared machine. */
        clear: function (accountId) {
            if (!accountId) return;
            try {
                localStorage.removeItem(keyFor(accountId));
                localStorage.removeItem(keyFor(accountId) + '.bak');
                localStorage.removeItem(keyFor(accountId) + '.' + CORRUPT_BACKUP_PREFIX);
            } catch (e) {}
        },

        /**
         * Bind an account to its export key so local lists are stored encrypted
         * at rest with that account's keying material.
         */
        setAccountKey: function (accountId, key) {
            if (!accountId || !key) {
                delete ACCOUNT_KEYS[accountIdKey(accountId)];
                return;
            }
            ACCOUNT_KEYS[accountIdKey(accountId)] = String(key);
        },

        clearAccountKey: function (accountId) {
            if (!accountId) return;
            delete ACCOUNT_KEYS[accountIdKey(accountId)];
        },

        /** Encrypt this account's key list on next operation if key is known. */
        ensureEncrypted: function (accountId) {
            try { return ensureEncrypted(accountId); } catch (e) { return false; }
        },

        /** Check whether the current value on disk is encrypted for this account. */
        isEncrypted: function (accountId) {
            try {
                return isEncrypted(get(keyFor(accountId)), accountId);
            } catch (e) {
                return false;
            }
        },

        KEY_PREFIX: PREFIX
    };

    window.Keyring = Keyring;
})(window);
