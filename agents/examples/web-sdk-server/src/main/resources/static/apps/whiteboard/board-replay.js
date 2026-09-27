/**
 * BoardReplay — draw a saved whiteboard version, and play a list of them.
 *
 * The whiteboard writes an encrypted version of the board on every save
 * (storageAdd under 'whiteboard-history'), so a board that has been drawn on
 * is already a recording. This turns one stored version into a picture, and
 * a list of them into something you can scrub and play. It is read-only on
 * purpose: previewing never touches the live board, and putting a version
 * back is the history panel's Restore, which saves it as a NEW version.
 *
 * Used by the whiteboard's history panel and by the Rewind viewer, which
 * used to carry this code on its own.
 *
 *   const frames = BoardReplay.framesOf(rows);     // oldest first; unreadable rows skipped
 *   const player = BoardReplay.player({ canvas, slider, playBtn, position, time, frames });
 *   player.seek(frames.length - 1);                // open on the latest
 */
(function (root) {
    'use strict';

    var BOARD_W = 1920, BOARD_H = 1080;

    function unpackPoints(b64) {
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var floats = new Float32Array(bytes.buffer);
        var points = [];
        for (var j = 0; j < floats.length; j += 2) points.push({ x: floats[j], y: floats[j + 1] });
        return points;
    }

    function whenText(ms) {
        return ms ? new Date(ms).toLocaleString() : 'unknown time';
    }

    /** One stored version as a frame, or null if it cannot be read (another password). */
    function frameOf(row) {
        if (!row || row.unreadable) return null;
        var body;
        try {
            var raw = row.content !== undefined ? row.content : row;
            body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            return null;
        }
        if (!body || typeof body !== 'object') return null;
        var meta = row.metadata || {};
        return {
            id: row.id,
            at: body.savedAt || meta.savedAt || (row.createdAt ? Date.parse(row.createdAt) : 0),
            by: meta.by || null,
            paths: Array.isArray(body.paths) ? body.paths : null,
            objects: Array.isArray(body.objects) ? body.objects : null,
            image: body.canvasImage || null,
        };
    }

    /** Oldest first: a timeline runs forwards. */
    function framesOf(rows) {
        return (rows || []).map(frameOf).filter(Boolean).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    }

    function drawPaths(ctx, paths, canvas) {
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
            for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x * sx, points[i].y * sy);
            ctx.stroke();
        });
    }

    function drawObjects(ctx, objects, canvas) {
        var sx = canvas.width / BOARD_W, sy = canvas.height / BOARD_H;
        objects.forEach(function (o) {
            if (!o || (o.type !== 'text' && o.type !== 'note')) return;
            ctx.fillStyle = o.color || '#111111';
            ctx.font = Math.round((o.size || 16) * Math.min(sx, sy)) + 'px sans-serif';
            ctx.fillText(String(o.text || ''), (o.x1 || 0) * sx, (o.y1 || 0) * sy);
        });
    }

    /**
     * Draw a frame. Prefer the stroke list -- it is what the board really is
     * and it scales cleanly; the stored image is for boards saved before
     * strokes were stored as objects.
     */
    function draw(canvas, frame) {
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!frame) return;
        if (frame.paths && frame.paths.length) {
            drawPaths(ctx, frame.paths, canvas);
        } else if (frame.image) {
            var img = new Image();
            img.onload = function () { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
            img.src = frame.image;
        }
        if (frame.objects && frame.objects.length) drawObjects(ctx, frame.objects, canvas);
    }

    /** Scrub and play a list of frames on one canvas. Elements other than canvas are optional. */
    function player(opts) {
        var p = { frames: opts.frames || [], at: 0, playing: false, timer: null };

        p.render = function () {
            var total = p.frames.length, frame = p.frames[p.at];
            if (opts.slider) {
                opts.slider.max = String(Math.max(0, total - 1));
                opts.slider.value = String(p.at);
                opts.slider.disabled = total < 2;
            }
            if (opts.playBtn) opts.playBtn.disabled = total < 2;
            if (opts.position) opts.position.textContent = total ? (p.at + 1) + ' / ' + total : '—';
            if (opts.time) opts.time.textContent = frame ? whenText(frame.at) + (frame.by ? ' · ' + frame.by : '') : '';
            draw(opts.canvas, frame);
            if (typeof opts.onSeek === 'function') opts.onSeek(frame, p.at);
        };
        p.seek = function (i) {
            p.at = Math.max(0, Math.min(p.frames.length - 1, i));
            p.render();
        };
        p.pause = function () {
            p.playing = false;
            clearInterval(p.timer);
            if (opts.playBtn) opts.playBtn.textContent = 'Play';
        };
        p.play = function () {
            if (p.playing || p.frames.length < 2) return;
            if (p.at >= p.frames.length - 1) p.at = 0;   // from the beginning if at the end
            p.playing = true;
            if (opts.playBtn) opts.playBtn.textContent = 'Pause';
            p.timer = setInterval(function () {
                if (p.at >= p.frames.length - 1) { p.pause(); return; }
                p.seek(p.at + 1);
            }, opts.stepMs || 900);
        };
        p.load = function (frames) {
            p.pause();
            p.frames = frames || [];
            p.seek(p.frames.length - 1);
        };
        if (opts.slider) opts.slider.addEventListener('input', function (e) { p.pause(); p.seek(parseInt(e.target.value, 10) || 0); });
        if (opts.playBtn) opts.playBtn.addEventListener('click', function () { p.playing ? p.pause() : p.play(); });
        return p;
    }

    root.BoardReplay = { frameOf: frameOf, framesOf: framesOf, draw: draw, player: player, whenText: whenText };
})(typeof window !== 'undefined' ? window : this);
