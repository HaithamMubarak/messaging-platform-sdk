/**
 * Receipts: the seal record apps share (js/receipts.js).
 *
 * What matters most is the thing an app cannot see going wrong: `canonical`
 * is the serialisation every receipt already issued was hashed with, so its
 * output is pinned byte for byte, not just "stable". Then: a refused append
 * rejects instead of looking sealed, the record stored is the canonical one,
 * and the vault key comes back to the caller and goes nowhere else.
 */
const assert = require('assert');
const path = require('path');

const R = require(path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js', 'receipts.js'));

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('  ok   ' + name);
    } catch (e) {
        failed++;
        console.log('  FAIL ' + name + ' -- ' + e.message);
    }
}

function fakeChannel(answer) {
    const seen = { attest: [], vault: [] };
    return {
        seen,
        attestHash: (c) => R.sha256Hex(c),
        attest(o, cb) { seen.attest.push(o); cb(answer || { status: 'success', data: { record: { seq: 4 } } }); },
        attestExport(key, cb) { cb({ status: 'success', data: { bundle: { chainKey: key, records: [] } } }); },
        async vaultPut(blob, opts) { seen.vault.push({ text: await blob.text(), opts }); return { blobId: 'b1', key: 'k1' }; },
    };
}

(async () => {
    console.log('receipts');

    await check('canonical output is pinned: sorted keys at every depth, arrays in order, no spaces', async () => {
        const out = R.canonical({ b: 1, a: [3, { d: 'x', c: null }], e: { z: true, y: 'é"' } });
        assert.strictEqual(out, '{"a":[3,{"c":null,"d":"x"}],"b":1,"e":{"y":"é\\"","z":true}}');
    });

    await check('sha256Hex hashes strings as UTF-8 and bytes as bytes, to the known digest', async () => {
        const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        assert.strictEqual(await R.sha256Hex('abc'), abc);
        assert.strictEqual(await R.sha256Hex(new TextEncoder().encode('abc')), abc);
        assert.strictEqual(await R.sha256Hex(new TextEncoder().encode('abc').buffer), abc);
    });

    await check('seal hashes the content the way Attest does and returns the chain record', async () => {
        const ch = fakeChannel();
        const r = await R.seal(ch, { chainKey: 'c', kind: 'k', content: 'abc', meta: { n: 1 } });
        assert.strictEqual(r.seq, 4);
        assert.strictEqual(r.contentHash, await R.sha256Hex('abc'));
        assert.deepStrictEqual(ch.seen.attest[0], { chainKey: 'c', kind: 'k', contentHash: r.contentHash, meta: { n: 1 } });
    });

    await check('a refused append rejects with the platform\'s reason, never looks sealed', async () => {
        const ch = fakeChannel({ status: 'error', data: 'The channel is not ready.' });
        await assert.rejects(R.seal(ch, { chainKey: 'c', kind: 'k', contentHash: 'ab' }), /not ready/);
    });

    await check('store puts the canonical record into Vault and hands the key back', async () => {
        const ch = fakeChannel();
        const s = await R.store(ch, { b: 2, a: 1 }, { ttlDays: 14, quotaTag: 'screener' });
        assert.deepStrictEqual(s, { blobId: 'b1', key: 'k1', bytes: 13 });
        assert.strictEqual(ch.seen.vault[0].text, '{"a":1,"b":2}');
        assert.deepStrictEqual(ch.seen.vault[0].opts, { quotaTag: 'screener', ttlSeconds: 14 * 86400 });
    });

    await check('store without a vault says so instead of pretending', async () => {
        await assert.rejects(R.store({}, { a: 1 }), /no vault/);
    });

    await check('exportChain resolves the bundle', async () => {
        const b = await R.exportChain(fakeChannel(), 'handover-x');
        assert.strictEqual(b.chainKey, 'handover-x');
    });

    console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
    process.exitCode = failed ? 1 : 0;
})();
