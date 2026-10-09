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
    var profileUser = null;
    var developerIdentityVerified = false;
    var verifiedAccessEmail = null;
    var busy = {};
    var el = function (id) { return document.getElementById(id); };

    function channelKey(row) {
        return JSON.stringify([row && typeof row.name === 'string' ? row.name : '', row && row.password ? row.password : '']);
    }

    function compareChannelLists(localRows, driveRows) {
        var localBuckets = {};
        (localRows || []).forEach(function (row) {
            if (!row || typeof row.name !== 'string') return;
            var key = channelKey(row);
            localBuckets[key] = (localBuckets[key] || 0) + 1;
        });

        var localOnly = 0;
        var remoteOnly = 0;
        var invalid = 0;
        var matched = 0;

        (driveRows || []).forEach(function (row) {
            if (!row || typeof row.name !== 'string') {
                invalid++;
                return;
            }
            var key = channelKey(row);
            if ((localBuckets[key] || 0) > 0) {
                localBuckets[key] -= 1;
                matched++;
            } else {
                remoteOnly++;
            }
        });

        Object.keys(localBuckets).forEach(function (key) {
            if (localBuckets[key] > 0) localOnly += localBuckets[key];
        });

        return {
            localCount: (localRows && localRows.length) || 0,
            remoteCount: (driveRows || []).length,
            matched: matched,
            localOnly: localOnly,
            remoteOnly: remoteOnly,
            invalid: invalid
        };
    }

    function withCurrentAccount(work) {
        return A.me(true).then(function (user) {
            var current = A.idOf(user);
            if (!current || current !== accountId) {
                applyUser(user);
                throw new Error('Your HMDev account changed. Please try that action again.');
            }
            return work(current);
        });
    }

    function singleFlight(name, buttonIds, work) {
        if (busy[name]) return Promise.resolve(null);
        busy[name] = true;
        (buttonIds || []).forEach(function (id) { if (el(id)) el(id).disabled = true; });
        return Promise.resolve().then(work).finally(function () {
            busy[name] = false;
            (buttonIds || []).forEach(function (id) { if (el(id)) el(id).disabled = false; });
        });
    }

    function show(signedIn) {
        el('signedIn').hidden = !signedIn;
        el('signedOut').hidden = !!signedIn;
        if (!signedIn) {
            setDeveloperNav('Request API access', 'hub/developer/index.html');
        }
    }

    function developerCall(path, payload) {
        return fetch('/messaging-platform/api/v1/developer/account-link' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
                if (!response.ok || !body || body.status === 'error' || body.status === 'unauthorized') {
                    var error = new Error(body.statusMessage || body.error || 'Developer access could not be checked.');
                    error.status = response.status;
                    throw error;
                }
                return body.data || body;
            });
        });
    }

    function setAccessBadge(label, state) {
        var badge = el('pDeveloperStatus');
        badge.textContent = label;
        if (state) badge.dataset.state = state;
        else delete badge.dataset.state;
    }

    function resetDeveloperActions() {
        el('pDeveloperRequest').hidden = true;
        el('pDeveloperOpen').hidden = true;
        el('pDeveloperMeta').hidden = true;
        el('pAdminAccess').hidden = true;
        el('pDeveloperNote').textContent = '';
    }

    /** The header's call to action speaks to this visitor. Since the one site shell (2026-10-03) it is the shell's
     *  .site-nav__cta; the old page-own #developerNavAction is still honoured if a page has one. */
    function setDeveloperNav(label, href) {
        var nav = el('developerNavAction') || document.querySelector('.site-nav__cta');
        if (!nav) return;
        nav.textContent = label;
        nav.href = href;
    }

    function renderDeveloperState(state) {
        resetDeveloperActions();
        var status = state && state.status ? state.status : 'NONE';
        if (state && state.adminAccess) {
            el('pAdminIdentity').textContent = state.developerEmail || state.verifiedEmail || 'Active administrator';
            el('pAdminAccess').hidden = false;
        }

        if (status === 'ACTIVE' && state.hasAccess) {
            setAccessBadge('Active', 'active');
            el('pDeveloperBody').textContent = 'Your verified HMDev account has developer access. Profile and developer details now live together here.';
            el('pDeveloperName').textContent = state.developerName || 'Developer';
            el('pDeveloperEmail').textContent = state.developerEmail || state.verifiedEmail || '';
            el('pDeveloperPlan').textContent = state.plan || 'Free';
            el('pDeveloperMeta').hidden = false;
            el('pDeveloperOpen').hidden = false;
            setDeveloperNav('Open Developer Portal', 'hub/developer/index.html');
            return;
        }

        if (status === 'PENDING') {
            setAccessBadge('Pending review', 'pending');
            el('pDeveloperBody').textContent = 'Your API access request is with the platform team. This profile will unlock developer details as soon as it is approved.';
            el('pDeveloperNote').textContent = 'No duplicate request is needed.';
            setDeveloperNav('API request pending', '#pDeveloperCard');
            return;
        }

        if (status === 'INACTIVE') {
            setAccessBadge('Inactive');
            el('pDeveloperBody').textContent = 'Developer access exists for this identity but is currently inactive. Contact platform support to restore it.';
            setDeveloperNav('Developer access inactive', '#pDeveloperCard');
            return;
        }

        setAccessBadge('Not requested');
        el('pDeveloperBody').textContent = 'Request developer access with this verified identity. Approval creates your developer workspace and initial API key.';
        el('pDeveloperRequest').hidden = false;
        setDeveloperNav('Request API access', '#pDeveloperCard');
    }

    function renderDeveloperUnverified(message) {
        developerIdentityVerified = false;
        verifiedAccessEmail = null;
        resetDeveloperActions();
        setAccessBadge('Identity check');
        el('pDeveloperBody').textContent = 'Request access or check an existing developer account using the same Google-verified identity.';
        el('pDeveloperRequest').hidden = false;
        el('pDeveloperNote').textContent = message || 'Google verification is required before developer status can be shown.';
        setDeveloperNav('Request API access', '#pDeveloperCard');
    }

    function requestDeveloperAccess(user) {
        if (!user || !user.email || typeof window.openApiKeyRequest !== 'function') {
            el('pDeveloperNote').textContent = 'The developer request form is temporarily unavailable.';
            return;
        }
        window.openApiKeyRequest({
            email: verifiedAccessEmail || user.email,
            name: user.displayName || '',
            lockEmail: true,
            submit: function (request) {
                return A.googleLoginAssertion().then(function (assertion) {
                    return developerCall('/platform-access/request', {
                        assertion: assertion,
                        name: request.name,
                        company: request.company,
                        reason: request.reason
                    });
                });
            },
            onSuccess: function (state) {
                developerIdentityVerified = true;
                renderDeveloperState(state || { status: 'PENDING', hasAccess: false });
                el('pDeveloperNote').textContent =
                    (state && state.message) || 'Your API access request is pending review.';
            }
        });
    }

    function loadDeveloperAccess(user) {
        profileUser = user;
        resetDeveloperActions();
        setAccessBadge('Checking');
        el('pDeveloperBody').textContent = 'Checking whether this verified identity has developer access...';

        A.googleLoginAssertion().then(function (assertion) {
            return developerCall('/platform-access', { assertion: assertion });
        }).then(function (state) {
            developerIdentityVerified = true;
            verifiedAccessEmail = state.verifiedEmail || user.email;
            renderDeveloperState(state);
            var requestAfterGoogle = false;
            try {
                requestAfterGoogle = sessionStorage.getItem('mp.developerRequestAfterGoogle') === '1';
                sessionStorage.removeItem('mp.developerRequestAfterGoogle');
            } catch (ignore) {}
            if (requestAfterGoogle && state.status === 'NONE') requestDeveloperAccess(user);

            var url = new URL(window.location.href);
            if (url.searchParams.has('developer')) {
                url.searchParams.delete('developer');
                history.replaceState(null, '', url.pathname + url.search);
            }
        }).catch(function (error) {
            renderDeveloperUnverified(error.message);
        });
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
            if (row.username) {
                var identity = document.createElement('div');
                identity.className = 'mp-row__name';
                identity.textContent = 'Join as ' + row.username;
                main.appendChild(identity);
            }
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

            var editIdentity = document.createElement('button');
            editIdentity.type = 'button';
            editIdentity.className = 'btn btn--ghost btn--sm';
            editIdentity.textContent = 'Edit join name';
            editIdentity.addEventListener('click', function () {
                var next = window.prompt('Name to use in this channel', row.username || '');
                if (next === null) return;
                K.setUsername(accountId, row.id, next);
                renderList();
            });

            var resetIdentity = document.createElement('button');
            resetIdentity.type = 'button';
            resetIdentity.className = 'btn btn--ghost btn--sm';
            resetIdentity.textContent = 'Use account name';
            resetIdentity.hidden = !row.username;
            resetIdentity.addEventListener('click', function () {
                K.setUsername(accountId, row.id, '');
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
            actions.appendChild(editIdentity);
            actions.appendChild(resetIdentity);
            actions.appendChild(forget);
            wrap.appendChild(main);
            wrap.appendChild(actions);
            list.appendChild(wrap);
        });
    }

    /* ---- how you sign in ----
     * /me says `google` and `hasPassword`. A service too old to say leaves
     * the card hidden rather than guessing at an account's methods.
     */
    function methodsOf(user) {
        if (!user || (typeof user.google !== 'boolean' && typeof user.hasPassword !== 'boolean')) return null;
        var methods = [];
        if (user.google) methods.push('Google');
        if (user.hasPassword) methods.push('Email and password');
        return methods;
    }

    function renderSignInMethods(user) {
        var methods = methodsOf(user);
        el('pMethodsCard').hidden = !methods;
        if (!methods) return;
        var list = el('pMethods');
        list.innerHTML = '';
        (methods.length ? methods : ['None on record']).forEach(function (name) {
            var item = document.createElement('li');
            item.textContent = name;
            list.appendChild(item);
        });
        // A Google account with no password cannot sign in to a client that
        // only takes a password (a game's sign-in screen); offer one.
        el('pSetPassword').hidden = !(user.google && !user.hasPassword);
    }

    function loadSignInMethods(user) {
        if (methodsOf(user)) { renderSignInMethods(user); return; }
        // Possibly a /me cached before the service reported methods: ask once.
        el('pMethodsCard').hidden = true;
        A.me(true).then(function (fresh) {
            if (fresh && A.idOf(fresh) === accountId) renderSignInMethods(fresh);
        }).catch(function () {});
    }

    function setPasswordMessage(id, text) {
        ['pSetPasswordError', 'pSetPasswordOk'].forEach(function (other) { el(other).hidden = true; });
        if (!text) return;
        el(id).hidden = false;
        el(id).textContent = text;
    }

    function submitNewPassword() {
        var pw = el('pNewPassword').value;
        setPasswordMessage(null, null);
        if (pw.length < 8) return setPasswordMessage('pSetPasswordError', 'Use at least 8 characters.');
        if (pw !== el('pNewPassword2').value) {
            return setPasswordMessage('pSetPasswordError', 'The two passwords do not match.');
        }
        singleFlight('setPassword', ['pSetPasswordBtn'], function () {
            return A.setPassword(pw).then(function (user) {
                el('pNewPassword').value = '';
                el('pNewPassword2').value = '';
                if (user) renderSignInMethods(user);
                setPasswordMessage('pSetPasswordOk',
                    'Password set. You can now sign in with your email and this password, or with Google.');
            }).catch(function (e) {
                if (e && e.status === 409) {
                    // The page was out of date: show what the account really has.
                    A.me(true).then(function (u) { if (u) renderSignInMethods(u); }).catch(function () {});
                    return setPasswordMessage('pSetPasswordError', 'This account already has a password. '
                        + 'To change it, sign out and use “Forgotten your password?”.');
                }
                setPasswordMessage('pSetPasswordError', (e && e.message) || 'The password could not be set.');
            });
        });
    }

    function applyUser(user) {
        var previousAccount = accountId;
        if (previousAccount && K.clearAccountKey) {
            K.clearAccountKey(previousAccount);
        }
        accountId = A.idOf(user);
        if (previousAccount && previousAccount !== accountId && window.DriveBackup) {
            window.DriveBackup.disconnect();
        }
        if (!accountId) { show(false); return; }
        var render = function () {
            if (accountId !== A.idOf(user)) return;
            el('pWho').textContent = (user.displayName || user.email) +
            (user.email && user.displayName ? ' · ' + user.email : '');
            show(true);
            renderList();
            loadSignInMethods(user);
            loadDeveloperAccess(user);
        };

        if (!K.setAccountKey || !K.ensureEncrypted || !A.exportKey) {
            render();
            return;
        }
        A.exportKey().then(function (key) {
            if (!accountId || accountId !== A.idOf(user)) return;
            if (key) {
                K.setAccountKey(accountId, key);
                K.ensureEncrypted(accountId);
            } else {
                K.clearAccountKey(accountId);
            }
            render();
        }).catch(function () {
            if (accountId === A.idOf(user) && K.clearAccountKey) {
                K.clearAccountKey(accountId);
            }
            render();
        });
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
        A.forgot(email).then(function (result) {
            el('pOk').hidden = false;
            el('pOk').textContent = result && result.emailDelivers
                ? 'If that address has an account, a reset link is on its way.'
                : 'If that address has an account, a reset link was created. Email delivery is not configured here.';
        }).catch(function () {
            // Keep the non-enumerating response even when a transient request
            // failure prevents us from learning whether delivery is enabled.
            el('pOk').hidden = false;
            el('pOk').textContent = 'If that address has an account, a reset link was created.';
        });
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
        var leaving = accountId;
        A.logout().then(function () {
            accountId = null;
            // The Drive token is a live credential to somebody's own Google
            // Drive, held in memory for the page's lifetime. Signing out and
            // handing the laptop over used to leave it there, so the next
            // person's "Back up now" wrote THEIR channels into the previous
            // person's Drive. The saved list itself is deliberately NOT
            // cleared: it is the only copy there is, and losing it on a
            // routine sign-out would be worse than anything this prevents.
            if (window.DriveBackup) window.DriveBackup.disconnect();
            if (window.ActiveChannel) window.ActiveChannel.clear(leaving);
            showDriveButtons(false);
            el('pDriveNote').hidden = true;
            el('pDriveVerifyNote').hidden = true;
            show(false);
            if (window.ProfileChip) window.ProfileChip.render(null);
        });
    });

    el('pSwitchAccount').addEventListener('click', function () {
        var returnTo = window.location.pathname;
        var developerToken = sessionStorage.getItem('developer_token');
        var adminToken = sessionStorage.getItem('admin_token');
        var revocations = [];
        if (developerToken) {
            revocations.push(fetch('/messaging-platform/api/v1/developer/auth/logout', {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + developerToken }, keepalive: true
            }).catch(function () {}));
        }
        if (adminToken) {
            revocations.push(fetch('/messaging-platform/api/v1/messaging-service/admin/logout', {
                method: 'POST', headers: { 'X-Admin-Token': adminToken }, keepalive: true
            }).catch(function () {}));
        }
        if (window.DriveBackup) window.DriveBackup.disconnect();
        revocations.push(A.logout().catch(function () {}));
        Promise.all(revocations).then(function () {
            ['developer_token', 'developer_email', 'admin_token', 'admin_info', 'verify_api_key'].forEach(function (key) {
                sessionStorage.removeItem(key);
                localStorage.removeItem(key);
            });
            window.location.href = A.googleStartUrl(returnTo);
        });
    });

    el('pDeveloperRequest').addEventListener('click', function () {
        if (developerIdentityVerified) {
            requestDeveloperAccess(profileUser);
            return;
        }
        try { sessionStorage.setItem('mp.developerRequestAfterGoogle', '1'); } catch (ignore) {}
        window.location.href = A.googleStartUrl(window.location.pathname + '?developer=1');
    });

    A.googleAvailable().then(function (ok) {
        if (!ok) return;
        el('pSwitchAccount').hidden = false;
        var b = el('pGoogle');
        b.hidden = false;
        el('pGoogleWrap').hidden = false;
        b.addEventListener('click', function () {
            window.location.href = A.googleStartUrl();
        });
    });

    /* ---- backup: a file, never an upload ---- */
    el('pExport').addEventListener('click', function () {
        singleFlight('export', ['pExport'], function () { return withCurrentAccount(function (id) {
        var data = K.exportData(id);
        note('Encrypting…');
        return A.exportKey().then(function (key) {
            if (!key) throw new Error('Sign in to export.');
            return window.KeyringFile.write(data, key, id);
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
        }); });
    });

    el('pImport').addEventListener('click', function () { el('pFile').click(); });

    el('pFile').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 1024 * 1024) {
            note('That backup is too large to import.');
            e.target.value = '';
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            var parsed;
            try { parsed = JSON.parse(reader.result); }
            catch (err) { return note('That file is not a keyring export.'); }
            note('Opening…');
            // The key is only needed for an encrypted file; a v1 plaintext
            // backup opens without one, so ask for it but do not require it.
            singleFlight('import', ['pImport'], function () { return withCurrentAccount(function (id) {
            return A.exportKey().catch(function () { return null; }).then(function (key) {
                return window.KeyringFile.read(parsed, key, id);
            }).then(function (data) {
                if (data.legacy && !window.confirm('This is an old plaintext backup without account binding. Import it only if you trust its source. Continue?')) return;
                var preview = K.previewImport(id, data);
                if (!window.confirm('Import preview: ' + preview.added + ' new, ' + preview.updated
                    + ' join name(s) filled, ' + preview.skipped + ' unchanged, ' + preview.invalid
                    + ' invalid. Continue?')) return;
                // Merge, never replace: importing an older backup must not
                // undo channels saved since it was taken.
                var r = K.importData(id, data);
                renderList();
                note(r.added + ' added, ' + r.updated + ' profile name(s) filled, '
                    + r.skipped + ' already here, ' + r.invalid + ' invalid.');
            }).catch(function (e) { note(e.message || 'That file could not be opened.'); });
            }); });
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    /* ---- destroying the key ----
     *
     * Rule 3 is custody, not incapability: we hold the export key on the
     * user's behalf. An endpoint that can take it back existed from the start
     * and nothing ever called it, which made the custody story a half-promise
     * -- the remedy was real but reachable only with curl.
     *
     * The Drive file is deliberately NOT deleted. It is the user's own file in
     * their own Drive; after this it is unreadable bytes, and removing it is
     * their decision to make, not ours.
     */
    el('pDestroyKey').addEventListener('click', function () {
        var note = function (text) {
            var n = el('pDestroyNote');
            n.hidden = false;
            n.textContent = text;
        };
        window.AppDialog.ask({
            title: 'Destroy your backup key?',
            body: 'Every backup you have ever made — the downloaded files and the copy '
                + 'in your Google Drive — becomes permanently unreadable, for everyone, '
                + 'including you and including us. The channels saved in this browser are '
                + 'untouched. Your next backup will mint a fresh key, and only backups '
                + 'made after that will be restorable.',
            confirmWord: 'destroy',
            placeholder: 'destroy',
            confirmLabel: 'Destroy key',
            danger: true
        }).then(function (typed) {
            if (typed !== 'destroy') return;          // cancelled, or not typed
            note('Destroying…');
            return singleFlight('destroy', ['pDestroyKey'], function () {
                return withCurrentAccount(function () { return A.destroyExportKey(); });
            }).then(function () {
                note('Backup key destroyed. Old backups can no longer be restored. '
                   + 'Make a new backup when you\u2019re ready.');
            });
        }).catch(function (e) {
            note(e && e.message ? e.message : 'That did not work.');
        });
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
        el('pDriveVerify').hidden = !connected;
        el('pDriveConnect').textContent = connected ? 'Reconnect Google Drive' : 'Connect Google Drive';
    }

    function setDriveVerifyNote(text) {
        var n = el('pDriveVerifyNote');
        n.hidden = false;
        n.textContent = text;
    }

    if (window.DriveBackup) {
        // Only offered when Google is actually configured here; a button that
        // opens a broken flow is worse than no button.
        A.googleAvailable().then(function (ok) {
            if (ok) el('pDriveCard').hidden = false;
        });

        el('pDriveConnect').addEventListener('click', function () {
            driveNote('Waiting for Google…');
            singleFlight('driveConnect', ['pDriveConnect'], function () { return withCurrentAccount(function () {
            return window.DriveBackup.connect().then(function () {
                showDriveButtons(true);
                driveNote('Connected. Drive access is held only until you sign out or reload this page.');
            }).catch(function (e) { driveNote(e.message); });
            }); });
        });

        el('pDriveBackup').addEventListener('click', function () {
            singleFlight('driveBackup', ['pDriveBackup', 'pDriveRestore'], function () { return withCurrentAccount(function (id) {
            var data = K.exportData(id);
            // Backing up nothing REPLACES the file in Drive, so an empty list
            // here destroys the only copy the user has -- and the commonest way
            // to have an empty list is to be on a new device, which is exactly
            // when somebody presses this meaning to RESTORE. Ask first; the
            // question costs a click and the mistake costs the lot.
            if (!data.channels.length && !window.confirm(
                    'You have no saved channels on this device.\n\n'
                  + 'Backing up now will REPLACE whatever is in your Drive with an '
                  + 'empty list. If you meant to bring channels back from Drive, '
                  + 'choose "Restore from Drive" instead.\n\n'
                  + 'Replace the backup with an empty one?')) {
                driveNote('Left your Drive backup alone.');
                return;
            }
            driveNote('Encrypting and uploading…');
            var revision = null;
            return Promise.all([window.DriveBackup.snapshot(), A.exportKey()]).then(function (both) {
                var remote = both[0].file, key = both[1];
                revision = both[0].revision;
                if (!key) throw new Error('Sign in to back up.');
                // A Drive backup is a synchronization point, not a blind
                // replacement. Bring remote-only rows into this device before
                // creating the next encrypted file.
                if (!remote) return key;
                return window.KeyringFile.read(remote, key, id).then(function (remoteData) {
                    var merged = K.importData(id, remoteData);
                    data = K.exportData(id);
                    if (merged.added || merged.updated) renderList();
                    return key;
                });
            }).then(function (key) {
                if (!key) throw new Error('Sign in to back up.');
                return window.KeyringFile.write(data, key, id);
            }).then(function (file) {
                return window.DriveBackup.put(file, revision);
            }).then(function () {
                driveNote(data.channels.length + ' channel(s) backed up to your Drive, encrypted.');
            }).catch(function (e) { driveNote(e.message); });
            }); });
        });

        el('pDriveRestore').addEventListener('click', function () {
            singleFlight('driveRestore', ['pDriveBackup', 'pDriveRestore'], function () { return withCurrentAccount(function (id) {
            driveNote('Fetching from Drive…');
            return Promise.all([window.DriveBackup.get(), A.exportKey()]).then(function (both) {
                if (!both[0]) { driveNote('There is no backup in your Drive yet.'); return null; }
                return window.KeyringFile.read(both[0], both[1], id);
            }).then(function (data) {
                if (!data) return;
                // Merge, never last-write-wins: two devices each holding rows
                // the other lacks must end up with both, not with whichever
                // wrote most recently.
                var preview = K.previewImport(id, data);
                if (!window.confirm('Restore preview: ' + preview.added + ' new, ' + preview.updated
                    + ' join name(s) filled, ' + preview.skipped + ' unchanged. Continue?')) return;
                var r = K.importData(id, data);
                renderList();
                driveNote(r.added + ' restored, ' + r.updated + ' profile name(s) filled, '
                    + r.skipped + ' already here, ' + r.invalid + ' invalid.');
            }).catch(function (e) { driveNote(e.message); });
            }); });
        });

        el('pDriveVerify').addEventListener('click', function () {
            singleFlight('driveVerify', ['pDriveVerify'], function () { return withCurrentAccount(function (id) {
                var localRows = K.list(id);
                var summary = [
                    'Checking Google Drive backup and decrypting with your account key…',
                    'Local storage encrypted: ' + (K.isEncrypted(id) ? 'yes' : 'not yet')
                ].join('\n');
                setDriveVerifyNote(summary);

                return Promise.all([window.DriveBackup.get(), A.exportKey()]).then(function (both) {
                    var remote = both[0];
                    if (!remote) {
                        setDriveVerifyNote('No backup found in Google Drive for this account.');
                        return null;
                    }
                    return window.KeyringFile.read(remote, both[1], id).then(function (data) {
                        var channels = (data && data.channels) || [];
                        var verify = compareChannelLists(localRows, channels);
                        var created = data.createdAt ? new Date(data.createdAt).toLocaleString() : null;
                        var suffix = [];
                        if (verify.invalid) suffix.push(verify.invalid + ' invalid channel row(s) in backup');
                        if (verify.localOnly) suffix.push(verify.localOnly + ' local-only channel(s)');
                        if (verify.remoteOnly) suffix.push(verify.remoteOnly + ' remote-only channel(s)');
                        var status = verify.localOnly === 0 && verify.remoteOnly === 0 && verify.invalid === 0
                            ? 'Verification: local list and Drive backup match exactly for saved rooms.'
                            : 'Verification: lists differ between this device and Drive backup.';
                        var details = [
                            'Drive backup decrypt: success.',
                            'Drive backup channels: ' + verify.remoteCount,
                            'Local channels: ' + verify.localCount,
                            'Matches: ' + verify.matched,
                            'Format: v' + (data.version || 1),
                            'Owner account id: ' + (data.accountId || '(not present)'),
                            created ? ('Created: ' + created) : ''
                        ].concat(suffix.length ? ['Issues: ' + suffix.join(', ')] : []);
                        setDriveVerifyNote(status + ' ' + details.filter(Boolean).join(' · ') );
                    });
                });
            }); });
        });
    }

    function note(text) {
        var n = el('pBackupNote');
        n.hidden = false;
        n.textContent = text;
    }

    el('pSetPasswordBtn').addEventListener('click', submitNewPassword);

    /** A Google round trip that failed comes back here with its reason. */
    function showGoogleError() {
        var message = typeof A.takeGoogleError === 'function' ? A.takeGoogleError() : null;
        if (!message) return;
        el('pGoogleError').hidden = false;
        el('pGoogleError').textContent = 'Google sign-in did not finish: ' + message;
    }

    /* ---- boot ---- */
    showGoogleError();
    if (window.location.hash === '#signin') show(false);
    A.me().then(applyUser).catch(function () { show(false); });
    A.onChange(function () { A.me(true).then(applyUser).catch(function () { show(false); }); });
})(window, document);
