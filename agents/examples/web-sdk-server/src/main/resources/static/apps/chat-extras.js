/**
 * Chat's extras: who is typing, reactions on messages, links you can open, and
 * a companion to talk to when nobody else is here.
 *
 * Everything goes through the same raw AgentConnection the page uses
 * (window.channel), so this is also the demo of a custom message type:
 *
 *  - "chat-typing" is EPHEMERAL: a short-lived signal the server does not keep,
 *    so a reload does not replay a minute of "Ann is typing".
 *  - "chat-react" is not: a reaction is part of the conversation, kept with
 *    the messages and replayed with them.
 *
 * A message is named by who sent it and the server's date for it, which every
 * reader receives identically. The sender of anything is the item's `from`,
 * which the server stamps; a reaction cannot be made in somebody else's name.
 */
(function () {
    'use strict';

    const REACTIONS = ['👍', '❤️', '😂', '🎉'];
    const TYPING_SEND_MS = 2500;     // at most one "typing" signal per this long
    const TYPING_SHOW_MS = 4000;     // and it shows this long after the last one
    const REPLY_THINK_MS = 900;

    const reactions = new Map();     // message key -> Map(emoji -> Set(names))
    const typers = new Map();        // name -> time their typing expires
    let lastTypingSent = 0;
    let companion = null;

    const me = () => (window.channel && window.channel.agentName) || '';
    const keyOf = (from, date) => from + '|' + date;

    function send(conn, customType, content, ephemeral) {
        if (!conn || typeof conn.sendMessage !== 'function') return;
        try { conn.sendMessage({ content, type: 'CUSTOM', customType, ephemeral: !!ephemeral }, function () {}); }
        catch (e) { /* not connected yet */ }
    }

    // ------------------------------------------------------------- links

    /**
     * The message text, with http(s) addresses as links that open in a new tab.
     * Built from text nodes and anchors, never HTML, so nothing in a message
     * can become markup; trailing punctuation stays out of the address.
     */
    function linkify(bubble, text) {
        const parts = String(text).split(/(https?:\/\/[^\s<>"']+)/g);
        if (parts.length === 1) return;
        bubble.textContent = '';
        parts.forEach((part, i) => {
            if (i % 2 === 0) { if (part) bubble.appendChild(document.createTextNode(part)); return; }
            const tail = (part.match(/[.,!?;:)\]]+$/) || [''])[0];
            const url = tail ? part.slice(0, -tail.length) : part;
            const a = document.createElement('a');
            a.href = url;
            a.textContent = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer nofollow';
            bubble.appendChild(a);
            if (tail) bubble.appendChild(document.createTextNode(tail));
        });
    }

    // ------------------------------------------------------------- reactions

    /** Called by the page for every message row it draws. */
    function decorate(row, bubble, from, date, text) {
        linkify(bubble, text);
        const key = keyOf(from, date);
        row.dataset.key = key;
        const col = bubble.parentElement;
        const tray = document.createElement('div');
        tray.className = 'react-tray';
        tray.setAttribute('role', 'group');
        tray.setAttribute('aria-label', 'React to this message');
        REACTIONS.forEach((e) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = e;
            b.setAttribute('aria-label', 'React ' + e);
            b.addEventListener('click', () => toggle(key, e));
            tray.appendChild(b);
        });
        const chips = document.createElement('div');
        chips.className = 'react-chips';
        col.insertBefore(tray, bubble);
        col.appendChild(chips);
        // On a touch screen there is no hover: a tap on the bubble shows the tray.
        bubble.addEventListener('click', (ev) => { if (!ev.target.closest('a')) row.classList.toggle('show-react'); });
        renderChips(key);
    }

    function toggle(key, e) {
        const mine = (reactions.get(key) || new Map()).get(e);
        const on = !(mine && mine.has(me()));
        send(window.channel, 'chat-react', JSON.stringify({ k: key, e, on }));
    }

    function applyReaction(from, data) {
        if (!data || typeof data.k !== 'string' || REACTIONS.indexOf(data.e) < 0) return;
        const byEmoji = reactions.get(data.k) || new Map();
        const names = byEmoji.get(data.e) || new Set();
        if (data.on === false) names.delete(from); else names.add(from);
        byEmoji.set(data.e, names);
        reactions.set(data.k, byEmoji);
        renderChips(data.k);
        // A reaction is what they were typing towards, as much as a message is.
        if (typers.delete(from)) renderTyping();
    }

    function renderChips(key) {
        const row = document.querySelector('.msg-row[data-key="' + CSS.escape(key) + '"]');
        const chips = row && row.querySelector('.react-chips');
        if (!chips) return;
        chips.replaceChildren();
        (reactions.get(key) || new Map()).forEach((names, e) => {
            if (!names.size) return;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'react-chip' + (names.has(me()) ? ' is-mine' : '');
            chip.textContent = e + ' ' + names.size;
            chip.title = Array.from(names).join(', ');
            chip.addEventListener('click', () => toggle(key, e));
            chips.appendChild(chip);
        });
    }

    // ------------------------------------------------------------- typing

    /** The composer changed: tell the room, at most every few seconds. */
    function typing() {
        const now = Date.now();
        if (now - lastTypingSent < TYPING_SEND_MS) return;
        lastTypingSent = now;
        send(window.channel, 'chat-typing', '1', true);
    }

    function showTyping(name) {
        typers.set(name, Date.now() + TYPING_SHOW_MS);
        renderTyping();
        setTimeout(renderTyping, TYPING_SHOW_MS + 50);
    }

    function renderTyping() {
        const line = document.getElementById('typingLine');
        if (!line) return;
        const now = Date.now();
        typers.forEach((until, n) => { if (until < now) typers.delete(n); });
        const names = Array.from(typers.keys());
        line.textContent = !names.length ? ''
            : names.length === 1 ? names[0] + ' is typing…'
                : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' are typing…';
    }

    // ------------------------------------------------------------- the page's hooks

    /** A custom item arrived on the page's own connection. */
    function onCustom(it) {
        if (!it || !it.from) return;
        if (it.customType === 'chat-react') {
            // Your own reactions come back this way too; that is how they show.
            try { applyReaction(it.from, JSON.parse(it.content)); } catch (e) { /* not a reaction */ }
        } else if (it.customType === 'chat-typing' && it.from !== me()) {
            showTyping(it.from);
        }
    }

    /** A message arrived: whoever sent it has stopped typing. */
    function onText(it) {
        if (it && typers.delete(it.from)) renderTyping();
    }

    // ------------------------------------------------------------- the companion

    /**
     * A real second connection in this tab: same room, its own name, its own
     * encryption. It types, then answers commands, greetings and questions,
     * or reacts to what you said (chat-bot.js decides which).
     */
    async function addCompanion() {
        if (companion) return true;
        const name = ($('channelName') || {}).value, pw = ($('channelPassword') || {}).value;
        if (!window.channel || !name) { toastMsg('Join a room by name first, then add a companion', 'info'); return false; }
        let apiKey;
        try { apiKey = (await window.fetchAppConfig(300, false)).apiKey; } catch (e) { apiKey = null; }
        if (!apiKey) { toastMsg('Could not get a key for the companion', 'error'); return false; }
        const c = new AgentConnection();
        c.agentName = ChatBot.NAME + '-' + Math.random().toString(36).slice(2, 5);
        c.addEventListener('message', (ev) => companionHeard(c, ev));
        c.connect({
            api: (typeof ApiConfig !== 'undefined') ? ApiConfig.getMessagingServiceUrl() : undefined,
            apiKey, apiKeyScope: 'public', user: c.agentName, autoReceive: true,
            channelName: name, channelPassword: pw
        });
        companion = c;
        markButton();
        return true;
    }

    function removeCompanion() {
        if (!companion) return;
        try { companion.disconnect(); } catch (e) { /* going anyway */ }
        companion = null;
        markButton();
    }

    function companionHeard(c, ev) {
        const res = ev && ev.response;
        const items = Array.isArray(res && res.data) ? res.data : [];
        items.forEach((it) => {
            if (!it || it.type !== 'chat-text' || it.systemEvent || it.from === c.agentName) return;
            if (c.connectTime && it.date <= c.connectTime) return;     // history is not a conversation
            const said = ChatBot.reply(it.content, it.from);
            if (!said) return;
            send(c, 'chat-typing', '1', true);
            setTimeout(() => {
                if (said.text) c.sendMessage(said.text, function () {});
                else send(c, 'chat-react', JSON.stringify({ k: keyOf(it.from, it.date), e: said.react, on: true }));
            }, REPLY_THINK_MS);
        });
    }

    function markButton() {
        const b = document.getElementById('companionBtn');
        if (!b) return;
        b.textContent = companion ? 'Remove companion' : 'Add a companion';
        b.classList.toggle('is-on', !!companion);
    }

    function $(id) { return document.getElementById(id); }
    function toastMsg(m, t) { if (typeof window.showToast === 'function') window.showToast(m, t); }

    document.addEventListener('DOMContentLoaded', () => {
        const b = $('companionBtn');
        if (b) b.addEventListener('click', () => (companion ? removeCompanion() : addCompanion()));
        window.addEventListener('beforeunload', removeCompanion);
    });

    window.ChatExtras = { decorate, onCustom, onText, typing, addCompanion, removeCompanion, linkify,
        get companion() { return companion; } };
})();
