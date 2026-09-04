/**
 * The Google Drive backup, as far as it can be driven without a human.
 *
 * The handoff called this round trip UNVERIFIED, and one part of it genuinely
 * cannot be automated: completing Google's consent screen needs a person with a
 * real account. Everything on THIS side of consent can be, and was not --
 * drive-backup.js had no test of any kind, and google-return.test.js would pass
 * unchanged if the file were deleted.
 *
 * So: a fake Drive. The token exchange is stubbed at the one call that needs a
 * human; every other byte is the real module talking to a real appDataFolder
 * shaped like Google's, and the file it stores is opened again by the real
 * KeyringFile. That proves the thing the manual test was actually for -- that
 * what goes up comes back down and decrypts -- and leaves only the consent
 * click unproven.
 *
 * The specific failures this pins were all live:
 *   - find() did not exclude trashed files, so a deleted backup was still
 *     found, and `put` PATCHed the copy in the bin.
 *   - find() took files[0] of an unordered list, so with two files in the
 *     folder a restore could return the older one.
 *   - a blocked GIS script poisoned the module for the life of the page.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const KF = require(path.join(STATIC, 'js', 'keyring-file.js'));
const rawWrite = KF.write;
KF.write = (data, key, account) => rawWrite(data, key, account || 'drive-test-account');

const KEY = Buffer.alloc(32, 7).toString('base64');
const DATA = { channels: [
    { id: 'k_1', label: 'Standup', name: 'room-standup', password: 'pw-1',
      createdAt: 1, lastUsedAt: 2 },
] };

/**
 * A Drive that behaves like the real appDataFolder: files have ids, names,
 * modifiedTime and a trashed flag, and list() honours the q and orderBy the
 * module sends.
 */
function fakeDrive() {
    const files = [];
    let seq = 0, clock = 1000;

    function list(url) {
        const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [])[1] || '');
        const orderBy = decodeURIComponent((url.match(/[?&]orderBy=([^&]*)/) || [])[1] || '');
        const name = (q.match(/name='([^']*)'/) || [])[1];
        const wantsUntrashed = /trashed\s*=\s*false/.test(q);

        let out = files.filter((f) => f.name === name);
        if (wantsUntrashed) out = out.filter((f) => !f.trashed);
        if (/modifiedTime desc/.test(orderBy)) {
            out = out.slice().sort((a, b) => b.modifiedTime - a.modifiedTime);
        } else {
            // Google gives no ordering guarantee without orderBy. Return the
            // WORST plausible order, so a module that relies on luck fails here
            // rather than in somebody's Drive.
            out = out.slice().sort((a, b) => a.modifiedTime - b.modifiedTime);
        }
        return { files: out.map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })) };
    }

    function bodyOfMultipart(text) {
        // The module sends metadata then content, each after a blank line.
        const parts = String(text).split(/--mpk\d+/).filter((p) => /\{/.test(p));
        const content = parts[parts.length - 1];
        return JSON.parse(content.slice(content.indexOf('\r\n\r\n') + 4).trim());
    }

    const drive = {
        files,
        add(name, content, { trashed = false } = {}) {
            const f = { id: 'id-' + (++seq), name, content, trashed, modifiedTime: ++clock };
            files.push(f);
            return f;
        },
        calls: [],
        fetch(url, opts) {
            opts = opts || {};
            drive.calls.push({ url: url, method: opts.method || 'GET' });
            const json = (v) => Promise.resolve({
                ok: true, status: 200,
                json: () => Promise.resolve(v),
                text: () => Promise.resolve(JSON.stringify(v)),
            });

            // The upload host is /upload/drive/v3/files..., which also contains
            // "/drive/v3/files?" -- so these must be matched BEFORE the list.
            let m = url.match(/\/upload\/drive\/v3\/files\/([^?]+)\?/);
            if (m) {                                  // PATCH an existing file
                const f = files.find((x) => x.id === m[1]);
                f.content = bodyOfMultipart(opts.body);
                f.modifiedTime = ++clock;
                return json({ id: f.id });
            }
            if (/\/upload\/drive\/v3\/files\?/.test(url)) {   // POST a new one
                const f = drive.add('mp.keyring.v1.json.enc', bodyOfMultipart(opts.body));
                return json({ id: f.id });
            }

            if (/\/drive\/v3\/files\?/.test(url)) return json(list(url));

            m = url.match(/\/drive\/v3\/files\/([^?]+)\?alt=media/);
            if (m) {
                const f = files.find((x) => x.id === m[1]);
                return json(f ? f.content : null);
            }
            m = url.match(/\/drive\/v3\/files\/([^?]+)$/);
            if (m && opts.method === 'DELETE') {
                const i = files.findIndex((x) => x.id === m[1]);
                files.splice(i, 1);
                return json({});
            }
            return Promise.reject(new Error('fake Drive got an unexpected call: ' + url));
        },
    };
    return drive;
}

