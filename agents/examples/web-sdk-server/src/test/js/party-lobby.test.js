/**
 * PartyLobby's rules (js/party-lobby.js).
 *
 * A party code is the whole invite, read aloud across a room or typed on a
 * phone. Since 2026-10-05 it is the connection modal's room code (twelve
 * self-checking digits, see party-code.test.js) rather than six letters, so:
 *   1. a new code is a room code of THIS game;
 *   2. what a person types is forgiven for spacing, but a code that is not a
 *      code is refused rather than guessed at -- and a code from another game
 *      is not a code here;
 *   3. the same code always reaches the same room, the room the connection
 *      modal's Code tab reaches with it;
 *   4. a six-letter code already sent still reaches the room it always did,
 *      because an invite that stops working is a broken invite;
 *   5. codes are random enough that two parties starting at once do not meet.
 * (These replaced the six-letter rules -- "no 0/O/1/I/L", "six characters" --
 * on purpose; the promises underneath them are 2, 3 and 5.)
 */
const assert = require('assert');
const path = require('path');
const { webcrypto } = require('crypto');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
global.window = { crypto: webcrypto };
require(path.join(STATIC, 'js', 'connection-modal.js'));   // PartyCode
require(path.join(STATIC, 'js', 'party-lobby.js'));
const { PartyLobby, PartyCode } = global.window;

const hockey = { channelPrefix: 'hockey-' };
const chess = { channelPrefix: 'chess-' };

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

console.log('party lobby');

check('a new code is a room code of this game', () => {
    for (let i = 0; i < 200; i++) {
        const code = PartyLobby.newCode(hockey);
        assert.ok(/^\d{12}$/.test(code), code);
        assert.ok(PartyCode.isValid('hockey', code), code);
    }
});

check('codes do not repeat in practice', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(PartyLobby.newCode(hockey));
    assert.ok(seen.size >= 4999, 'only ' + seen.size + ' distinct of 5000');
});

check('typing is forgiven for spaces and dashes', () => {
    const code = PartyLobby.newCode(hockey);
    assert.strictEqual(PartyLobby.normalize(hockey, ' ' + PartyCode.format(code) + ' '), code);
    assert.strictEqual(PartyLobby.normalize(hockey, code.slice(0, 4) + '-' + code.slice(4, 8) + '-' + code.slice(8)), code);
});

check('something that is not a code is refused, not guessed at', () => {
    const code = PartyLobby.newCode(hockey);
    assert.strictEqual(PartyLobby.normalize(hockey, code.slice(0, 11)), null, 'too short');
    assert.strictEqual(PartyLobby.normalize(hockey, code.slice(0, 11) + ((Number(code[11]) + 1) % 10)), null, 'a typo');
    assert.strictEqual(PartyLobby.normalize(hockey, ''), null);
    assert.strictEqual(PartyLobby.normalize(hockey, null), null);
});

check('a code from another game is not a code here', () => {
    let opened = 0;
    for (let i = 0; i < 1000; i++) if (PartyLobby.normalize(hockey, PartyLobby.newCode(chess))) opened++;
    assert.ok(opened <= 5, opened + ' of 1000 Chess codes open an Air Hockey room');
});

check('the same code always reaches the same room, the one the Code tab reaches', () => {
    const code = PartyLobby.newCode(hockey);
    assert.deepStrictEqual(PartyLobby.roomFor(hockey, code), PartyLobby.roomFor(hockey, code));
    assert.deepStrictEqual(PartyLobby.roomFor(hockey, code), PartyCode.roomFor('hockey', code));
    assert.ok(PartyLobby.roomFor(hockey, code).channel.startsWith('hockey-'));
});

check('a six-letter code already sent still reaches its old room', () => {
    assert.strictEqual(PartyLobby.normalize(hockey, ' abc-234 '), 'ABC234');
    assert.deepStrictEqual(PartyLobby.roomFor(hockey, 'ABC234'),
        { channel: 'hockey-p-abc234', password: 'party-ABC234-hockey-' });
    assert.strictEqual(PartyLobby.normalize(hockey, 'ABC10O'), null, 'characters no old code contained');
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
