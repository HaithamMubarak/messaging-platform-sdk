/**
 * Durable boards for the apps that had none.
 *
 * collab-doc, mind-map and pixel-art all lost everything the moment the last
 * tab closed: their state lived only in the peers holding it, so a room that
 * emptied took the work with it. The whiteboard already solved this — it writes
 * an encrypted blob to channel storage and reads it back on join — and this is
 * that pattern, extracted once so three apps get it for one build.
 *
 * The rules that make it safe to share:
 *
 *  - Only the host writes. Channel storage is a single-writer store, and two
 *    peers saving different views of the same board is how you lose half of it.
 *  - Always encrypted. The board is the users' content; the server should not
 *    be able to read it.
 *  - Saves are debounced and coalesced. A board changes on every keystroke or
 *    pixel; storage is not a per-event log.
 *  - A load never overwrites newer local work: the caller decides what to do
 *    with what it gets, and gets told when there was nothing stored.
 *
 * Usage:
 *   const store = BoardStore.attach(app, {
 *       key: 'mindmap_board',
 *       snapshot: () => ({ nodes, connections }),   // what to save
 *       restore: (data) => applyToBoard(data)       // what to do on load
 *   });
 *   store.load();          // on connect
 *   store.touch();         // after any local change
 */
(function (window) {
    'use strict';

    var DEFAULT_DEBOUNCE_MS = 2500;
    /** Channel storage rejects very large values; warn well before that. */
    var WARN_BYTES = 4 * 1024 * 1024;

    /** JSON.parse that answers null instead of throwing. */
    function tryParse(text) {
        try {
            var value = JSON.parse(text);
            return (value && typeof value === 'object') ? value : null;
        } catch (e) {
            return null;
        }
    }

    function attach(app, options) {
        var opts = options || {};
        var key = opts.key;
        if (!app || !key || typeof opts.snapshot !== 'function') {
            throw new Error('BoardStore.attach needs an app, a key and a snapshot function');
        }

        var debounceMs = opts.debounceMs || DEFAULT_DEBOUNCE_MS;
        var timer = null;
        var saving = false;
        var dirtyWhileSaving = false;
        var lastSavedAt = 0;

        function channel() {
            return app.channel || null;
        }

        function save(done) {
            var ch = channel();
            // Only the host writes: see the note at the top of this file.
            if (!ch || !app.isHost || !app.isHost()) {
                if (done) done(false);
                return;
            }
            if (saving) {
                dirtyWhileSaving = true;
                if (done) done(false);
                return;
            }

            var payload;
            try {
                payload = JSON.stringify(opts.snapshot());
            } catch (e) {
                console.warn('[BoardStore] Could not serialise the board:', e && e.message);
                if (done) done(false);
                return;
            }

            if (payload.length > WARN_BYTES) {
                console.warn('[BoardStore] Board is ' + Math.round(payload.length / 1024) +
                    'kB; consider storing less per save.');
            }

            saving = true;
            ch.storagePut({
                storageKey: key,
                content: payload,
                encrypted: true,
                metadata: { savedAt: Date.now(), by: app.username || '' }
            }, function (response) {
                saving = false;
                var ok = response && response.status === 'success';
                if (ok) {
                    lastSavedAt = Date.now();
                } else {
                    console.warn('[BoardStore] Save failed:',
                        (response && response.statusMessage) || 'unknown');
                }
                // A change that arrived mid-save is not lost.
                if (dirtyWhileSaving) {
                    dirtyWhileSaving = false;
                    touch();
                }
                if (done) done(ok);
            });
        }

        function touch() {
            if (!app.isHost || !app.isHost()) return;
            clearTimeout(timer);
            timer = setTimeout(function () { save(); }, debounceMs);
        }

        function load(done) {
            var ch = channel();
            if (!ch) { if (done) done(false); return; }

            ch.storageGet({ storageKey: key }, function (response) {
                var ok = response && response.status === 'success';
                if (!ok || !response.data) {
                    // Nothing stored yet is the normal first-run case, not an error.
                    if (done) done(false);
                    return;
                }

                // The read comes back in one of two shapes and the difference
                // matters: sometimes `data` is the raw string that was written,
                // and sometimes it is that string ALREADY PARSED. Reaching for
                // data.content blindly picks the snapshot's own inner `content`
                // field out of the parsed object — which is why a restored
                // document came back holding only its own body text and then
                // failed to parse as JSON.
                var parsed = null;
                var data = response.data;

                if (typeof data === 'string') {
                    parsed = tryParse(data);
                } else if (data && typeof data === 'object') {
                    if (typeof data.content === 'string') {
                        // A wrapper only if its content really is our payload.
                        parsed = tryParse(data.content);
                    }
                    // Otherwise `data` is the payload itself, already parsed.
                    if (parsed === null) parsed = data;
                }

                if (parsed === null || parsed === undefined) {
                    console.warn('[BoardStore] Stored board could not be read');
                    if (done) done(false);
                    return;
                }
                try {
                    if (typeof opts.restore === 'function') opts.restore(parsed);
                } catch (e) {
                    console.warn('[BoardStore] restore() threw:', e && e.message);
                    if (done) done(false);
                    return;
                }
                if (done) done(true);
            });
        }

        /** Write immediately — for a host handing over or a tab closing. */
        function flush(done) {
            clearTimeout(timer);
            save(done);
        }

        return {
            load: load,
            touch: touch,
            flush: flush,
            get lastSavedAt() { return lastSavedAt; }
        };
    }

    window.BoardStore = { attach: attach };
})(window);
