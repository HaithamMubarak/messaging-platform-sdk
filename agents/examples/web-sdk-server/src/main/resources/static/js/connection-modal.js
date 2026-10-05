/**
 * Connection Modal - Common JavaScript
 * Extracted from whiteboard for reuse across all demos
 *
 * Usage:
 * 1. Include connection-modal.css
 * 2. Include this script
 * 3. Call loadConnectionModal(config) with:
 *    - localStoragePrefix: prefix for localStorage keys (e.g., 'whiteboard_', 'chat_')
 *    - channelPrefix: prefix for generated channel names (e.g., 'whiteboard-', 'channel-')
 *    - onConnect: function(username, channel, password) - called when user clicks connect
 *    - onHideModal: function() - called after successful connection to hide modal
 */

(function(window) {
    'use strict';

    // Embedded HTML template (no need for external file or fetch)
    const HTML_TEMPLATE = `
<!-- Connection Modal HTML Template -->
<div id="connectionModal" class="connection-modal active">
    <!-- No collapsed quick card and no expand/collapse (2026-10-05): the dialog is
         always whole, and the Code tab's prefilled code plus Join is the one-click
         way in. Callers that still add .collapsed change nothing (see the CSS). -->
    <div class="modal-content">
        <div class="modal-header-row">
            <h2>{{MODAL_TITLE}}</h2>
        </div>

        <!-- One name for every way in (Code, Advanced, Saved), so it sits above
             the tabs. Hidden on Sign in, where it does not apply. -->
        <div id="nameRow" class="mp-name-row">
            <!-- True of every tab, so it sits with the name, above them. Its own
                 class: the code finds the default tip as the FIRST .connection-info-note. -->
            <div id="sharedLinkWarning" class="mp-shared-note" role="note" style="display: none;">
                <p><strong>Shared link.</strong> Change the code or channel and you join a different room.</p>
            </div>
            <label for="usernameInput" class="form-label-visible">Your Name</label>
            <input type="text" id="usernameInput" placeholder="Your name" autocomplete="nickname">
        </div>

        <div class="mp-tabs" role="tablist" aria-label="How to join">
            <button type="button" class="mp-tab is-active" id="tabCode" role="tab"
                    aria-selected="true" aria-controls="panelCode">Code</button>
            <button type="button" class="mp-tab" id="tabCustom" role="tab"
                    aria-selected="false" aria-controls="connectionForm"
                    title="For developers: a channel by its exact name and password">Advanced</button>
            <button type="button" class="mp-tab" id="tabSaved" role="tab"
                    aria-selected="false" aria-controls="panelSaved" hidden>Saved</button>
            <button type="button" class="mp-tab" id="tabSignin" role="tab"
                    aria-selected="false" aria-controls="panelSignin">Sign in</button>
        </div>

        <!-- Code: the everyday way in. Twelve digits name a room in this app
             (see PartyCode below); the Channel tab is the same room spelled
             out, for developers and custom rooms. -->
        <div id="panelCode" class="mp-panel" role="tabpanel" aria-labelledby="tabCode">
            <label for="partyCodeInput" class="form-label-visible">Room code</label>
            <div class="mp-code-row">
                <input type="text" id="partyCodeInput" class="mp-code-input" inputmode="numeric"
                       autocomplete="off" spellcheck="false" placeholder="0000 0000 0000"
                       aria-describedby="partyCodeMsg">
                <button type="button" id="codeNewBtn" class="mp-icon-btn" aria-label="New code" title="New code">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>
                </button>
                <button type="button" id="codeCopyBtn" class="mp-icon-btn" aria-label="Copy code" title="Copy code">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
            </div>
            <p id="partyCodeMsg" class="mp-code-msg" role="status"></p>

            <div class="modal-buttons">
                <button type="button" id="codeJoinBtn" class="btn-primary">Join</button>
            </div>
            <p class="mp-note">Share the code. Anyone who types it here joins you.</p>
        </div>

        <!-- Saved: only ever rendered for a signed-in person. -->
        <div id="panelSaved" class="mp-panel" role="tabpanel" aria-labelledby="tabSaved" hidden>
            <div id="savedList" class="mp-saved-list"></div>
            <p class="mp-note" id="savedEmpty" hidden>
                Channels you save will appear here. They are kept on this device only.
            </p>
        </div>

        <!-- Sign in: an account gates SAVING, never connecting.
             Laid out like the Rooms sign-in gate, which this shares an account
             with: sign in and register are two TABS rather than a button that
             changes what the form means, and Google sits below the email path
             under an "or" instead of above it -- an account you already have
             should not be the second option on the screen. -->
        <div id="panelSignin" class="mp-panel" role="tabpanel" aria-labelledby="tabSignin" hidden>
            <p class="mp-note mp-signin__lead">
                Sign in to your <strong>Platform account</strong> (not the Developer
                Portal one) to save rooms. You do not need either to join a room.
            </p>

            <div class="mp-subtabs" role="tablist" aria-label="Sign in to or create a Platform account">
                <button type="button" class="mp-subtab is-active" id="modeSignin" role="tab"
                        aria-selected="true">Sign in</button>
                <button type="button" class="mp-subtab" id="modeRegister" role="tab"
                        aria-selected="false">Create a Platform account</button>
            </div>

            <label class="form-label-visible" for="signinName" id="signinNameLabel" hidden>Your name</label>
            <input type="text" id="signinName" autocomplete="name" maxlength="60"
                   placeholder="Amina Osei" hidden>

            <label class="form-label-visible" for="signinEmail">Email</label>
            <input type="email" id="signinEmail" autocomplete="email" maxlength="254"
                   placeholder="you@example.com">

            <label class="form-label-visible" for="signinPassword">Password</label>
            <input type="password" id="signinPassword" autocomplete="current-password"
                   maxlength="200" placeholder="at least 8 characters">

            <div class="modal-buttons">
                <button type="button" id="signinBtn" class="btn-primary">Sign in</button>
                <button type="button" id="signinForgot" class="ghost">Forgotten your password?</button>
            </div>

            <!-- Only shown when the service says a Google client is configured:
                 a button that opens a broken flow is worse than no button. -->
            <div class="mp-or" id="googleWrap" hidden><span>or</span></div>
            <button type="button" id="googleSignInBtn" class="mp-google" hidden>
                <span class="mp-google__g" aria-hidden="true">G</span> Sign in with Google
            </button>

            <p id="signinError" class="connect-error" role="alert" hidden></p>
            <p id="signinOk" class="mp-note mp-signin__ok" role="status" hidden></p>
        </div>

        <form id="connectionForm" class="mp-panel" role="tabpanel" aria-labelledby="tabCustom" onsubmit="return false;" hidden>
            <!-- Advanced: the platform's own terms, for developers and experts. A
                 room code is the same thing underneath (see PartyCode). -->
            <p class="mp-dev-lead">
                <span class="mp-dev-badge">For developers</span>
                A channel by its exact name and password, as the platform names it.
                For everyday use, the Code tab is simpler.
            </p>

            <div class="connection-info-note" style="margin-top: 8px;">
                <p>Pick any channel name and password. Everyone who joins has to type
                <strong>both</strong> exactly the same, or open the link you share, which carries both.</p>
            </div>

            <label for="channelInput" class="form-label-visible">Channel Name</label>
            <input type="text" id="channelInput" placeholder="Channel name" autocomplete="off">

            <label for="passwordInput" class="form-label-visible">Channel Password</label>
            <div class="password-input-wrapper">
                <input type="password" id="passwordInput" placeholder="Channel password" autocomplete="new-password">
                <button type="button" id="togglePasswordBtn" class="password-toggle-btn" onclick="togglePasswordVisibility()" aria-label="Show password" title="Show password">
                    <!-- icons.js 'eye' -->
                    <svg id="passwordEyeShow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                    <!-- icons.js 'eye-off' -->
                    <svg id="passwordEyeHide" hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="m1 1 22 22"/>
                    </svg>
                </button>
            </div>

            <label class="mp-save-row" for="saveChannelChk">
                <input type="checkbox" id="saveChannelChk" disabled>
                <span id="saveChannelLabel">Save this channel</span>
            </label>
            <p class="mp-note mp-save-note" id="saveChannelNote">
                <a href="#" id="saveSigninLink">Sign in to your Platform account</a> to save channels.
            </p>

            <div class="modal-buttons">
                <button type="button" id="connectBtn" class="btn-primary">Connect</button>
                <button type="button" id="regenerateBtn" class="ghost">Regenerate</button>
            </div>

        </form>

        <!-- Outside the form so a failed Join on the Code tab is seen too. -->
        <div id="connectError" class="connect-error" role="alert" hidden>
            <p id="connectErrorText"></p>
            <button type="button" id="connectFixBtn" class="btn-primary" hidden></button>
        </div>
    </div>
</div>
`;

    /*
     * PartyCode -- a room as twelve digits you can read across a room.
     *
     * Three groups of four. In each group three digits are random and the
     * fourth is a check: a hash (FNV-1a, then mixed) of the group's number, the
     * app's id and ALL nine random digits. Every check covers every digit, so
     * one wrong digit anywhere has to beat three checks at once, not only the
     * checks after it (that left the last group 1-in-10). So a typo, two
     * swapped digits or a code made in another app is
     * refused before it connects -- a wrong code would otherwise open an empty
     * room of its own and spend a channel on the shared demo quota. About 1 in
     * 1000 random numbers pass. The rule is in this public file, so it stops
     * mistakes and guessing, not someone who reads it; the password half still
     * encrypts the room.
     *
     * Room: `<appId>-<first six digits>`, password: the last six.
     */
    const PartyCode = (function () {
        const GROUPS = 3, RANDOM = 3, GROUP = RANDOM + 1, LENGTH = GROUPS * GROUP;

        function fnv(text) {
            let h = 0x811c9dc5;
            for (let i = 0; i < text.length; i++) {
                h ^= text.charCodeAt(i);
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            return h;
        }

        // MurmurHash3's finaliser. Without it the three checks, whose inputs
        // differ only in the group number, moved together: 2.6% of one-digit
        // typos passed all three (party-code.test.js measured it).
        function mix(h) {
            h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
            h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
            return (h ^ (h >>> 16)) >>> 0;
        }

        /** The code a run of random digits makes in this app. */
        function build(appId, random) {
            let code = '';
            for (let g = 0; g < GROUPS; g++) {
                code += random.slice(g * RANDOM, (g + 1) * RANDOM);
                code += String(mix(fnv(g + ':' + appId + ':' + random)) % 10);
            }
            return code;
        }

        function secureDigits(n) {
            const out = [];
            const bytes = new Uint8Array(n * 2);
            while (out.length < n) {
                window.crypto.getRandomValues(bytes);
                // 250 is the largest multiple of 10 under 256: no digit is favoured.
                for (let i = 0; i < bytes.length && out.length < n; i++) {
                    if (bytes[i] < 250) out.push(bytes[i] % 10);
                }
            }
            return out.join('');
        }

        function digitsOf(input) { return String(input == null ? '' : input).replace(/\D/g, ''); }

        /** What is wrong with a typed code: 'short', 'long', 'wrong', or null when it is a code. */
        function problem(appId, input) {
            const d = digitsOf(input);
            if (d.length < LENGTH) return 'short';
            if (d.length > LENGTH) return 'long';
            let random = '';
            for (let g = 0; g < GROUPS; g++) random += d.slice(g * GROUP, g * GROUP + RANDOM);
            return build(appId, random) === d ? null : 'wrong';
        }

        function roomFor(appId, code) {
            const d = digitsOf(code);
            return { channel: appId + '-' + d.slice(0, LENGTH / 2), password: d.slice(LENGTH / 2) };
        }

        /** The code a channel and password were made from, or null when they are not a code room. */
        function codeFor(appId, channel, password) {
            const prefix = appId + '-';
            const name = String(channel || ''), pw = String(password || '');
            if (name.indexOf(prefix) !== 0) return null;
            const half = /^\d{6}$/;
            const head = name.slice(prefix.length);
            if (!half.test(head) || !half.test(pw)) return null;
            return problem(appId, head + pw) === null ? head + pw : null;
        }

        return {
            LENGTH: LENGTH,
            newCode: function (appId) { return build(appId, secureDigits(GROUPS * RANDOM)); },
            problem: problem,
            isValid: function (appId, input) { return problem(appId, input) === null; },
            roomFor: roomFor,
            codeFor: codeFor,
            digitsOf: digitsOf,
            format: function (code) { return digitsOf(code).replace(/(\d{4})(?=\d)/g, '$1 '); },
            /** The one app id the modal and the party lobby both derive rooms from. */
            appIdOf: function (config) {
                const c = config || {};
                return c.appId || String(c.channelPrefix || 'channel-').replace(/-$/, '') || 'app';
            }
        };
    })();
    window.PartyCode = PartyCode;

    // Helper functions
    function randomDigits(length) {
        let result = '';
        for (let i = 0; i < length; i++) {
            result += Math.floor(Math.random() * 10);
        }
        return result;
    }

    function generatePassword() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 8; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    function _generateRandomAgentNameBase() {
        const adjectives = ['Quick', 'Swift', 'Kind', 'Brave', 'Wise', 'Cool'];
        const nouns = ['Wolf', 'Bear', 'Fox', 'Eagle', 'Tiger', 'Lion'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return adj + noun + Math.floor(Math.random() * 100);
    }

    /**
     * Load and initialize connection modal
     * @param {Object} config - Configuration object
     * @param {string} config.localStoragePrefix - Prefix for localStorage keys (e.g., 'whiteboard_')
     * @param {string} config.channelPrefix - Prefix for channel names (e.g., 'whiteboard-')
     * @param {string} config.title - Modal title (e.g., '🎨 Join Whiteboard')
     * @param {Function} config.onConnect - Callback when user clicks connect: function(username, channel, password)
     * @param {Function} config.onHideModal - Callback to hide modal after connection (optional)
     */
    // Set once the modal is built; ConnectionModal.fail() routes through it.
    let _reportFailure = null;

    /**
     * Ask a question without stopping the page.
     *
     * window.confirm() blocks the event loop, which in an app holding a live
     * connection means the connection stops being answered for as long as the
     * dialog is open. Falls back to the native one only where the shared
     * helper is not on the page.
     */
    function _ask(opts) {
        if (window.MiniGameUtils && MiniGameUtils.ask) return MiniGameUtils.ask(opts);
        return Promise.resolve(window.confirm(opts.body));
    }

    function codeMessage(appId, digits, strict) {
        const problem = PartyCode.problem(appId, digits);
        if (!problem) return { state: 'ok', text: 'Room ' + PartyCode.roomFor(appId, digits).channel + ' is ready to join.' };
        if (problem === 'short' && !strict) {
            const left = PartyCode.LENGTH - digits.length;
            return { state: '', text: digits.length ? 'Keep going: ' + left + ' more digit' + (left === 1 ? '' : 's') + '.'
                : 'Enter the ' + PartyCode.LENGTH + '-digit code.' };
        }
        if (problem === 'short') return { state: 'bad', text: 'A room code is ' + PartyCode.LENGTH + ' digits.' };
        if (problem === 'long') return { state: 'bad', text: 'That is more than ' + PartyCode.LENGTH + ' digits.' };
        return { state: 'bad', text: 'That code isn’t right. Check the digits, and that it is for this app.' };
    }

    /**
     * The Code tab: another view of the room in the Channel form. A valid code
     * is written into that form's fields, so Join, Connect, Save and the quick
     * card all act on the one room the code names.
     * @param {object} o {appId, chEl, pwEl, onRoom(), join()}
     */
    function wireCodeTab(o) {
        const input = document.getElementById('partyCodeInput');
        const msg = document.getElementById('partyCodeMsg');
        if (!input || !msg) return { set: function () {}, fromRoom: function () {} };

        function render(strict) {
            const m = codeMessage(o.appId, PartyCode.digitsOf(input.value), strict);
            msg.textContent = m.text;
            msg.setAttribute('data-state', m.state);
            input.setAttribute('aria-invalid', m.state === 'bad' ? 'true' : 'false');
            return m.state === 'ok';
        }
        function intoRoom() {
            if (!PartyCode.isValid(o.appId, input.value)) return;
            const room = PartyCode.roomFor(o.appId, input.value);
            if (o.chEl) o.chEl.value = room.channel;
            if (o.pwEl) o.pwEl.value = room.password;
            o.onRoom();
        }
        /** Show a code; `keepRoom` leaves the Channel form's room as it is. */
        function set(code, keepRoom) {
            input.value = PartyCode.format(code);
            render(false);
            if (!keepRoom) intoRoom();
        }
        input.addEventListener('input', function () {
            // Re-space only while typing at the end, so editing a middle digit keeps the caret.
            if (input.selectionStart === input.value.length) input.value = PartyCode.format(input.value);
            render(false);
            intoRoom();
        });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });
        function join() {
            if (!render(true)) { input.focus(); return; }
            intoRoom();
            o.join();
        }
        const btn = function (id, fn) { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
        btn('codeJoinBtn', join);
        btn('codeNewBtn', function () { set(PartyCode.newCode(o.appId)); });
        btn('codeCopyBtn', function () {
            copyText(PartyCode.format(input.value)).then(function (ok) {
                msg.textContent = ok ? 'Copied.' : 'Select the code and copy it.';
            });
        });
        return {
            set: set,
            /** Mirror the Channel form when it holds a code room of this app. */
            fromRoom: function () {
                const code = PartyCode.codeFor(o.appId, o.chEl && o.chEl.value.trim(), o.pwEl && o.pwEl.value.trim());
                if (code) set(code, true);
                return code;
            }
        };
    }

    function copyText(text) {
        if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(false);
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }

    /* The room's code, on the page once it is joined: read it out, copy it, or invite. */
    const CodeChip = {
        remove: function () {
            const chip = document.getElementById('partyCodeChip');
            if (chip) chip.remove();
        },
        show: function (code, channel, password) {
            CodeChip.remove();
            if (!code) return;
            const chip = document.createElement('div');
            chip.id = 'partyCodeChip';
            chip.className = 'mp-code-chip';
            const label = document.createElement('span');
            label.className = 'mp-code-chip__label';
            label.textContent = 'Code';
            const value = document.createElement('strong');
            value.className = 'mp-code-chip__code';
            value.textContent = PartyCode.format(code);
            chip.append(label, value);
            const add = function (text, aria, fn) {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = text;
                if (aria) b.setAttribute('aria-label', aria);
                b.addEventListener('click', function () { fn(b); });
                chip.appendChild(b);
            };
            add('Copy', 'Copy room code', function (b) {
                copyText(PartyCode.format(code)).then(function (ok) { if (ok) b.textContent = 'Copied'; });
            });
            if (window.ShareModal && window.ShareModal.show) {
                add('Invite', null, function () { window.ShareModal.show(channel, password); });
            }
            add('×', 'Hide room code', CodeChip.remove);
            // Out of the app's way after a few seconds: the code alone, a tap brings the buttons back.
            chip.addEventListener('click', function (e) {
                if (!chip.classList.contains('is-compact')) return;
                chip.classList.remove('is-compact');
                e.stopPropagation();
            });
            setTimeout(function () { chip.classList.add('is-compact'); }, 10000);
            document.body.appendChild(chip);
        }
    };

    window.loadConnectionModal = function(config) {
        // Use embedded template - no fetch needed!
        const modalTitle = config.title || 'Connect to a channel';

        // Replace placeholders in template
        let html = HTML_TEMPLATE;
        html = html.replace('{{MODAL_TITLE}}', modalTitle);

        // Insert into page
        document.body.insertAdjacentHTML('beforeend', html);

        console.log('[ConnectionModal] Template loaded (embedded)');

        // Initialize
        window.initConnectionModal(config);

        // A game can lead with a party lobby (start / join with a code) and keep
        // this form under "Advanced". See js/party-lobby.js.
        if (config.partyLobby && window.PartyLobby) window.PartyLobby.attach(config);
    };

    /**
     * Initialize connection modal (after HTML is loaded)
     * @param {Object} config - Configuration object
     */
    window.initConnectionModal = function(config) {
        // Prevent duplicate initialization
        if (window._connectionModalInitialized) {
            console.warn('[ConnectionModal] Already initialized, skipping duplicate initialization');
            return;
        }
        window._connectionModalInitialized = true;
        const localStoragePrefix = config.localStoragePrefix || '';
        const channelPrefix = config.channelPrefix || 'channel-';
        const onConnect = config.onConnect;
        const onHideModal = config.onHideModal;

        const chEl = document.getElementById('channelInput');
        const pwEl = document.getElementById('passwordInput');
        const userEl = document.getElementById('usernameInput');
        // One name field, above the tabs. setName stays the one way the name is
        // written (a saved channel restores its own).
        const nameEls = [userEl].filter(Boolean);
        function setName(value) { nameEls.forEach(function (el) { el.value = value; }); }
        // Rooms are scoped to the app; a code names a room in this app only.
        var appId = PartyCode.appIdOf(config);
        const codesOn = config.partyCode !== false;
        /** A new room to offer: a code room, or a random channel where an app opts out. */
        function freshRoom() {
            return codesOn ? PartyCode.roomFor(appId, PartyCode.newCode(appId))
                : { channel: channelPrefix + randomDigits(8), password: generatePassword() };
        }
        // Declared here because persistence is set up before account discovery
        // completes. Once known, an account gets its own fallback identity.
        var currentUser = null;
        var accountId = null;

        function usernameKey() {
            return localStoragePrefix + 'username' + (accountId ? '.' + accountId : '');
        }
        function channelKey() {
            return localStoragePrefix + 'channel' + (accountId ? '.' + accountId : '');
        }
        function passwordKey() {
            return localStoragePrefix + 'password' + (accountId ? '.' + accountId : '');
        }

        function accountDefaultName() {
            return currentUser ? (currentUser.displayName || currentUser.email || '') : '';
        }

        /**
         * Persist what the user typed.
         *
         * The channel password is the credential that gates the room, so it
         * lives in sessionStorage — it should not outlive the browser session
         * or sit readable on a shared machine. Name and room are not secrets
         * and stay in localStorage so returning users keep their identity.
         */
        function persistValues(u, c, p, source) {
            try {
                localStorage.setItem(usernameKey(), u || '');
                localStorage.setItem(channelKey(), c || '');
                sessionStorage.setItem(passwordKey(), p || '');
            } catch (e) {
                // A connection can still succeed when browser storage is
                // unavailable, but never pretend it was remembered.
                throw new Error('Connected, but this browser could not save the channel.');
            }
            // Clear any password left in localStorage by an older build.
            localStorage.removeItem(localStoragePrefix + 'password');

            // The same values under the shared keys, so the next app opens in
            // this room rather than inventing its own. The per-app keys above
            // are still written and still read as a fallback, so this is
            // reversible without stranding anybody.
            if (window.ActiveChannel) {
                if (c) window.ActiveChannel.write(c, source, accountId);
                window.ActiveChannel.writePassword(p, accountId);
                // A guest can keep one cross-app identity. A signed-in person
                // must not put their alias in a browser-global key that the
                // next Platform account on this device would inherit.
                if (!accountId) window.ActiveChannel.writeUsername(u);
            }
        }

        // Helper to load persisted values
        function loadPersisted() {
            try {
                return {
                    u: localStorage.getItem(usernameKey()) || '',
                    c: localStorage.getItem(channelKey()) || '',
                    p: sessionStorage.getItem(passwordKey()) || ''
                };
            } catch (e) {
                return {u: '', c: '', p: ''};
            }
        }

        // Regenerate function
        function doRegenerate() {
            if (chEl) chEl.value = channelPrefix + randomDigits(8);
            if (pwEl) pwEl.value = generatePassword();
            // Don't regenerate username - keep it persistent across channels
            if (userEl && !userEl.value.trim()) {
                const base = (window.generateRandomAgentName && typeof window.generateRandomAgentName === 'function')
                    ? window.generateRandomAgentName()
                    : _generateRandomAgentNameBase();
                userEl.value = base + '-' + randomDigits(4);
            }
            setName(userEl ? userEl.value : '');
        }

        // Load persisted values
        const persisted = loadPersisted();

        // Priority 1: Check URL parameters (hash-based from share links)
        let urlChannel = null;
        let urlPassword = null;
        let urlApiKey = null;
        try {
            let hash = window.location.hash;
            if (hash && hash.startsWith('#')) {
                // Remove leading #
                hash = hash.substring(1);

                // Handle multiple # in URL (e.g., #base64data#channel-name)
                // Take only the first part (the base64 encoded data)
                const hashParts = hash.split('#');
                const hashContent = hashParts[0];

                if (!hashContent || hashContent.length === 0) {
                    console.log('[ConnectionModal] Empty hash, skipping URL decode');
                } else {
                    // Try to decode using ChannelAuthUtils (supports both encrypted and plain)
                    if (window.ChannelAuthUtils) {
                        const decoded = window.ChannelAuthUtils.decodeAuto(hashContent, persisted.u);
                        if (decoded) {
                            if (decoded.c) urlChannel = decoded.c;
                            if (decoded.p) urlPassword = decoded.p;
                            if (decoded.k) urlApiKey = decoded.k;
                            console.log('[ConnectionModal] Loaded from URL hash:', {
                                channel: urlChannel,
                                password: '***',
                                apiKey: urlApiKey ? '***' : 'none'
                            });
                        } else {
                            console.log('[ConnectionModal] Failed to decode hash, using defaults');
                        }
                    } else {
                        // Fallback to simple base64 JSON parsing if ChannelAuthUtils not loaded
                        try {
                            const decoded = atob(hashContent);
                            const params = JSON.parse(decoded);
                            if (params.c) urlChannel = params.c;
                            if (params.p) urlPassword = params.p;
                            if (params.k) urlApiKey = params.k;
                            console.log('[ConnectionModal] Loaded from URL hash (fallback)');
                        } catch (e) {
                            console.log('[ConnectionModal] Hash is not base64 JSON');
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[ConnectionModal] Failed to parse URL hash:', e);
        }

        // A `?code=` link is an invite too, below a hash invite. A code that is
        // not for this app is not guessed at: it is shown on the Code tab with
        // what is wrong with it.
        let urlCode = null;
        try { urlCode = new URLSearchParams(window.location.search).get('code'); } catch (e) { /* no URL */ }
        if (urlCode && codesOn && !urlChannel && !urlPassword && PartyCode.isValid(appId, urlCode)) {
            const invited = PartyCode.roomFor(appId, urlCode);
            urlChannel = invited.channel;
            urlPassword = invited.password;
        }

        // Priority 2: ALWAYS restore username from localStorage if it exists
        if (persisted.u && userEl) {
            userEl.value = persisted.u;
            userEl.disabled = false;
        } else if (userEl && window.ActiveChannel && window.ActiveChannel.readUsername()) {
            // A name the person already chose in another app. Keeping it is the
            // whole point of a shared identity; regenerating one per app is how
            // somebody ends up as three different strangers in one room.
            userEl.value = window.ActiveChannel.readUsername();
            userEl.disabled = false;
        } else if (userEl) {
            // No saved username - generate one ONCE
            const base = (window.generateRandomAgentName && typeof window.generateRandomAgentName === 'function')
                ? window.generateRandomAgentName()
                : _generateRandomAgentNameBase();
            userEl.value = base + '-' + randomDigits(4);
            userEl.disabled = false;
        }

        setName(userEl ? userEl.value : '');

        // Priority 3: channel and password.
        //
        // An invite still wins outright -- an invite that did not put you in
        // the inviter's room is a broken invite. Below that the ACTIVE channel
        // comes before this app's own remembered one, which is what makes the
        // room follow you from app to app; the per-app value stays as the
        // fallback for a browser that has not been anywhere else yet.
        if (window.ActiveChannel) window.ActiveChannel.seedFromLegacy(localStoragePrefix);
        var active = window.ActiveChannel ? window.ActiveChannel.read() : null;
        var activePw = window.ActiveChannel ? window.ActiveChannel.readPassword() : '';

        // Nothing to come back to: offer a new room. With codes on it is a code
        // room, so the room a first-time visitor connects to has a code to share.
        var fresh = freshRoom();
        if (chEl) {
            chEl.value = urlChannel || (active && active.name) || persisted.c || fresh.channel;
        }
        if (pwEl) {
            // Only pair the shared password with the shared channel: carrying
            // it onto a different room would be a password for a door it does
            // not open.
            var pwForActive = (!urlChannel && active && chEl && chEl.value === active.name)
                ? activePw : '';
            pwEl.value = urlPassword || pwForActive || persisted.p || fresh.password;
        }

        // Draft values do not become the active channel until an app confirms
        // a successful join.  Regenerating or opening an invite must never
        // overwrite another account's confirmed room.

        // Detect if hash auth (shared link) is present
        const hasHashAuth = !!(urlChannel || urlPassword);

        // Show/hide appropriate info notes based on shared link detection
        const defaultInfoNote = document.querySelector('.connection-info-note');
        const sharedLinkWarning = document.getElementById('sharedLinkWarning');

        // A shared link shows its warning in place of the default tip.
        if (defaultInfoNote) defaultInfoNote.style.display = hasHashAuth ? 'none' : 'block';
        if (sharedLinkWarning) sharedLinkWarning.style.display = hasHashAuth ? 'block' : 'none';

        // Wire regenerate button
        const regenBtn = document.getElementById('regenerateBtn');
        if (regenBtn) {
            // Track if user has already confirmed regeneration in this session
            let regenerateConfirmed = false;

            regenBtn.addEventListener('click', (ev) => {
                ev.preventDefault();

                // Only show confirmation dialog on first regenerate
                if (!regenerateConfirmed) {
                    _ask({
                        title: 'Regenerate the channel?',
                        body: 'You will be put in a different channel: any link you have already '
                            + 'sent stops working, and anyone waiting in the old one is left there.',
                        confirmLabel: 'Regenerate', cancelLabel: 'Keep this one', danger: true
                    }).then(function (yes) {
                        if (!yes) return;
                        regenerateConfirmed = true; // Remember user's choice
                        doRegenerate();
                    });
                } else {
                    // User already confirmed once, no need to ask again
                    doRegenerate();
                }
            });
        }

        // Typing in any of the name fields types in all of them.
        nameEls.forEach(function (source) {
            source.addEventListener('input', function () {
                nameEls.forEach(function (el) { if (el !== source) el.value = source.value; });
            });
        });

        /**
         * Everything a connect attempt can do to the form lives here.
         *
         * It used to call onConnect and forget: whatever came back — a name
         * already in use, a wrong password, a backend that never answered —
         * reached the console and nowhere else, and the form sat there looking
         * as though nothing had been pressed. Every app improvised its own
         * handling and several had none, so this is the one place that knows
         * how a connect fails.
         */
        function setBusy(on) {
            [connectBtn, codeJoinBtn].forEach(function (b) {
                if (!b) return;
                if (on) {
                    b.dataset.label = b.dataset.label || b.textContent;
                    b.textContent = 'Connecting…';
                } else if (b.dataset.label) {
                    b.textContent = b.dataset.label;
                }
                b.disabled = !!on;
            });
        }

        function clearError() {
            const box = document.getElementById('connectError');
            if (box) box.hidden = true;
            const fix = document.getElementById('connectFixBtn');
            if (fix) { fix.hidden = true; fix.onclick = null; }
        }

        /**
         * Say what went wrong, and where possible offer the way out rather
         * than only the diagnosis: a name already in use is the one failure a
         * person cannot fix by reading it, so it comes with a free name and a
         * button that takes it.
         */
        function showError(err) {
            setBusy(false);
            const raw = (err && err.message) || String(err || 'The connection failed.');
            const box = document.getElementById('connectError');
            const text = document.getElementById('connectErrorText');
            const fix = document.getElementById('connectFixBtn');
            if (!box || !text) return;

            let message = raw, action = null;

            if (/already being used|currently unavailable|name.*taken/i.test(raw)) {
                const free = (userEl && userEl.value.trim() ? userEl.value.trim().replace(/\d+$/, '') : '')
                    || _generateRandomAgentNameBase().replace(/\d+$/, '');
                const suggestion = free + randomDigits(3);
                message = 'Somebody is already in this channel under that name. Pick another one.';
                action = { label: 'Use “' + suggestion + '”', run: function () {
                    setName(suggestion);
                    clearError();
                    attempt(suggestion);
                } };
            } else if (/password|unauthor|forbidden|401|403/i.test(raw)) {
                message = 'That channel password was not accepted. Check it and try again.';
            } else if (/timed out|timeout|did not answer/i.test(raw)) {
                message = 'The channel did not answer. Check your connection and try again.';
            } else if (/network|failed to fetch|ERR_/i.test(raw)) {
                message = 'Could not reach the messaging service. Check your connection and try again.';
            }

            text.textContent = message;
            box.hidden = false;
            if (fix) {
                fix.hidden = !action;
                if (action) { fix.textContent = action.label; fix.onclick = action.run; }
            }
        }

        /**
         * One attempt, watched.
         *
         * An app that swallows its own connect error would otherwise leave the
         * button spinning forever, so the attempt is given a deadline as well
         * as a catch. Success is the modal being taken down, which is what
         * every app does when it is really in.
         */
        function attempt(username) {
            const channel = chEl ? chEl.value.trim() : '';
            const password = pwEl ? pwEl.value.trim() : '';
            clearError();
            setBusy(true);

            let settled = false;
            const watch = setInterval(function () {
                const modal = document.getElementById('connectionModal');
                if (modal && !modal.classList.contains('active')) {
                    settled = true;
                    done();
                    // The modal closing IS the app saying the room was joined:
                    // apps hide it from their own onConnect. Recording here
                    // rather than on the click means a channel is only ever
                    // saved after it actually let you in.
                    try {
                        // The app closed the modal, so the room was actually
                        // joined. A rejected attempt must not rewrite the
                        // active channel or a person's saved identity.
                        persistValues(username, channel, password);
                        window.ConnectionModal.recordConnect(channel, password, username);
                    } catch (e) {
                        // The room is joined, but a quota/private-mode failure
                        // means it will not be remembered. Say so explicitly.
                        window.setTimeout(function () { window.alert(e.message || 'This browser could not save the channel.'); }, 0);
                    }
                    if (codesOn && config.codeChip !== false) {
                        CodeChip.show(PartyCode.codeFor(appId, channel, password), channel, password);
                    }
                }
            }, 300);
            const deadline = setTimeout(function () {
                if (settled) return;
                settled = true;
                done();
                showError(new Error('The channel did not answer.'));
            }, 30000);
            function done() { clearInterval(watch); clearTimeout(deadline); setBusy(false); }

            try {
                Promise.resolve(onConnect(username, channel, password)).catch(function (err) {
                    if (settled) return;
                    settled = true; done(); showError(err);
                });
            } catch (err) {
                settled = true; done(); showError(err);
            }
        }

        // The apps report their own caught failures here, so a connect that
        // fails inside the page still reaches the form the person is looking at.
        _reportFailure = showError;

        const connectBtn = document.getElementById('connectBtn');
        const codeJoinBtn = document.getElementById('codeJoinBtn');

        if (connectBtn && onConnect) {
            connectBtn.onclick = function() {
                const username = userEl ? userEl.value.trim() : '';
                const channel = chEl ? chEl.value.trim() : '';
                const password = pwEl ? pwEl.value.trim() : '';

                if (!username || !channel || !password) {
                    showError(new Error('Your name, the channel and its password are all needed.'));
                    return;
                }
                attempt(username);
            };
        }

        [userEl, chEl, pwEl].forEach(function (el) {
            if (el) el.addEventListener('input', clearError);
        });

        // Cancel auto-connect when user clicks username field
        const cancelAutoConnect = () => {
            if (window.MiniGameUtils && typeof window.MiniGameUtils._cancelAutoConnect === 'function') {
                window.MiniGameUtils._cancelAutoConnect();
                console.log('[Auto-Connect] Canceled - user is editing username');
            }
        };

        if (userEl) userEl.addEventListener('click', cancelAutoConnect);

        /* ---------------------------------------------------------------
         * Tabs, sign-in and the saved list.
         *
         * All of this lives in the EXPANDED modal only. The collapsed quick
         * card -- a name and one Connect button -- is untouched and is still
         * what a first-time visitor meets, so the one-click path into a demo
         * survives the arrival of tabs. An account gates SAVING, never
         * connecting.
         * --------------------------------------------------------------- */
        function el(id) { return document.getElementById(id); }

        function showTab(name) {
            [['Code', 'panelCode'], ['Custom', 'connectionForm'], ['Saved', 'panelSaved'], ['Signin', 'panelSignin']]
                .forEach(function (pair) {
                    var tab = el('tab' + pair[0]);
                    var panel = el(pair[1]);
                    var on = pair[0].toLowerCase() === name;
                    if (tab) {
                        tab.classList.toggle('is-active', on);
                        tab.setAttribute('aria-selected', on ? 'true' : 'false');
                    }
                    if (panel) panel.hidden = !on;
                });
            // The name is for joining a room; Sign in asks for its own.
            var nameRow = el('nameRow');
            if (nameRow) nameRow.hidden = name === 'signin';
        }

        var codeTab = wireCodeTab({
            appId: appId, chEl: chEl, pwEl: pwEl,
            onRoom: function () { refreshSaveRow(); },
            join: function () {
                var username = userEl ? userEl.value.trim() : '';
                if (!username) { showError(new Error('Enter the name you want to be known by.')); return; }
                setName(username);
                attempt(username);
            }
        });

        /**
         * Show the tab that holds the room Connect would join: Code when it is
         * a code room of this app, Channel otherwise (an invite, or a room
         * carried over from another app). Leaves Saved and Sign in alone.
         */
        function showRoomTab() {
            var onRoomTab = !(el('panelCode') || {}).hidden || !(el('connectionForm') || {}).hidden;
            if (!onRoomTab) return;
            showTab(codesOn && codeTab.fromRoom() ? 'code' : 'custom');
        }

        function renderSaved() {
            var list = el('savedList');
            var empty = el('savedEmpty');
            if (!list) return;
            var rows = (accountId && window.Keyring) ? window.Keyring.list(accountId) : [];
            list.innerHTML = '';
            if (empty) empty.hidden = rows.length > 0;
            rows.forEach(function (row) {
                var item = document.createElement('button');
                item.type = 'button';
                item.className = 'mp-saved-row';
                item.setAttribute('data-id', row.id);
                var label = document.createElement('span');
                label.className = 'mp-saved-label';
                label.textContent = row.label;          // textContent: a label is user input
                // A code room is shown, and filled in, as its code: that is
                // what people read out. Other apps' code rooms are channels here.
                var code = codesOn ? PartyCode.codeFor(appId, row.name, row.password) : null;
                var name = document.createElement('span');
                name.className = 'mp-saved-name';
                name.textContent = code ? PartyCode.format(code) : row.name;
                item.appendChild(label);
                item.appendChild(name);
                if (code) {
                    var badge = document.createElement('span');
                    badge.className = 'mp-saved-badge';
                    badge.textContent = 'Code';
                    label.appendChild(badge);
                }
                item.addEventListener('click', function () {
                    // Fill the fields and hand over -- Connect stays the one
                    // verb that connects, so nothing happens behind your back.
                    if (chEl) chEl.value = row.name;
                    if (pwEl) pwEl.value = row.password || '';
                    // Legacy rows have no per-channel name. Reset to this
                    // account's default instead of carrying another row's
                    // alias across to a different room.
                    var joinAs = row.username || accountDefaultName();
                    setName(joinAs);
                    showTab(codeTab.fromRoom() ? 'code' : 'custom');
                    refreshSaveRow();
                });
                list.appendChild(item);
            });
        }

        function refreshSaveRow() {
            var chk = el('saveChannelChk');
            var note = el('saveChannelNote');
            var lbl = el('saveChannelLabel');
            if (!chk) return;
            chk.disabled = !accountId;
            if (note) note.hidden = !!accountId;
            if (!accountId) { chk.checked = false; return; }
            var saved = window.Keyring &&
                window.Keyring.has(accountId, chEl ? chEl.value : '', pwEl ? pwEl.value : '');
            chk.checked = !!saved;
            if (lbl) lbl.textContent = saved ? 'Saved on this device' : 'Save this channel';
        }

        function applyUser(user) {
            currentUser = user;
            var previousAccount = accountId;
            if (previousAccount && window.Keyring && window.Keyring.clearAccountKey) {
                window.Keyring.clearAccountKey(previousAccount);
            }
            accountId = window.MPAccount ? window.MPAccount.idOf(user) : null;
            if (accountId) {
                var renderForUser = function () {
                    if (accountId !== window.MPAccount.idOf(user)) return;
                    var savedName = loadPersisted().u || accountDefaultName();
                    setName(savedName);
                    var saved = loadPersisted();
                    var activeForAccount = window.ActiveChannel ? window.ActiveChannel.read(accountId) : null;
                    var activePassword = window.ActiveChannel ? window.ActiveChannel.readPassword(accountId) : '';
                    if (chEl) chEl.value = (activeForAccount && activeForAccount.name) || saved.c || chEl.value;
                    if (pwEl) pwEl.value = activePassword || saved.p || pwEl.value;
                    showRoomTab();
                };
                if (window.Keyring && window.Keyring.setAccountKey && window.Keyring.ensureEncrypted
                    && window.MPAccount && window.MPAccount.exportKey) {
                    window.MPAccount.exportKey().then(function (key) {
                        if (!key || accountId !== window.MPAccount.idOf(user)) {
                            if (key === null && accountId === window.MPAccount.idOf(user) && window.Keyring.clearAccountKey) {
                                window.Keyring.clearAccountKey(accountId);
                            }
                            return;
                        }
                        window.Keyring.setAccountKey(accountId, key);
                        window.Keyring.ensureEncrypted(accountId);
                    }).catch(function () {
                        if (window.Keyring && window.Keyring.clearAccountKey && accountId === window.MPAccount.idOf(user)) {
                            window.Keyring.clearAccountKey(accountId);
                        }
                    }).finally(function () {
                        renderForUser();
                        var savedTab = el('tabSaved');
                        var signinTab = el('tabSignin');
                        if (savedTab) savedTab.hidden = !accountId;
                        if (signinTab) signinTab.hidden = !!accountId;
                        renderSaved();
                        refreshSaveRow();
                    });
                    return;
                }

                renderForUser();
            }
            var savedTab = el('tabSaved');
            var signinTab = el('tabSignin');
            if (savedTab) savedTab.hidden = !accountId;
            if (signinTab) signinTab.hidden = !!accountId;
            renderSaved();
            refreshSaveRow();
        }

        if (window.MPAccount) {
            window.MPAccount.me().then(applyUser).catch(function () { applyUser(null); });
            window.MPAccount.onChange(function () {
                window.MPAccount.me(true).then(applyUser).catch(function () { applyUser(null); });
            });
            window.MPAccount.googleAvailable().then(function (ok) {
                var b = el('googleSignInBtn');
                if (b && ok) {
                    b.hidden = false;
                    if (el('googleWrap')) el('googleWrap').hidden = false;
                    b.addEventListener('click', function () {
                        window.location.href = window.MPAccount.googleStartUrl();
                    });
                }
            });
        }

        ['Code', 'Custom', 'Saved', 'Signin'].forEach(function (n) {
            var t = el('tab' + n);
            if (t) t.addEventListener('click', function () { showTab(n.toLowerCase()); });
        });
        var saveLink = el('saveSigninLink');
        if (saveLink) saveLink.addEventListener('click', function (e) {
            e.preventDefault(); showTab('signin');
        });
        [chEl, pwEl].forEach(function (field) {
            if (!field) return;
            field.addEventListener('input', refreshSaveRow);
            field.addEventListener('input', function () { codeTab.fromRoom(); });
        });

        // The first tab. A code the URL carried that is not this app's is shown
        // with what is wrong with it; otherwise the Code tab keeps a new code
        // ready even while the room on offer is a channel.
        if (!codesOn) {
            ['tabCode', 'panelCode'].forEach(function (id) { if (el(id)) el(id).hidden = true; });
            showTab('custom');
        } else if (!codeTab.fromRoom()) {
            var badCode = !!urlCode && !hasHashAuth;
            codeTab.set(badCode ? urlCode : PartyCode.newCode(appId), true);
            showTab(badCode ? 'code' : 'custom');
        }

        // Sign in / create an account: two tabs over one set of fields.
        var registerMode = false;
        function setMode(register) {
            registerMode = register;
            el('signinNameLabel').hidden = !register;
            el('signinName').hidden = !register;
            el('signinBtn').textContent = register ? 'Create account' : 'Sign in';
            el('signinForgot').hidden = register;   // nothing to recover yet
            el('signinPassword').setAttribute('autocomplete',
                register ? 'new-password' : 'current-password');
            [['modeSignin', !register], ['modeRegister', register]].forEach(function (pair) {
                var t = el(pair[0]);
                if (!t) return;
                t.classList.toggle('is-active', pair[1]);
                t.setAttribute('aria-selected', pair[1] ? 'true' : 'false');
            });
            var err = el('signinError'); if (err) err.hidden = true;
            var ok = el('signinOk'); if (ok) ok.hidden = true;
        }
        if (el('modeSignin')) el('modeSignin').addEventListener('click', function () { setMode(false); });
        if (el('modeRegister')) el('modeRegister').addEventListener('click', function () { setMode(true); });

        if (el('signinForgot')) el('signinForgot').addEventListener('click', function () {
            var email = el('signinEmail').value.trim();
            var ok = el('signinOk'), err = el('signinError');
            if (err) err.hidden = true;
            if (!email) {
                if (err) { err.hidden = false; err.textContent = 'Enter your email first.'; }
                return;
            }
            // Deliberately the same answer whether or not the address is known:
            // this form must not become a way to ask which emails have accounts.
            if (window.MPAccount) window.MPAccount.forgot(email).then(function (result) {
                if (!ok) return;
                ok.hidden = false;
                ok.textContent = result && result.emailDelivers
                    ? 'If that address has an account, a reset link is on its way.'
                    : 'If that address has an account, a reset link was created. Email delivery is not configured here.';
            }).catch(function () {
                if (!ok) return;
                ok.hidden = false;
                ok.textContent = 'If that address has an account, a reset link was created.';
            });
        });

        var signinBtn = el('signinBtn');
        if (signinBtn) signinBtn.addEventListener('click', function () {
            var err = el('signinError');
            if (err) err.hidden = true;
            var email = el('signinEmail').value.trim();
            var pw = el('signinPassword').value;
            var name = el('signinName').value.trim();
            var done = function (user) {
                applyUser(user);
                if (window.Keyring && window.Keyring.list(accountId).length) showTab('saved');
                else { showTab('custom'); showRoomTab(); }
            };
            var fail = function (e) {
                if (err) { err.hidden = false; err.textContent = e.message || 'That did not work.'; }
            };
            if (!window.MPAccount) return;
            if (registerMode) window.MPAccount.register(email, name || email, pw).then(done).catch(fail);
            else window.MPAccount.login(email, pw).then(done).catch(fail);
        });

        // Public API for hiding modal after connection
        window.ConnectionModal = {
            /**
             * Report a connect failure the app caught itself. Apps that only
             * toast leave the form claiming to be mid-connect, and the person
             * is looking at the form, not the corner of the screen.
             */
            fail: function (err) { if (_reportFailure) _reportFailure(err); },
            /** Called by the modal's own connect path once a room is joined. */
            recordConnect: function (channel, password, username) {
                if (!accountId || !window.Keyring) return;
                var chk = document.getElementById('saveChannelChk');
                var row;
                if (chk && chk.checked) {
                    row = window.Keyring.add(accountId, {
                        name: channel, password: password, username: username
                    });
                } else {
                    // Unticking has to mean something. This box shows whether
                    // the channel IS saved -- refreshSaveRow ticks it from
                    // Keyring.has -- so unticking it and connecting used to
                    // call touch(), which only bumps lastUsedAt on a row that
                    // is already there. The channel stayed saved and the box
                    // came back ticked: the control said one thing and did
                    // nothing. Take it out instead.
                    var saved = window.Keyring.touch(accountId, channel, password);
                    if (saved) {
                        window.Keyring.remove(accountId, saved.id);
                        // Apps pointed at it by id; drop those rather than
                        // leaving them aimed at a channel that is gone.
                        if (window.AppConfig) window.AppConfig.forgetChannel(accountId, saved.id);
                        saved = null;
                    }
                    row = saved;
                }
                // The app records that it used this channel. The channel does
                // not record the app: the arrow points one way, app -> channel.
                if (row && window.AppConfig) {
                    window.AppConfig.noteChannel(accountId, appId, row.id);
                }
                renderSaved();
                refreshSaveRow();
            },
            hide: function() {
                const modal = document.getElementById('connectionModal');
                if (modal) {
                    modal.classList.remove('active');
                    modal.classList.remove('collapsed');
                    console.log('[ConnectionModal] Hidden');
                }
                if (onHideModal) onHideModal();
            },
            show: function() {
                const modal = document.getElementById('connectionModal');
                CodeChip.remove();   // the chip names the room you are in; back at the form you are in none
                if (modal) {
                    modal.classList.add('active');
                    console.log('[ConnectionModal] Shown');
                }
            },
            // The dialog no longer collapses (2026-10-05). Kept so an app that
            // still calls them does not throw; they do nothing.
            collapse: function() {},
            expand: function() {}
        };

        console.log('[ConnectionModal] Initialized with prefix:', localStoragePrefix);
    };

    // Password visibility toggle (global function)
    window.togglePasswordVisibility = function() {
        const pwInput = document.getElementById('passwordInput');
        const show = document.getElementById('passwordEyeShow');
        const hide = document.getElementById('passwordEyeHide');
        const btn = document.getElementById('togglePasswordBtn');
        if (!pwInput || !btn) return;

        const revealing = pwInput.type === 'password';
        pwInput.type = revealing ? 'text' : 'password';

        // These two are <svg>, and `hidden` is an IDL property of HTMLElement,
        // which SVGElement does not inherit: `svg.hidden = true` sets a plain
        // expando and never reaches the content attribute, so the glyph never
        // changed. The attribute has to be set by name.
        const setHidden = (el, on) => {
            if (!el) return;
            if (on) el.setAttribute('hidden', '');
            else el.removeAttribute('hidden');
        };
        setHidden(show, revealing);
        setHidden(hide, !revealing);

        // The glyphs are aria-hidden, so the button's own label is the only
        // thing a screen reader has to go on — and it is what a test looks the
        // button up by.
        btn.setAttribute('aria-label', revealing ? 'Hide password' : 'Show password');
        btn.setAttribute('title', revealing ? 'Hide password' : 'Show password');
    };

})(window);
