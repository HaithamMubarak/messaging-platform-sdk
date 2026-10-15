/**
 * The chat companion's replies (apps/chat-bot.js).
 *
 * The promises: it answers its commands, and a die stays inside its sides
 * (2 to 1000, 6 by default); it greets by name; it answers a question; it
 * reacts, rather than talking, to anything else, with an emoji that fits;
 * and it never answers itself, so two companions cannot talk forever.
 */
const assert = require('assert');
const path = require('path');

const Bot = require(path.join(__dirname, '..', '..', 'main', 'resources', 'static', 'apps', 'chat-bot.js'));

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}
const fixed = (v) => () => v;

console.log('chat bot');

check('a die stays inside its sides, and defaults to six', () => {
    for (const [arg, sides] of [['', 6], ['20', 20], ['1', 2], ['99999', 1000], ['abc', 6]]) {
        for (const r of [0, 0.5, 0.999999]) {
            const n = Number(Bot.reply('/roll ' + arg, 'Ann', { rng: fixed(r) }).text.match(/rolled (\d+)/)[1]);
            assert.ok(n >= 1 && n <= sides, `/roll ${arg} gave ${n} of ${sides}`);
        }
    }
});

check('flip, time and help answer, and an unknown command says so', () => {
    assert.match(Bot.reply('/flip', 'Ann', { rng: fixed(0.1) }).text, /Heads/);
    assert.match(Bot.reply('/flip', 'Ann', { rng: fixed(0.9) }).text, /Tails/);
    assert.match(Bot.reply('/time', 'Ann', { now: Date.UTC(2026, 9, 15, 12, 0) }).text, /It is .+ here/);
    assert.match(Bot.reply('/HELP', 'Ann').text, /second connection/);
    assert.match(Bot.reply('/dance', 'Ann').text, /do not know \/dance/);
});

check('it greets you by name', () => {
    assert.match(Bot.reply('hello there', 'Ann').text, /^Hi Ann!/);
    assert.match(Bot.reply('Good morning', 'Bo').text, /^Hi Bo!/);
});

check('a question gets an answer', () => {
    assert.match(Bot.reply('will it work?', 'Ann', { rng: fixed(0) }).text, /^🎱 /);
});

check('anything else gets a fitting reaction, not a reply', () => {
    assert.deepStrictEqual(Bot.reply('thanks a lot', 'Ann'), { react: '❤️' });
    assert.deepStrictEqual(Bot.reply('haha that was good', 'Ann'), { react: '😂' });
    assert.deepStrictEqual(Bot.reply('we shipped it', 'Ann'), { react: '🎉' });
    assert.deepStrictEqual(Bot.reply('the build is green', 'Ann'), { react: '👍' });
    assert.deepStrictEqual(Bot.reply('history', 'Ann'), { react: '👍' }, '"hi" inside a word is not a greeting');
});

check('it never answers itself, or nothing', () => {
    assert.strictEqual(Bot.reply('hello?', Bot.NAME), null);
    assert.strictEqual(Bot.reply('hello?', Bot.NAME + '-x7q'), null, 'nor another companion');
    assert.strictEqual(Bot.reply('   ', 'Ann'), null);
});

if (failed) { console.log(failed + ' failed'); process.exitCode = 1; } else console.log('all passed');
