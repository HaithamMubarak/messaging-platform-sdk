/**
 * Chat — Knock: "ring me when I'm away".
 *
 * Was the Doorbell demo until hub consolidation phase 4 (2026-10-03) folded it
 * into Chat, where it belongs: you close the chat, somebody rings, your device
 * shows a notice, and tapping it brings you back to this page.
 *
 * The design worth copying is the split:
 *   - the knock carries NOTHING -- not who rang, not why. The push service
 *     learns that something happened and never what;
 *   - who rang goes into channel storage, where only people with the channel
 *     password can read it, and this page reads it when you open it.
 * "A knock was sent" is all anybody can honestly say. Whether a person saw it
 * is up to their browser and them.
 *
 * Uses Chat's own connection (window.channel, a bare AgentConnection).
 */
(function () {
    'use strict';

    var RINGS = 'chat.rings';
    var SAYS = {
        not_connected: 'Connect to a channel first.',
        unsupported: 'This browser cannot receive knocks. On an iPhone, add this page to the Home Screen first.',
        denied: 'Notifications are blocked for this site. Allow them in the browser settings, then try again.',
        no_key: 'This server has no push key configured.',
        ephemeral_key: 'This server has only a temporary push key, so a subscription would stop working at its next restart.',
        subscribe_failed: 'The browser could not subscribe.'
    };

    var state = { reachable: [], rings: [], ringing: null, lastSent: null };

    function $(id) { return document.getElementById(id); }
    function ch() { return window.channel && window.channel.sessionId ? window.channel : null; }
    function me() { return (window.channel && window.channel.agentName) || ''; }

    function refresh() {
        var c = ch(); if (!c) { render(); return; }
        c.knockReachable(function (res) {
            var list = res && res.status === 'success' && res.data && res.data.reachable;
            state.reachable = Array.isArray(list) ? list : [];
            render();
        });
        c.storageReadList(RINGS).then(function (rows) {
            state.rings = rows.filter(function (r) { return r && r.to && r.at; });
            render();
        }, function () { /* keep what we had; the next open tries again */ });
    }

    /** From a click only: a permission prompt nobody asked for is refused or resented. */
    async function letThisRing() {
        var c = ch();
        // Scope = this page, so a click on the notice opens Chat (the worker opens its own scope).
        state.ringing = c ? await c.knockSubscribe({ swPath: '../knock-sw.js', swScope: 'chat.html' }) : { ok: false, reason: 'not_connected' };
        render();
        refresh();
    }

    /** Say who rang where only the channel can read it, then knock with nothing in it. */
    function ring(agent) {
        var c = ch(); if (!c) return;
        c.storageAdd({ storageKey: RINGS, content: { to: agent, from: me(), at: Date.now() } }, function () {
            c.knock(agent, { tag: 'chat' }, function (res) {
                state.lastSent = res && res.status === 'success' ? res.data
                    : { meaning: 'No knock was sent: ' + ((res && res.data) || 'no answer') + '.' };
                refresh();
            });
        });
    }

    function renderSelf() {
        var mine = state.reachable.filter(function (r) { return r.agent === me(); })[0];
        var r = state.ringing;
        $('knockSelf').textContent = !ch() ? SAYS.not_connected
            : mine ? 'This browser can ring (' + mine.devices + (mine.devices === 1 ? ' device' : ' devices') + ' under your name). You can close the tab.'
            : r && !r.ok ? (SAYS[r.reason] || 'Could not subscribe: ' + r.reason) + (r.detail ? ' ' + r.detail : '')
            : 'This browser will not ring yet.';
        $('knockSubscribe').textContent = mine ? 'Subscribed' : 'Let this browser ring';
    }

    function renderPeople() {
        var others = state.reachable.filter(function (r) { return r.agent !== me(); });
        $('knockPeople').replaceChildren.apply($('knockPeople'), others.map(function (r) {
            var li = document.createElement('li'), b = document.createElement('button');
            li.appendChild(document.createTextNode(r.agent + ' · ' + r.devices + (r.devices === 1 ? ' device' : ' devices')));
            b.type = 'button'; b.className = 'btn'; b.textContent = 'Ring';
            b.addEventListener('click', function () { ring(r.agent); });
            li.appendChild(b);
            return li;
        }));
        $('knockNobody').hidden = others.length > 0;
        var s = state.lastSent;
        $('knockSent').hidden = !s;
        if (s) $('knockSent').textContent = s.meaning + (s.devices ? ' (' + (s.sent || 0) + ' of ' + s.devices
            + ' devices accepted by their push service' + (s.rateCapped ? ', ' + s.rateCapped + ' held back by the rate cap' : '') + ')' : '');
    }

    function renderRings() {
        var mine = state.rings.filter(function (r) { return r.to === me(); });
        $('knockRings').replaceChildren.apply($('knockRings'), mine.slice(0, 10).map(function (r) {
            var li = document.createElement('li');
            li.textContent = r.from + ' rang · ' + new Date(r.at).toLocaleString();
            return li;
        }));
        $('knockNoRings').hidden = mine.length > 0;
    }

    function render() { if ($('knockDialog')) { renderSelf(); renderPeople(); renderRings(); } }

    document.addEventListener('DOMContentLoaded', function () {
        var open = $('knock-open'), dialog = $('knockDialog');
        if (!open || !dialog) return;
        open.addEventListener('click', function () { dialog.showModal(); refresh(); });
        $('knockClose').addEventListener('click', function () { dialog.close(); });
        $('knockSubscribe').addEventListener('click', letThisRing);
    });
})();
