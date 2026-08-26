// ============================================================================
// PartyKit — the shared spine for the "one television, everybody's phone"
// games (Chorus, Autocue, Gavel, Nudge).
//
// All four have the same shape and the same one dangerous rule, so it lives
// here once rather than four times:
//
//   UserConnectionBase in host mode AUTO-RELAYS anything a client sends with a
//   bare sendData(payload) to every other client BEFORE the app sees it. Every
//   one of these games has secrets — the slot you were dealt, the line you
//   wrote, the way you voted, the mission in your pocket — so a client message
//   is ALWAYS addressed to the host and never broadcast.
//
//   * client -> host   toHost(msg)          addressed; the host is the referee
//   * host -> everyone toRoom(msg)          the only broadcaster in the room
//   * host -> one      toPlayer(name, msg)  private, provenance stamped by hand
//
//   Clients trust host traffic by SENDER, not by the `_fromHost` flag — a peer
//   can put that flag on anything. And the host never replays its own
//   broadcast into itself: it has already applied the change, so replaying
//   would apply it twice (a bug this codebase has actually shipped).
//
// Subclasses implement:
//   hostReceive(from, msg)   a player did something (host only)
//   clientReceive(msg)       the host said something (everyone)
//   publicState()            the anonymised picture the host broadcasts
//   applyState(state)        adopt it
//   renderAll()              paint
// ============================================================================
(function () {
    'use strict';

    class PartyGame extends UserConnectionBase {
        constructor(options) {
            super(Object.assign({
                autoCreateDataChannel: true,
                dataChannelOptions: { ordered: true, maxRetransmits: 3 },
            }, options));

            this.phase = 'lobby';
            this.round = 0;
            this.deadline = 0;       // local ms; clients recompute from secondsLeft
            this.secret = null;      // whatever this player alone was told
            this._tick = null;
        }

        // ---------------------------------------------------------- wire

        /** Client -> host. Never a broadcast: these games are made of secrets. */
        toHost(msg) {
            if (this.isHost()) { this.hostReceive(this.username, msg); return 1; }
            const host = this._getHostName();
            if (!host) { console.warn('[PartyKit] no host yet'); return 0; }
            return this.sendData(msg, host);
        }

        /** Host -> everyone. The base class stamps _fromHost on a broadcast. */
        toRoom(msg) {
            if (!this.isHost()) return 0;
            return this.sendData(msg);
        }

        /**
         * Host -> one player. An addressed send skips the base class's
         * provenance stamp, so it goes on by hand — and the receiver checks
         * the sender anyway, which is the check that actually matters.
         */
        toPlayer(name, msg) {
            if (!this.isHost()) return 0;
            if (name === this.username) { this.clientReceive(msg); return 1; }
            return this.sendData(Object.assign({ _fromHost: true }, msg), name);
        }

        onDataChannelMessage(peerId, data) {
            if (!data || typeof data !== 'object') return;

            if (this.isHost()) {
                // Anything reaching the host from a peer is a player action.
                this.hostReceive(data._fromClient || peerId, data);
                return;
            }
            // Everyone else trusts exactly one sender.
            if (peerId !== this._getHostName()) return;
            this.clientReceive(data);
        }

        /** Broadcast the public picture and apply it locally in one move. */
        broadcastState() {
            if (!this.isHost()) return;
            const s = this.publicState();
            this.toRoom(s);
            this.applyState(s);
        }

        // ------------------------------------------------------- roster

        players() { return this.getUserList().map(u => u.name); }
        others()  { return this.players().filter(n => n !== this.username); }
        playerCount() { return this.getUserList().length; }

        /** Everyone but the named player, in roster order. */
        except(name) { return this.players().filter(n => n !== name); }

        pick(list) { return list[Math.floor(Math.random() * list.length)]; }

        shuffled(list) {
            const a = list.slice();
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        }

        // -------------------------------------------------------- clock

        setDeadline(seconds) {
            this.deadline = seconds > 0 ? Date.now() + seconds * 1000 : 0;
        }

        secondsLeft() {
            if (!this.deadline) return 0;
            return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
        }

        /** Clients rebuild the deadline from a duration, so clock skew cannot bite. */
        adoptDeadline(secondsLeft) {
            this.deadline = secondsLeft > 0 ? Date.now() + secondsLeft * 1000 : 0;
        }

        startClock(elementId, everyMs) {
            clearInterval(this._tick);
            this._tick = setInterval(() => this.renderClock(elementId), everyMs || 250);
        }

        renderClock(elementId) {
            const el = document.getElementById(elementId);
            if (!el) return;
            const left = this.secondsLeft();
            if (!this.deadline) { el.textContent = ''; el.classList.remove('is-urgent'); return; }
            el.textContent = left + 's';
            el.classList.toggle('is-urgent', left <= 5);
        }

        // ----------------------------------------------------------- UI

        show(id, on) {
            const el = document.getElementById(id);
            if (el) el.hidden = !on;
        }

        setText(id, text) {
            const el = document.getElementById(id);
            if (el) el.textContent = text == null ? '' : String(text);
        }

        setPhasePill(id, label, tone) {
            const el = document.getElementById(id);
            if (!el) return;
            el.className = 'pill-status ' + (tone || 'is-off');
            el.innerHTML = '<span class="pill-status__dot"></span>' + esc(label);
        }

        /** Paint the roster into a <ul>, with a per-player badge callback. */
        renderRoster(elementId, badgeFor) {
            const el = document.getElementById(elementId);
            if (!el) return;
            el.innerHTML = this.getUserList().map(u => {
                const badge = badgeFor ? badgeFor(u) : (u.isHost ? 'screen' : '');
                return `<li class="pk-player">
                    <span class="avatar" style="background:${u.color}">${esc(u.name.charAt(0).toUpperCase())}</span>
                    <span class="pk-player__name">${esc(u.name)}${u.isSelf ? ' <em>(you)</em>' : ''}</span>
                    ${badge ? `<span class="pk-tag">${esc(badge)}</span>` : ''}
                </li>`;
            }).join('');
        }

        /** Standard connect behaviour: dismiss the modal, name the room, invite. */
        onConnect() {
            setTimeout(() => {
                if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
                if (!this.isHost()) this.toHost({ t: 'hello' });
                this.renderAll();
            }, 900);

            const room = document.getElementById('roomName');
            if (room) room.textContent = this.channelName || 'connected';
            const share = document.getElementById('shareBtn');
            if (share) share.hidden = false;
            this.renderAll();
        }

        onUserJoin()        { if (this.isHost()) this.broadcastState(); this.renderAll(); }
        onUserLeave()       { if (this.isHost()) this.broadcastState(); this.renderAll(); }
        onDataChannelOpen() { if (this.isHost()) this.broadcastState(); this.renderAll(); }

        // Subclasses override these four.
        hostReceive(_from, _msg) {}
        clientReceive(_msg) {}
        publicState() { return { t: 'state', phase: this.phase }; }
        applyState(_s) {}
        renderAll() {}

        escapeHtml(s) { return esc(s); }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /**
     * The bootstrap every one of these pages repeats: build the game on
     * connect, wire the connection modal, honour a shared link, and put the
     * room in the URL so the invite button has something to share.
     */
    function boot(config) {
        let game = null;

        async function connect(username, channel, password) {
            try {
                game = new config.GameClass();
                window[config.globalName] = game;
                await game.initialize();
                await game.connect({ username, channelName: channel, channelPassword: password });
                game.start();

                if (typeof window.encodeChannelAuth === 'function') {
                    const encoded = window.encodeChannelAuth(channel, password, null);
                    if (encoded) {
                        window.history.replaceState(null, '', '#' + encoded + '#' +
                            channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                    }
                }
            } catch (error) {
                console.error('[' + config.globalName + '] connect failed:', error);
                if (window.ConnectionModal) ConnectionModal.fail(error);
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            window.loadConnectionModal({
                localStoragePrefix: config.storagePrefix,
                channelPrefix: config.channelPrefix,
                title: config.title,
                collapsedTitle: config.collapsedTitle || config.title,
                onConnect: connect,
            });

            if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
                MiniGameUtils.processSharedLinkAndAutoConnect({
                    gameName: config.globalName,
                    storagePrefix: config.storagePrefix,
                    connectCallback: async function () {
                        const u = document.getElementById('usernameInput')?.value?.trim();
                        const c = document.getElementById('channelInput')?.value?.trim();
                        const p = document.getElementById('passwordInput')?.value || '';
                        if (u && c) await connect(u, c, p);
                    },
                });
            }

            setTimeout(() => {
                const modal = document.getElementById('connectionModal');
                if (modal) modal.classList.add('active');
            }, 200);
        });
    }

    window.PartyKit = { PartyGame, boot, esc };
})();
