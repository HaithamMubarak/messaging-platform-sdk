/*
 * Pulse — the "Raw storage" tab.
 *
 * The poll shows what storage is FOR; this tab is the bare calls underneath it,
 * on the same channel Pulse is connected to. It replaced the separate Channel
 * storage demo (hub consolidation phase 4, 2026-10-03), which was these calls
 * with no story. Every call goes through window.pulseApp.channel, so the wire
 * panel beside it shows each one firing.
 */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function channel() {
        var app = window.pulseApp;
        if (!app || !app.channel) { UI.toast('Connect to a room first', 'error'); return null; }
        return app.channel;
    }

    function key() {
        var k = $('rawKey').value.trim();
        if (!k) UI.toast('A key is required', 'error');
        return k;
    }

    /** The value box as JSON, or undefined (with a toast) when it does not parse. */
    function value() {
        try { return JSON.parse($('rawValue').value); }
        catch (e) { UI.toast('Value is not JSON: ' + e.message, 'error'); return undefined; }
    }

    function show(label, data) {
        $('rawOut').textContent = label + '\n' + (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    }

    function answered(label) {
        return function (res) {
            if (res && res.status === 'success') show(label + ': ok', res.data === undefined ? '' : res.data);
            else show(label + ': failed', (res && res.statusMessage) || 'no answer');
        };
    }

    var ops = {
        // PUT replaces every version under the key; ADD appends one beside them.
        put: function (ch, k) {
            var v = value(); if (v === undefined) return;
            ch.storagePut({ storageKey: k, content: v, encrypted: false }, answered('PUT ' + k));
        },
        add: function (ch, k) {
            var v = value(); if (v === undefined) return;
            ch.storageAdd({ storageKey: k, content: v, encrypted: false }, answered('ADD ' + k));
        },
        // The promise forms decode the stored JSON for you; the callback forms hand back base64.
        get: function (ch, k) {
            ch.storageRead(k).then(function (v) { show('GET ' + k, v === null ? '(nothing stored)' : v); },
                function (e) { show('GET ' + k + ': failed', e.message); });
        },
        history: function (ch, k) {
            ch.storageReadList(k).then(function (list) { show('HISTORY ' + k + ' (' + list.length + ' versions, oldest first)', list); },
                function (e) { show('HISTORY ' + k + ': failed', e.message); });
        },
        keys: function (ch) {
            ch.storageKeys(function (res) {
                var keys = (res && res.data && res.data.data && res.data.data.keys) || [];
                if (res && res.status === 'success') show('KEYS (' + keys.length + ')', keys);
                else answered('KEYS')(res);
            });
        },
        del: function (ch, k) {
            if (!window.confirm('Delete every version of "' + k + '" for everyone on this channel?')) return;
            ch.storageDeleteByKey(k, answered('DELETE ' + k));
        }
    };

    function run(op) {
        var ch = channel(); if (!ch) return;
        if (op === 'keys') { ops.keys(ch); return; }
        var k = key(); if (k) ops[op](ch, k);
    }

    function selectTab(name) {
        document.querySelectorAll('[data-pulse-tab]').forEach(function (tab) {
            var on = tab.getAttribute('data-pulse-tab') === name;
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
            $(tab.getAttribute('aria-controls')).hidden = !on;
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('[data-pulse-tab]').forEach(function (tab) {
            tab.addEventListener('click', function () { selectTab(tab.getAttribute('data-pulse-tab')); });
        });
        document.querySelectorAll('[data-raw-op]').forEach(function (btn) {
            btn.addEventListener('click', function () { run(btn.getAttribute('data-raw-op')); });
        });
        // The old demo's address lands here (gateway 301 to ?tab=storage; the hash is the room's invite).
        if (new URLSearchParams(location.search).get('tab') === 'storage') selectTab('raw');
    });
})();
