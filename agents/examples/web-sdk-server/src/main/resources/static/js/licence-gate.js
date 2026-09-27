/*
 * LicenceGate — the licence check a commercial app shows, done once.
 *
 * Every licensed app repeated the same steps around AgentConnection.Till:
 * point Till at the messaging service, claim a seat for this site, remember a
 * key that worked, recall it next time, and show "Licensed" or "Unlicensed ·
 * <reason>" in a pill. This is that, so an app writes what its licence DOES
 * (what stops, what gets stamped) and not how to ask.
 *
 *   const gate = LicenceGate.create({
 *       app: 'gatehouse',                  // the Till app slug
 *       seatRef: () => siteName,           // what one seat is: a site, a home…
 *       pill: document.getElementById('licencePill'),
 *       onChange: (verdict) => { … }       // verdict.valid decides behaviour
 *   });
 *   gate.restore();                        // a remembered key, if any
 *   gate.check(typedKey);                  // a key the operator entered
 *
 * Till's own answer is never softened: a network failure is "unavailable",
 * an unknown key is "invalid", and the app decides what an unlicensed site
 * still gets. Vendored into apps as vendor/sdk-ui/licence-gate.js.
 */
(function (root) {
    'use strict';

    function till() {
        return root.AgentConnection && root.AgentConnection.Till;
    }

    function describe(verdict) {
        if (!verdict) return 'Unlicensed · no key';
        if (verdict.valid) return 'Licensed' + (verdict.plan ? ' · ' + verdict.plan : '');
        return 'Unlicensed · ' + String(verdict.reason || 'no key').replace(/_/g, ' ');
    }

    function create(options) {
        const opts = options || {};
        if (!opts.app) throw new Error('LicenceGate needs an app slug.');
        const gate = { verdict: { valid: false, reason: 'no_key' } };

        gate.render = function () {
            if (!opts.pill) return;
            opts.pill.textContent = describe(gate.verdict);
            opts.pill.className = 'pill-status ' + (gate.verdict.valid ? 'is-on' : 'is-off');
        };

        function settle(verdict) {
            gate.verdict = verdict || { valid: false, reason: 'unavailable' };
            gate.render();
            if (typeof opts.onChange === 'function') opts.onChange(gate.verdict);
            return gate.verdict;
        }

        /** Claim a seat with this key. Resolves the verdict; never rejects. */
        gate.check = async function (key) {
            const t = till();
            const api = root.ApiConfig ? root.ApiConfig.getMessagingServiceUrl() : null;
            const k = String(key || '').trim();
            if (!t || !api || !k) return settle({ valid: false, reason: k ? 'unavailable' : 'no_key' });
            t.configure(api);
            const seatRef = typeof opts.seatRef === 'function' ? opts.seatRef() : opts.seatRef;
            const verdict = await t.claimSeat({ app: opts.app, key: k, seatRef: seatRef || 'default' });
            if (verdict && verdict.valid) t.remember(opts.app, k);
            return settle(verdict);
        };

        /** Check the key this browser remembered, if there is one. */
        gate.restore = function () {
            const t = till();
            const key = t ? t.recall(opts.app) : null;
            if (!key) { gate.render(); return Promise.resolve(null); }
            return gate.check(key);
        };

        gate.render();
        return gate;
    }

    root.LicenceGate = { create: create, describe: describe };
})(typeof window !== 'undefined' ? window : this);
