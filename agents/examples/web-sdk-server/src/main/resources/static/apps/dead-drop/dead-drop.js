/**
 * Dead Drop — leave something encrypted, collected later.
 *
 * Every other app on this site needs everyone present at once: a whiteboard
 * with nobody drawing on it is nothing, a room with one person is silent. This
 * one is the opposite, and that is the point of it. You leave a note or a small
 * file in a channel and close the tab; somebody opens the same link tomorrow
 * and finds it there.
 *
 * The primitive on show is **encrypted channel storage as a mailbox**. A drop
 * is written with storageAdd, so the channel keeps every drop as its own
 * version rather than one overwritten value, and encrypted:true means the
 * server stores ciphertext it cannot read — the channel password is the key,
 * and it never leaves the browsers that know it.
 *
 * What makes it honest rather than a toy:
 *
 *  - Nothing is relayed peer to peer. There is no peer. The store IS the
 *    transport, which is why this works with nobody else online.
 *  - A drop can be marked read-once. Collecting it writes a tombstone, so the
 *    next person to open the box sees that it was taken and by whom, not the
 *    contents.
 *  - Size is capped hard. Channel storage is not a file host, and a 20MB
 *    attachment would be a bad surprise for the next person to open the box.
 */
(function () {
    'use strict';

    var BOX_KEY = 'deaddrop_box';
    var MAX_NOTE_CHARS = 4000;
    /** Base64 inflates by a third; this keeps a drop comfortably under a MB. */
    var MAX_FILE_BYTES = 512 * 1024;
    var MAX_DROPS_SHOWN = 50;

    function el(id) { return document.getElementById(id); }

    function bytesToB64(buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    function b64ToBlob(b64, type) {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: type || 'application/octet-stream' });
    }

    function newId() {
        return 'd-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    }

    function relative(then) {
        var secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
        if (secs < 60) return 'just now';
        if (secs < 3600) return Math.floor(secs / 60) + ' min ago';
        if (secs < 86400) return Math.floor(secs / 3600) + ' h ago';
        return Math.floor(secs / 86400) + ' days ago';
    }

    class DeadDrop extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'deaddrop_',
                customType: 'deaddrop',
                autoCreateDataChannel: false    // there is nobody to talk to
            });
            this.drops = [];
            this.pending = null;   // a file chosen but not yet left
        }

        onConnect() {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            el('boxName').textContent = this.channelName || 'this box';
            this.refresh();
        }

        // ---- reading the box -------------------------------------------------

        /**
         * Read every version of the box.
         *
         * storageGetList rather than storageGet: each drop is its own version,
         * so the box is the list of them. That also means a drop cannot be
         * silently overwritten by the next person to leave one.
         */
        refresh() {
            var self = this;
            el('boxState').textContent = 'Opening…';

            this.channel.storageGetList(BOX_KEY, function (response) {
                if (!response || response.status !== 'success') {
                    el('boxState').textContent = 'This box is empty.';
                    self.drops = [];
                    self.render();
                    return;
                }

                // The list arrives in more than one shape depending on the
                // path it took: sometimes response.data is the array, sometimes
                // it is a wrapper holding .data or .versions. Pulse already
                // learned this the hard way; assuming one shape returns an
                // empty box that looks exactly like a box with nothing in it.
                var rows = response.data && response.data.data
                    ? response.data.data : response.data;
                if (!Array.isArray(rows)) {
                    rows = (rows && rows.versions) ? rows.versions : [];
                }

                var drops = [];
                var collected = {};

                rows.forEach(function (version) {
                    var payload;
                    try {
                        var body = (version && version.content !== undefined)
                            ? version.content : version;
                        payload = typeof body === 'string' ? JSON.parse(body) : body;
                    } catch (e) {
                        return;   // a version this client cannot read is skipped
                    }
                    if (!payload || !payload.kind) return;

                    if (payload.kind === 'collected') {
                        collected[payload.dropId] = payload;
                        return;
                    }
                    if (payload.kind === 'drop') {
                        payload._version = version.version;
                        drops.push(payload);
                    }
                });

                // A read-once drop that has been collected shows as a
                // tombstone: who took it and when, never what it said.
                drops.forEach(function (drop) {
                    var taken = collected[drop.id];
                    if (taken) {
                        drop.collectedBy = taken.by;
                        drop.collectedAt = taken.at;
                    }
                });

                drops.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
                self.drops = drops.slice(0, MAX_DROPS_SHOWN);
                el('boxState').textContent = self.drops.length
                    ? self.drops.length + ' drop(s) in this box'
                    : 'This box is empty.';
                self.render();
            });
        }

        // ---- leaving something ----------------------------------------------

        leaveNote() {
            var text = (el('noteText').value || '').trim().slice(0, MAX_NOTE_CHARS);
            if (!text && !this.pending) {
                this.say('Write something, or attach a file.');
                return;
            }

            var drop = {
                kind: 'drop',
                id: newId(),
                by: this.username,
                at: Date.now(),
                readOnce: el('readOnce').checked,
                text: text
            };

            if (this.pending) {
                drop.file = {
                    name: this.pending.name,
                    type: this.pending.type,
                    size: this.pending.size,
                    b64: this.pending.b64
                };
            }

            this.write(drop, function (ok) {
                if (!ok) return;
                el('noteText').value = '';
                el('readOnce').checked = false;
                this.pending = null;
                el('fileState').textContent = '';
                this.say('Left in the box. You can close this tab.');
                this.refresh();
            }.bind(this));
        }

        /**
         * Write one entry.
         *
         * encrypted:true is the whole promise of the app: the server holds
         * ciphertext, and the channel password that decrypts it is only ever in
         * the browsers of people who were given the link.
         */
        write(payload, done) {
            var self = this;
            this.channel.storageAdd({
                storageKey: BOX_KEY,
                content: JSON.stringify(payload),
                encrypted: true,
                metadata: { at: payload.at || Date.now(), kind: payload.kind }
            }, function (response) {
                var ok = response && response.status === 'success';
                if (!ok) {
                    self.say('Could not write to the box — ' +
                        ((response && response.statusMessage) || 'unknown error'));
                }
                if (done) done(ok);
            });
        }

        chooseFile(file) {
            var self = this;
            if (!file) return;
            if (file.size > MAX_FILE_BYTES) {
                this.say('That file is ' + Math.round(file.size / 1024) + 'kB. The limit is '
                    + Math.round(MAX_FILE_BYTES / 1024) + 'kB — a mailbox is not a file host.');
                el('fileInput').value = '';
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                self.pending = {
                    name: file.name, type: file.type, size: file.size,
                    b64: bytesToB64(reader.result)
                };
                el('fileState').textContent = file.name + ' (' + Math.round(file.size / 1024) + 'kB) ready';
            };
            reader.onerror = function () { self.say('Could not read that file.'); };
            reader.readAsArrayBuffer(file);
        }

        // ---- collecting ------------------------------------------------------

        collect(id) {
            var drop = this.drops.filter(function (d) { return d.id === id; })[0];
            if (!drop) return;

            if (drop.file) {
                var blob = b64ToBlob(drop.file.b64, drop.file.type);
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = drop.file.name || 'drop';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            }

            if (drop.readOnce && !drop.collectedBy) {
                // A tombstone, not a deletion: the box records that it was
                // taken and by whom, which is the useful half of read-once.
                this.write({
                    kind: 'collected', dropId: drop.id, by: this.username, at: Date.now()
                }, function () { this.refresh(); }.bind(this));
            }
        }

        say(message) {
            var node = el('toast');
            node.textContent = message;
            node.hidden = false;
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(function () { node.hidden = true; }, 4000);
        }

        // ---- rendering -------------------------------------------------------

        render() {
            var host = el('drops');
            host.innerHTML = '';
            var self = this;

            if (!this.drops.length) {
                var empty = document.createElement('p');
                empty.className = 'dd-empty';
                empty.textContent = 'Nothing here yet. Leave something and share the link.';
                host.appendChild(empty);
                return;
            }

            this.drops.forEach(function (drop) {
                var card = document.createElement('article');
                card.className = 'dd-drop' + (drop.collectedBy ? ' dd-drop--taken' : '');

                var head = document.createElement('div');
                head.className = 'dd-drop__head';
                var who = document.createElement('span');
                who.className = 'dd-drop__by';
                who.textContent = drop.by || 'someone';
                var when = document.createElement('span');
                when.className = 'dd-drop__when';
                when.textContent = relative(drop.at || Date.now());
                head.appendChild(who);
                head.appendChild(when);
                if (drop.readOnce) {
                    var badge = document.createElement('span');
                    badge.className = 'badge badge--brand';
                    badge.textContent = 'read once';
                    head.appendChild(badge);
                }
                card.appendChild(head);

                if (drop.collectedBy) {
                    var taken = document.createElement('p');
                    taken.className = 'dd-drop__taken';
                    taken.textContent = 'Collected by ' + drop.collectedBy + ' · ' +
                        relative(drop.collectedAt || Date.now());
                    card.appendChild(taken);
                } else {
                    if (drop.text) {
                        var body = document.createElement('p');
                        body.className = 'dd-drop__text';
                        // textContent: a note is written by someone else.
                        body.textContent = drop.text;
                        card.appendChild(body);
                    }
                    if (drop.file) {
                        var take = document.createElement('button');
                        take.className = 'btn btn--sm';
                        take.type = 'button';
                        take.textContent = 'Download ' + drop.file.name +
                            ' (' + Math.round((drop.file.size || 0) / 1024) + 'kB)';
                        take.addEventListener('click', function () { self.collect(drop.id); });
                        card.appendChild(take);
                    } else if (drop.readOnce) {
                        var mark = document.createElement('button');
                        mark.className = 'btn btn--sm btn--ghost';
                        mark.type = 'button';
                        mark.textContent = 'Mark as collected';
                        mark.addEventListener('click', function () { self.collect(drop.id); });
                        card.appendChild(mark);
                    }
                }
                host.appendChild(card);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var app = new DeadDrop();
        window.deadDropApp = app;

        el('leaveBtn').addEventListener('click', function () { app.leaveNote(); });
        el('refreshBtn').addEventListener('click', function () { app.refresh(); });
        el('fileInput').addEventListener('change', function (e) { app.chooseFile(e.target.files[0]); });

        window.loadConnectionModal({
            localStoragePrefix: 'deaddrop_',
            channelPrefix: 'box-',
            title: 'Open a drop box',
            collapsedTitle: 'Dead Drop',
            onConnect: async function (username, channel, password) {
                await app.initialize();
                await app.connect({
                    username: username, channelName: channel, channelPassword: password
                });
                app.start();
            }
        });
    });
})();
