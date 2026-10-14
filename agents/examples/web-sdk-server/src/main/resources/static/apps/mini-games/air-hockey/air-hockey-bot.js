/**
 * Air Hockey's bot: where a computer-driven paddle should go next.
 *
 * Pure functions of the puck and the paddle, so they can be tested without a
 * page (src/test/js/air-hockey-bot.test.js). The game's host calls step() for
 * each bot every frame, then keeps the paddle in its half with the same
 * constraint a person's paddle has. A bot is beatable on purpose: it is slower
 * than a hand, and it only attacks a puck on its own side.
 *
 *   defend: puck on the far half    -> sit in front of its goal, following the puck's height;
 *   line up: puck on its half, bot in front of it -> get round to the puck's goal side;
 *   strike: puck on its half, bot behind it      -> drive through the puck at the other goal.
 */
(function (root) {
    'use strict';

    const SPEED = 6.5;          // px per 60 Hz frame: a person's paddle is quicker
    const HOME = 0.12;          // where it defends, as a share of the width from its goal
    const LINE_UP_GAP = 70;     // how far behind the puck it gets before striking
    const STRIKE_CONE = 0.4;    // strike only when ahead-distance > 0.4 x sideways distance
    const CLEARANCE = 75;       // passing distance from the puck's centre: radii 15 + 30, and room to spare

    /** +1 if this team attacks towards the right-hand goal, -1 if to the left. */
    const forwardOf = (team) => (team === 'left' ? 1 : -1);

    function onMySide(team, puckX, width) {
        return team === 'left' ? puckX < width / 2 : puckX > width / 2;
    }

    /** The point the paddle is heading for, and which of the three it is doing. */
    function target(team, paddle, puck, size) {
        const fwd = forwardOf(team);
        const homeX = team === 'left' ? size.width * HOME : size.width * (1 - HOME);
        if (!onMySide(team, puck.x, size.width)) {
            return { x: homeX, y: size.height / 2 + (puck.y - size.height / 2) * 0.6, mode: 'defend' };
        }
        // Strike from behind (between its own goal and the puck) on a mostly
        // forward line. A rule on distance alone flipped between striking and
        // lining up on the way round, forever (the unit test's chase found it):
        // the angle stays true all the way in to contact.
        const ahead = (puck.x - paddle.x) * fwd;
        if (ahead > 8 && ahead > Math.abs(puck.y - paddle.y) * STRIKE_CONE) {
            // Straight through the puck's centre along the line it is on: moving
            // along that line keeps the angle, so the strike holds until contact.
            const d = Math.hypot(puck.x - paddle.x, puck.y - paddle.y) || 1;
            return { x: puck.x + (puck.x - paddle.x) / d * 20, y: puck.y + (puck.y - paddle.y) / d * 20, mode: 'strike' };
        }
        return lineUp(fwd, paddle, puck, size);
    }

    /*
     * Go round the puck without touching it: a straight line to its far side
     * runs through it and knocks it towards the bot's own goal (the unit test
     * caught exactly that). Step aside first if the puck is in the way, on the
     * side with room, then pass it at that height.
     */
    function lineUp(fwd, paddle, puck, size) {
        let side = paddle.y < puck.y ? -1 : 1;
        if (puck.y + side * CLEARANCE < 0 || puck.y + side * CLEARANCE > size.height) side = -side;
        const aside = puck.y + side * CLEARANCE;
        if (Math.abs(paddle.y - puck.y) < CLEARANCE - 4) return { x: paddle.x, y: aside, mode: 'line-up' };
        return { x: puck.x - fwd * LINE_UP_GAP, y: aside, mode: 'line-up' };
    }

    /** One frame's move towards the target, no faster than SPEED. dt is in 60 Hz frames. */
    function step(team, paddle, puck, size, dt) {
        const goal = target(team, paddle, puck, size);
        const dx = goal.x - paddle.x, dy = goal.y - paddle.y;
        const dist = Math.hypot(dx, dy);
        const reach = SPEED * (dt || 1);
        const k = dist > reach ? reach / dist : 1;
        const mx = dx * k, my = dy * k;
        return { x: paddle.x + mx, y: paddle.y + my, vx: mx / (dt || 1), vy: my / (dt || 1), mode: goal.mode };
    }

    const AirHockeyBot = { step, target, SPEED };
    if (typeof module !== 'undefined' && module.exports) module.exports = AirHockeyBot;
    else root.AirHockeyBot = AirHockeyBot;
})(typeof window !== 'undefined' ? window : globalThis);
