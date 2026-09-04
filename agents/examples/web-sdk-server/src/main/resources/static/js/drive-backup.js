/**
 * Keeping the backup in the user's own Google Drive.
 *
 * The file lives in `appDataFolder` — a hidden per-app folder inside the
 * user's Drive. It is the encrypted `mp-keyring` file and nothing else.
 *
 * WHO HOLDS WHAT, because this is the point of the design:
 *
 *   our database    the key, and no channels to use it on
 *   the user's Drive  ciphertext, and no key
 *   Google            ciphertext only  <- the one party actually PREVENTED
 *                                         rather than trusted
 *   this browser      both, necessarily
 *
 * The token is obtained by the BROWSER, straight from Google, via the
 * Identity Services token flow. No refresh token ever reaches our backend,
 * and that is not a detail: it is what makes "we do not fetch your backup
 * file" a wall rather than a promise. Our servers hold no credential that
 * opens anything at Google. Never add a server-side Drive integration; it
 * would quietly demote the only wall in this design.
 *
 * The access token is short-lived, held in memory, and never persisted.
 */
(function (window) {
    'use strict';

    var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    var GIS = 'https://accounts.google.com/gsi/client';
    var FILENAME = 'mp.keyring.v1.json.enc';
    var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
    var FILES = 'https://www.googleapis.com/drive/v3/files';

    var _token = null;        // memory only, for this page
    var _clientId = null;
    var _gisLoading = null;

    function loadGis() {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
            return Promise.resolve();
        }
        if (_gisLoading) return _gisLoading;
        _gisLoading = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = GIS;
            s.async = true;
            // onload only says the response arrived. An extension or a content
            // blocker can serve an empty 200, and then initTokenClient is read
            // off undefined and the person is shown a TypeError as product
            // copy. Check for the thing we came for, not for the script tag.
            s.onload = function () {
                if (window.google && window.google.accounts && window.google.accounts.oauth2) resolve();
                else reject(new Error('Google sign-in loaded but did not start. '
                                    + 'A content blocker is the usual cause.'));
            };
            s.onerror = function () { reject(new Error('Google sign-in could not be loaded.')); };
            document.head.appendChild(s);
        });
        // A rejected promise cached here is permanent: one blocked load, and
        // Drive stays broken until the page is reloaded even though the very
        // next attempt would have worked. Cache the attempt, not the failure.
        _gisLoading = _gisLoading.catch(function (e) { _gisLoading = null; throw e; });
        return _gisLoading;
    }

    function clientId() {
        if (_clientId) return Promise.resolve(_clientId);
        var base = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://127.0.0.1:8094/api' : '/messaging-platform/rooms-api/api';
        return fetch(base + '/auth/google/status')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || !d.clientId) throw new Error('Google is not configured on this deployment.');
                _clientId = d.clientId;
                return _clientId;
            });
    }

    /**
     * Ask Google for a Drive appData token.
     *
     * Opens a consent popup the first time, so it must be called from a click
     * — a browser will block a popup that no gesture asked for.
     */
    function authorize(interactive) {
        if (_token) return Promise.resolve(_token);
        return Promise.all([loadGis(), clientId()]).then(function (both) {
            return new Promise(function (resolve, reject) {
                var client = window.google.accounts.oauth2.initTokenClient({
                    client_id: both[1],
                    scope: SCOPE,
                    callback: function (resp) {
                        if (resp && resp.access_token) { _token = resp.access_token; resolve(_token); }
                        else reject(new Error(describe(resp)));
                    },
                    error_callback: function (err) { reject(new Error(describe(err))); }
                });
                client.requestAccessToken({ prompt: interactive === false ? '' : 'consent' });
            });
        });
    }

    /** Turn Google's error shapes into something a person can act on. */
    function describe(e) {
        var type = e && (e.type || e.error);
        if (type === 'popup_closed' || type === 'popup_closed_by_user') {
            return 'The Google window was closed before finishing.';
        }
        if (type === 'popup_failed_to_open') {
            return 'The browser blocked the Google window. Allow popups for this site and try again.';
        }
        if (type === 'access_denied') return 'Google access was declined.';
        if (e && e.message) return e.message;
        return 'Google did not grant access.';
    }

    function api(url, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        opts.headers.Authorization = 'Bearer ' + _token;
        return fetch(url, opts).then(function (r) {
            if (r.status === 401 || r.status === 403) {
                _token = null;   // expired or revoked; the next call re-asks
                return r.text().then(function (t) {
                    throw new Error('Google refused the request. Reconnect and try again.'
                        + (t && t.length < 200 ? ' (' + t + ')' : ''));
                });
            }
            if (!r.ok) return r.text().then(function (t) { throw new Error('Drive error: ' + t.slice(0, 160)); });
            return r;
        });
    }

    /**
     * The file's Drive id, or null.
     *
     * Two details that are not decoration:
     *
     *  - `trashed=false`. Drive's list does NOT exclude trashed files by
     *    default, so a backup the user deleted could still be found and
     *    restored, and `put` would PATCH the file in the bin rather than the
     *    live one.
     *  - newest first, explicitly. appDataFolder tolerates two files with the
     *    same name, and nothing here has ever stopped a second one being
     *    created — an interrupted first upload is enough. Unordered, `files[0]`
     *    is whichever Drive felt like returning, so a backup could silently
     *    restore an older list than the one just written.
     */
    function find() {
        return api(FILES + '?spaces=appDataFolder&fields=files(id,name,modifiedTime,version,etag)'
                 + '&orderBy=' + encodeURIComponent('modifiedTime desc')
                 + '&q=' + encodeURIComponent("name='" + FILENAME + "' and trashed=false"))
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var files = (d && d.files) || [];
                return files.length ? files[0] : null;
            });
    }

    var DriveBackup = {
        SCOPE: SCOPE,
        FILENAME: FILENAME,

        connected: function () { return !!_token; },
        connect: function () { return authorize(true).then(function () { return true; }); },

        /** Forget the token here. Access is revoked in the Google account. */
        disconnect: function () { _token = null; },

        /**
         * Write the encrypted file, replacing whatever is there.
         * @param {object} file the `mp-keyring` v2 object
         */
        put: function (file, expected) {
            return authorize().then(find).then(function (existing) {
                // Detect the common multi-device race before replacing a
                // remote file we just merged. Google also enforces the ETag
                // below when it provides one.
                if (expected && expected.missing && existing) {
                    var appeared = new Error('A Drive backup appeared from another device. Please try again.');
                    appeared.code = 'MP_DRIVE_CONFLICT';
                    throw appeared;
                }
                if (expected && existing && expected.id === existing.id
                        && expected.version && existing.version !== expected.version) {
                    var conflict = new Error('Your Drive backup changed on another device. Please try again.');
                    conflict.code = 'MP_DRIVE_CONFLICT';
                    throw conflict;
                }
                var meta = existing ? {} : { name: FILENAME, parents: ['appDataFolder'] };
                var boundary = 'mpk' + Date.now();
                var body =
                    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
                    + JSON.stringify(meta) + '\r\n'
                    + '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n'
                    + JSON.stringify(file) + '\r\n'
                    + '--' + boundary + '--';
                var url = existing
                    ? UPLOAD + '/' + existing.id + '?uploadType=multipart'
                    : UPLOAD + '?uploadType=multipart';
                return api(url, {
                    method: existing ? 'PATCH' : 'POST',
                    headers: (function () {
                        var h = { 'Content-Type': 'multipart/related; boundary=' + boundary };
                        if (expected && expected.etag) h['If-Match'] = expected.etag;
                        return h;
                    })(),
                    body: body
                }).then(function (r) { return r.json(); });
            });
        },

        /**
         * Read the encrypted file back, or null if there is none.
         * Returns the file object; decrypting it is KeyringFile's job.
         */
        get: function () {
            return authorize().then(find).then(function (existing) {
                if (!existing) return null;
                return api(FILES + '/' + existing.id + '?alt=media')
                    .then(function (r) { return r.json(); });
            });
        },

        /** Same data as get(), plus the Drive revision used for a safe write. */
        snapshot: function () {
            return authorize().then(find).then(function (existing) {
                if (!existing) return { file: null, revision: { missing: true } };
                return api(FILES + '/' + existing.id + '?alt=media')
                    .then(function (r) { return r.json(); })
                    .then(function (file) { return { file: file, revision: existing }; });
            });
        },

        /** Remove it. The user's channels on this device are untouched. */
        remove: function () {
            return authorize().then(find).then(function (existing) {
                if (!existing) return false;
                return api(FILES + '/' + existing.id, { method: 'DELETE' })
                    .then(function () { return true; });
            });
        }
    };

    window.DriveBackup = DriveBackup;
})(window);
