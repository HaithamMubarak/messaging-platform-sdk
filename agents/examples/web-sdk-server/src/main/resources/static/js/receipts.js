/*
 * Receipts — the seal every record app does, done once.
 *
 * Signet, Baton, Fieldstamp, Screener and Turnstile all make the same promise:
 * the record is serialised the same way on every browser, hashed here,
 * encrypted into Vault under a key that never leaves this browser, and the
 * HASH (never the record) is appended to an Attest chain anyone can verify.
 * Each app carried its own copy of every step. This is that, so an app writes
 * what its record IS and not how to seal one.
 *
 *   const stored  = await Receipts.store(channel, record, { ttlDays: 30 });
 *   const receipt = await Receipts.seal(channel, {
 *       chainKey: 'handover-' + home, kind: 'handover-closed',
 *       content: Receipts.canonical(record),       // or contentHash: '…'
 *       meta: { blobId: stored.blobId, licensed },  // travels with exports
 *   });
 *   const bundle  = await Receipts.exportChain(channel, 'handover-' + home);
 *   Receipts.download('baton-receipt.json', JSON.stringify(bundle, null, 2));
 *
 * `canonical` is a format, not a helper: records already sealed were hashed
 * with exactly this serialisation, so changing a byte of its output breaks
 * every receipt issued before the change. Its tests pin the output.
 *
 * Loads as a classic script (window.Receipts) and under Node (module.exports),
 * so the apps' domain cores can use it in their browserless tests. Vendored
 * into apps as vendor/sdk-ui/receipts.js.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Receipts = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DAY = 24 * 3600;

    function subtle() {
        if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
        return require('crypto').webcrypto.subtle;
    }

    /** Lowercase hex SHA-256 of a string (as UTF-8) or of bytes. */
    async function sha256Hex(content) {
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
        const digest = await subtle().digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    /** Stable JSON: same object, same string, same hash, on every browser. */
    function canonical(obj) {
        if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
        if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
        return '{' + Object.keys(obj).sort()
            .map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
    }

    /**
     * Encrypt a record (canonical JSON) or a Blob/File into Vault. The key
     * comes back here and is sent nowhere; losing it loses the record.
     * Options other than ttlDays pass through to vaultPut (quotaTag, onProgress).
     */
    async function store(channel, source, options) {
        if (!channel || typeof channel.vaultPut !== 'function') {
            throw new Error('This server has no vault.');
        }
        const opts = Object.assign({}, options);
        const ttlDays = opts.ttlDays || 30;
        delete opts.ttlDays;
        opts.ttlSeconds = ttlDays * DAY;
        const isBlob = typeof Blob !== 'undefined' && source instanceof Blob;
        const blob = isBlob ? source : new Blob([canonical(source)], { type: 'application/json' });
        const put = await channel.vaultPut(blob, opts);
        return { blobId: put.blobId, key: put.key, bytes: blob.size };
    }

    /** The platform's callback style, as a promise that rejects with its reason. */
    function call(fn, arg) {
        return new Promise((resolve, reject) => fn(arg, (r) => {
            if (r && r.status === 'success') resolve(r.data);
            else reject(new Error((r && typeof r.data === 'string' && r.data) || 'attest failed'));
        }));
    }

    /**
     * Append one record to an Attest chain. Give `content` (hashed here, the
     * way Attest hashes) or a precomputed `contentHash`. Resolves the chain
     * record plus the contentHash; rejects when the platform refused.
     */
    async function seal(channel, entry) {
        if (!channel || typeof channel.attest !== 'function') throw new Error('This server has no Attest.');
        const contentHash = entry.contentHash || await channel.attestHash(entry.content);
        const data = await call(channel.attest.bind(channel), {
            chainKey: entry.chainKey, kind: entry.kind, contentHash, meta: entry.meta || null,
        });
        return Object.assign({ contentHash }, (data && data.record) || {});
    }

    /** The chain as a self-contained bundle anyone can verify offline. */
    async function exportChain(channel, chainKey) {
        const data = await call(channel.attestExport.bind(channel), chainKey);
        return (data && data.bundle) || data;
    }

    /** Hand the operator a file. */
    function download(name, text, type) {
        const url = URL.createObjectURL(new Blob([text], { type: type || 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    return { sha256Hex, canonical, store, seal, exportChain, download };
}));
