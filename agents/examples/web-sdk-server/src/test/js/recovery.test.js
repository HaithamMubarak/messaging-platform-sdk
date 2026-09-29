/**
 * Recovery: the phrase a customer keeps, from which record keys come (js/recovery.js).
 *
 * The rules that matter:
 *   1. a phrase is 160 random bits a person can copy, and typing it back with
 *      spaces, lowercase or look-alike letters still works;
 *   2. the same phrase, app and record id give the same key on every browser,
 *      for ever: one derivation is PINNED, because changing a constant would
 *      orphan every record already sealed;
 *   3. a different phrase, app or record gives a different key;
 *   4. opening a record checks it against the hash its receipt sealed.
 */
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'js', 'recovery.js'));

const PHRASE = '0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ';
const RECORD = '00112233445566778899aabbccddeeff';
let failed = 0;
async function check(name, fn) {
    try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' — ' + e.message); }
}

(async () => {
    await check('a new phrase is 8 groups of 4 from the Crockford alphabet, and never repeats', () => {
        const a = R.newPhrase(), b = R.newPhrase();
        assert.match(a, /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
        assert.notStrictEqual(a, b);
    });
    await check('a typed phrase is forgiven its case, spacing and look-alikes, but not a wrong length', () => {
        assert.strictEqual(R.normalise(' 0123 4567 89ab cdef ghjk mnpq rstv wxyz '), PHRASE);
        assert.strictEqual(R.normalise('O123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ'), PHRASE, 'O read as 0');
        assert.throws(() => R.normalise('0123-4567'), /32 letters/);
    });
    const master = await R.master(PHRASE, 'signet');
    await check('the derivation is pinned: this phrase, app and record give this key', async () => {
        const key = await R.recordKey(master, RECORD);
        assert.strictEqual(Buffer.from(key, 'base64').length, 32);
        assert.strictEqual(key, PINNED_KEY, 'changing a constant orphans every sealed record');
        assert.strictEqual(await R.fingerprint(master), PINNED_FP);
    });
    await check('the same phrase typed differently gives the same key', async () => {
        const again = await R.master(PHRASE.toLowerCase().replace(/-/g, ' '), 'signet');
        assert.strictEqual(await R.recordKey(again, RECORD), await R.recordKey(master, RECORD));
    });
    await check('another record, app or phrase gives another key', async () => {
        const k = await R.recordKey(master, RECORD);
        assert.notStrictEqual(await R.recordKey(master, 'ffeeddccbbaa99887766554433221100'), k);
        assert.notStrictEqual(await R.recordKey(await R.master(PHRASE, 'baton'), RECORD), k);
        assert.notStrictEqual(await R.recordKey(await R.master(R.newPhrase(), 'signet'), RECORD), k);
    });
    await check('the master key cannot be read out of the browser', async () => {
        assert.strictEqual(master.extractable, false);
        await assert.rejects(require('crypto').webcrypto.subtle.exportKey('raw', master));
    });
    await check('a receipt lists what can be reopened, and opening checks the sealed hash', async () => {
        const text = '{"a":1}';
        const hash = require('crypto').createHash('sha256').update(text).digest('hex');
        const bundle = { records: [{ contentHash: 'x', meta: '{"note":"no blob"}' },
            { contentHash: hash, meta: JSON.stringify({ blobId: 'b1', recordId: RECORD, recovery: 'r1-00' }) }] };
        const found = R.sealedRecords(bundle);
        assert.strictEqual(found.length, 1);
        assert.deepStrictEqual([found[0].blobId, found[0].recordId, found[0].index], ['b1', RECORD, 1]);
        const channel = { vaultGet: async (blob, key) => { assert.strictEqual(key, 'K'); return new TextEncoder().encode(text); } };
        assert.strictEqual((await R.open(channel, found[0], 'K')).matches, true);
        assert.strictEqual((await R.open(channel, Object.assign({}, found[0], { contentHash: 'ff' }), 'K')).matches, false);
    });
    await check('an old per-record key file is still readable', () => {
        assert.deepStrictEqual(R.readKeyFile('Signet record key\nCeremony: c1\nBlob: b9\nKey: QUJD\n'), { blobId: 'b9', key: 'QUJD' });
        assert.strictEqual(R.readKeyFile('nothing here'), null);
    });

    console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
    process.exitCode = failed ? 1 : 0;
})();

// Pinned 2026-09-29, and reproduced independently with node's pbkdf2Sync + hkdfSync
// (standard PBKDF2-SHA256 then HKDF-SHA256). Never regenerate them.
var PINNED_KEY = 'U+WL54o+6r+oQ7z8WjBOqTuXF47qxGpH1T0n2GnDq1Y=';
var PINNED_FP = 'r1-e256f1a7';
