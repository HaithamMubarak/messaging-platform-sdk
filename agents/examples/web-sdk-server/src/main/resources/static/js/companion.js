/**
 * The Companion — a second person, when there isn't one.
 *
 * Two thirds of the demos on this site do nothing until somebody else arrives.
 * The pages say so themselves: Drop toasts "Nobody else is here yet", the
 * whiteboard admits "a whiteboard on your own is a piece of paper". A developer
 * evaluating an SDK will not open a second browser and will not phone a friend.
 * They will close the tab and conclude the demo is empty.
 *
 * So: DO NOT fake the far end in the UI. This starts a real second
 * UserConnectionBase in the same page, joining the same channel through the
 * same service. Presence, host election, the relay and the data channels all
 * carry genuine traffic, and the app under test cannot tell the difference —
 * which is the point. Nothing in any app is special-cased for it.
 *
 * Per-app code is a script object, and only a script object:
 *
 *     Companion.attach(app, {
 *         onJoin:    function (c) { c.send({ type: 'hello' }); },
 *         onMessage: function (c, peer, msg) { ... },
 *         every:     [1500, function (c) { ... }]
 *     });
 *
 * It joins AFTER the human, so the human keeps the host seat and the app's
 * own host logic is exercised rather than bypassed. It is labelled as
 * synthetic everywhere it appears, and the note it installs says plainly that
 * the latency you see is not representative — there is no network between the
 * two connections.
 */
