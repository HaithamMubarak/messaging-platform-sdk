/*
 * Recovery — a phrase the customer keeps, from which every record key comes.
 *
 * Apps that seal records into Vault (Signet, Baton) encrypt each one in the
 * browser with its own key and never send the key anywhere. Lose the key and
 * the record is gone, which is the point until a clinic loses one. This keeps
 * the point and removes the loss: the clinic writes down ONE phrase, once, and
 * each record's key is derived from that phrase and the record's own id. The
 * platform still holds nothing that opens a record: no escrow, no copy of the
 * phrase, no wrapped key. A receipt (which already carries the record id and
 * blob id) plus the phrase is enough to open the record again.
 *
 *   const phrase = Recovery.newPhrase();              // show once, have it written down
 *   const master = await Recovery.master(phrase, 'signet');
 *   await Recovery.save('signet', master);           // non-extractable, this browser only
 *   const id  = Recovery.newRecordId();
 *   const key = await Recovery.recordKey(master, id); // base64, what vaultPut takes
 *   meta: { recordId: id, recovery: await Recovery.fingerprint(master) }
 *
 *   // later, anywhere:
 *   const found = Recovery.sealedRecords(bundle);     // from an exported receipt
 *   const key   = await Recovery.recordKey(await Recovery.master(typed, 'signet'), found[0].recordId);
 *   const opened = await Recovery.open(channel, found[0], key);   // {text, matches}
 *
 * The phrase is 160 random bits as 32 Crockford base32 characters in groups of
 * four. It is a key, not a password: it is never chosen by a person, so it
 * cannot be guessed, and the PBKDF2 stretch only raises the cost of trying.
 * Changing any constant below changes every key already issued, so the tests
 * pin a derivation. Loads as a classic script (window.Recovery) and under
 * Node. Vendored into apps as vendor/sdk-ui/recovery.js.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Recovery = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford: no I, L, O, U
    const CHARS = 32, GROUP = 4;
    const ITERATIONS = 210000;
    const VERSION = 'r1';
    const DB = 'hmdev-recovery', STORE = 'masters';

    function cryptoApi() {
        if (typeof crypto !== 'undefined' && crypto.subtle) return crypto;
        return require('crypto').webcrypto;
    }
    const subtle = () => cryptoApi().subtle;
    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    function b64(bytes) {
        if (typeof btoa === 'function') return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
        return Buffer.from(bytes).toString('base64');
    }

    /** 160 fresh random bits, written for a person to copy: XXXX-XXXX-… (8 groups). */
    function newPhrase() {
        const bytes = cryptoApi().getRandomValues(new Uint8Array(CHARS * 5 / 8));
        let bits = 0, value = 0, out = '';
        for (const byte of bytes) {
            value = (value << 8) | byte; bits += 8;
            while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
        }
        return group(out);
    }
    const group = (s) => s.match(new RegExp('.{1,' + GROUP + '}', 'g')).join('-');

    /** What a person typed, as the phrase: case, spaces, dashes and look-alikes forgiven. */
    function normalise(typed) {
        const s = String(typed || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
        if (s.length !== CHARS || [...s].some((c) => ALPHABET.indexOf(c) < 0)) {
            throw new Error('A recovery phrase is 32 letters and digits in eight groups of four.');
        }
        return group(s);
    }

    /** The master key for one app, from a phrase. Non-extractable: it can derive, never be read. */
    async function master(phrase, app) {
        const enc = new TextEncoder();
        const base = await subtle().importKey('raw', enc.encode(normalise(phrase)), 'PBKDF2', false, ['deriveBits']);
        const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS,
            salt: enc.encode('hmdev-recovery-' + VERSION + ':' + app) }, base, 256);
        return subtle().importKey('raw', bits, 'HKDF', false, ['deriveBits']);
    }

    async function derive(masterKey, info) {
        const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0),
            info: new TextEncoder().encode(info) }, masterKey, 256);
        return new Uint8Array(bits);
    }

    /** The key for one record: base64 raw AES-256, the form vaultPut / vaultGet take. */
    async function recordKey(masterKey, recordId) {
        if (!/^[0-9a-f]{32}$/.test(String(recordId))) throw new Error('Not a record id.');
        return b64(await derive(masterKey, 'record:' + recordId));
    }

    /** Which phrase a record needs, without revealing anything about it: "r1-1a2b3c4d". */
    async function fingerprint(masterKey) {
        return VERSION + '-' + hex((await derive(masterKey, 'fingerprint')).slice(0, 4));
    }

    const newRecordId = () => hex(cryptoApi().getRandomValues(new Uint8Array(16)));

    // ---- this browser's copy of the master key (IndexedDB, as a CryptoKey) ----

    function db() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async function tx(mode, work) {
        const d = await db();
        return new Promise((resolve, reject) => {
            const t = d.transaction(STORE, mode), req = work(t.objectStore(STORE));
            t.oncomplete = () => { d.close(); resolve(req && req.result); };
            t.onerror = () => { d.close(); reject(t.error); };
        });
    }
    async function save(app, masterKey) {
        const fp = await fingerprint(masterKey);
        await tx('readwrite', (s) => s.put({ master: masterKey, fingerprint: fp }, app));
        return fp;
    }
    const load = (app) => tx('readonly', (s) => s.get(app)).then((v) => v || null, () => null);
    const forget = (app) => tx('readwrite', (s) => s.delete(app));

    // ---- opening a sealed record from its receipt ------------------------------

    /** The records in an exported receipt that can be reopened: they name a blob. */
    function sealedRecords(bundle) {
        const records = (bundle && bundle.records) || [];
        return records.map((r, index) => {
            let meta = r.meta;
            if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch (e) { meta = null; } }
            return meta && meta.blobId ? { index, contentHash: r.contentHash, blobId: meta.blobId,
                recordId: meta.recordId || null, recovery: meta.recovery || null, meta } : null;
        }).filter(Boolean);
    }

    /** Fetch, decrypt, and check the record against the hash its receipt sealed. */
    async function open(channel, entry, key) {
        const bytes = await channel.vaultGet(entry.blobId, key);
        const text = new TextDecoder().decode(bytes);
        const digest = hex(new Uint8Array(await subtle().digest('SHA-256', new TextEncoder().encode(text))));
        return { text, matches: digest === entry.contentHash };
    }

    /** A key file from before recovery existed ("Blob: …" / "Key: …"). */
    function readKeyFile(text) {
        const blob = /^Blob:\s*(\S+)/m.exec(String(text)), key = /^Key:\s*(\S+)/m.exec(String(text));
        return blob && key ? { blobId: blob[1], key: key[1] } : null;
    }

    return { newPhrase, normalise, master, recordKey, fingerprint, newRecordId,
        save, load, forget, sealedRecords, open, readKeyFile };
}));