/** Load drive-backup.js with Google's consent step stubbed and nothing else. */
function loadDrive({ drive = fakeDrive(), gis = 'ok', grant = 'ok' } = {}) {
    const source = fs.readFileSync(path.join(STATIC, 'js', 'drive-backup.js'), 'utf8');
    const head = { appended: [] };

    const win = {
        location: { hostname: 'hmdevonline.com' },
        document: {
            head: { appendChild: (s) => { head.appended.push(s); scriptLoads(s); } },
            createElement: () => ({}),
        },
        fetch: (url, opts) => {
            // The client id comes from rooms-service, not from Google.
            if (/auth\/google\/status/.test(url)) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({
                    configured: true, clientId: 'test-client-id.apps.googleusercontent.com' }) });
            }
            return drive.fetch(url, opts);
        },
    };
    win.document.createElement = () => {
        const s = {};
        Object.defineProperty(s, 'src', {
            set() { setTimeout(() => scriptLoads(s), 0); },
            get() { return ''; },
        });
        return s;
    };
    function scriptLoads(s) {
        if (gis === 'blocked') { if (s.onerror) s.onerror(); return; }
        if (gis === 'empty') { if (s.onload) s.onload(); return; }   // 200, no globals
        win.google = { accounts: { oauth2: { initTokenClient: (cfg) => ({
            requestAccessToken: () => {
                // THE ONE STEP A HUMAN DOES. Everything else here is real.
                if (grant === 'denied') return cfg.error_callback({ type: 'access_denied' });
                cfg.callback({ access_token: 'ya29.fake-token' });
            },
        }) } } };
        if (s.onload) s.onload();
    }

    new Function('window', 'document', 'fetch', 'setTimeout', source)(
        win, win.document, win.fetch, setTimeout);
    return { DB: win.DriveBackup, drive, win, head };
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
let failures = 0;

check('a keyring goes up encrypted and comes back down readable', async () => {
    const { DB, drive } = loadDrive();
    await DB.connect();

    const written = await KF.write(DATA, KEY);
    await DB.put(written);

    // What is sitting in "Drive" must be ciphertext, not the channel list.
    const stored = drive.files[0].content;
    const raw = JSON.stringify(stored);
    assert.ok(!raw.includes('pw-1'), 'the channel password went to Drive in the clear');
    assert.ok(!raw.includes('room-standup'), 'the room name went to Drive in the clear');
    assert.strictEqual(stored.format, 'mp-keyring');
    assert.strictEqual(stored.version, 3);

    const back = await KF.read(await DB.get(), KEY);
    assert.deepStrictEqual(back.channels, DATA.channels,
        'what came back from Drive is not what went up');
});

check('a second backup replaces the file rather than making another', async () => {
    const { DB, drive } = loadDrive();
    await DB.connect();
    await DB.put(await KF.write(DATA, KEY));
    await DB.put(await KF.write({ channels: [] }, KEY));
    assert.strictEqual(drive.files.length, 1,
        'backing up twice left two files in appDataFolder');
});

check('a backup the user deleted is not found, and not written over', async () => {
    const { DB, drive } = loadDrive();
    await DB.connect();
    drive.add('mp.keyring.v1.json.enc', { format: 'mp-keyring', version: 2, ct: 'old' },
              { trashed: true });

    assert.strictEqual(await DB.get(), null,
        'a trashed backup was restored as though it were live');

    await DB.put(await KF.write(DATA, KEY));
    assert.strictEqual(drive.files.filter((f) => !f.trashed).length, 1,
        'the new backup did not become a live file');
    assert.ok(drive.files.find((f) => f.trashed).content.ct === 'old',
        'the backup in the bin was overwritten instead of being left alone');
});

check('with two files in the folder, the NEWEST is the one restored', async () => {
    const { DB, drive } = loadDrive();
    await DB.connect();
    // An interrupted first upload is enough to produce this.
    const older = await KF.write({ channels: [] }, KEY);
    const newer = await KF.write(DATA, KEY);
    drive.add('mp.keyring.v1.json.enc', older);
    drive.add('mp.keyring.v1.json.enc', newer);

    const back = await KF.read(await DB.get(), KEY);
    assert.deepStrictEqual(back.channels, DATA.channels,
        'restore picked an older backup than the one last written');
});

check('a blocked Google script does not poison Drive for the rest of the page', async () => {
    const { DB, head } = loadDrive({ gis: 'blocked' });
    await assert.rejects(() => DB.connect(), /could not be loaded/);
    const afterFirst = head.appended.length;

    // The same module, asked again. Asserting that it rejects again proves
    // nothing -- a CACHED rejection rejects too, with the same message. What
    // has to be true is that it genuinely tried again: a new script element.
    await assert.rejects(() => DB.connect(), /could not be loaded/);
    assert.ok(head.appended.length > afterFirst,
        'the second attempt reused the first failure instead of retrying, so one '
      + 'blocked load leaves Drive broken until the page is reloaded');
});

check('a script that loads but brings nothing says so, instead of a TypeError', async () => {
    const { DB } = loadDrive({ gis: 'empty' });
    await assert.rejects(() => DB.connect(), /did not start|could not be loaded/,
        'a blocked GIS surfaced a raw TypeError as product copy');
});

check('declining consent is reported as declining, not as a crash', async () => {
    const { DB } = loadDrive({ grant: 'denied' });
    await assert.rejects(() => DB.connect(), /declined/);
});

check('nothing is asked of Drive before a token exists', async () => {
    const { DB, drive } = loadDrive({ grant: 'denied' });
    await DB.connect().catch(() => {});
    assert.deepStrictEqual(drive.calls, [],
        'the module called Drive without a token: ' + JSON.stringify(drive.calls));
});

check('disconnect drops the token, so the next call must ask again', async () => {
    const { DB } = loadDrive();
    await DB.connect();
    assert.strictEqual(DB.connected(), true);
    DB.disconnect();
    assert.strictEqual(DB.connected(), false,
        'disconnect left the Drive credential in memory');
});

(async () => {
    console.log('the Drive backup, short of the consent click');
    for (const [name, fn] of checks) {
        try { await fn(); console.log('  ok   ' + name); }
        catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
    }
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
