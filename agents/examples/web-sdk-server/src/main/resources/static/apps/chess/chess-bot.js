/**
 * The computer opponent: a small, honest chess player for whoever is alone.
 *
 * Pure: give it a chess.js game and it returns one of that game's legal moves,
 * leaving the game exactly as it found it (every trial move is undone). The
 * page (chess-game.js) decides when it plays; this file only decides what, so
 * it is tested without a browser (src/test/js/chess-bot.test.js).
 *
 * It looks two plies ahead (its move, the best reply) with alpha-beta, scores a
 * position by material plus where each piece stands, and looks for mate first.
 * That is enough to take a hanging piece, avoid losing one, and finish a mate
 * in one, while staying beatable. `level: 'easy'` plays one ply and picks among
 * near-best moves at random, so a beginner can win.
 */
(function (root) {
    'use strict';

    const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
    const MATE = 100000;

    // Piece-square tables from White's side, rank 8 first (chess.js board()
    // order). Small numbers: they break ties between equal material, nothing more.
    const PST = {
        p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10,
            5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5,
            5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
        n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30,
            -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
            -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
        b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10,
            -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
            -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
        r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
        q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
            -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10,
            -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
        k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
            -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
            20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20]
    };

    /** The position from White's point of view, in centipawns. */
    function evaluate(chess) {
        const board = chess.board();
        let score = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const sq = board[r][c];
                if (!sq) continue;
                // Black reads the table mirrored: its rank 8 is White's rank 1.
                const idx = sq.color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
                const v = VALUE[sq.type] + PST[sq.type][idx];
                score += sq.color === 'w' ? v : -v;
            }
        }
        return score;
    }

    /** Captures and promotions first: alpha-beta prunes far more that way. */
    function ordered(moves) {
        const gain = (m) => (m.captured ? VALUE[m.captured] * 10 - VALUE[m.piece] : 0) + (m.promotion ? 800 : 0);
        return moves.slice().sort((a, b) => gain(b) - gain(a));
    }

    function play(chess, m) { return chess.move({ from: m.from, to: m.to, promotion: m.promotion }); }

    /** Negamax with alpha-beta; the score is from the side to move's view. */
    function search(chess, depth, alpha, beta, ply) {
        if (chess.in_checkmate()) return -MATE + ply;   // sooner mates score higher
        if (chess.in_draw() || chess.in_stalemate()) return 0;
        if (depth === 0) return (chess.turn() === 'w' ? 1 : -1) * evaluate(chess);
        let best = -Infinity;
        for (const m of ordered(chess.moves({ verbose: true }))) {
            play(chess, m);
            const score = -search(chess, depth - 1, -beta, -alpha, ply + 1);
            chess.undo();
            if (score > best) best = score;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
        }
        return best;
    }

    /** Every legal move with its score, best first. */
    function scored(chess, depth) {
        return ordered(chess.moves({ verbose: true })).map((m) => {
            play(chess, m);
            const score = -search(chess, depth - 1, -Infinity, Infinity, 1);
            chess.undo();
            return { move: m, score };
        }).sort((a, b) => b.score - a.score);
    }

    /**
     * Choose a move for the side to move. Returns a chess.js verbose move, or
     * null when the game is over. `random` is injectable for the tests.
     */
    function pick(chess, opts) {
        const o = opts || {};
        const random = o.random || Math.random;
        if (chess.game_over()) return null;
        const easy = o.level === 'easy';
        const list = scored(chess, easy ? 1 : 2);
        // A mate is always taken; otherwise vary among the near-best so the
        // computer does not play the same game every time.
        if (list[0].score >= MATE - 10) return list[0].move;
        const margin = easy ? 120 : 15;
        const near = list.filter((s) => s.score >= list[0].score - margin);
        return near[Math.floor(random() * near.length)].move;
    }

    const ChessBot = { pick, evaluate, NAME: 'Computer' };
    if (typeof module !== 'undefined' && module.exports) module.exports = ChessBot;
    else root.ChessBot = ChessBot;
})(typeof window !== 'undefined' ? window : this);
