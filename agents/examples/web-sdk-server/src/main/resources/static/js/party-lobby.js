/*
 * PartyLobby — the first screen of a game, instead of a channel form.
 *
 * Players met "Channel Name / Channel Password / Save this channel" before
 * they met the game. That is the SDK's lesson, not the player's problem. The
 * lobby leads with the game (what it is, how many, how long, how to play) and
 * two actions: Start a party, or Join with a code. The channel form is still
 * one click away under "Advanced", unchanged, for anyone who wants it.
 *
 * A party code IS the invite: the channel and its password are derived from
 * the code and the game's channel prefix, so everyone who types the same code
 * lands in the same encrypted room, and a different game with the same code
 * does not.
 *
 * Opt in from loadConnectionModal (connection-modal.js calls attach()):
 *
 *   loadConnectionModal({ title, channelPrefix, onConnect,
 *       partyLobby: { title: 'Air Hockey', players: '2–6 players', minutes: 3,
 *                     howTo: ['Drag your mallet', 'First to 7 wins'],
 *                     solo: null } });
 *
 * The lobby fills the modal's own fields and presses its Connect button, so
 * saving, errors and reconnects behave exactly as they always did. It stays
 * out of the way when the page was opened from a shared link (the URL hash
 * carries the channel) — that path already connects by itself.
 */
