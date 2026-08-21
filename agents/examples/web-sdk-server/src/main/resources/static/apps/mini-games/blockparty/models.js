/**
 * BlockParty — target model library
 *
 * Models are authored as horizontal layers of text, bottom layer first:
 *   layers[y][z][x]  →  one character per cell
 *
 * A character is a palette letter (see COLORS); '.' and ' ' are empty. A model
 * may declare `chars` to add its own symbols, which is how a cell gets a shape
 * other than a cube — e.g. { 'T': { c: 3, s: 4 } } is a green cone.
 *
 * Colour/shape values are indexes into the PALETTE and SHAPES arrays in
 * blockparty.js, so they must stay in step with them.
 *
 * `difficulty` (1 easy … 3 hard) drives the per-round ramp: early rounds pull
 * from the small models, later rounds from the big ones.
 *
 * Every model's `name` is also its answer word in the guessing modes, so keep
 * names to a single guessable noun.
 */
(function () {
    'use strict';

    // palette letter -> PALETTE index
    const COLORS = {
        r: 0,  // red
        o: 1,  // orange
        y: 2,  // yellow
        g: 3,  // green
        c: 4,  // cyan
        b: 5,  // blue
        v: 6,  // violet
        m: 7,  // magenta / pink
        w: 8,  // white
        s: 9,  // slate
        n: 10, // brown
        k: 11  // near-black
    };

    const MODELS = [
        {
            id: 'flower', name: 'Flower', emoji: '🌸', difficulty: 1,
            layers: [
                [".....", ".....", "..g..", ".....", "....."],
                [".....", ".....", ".gg..", ".....", "....."],
                [".....", ".....", "..g..", ".....", "....."],
                [".....", "..m..", ".mym.", "..m..", "....."]
            ]
        },
        {
            id: 'sword', name: 'Sword', emoji: '🗡️', difficulty: 1,
            chars: { 'S': { c: 9, s: 4 } },   // slate cone — the point
            layers: [
                [".n."], [".n."], ["yyy"], [".s."], [".s."],
                [".s."], [".s."], [".s."], [".S."]
            ]
        },
        {
            id: 'cactus', name: 'Cactus', emoji: '🌵', difficulty: 1,
            layers: [
                [".....", ".....", "..g..", ".....", "....."],
                [".....", ".....", "..g..", ".....", "....."],
                [".....", ".....", "..g..", ".....", "....."],
                [".....", ".....", ".ggg.", ".....", "....."],
                [".....", ".....", ".ggg.", ".....", "....."],
                [".....", ".....", "..g..", ".....", "....."]
            ]
        },
        {
            id: 'duck', name: 'Duck', emoji: '🦆', difficulty: 1,
            layers: [
                [".....", ".yyy.", ".yyy.", ".yyy.", "....."],
                [".....", ".yyy.", ".yyy.", ".yyy.", "....."],
                ["..o..", "..y..", ".....", ".....", "....."],
                [".....", "..y..", ".....", ".....", "....."]
            ]
        },
        {
            id: 'star', name: 'Star', emoji: '⭐', difficulty: 1,
            layers: [
                [".y...y."], ["..y.y.."], ["..yyy.."], [".yyyyy."],
                ["yyyyyyy"], ["..yyy.."], ["...y..."]
            ]
        },
        {
            id: 'fish', name: 'Fish', emoji: '🐟', difficulty: 1,
            layers: [
                ["..ccc.."], [".ccccc."], ["cccccoo"], [".kcccc."], ["..ccc.."]
            ]
        },
        {
            id: 'snowman', name: 'Snowman', emoji: '⛄', difficulty: 1,
            layers: [
                [".....", ".www.", ".www.", ".www.", "....."],
                [".....", ".www.", ".www.", ".www.", "....."],
                [".....", "..w..", ".www.", "..w..", "....."],
                [".....", ".....", "..w..", ".....", "....."],
                [".....", ".....", ".kkk.", ".....", "....."]
            ]
        },
        {
            id: 'heart', name: 'Heart', emoji: '❤️', difficulty: 1,
            layers: [
                ["...m..."], ["..mmm.."], [".mmmmm."],
                ["mmmmmmm"], ["mmmmmmm"], [".mm.mm."]
            ]
        },
        {
            id: 'mushroom', name: 'Mushroom', emoji: '🍄', difficulty: 1,
            layers: [
                [".....", ".....", "..w..", ".....", "....."],
                [".....", ".....", "..w..", ".....", "....."],
                [".rrr.", "rrrrr", "rrwrr", "rrrrr", ".rrr."],
                [".....", ".rrr.", ".rwr.", ".rrr.", "....."]
            ]
        },
        {
            id: 'tree', name: 'Tree', emoji: '🌳', difficulty: 1,
            layers: [
                [".....", ".....", "..n..", ".....", "....."],
                [".....", ".....", "..n..", ".....", "....."],
                [".ggg.", "ggggg", "ggggg", "ggggg", ".ggg."],
                [".....", ".ggg.", ".ggg.", ".ggg.", "....."],
                [".....", ".....", "..g..", ".....", "....."]
            ]
        },
        {
            id: 'pyramid', name: 'Pyramid', emoji: '🏜️', difficulty: 1,
            layers: [
                ["ooooo", "ooooo", "ooooo", "ooooo", "ooooo"],
                [".....", ".ooo.", ".ooo.", ".ooo.", "....."],
                [".....", ".....", "..o..", ".....", "....."]
            ]
        },
        {
            id: 'car', name: 'Car', emoji: '🚗', difficulty: 2,
            layers: [
                ["k.....k", ".......", "k.....k"],
                ["rrrrrrr", "rrrrrrr", "rrrrrrr"],
                ["..ccc..", "..ccc..", "..ccc.."]
            ]
        },
        {
            id: 'arch', name: 'Arch', emoji: '🌉', difficulty: 2,
            layers: [
                ["s.....s", "s.....s", "s.....s"],
                ["s.....s", "s.....s", "s.....s"],
                ["s.....s", "s.....s", "s.....s"],
                ["sssssss", "sssssss", "sssssss"]
            ]
        },
        {
            id: 'boat', name: 'Boat', emoji: '⛵', difficulty: 2,
            layers: [
                [".nnnnn.", "nnnnnnn", ".nnnnn."],
                ["n.....n", "n.....n", "n.....n"],
                [".......", "...n...", "......."],
                [".......", "...nww.", "......."],
                [".......", "...nww.", "......."],
                [".......", "...n...", "......."]
            ]
        },
        {
            id: 'penguin', name: 'Penguin', emoji: '🐧', difficulty: 2,
            layers: [
                [".....", ".o.o.", ".....", ".....", "....."],
                [".....", ".www.", ".kkk.", ".kkk.", "....."],
                [".....", ".www.", ".kkk.", ".kkk.", "....."],
                [".....", ".www.", ".kkk.", ".kkk.", "....."],
                [".....", ".kkk.", ".kkk.", ".kkk.", "....."],
                [".....", "..o..", ".....", ".....", "....."]
            ]
        },
        {
            id: 'crown', name: 'Crown', emoji: '👑', difficulty: 2,
            layers: [
                ["yyyyy", "y...y", "y...y", "y...y", "yyyyy"],
                ["yyyyy", "y...y", "y...y", "y...y", "yyyyy"],
                ["r.r.r", ".....", "r...r", ".....", "r.r.r"]
            ]
        },
        {
            id: 'robot', name: 'Robot', emoji: '🤖', difficulty: 2,
            layers: [
                [".....", ".s.s.", "....."],
                [".....", ".s.s.", "....."],
                [".sss.", ".sss.", ".sss."],
                ["sssss", ".sss.", "sssss"],
                [".sss.", ".sss.", ".sss."],
                [".....", "..s..", "....."],
                [".ccc.", ".ccc.", ".ccc."]
            ]
        },
        {
            id: 'rocket', name: 'Rocket', emoji: '🚀', difficulty: 2,
            chars: { 'R': { c: 0, s: 4 } },   // red cone — the nose
            layers: [
                [".....", ".www.", "rwwwr", ".www.", "....."],
                [".....", ".www.", ".www.", ".www.", "....."],
                [".....", ".www.", ".www.", ".www.", "....."],
                [".....", ".www.", ".www.", ".www.", "....."],
                [".....", ".rrr.", ".rrr.", ".rrr.", "....."],
                [".....", ".....", "..R..", ".....", "....."]
            ]
        },
        {
            id: 'tower', name: 'Tower', emoji: '🏰', difficulty: 3,
            layers: [
                ["sssss", "s...s", "s...s", "s...s", "sssss"],
                ["sssss", "s...s", "s...s", "s...s", "sssss"],
                ["sssss", "s...s", "s...s", "s...s", "sssss"],
                ["s.s.s", ".....", "s...s", ".....", "s.s.s"]
            ]
        },
        {
            id: 'lighthouse', name: 'Lighthouse', emoji: '🗼', difficulty: 3,
            chars: { 'C': { c: 0, s: 4 } },
            layers: [
                ["sssss", "s...s", "s...s", "s...s", "sssss"],
                [".....", ".www.", ".www.", ".www.", "....."],
                [".....", ".rrr.", ".rrr.", ".rrr.", "....."],
                ["sssss", "s...s", "s...s", "s...s", "sssss"],
                [".....", ".yyy.", ".yyy.", ".yyy.", "....."],
                [".....", ".....", "..C..", ".....", "....."]
            ]
        },
        {
            id: 'house', name: 'House', emoji: '🏠', difficulty: 3,
            layers: [
                ["wwwww", "w...w", "w...w", "w...w", "wwwww"],
                ["wwwww", "w...w", "w...w", "w...w", "ww.ww"],
                ["rrrrr", "rrrrr", "rrrrr", "rrrrr", "rrrrr"],
                [".....", ".rrr.", ".rrr.", ".rrr.", "....."],
                [".....", ".....", "..r..", ".....", "....."]
            ]
        }
    ];

    /**
     * Words for the guessing modes. Everything here has to be buildable out of
     * a few dozen cubes in a minute or two and recognisable from across the
     * room — concrete objects with a strong silhouette, no abstractions.
     */
    const WORDS = [
        'tree', 'house', 'cat', 'dog', 'fish', 'boat', 'car', 'rocket', 'star', 'heart',
        'sword', 'crown', 'robot', 'snowman', 'cactus', 'mushroom', 'flower', 'pyramid',
        'bridge', 'tower', 'castle', 'ladder', 'table', 'chair', 'bed', 'door', 'clock',
        'key', 'hammer', 'guitar', 'piano', 'drum', 'camera', 'phone', 'book', 'pencil',
        'cup', 'bottle', 'cake', 'pizza', 'burger', 'ice cream', 'apple', 'banana',
        'carrot', 'egg', 'bone', 'bird', 'snake', 'turtle', 'butterfly', 'spider',
        'crab', 'whale', 'penguin', 'rabbit', 'elephant', 'giraffe', 'lighthouse',
        'windmill', 'tent', 'campfire', 'mountain', 'volcano', 'cloud', 'rainbow',
        'sun', 'moon', 'planet', 'ufo', 'ghost', 'skull', 'arrow', 'trophy', 'medal',
        'gift', 'balloon', 'kite', 'umbrella', 'hat', 'shoe', 'glasses', 'ring',
        'dice', 'flag', 'bench', 'fence', 'well', 'mailbox', 'traffic light', 'train',
        'plane', 'helicopter', 'submarine', 'anchor', 'telescope', 'staircase', 'arch'
    ];

    /**
     * Prompts for Block Rush, where there is no blueprint and the room votes.
     * They are open enough that two players will build different things, and
     * concrete enough that you know what to do in the first five seconds.
     */
    const PROMPTS = [
        'a cosy little house', 'something that flies', 'your favourite animal',
        'a monument to snacks', 'the tallest thing you can', 'a robot friend',
        'something under the sea', 'a vehicle of any kind', 'a throne fit for a king',
        'a tree in autumn', 'something spooky', 'a bridge to nowhere',
        'your dream bedroom', 'a spaceship', 'a castle gate', 'a giant insect',
        'something you would eat', 'a lighthouse in a storm', 'a garden',
        'the letter of your name', 'a dinosaur', 'a snowy mountain',
        'a market stall', 'something with wheels', 'a tiny island'
    ];

    function pickPrompt(exclude, rand) {
        const used = new Set(exclude || []);
        const r = rand || Math.random;
        const pool = PROMPTS.filter(p => !used.has(p));
        const from = pool.length ? pool : PROMPTS;
        return from[Math.floor(r() * from.length)];
    }

    function pickWord(exclude, rand) {
        const used = new Set(exclude || []);
        const r = rand || Math.random;
        const pool = WORDS.filter(w => !used.has(w));
        const from = pool.length ? pool : WORDS;
        return from[Math.floor(r() * from.length)];
    }

    // ---- decoding -------------------------------------------------------

    function cellFor(ch, chars) {
        if (chars && chars[ch]) {
            const o = chars[ch];
            return { c: o.c | 0, s: o.s | 0 };
        }
        const c = COLORS[ch];
        if (c === undefined) return null;
        return { c, s: 0 };
    }

    // [{ x, y, z, c, s }] in model-local coordinates. Cached on the model.
    function decode(model) {
        if (!model) return [];
        if (model._cells) return model._cells;
        const cells = [];
        (model.layers || []).forEach((layer, y) => {
            (layer || []).forEach((row, z) => {
                for (let x = 0; x < row.length; x++) {
                    const cell = cellFor(row[x], model.chars);
                    if (cell) cells.push({ x, y, z, c: cell.c, s: cell.s });
                }
            });
        });
        model._cells = cells;
        return cells;
    }

    // { w, d, h } — footprint on X/Z and height on Y.
    function size(model) {
        if (!model) return { w: 0, d: 0, h: 0 };
        if (model._size) return model._size;
        let w = 0, d = 0;
        const layers = model.layers || [];
        layers.forEach(layer => {
            d = Math.max(d, (layer || []).length);
            (layer || []).forEach(row => { w = Math.max(w, row.length); });
        });
        model._size = { w, d, h: layers.length };
        return model._size;
    }

    function count(model) { return decode(model).length; }

    /**
     * Blueprints the room made, alongside the twenty that ship.
     *
     * A room model carries its cells directly rather than the layer strings the
     * built-in ones are written as — it came from a world, not from someone
     * typing a picture — so `decode` and `size` find them already cached and
     * never look at `layers`. Everything downstream treats it as a model like
     * any other.
     */
    const ROOM = [];

    function register(model) {
        if (!model || !model.id) return null;
        const cells = model.cells || model._cells || [];
        const entry = {
            id: model.id,
            name: model.name || 'Untitled',
            emoji: model.emoji || '🏗️',
            difficulty: 0,              // a room's own build has no ramp
            room: true,
            author: model.author || null,
            _cells: cells,
            _size: model.size || model._size || measure(cells)
        };
        const at = ROOM.findIndex(x => x.id === entry.id);
        if (at >= 0) ROOM[at] = entry; else ROOM.push(entry);
        return entry;
    }

    function forget(id) {
        const at = ROOM.findIndex(x => x.id === id);
        if (at >= 0) ROOM.splice(at, 1);
    }

    function roomModels() { return ROOM.slice(); }

    /** The box a set of cells occupies, for models that never had layers. */
    function measure(cells) {
        let w = 0, d = 0, h = 0;
        (cells || []).forEach(c => {
            if (c.x + 1 > w) w = c.x + 1;
            if (c.z + 1 > d) d = c.z + 1;
            if (c.y + 1 > h) h = c.y + 1;
        });
        return { w, d, h };
    }

    function byId(id) {
        return MODELS.find(m => m.id === id) || ROOM.find(m => m.id === id) || null;
    }

    /**
     * One of the room's own blueprints, avoiding the ones already used.
     * Difficulty does not apply: a build somebody made is as hard as it is.
     */
    function pickRoom(exclude, rand) {
        const pool = ROOM.filter(m => (exclude || []).indexOf(m.id) === -1);
        const from = pool.length ? pool : ROOM;
        if (!from.length) return null;
        const r = typeof rand === 'function' ? rand() : Math.random();
        return from[Math.floor(r * from.length) % from.length];
    }

    /**
     * Pick a model of roughly the wanted difficulty, avoiding `exclude` ids.
     * Falls back to neighbouring difficulties, then to anything unused, so a
     * long match never runs out of material.
     *
     * `rand` is injected so the host can pick and every client just replays the
     * id — nothing here depends on shared randomness.
     */
    function pick(difficulty, exclude, rand) {
        const used = new Set(exclude || []);
        const r = rand || Math.random;
        const tiers = [difficulty, difficulty + 1, difficulty - 1, difficulty + 2, difficulty - 2];
        for (const t of tiers) {
            const pool = MODELS.filter(m => m.difficulty === t && !used.has(m.id));
            if (pool.length) return pool[Math.floor(r() * pool.length)];
        }
        const rest = MODELS.filter(m => !used.has(m.id));
        const pool = rest.length ? rest : MODELS;
        return pool[Math.floor(r() * pool.length)];
    }

    // Difficulty for round n of a match: ramps 1 → 2 → 3 and then stays there.
    function difficultyForRound(round, rounds) {
        if (rounds <= 1) return 2;
        const t = (round - 1) / Math.max(1, rounds - 1);
        return t < 0.34 ? 1 : (t < 0.67 ? 2 : 3);
    }

    window.BlockPartyModels = {
        COLORS, MODELS, WORDS, PROMPTS,
        decode, size, count, byId, pick, pickWord, pickPrompt, difficultyForRound,
        register, forget, roomModels, pickRoom
    };
})();
