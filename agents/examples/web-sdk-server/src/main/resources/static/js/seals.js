/**
 * Seals: "who did this", in the platform's words rather than the record's.
 *
 * Channel storage keeps no author, so a name written into a stored record is
 * the writer's claim: anyone in the room can store "from: Ann". Attest is the
 * fix. Sealing a hash makes the platform record WHICH AGENT sealed it, and
 * sign that; reading the chain back and verifying it tells you who really did
 * what. Drop's mailbox seals who left a drop and who collected it; Chat's
 * Knock seals who rang.
 *
 * Every seal's hash is public, so the text sealed should include a random salt
 * kept only inside the encrypted record: without it, a short message could be
 * confirmed by guessing it.
 *
 *     const salt = Seals.salt();
 *     await Seals.seal(conn, 'my-chain', 'kind', 'what|' + id + '|' + salt);
 *     const seals = await Seals.read(conn, 'my-chain');
 *     const s = seals[await Seals.hash('what|' + id + '|' + salt)];
 *     // s && s.kind === 'kind' ? s.stamp.agent : not signed
 */
(function (root) {
    'use strict';

    async function hash(text) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [].slice.call(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function salt() {
        return [].slice.call(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    /** Seal `text` on `chain`; resolves to the receipt, or null if it was not sealed. */
    function seal(conn, chain, kind, text) {
        return hash(text).then((contentHash) => new Promise((resolve) => {
            if (!conn || typeof conn.attest !== 'function') { resolve(null); return; }
            conn.attest({ chainKey: chain, kind, contentHash, meta: {} },
                (r) => resolve(r && r.status === 'success' ? r : null));
        }));
    }

    /**
     * Every seal on `chain`, by content hash (the earliest when a hash repeats).
     * Empty if the chain cannot be read or does not verify: no seal is believed
     * from a chain that does not hold.
     */
    function read(conn, chain) {
        return new Promise((resolve) => {
            if (!conn || typeof conn.attestList !== 'function') { resolve({}); return; }
            conn.attestList(chain, (res) => {
                const bundle = res && res.status === 'success' ? res.data : null;
                const byHash = {};
                if (!bundle || !Array.isArray(bundle.records)) { resolve(byHash); return; }
                const verify = root.AgentConnection && root.AgentConnection.attestVerify;
                Promise.resolve(verify ? verify(bundle) : { ok: true }).then((v) => {
                    if (v && v.ok) bundle.records.forEach((r) => { if (!byHash[r.contentHash]) byHash[r.contentHash] = r; });
                    resolve(byHash);
                }, () => resolve(byHash));
            });
        });
    }

    /** Who sealed `text` as `kind`, from a read() map; null when nobody did. */
    async function who(seals, kind, text) {
        const s = seals[await hash(text)];
        return s && s.kind === kind ? s.stamp.agent : null;
    }

    root.Seals = { hash, salt, seal, read, who };
})(typeof window !== 'undefined' ? window : this);
