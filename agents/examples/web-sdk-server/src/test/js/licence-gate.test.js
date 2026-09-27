/**
 * LicenceGate: the licence check commercial apps share (js/licence-gate.js).
 *
 * The rules that matter are the ones an app would otherwise get subtly wrong:
 *   1. a key is remembered only when Till said it was valid;
 *   2. the seat claimed is the app's own idea of a seat (a site, a home),
 *      read at check time, not at construction;
 *   3. nothing is claimed without a key or without a service to ask, and the
 *      verdict says which, rather than pretending to be "invalid";
 *   4. Till's reason is shown, not replaced by something friendlier.
 */
const assert = require('assert');
const path = require('path');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');

const calls = [];
let answer = { valid: true, plan: 'site' };
const store = {};
global.window = {
    ApiConfig: { getMessagingServiceUrl: () => 'https://api.example/messaging-service' },
    AgentConnection: {
        Till: {
            configure(api) { calls.push(['configure', api]); },
            async claimSeat(o) { calls.push(['claimSeat', o]); return answer; },
            remember(app, key) { store[app] = key; },
            recall(app) { return store[app] || null; },
        },
    },
};
require(path.join(STATIC, 'js', 'licence-gate.js'));
const { LicenceGate } = global.window;

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('  ok   ' + name);
    } catch (e) {
        failed++;
        console.log('  FAIL ' + name + ' -- ' + e.message);
    }
}

const pill = () => ({ textContent: '', className: '' });

(async () => {
    console.log('licence gate');

    await check('a valid key claims a seat for the app\'s own seat, and is remembered', async () => {
        let site = 'Willow Depot';
        const p = pill();
        const seen = [];
        const gate = LicenceGate.create({ app: 'gatehouse', seatRef: () => site, pill: p, onChange: (v) => seen.push(v) });
        site = 'Oak Yard';   // read at check time, not at construction
        const v = await gate.check('  gh-123  ');
        assert.strictEqual(v.valid, true);
        const claim = calls.find((c) => c[0] === 'claimSeat')[1];
        assert.deepStrictEqual(claim, { app: 'gatehouse', key: 'gh-123', seatRef: 'Oak Yard' });
        assert.strictEqual(store.gatehouse, 'gh-123');
        assert.strictEqual(p.textContent, 'Licensed · site');
        assert.strictEqual(p.className, 'pill-status is-on');
        assert.strictEqual(seen.length, 1);
    });

    await check('an invalid key is not remembered, and Till\'s reason is shown as given', async () => {
        delete store.baton;
        answer = { valid: false, reason: 'seats_exhausted' };
        const p = pill();
        const gate = LicenceGate.create({ app: 'baton', seatRef: 'home', pill: p });
        const v = await gate.check('bt-999');
        assert.strictEqual(v.valid, false);
        assert.strictEqual(store.baton, undefined);
        assert.strictEqual(p.textContent, 'Unlicensed · seats exhausted');
        assert.strictEqual(p.className, 'pill-status is-off');
    });

    await check('no key: nothing is claimed, and the verdict says "no key"', async () => {
        calls.length = 0;
        const gate = LicenceGate.create({ app: 'signet' });
        const v = await gate.check('   ');
        assert.strictEqual(v.reason, 'no_key');
        assert.strictEqual(calls.length, 0);
    });

    await check('no service to ask: the verdict says "unavailable", not "invalid"', async () => {
        const saved = global.window.ApiConfig;
        global.window.ApiConfig = null;
        calls.length = 0;
        const v = await LicenceGate.create({ app: 'signet' }).check('sg-1');
        global.window.ApiConfig = saved;
        assert.strictEqual(v.reason, 'unavailable');
        assert.strictEqual(calls.length, 0);
    });

    await check('restore() checks the remembered key, and does nothing without one', async () => {
        answer = { valid: true };
        store.screener = 'sc-7';
        calls.length = 0;
        const v = await LicenceGate.create({ app: 'screener', seatRef: 'room' }).restore();
        assert.strictEqual(v.valid, true);
        assert.strictEqual(calls.find((c) => c[0] === 'claimSeat')[1].key, 'sc-7');
        calls.length = 0;
        assert.strictEqual(await LicenceGate.create({ app: 'nothing-remembered' }).restore(), null);
        assert.strictEqual(calls.length, 0);
    });

    await check('seats are shown when Till reports them (Signet showed "seat 2/5")', async () => {
        answer = { valid: true, plan: 'clinic', seats: 5, seatsUsed: 2 };
        const p = pill();
        await LicenceGate.create({ app: 'signet', seatRef: 'chair', pill: p }).check('sg-2');
        assert.strictEqual(p.textContent, 'Licensed · clinic · seat 2/5');
    });

    await check('restore() fills the key field, and the button checks what is typed', async () => {
        answer = { valid: true };
        store.turnstile = 'ts-remembered';
        const listeners = {};
        const input = { value: '' };
        const button = { addEventListener: (ev, fn) => { listeners[ev] = fn; } };
        const gate = LicenceGate.create({ app: 'turnstile', seatRef: 'gate', input, button });
        await gate.restore();
        assert.strictEqual(input.value, 'ts-remembered');
        calls.length = 0;
        input.value = ' ts-typed ';
        listeners.click();
        await new Promise((r) => setTimeout(r, 0));
        assert.strictEqual(calls.find((c) => c[0] === 'claimSeat')[1].key, 'ts-typed');
    });

    await check('ApiConfig as a global binding (not on window) is found — the production shape', async () => {
        // api-config.js is `const ApiConfig = …` in a classic script: reachable
        // by name, absent from window. Until 2026-09-27 every app looked on
        // window, found nothing, and never asked Till.
        const saved = global.window.ApiConfig;
        global.window.ApiConfig = undefined;
        global.ApiConfig = { getMessagingServiceUrl: () => 'https://api.example/by-binding' };
        answer = { valid: true };
        calls.length = 0;
        const v = await LicenceGate.create({ app: 'baton', seatRef: 'home' }).check('bt-1');
        delete global.ApiConfig;
        global.window.ApiConfig = saved;
        assert.strictEqual(v.valid, true);
        assert.deepStrictEqual(calls.find((c) => c[0] === 'configure'), ['configure', 'https://api.example/by-binding']);
    });

    await check('an app slug is required', async () => {
        assert.throws(() => LicenceGate.create({}), /app slug/);
    });

    console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
    process.exitCode = failed ? 1 : 0;
})();
