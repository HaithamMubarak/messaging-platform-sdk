/**
 * Taking the backup key back.
 *
 * Rule 3 is custody, not incapability: the export key is held on the user's
 * behalf. `DELETE /api/export-key` and `MPAccount.destroyExportKey()` were both
 * written and correct, and nothing ever called either — so the remedy for a
 * leaked backup file existed only for somebody holding curl. That makes the
 * custody story a half-promise, which is exactly what Rule 3 forbids.
 *
 * Two things have to hold:
 *   1. it cannot fire by accident — no click, no stray Enter, nothing but the
 *      word typed out;
 *   2. it has to actually work — a file written under the old key must stop
 *      opening, and say WHY rather than reporting a damaged file.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const KF = require(path.join(STATIC, 'js', 'keyring-file.js'));

/* ------------------------------------------------------ the confirmation */

/** A DOM just big enough for dialog.js. */
function fakeDom() {
    const listeners = {};
    const mk = (tag) => {
        const el = {
            tagName: String(tag).toUpperCase(), children: [], style: {}, attrs: {},
            className: '', textContent: '', value: '', type: '', disabled: false,
            focused: false, _on: {},
            appendChild(c) { this.children.push(c); c.parent = this; return c; },
            setAttribute(k, v) { this.attrs[k] = String(v); },
            getAttribute(k) { return this.attrs[k]; },
            addEventListener(ev, fn) { (this._on[ev] = this._on[ev] || []).push(fn); },
            removeEventListener() {},
            remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); },
            focus() { doc.activeElement = this; },
            select() {},
            querySelectorAll() { return []; },
            fire(ev) { (this._on[ev] || []).forEach((fn) => fn({})); },
        };
        return el;
    };
    const doc = {
        activeElement: null,
        head: mk('head'),
        body: mk('body'),
        createElement: mk,
        addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        removeEventListener() {},
        getElementById: () => null,
        key(k) { (listeners.keydown || []).forEach((fn) => fn({ key: k, preventDefault() {} })); },
    };
    return doc;
}

function loadDialog() {
    const src = fs.readFileSync(path.join(STATIC, 'js', 'dialog.js'), 'utf8');
    const doc = fakeDom();
    const win = { document: doc };
    new Function('window', 'document', src)(win, doc);
    return { AppDialog: win.AppDialog, doc };
}

/** Find the pieces of the open dialog. */
function parts(doc) {
    const scrim = doc.body.children[doc.body.children.length - 1];
    const card = scrim.children[0];
    const flat = [];
    (function walk(n) { n.children.forEach((c) => { flat.push(c); walk(c); }); })(card);
    return {
        field: flat.find((e) => e.tagName === 'INPUT'),
        buttons: flat.filter((e) => e.tagName === 'BUTTON'),
    };
}

const checks = [];
const check = (n, f) => checks.push([n, f]);
let failures = 0;

check('the destroy button does nothing until the word is typed', async () => {
    const { AppDialog, doc } = loadDialog();
    const answer = AppDialog.ask({
        title: 'Destroy your backup key?', body: 'x',
        confirmWord: 'destroy', confirmLabel: 'Destroy key', danger: true,
    });
    const { field, buttons } = parts(doc);
    const go = buttons[buttons.length - 1];

    assert.strictEqual(go.disabled, true,
        'the destroy button was live before anything was typed');

    field.value = 'destro';                 // nearly
    field.fire('input');
    assert.strictEqual(go.disabled, true, 'a partial word armed the button');
    go.onclick();                            // and clicking does nothing
    field.value = 'DESTROY';                 // wrong case
    field.fire('input');
    assert.strictEqual(go.disabled, true, 'the wrong case armed the button');

    field.value = 'destroy';
    field.fire('input');
    assert.strictEqual(go.disabled, false, 'the exact word did not arm the button');
    go.onclick();
    assert.strictEqual(await answer, 'destroy');
});

check('a reflex Enter cancels rather than destroys', async () => {
    const { AppDialog, doc } = loadDialog();
    const answer = AppDialog.ask({
        title: 't', body: 'x', confirmWord: 'destroy', danger: true,
    });
    const { buttons } = parts(doc);
    assert.strictEqual(doc.activeElement, buttons[0],
        'the dialog opened with focus on the destructive button, not on Cancel');

    doc.key('Enter');                        // nothing typed yet
    doc.key('Escape');
    assert.strictEqual(await answer, null, 'Enter fired the destructive action');
});

check('the caller refuses anything but the exact word', () => {
    // The dialog gates the button; the caller must not then accept whatever
    // string comes back. Both locks, because either alone is one edit from open.
    const src = fs.readFileSync(path.join(STATIC, 'js', 'profile.js'), 'utf8');
    assert.ok(/confirmWord: 'destroy'/.test(src), 'the dialog is no longer word-gated');
    assert.ok(/if \(typed !== 'destroy'\) return;/.test(src),
        'profile.js acts on the dialog result without checking the word');
    const destroyAt = src.indexOf('destroyExportKey');
    const guardAt = src.indexOf("if (typed !== 'destroy') return;");
    assert.ok(guardAt > 0 && guardAt < destroyAt,
        'the key is destroyed before the typed word is checked');
});

/* --------------------------------------------------- and it really works */

check('a backup made under the old key stops opening, and says why', async () => {
    const K1 = Buffer.alloc(32, 1).toString('base64');
    const K2 = Buffer.alloc(32, 2).toString('base64');   // what the next GET mints
    const data = { channels: [{ id: 'k1', label: 'Standup', name: 'room', password: 'pw' }] };

    const file = await KF.write(data, K1);
    assert.deepStrictEqual((await KF.read(file, K1)).channels, data.channels,
        'the backup did not open under its own key');

    // The key is destroyed; the account mints a fresh one on next ask.
    await assert.rejects(() => KF.read(file, K2), (e) => {
        assert.ok(/key was destroyed|different account/.test(e.message),
            'restoring under a new key reported "' + e.message + '" -- a person '
          + 'needs to be told the key is gone, not that their file is damaged');
        assert.ok(!/damaged/.test(e.message),
            'a file made under a destroyed key was called damaged; it is intact '
          + 'and simply unopenable, which is a different thing to tell somebody');
        return true;
    });
});

check('and a backup made AFTER the destruction opens normally', async () => {
    const K2 = Buffer.alloc(32, 2).toString('base64');
    const data = { channels: [{ id: 'k2', label: 'New', name: 'room2', password: 'pw2' }] };
    const fresh = await KF.write(data, K2);
    assert.deepStrictEqual((await KF.read(fresh, K2)).channels, data.channels,
        'a backup taken after destroying the key could not be restored, which '
      + 'would make the whole feature a one-way door');
});

check('the Drive file is the user\'s own and is not deleted for them', () => {
    const src = fs.readFileSync(path.join(STATIC, 'js', 'profile.js'), 'utf8');
    const start = src.indexOf("el('pDestroyKey')");
    const body = src.slice(start, src.indexOf('/* ---- Google Drive', start));
    assert.ok(!/DriveBackup\.remove/.test(body),
        'destroying the key also deleted the file out of the user\'s own Drive. '
      + 'It is theirs; after this it is unreadable bytes, and removing it is '
      + 'their decision.');
});

(async () => {
    console.log('destroying the backup key');
    for (const [name, fn] of checks) {
        try { await fn(); console.log('  ok   ' + name); }
        catch (e) { failures++; console.log('  FAIL ' + name + ' -- ' + e.message); }
    }
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
