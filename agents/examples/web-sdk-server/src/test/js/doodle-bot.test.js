/**
 * The Whiteboard's doodle bot (apps/whiteboard/doodle-bot.js).
 *
 * The promises: every doodle stays inside the box it is drawn into and has
 * something to draw; its pen paths are continuous; a guess counts when it
 * names the doodle as a whole word, in any case or with punctuation, and not
 * when the word is only a part of another; it never picks the same doodle
 * twice running; and every doodle can be guessed by its own name.
 */
const assert = require('assert');
const path = require('path');

const WB = path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'apps', 'whiteboard');
const Bot = require(path.join(WB, 'doodle-bot.js'));

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}
const byName = (n) => Bot.DOODLES.find((d) => d.name === n);

console.log('doodle bot');

check('there are enough doodles to play a while, each with a name and answers', () => {
    assert.ok(Bot.DOODLES.length >= 10, Bot.DOODLES.length + ' doodles');
    for (const d of Bot.DOODLES) assert.ok(d.name && d.answers.length && d.paths.length, d.name);
    assert.strictEqual(new Set(Bot.DOODLES.map((d) => d.name)).size, Bot.DOODLES.length, 'names are unique');
});

check('every doodle stays inside the box it is drawn into', () => {
    const box = { x: 300, y: 200, size: 400 };
    for (const d of Bot.DOODLES) {
        for (const segs of Bot.strokesFor(d, box)) {
            for (const s of segs) {
                for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
                    assert.ok(x >= box.x - 1 && x <= box.x + box.size + 1 && y >= box.y - 1 && y <= box.y + box.size + 1,
                        `${d.name} leaves the box at ${x.toFixed(0)},${y.toFixed(0)}`);
                }
            }
        }
    }
});

check('each pen path is one continuous line, and none is empty', () => {
    for (const d of Bot.DOODLES) {
        for (const segs of Bot.strokesFor(d, { x: 0, y: 0, size: 100 })) {
            assert.ok(segs.length >= 1, d.name + ' has an empty path');
            for (let i = 1; i < segs.length; i++) {
                assert.ok(segs[i].x1 === segs[i - 1].x2 && segs[i].y1 === segs[i - 1].y2, d.name + ' path breaks at ' + i);
            }
        }
    }
});

check('a guess counts in any case, with punctuation, inside a sentence, or plural', () => {
    const cat = byName('cat');
    for (const g of ['cat', 'CAT!', 'is it a cat??', 'kitten', 'cats', 'a Kitty maybe']) assert.ok(Bot.matches(cat, g), g);
    assert.ok(Bot.matches(byName('snowman'), 'a snow man'), 'snow man');
    assert.ok(Bot.matches(byName('smiley face'), 'happy face'), 'happy face');
});

check('a word that only contains the answer does not count', () => {
    const cat = byName('cat');
    for (const g of ['catalogue', 'concatenate', 'dog', '', 'scat']) assert.ok(!Bot.matches(cat, g), g);
    assert.ok(!Bot.matches(byName('sun'), 'sunday'), 'sunday');
});

check('every doodle is guessed by its own name', () => {
    for (const d of Bot.DOODLES) assert.ok(Bot.matches(d, 'I think it is ' + Bot.called(d)), d.name);
});

check('it never picks the doodle it just drew', () => {
    for (const d of Bot.DOODLES) {
        for (let i = 0; i < 20; i++) assert.notStrictEqual(Bot.pick(() => i / 20, d.name).name, d.name);
    }
});

check('the reveal names it with the right article', () => {
    assert.strictEqual(Bot.called(byName('umbrella')), 'an umbrella');
    assert.strictEqual(Bot.called(byName('house')), 'a house');
});

if (failed) { console.log(failed + ' failed'); process.exitCode = 1; } else console.log('all passed');
