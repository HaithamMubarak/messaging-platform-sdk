/**
 * Room codes (PartyCode in js/connection-modal.js).
 *
 * A code is how most people now get into a room: twelve digits read across a
 * table or typed on a phone. A wrong code does not fail -- it opens an empty
 * room of its own and spends a channel on the demos' shared quota -- so the
 * code has to catch its own mistakes before anything connects:
 *   1. a new code is twelve digits and is a code in the app that made it;
 *   2. it is not a code in another app, so Chess's code never opens Whiteboard;
 *   3. one wrong digit, anywhere, is refused;
 *   4. two neighbouring digits swapped are refused;
 *   5. a random number is refused (about 1 in 1000 pass);
 *   6. what a person types is forgiven for spaces and dashes, and a short code
 *      is told apart from a wrong one;
 *   7. a code names exactly one room, and the room gives its code back.
 */
const assert = require('assert');
const path = require('path');
const { webcrypto } = require('crypto');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
global.window = { crypto: webcrypto };
require(path.join(STATIC, 'js', 'connection-modal.js'));
const { PartyCode } = global.window;

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}
const codes = (app, n) => Array.from({ length: n }, () => PartyCode.newCode(app));

console.log('room codes');

check('a new code is twelve digits and a code in its own app', () => {
    for (const code of codes('whiteboard', 500)) {
        assert.ok(/^\d{12}$/.test(code), code);
        assert.ok(PartyCode.isValid('whiteboard', code), code + ' is not valid where it was made');
    }
});

check('a code from another app is refused', () => {
    const passed = codes('chess', 2000).filter((c) => PartyCode.isValid('whiteboard', c)).length;
    assert.ok(passed <= 8, passed + ' of 2000 Chess codes open a Whiteboard room');
});

check('one wrong digit anywhere is refused', () => {
    let tried = 0, passed = 0;
    for (const code of codes('whiteboard', 300)) {
        for (let i = 0; i < 12; i++) {
            for (let d = 0; d < 10; d++) {
                if (String(d) === code[i]) continue;
                tried++;
                if (PartyCode.isValid('whiteboard', code.slice(0, i) + d + code.slice(i + 1))) passed++;
            }
        }
    }
    assert.ok(passed / tried < 0.003, passed + ' of ' + tried + ' one-digit typos were accepted');
});

check('two swapped neighbours are refused', () => {
    let tried = 0, passed = 0;
    for (const code of codes('whiteboard', 1000)) {
        for (let i = 0; i < 11; i++) {
            if (code[i] === code[i + 1]) continue;
            tried++;
            const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
            if (PartyCode.isValid('whiteboard', swapped)) passed++;
        }
    }
    assert.ok(passed / tried < 0.005, passed + ' of ' + tried + ' swaps were accepted');
});

check('a random twelve-digit number is refused about 999 times in 1000', () => {
    let passed = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
        const guess = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
        if (PartyCode.isValid('whiteboard', guess)) passed++;
    }
    assert.ok(passed > n * 0.0004 && passed < n * 0.002, passed + ' of ' + n + ' random numbers passed');
});

check('typing is forgiven for spaces and dashes, and short is not wrong', () => {
    const code = PartyCode.newCode('whiteboard');
    const spaced = PartyCode.format(code);
    assert.strictEqual(spaced, code.slice(0, 4) + ' ' + code.slice(4, 8) + ' ' + code.slice(8));
    assert.ok(PartyCode.isValid('whiteboard', ' ' + spaced.replace(/ /g, '-') + ' '));
    assert.strictEqual(PartyCode.problem('whiteboard', code.slice(0, 7)), 'short');
    assert.strictEqual(PartyCode.problem('whiteboard', code + '1'), 'long');
    assert.strictEqual(PartyCode.problem('whiteboard', ''), 'short');
    assert.strictEqual(PartyCode.problem('whiteboard', null), 'short');
    const wrong = code.slice(0, 11) + ((Number(code[11]) + 1) % 10);
    assert.strictEqual(PartyCode.problem('whiteboard', wrong), 'wrong');
});

check('a code names one room in its app, and the room gives the code back', () => {
    const code = PartyCode.newCode('whiteboard');
    const room = PartyCode.roomFor('whiteboard', code);
    assert.deepStrictEqual(room, { channel: 'whiteboard-' + code.slice(0, 6), password: code.slice(6) });
    assert.strictEqual(PartyCode.codeFor('whiteboard', room.channel, room.password), code);
    assert.strictEqual(PartyCode.codeFor('chess', room.channel, room.password), null, 'another app claims the room');
    assert.strictEqual(PartyCode.codeFor('whiteboard', room.channel, room.password.slice(1)), null);
    assert.strictEqual(PartyCode.codeFor('whiteboard', 'whiteboard-12345678', 'abcdefgh'), null, 'an ordinary channel');
    assert.strictEqual(PartyCode.codeFor('whiteboard', '', ''), null);
});

check('codes do not repeat in practice', () => {
    const seen = new Set(codes('whiteboard', 5000));
    assert.ok(seen.size >= 4999, 'only ' + seen.size + ' distinct of 5000');
});

check('the app id is the one the modal and the lobby share', () => {
    assert.strictEqual(PartyCode.appIdOf({ appId: 'pulse', channelPrefix: 'x-' }), 'pulse');
    assert.strictEqual(PartyCode.appIdOf({ channelPrefix: 'whiteboard-' }), 'whiteboard');
    assert.strictEqual(PartyCode.appIdOf({}), 'channel');
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
