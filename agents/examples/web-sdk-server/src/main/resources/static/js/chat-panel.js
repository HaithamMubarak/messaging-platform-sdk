/**
 * ChatPanel — shared in-room chat for the SDK's apps and mini-games.
 *
 * Every game that wanted chat was rebuilding the same four things: a panel, an
 * unread badge, the relay rules, and a way for a round to turn typing into
 * something other than chat. This owns all four.
 *
 * Transport is the star topology the games already use: a line goes to the host
 * as { type: 'chat' }, the host relays it to the room, and each client renders
 * it once — its own copy locally at send time, everyone else's on arrival. The
 * host is also the only place a muted player can actually be silenced, since a
 * client can always be told to stop and simply not.
 *
 * Two hooks carry the game-specific rules:
 *   onIntercept(text) -> truthy to consume the line (a guess, a command, a
 *                        refusal) instead of sending it as chat
 *   isMuted(name)     -> host-side: drop this sender's lines entirely
 *
 * Usage:
 *   this.chat = new ChatPanel({ game: this, toggleId: 'chatToggle' });
 *   // in onDataChannelMessage(peerId, data):
 *   if (this.chat.handleMessage(peerId, data)) return;
 *
 * The panel injects its own markup, so a page needs only the stylesheet and,
 * optionally, its own toggle button to adopt it.
 */
