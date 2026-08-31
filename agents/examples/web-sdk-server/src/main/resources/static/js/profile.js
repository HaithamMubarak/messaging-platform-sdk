/**
 * The profile page: your account, your saved channels, and a way to carry
 * them to another browser.
 *
 * Nothing here talks to the platform about channels. The saved list is read
 * from and written to this browser, and the export is a file the browser
 * hands you -- it never passes through our origin, not even to be validated.
 */
(function (window, document) {
    'use strict';

    var A = window.MPAccount, K = window.Keyring;
    var accountId = null;
    var el = function (id) { return document.getElementById(id); };

    function show(signedIn) {
        el('signedIn').hidden = !signedIn;
        el('signedOut').hidden = !!signedIn;
    }

    function renderList() {
        var list = el('pList');
        var rows = accountId ? K.list(accountId) : [];
        list.innerHTML = '';
        el('pEmpty').hidden = rows.length > 0;

        rows.forEach(function (row) {
            var wrap = document.createElement('div');
            wrap.className = 'mp-row';

            var main = document.createElement('div');
            main.className = 'mp-row__main';
            var label = document.createElement('div');
            label.className = 'mp-row__label';
            label.textContent = row.label;            // user input: never innerHTML
            var name = document.createElement('div');
            name.className = 'mp-row__name';
            name.textContent = row.name;
            main.appendChild(label);
            main.appendChild(name);
            // Which apps used this room is derived from APP config, which
            // points at channels by id -- the channel row itself holds no app
            // state, so forgetting a channel cannot strand a name in it.
            var using = window.AppConfig ? window.AppConfig.appsUsing(accountId, row.id) : [];
            if (using.length) {
                var apps = document.createElement('div');
                apps.className = 'mp-row__apps';
                apps.textContent = using.join(' · ');
                main.appendChild(apps);
            }

            var actions = document.createElement('div');
            actions.className = 'mp-row__actions';

            var rename = document.createElement('button');
            rename.type = 'button';
            rename.className = 'btn btn--ghost btn--sm';
            rename.textContent = 'Rename';
            rename.addEventListener('click', function () {
                // Label only. The channel NAME is identity -- editing it here
                // would not rename a room, it would point at a different one.
                var next = window.prompt('Name this channel', row.label);
                if (next === null) return;
                K.rename(accountId, row.id, next.trim());
                renderList();
            });

            var forget = document.createElement('button');
            forget.type = 'button';
            forget.className = 'btn btn--ghost btn--sm';
            forget.textContent = 'Forget';
            forget.addEventListener('click', function () {
                if (!window.confirm('Forget "' + row.label + '"?\n\n' +
                    'The channel keeps existing — you just lose the saved password.')) return;
                K.remove(accountId, row.id);
                // Apps referenced it by id; drop those references rather than
                // leaving them pointing at a channel that no longer exists.
                if (window.AppConfig) window.AppConfig.forgetChannel(accountId, row.id);
                renderList();
            });

            actions.appendChild(rename);
            actions.appendChild(forget);
            wrap.appendChild(main);
            wrap.appendChild(actions);
            list.appendChild(wrap);
        });
    }

    function applyUser(user) {
        accountId = A.idOf(user);
        if (!accountId) { show(false); return; }
        el('pWho').textContent = (user.displayName || user.email) +
            (user.email && user.displayName ? ' · ' + user.email : '');
        show(true);
        renderList();
    }

    /* ---- sign in / create account ----
     * Two tabs over one set of fields, matching the Rooms gate and the
     * connection modal: this is the same account in all three places, so it
     * should not be three different-looking forms.
     */
    var registerMode = false;
    function setMode(register) {
        registerMode = register;
        el('pNameLabel').hidden = !register;
        el('pName').hidden = !register;
        el('pSubmit').textContent = register ? 'Create account' : 'Sign in';
        el('pForgot').hidden = register;
        el('pPassword').setAttribute('autocomplete', register ? 'new-password' : 'current-password');
        [['pModeSignin', !register], ['pModeRegister', register]].forEach(function (pair) {
            var t = el(pair[0]);
            t.classList.toggle('is-active', pair[1]);
            t.setAttribute('aria-selected', pair[1] ? 'true' : 'false');
        });
        el('pError').hidden = true;
        el('pOk').hidden = true;
    }
    el('pModeSignin').addEventListener('click', function () { setMode(false); });
    el('pModeRegister').addEventListener('click', function () { setMode(true); });

    el('pForgot').addEventListener('click', function () {
        var email = el('pEmail').value.trim();
        el('pError').hidden = true;
        if (!email) {
            el('pError').hidden = false;
            el('pError').textContent = 'Enter your email first.';
            return;
        }
        // Same answer either way: this must not become a way to ask which
        // addresses have accounts.
        A.forgot(email).catch(function () {});
        el('pOk').hidden = false;
        el('pOk').textContent = 'If that address has an account, a reset link is on its way.';
    });

    el('pSubmit').addEventListener('click', function () {
        var err = el('pError');
        err.hidden = true;
        var email = el('pEmail').value.trim();
        var pw = el('pPassword').value;
        var name = el('pName').value.trim();
        var fail = function (e) { err.hidden = false; err.textContent = e.message || 'That did not work.'; };
        var done = function (u) {
            applyUser(u);
            if (window.ProfileChip) window.ProfileChip.render(u);
        };
        if (registerMode) A.register(email, name || email, pw).then(done).catch(fail);
        else A.login(email, pw).then(done).catch(fail);
    });

    el('pSignOut').addEventListener('click', function () {
        A.logout().then(function () {
            accountId = null;
            show(false);
            if (window.ProfileChip) window.ProfileChip.render(null);
        });
    });

    A.googleAvailable().then(function (ok) {
        if (!ok) return;
        var b = el('pGoogle');
        b.hidden = false;
        el('pGoogleWrap').hidden = false;
        b.addEventListener('click', function () {
            window.location.href = A.googleStartUrl(window.location.href);
        });
    });

    /* ---- backup: a file, never an upload ---- */
    el('pExport').addEventListener('click', function () {
        var data = K.exportData(accountId);
        note('Encrypting…');
        A.exportKey().then(function (key) {
            if (!key) throw new Error('Sign in to export.');
            return window.KeyringFile.write(data, key);
        }).then(function (file) {
            var blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'mp-keyring.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            note(data.channels.length + ' channel(s) exported, encrypted with your account key. '
               + 'Sign in on another device to open it.');
        }).catch(function (e) { note(e.message || 'Export failed.'); });
    });

    el('pImport').addEventListener('click', function () { el('pFile').click(); });

    el('pFile').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            var parsed;
            try { parsed = JSON.parse(reader.result); }
            catch (err) { return note('That file is not a keyring export.'); }
            note('Opening…');
            // The key is only needed for an encrypted file; a v1 plaintext
            // backup opens without one, so ask for it but do not require it.
            A.exportKey().catch(function () { return null; }).then(function (key) {
                return window.KeyringFile.read(parsed, key);
            }).then(function (data) {
                // Merge, never replace: importing an older backup must not
                // undo channels saved since it was taken.
                var r = K.importData(accountId, data);
                renderList();
                note(r.added + ' added, ' + r.skipped + ' already here.');
            }).catch(function (e) { note(e.message || 'That file could not be opened.'); });
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    /* ---- Google Drive: the same encrypted file, in the user's own Drive ---- */
    function driveNote(text) {
        var n = el('pDriveNote');
        n.hidden = false;
        n.textContent = text;
    }

    function showDriveButtons(connected) {
        el('pDriveBackup').hidden = !connected;
        el('pDriveRestore').hidden = !connected;
        el('pDriveConnect').textContent = connected ? 'Reconnect Google Drive' : 'Connect Google Drive';
    }

    if (window.DriveBackup) {
        // Only offered when Google is actually configured here; a button that
        // opens a broken flow is worse than no button.
        A.googleAvailable().then(function (ok) {
            if (ok) el('pDriveCard').hidden = false;
        });

        el('pDriveConnect').addEventListener('click', function () {
            driveNote('Waiting for Google…');
            window.DriveBackup.connect().then(function () {
                showDriveButtons(true);
                driveNote('Connected. Your backup can now be kept in your Drive.');
            }).catch(function (e) { driveNote(e.message); });
        });

        el('pDriveBackup').addEventListener('click', function () {
            driveNote('Encrypting and uploading…');
            var data = K.exportData(accountId);
            A.exportKey().then(function (key) {
                if (!key) throw new Error('Sign in to back up.');
                return window.KeyringFile.write(data, key);
            }).then(function (file) {
                return window.DriveBackup.put(file);
            }).then(function () {
                driveNote(data.channels.length + ' channel(s) backed up to your Drive, encrypted.');
            }).catch(function (e) { driveNote(e.message); });
        });

        el('pDriveRestore').addEventListener('click', function () {
            driveNote('Fetching from Drive…');
            Promise.all([window.DriveBackup.get(), A.exportKey()]).then(function (both) {
                if (!both[0]) { driveNote('There is no backup in your Drive yet.'); return null; }
                return window.KeyringFile.read(both[0], both[1]);
            }).then(function (data) {
                if (!data) return;
                // Merge, never last-write-wins: two devices each holding rows
                // the other lacks must end up with both, not with whichever
                // wrote most recently.
                var r = K.importData(accountId, data);
                renderList();
                driveNote(r.added + ' restored, ' + r.skipped + ' already here.');
            }).catch(function (e) { driveNote(e.message); });
        });
    }

    function note(text) {
        var n = el('pBackupNote');
        n.hidden = false;
        n.textContent = text;
    }

    /* ---- boot ---- */
    if (window.location.hash === '#signin') show(false);
    A.me().then(applyUser).catch(function () { show(false); });
})(window, document);
