/**
 * BlockParty — the pictures Postcard hands out.
 *
 * A postcard is a small picture and nothing else: no model, no ghost, no
 * blueprint to copy cell for cell. You look at it, you decide what it is, and
 * you build that — which is why the reference is deliberately coarse. Sixteen
 * squares across is enough to say "a lighthouse" and nowhere near enough to
 * say how tall, how round, or what the rock underneath looks like.
 *
 * Each row is one line of the picture, one character per square, in the game's
 * own twelve colours — so the reference is drawn from the same box of bricks
 * the room is building with. They travel in the once-a-second match state as
 * these strings, which is small enough that nothing needs chunking and a
 * dropped packet costs a player nothing: the next tick carries it again.
 */
(function () {
    'use strict';

    // Character to palette index. '.' is nothing at all — the picture's
    // background is empty rather than sky-coloured, so what a player sees is
    // the subject's own silhouette.
    const KEY = {
        r: 0, o: 1, y: 2, g: 3, c: 4, b: 5,
        v: 6, p: 7, w: 8, s: 9, n: 10, k: 11
    };

    const PICTURES = [
        {
            id: 'house', name: 'A house',
            rows: [
                '................',
                '................',
                '..........nn....',
                '.......rr.nn....',
                '......rrrrnn....',
                '.....rrrrrrn....',
                '....rrrrrrrr....',
                '...rrrrrrrrrr...',
                '....wwwwwwww....',
                '....wccwwccw....',
                '....wccwwccw....',
                '....wwwnnwww....',
                '....wwwnnwww....',
                '....wwwnnwww....',
                'gggggggggggggggg',
                'gggggggggggggggg'
            ]
        },
        {
            id: 'tree', name: 'A tree',
            rows: [
                '................',
                '................',
                '.....gggggg.....',
                '.....gggggg.....',
                '....gggggggg....',
                '....gggggggg....',
                '...gggggggggg...',
                '...gggggggggg...',
                '...gggggggggg...',
                '....gggggggg....',
                '.......nn.......',
                '.......nn.......',
                '.......nn.......',
                '.......nn.......',
                'gggggggnnggggggg',
                'gggggggggggggggg'
            ]
        },
        {
            id: 'boat', name: 'A sailing boat',
            rows: [
                '................',
                '................',
                '................',
                '........n.......',
                '.......wn.......',
                '......wwnrrrr...',
                '.....wwwnrrrr...',
                '....wwwwnrrrr...',
                '...wwwwwn.......',
                '..wwwwwwn.......',
                '..wwwwwwn.......',
                '...nnnnnnnnnnn..',
                'ccccnnnnnnnnnccc',
                'cccccccccccccccc',
                'cccccccccccccccc',
                'cccccccccccccccc'
            ]
        },
        {
            id: 'rocket', name: 'A rocket',
            rows: [
                '................',
                '.......rr.......',
                '......rrrr......',
                '.....rrrrrr.....',
                '......wwww......',
                '......wwww......',
                '......wccw......',
                '......wccw......',
                '......wwww......',
                '....rrrrrrrr....',
                '....rrwwwwrr....',
                '....rrwwwwrr....',
                '....rrssssrr....',
                '......oooo......',
                '.......yy.......',
                '.......yy.......'
            ]
        },
        {
            id: 'cat', name: 'A cat',
            rows: [
                '................',
                '................',
                '...oo......oo...',
                '...op......po...',
                '...oooooooooo...',
                '....oooooooo....',
                '....oggooggo....',
                '....oggooggo....',
                '....oooppooo.o..',
                '....oooooooo.o..',
                '....oooooooooo..',
                '.....ooooooooo..',
                '.....oooooo.....',
                '.....oooooo.....',
                '.....oooooo.....',
                'ssssssssssssssss'
            ]
        },
        {
            id: 'lighthouse', name: 'A lighthouse',
            rows: [
                '......yyyy......',
                '......yyyy......',
                '.....ssssss.....',
                '......wwww......',
                '......wwww......',
                '......rrrr......',
                '......rrrr......',
                '......wwww......',
                '......wwww......',
                '......rrrr......',
                '......rrrr......',
                '......wwww......',
                '...ssswwwwsss...',
                'cccssssssssssccc',
                'cccssssssssssccc',
                'cccccccccccccccc'
            ]
        },
        {
            id: 'car', name: 'A car',
            rows: [
                '................',
                '................',
                '................',
                '................',
                '................',
                '....bbbbbbb.....',
                '....bccbccb.....',
                '....bccbccb.....',
                '....bbbbbbb.....',
                '..bbbbbbbbbbbb..',
                '..rbbbbbbbbbby..',
                '..bbbbbbbbbbbb..',
                '..bkkkbbbbkkkb..',
                '...kkk....kkk...',
                'ssssssssssssssss',
                'ssssssssssssssss'
            ]
        },
        {
            id: 'flower', name: 'A flower',
            rows: [
                '......pppp......',
                '......pppp......',
                '......pppp......',
                '..ppppyyyypppp..',
                '..ppppyyyypppp..',
                '..ppppyyyypppp..',
                '..ppppyyyypppp..',
                '......pppp......',
                '......pppp......',
                '.......gg.......',
                '...gggggg.......',
                '...gggggggggg...',
                '.......gggggg...',
                '.......gg.......',
                'gggggggggggggggg',
                'gggggggggggggggg'
            ]
        },
        {
            id: 'windmill', name: 'A windmill',
            rows: [
                '...n............',
                '..nnnnn..nnnnn..',
                '..nnnnn..nnnnn..',
                '......n.........',
                '.....rrnrrr.....',
                '.....rrrrrr.....',
                '..nnnnwwwwnnnn..',
                '..nnnnwwwwnnnn..',
                '......wwww......',
                '.....wwwwww.....',
                '.....wwwwww.....',
                '.....wwnnww.....',
                '....wwwnnwww....',
                '....wwwnnwww....',
                'gggggggggggggggg',
                'gggggggggggggggg'
            ]
        },
        {
            id: 'fish', name: 'A fish',
            rows: [
                '................',
                '................',
                '................',
                '......ooo.......',
                '......ooo.......',
                '.....oooooo.rrr.',
                '....oooooooorrr.',
                '....oowooooo.rr.',
                '....ookooooo.rr.',
                '....oooooooo.rr.',
                '....oooooooorrr.',
                '.....oooooo.rrr.',
                '................',
                '................',
                'cccccccccccccccc',
                'cccccccccccccccc'
            ]
        },
        {
            id: 'castle', name: 'A castle',
            rows: [
                '................',
                '................',
                '..r..........r..',
                '.s.s........s.s.',
                '.sss........sss.',
                '.sss........sss.',
                '.sss.s.s.s.ssss.',
                '.ssssssssssssss.',
                '.ssssssssssssss.',
                '.sssskksskkssss.',
                '.sssskknnkkssss.',
                '.ssssssnnssssss.',
                '.ssssssnnssssss.',
                '.ssssssnnssssss.',
                'gssssssnnssssssg',
                'gggggggggggggggg'
            ]
        },
        {
            id: 'mountain', name: 'A mountain',
            rows: [
                '................',
                '................',
                '................',
                '.......ww.......',
                '......wwww......',
                '.....wwwwww.....',
                '....ssssssss....',
                '...ssssssssss...',
                'wwssssssssssss..',
                'wwsssssssssssss.',
                'ssssssssssssssss',
                'ssssssssssssssss',
                'ssssssssssssssss',
                'ssssssssssssssss',
                'ssssssssssssssss',
                'gggggggggggggggg'
            ]
        }
    ];

    /** The colour index at a square, or null where the picture is empty. */
    function colourAt(pic, x, y) {
        const row = pic.rows[y];
        if (!row) return null;
        const ch = row[x];
        return ch && ch !== '.' ? KEY[ch] : null;
    }

    /** How many squares the picture actually uses — its weight, roughly. */
    function size(pic) {
        let n = 0;
        pic.rows.forEach(r => { for (const ch of r) if (ch !== '.') n++; });
        return n;
    }

    /**
     * One the room has not had yet, if there is one left.
     *
     * `used` is a list of ids, so a match of three rounds never repeats and a
     * long one starts round again rather than running out.
     */
    function pick(used) {
        used = used || [];
        let pool = PICTURES.filter(p => used.indexOf(p.id) < 0);
        if (!pool.length) pool = PICTURES;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function byId(id) { return PICTURES.find(p => p.id === id) || null; }

    window.BlockPartyPictures = { PICTURES, KEY, colourAt, size, pick, byId };
})();