(function () {
    'use strict';

    // A party code is the modal's room code (PartyCode in connection-modal.js):
    // twelve digits that check themselves and belong to one game. The 6-letter
    // codes this lobby used to make still join the rooms they always did, so an
    // invite already sent keeps working. No 0/O, 1/I/L in those.
    const LEGACY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const LEGACY_LENGTH = 6;
    const STYLE_ID = 'party-lobby-style';

    const appIdOf = (config) => window.PartyCode.appIdOf(config);

    function newCode(config) {
        return window.PartyCode.newCode(appIdOf(config));
    }

    /** A typed code, cleaned: a 12-digit code of this game, an old 6-letter code, or null. */
    function normalize(config, input) {
        const digits = window.PartyCode.digitsOf(input);
        if (window.PartyCode.isValid(appIdOf(config), digits)) return digits;
        const legacy = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const valid = legacy.length === LEGACY_LENGTH && [...legacy].every((c) => LEGACY_ALPHABET.includes(c));
        return valid ? legacy : null;
    }

    const isLegacy = (code) => !/^\d+$/.test(code);

    /** Where a code leads: one channel and password per game and code. */
    function roomFor(config, code) {
        if (!isLegacy(code)) return window.PartyCode.roomFor(appIdOf(config), code);
        const prefix = String(config.channelPrefix || 'party-');
        return { channel: prefix + 'p-' + code.toLowerCase(), password: 'party-' + code + '-' + prefix };
    }

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v === null || v === undefined || v === false) return;
            if (k === 'text') node.textContent = v;
            else if (k === 'class') node.className = v;
            else node.setAttribute(k, v === true ? '' : v);
        });
        (children || []).forEach((c) => node.append(c));
        return node;
    }

    function openedFromSharedLink() {
        return location.hash.length > 1;
    }

    /* ------------------------------------------------------------ the DOM */

    function header(config, lobby) {
        const meta = [lobby.players, lobby.minutes && '~' + lobby.minutes + ' min',
            'phones or laptops'].filter(Boolean).join(' · ');
        const how = el('details', { class: 'pl-how' }, [el('summary', { text: 'How to play' }),
            el('ol', {}, (lobby.howTo || []).map((line) => el('li', { text: line })))]);
        return [el('h1', { class: 'pl-title', text: lobby.title || config.collapsedTitle || config.title || 'Play' }),
            el('p', { class: 'pl-meta', text: meta }), lobby.howTo && lobby.howTo.length ? how : ''];
    }

    function form(prefillCode, name) {
        return {
            name: el('input', { class: 'pl-input', id: 'plName', maxlength: '24', autocomplete: 'nickname', value: name }),
            start: el('button', { class: 'pl-btn pl-btn--primary', type: 'button', text: 'Start a party' }),
            code: el('input', { class: 'pl-input pl-code', id: 'plCode', autocomplete: 'off', inputmode: 'numeric',
                spellcheck: 'false', placeholder: '0000 0000 0000',
                value: prefillCode ? (isLegacy(prefillCode) ? prefillCode : window.PartyCode.format(prefillCode)) : '',
                'aria-label': 'Party code' }),
            join: el('button', { class: 'pl-btn', type: 'button', text: 'Join' }),
            error: el('p', { class: 'pl-error', role: 'alert' }),
            advanced: el('button', { class: 'pl-link', type: 'button', text: 'Advanced: channel name and password' })
        };
    }

    function layout(config, lobby, f) {
        const solo = lobby.solo ? el('button', { class: 'pl-link', type: 'button', text: 'Try it solo' }) : '';
        if (solo) solo.addEventListener('click', () => { close(); lobby.solo(); });
        const card = el('div', { class: 'pl-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'plTitle' }, [
            ...header(config, lobby),
            el('label', { class: 'pl-label', for: 'plName', text: 'Your name' }), f.name,
            f.start,
            el('div', { class: 'pl-or', text: 'or join a party' }),
            el('div', { class: 'pl-join' }, [f.code, f.join]),
            f.error,
            el('div', { class: 'pl-foot' }, [solo, f.advanced])
        ]);
        card.querySelector('.pl-title').id = 'plTitle';
        return el('div', { class: 'pl-overlay', id: 'partyLobby' }, [card]);
    }

    /* ------------------------------------------------------- the behaviour */

    let current = null;   // { config }

    function close() {
        const node = document.getElementById('partyLobby');
        if (node) node.remove();
    }

    function setField(id, value) {
        const input = document.getElementById(id);
        if (input) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }

    /** Fill the modal's own fields and press its own Connect. */
    function enter(code, name) {
        const room = roomFor(current.config, code);
        setField('usernameInput', name);
        setField('quickUsernameInput', name);
        setField('channelInput', room.channel);
        setField('passwordInput', room.password);
        try { localStorage.setItem((current.config.localStoragePrefix || '') + 'username', name); } catch (e) { /* private mode */ }
        const url = new URL(location.href);
        // `?code=` is the modal's own invite parameter; an old code keeps `?party=`.
        url.searchParams.delete(isLegacy(code) ? 'code' : 'party');
        url.searchParams.set(isLegacy(code) ? 'party' : 'code', code);
        history.replaceState(null, '', url.pathname + url.search + location.hash);
        close();
        // Connect with the form collapsed, as the shared-link path does, so the
        // player never sees the channel form. A failure re-expands it with the
        // error (connection-modal.js showError).
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.add('active', 'collapsed');
        const connect = document.getElementById('connectBtn');
        if (connect) connect.click();
        // A 12-digit room gets the modal's own code chip once it is joined.
        if (isLegacy(code)) whenJoined(modal, () => showChip(code, room));
    }

    /*
     * The code is shown once the game is actually joined — which is when the
     * game hides the connection modal. Before that it would sit on top of the
     * connecting bar, and after a failed connect it would advertise a party
     * nobody is in.
     */
    function whenJoined(modal, then) {
        const joined = () => !modal || !modal.classList.contains('active');
        if (joined()) { then(); return; }
        const watch = new MutationObserver(() => {
            if (!joined()) return;
            watch.disconnect();
            then();
        });
        watch.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    function wire(f) {
        const nameOf = () => f.name.value.trim();
        const needName = () => {
            if (nameOf()) return false;
            f.error.textContent = 'Pick a name first — it is how the others will see you.';
            f.name.focus();
            return true;
        };
        f.start.addEventListener('click', () => { if (!needName()) enter(newCode(current.config), nameOf()); });
        const join = () => {
            if (needName()) return;
            const code = normalize(current.config, f.code.value);
            if (!code) {
                const short = window.PartyCode.digitsOf(f.code.value).length < window.PartyCode.LENGTH;
                f.error.textContent = short ? 'A party code is ' + window.PartyCode.LENGTH + ' digits.'
                    : 'That code isn’t right. Check the digits, and that it is for this game.';
                f.code.focus();
                return;
            }
            enter(code, nameOf());
        };
        f.code.addEventListener('input', () => {
            if (f.code.selectionStart === f.code.value.length && /^[\d\s]*$/.test(f.code.value)) {
                f.code.value = window.PartyCode.format(f.code.value);
            }
            f.error.textContent = '';
        });
        f.join.addEventListener('click', join);
        f.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
        f.advanced.addEventListener('click', close);
    }

    function defaultName(config) {
        try {
            const saved = localStorage.getItem((config.localStoragePrefix || '') + 'username');
            if (saved) return saved;
        } catch (e) { /* private mode */ }
        return window.generateRandomAgentName ? window.generateRandomAgentName() : '';
    }

    /* The code, visible after joining, with the room's existing invite. */
    function showChip(code, room) {
        const invite = el('button', { class: 'pl-chip__btn', type: 'button', text: 'Invite' });
        invite.addEventListener('click', () => {
            if (window.ShareModal && ShareModal.show) ShareModal.show(room.channel, room.password);
            else if (navigator.clipboard) navigator.clipboard.writeText(location.href);
        });
        const dismiss = el('button', { class: 'pl-chip__x', type: 'button', 'aria-label': 'Hide party code', text: '×' });
        const chip = el('div', { class: 'pl-chip', id: 'partyChip' }, [
            el('span', { text: 'Party ' }), el('strong', { text: code }), invite, dismiss]);
        dismiss.addEventListener('click', () => chip.remove());
        document.body.append(chip);
    }

    function attach(config) {
        if (!config || !config.partyLobby || openedFromSharedLink()) return false;
        injectStyle();
        current = { config: config };
        const params = new URLSearchParams(location.search);
        const code = normalize(config, params.get('code') || params.get('party'));
        const f = form(code, defaultName(config));
        document.body.append(layout(config, config.partyLobby, f));
        wire(f);
        (code ? f.join : f.start).focus();
        return true;
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = [
            '.pl-overlay{position:fixed;inset:0;z-index:100010;display:grid;place-items:center;padding:16px;background:var(--bg,#0b1120);overflow:auto}',
            '.pl-card{width:min(420px,100%);background:var(--surface-1,#111827);color:var(--text,#e5e7eb);border:1px solid var(--border,#1f2937);border-radius:16px;padding:24px;display:grid;gap:12px;font-family:var(--font-sans,system-ui,sans-serif)}',
            '.pl-title{margin:0;font:700 26px/1.2 var(--font-display,inherit)}',
            '.pl-meta{margin:-6px 0 0;color:var(--text-muted,#9ca3af);font-size:14px}',
            '.pl-how summary{cursor:pointer;color:var(--accent-ink,var(--accent,#2dd4bf));font-size:14px;min-height:32px;display:flex;align-items:center}',
            '.pl-how ol{margin:6px 0 0;padding-left:20px;color:var(--text-body,#d1d5db);font-size:14px;line-height:1.6}',
            '.pl-label{font-size:13px;color:var(--text-muted,#9ca3af)}',
            '.pl-input{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;border-radius:10px;border:1px solid var(--border-strong,#374151);background:var(--bg,#0b1120);color:inherit;font:inherit;font-size:16px}',
            '.pl-code{letter-spacing:.06em;font-family:var(--font-mono,monospace);text-align:center}',
            '.pl-btn{min-height:48px;border-radius:10px;border:1px solid var(--border-strong,#374151);background:transparent;color:inherit;font:inherit;font-weight:700;font-size:16px;cursor:pointer;padding:0 18px}',
            '.pl-btn--primary{background:var(--accent,#2dd4bf);border-color:var(--accent,#2dd4bf);color:#07110c}',
            '.pl-or{text-align:center;color:var(--text-muted,#9ca3af);font-size:13px}',
            '.pl-join{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}',
            '.pl-error{margin:0;min-height:1em;color:var(--danger,#f87171);font-size:14px}',
            '.pl-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}',
            '.pl-link{background:none;border:0;color:var(--text-muted,#9ca3af);font:inherit;font-size:13px;text-decoration:underline;cursor:pointer;min-height:32px;padding:4px 0}',
            '.pl-chip{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100005;display:flex;align-items:center;gap:8px;padding:6px 6px 6px 14px;border-radius:999px;background:var(--surface-2,#1f2937);color:var(--text,#e5e7eb);border:1px solid var(--border-strong,#374151);font:14px var(--font-sans,system-ui,sans-serif);box-shadow:0 6px 20px #0006}',
            '.pl-chip strong{letter-spacing:.15em;font-family:var(--font-mono,monospace)}',
            '.pl-chip__btn{min-height:32px;padding:0 12px;border-radius:999px;border:0;background:var(--accent,#2dd4bf);color:#07110c;font-weight:700;cursor:pointer}',
            '.pl-chip__x{min-width:32px;min-height:32px;border:0;background:none;color:inherit;font-size:18px;cursor:pointer}',
            // Last, so it wins over .pl-join above: beside Join a 12-digit code was clipped on a phone.
            '@media (max-width:420px){.pl-join{grid-template-columns:minmax(0,1fr)}}'
        ].join('\n');
        document.head.appendChild(s);
    }

    window.PartyLobby = { attach: attach, normalize: normalize, roomFor: roomFor, newCode: newCode, LEGACY_ALPHABET: LEGACY_ALPHABET };
})();
