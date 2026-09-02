/**
 * The wire panel — "show me the call that did that".
 *
 * Every demo on this site is a working example of the SDK, and almost none of
 * them let you SEE the SDK. You draw a stroke, something appears on the other
 * screen, and the method that carried it is invisible unless you open the
 * source. Pulse is the only app that names its calls, and only in prose.
 *
 * This wraps an app's UserConnectionBase instance and prints one row per call:
 * the method, where it went, and how big it was. It is deliberately a subset of
 * what Under the Hood draws — that page is about the topology, this is about
 * the API — and it needs no per-app code beyond one line:
 *
 *     SdkWire.attach(app, { mount: document.getElementById('wire') });
 *
 * Wrapping rather than patching: the originals are called through, so an app
 * behaves identically whether or not the panel is mounted, and detach() puts
 * everything back.
 */
(function (global) {
    'use strict';

    /* Methods worth showing. `label` is what the row prints; `target` pulls the
       destination out of the argument list, since it differs per method. */
    var SEND_METHODS = [
        { name: 'sendData', target: function (args) { return args[1] || null; } },
        { name: 'sendCustomEventMessage', target: function (args) { return args[1] || '*'; } }
    ];
    var STORAGE_METHODS = ['storagePut', 'storageAdd', 'storageGet', 'storageGetList',
                           'storageKeys', 'storageValues', 'storageDeleteByKey'];

    var MAX_ROWS = 200;

    function bytes(v) {
        if (v == null) return '';
        var n;
        try {
            n = typeof v === 'string' ? v.length : JSON.stringify(v).length;
        } catch (e) {
            return '';                       // circular or otherwise unmeasurable
        }
        return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';
    }

    function clock(d) {
        return String(d.getHours()).padStart(2, '0') + ':' +
               String(d.getMinutes()).padStart(2, '0') + ':' +
               String(d.getSeconds()).padStart(2, '0');
    }

    function SdkWire(app, options) {
        this.app = app;
        this.opts = options || {};
        this.rows = [];
        this.restore = [];                   // [obj, name, originalFn]
        this.mount = this.opts.mount || null;
        this.listEl = null;
        this._build();
        this._hookSends();
        this._hookStorage();
    }

    SdkWire.prototype._build = function () {
        if (!this.mount) return;
        this.mount.innerHTML = '';

        var title = document.createElement('div');
        title.className = 'sdk-side__title';
        var label = document.createElement('span');
        label.textContent = this.opts.title || 'On the wire';
        title.appendChild(label);

        var count = document.createElement('span');
        count.className = 'sdk-wire__count';
        title.appendChild(count);
        this.countEl = count;

        var list = document.createElement('div');
        list.className = 'sdk-wire sdk-scroll';

        var empty = document.createElement('p');
        empty.className = 'sdk-wire__empty';
        empty.textContent = 'Nothing sent yet — do something and the calls appear here.';
        list.appendChild(empty);

        this.mount.appendChild(title);
        this.mount.appendChild(list);
        this.listEl = list;

        if (this.opts.note !== false) {
            var note = document.createElement('p');
            note.className = 'sdk-note';
            note.textContent = this.opts.note ||
                'Every row is a real SDK call this page just made.';
            this.mount.appendChild(note);
        }
    };

    /* Wrap one method on one object, remembering how to undo it. */
    SdkWire.prototype._wrap = function (obj, name, describe) {
        if (!obj || typeof obj[name] !== 'function') return;
        var self = this;
        var original = obj[name];
        this.restore.push([obj, name, original]);
        obj[name] = function () {
            var args = Array.prototype.slice.call(arguments);
            var result;
            try {
                result = original.apply(this, arguments);
            } finally {
                // Logging must never be able to break the call it is watching.
                try { self.add(describe(args, result)); } catch (e) { /* ignore */ }
            }
            return result;
        };
    };

    SdkWire.prototype._hookSends = function () {
        var self = this;
        SEND_METHODS.forEach(function (m) {
            self._wrap(self.app, m.name, function (args, result) {
                var to = m.target(args);
                var where;
                if (!to || to === '*') {
                    // An untargeted send in host mode does not mean "everyone":
                    // a guest reaches the host, which decides whether to relay.
                    where = self.app.isHost && self.app.isHost() ? 'to room' : 'to host';
                } else {
                    where = 'to ' + to;
                }
                var reached = typeof result === 'number' ? result : null;
                return {
                    fn: m.name,
                    meta: where + ' · ' + bytes(args[0]) +
                          (reached !== null ? ' · ' + reached + ' peer' + (reached === 1 ? '' : 's') : ''),
                    kind: (!to || to === '*') ? 'broadcast' : 'directed'
                };
            });
        });
    };

    SdkWire.prototype._hookStorage = function () {
        var self = this;
        var channel = this.app && this.app.channel;
        if (!channel) return;
        STORAGE_METHODS.forEach(function (name) {
            self._wrap(channel, name, function (args) {
                // storageGetList takes the key as a bare string; the rest take
                // an options object. Both shapes have to be read here.
                var first = args[0];
                var key = typeof first === 'string' ? first
                        : (first && first.storageKey) || '';
                var size = first && first.content != null ? ' · ' + bytes(first.content) : '';
                return { fn: name, meta: (key ? key : '(all keys)') + size, kind: 'storage' };
            });
        });
    };

    SdkWire.prototype.add = function (entry) {
        if (!entry) return;
        entry.at = new Date();
        this.rows.push(entry);
        if (this.rows.length > MAX_ROWS) this.rows.shift();
        this._render(entry);
    };

    SdkWire.prototype._render = function (entry) {
        if (!this.listEl) return;
        var empty = this.listEl.querySelector('.sdk-wire__empty');
        if (empty) empty.remove();

        var row = document.createElement('div');
        row.className = 'sdk-wire__row sdk-wire__row--' + entry.kind;

        var t = document.createElement('span');
        t.className = 'sdk-wire__t';
        t.textContent = clock(entry.at);

        var fn = document.createElement('span');
        fn.className = 'sdk-wire__fn';
        fn.textContent = entry.fn;

        var meta = document.createElement('span');
        meta.className = 'sdk-wire__meta';
        meta.textContent = entry.meta;

        row.appendChild(t);
        row.appendChild(fn);
        row.appendChild(meta);
        this.listEl.appendChild(row);

        while (this.listEl.childElementCount > MAX_ROWS) {
            this.listEl.removeChild(this.listEl.firstElementChild);
        }
        this.listEl.scrollTop = this.listEl.scrollHeight;
        if (this.countEl) this.countEl.textContent = this.rows.length;
    };

    /** Put every wrapped method back. */
    SdkWire.prototype.detach = function () {
        this.restore.forEach(function (r) { r[0][r[1]] = r[2]; });
        this.restore = [];
    };

    /**
     * Storage lives on app.channel, which does not exist until the app
     * connects — so attaching before a connection would silently watch sends
     * only. Wait for the channel when it is not there yet.
     */
    SdkWire.attach = function (app, options) {
        if (!app) return null;
        var wire = new SdkWire(app, options);
        if (!app.channel) {
            var tries = 0;
            var poll = setInterval(function () {
                if (app.channel) {
                    clearInterval(poll);
                    wire._hookStorage();
                } else if (++tries > 120) {   // ~60s, then give up quietly
                    clearInterval(poll);
                }
            }, 500);
        }
        return wire;
    };

    global.SdkWire = SdkWire;
})(window);
