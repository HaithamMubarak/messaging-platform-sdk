/**
 * Rewind — watch a session play back.
 *
 * The whiteboard already writes an encrypted version of the board on every
 * save, so a channel that has been drawn on is already a recording; nothing was
 * ever built to watch it. This is that: open the channel a board lives in, and
 * scrub through its history.
 *
 * The primitive on show is **the channel as an ordered log**. Most apps treat
 * storage as a place to keep the current value; this one treats the list of
 * versions as a timeline, which is the thing storageAdd is actually for.
 * Pulse and Evidence Chain lean on the same pair -- a poll whose every vote
 * appends a version, and a log that can only be appended to.
 *
 * It is read-only on purpose. A player that could write would need to agree
 * with whoever is drawing right now about what the board is, and that argument
 * is exactly what host authority exists to settle — a viewer does not need to
 * join it.
 */
(function () {
    'use strict';

    // The whiteboard keeps its CURRENT board under one key and its version
    // history under another — a key that has versions cannot be read back with
    // storageGet, and the live board's join path depends on exactly that. The
    // timeline is the history key; the board key is the fallback for channels
    // drawn on before the split, which hold a single state.
    var HISTORY_KEY = 'whiteboard-history';
    var BOARD_KEY = 'whiteboard-data';
    // Decoding, drawing and playback live in ../whiteboard/board-replay.js,
    // shared with the whiteboard's own history panel.

    function el(id) { return document.getElementById(id); }

    class Rewind extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'rewind_',
                customType: 'rewind',
                autoCreateDataChannel: false,   // a viewer talks to nobody
                // Rule 7 puts every app in `channel + "." + appId`, and this
                // page's whole job is to read a DIFFERENT app's storage. Left
                // to derive its own room it joined `channel.rewind`, which
                // nothing writes to, so every session looked like a channel
                // nobody had drawn in -- the empty-state message, forever.
                // rawRoom means "join the name you are given, verbatim"; the
                // caller below supplies the whiteboard's room.
                rawRoom: true
            });
            this.player = BoardReplay.player({
                canvas: el('stage'), slider: el('scrub'), playBtn: el('playBtn'),
                position: el('position'), time: el('frameTime'),
            });
        }

        onConnect() {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            // Show the channel the person typed, not the derived room: they
            // asked for "standup", and `standup.whiteboard` is plumbing.
            var shown = (this.channelName || '').replace(/\.whiteboard$/, '');
            el('channelName').textContent = shown || 'this channel';
            this.load();
        }

        /**
         * Read the whole history of the board in this channel.
         *
         * storageGetList returns every version; the SDK decrypts each one, so a
         * channel whose password we were given reads as plain objects and one we
         * were not stays unreadable and is skipped rather than crashing the
         * timeline.
         */
        load() {
            var self = this;
            el('state').textContent = 'Reading the channel…';

            var readKey = function (key, then) {
                self.channel.storageGetList(key, then);
            };

            readKey(HISTORY_KEY, function (response) {
                var rowsFound = self._rowsOf(response);
                if (rowsFound.length) { self._buildTimeline(rowsFound); return; }
                // Nothing under the history key: an older channel, whose single
                // saved board still makes a one-frame timeline worth showing.
                readKey(BOARD_KEY, function (fallback) {
                    self._buildTimeline(self._rowsOf(fallback));
                });
            });
        }

        /** Pull the version array out of whichever shape the API returned. */
        _rowsOf(response) {
            if (!response || response.status !== 'success') return [];
            var rows = response.data && response.data.data ? response.data.data : response.data;
            if (!Array.isArray(rows)) rows = (rows && rows.versions) ? rows.versions : [];
            return rows;
        }

        _buildTimeline(rows) {
            const frames = BoardReplay.framesOf(rows);
            this.player.load(frames);
            el('state').textContent = frames.length
                ? frames.length + ' saved state(s), from ' + BoardReplay.whenText(frames[0].at)
                  + ' to ' + BoardReplay.whenText(frames[frames.length - 1].at)
                : 'No saved board in this channel yet. '
                  + 'Draw something in the whiteboard with the same channel and password, then come back.';
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var app = new Rewind();
        window.rewindApp = app;

        el('reloadBtn').addEventListener('click', function () { app.player.pause(); app.load(); });

        window.loadConnectionModal({
            localStoragePrefix: 'rewind_',
            channelPrefix: 'whiteboard-',
            title: 'Replay a session',
            collapsedTitle: 'Rewind',
            onConnect: async function (username, channel, password) {
                // The room a whiteboard writes to. Typing "standup" here means
                // the board drawn in the whiteboard app on channel "standup",
                // which is `standup.whiteboard` on the wire.
                var room = /\.whiteboard$/.test(channel) ? channel : channel + '.whiteboard';

                await app.initialize();
                await app.connect({
                    username: username, channelName: room, channelPassword: password
                });
                app.start();
            }
        });
    });
})();