(function () {
    'use strict';

    const DEFAULTS = {
        title: '💬 Chat',
        placeholder: 'Say something…',
        side: 'left',          // which side of the screen the panel sits on
        bottom: 16,            // px above the bottom edge, to clear a game's dock
        maxLines: 80,
        maxLength: 120,
        autoFocus: false,      // focus the input when opened programmatically
        openOnMessage: false   // pop open when a message arrives while closed
    };

    let seq = 0;

    class ChatPanel {
        constructor(options) {
            const opts = Object.assign({}, DEFAULTS, options || {});
            if (!opts.game) throw new Error('ChatPanel needs a game (a UserConnectionBase instance)');

            this.game = opts.game;
            this.opts = opts;
            this.id = 'chatPanel' + (++seq === 1 ? '' : seq);
            this.unread = 0;
            this.el = null;
            this.destroyed = false;

            // A game may hand over its own colour scheme for names.
            this.colorFor = opts.colorFor
                || ((name) => (typeof this.game.generateUserColor === 'function'
                    ? this.game.generateUserColor(name) : '#6366f1'));

            this._mount();
        }

        // ---------------------------------------------------------------- DOM

        _mount() {
            const existing = document.getElementById(this.id);
            if (existing) existing.remove();

            const panel = document.createElement('div');
            panel.id = this.id;
            panel.className = 'chat-panel hidden' + (this.opts.side === 'right' ? ' chat-right' : '');
            panel.style.bottom = this.opts.bottom + 'px';
            panel.innerHTML = `
                <div class="chat-head">
                    <span class="chat-title">${esc(this.opts.title)}</span>
                    <button class="chat-close" type="button" aria-label="Close chat">✕</button>
                </div>
                <div class="chat-log" role="log" aria-live="polite"></div>
                <form class="chat-form" autocomplete="off">
                    <input class="chat-input" type="text" maxlength="${this.opts.maxLength}"
                           placeholder="${esc(this.opts.placeholder)}" autocomplete="off">
                    <button class="chat-send" type="submit">Send</button>
                </form>`;
            document.body.appendChild(panel);

            this.el = panel;
            this.titleEl = panel.querySelector('.chat-title');
            this.logEl = panel.querySelector('.chat-log');
            this.inputEl = panel.querySelector('.chat-input');
            this.formEl = panel.querySelector('.chat-form');

            this.formEl.addEventListener('submit', (e) => {
                e.preventDefault();
                const text = this.inputEl.value;
                this.inputEl.value = '';
                this.send(text);
            });
            // Typing must never reach the game's keyboard shortcuts.
            this.inputEl.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Escape') this.inputEl.blur();
            });
            panel.querySelector('.chat-close').addEventListener('click', () => this.open(false));

            this._bindToggle();
        }

        // A game can pass its own button (so it sits in that game's toolbar), or
        // let the panel put a floating one on screen.
        _bindToggle() {
            let toggle = this.opts.toggleId ? document.getElementById(this.opts.toggleId) : null;
            if (!toggle) {
                toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'chat-toggle' + (this.opts.side === 'right' ? ' chat-right' : '');
                toggle.title = 'Chat';
                toggle.innerHTML = '💬';
                document.body.appendChild(toggle);
                this._ownToggle = toggle;
            }
            this.toggleEl = toggle;

            this.badgeEl = this.opts.badgeId ? document.getElementById(this.opts.badgeId) : null;
            if (!this.badgeEl) {
                this.badgeEl = document.createElement('span');
                this.badgeEl.className = 'chat-badge hidden';
                this.badgeEl.textContent = '0';
                toggle.appendChild(this.badgeEl);
            }

            toggle.addEventListener('click', () => this.toggle());
        }

        // ------------------------------------------------------------ display

        isOpen() { return this.el && !this.el.classList.contains('hidden'); }

        toggle() { this.open(!this.isOpen(), true); }

        open(on, focus) {
            if (!this.el) return;
            this.el.classList.toggle('hidden', !on);
            if (!on) return;
            this.unread = 0;
            this._renderBadge();
            if ((focus || this.opts.autoFocus) && !this.inputEl.disabled) this.inputEl.focus();
        }

        /** Retitle the panel and repurpose the input — a round may mute you. */
        setMode(mode) {
            mode = mode || {};
            if (mode.title !== undefined && this.titleEl) this.titleEl.textContent = mode.title;
            if (mode.placeholder !== undefined) this.inputEl.placeholder = mode.placeholder;
            if (mode.disabled !== undefined) {
                this.inputEl.disabled = !!mode.disabled;
                if (mode.disabled && document.activeElement === this.inputEl) this.inputEl.blur();
            }
        }

        add(name, text, opts) {
            if (!this.logEl) return;
            opts = opts || {};
            const line = document.createElement('div');
            line.className = 'chat-line'
                + (opts.me ? ' me' : '') + (opts.system ? ' system' : '') + (opts.guess ? ' guess' : '');
            const who = document.createElement('span');
            who.className = 'chat-who';
            who.style.color = opts.color || this.colorFor(name);
            who.textContent = name;
            const body = document.createElement('span');
            body.className = 'chat-text';
            body.textContent = text;
            line.appendChild(who);
            line.appendChild(body);

            this.logEl.appendChild(line);
            while (this.logEl.children.length > this.opts.maxLines) {
                this.logEl.removeChild(this.logEl.firstChild);
            }
            this.logEl.scrollTop = this.logEl.scrollHeight;

            if (!this.isOpen()) {
                if (this.opts.openOnMessage) this.open(true);
                else { this.unread++; this._renderBadge(); }
            }
        }

        system(text) { this.add('', text, { system: true }); }

        clear() { if (this.logEl) this.logEl.innerHTML = ''; }

        _renderBadge() {
            if (!this.badgeEl) return;
            this.badgeEl.textContent = this.unread > 9 ? '9+' : String(this.unread);
            this.badgeEl.classList.toggle('hidden', this.unread === 0);
        }

        // ---------------------------------------------------------- transport

        /**
         * Send a typed line. The game's own rules get first refusal through
         * onIntercept — that is how a guessing round takes the line instead.
         */
        send(text) {
            text = String(text || '').trim().slice(0, this.opts.maxLength);
            if (!text) return false;
            if (this.opts.onIntercept && this.opts.onIntercept(text)) return true;

            const name = this.game.username;
            // The same rule the host applies to everyone else, applied to me on
            // the way out — the host never receives its own messages, so this is
            // the only place a muted host can be stopped.
            if (this.opts.isMuted && this.opts.isMuted(name)) return false;
            this._transport({ type: 'chat', name, text });
            this.add(name, text, { me: true });
            return true;
        }

        /**
         * Host-side echo of somebody else's line — a wrong guess a game wants
         * the room to see, for instance.
         */
        relay(msg) {
            const payload = { type: 'chat', name: msg.name, text: msg.text, guess: !!msg.guess };
            this._transport(payload);
            this.add(msg.name, msg.text, { guess: !!msg.guess });
        }

        /**
         * Feed incoming data channel traffic in. Returns true when the message
         * was chat and has been dealt with, so a game can `return` on it.
         */
        handleMessage(peerId, data) {
            if (!data || data.type !== 'chat') return false;

            const from = data._fromClient || data.name;
            if (this._isHost() && !data._fromHost) {
                // Everything a client sends lands here first, which is the one
                // place a mute can be enforced for the whole room.
                if (this.opts.isMuted && this.opts.isMuted(from)) return true;
                this._transport(data);
            } else if (!this._blessedByHost(peerId, data)) {
                // A line that reached me without the host's game agreeing to it.
                // UserConnectionBase relays client traffic by itself, so this is
                // how a client that skips the UI talks past a mute. Ignore it.
                return true;
            }
            // My own line was rendered when I sent it.
            if (data.name !== this.game.username) {
                this.add(data.name, data.text, { guess: !!data.guess, system: !!data.system });
            }
            return true;
        }

        /**
         * A line from a client goes to the host ALONE, not to the room.
         *
         * UserConnectionBase auto-relays anything a client sends with a plain
         * sendData() to every other client, before the app sees it — which both
         * delivers each line twice and takes the decision away from the host, so
         * a mute could never be enforced. Addressing the host explicitly keeps
         * the choice of what the room sees where it belongs.
         */
        _transport(payload) {
            if (this.opts.transport) { this.opts.transport(payload); return; }
            const game = this.game;
            if (typeof game.sendData !== 'function') return;
            if (this._isHost()) { game.sendData(payload); return; }
            const host = this._hostName();
            if (host) game.sendData(payload, host);
            else game.sendData(payload);          // no host yet: better than dropping it
        }

        /**
         * True when the host's own code sent this. An auto-relayed client
         * message also arrives from the host, but carries _fromClient — that is
         * what separates "the host said so" from "the host passed it along".
         */
        _blessedByHost(peerId, data) {
            if (data._fromHost) return true;
            if (data._fromClient) return false;
            return peerId === this._hostName();
        }

        _hostName() {
            const game = this.game;
            if (typeof game._hostName === 'function') {
                const n = game._hostName();
                if (n) return n;
            }
            try {
                const users = game.getConnectedUsers() || [];
                return users.length ? users[0] : null;
            } catch (e) {
                return null;
            }
        }

        _isHost() {
            return typeof this.game.isHost === 'function' ? this.game.isHost() : false;
        }

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            if (this.el) this.el.remove();
            if (this._ownToggle) this._ownToggle.remove();
            this.el = this.logEl = this.inputEl = this.formEl = null;
        }
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.ChatPanel = ChatPanel;
})();