(function (global) {
    'use strict';

    var DEFAULT_NAME = 'Companion';

    /**
     * UserConnectionBase assigns window.channel on connect, because the shared
     * helpers in common-utils.js (the agents badge, the agents modal, the
     * disconnect button) predate the class and read the live channel from
     * there. A second instance would therefore quietly repoint all of that at
     * the companion — the human's own disconnect button would hang up the
     * wrong connection. So the global is saved and put back around anything
     * that connects.
     */
    function preservingGlobalChannel(fn) {
        var saved = global.channel;
        return Promise.resolve()
            .then(fn)
            .then(function (v) { global.channel = saved; return v; },
                  function (e) { global.channel = saved; throw e; });
    }

    function Companion(app, script, options) {
        this.app = app;
        this.script = script || {};
        this.opts = options || {};
        this.name = this.opts.name || DEFAULT_NAME;
        this.peer = null;
        this.timers = [];
        this.active = false;
    }

    /** What the per-app script is handed: a small, safe surface. */
    Companion.prototype._api = function () {
        var self = this;
        return {
            name: self.name,
            /** Send as the companion. No target = the app's normal routing. */
            send: function (data, to) {
                if (!self.peer) return 0;
                return self.peer.sendData(data, to || null);
            },
            /** Send addressed to whoever is host right now. */
            toHost: function (data) {
                if (!self.peer) return 0;
                var host = self.peer._getHostName && self.peer._getHostName();
                if (!host || host === self.name) return 0;
                return self.peer.sendData(data, host);
            },
            /** The companion's own connection, for anything unusual. */
            connection: function () { return self.peer; },
            /** The app the companion is keeping company. */
            host: function () { return self.app; }
        };
    };

    Companion.prototype._run = function (hook, args) {
        var fn = this.script[hook];
        if (typeof fn !== 'function') return;
        try {
            fn.apply(null, [this._api()].concat(args || []));
        } catch (e) {
            // A broken script must never take the demo down with it.
            console.warn('[Companion] script hook "' + hook + '" threw:', e);
        }
    };

    Companion.prototype.start = function () {
        var self = this;
        if (this.active) return Promise.resolve(this);
        // A top-level `class` is a global lexical binding, not a window
        // property, so look for the bare identifier as well as the global.
        var Base = (typeof UserConnectionBase !== 'undefined')
            ? UserConnectionBase
            : global.UserConnectionBase;
        if (!Base) {
            console.warn('[Companion] UserConnectionBase is not loaded');
            return Promise.resolve(null);
        }

        var app = this.app;
        // Same room, same credentials — a genuine second member, not a mock.
        var creds = {
            username: this.name,
            channelName: app.channelName || (app.options && app.options.channelName),
            channelPassword: app.channelPassword || (app.options && app.options.channelPassword)
        };
        if (!creds.channelName) {
            console.warn('[Companion] the app is not in a room yet');
            return Promise.resolve(null);
        }

        // Mirror the app's own transport options, or the companion joins on a
        // different footing and the app's assumptions stop holding.
        var opts = {
            customType: (app.options && app.options.customType) || undefined,
            autoCreateDataChannel: !!(app.options && app.options.autoCreateDataChannel),
            dataChannelName: (app.options && app.options.dataChannelName) || undefined,
            dataChannelOptions: (app.options && app.options.dataChannelOptions) || undefined,
            storagePrefix: (app.options && app.options.storagePrefix) || undefined
        };

        // UserConnectionBase is deliberately abstract — it throws if you
        // construct it directly, because an app is expected to subclass it and
        // supply its own behaviour. The companion has no behaviour of its own
        // (the per-app script is the behaviour), so it subclasses with an empty
        // body rather than defeating the guard.
        var CompanionPeer = Companion._peerClass;
        if (!CompanionPeer || Companion._peerBase !== Base) {
            CompanionPeer = class CompanionPeer extends Base {};
            Companion._peerClass = CompanionPeer;
            Companion._peerBase = Base;
        }

        var peer = new CompanionPeer(opts);
        peer.isCompanion = true;             // so an app can tell, if it cares

        peer.onGameMessage = function (msg) {
            self._run('onMessage', [msg && msg.from, msg && msg.data]);
        };
        peer.onDataChannelMessage = function (peerId, data) {
            self._run('onData', [peerId, data]);
        };

        this.peer = peer;
        this.active = true;

        return preservingGlobalChannel(function () {
            return peer.connect(creds);
        }).then(function () {
            self._run('onJoin', []);
            self._startTimers();
            self._mark();
            return self;
        }).catch(function (err) {
            console.warn('[Companion] could not join:', err);
            self.active = false;
            self.peer = null;
            return null;
        });
    };

    Companion.prototype._startTimers = function () {
        var self = this;
        var every = this.script.every;
        if (!every) return;
        var list = Array.isArray(every[0]) ? every : [every];
        list.forEach(function (pair) {
            var ms = pair[0], fn = pair[1];
            if (typeof fn !== 'function' || !(ms > 0)) return;
            self.timers.push(setInterval(function () {
                try {
                    fn(self._api());
                } catch (e) {
                    console.warn('[Companion] interval script threw:', e);
                }
            }, ms));
        });
    };

    /** Label the companion wherever the app draws people. */
    Companion.prototype._mark = function () {
        var self = this;
        // Apps draw their rosters differently, so this is a best-effort list of
        // the shapes actually in use here, overridable per app. Rows are often
        // rebuilt wholesale (Drop uses replaceChildren), which is why the mark
        // is re-applied rather than set once.
        var selector = this.opts.markSelector ||
            '[data-user], [data-peer], .peer, .user, .member, .roster__item';
        var apply = function () {
            var nodes = document.querySelectorAll(selector);
            nodes.forEach(function (n) {
                if (n.dataset.companionMarked) return;
                var text = (n.textContent || '');
                if (text.indexOf(self.name) === -1) return;
                n.dataset.companionMarked = '1';
                n.classList.add('is-companion');
                var tag = document.createElement('span');
                tag.className = 'badge badge--info companion-tag';
                tag.textContent = 'simulated';
                n.appendChild(tag);
            });
        };
        apply();
        // Rosters redraw; re-mark rather than fight whoever owns the DOM.
        this._markTimer = setInterval(apply, 1200);
    };

    Companion.prototype.stop = function () {
        this.timers.forEach(clearInterval);
        this.timers = [];
        clearInterval(this._markTimer);
        if (this.peer) {
            var saved = global.channel;
            try { this.peer.disconnect(); } catch (e) { /* going away anyway */ }
            global.channel = saved;
            this.peer = null;
        }
        this.active = false;
    };

    /** The button, and the honesty note that goes with it. */
    function installControl(companion, opts) {
        var right = document.querySelector('.sdk-header__right');
        if (!right) return null;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost btn--sm companion-btn';
        btn.innerHTML = '<svg class="icon icon--sm" aria-hidden="true">' +
                        '<use href="#i-user-plus"></use></svg><span>Add a companion</span>';
        btn.addEventListener('click', function () {
            if (companion.active) {
                companion.stop();
                btn.querySelector('span').textContent = 'Add a companion';
                btn.classList.remove('is-on');
                return;
            }
            btn.disabled = true;
            companion.start().then(function (ok) {
                btn.disabled = false;
                if (!ok) return;
                btn.querySelector('span').textContent = 'Remove companion';
                btn.classList.add('is-on');
                if (opts.note !== false) installNote(opts);
            });
        });

        // Before the first onConnect there is no room to join.
        right.insertBefore(btn, right.firstChild);
        return btn;
    }

    function installNote(opts) {
        var side = document.querySelector('.sdk-side');
        if (!side || side.querySelector('.companion-note')) return;
        var p = document.createElement('p');
        p.className = 'sdk-note companion-note';
        p.textContent = opts.noteText ||
            'The companion is a second connection running in this tab — real messages, ' +
            'real relay, but no network between you, so the latency here is not representative.';
        side.appendChild(p);
    }

    /**
     * Wire a companion into an app. Returns the Companion, whose button appears
     * in the header once there is a room to join.
     */
    Companion.attach = function (app, script, options) {
        var opts = options || {};
        var companion = new Companion(app, script, opts);
        var btn = installControl(companion, opts);
        if (!btn) return companion;

        // Only offer it once the human is actually in a room.
        if (app.connected) {
            btn.hidden = false;
        } else {
            btn.hidden = true;
            var poll = setInterval(function () {
                if (app.connected) { btn.hidden = false; clearInterval(poll); }
            }, 400);
            setTimeout(function () { clearInterval(poll); }, 120000);
        }

        global.addEventListener('beforeunload', function () { companion.stop(); });
        return companion;
    };

    global.Companion = Companion;
})(window);
