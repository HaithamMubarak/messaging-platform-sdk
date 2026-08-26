/**
 * Rewind — watch a session play back.
 *
 * The whiteboard already writes an encrypted version of the board on every
 * save, so a channel that has been drawn on is already a recording; nothing was
 * ever built to watch it. This is that: open the channel a board lives in, and
 * scrub through its history.
 *
 * The primitive on show is **the channel as an ordered log**. Every other app
 * treats storage as a place to keep the current value; this one treats the list
 * of versions as a timeline, which is the thing storageAdd is actually for and
 * which only pulse touches, and only in passing.
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
    var BOARD_W = 1920, BOARD_H = 1080;

    function el(id) { return document.getElementById(id); }

    function unpackPoints(b64) {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var floats = new Float32Array(bytes.buffer);
        var points = [];
        for (var j = 0; j < floats.length; j += 2) {
            points.push({ x: floats[j], y: floats[j + 1] });
        }
        return points;
    }

    function whenText(ms) {
        if (!ms) return 'unknown time';
        var d = new Date(ms);
        return d.toLocaleString();
    }

    class Rewind extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'rewind_',
                customType: 'rewind',
                autoCreateDataChannel: false    // a viewer talks to nobody
            });
            this.frames = [];      // one per stored version, oldest first
            this.at = 0;
            this.playing = false;
        }

        onConnect() {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
            el('channelName').textContent = this.channelName || 'this channel';
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
            var self = this;

                var frames = [];
                rows.forEach(function (row) {
                    if (row && row.unreadable) return;      // a different password
                    var body;
                    try {
                        var raw = (row && row.content !== undefined) ? row.content : row;
                        body = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    } catch (e) {
                        return;
                    }
                    if (!body) return;

                    frames.push({
                        version: row.version,
                        at: (body.savedAt || (row.createdAt ? Date.parse(row.createdAt) : 0)),
                        paths: Array.isArray(body.paths) ? body.paths : null,
                        objects: Array.isArray(body.objects) ? body.objects : null,
                        image: body.canvasImage || null
                    });
                });

                // Oldest first: a timeline runs forwards.
                frames.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
                self.frames = frames;

                if (!frames.length) {
                    el('state').textContent = 'No saved board in this channel yet. '
                        + 'Draw something in the whiteboard with the same channel and password, then come back.';
                    self.renderControls();
                    return;
                }

                el('state').textContent = frames.length + ' saved state(s), from '
                    + whenText(frames[0].at) + ' to ' + whenText(frames[frames.length - 1].at);
            self.at = frames.length - 1;      // open on the latest
            self.renderControls();
            self.draw();
        }

        // ---- playback --------------------------------------------------------

        seek(index) {
            this.at = Math.max(0, Math.min(this.frames.length - 1, index));
            this.renderControls();
            this.draw();
        }

        play() {
            if (this.playing || this.frames.length < 2) return;
            // From the beginning if we are sitting at the end.
            if (this.at >= this.frames.length - 1) this.at = 0;
            this.playing = true;
            el('playBtn').textContent = 'Pause';

            var self = this;
            this._timer = setInterval(function () {
                if (self.at >= self.frames.length - 1) { self.pause(); return; }
                self.seek(self.at + 1);
            }, 900);
        }

        pause() {
            this.playing = false;
            clearInterval(this._timer);
            el('playBtn').textContent = 'Play';
        }

        toggle() { this.playing ? this.pause() : this.play(); }

        // ---- drawing ---------------------------------------------------------

        draw() {
            var frame = this.frames[this.at];
            var canvas = el('stage');
            var ctx = canvas.getContext('2d');

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (!frame) return;

            // Prefer the stroke list: it is what the board really is, and it
            // scales to this canvas cleanly. The stored JPEG is a fallback for
            // boards saved before strokes were stored as objects.
            if (frame.paths && frame.paths.length) {
                this.drawPaths(ctx, frame.paths, canvas);
            } else if (frame.image) {
                var img = new Image();
                img.onload = function () { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
                img.src = frame.image;
            }

            if (frame.objects && frame.objects.length) {
                this.drawObjects(ctx, frame.objects, canvas);
            }
        }

        drawPaths(ctx, paths, canvas) {
            var sx = canvas.width / BOARD_W, sy = canvas.height / BOARD_H;
            paths.forEach(function (path) {
                if (!path || !path.p) return;
                var points;
                try { points = unpackPoints(path.p); } catch (e) { return; }
                if (points.length < 2) return;

                ctx.beginPath();
                ctx.strokeStyle = path.erase ? '#ffffff' : (path.c || '#111111');
                ctx.lineWidth = Math.max(1, (path.s || 2) * Math.min(sx, sy));
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.moveTo(points[0].x * sx, points[0].y * sy);
                for (var i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x * sx, points[i].y * sy);
                }
                ctx.stroke();
            });
        }

        drawObjects(ctx, objects, canvas) {
            var sx = canvas.width / BOARD_W, sy = canvas.height / BOARD_H;
            objects.forEach(function (o) {
                if (!o) return;
                if (o.type === 'text' || o.type === 'note') {
                    ctx.fillStyle = o.color || '#111111';
                    ctx.font = Math.round((o.size || 16) * Math.min(sx, sy)) + 'px sans-serif';
                    ctx.fillText(String(o.text || ''), (o.x1 || 0) * sx, (o.y1 || 0) * sy);
                }
            });
        }

        renderControls() {
            var total = this.frames.length;
            var slider = el('scrub');
            slider.max = String(Math.max(0, total - 1));
            slider.value = String(this.at);
            slider.disabled = total < 2;

            el('playBtn').disabled = total < 2;
            el('position').textContent = total
                ? (this.at + 1) + ' / ' + total
                : '—';

            var frame = this.frames[this.at];
            el('frameTime').textContent = frame ? whenText(frame.at) : '';
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var app = new Rewind();
        window.rewindApp = app;

        el('scrub').addEventListener('input', function (e) {
            app.pause();
            app.seek(parseInt(e.target.value, 10) || 0);
        });
        el('playBtn').addEventListener('click', function () { app.toggle(); });
        el('reloadBtn').addEventListener('click', function () { app.pause(); app.load(); });

        window.loadConnectionModal({
            localStoragePrefix: 'rewind_',
            channelPrefix: 'whiteboard-',
            title: 'Replay a session',
            collapsedTitle: 'Rewind',
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
