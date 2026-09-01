/**
 * The keyring backup file: reading and writing `mp-keyring`.
 *
 * One module, two hosts. It uses only WebCrypto and JSON, so the same file
 * runs unmodified in a browser tab and in a Node process (>= 16) -- which is
 * the point: a backup you take in the browser must be readable by an
 * HTML5/Node app you write later, and the other way round.
 *
 * FORMAT
 *
 *   v2 (written today)   { format, version: 2, keyId, iv, ct }
 *   v1 (still readable)  { format, version: 1, channels: [...] }   plaintext
 *
 * v2 is AES-256-GCM under the account's export key -- a raw 256-bit key the
 * platform mints and holds, so there is NO password and no KDF here. That is
 * deliberate: a passphrase would be a second secret to forget, and forgetting
 * it would destroy the backup with nobody able to help. Signing in is the
 * recovery instead.
 *
 * The version field is why v2 could replace v1 at all, and why v3 will be
 * able to replace v2. A format with no version is a format you cannot change.
 *
 * WHAT THIS DOES AND DOES NOT PROMISE
 *
 * The ciphertext is unreadable to anyone without the key -- which genuinely
 * includes Google, if the file is kept in Drive appData. It does NOT mean the
 * platform cannot read it: the platform holds the key. It holds the key and
 * never the file. Custody, not incapability, and the copy must say so.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KeyringFile = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var FORMAT = 'mp-keyring';
    var VERSION = 2;
    /* Bound to the version, so a v2 file cannot be replayed as some future v3
     * by editing one number: the tag would not verify. */
    var AAD = 'mp-keyring/2';
    var IV_BYTES = 12;   // GCM's nominal nonce size

    /** WebCrypto, wherever we are. */
    function subtle() {
        var g = (typeof globalThis !== 'undefined') ? globalThis : this;
        if (g.crypto && g.crypto.subtle) return g.crypto.subtle;
        try {
            return require('crypto').webcrypto.subtle;   // Node 16/18
        } catch (e) {
            throw new Error('This environment has no WebCrypto, so backups cannot be encrypted here.');
        }
    }

    function randomBytes(n) {
        var g = (typeof globalThis !== 'undefined') ? globalThis : this;
        var out = new Uint8Array(n);
        if (g.crypto && g.crypto.getRandomValues) { g.crypto.getRandomValues(out); return out; }
        var nodeCrypto = require('crypto');
        return new Uint8Array(nodeCrypto.randomBytes(n));
    }

    function b64encode(bytes) {
        if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    }

    function b64decode(text) {
        if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
        var raw = atob(text);
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    function utf8(text) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
        return new Uint8Array(Buffer.from(text, 'utf8'));
    }

    function fromUtf8(bytes) {
        if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
        return Buffer.from(bytes).toString('utf8');
    }

    function importKey(keyB64) {
        var raw = b64decode(keyB64);
        if (raw.length !== 32) {
            return Promise.reject(new Error('That export key is not a 256-bit key.'));
        }
        return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    /** The same short label the service reports, so errors can be precise. */
    function keyIdOf(keyB64) {
        return subtle().digest('SHA-256', utf8(keyB64)).then(function (digest) {
            var bytes = new Uint8Array(digest);
            var hex = '';
            for (var i = 0; i < 8; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
            return hex;
        });
    }

    return {
        FORMAT: FORMAT,
        VERSION: VERSION,
        keyIdOf: keyIdOf,

        /**
         * Encrypt a channel list into a v2 file.
         * @param {{channels: Array}} data
         * @param {string} keyB64 the account's export key
         * @returns {Promise<object>} the file, ready to be JSON.stringify'd
         */
        write: function (data, keyB64) {
            var payload = JSON.stringify({ channels: (data && data.channels) || [] });
            var iv = randomBytes(IV_BYTES);   // fresh per write; never reused
            return Promise.all([importKey(keyB64), keyIdOf(keyB64)]).then(function (both) {
                return subtle().encrypt(
                    { name: 'AES-GCM', iv: iv, additionalData: utf8(AAD) },
                    both[0], utf8(payload)
                ).then(function (ct) {
                    return {
                        format: FORMAT,
                        version: VERSION,
                        keyId: both[1],
                        iv: b64encode(iv),
                        ct: b64encode(new Uint8Array(ct))
                    };
                });
            });
        },

        /**
         * Read a file of either version.
         *
         * A v1 file is plaintext and needs no key -- backups taken before
         * encryption existed keep working, which is the whole reason the
         * version field was there from the start.
         *
         * @param {object} file   parsed JSON
         * @param {string} [keyB64] required for v2
         * @returns {Promise<{channels: Array}>}
         */
        read: function (file, keyB64) {
            if (!file || file.format !== FORMAT) {
                return Promise.reject(new Error('That file is not a keyring backup.'));
            }
            if (file.version === 1) {
                // A v1 file is plaintext and carries its channels in the
                // clear. Anything else calling itself v1 is not one, and the
                // commonest way to produce one is to edit the version of a v2
                // file -- which took the branch above and restored NOTHING,
                // reporting success. The AAD binds the version inside the
                // ciphertext, but nothing encrypted is ever opened down here,
                // so this is the only place that mismatch can be caught.
                if (file.ct || file.iv) {
                    return Promise.reject(new Error(
                        'That backup is encrypted but labelled as an old plaintext one. '
                      + 'It has been edited, and cannot be trusted.'));
                }
                if (!Array.isArray(file.channels)) {
                    return Promise.reject(new Error('That backup file is damaged.'));
                }
                return Promise.resolve({ channels: file.channels });
            }
            if (file.version !== VERSION) {
                return Promise.reject(new Error(
                    'That backup was written by a newer version of the platform.'));
            }
            if (!keyB64) {
                return Promise.reject(new Error('Sign in to open an encrypted backup.'));
            }
            if (!file.iv || !file.ct) {
                return Promise.reject(new Error('That backup file is damaged.'));
            }

            return keyIdOf(keyB64).then(function (mine) {
                // Checked BEFORE decrypting so the message can be true. A
                // failed tag alone cannot tell a wrong key from a corrupt
                // file, and guessing between them in the error is how people
                // get sent looking for the wrong problem.
                if (file.keyId && file.keyId !== mine) {
                    throw new Error('That backup belongs to a different account, '
                                  + 'or was made before the key was destroyed.');
                }
                return importKey(keyB64);
            }).then(function (key) {
                return subtle().decrypt(
                    { name: 'AES-GCM', iv: b64decode(file.iv), additionalData: utf8(AAD) },
                    key, b64decode(file.ct)
                );
            }).then(function (plain) {
                var parsed = JSON.parse(fromUtf8(new Uint8Array(plain)));
                return { channels: Array.isArray(parsed.channels) ? parsed.channels : [] };
            }).catch(function (e) {
                if (/different account|newer version|damaged|Sign in|256-bit/.test(e.message)) throw e;
                throw new Error('That backup could not be opened. It may be damaged.');
            });
        }
    };
});
