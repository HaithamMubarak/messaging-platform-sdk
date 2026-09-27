/**
 * PartyLobby's rules (js/party-lobby.js).
 *
 * A party code is the whole invite, read aloud across a room or typed on a
 * phone. So:
 *   1. codes use only characters that cannot be misread (no 0/O, 1/I/L);
 *   2. what a person types is forgiven for case and spacing, but a code that
 *      is not a code is refused rather than guessed at;
 *   3. the same code always reaches the same room — and the same code in a
 *      different game reaches a different one, so "ABC234" in Chess never
 *      lands you in someone's Air Hockey game;
 *   4. codes are random enough that two parties starting at once do not meet.
 */
const assert = require('assert');
const path = require('path');
const { webcrypto } = require('crypto');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
global.window = { crypto: webcrypto };
require(path.join(STATIC, 'js', 'party-lobby.js'));
const { PartyLobby } = global.window;

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

console.log('party lobby');

check('the alphabet has no characters people misread', () => {
    for (const c of '01OIL') assert.ok(!PartyLobby.ALPHABET.includes(c), c + ' is in the alphabet');
});

check('a new code is six characters from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
        const code = PartyLobby.newCode();
        assert.strictEqual(code.length, 6);
        assert.ok([...code].every((c) => PartyLobby.ALPHABET.includes(c)), code);
    }
});

check('codes do not repeat in practice', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(PartyLobby.newCode());
    assert.ok(seen.size >= 4995, 'only ' + seen.size + ' distinct of 5000');
});

check('typing is forgiven for case, spaces and dashes', () => {
    assert.strictEqual(PartyLobby.normalize(' abc-234 '), 'ABC234');
    assert.strictEqual(PartyLobby.normalize('k x t 9 p q'), 'KXT9PQ');
});

check('something that is not a code is refused, not guessed at', () => {
    assert.strictEqual(PartyLobby.normalize('ABC23'), null, 'too short');
    assert.strictEqual(PartyLobby.normalize('ABC2345'), null, 'too long');
    assert.strictEqual(PartyLobby.normalize('ABC10O'), null, 'characters no code contains');
    assert.strictEqual(PartyLobby.normalize(''), null);
    assert.strictEqual(PartyLobby.normalize(null), null);
});

check('the same code always reaches the same room', () => {
    assert.deepStrictEqual(PartyLobby.roomFor('hockey-', 'ABC234'), PartyLobby.roomFor('hockey-', 'ABC234'));
});

check('the same code in another game is another room', () => {
    const hockey = PartyLobby.roomFor('hockey-', 'ABC234');
    const chess = PartyLobby.roomFor('chess-', 'ABC234');
    assert.notStrictEqual(hockey.channel, chess.channel);
    assert.notStrictEqual(hockey.password, chess.password);
});

check('the room keeps the game prefix, so the channel list stays readable', () => {
    assert.ok(PartyLobby.roomFor('gavel-', 'ABC234').channel.startsWith('gavel-'));
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
