/**
 * Whiteboard — the tools that are not a pen.
 *
 * The board's whole vocabulary is a line segment: {x1,y1,x2,y2,color,size}.
 * Everything syncs, saves, redraws and undoes in terms of segments, so the
 * cheapest honest way to add shapes is to *speak segments* — a rectangle is
 * four of them, an ellipse is thirty-two — and nothing downstream needs to
 * learn a new word. Shapes therefore replicate, persist, export and undo for
 * free, on the code that was already there.
 *
 * Two things genuinely cannot be said in segments: a piece of text and a
 * sticky note. Those add one field to the stroke — `type` — handled in
 * `drawStroke` and in the receive loop, and carried by the JSON path rather
 * than the binary one (nine floats have nowhere to put a sentence).
 *
 * Preview while dragging happens on a third canvas of its own, so the magic
 * pen's 30fps clear-and-repaint of its overlay cannot wipe a half-drawn
 * rectangle, and a half-drawn rectangle is never in the board state.
 *
 * Loaded after whiteboard-client.js, which owns the globals used here.
 */
(function () {
    'use strict';

    var SHAPES = ['line', 'arrow', 'rect', 'ellipse', 'diamond'];
    var TEXTS = ['text', 'note'];

    var NOTE_W = 260, NOTE_H = 190;      // a sticky note, in board units

    var preview = null;                  // the overlay canvas
    var remote = null;                   // peer name -> the shape they are dragging
    var lastShared = 0;
    var pctx = null;
    var drag = null;                     // { x0, y0, x1, y1 }
    var editor = null;                   // the live text box

    function owns(tool) { return SHAPES.indexOf(tool) !== -1 || TEXTS.indexOf(tool) !== -1; }
    function isShape(tool) { return SHAPES.indexOf(tool) !== -1; }

    /* ------------------------------------------------------------------ layer */

    function layer() {
        if (preview) return preview;
        if (typeof canvas === 'undefined' || !canvas) return null;
        preview = document.createElement('canvas');
        preview.id = 'whiteboard-preview';
        preview.style.position = 'absolute';
        preview.style.pointerEvents = 'none';
        preview.width = canvas.width;
        preview.height = canvas.height;
        preview.style.width = canvas.style.width || (canvas.width + 'px');
        preview.style.height = canvas.style.height || (canvas.height + 'px');
        canvas.parentNode.appendChild(preview);
        pctx = preview.getContext('2d');
        align();
        return preview;
    }

    /**
     * Sit the preview exactly on top of the board.
     *
     * The board is zoomed and panned with a CSS transform. This layer was
     * left untransformed, so while a shape was being dragged it was drawn at
     * a different scale and offset from the board underneath — the shape
     * appeared away from the pointer and then jumped into place on release.
     * The magic-pen canvas is kept in step the same way.
     */
    function align() {
        if (!preview || typeof canvas === 'undefined' || !canvas) return;
        preview.style.transform = canvas.style.transform || '';
        preview.style.transformOrigin = canvas.style.transformOrigin || 'center center';
        preview.style.left = canvas.offsetLeft + 'px';
        preview.style.top = canvas.offsetTop + 'px';
    }

    function clearPreview() {
        if (pctx && preview) pctx.clearRect(0, 0, preview.width, preview.height);
    }

    /* ----------------------------------------------------------- the geometry */

    /** A shape, as the segments that draw it. */
    function segments(tool, x0, y0, x1, y1, color, size) {
        var out = [];
        var push = function (ax, ay, bx, by) {
            // `sharp` says this segment is deliberate geometry, not the wobble
            // of a hand. The receiving side smooths contiguous strokes into a
            // curve, which is right for a pen and ruinous for a shape: it
            // rounded the corners off a rectangle and turned a diamond into a
            // blob on every screen but the one that drew it.
            out.push({ x1: ax, y1: ay, x2: bx, y2: by, color: color, size: size,
                erase: false, sharp: true });
        };

        if (tool === 'line') {
            push(x0, y0, x1, y1);
        } else if (tool === 'arrow') {
            push(x0, y0, x1, y1);
            var a = Math.atan2(y1 - y0, x1 - x0);
            var head = Math.max(14, size * 4);
            push(x1, y1, x1 - head * Math.cos(a - Math.PI / 7), y1 - head * Math.sin(a - Math.PI / 7));
            push(x1, y1, x1 - head * Math.cos(a + Math.PI / 7), y1 - head * Math.sin(a + Math.PI / 7));
        } else if (tool === 'rect') {
            push(x0, y0, x1, y0);
            push(x1, y0, x1, y1);
            push(x1, y1, x0, y1);
            push(x0, y1, x0, y0);
        } else if (tool === 'diamond') {
            var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
            push(mx, y0, x1, my);
            push(x1, my, mx, y1);
            push(mx, y1, x0, my);
            push(x0, my, mx, y0);
        } else if (tool === 'ellipse') {
            var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
            var rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
            var steps = 32, prev = null;
            for (var i = 0; i <= steps; i++) {
                var t = (i / steps) * Math.PI * 2;
                var p = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
                if (prev) push(prev.x, prev.y, p.x, p.y);
                prev = p;
            }
        }
        return out;
    }

    /** Straight lines want to be straight: shift snaps to 0/45/90. */
    function snap(x0, y0, x1, y1, tool, shiftKey) {
        if (!shiftKey) return { x1: x1, y1: y1 };
        var dx = x1 - x0, dy = y1 - y0;
        if (tool === 'line' || tool === 'arrow') {
            var a = Math.atan2(dy, dx);
            var step = Math.PI / 4;
            var snapped = Math.round(a / step) * step;
            var len = Math.hypot(dx, dy);
            return { x1: x0 + len * Math.cos(snapped), y1: y0 + len * Math.sin(snapped) };
        }
        var side = Math.max(Math.abs(dx), Math.abs(dy));   // a square, a circle
        return { x1: x0 + Math.sign(dx || 1) * side, y1: y0 + Math.sign(dy || 1) * side };
    }

    /* -------------------------------------------------------------- the drag */

    function begin(pos, e) {
        if (typeof beginAction === 'function') beginAction();
        if (isShape(currentTool)) {
            layer();
            drag = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
            return true;
        }
        // Text and notes are placed with one click, not dragged.
        openEditor(pos, currentTool);
        return true;
    }

    function move(pos, e) {
        if (!drag) return false;
        var s = snap(drag.x0, drag.y0, pos.x, pos.y, currentTool, e && e.shiftKey);
        drag.x1 = s.x1;
        drag.y1 = s.y1;
        // One painter for both, so a peer's in-progress shape is not wiped by
        // the next frame of your own drag.
        paintRemote();
        share(drag.x0, drag.y0, drag.x1, drag.y1);
        return true;
    }

    /**
     * Let the room watch a shape being drawn.
     *
     * A shape commits whole, so until the mouse comes up nobody else saw
     * anything at all — the board looked idle and then a rectangle appeared.
     * This sends the two corners as they move, which is cheap enough to send
     * on every frame and is all a peer needs to draw the same outline.
     *
     * It rides the data channel and is never recorded: a preview is a thing
     * that is happening, not a thing that happened, so it touches neither the
     * board state nor anybody's history.
     */
    function share(x0, y0, x1, y1) {
        if (typeof connected === 'undefined' || !connected) return;
        if (typeof webrtcHelper === 'undefined' || !webrtcHelper) return;
        var now = Date.now();
        if (x1 !== null && now - lastShared < 40) return;      // ~25 a second
        lastShared = now;
        try {
            webrtcHelper.broadcastDataChannel({
                type: 'shape-preview',
                tool: currentTool,
                x0: x0, y0: y0, x1: x1, y1: y1,
                color: currentColor, size: currentSize,
                by: typeof username !== 'undefined' ? username : 'someone'
            });
        } catch (err) { /* a preview is not worth an error */ }
    }

    /** Draw somebody else's in-progress shape, or clear it when they finish. */
    function showRemote(msg) {
        if (!msg) return;
        if (!remote) remote = new Map();
        if (msg.x1 === null || msg.x1 === undefined) remote.delete(msg.by);
        else remote.set(msg.by, msg);
        paintRemote();
    }

    function paintRemote() {
        if (!layer() || !pctx) return;
        clearPreview();
        // The local drag, if any, is drawn on top of everybody else's.
        if (remote) {
            remote.forEach(function (m) {
                pctx.save();
                pctx.strokeStyle = m.color || '#888';
                pctx.lineWidth = m.size || 3;
                pctx.globalAlpha = 0.55;          // it has not happened yet
                pctx.setLineDash([8, 6]);
                pctx.lineCap = 'round';
                pctx.lineJoin = 'round';
                segments(m.tool, m.x0, m.y0, m.x1, m.y1, m.color, m.size).forEach(function (g) {
                    pctx.beginPath();
                    pctx.moveTo(g.x1, g.y1);
                    pctx.lineTo(g.x2, g.y2);
                    pctx.stroke();
                });
                pctx.restore();
            });
        }
        if (drag) {
            pctx.save();
            pctx.strokeStyle = currentColor;
            pctx.lineWidth = currentSize;
            pctx.lineCap = 'round';
            pctx.lineJoin = 'round';
            segments(currentTool, drag.x0, drag.y0, drag.x1, drag.y1, currentColor, currentSize)
                .forEach(function (g) {
                    pctx.beginPath();
                    pctx.moveTo(g.x1, g.y1);
                    pctx.lineTo(g.x2, g.y2);
                    pctx.stroke();
                });
            pctx.restore();
        }
    }

    function end() {
        if (!drag) return false;
        var d = drag;
        drag = null;
        share(d.x0, d.y0, null, null);   // tell the room the drag is over
        paintRemote();                   // others may still be mid-shape
        // A click that never moved is a slip of the hand, not a shape.
        if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return true;
        commit(segments(currentTool, d.x0, d.y0, d.x1, d.y1, currentColor, currentSize));
        return true;
    }

    function active() { return !!drag; }

    /* --------------------------------------------------------------- the text */

    /**
     * A box you type into, sitting exactly where the words will land.
     *
     * It is positioned in viewport pixels and scaled with the zoom, so what
     * you type is the size it will be — a text tool that types at one size and
     * commits at another is a text tool nobody trusts.
     */
    function openEditor(pos, kind) {
        closeEditor(true);
        var wrap = document.getElementById('canvasContainer') || document.body;
        var at = canvasToViewport(pos.x, pos.y);
        var zoom = (typeof viewportTransform !== 'undefined' && viewportTransform.zoom) || 1;
        var fontPx = fontFor(currentSize);

        var box = document.createElement('textarea');
        box.className = 'wb-typing' + (kind === 'note' ? ' wb-typing--note' : '');
        box.setAttribute('aria-label', kind === 'note' ? 'Sticky note text' : 'Text');
        box.rows = 1;
        box.style.left = at.x + 'px';
        box.style.top = at.y + 'px';
        box.style.fontSize = (fontPx * zoom) + 'px';
        box.style.lineHeight = '1.25';
        if (kind === 'note') {
            box.style.width = (NOTE_W * zoom) + 'px';
            box.style.height = (NOTE_H * zoom) + 'px';
            box.style.background = noteFill(currentColor);
            box.style.color = '#111827';
        } else {
            box.style.color = currentColor;
        }

        wrap.appendChild(box);
        box.focus();
        editor = { el: box, pos: pos, kind: kind, color: currentColor, font: fontPx };

        box.addEventListener('keydown', function (e) {
            e.stopPropagation();                       // the board's shortcuts are not for the typist
            if (e.key === 'Escape') { closeEditor(true); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { closeEditor(false); }
        });
        box.addEventListener('blur', function () { closeEditor(false); });
    }

    function closeEditor(discard) {
        if (!editor) return;
        var e = editor;
        editor = null;
        var text = String(e.el.value || '').trim();
        e.el.remove();
        if (discard || !text) return;

        if (e.kind === 'note') {
            commit([{
                type: 'note',
                x1: e.pos.x, y1: e.pos.y, x2: e.pos.x + NOTE_W, y2: e.pos.y + NOTE_H,
                text: text.slice(0, 500), color: e.color, size: e.font, erase: false
            }]);
        } else {
            commit([{
                type: 'text',
                x1: e.pos.x, y1: e.pos.y, x2: e.pos.x, y2: e.pos.y,
                text: text.slice(0, 500), color: e.color, size: e.font, erase: false
            }]);
        }
    }

    function typing() { return !!editor; }

    /** Brush size is a stroke width; as a font it needs to be readable. */
    function fontFor(size) { return Math.max(16, Math.round(Number(size || 3) * 8)); }

    /** A sticky note takes its paper from the chosen pen, softened. */
    function noteFill(color) {
        var map = {
            '#000': '#fef3c7', '#000000': '#fef3c7',
            '#f44336': '#fee2e2', '#4CAF50': '#dcfce7',
            '#2196F3': '#dbeafe', '#FFC107': '#fef3c7'
        };
        return map[color] || '#fef3c7';
    }

    /* ------------------------------------------------------------- committing */

    /**
     * Put strokes on the board the way a pen stroke gets there: drawn, kept,
     * broadcast, and recorded as one undo step.
     */
    function commit(strokes) {
        if (!strokes || !strokes.length) return;

        strokes.forEach(function (s) {
            drawStroke(s);
            addStrokeToBoardState(s);
        });

        if (typeof connected !== 'undefined' && connected && typeof webrtcHelper !== 'undefined' && webrtcHelper) {
            // JSON, not the binary encoding: nine floats have nowhere to put a
            // sentence, and a shape is a handful of segments rather than a
            // stream, so the size saved would not have been worth the branch.
            webrtcHelper.broadcastDataChannel({
                type: 'stroke-batch',
                strokes: strokes,
                sender: typeof username !== 'undefined' ? username : 'me',
                color: currentColor
            });
        }

        // One shape is one undo step.
        if (typeof captureHistorySnapshot === 'function') captureHistorySnapshot();
        if (typeof recordDrawActivity === 'function') recordDrawActivity();
        if (typeof endAction === 'function') endAction();
    }

    /* ------------------------------------------------------- drawing the text */

    /**
     * Render a text or note stroke. Shared by the local draw, the redraw from
     * board state, and the receive loop, so a note looks the same however it
     * arrived.
     */
    function paint(context, s) {
        if (!context || !s) return;
        var font = (s.size || 24) + 'px ' + '"Inter", ui-sans-serif, system-ui, sans-serif';
        context.save();

        if (s.type === 'note') {
            var w = (s.x2 - s.x1) || NOTE_W, h = (s.y2 - s.y1) || NOTE_H;
            context.fillStyle = noteFill(s.color);
            context.shadowColor = 'rgba(15, 23, 42, 0.18)';
            context.shadowBlur = 12;
            context.shadowOffsetY = 4;
            roundRect(context, s.x1, s.y1, w, h, 10);
            context.fill();
            context.shadowColor = 'transparent';
            context.fillStyle = '#111827';
            context.font = font;
            context.textBaseline = 'top';
            wrap(context, s.text, s.x1 + 18, s.y1 + 18, w - 36, (s.size || 24) * 1.3);
        } else {
            context.fillStyle = s.color || '#000';
            context.font = font;
            context.textBaseline = 'top';
            wrap(context, s.text, s.x1, s.y1, 900, (s.size || 24) * 1.3);
        }
        context.restore();
    }

    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    function wrap(c, text, x, y, maxWidth, lineHeight) {
        String(text || '').split('\n').forEach(function (para) {
            var words = para.split(' '), line = '';
            words.forEach(function (word) {
                var test = line ? line + ' ' + word : word;
                if (c.measureText(test).width > maxWidth && line) {
                    c.fillText(line, x, y);
                    y += lineHeight;
                    line = word;
                } else {
                    line = test;
                }
            });
            c.fillText(line, x, y);
            y += lineHeight;
        });
    }

    /** Keep the preview layer the same size as the board. */
    function resize() {
        if (!preview || typeof canvas === 'undefined' || !canvas) return;
        preview.width = canvas.width;
        preview.height = canvas.height;
        preview.style.width = canvas.style.width;
        preview.style.height = canvas.style.height;
        preview.style.left = canvas.style.left;
        preview.style.top = canvas.style.top;
    }

    window.WhiteboardTools = {
        owns: owns,
        isShape: isShape,
        begin: begin,
        move: move,
        end: end,
        active: active,
        typing: typing,
        closeEditor: closeEditor,
        paint: paint,
        resize: resize,
        align: align,
        showRemote: showRemote,
        SHAPES: SHAPES,
        TEXTS: TEXTS
    };
})();
