/**
 * Chess's computer opponent (apps/chess/chess-bot.js).
 *
 * The promises: it only ever plays legal moves and leaves the game as it found
 * it; it takes a mate in one; it takes a free piece and does not hang its own;
 * it plays both colours; and a whole game against itself ends without error.
 */
const assert = require('assert');
const path = require('path');

const CHESS = path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'apps', 'chess');
const { Chess } = require(path.join(CHESS, 'lib', 'chess.min.js'));
const Bot = require(path.join(CHESS, 'chess-bot.js'));

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}
const first = () => 0;   // always the first of the near-best: deterministic

console.log('chess bot');

check('it returns a legal move and leaves the game untouched', () => {
    const g = new Chess();
    const before = g.fen();
    const m = Bot.pick(g, { random: first });
    assert.strictEqual(g.fen(), before, 'the board moved under the caller');
    assert.ok(g.moves().includes(m.san), m.san + ' is not legal');
});

check('it takes a mate in one (white)', () => {
    // Scholar's mate pending: Qxf7#.
    const g = new Chess('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
    const m = Bot.pick(g, { random: first });
    assert.strictEqual(m.san, 'Qxf7#');
});

check('it takes a mate in one on easy too', () => {
    const g = new Chess('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
    assert.strictEqual(Bot.pick(g, { level: 'easy', random: first }).san, 'Qxf7#');
});

check('it takes a mate in one as black', () => {
    // Fool's mate: ...Qh4#.
    const g = new Chess('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2');
    assert.strictEqual(Bot.pick(g, { random: first }).san, 'Qh4#');
});

check('it takes a free queen', () => {
    // White's queen on d5 hangs to the knight on f6.
    const g = new Chess('rnbqkb1r/pppppppp/5n2/3Q4/8/8/PPPP1PPP/RNB1KBNR b KQkq - 0 3');
    assert.strictEqual(Bot.pick(g, { random: first }).san, 'Nxd5');
});

check('it does not hang its queen for a pawn', () => {
    // Qxf7+?? wins a pawn and loses the queen to Kxf7.
    const g = new Chess('rnbqkbnr/ppp2ppp/3p4/4p3/8/5Q2/PPPPPPPP/RNB1KBNR w KQkq - 0 3');
    for (let i = 0; i < 5; i++) {
        const m = Bot.pick(g, { random: () => i / 5 });
        assert.notStrictEqual(m.san, 'Qxf7+', 'it played ' + m.san);
    }
});

check('a game against itself ends, with only legal moves, in reasonable time', () => {
    const g = new Chess();
    const started = Date.now();
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let ply = 0; ply < 160 && !g.game_over(); ply++) {
        const m = Bot.pick(g, { random, level: ply % 2 ? 'easy' : 'normal' });
        assert.ok(g.move({ from: m.from, to: m.to, promotion: m.promotion }), 'illegal ' + m.san);
    }
    const perMove = (Date.now() - started) / Math.max(1, g.history().length);
    assert.ok(perMove < 1500, 'too slow: ' + perMove.toFixed(0) + ' ms a move');
    console.log('       (' + g.history().length + ' plies, ' + perMove.toFixed(0) + ' ms a move)');
});

check('a finished game gets no move', () => {
    const g = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    assert.strictEqual(Bot.pick(g), null);
});

if (failed) { console.log(failed + ' failed'); process.exitCode = 1; } else console.log('all passed');
