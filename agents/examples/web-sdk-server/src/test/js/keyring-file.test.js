/**
 * The backup file, both directions.
 *
 * This module is loaded by a browser tab and by a Node process, and a backup
 * taken in one must open in the other -- that is the whole reason it uses
 * only WebCrypto and JSON. These tests run it as Node loads it, which is the
 * half that is easy to break without noticing.
 */
const assert = require('assert');
const path = require('path');
const KF = require(path.join(__dirname, '..', '..', 'main', 'resources', 'static',
    'js', 'keyring-file.js'));

const KEY = Buffer.from(require('crypto').randomBytes(32)).toString('base64');
const OTHER = Buffer.from(require('crypto').randomBytes(32)).toString('base64');

const DATA = { channels: [
    { id: 'k_1', label: 'Team Friday', name: 'wb-123', password: 'hunter2' },
    { id: 'k_2', label: 'Ops', name: 'pulse-9', password: 'correct horse' },
] };

let failures = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('a written file round-trips', async () => {
    const file = await KF.write(DATA, KEY);
    const back = await KF.read(file, KEY);
    assert.deepStrictEqual(back.channels, DATA.channels);
});

check('the file on disk contains none of the plaintext', async () => {
    const file = await KF.write(DATA, KEY);
    const onDisk = JSON.stringify(file);
    ['hunter2', 'correct horse', 'wb-123', 'Team Friday'].forEach((secret) => {
        assert.ok(onDisk.indexOf(secret) === -1, 'plaintext leaked into the file: ' + secret);
    });
});

check('it declares its format and version, so it can be replaced later', async () => {
    const file = await KF.write(DATA, KEY);
    assert.strictEqual(file.format, 'mp-keyring');
    assert.strictEqual(file.version, 2);
    assert.ok(file.keyId && file.iv && file.ct);
});

check('every write uses a fresh IV', async () => {
    const a = await KF.write(DATA, KEY);
    const b = await KF.write(DATA, KEY);
    assert.notStrictEqual(a.iv, b.iv, 'the IV repeated, which breaks GCM outright');
    assert.notStrictEqual(a.ct, b.ct);
});

check('another account\'s key is refused by name, not by a vague failure', async () => {
    const file = await KF.write(DATA, KEY);
    await assert.rejects(() => KF.read(file, OTHER), /different account/);
});

check('a tampered ciphertext does not decrypt', async () => {
    const file = await KF.write(DATA, KEY);
    const bytes = Buffer.from(file.ct, 'base64');
    bytes[5] ^= 0xff;
    file.ct = bytes.toString('base64');
    await assert.rejects(() => KF.read(file, KEY), /could not be opened/);
});

check('the version is authenticated: relabelling a v2 file does not open it', async () => {
    // AAD binds the ciphertext to "mp-keyring/2". Editing the number in the
    // JSON must not turn it into a different format's file.
    const file = await KF.write(DATA, KEY);
    file.version = 3;
    await assert.rejects(() => KF.read(file, KEY), /newer version/);
});

check('a v1 plaintext backup still imports, with no key at all', async () => {
    const v1 = { format: 'mp-keyring', version: 1, channels: DATA.channels };
    const back = await KF.read(v1);
    assert.deepStrictEqual(back.channels, DATA.channels);
});

check('a file that is not ours is refused', async () => {
    await assert.rejects(() => KF.read({ hello: 'world' }, KEY), /not a keyring backup/);
});

check('an encrypted file without a key says to sign in', async () => {
    const file = await KF.write(DATA, KEY);
    await assert.rejects(() => KF.read(file), /Sign in/);
});

check('a damaged file is reported as damaged', async () => {
    await assert.rejects(
        () => KF.read({ format: 'mp-keyring', version: 2, keyId: 'x' }, KEY), /damaged/);
});

check('a key of the wrong size is refused rather than silently padded', async () => {
    const short = Buffer.from('too short').toString('base64');
    await assert.rejects(() => KF.write(DATA, short), /256-bit/);
});

check('an empty list round-trips, so a first backup is not a special case', async () => {
    const file = await KF.write({ channels: [] }, KEY);
    assert.deepStrictEqual((await KF.read(file, KEY)).channels, []);
});

check('keyId matches the service\'s: 16 hex of SHA-256 over the base64 key', async () => {
    const expected = require('crypto').createHash('sha256')
        .update(KEY, 'utf8').digest('hex').slice(0, 16);
    assert.strictEqual(await KF.keyIdOf(KEY), expected);
});

(async () => {
    console.log('the backup file');
    for (const [name, fn] of checks) {
        try { await fn(); console.log('  ok   ' + name); }
        catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
    }
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
