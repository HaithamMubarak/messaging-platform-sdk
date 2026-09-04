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
const ACCOUNT = 'account-a';
const rawWrite = KF.write;
KF.write = (data, key, account) => rawWrite(data, key, account || ACCOUNT);

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
    assert.strictEqual(file.version, 3);
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

check('a v3 backup is bound to its Platform account even with the same key', async () => {
    const file = await KF.write(DATA, KEY);
    await assert.rejects(() => KF.read(file, KEY, 'account-b'), /different Platform account/);
    assert.deepStrictEqual((await KF.read(file, KEY, ACCOUNT)).channels, DATA.channels);
});

check('a tampered ciphertext does not decrypt', async () => {
    const file = await KF.write(DATA, KEY);
    const bytes = Buffer.from(file.ct, 'base64');
    bytes[5] ^= 0xff;
    file.ct = bytes.toString('base64');
    await assert.rejects(() => KF.read(file, KEY), /could not be opened/);
});

check('the version is authenticated: relabelling a v3 file does not open it', async () => {
    // AAD binds the ciphertext to "mp-keyring/3". Editing the number in the
    // JSON must not turn it into a different format's file.
    const file = await KF.write(DATA, KEY);
    file.version = 2;
    await assert.rejects(() => KF.read(file, KEY), /could not be opened/);
});

check('a v1 plaintext backup still imports, with no key at all', async () => {
    const v1 = { format: 'mp-keyring', version: 1, channels: DATA.channels };
    const back = await KF.read(v1);
    assert.deepStrictEqual(back.channels, DATA.channels);
});

/*
 * Relabelling DOWNWARDS was the hole. Editing 3 -> 2 is rejected by the
 * check above; editing 2 -> 1 took the plaintext branch, which reads
 * `file.channels` -- a field a v2 file does not have -- and so returned an
 * EMPTY list and reported success. The AAD binds the version inside the
 * ciphertext, but nothing encrypted is ever opened on that branch, so the AAD
 * cannot catch it and this is the only place it can be caught.
 *
 * A silent empty restore is worse than a failure: the person is told their
 * backup opened, and merges nothing.
 */
check('relabelling a v3 file as v1 is refused, not silently read as empty', async () => {
    const file = await KF.write(DATA, KEY);
    file.version = 1;
    await assert.rejects(() => KF.read(file, KEY), /has been edited/);
});

check('a v1 file with no channels array is damaged, not empty', async () => {
    await assert.rejects(
        () => KF.read({ format: 'mp-keyring', version: 1 }), /damaged/);
    await assert.rejects(
        () => KF.read({ format: 'mp-keyring', version: 1, channels: 'nope' }), /damaged/);
});

/*
 * The AAD reaching the crypto at all, asserted directly. Every other version
 * test is answered by a plain field comparison before a single byte is
 * decrypted, so all of them would still pass with `additionalData` deleted
 * from both calls.
 */
check('the AAD is really bound into the ciphertext', async () => {
    const { subtle } = require('crypto').webcrypto;
    const file = await KF.write(DATA, KEY);
    const key = await subtle.importKey('raw', Buffer.from(KEY, 'base64'),
        { name: 'AES-GCM' }, false, ['decrypt']);
    const args = [{ name: 'AES-GCM', iv: Buffer.from(file.iv, 'base64') }, key,
                  Buffer.from(file.ct, 'base64')];

    // The right AAD opens it...
    const plain = await subtle.decrypt(
        Object.assign({}, args[0], { additionalData: Buffer.from('mp-keyring/3', 'utf8') }),
        args[1], args[2]);
    assert.deepStrictEqual(JSON.parse(Buffer.from(plain).toString('utf8')).channels,
        DATA.channels);

    // ...and no other value does, including none at all.
    for (const aad of ['mp-keyring/1', 'mp-keyring/2', '']) {
        await assert.rejects(() => subtle.decrypt(
            Object.assign({}, args[0], { additionalData: Buffer.from(aad, 'utf8') }),
            args[1], args[2]), 'AAD "' + aad + '" should not have opened the file');
    }
    await assert.rejects(() => subtle.decrypt(args[0], args[1], args[2]),
        'the file opened with no AAD at all, so nothing is bound to the version');
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
