/*
 * PartyLobby — the first screen of a demo, instead of a channel form.
 *
 * Players met "Channel Name / Channel Password / Save this channel" before
 * they met the demo. That is the SDK's lesson, not the player's problem. The
 * lobby leads with the demo (a picture of it, what it is, how to play) and
 * one big button that opens a private room. Joining a friend is a code; the
 * channel form is still one click away under "Advanced", unchanged.
 *
 * A party code IS the invite: the channel and its password are derived from
 * the code and the demo's channel prefix, so everyone who types the same code
 * lands in the same encrypted room, and a different demo with the same code
 * does not.
 *
 * Opt in from loadConnectionModal (connection-modal.js calls attach()):
 *
 *   loadConnectionModal({ title, channelPrefix, onConnect,
 *       partyLobby: { id: 'air-hockey',            // its catalogue entry
 *                     title: 'Air Hockey', players: '2–6 players', minutes: 3,
 *                     start: 'Play now', howTo: ['Drag your mallet', 'First to 7 wins'],
 *                     solo: null } });
 *
 * `id` names the demo's entry in data/catalogue.json, which already carries its
 * screenshot, one-line pitch, the primitives it teaches and its source files;
 * the lobby reads them from there rather than from a second copy per app.
 *
 * The lobby fills the modal's own fields and presses its Connect button, so
 * saving, errors and reconnects behave exactly as they always did. It stays
 * out of the way when the page was opened from a shared link (the URL hash
 * carries the channel) — that path already connects by itself — and steps
 * aside the moment anything types into the form underneath it.
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
    const AVATAR_COLORS = ['#fbbf24', '#2dd4bf', '#fb923c', '#a78bfa', '#38bdf8', '#f472b6'];
    // The form the lobby drives: connection-modal.js's, unless a page with its
    // own form names its fields (`config.fields`; chat.html does).
    const MODAL_FIELDS = { user: 'usernameInput', channel: 'channelInput', password: 'passwordInput',
        connect: 'connectBtn', form: 'connectionModal' };

    // The site root, from where this script was served: the catalogue, the
    // screenshots and the stylesheet are found relative to it on every page.
    const SCRIPT = typeof document !== 'undefined' ? document.currentScript : null;
    const SITE_ROOT = SCRIPT && SCRIPT.src ? new URL('../', SCRIPT.src).href : '';

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

    /** A name's avatar colour: the same name is always the same colour. */
    function avatarColor(name) {
        let h = 0;
        for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return AVATAR_COLORS[h % AVATAR_COLORS.length];
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

    /** Left half: a picture of the demo and how to play it. */
    function showcase(lobby, f) {
        const meta = [lobby.players, lobby.minutes && '~' + lobby.minutes + ' min'].filter(Boolean).join(' · ');
        const steps = (lobby.howTo || []).map((line, i) =>
            el('li', { class: 'pl-step' }, [el('span', { class: 'pl-step__n', text: String(i + 1) }), el('span', { text: line })]));
        const figure = el('figure', { class: 'pl-preview', hidden: true }, [
            f.preview,
            el('figcaption', { class: 'pl-preview__tags' }, [
                el('span', { class: 'pl-tag pl-tag--live', text: 'Preview' }),
                meta ? el('span', { class: 'pl-tag', text: meta }) : ''])
        ]);
        f.figure = figure;
        return el('section', { class: 'pl-show', 'aria-label': 'About this demo' }, [
            figure,
            steps.length ? el('ol', { class: 'pl-steps', 'aria-label': 'How to play' }, steps) : ''
        ]);
    }

    /** Right half: who you are, and the ways in. */
    function controls(config, lobby, f) {
        const title = lobby.title || config.collapsedTitle || config.title || 'Play';
        return el('section', { class: 'pl-play', 'aria-label': 'Join' }, [
            el('h1', { class: 'pl-title', id: 'plTitle', text: title }),
            f.tagline,
            el('div', { class: 'pl-who' }, [f.avatar,
                el('div', { class: 'pl-who__name' }, [el('label', { class: 'pl-label', for: 'plName', text: 'Playing as' }), f.name]),
                f.dice]),
            f.resume || '',
            f.start,
            el('p', { class: 'pl-hint', text: 'A private room, with a code to share.' }),
            f.solo || '',
            el('label', { class: 'pl-label', for: 'plCode', text: 'Got a code from a friend?' }),
            el('div', { class: 'pl-join' }, [f.code, f.join]),
            f.error,
            f.advanced
        ]);
    }

    function form(lobby, prefillCode, name) {
        const icon = (d) => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
            + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
        const f = {
            preview: el('img', { class: 'pl-preview__img', alt: '', decoding: 'async' }),
            tagline: el('p', { class: 'pl-tagline', text: lobby.tagline || '', hidden: !lobby.tagline }),
            avatar: el('span', { class: 'pl-avatar', 'aria-hidden': 'true' }),
            name: el('input', { class: 'pl-input pl-name', id: 'plName', maxlength: '24', autocomplete: 'nickname', value: name }),
            dice: el('button', { class: 'pl-icon-btn', type: 'button', 'aria-label': 'Pick a random name', title: 'Random name' }),
            start: el('button', { class: 'pl-btn pl-btn--primary', type: 'button', text: lobby.start || 'Start a party' }),
            code: el('input', { class: 'pl-input pl-code', id: 'plCode', autocomplete: 'off', inputmode: 'numeric',
                spellcheck: 'false', placeholder: '0000 0000 0000',
                value: prefillCode ? (isLegacy(prefillCode) ? prefillCode : window.PartyCode.format(prefillCode)) : '' }),
            join: el('button', { class: 'pl-btn pl-btn--quiet', type: 'button', text: 'Join' }),
            error: el('p', { class: 'pl-error', role: 'alert' }),
            advanced: el('button', { class: 'pl-link', type: 'button', text: 'Advanced: channel name, saved rooms, sign in' }),
            teach: el('footer', { class: 'pl-teach', hidden: true })
        };
        f.dice.innerHTML = icon('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/>'
            + '<circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/>'
            + '<circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/>');
        if (lobby.solo) f.solo = el('button', { class: 'pl-btn', type: 'button', text: lobby.soloLabel || 'Try it solo' });
        return f;
    }

    function layout(config, lobby, f) {
        const card = el('div', { class: 'pl-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'plTitle',
            style: 'visibility:hidden' }, [
            el('div', { class: 'pl-body' }, [showcase(lobby, f), controls(config, lobby, f)]),
            f.teach
        ]);
        // Covered (page background, nothing drawn) until its stylesheet arrives.
        return el('div', { class: 'pl-overlay pl-loading', id: 'partyLobby',
            style: 'position:fixed;inset:0;z-index:100010;background:#0b1120' }, [card]);
    }

    /* ----------------------------------------- what the catalogue knows */

    /** The demo's catalogue entry fills the picture, the pitch and the footer. */
    function fromCatalogue(lobby, f) {
        if (!lobby.id || !SITE_ROOT || !window.fetch) return;
        fetch(SITE_ROOT + 'data/catalogue.json').then((r) => (r.ok ? r.json() : null)).then((cat) => {
            const entry = cat && (cat.entries || []).find((e) => e.id === lobby.id);
            if (!entry) return;
            if (entry.image) {
                f.preview.src = SITE_ROOT + entry.image;
                f.preview.alt = entry.imageAlt || '';
                f.figure.hidden = false;
            }
            if (!lobby.tagline && entry.blurb) { f.tagline.textContent = entry.blurb; f.tagline.hidden = false; }
            fillTeach(f.teach, entry.badges || [], cat.github && entry.source && entry.source[0]
                ? cat.github + entry.source[0] : null);
        }).catch(() => { /* the lobby works without its pictures */ });
    }

    function fillTeach(footer, badges, sourceUrl) {
        if (!badges.length && !sourceUrl) return;
        footer.append(el('span', { class: 'pl-teach__lead', text: 'What this demo teaches' }));
        badges.forEach((b) => footer.append(el('span', { class: 'pl-chip-tag', text: b })));
        if (sourceUrl) footer.append(el('a', { class: 'pl-teach__src', href: sourceUrl, target: '_blank', rel: 'noopener', text: 'Read the source' }));
        footer.hidden = false;
    }

    /* ------------------------------------------------------- the behaviour */

    let current = null;   // { config, filling }

    function close() {
        const node = document.getElementById('partyLobby');
        if (node) node.remove();
    }

    function setField(id, value) {
        const input = document.getElementById(id);
        if (input) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }

    function rememberName(name) {
        try { localStorage.setItem((current.config.localStoragePrefix || '') + 'username', name); } catch (e) { /* private mode */ }
    }

    const fieldsOf = (config) => Object.assign({}, MODAL_FIELDS, config.fields);

    /** Close the lobby and press the form's own Connect with whatever its fields hold. */
    function pressConnect() {
        close();
        const fields = fieldsOf(current.config);
        // Connect through the form's own button, so a failure shows its error
        // there (connection-modal.js showError). The modal no longer collapses.
        const modal = fields.form === MODAL_FIELDS.form ? document.getElementById(fields.form) : null;
        if (modal) modal.classList.add('active');
        const connect = document.getElementById(fields.connect);
        if (connect) connect.click();
        return modal;
    }

    /** Fill the modal's own fields and press its own Connect. */
    function enter(code, name) {
        const room = roomFor(current.config, code);
        const fields = fieldsOf(current.config);
        current.filling = true;
        setField(fields.user, name);
        setField(fields.channel, room.channel);
        setField(fields.password, room.password);
        current.filling = false;
        rememberName(name);
        const url = new URL(location.href);
        // `?code=` is the modal's own invite parameter; an old code keeps `?party=`.
        url.searchParams.delete(isLegacy(code) ? 'code' : 'party');
        url.searchParams.set(isLegacy(code) ? 'party' : 'code', code);
        history.replaceState(null, '', url.pathname + url.search + location.hash);
        const modal = pressConnect();
        // A 12-digit room gets the modal's own code chip once it is joined; a
        // page with its own form has no such chip, so the lobby shows the code.
        if (isLegacy(code) || !modal) whenJoined(modal, () => showChip(code, room));
    }

    /** Back into the room the modal already holds: the one this browser was last in. */
    function resume(name) {
        current.filling = true;
        setField(fieldsOf(current.config).user, name);
        current.filling = false;
        rememberName(name);
        pressConnect();
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

    function wireName(f) {
        const paint = () => {
            const name = f.name.value.trim();
            f.avatar.textContent = (name[0] || '?').toUpperCase();
            f.avatar.style.background = avatarColor(name);
        };
        f.name.addEventListener('input', () => { f.error.textContent = ''; paint(); });
        f.dice.addEventListener('click', () => {
            if (window.generateRandomAgentName) f.name.value = window.generateRandomAgentName();
            paint();
        });
        paint();
        return () => {
            if (f.name.value.trim()) return false;
            f.error.textContent = 'Pick a name first — it is how the others will see you.';
            f.name.focus();
            return true;
        };
    }

    function wireCode(f, needName) {
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
            enter(code, f.name.value.trim());
        };
        f.code.addEventListener('input', () => {
            if (f.code.selectionStart === f.code.value.length && /^[\d\s]*$/.test(f.code.value)) {
                f.code.value = window.PartyCode.format(f.code.value);
            }
            f.error.textContent = '';
        });
        f.join.addEventListener('click', join);
        f.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    }

    function wire(lobby, f) {
        const needName = wireName(f);
        f.start.addEventListener('click', () => { if (!needName()) enter(newCode(current.config), f.name.value.trim()); });
        if (f.resume) f.resume.addEventListener('click', () => { if (!needName()) resume(f.name.value.trim()); });
        if (f.solo) f.solo.addEventListener('click', () => { close(); lobby.solo(); });
        wireCode(f, needName);
        f.advanced.addEventListener('click', close);
        stepAsideForTheForm();
    }

    /*
     * Anything typing into the channel form underneath means somebody chose the
     * form: a script, a password manager, a test driving it as a person would
     * after "Advanced". The lobby gets out of its way rather than covering it.
     */
    function stepAsideForTheForm() {
        const modal = document.getElementById(fieldsOf(current.config).form);
        if (!modal) return;
        const onInput = (e) => {
            if (current.filling || !document.getElementById('partyLobby')) return;
            if (e.target && e.target.closest && e.target.closest('#partyLobby')) return;
            modal.removeEventListener('input', onInput, true);
            close();
        };
        modal.addEventListener('input', onInput, true);
    }

    function defaultName(config) {
        // `?newname`: a second tab of this browser joining as another person
        // (Under the Hood's "Open another tab"), not as the name saved here.
        const fresh = new URLSearchParams(location.search).has('newname');
        if (fresh && window.generateRandomAgentName) return window.generateRandomAgentName();
        try {
            const saved = localStorage.getItem((config.localStoragePrefix || '') + 'username');
            if (saved) return saved;
        } catch (e) { /* private mode */ }
        const typed = document.getElementById(fieldsOf(config).user);
        if (typed && typed.value.trim()) return typed.value.trim();
        return window.generateRandomAgentName ? window.generateRandomAgentName() : '';
    }

    /**
     * The room this browser was last in, if the modal is holding it: the modal
     * pre-fills the active channel for a returning visitor, and a fresh room
     * for a new one. Only the first deserves a "back to it" button. A room
     * room-defaults.js made up for a first visit is recorded as 'defaults':
     * nobody has been in it, so there is nothing to go back to.
     */
    function lastRoom() {
        const ch = document.getElementById(fieldsOf(current.config).channel);
        const active = window.ActiveChannel && window.ActiveChannel.read();
        if (!ch || !active || active.source === 'defaults') return null;
        return ch.value.trim() === active.name ? active.name : null;
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
            el('span', { text: 'Code ' }), el('strong', { text: isLegacy(code) ? code : window.PartyCode.format(code) }), invite, dismiss]);
        dismiss.addEventListener('click', () => chip.remove());
        document.body.append(chip);
    }

    function attach(config) {
        if (!config || !config.partyLobby || openedFromSharedLink()) return false;
        injectStyle();
        const lobby = config.partyLobby;
        current = { config: config, filling: false };
        const params = new URLSearchParams(location.search);
        const code = normalize(config, params.get('code') || params.get('party'));
        const f = form(lobby, code, defaultName(config));
        if (!code && lastRoom()) {
            f.resume = el('button', { class: 'pl-btn pl-btn--resume', type: 'button', text: 'Back to your last room' });
        }
        document.body.append(layout(config, lobby, f));
        wire(lobby, f);
        fromCatalogue(lobby, f);
        // Focused once shown: a control inside a hidden card cannot take focus.
        current.focus = code ? f.join : f.resume || f.start;
        return true;
    }

    /*
     * Focus the main button, retrying for a moment: a page still hiding itself
     * while it loads (the whiteboard does) refuses focus without saying so.
     * Stops as soon as anything else has focus, which means a person chose it.
     */
    function focusSoon(target, tries) {
        const left = tries === undefined ? 40 : tries;
        const idle = document.activeElement === document.body || document.activeElement === null;
        if (!idle || !target.isConnected) return;
        target.focus();
        if (document.activeElement !== target && left > 0) setTimeout(() => focusSoon(target, left - 1), 50);
    }

    /** The stylesheet, then the lobby shown once it has loaded (or failed: shown plain beats hidden). */
    function injectStyle() {
        const reveal = () => {
            const node = document.getElementById('partyLobby');
            if (!node) return;
            node.classList.remove('pl-loading');
            node.removeAttribute('style');
            node.firstChild.removeAttribute('style');
            if (current && current.focus) focusSoon(current.focus);
        };
        const existing = document.getElementById(STYLE_ID);
        if (existing || !SITE_ROOT) { setTimeout(reveal, 0); return; }
        const link = el('link', { id: STYLE_ID, rel: 'stylesheet', href: SITE_ROOT + 'css/party-lobby.css' });
        link.addEventListener('load', reveal);
        link.addEventListener('error', reveal);
        document.head.appendChild(link);
    }

    window.PartyLobby = { attach: attach, normalize: normalize, roomFor: roomFor, newCode: newCode,
        avatarColor: avatarColor, LEGACY_ALPHABET: LEGACY_ALPHABET };
})();
