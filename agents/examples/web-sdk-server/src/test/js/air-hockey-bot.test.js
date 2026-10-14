/**
 * Air Hockey's bot (apps/mini-games/air-hockey/air-hockey-bot.js).
 *
 * The promises: a bot defends its goal when the puck is away; on its own half
 * it gets behind the puck and then hits it towards the OTHER goal, never home;
 * it is never faster than its speed; and both teams behave as mirror images.
 */
const assert = require('assert');
const path = require('path');

const STATIC = path.join(__dirname, '..', '..', 'main', 'resources', 'static');
const Bot = require(path.join(STATIC, 'apps', 'mini-games', 'air-hockey', 'air-hockey-bot.js'));
const SIZE = { width: 1000, height: 600 };
const REACH = 15 + 30;   // PUCK_RADIUS + PADDLE_RADIUS in the game's GAME_CONFIG

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

/** Run a bot at a still puck until it touches it; where was it when it did? */
function chase(team, paddle, puck) {
    let p = { ...paddle };
    for (let i = 0; i < 400; i++) {
        p = Bot.step(team, p, puck, SIZE, 1);
        if (Math.hypot(p.x - puck.x, p.y - puck.y) <= REACH) return { p, frames: i };
    }
    return null;
}

console.log('air hockey bot');

check('with the puck on the far half it defends, in front of its own goal', () => {
    const t = Bot.target('left', { x: 300, y: 300 }, { x: 800, y: 100 }, SIZE);
    assert.strictEqual(t.mode, 'defend');
    assert.ok(t.x < 200, 'defends near its goal, x ' + t.x);
    assert.ok(t.y < 300, 'and follows the puck up, y ' + t.y);
});

check('in front of the puck on its half, it goes round it, aiming clear of it', () => {
    const t = Bot.target('left', { x: 400, y: 300 }, { x: 250, y: 300 }, SIZE);
    assert.strictEqual(t.mode, 'line-up');
    assert.ok(Math.hypot(t.x - 250, t.y - 300) > REACH, 'its target clears the puck: ' + JSON.stringify(t));
});

check('going round, it never touches the puck from the front, from far or close', () => {
    // Close in front is the case a straight line gets wrong: from 300 it would
    // clip the puck at 250 on its way to the far side.
    for (const start of [{ x: 420, y: 300 }, { x: 300, y: 300 }, { x: 310, y: 330 }]) {
        let p = { ...start };
        const puck = { x: 250, y: 300 };
        for (let i = 0; i < 400; i++) {
            p = Bot.step('left', p, puck, SIZE, 1);
            if (Math.hypot(p.x - puck.x, p.y - puck.y) <= REACH) {
                assert.ok(p.x < puck.x, 'from ' + JSON.stringify(start) + ' it touched the puck from in front, at x ' + p.x.toFixed(1));
                break;
            }
        }
    }
});

check('behind the puck, it strikes through it towards the other goal', () => {
    const t = Bot.target('left', { x: 150, y: 300 }, { x: 300, y: 320 }, SIZE);
    assert.strictEqual(t.mode, 'strike');
    assert.ok(t.x > 300, 'aims past the puck, forwards, x ' + t.x);
});

check('it reaches a still puck from behind, so the hit goes forwards (left team)', () => {
    const hit = chase('left', { x: 420, y: 300, vx: 0, vy: 0 }, { x: 250, y: 300 });
    assert.ok(hit, 'reached the puck');
    assert.ok(hit.p.x < 250, 'arrived from its own goal side, x ' + hit.p.x.toFixed(1));
    assert.ok(hit.p.vx > 0, 'moving forwards at the touch, vx ' + hit.p.vx.toFixed(2));
});

check('and the right team is its mirror image', () => {
    const hit = chase('right', { x: 580, y: 300, vx: 0, vy: 0 }, { x: 750, y: 300 });
    assert.ok(hit && hit.p.x > 750 && hit.p.vx < 0, JSON.stringify(hit && hit.p));
    assert.strictEqual(Bot.target('right', { x: 700, y: 300 }, { x: 200, y: 300 }, SIZE).mode, 'defend');
});

check('it is never faster than its speed', () => {
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
        const paddle = { x: Math.random() * 1000, y: Math.random() * 600 };
        const puck = { x: Math.random() * 1000, y: Math.random() * 600 };
        const n = Bot.step(i % 2 ? 'left' : 'right', paddle, puck, SIZE, 1);
        worst = Math.max(worst, Math.hypot(n.x - paddle.x, n.y - paddle.y));
    }
    assert.ok(worst <= Bot.SPEED + 1e-9, 'moved ' + worst.toFixed(3) + ' in one frame');
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
