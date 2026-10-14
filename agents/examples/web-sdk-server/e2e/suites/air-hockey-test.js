/**
 * Air Hockey: who scored, and what the match was like.
 *
 * A goal used to be credited to the first player found on the scoring team,
 * whoever hit it. The host now keeps the last paddle to touch the puck, so a
 * goal names its shooter, an own goal is called one, and the win screen can
 * hand out awards. This suite asks that of two real players in one room:
 *
 *   - the physics records a real paddle touch (the puck is sent into a paddle);
 *   - a goal names its shooter on BOTH screens, with how it went in;
 *   - an own goal is called an own goal;
 *   - the match ends on a win screen with the final score and the awards;
 *   - sound is off until somebody presses Sound.
 *
 * Goals are set up on the host by placing the puck, because a test cannot aim;
 * the touch that decides the shooter is the physics' own, not a test's.
 */
const { LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { joinOne, sleep, waitFor } = require('../lib/party-room');

const GAME = 'airHockeyGame';
const r = results();

/** Send the puck at a player's paddle and let the host's physics decide whether it touched. */
async function touchBy(host, who) {
    await host.evaluate((name) => {
        const g = window.airHockeyGame, p = g.players.get(name).paddle;
        g.resetRally();
        g.puck.x = p.x + (p.x < 500 ? 70 : -70);
        g.puck.y = p.y;
        g.puck.vx = p.x < 500 ? -14 : 14;
        g.puck.vy = 0;
    }, who);
    await waitFor(() => host.evaluate((name) => window.airHockeyGame.touch.last === name, who), 4000, who + ' touching the puck');
}

/** Put the puck into the goal of `side` ('left' or 'right'); the touch already recorded is the shooter. */
async function scoreInto(host, side) {
    await host.evaluate((s) => {
        const g = window.airHockeyGame;
        g.puck.x = s === 'left' ? -40 : 1040;
        g.puck.y = 300;
        g.puck.vx = s === 'left' ? -20 : 20;
        g.puck.vy = 0;
    }, side);
}

const overlay = (page) => page.evaluate(() => ({
    text: document.querySelector('#goalOverlay .goal-text').textContent,
    sub: document.getElementById('goalScorer').textContent,
    shown: !document.getElementById('goalOverlay').classList.contains('hidden') }));

async function play(host, guest, names) {
    const teams = await host.evaluate(() => Object.fromEntries([...window.airHockeyGame.players].map(([n, p]) => [n, p.team])));
    const [h, g] = names;
    const into = (team) => (team === 'left' ? 'right' : 'left');   // the other team's net

    await touchBy(host, h);
    r.check(await host.evaluate((n) => window.airHockeyGame.touch.last === n, h), `the physics records ${h}'s paddle touching the puck`);
    await scoreInto(host, into(teams[h]));
    await waitFor(async () => (await overlay(guest)).shown, 4000, 'the goal overlay');
    const goal = await overlay(guest);
    r.check(goal.text === 'GOAL!' && goal.sub.includes(h), `the guest's screen names the shooter (${goal.text} / ${goal.sub})`);
    await sleep(2200);

    // Into the guest's OWN net: the point goes to the host's team (2-0).
    await touchBy(host, g);
    await scoreInto(host, teams[g]);
    await waitFor(async () => (await overlay(host)).shown, 4000, 'the own-goal overlay');
    const own = await overlay(host);
    r.check(own.text === 'OWN GOAL!' && own.sub.includes(g), `an own goal is called one (${own.text} / ${own.sub})`);
    await sleep(2200);

    // The third goal wins it (first to 3, the smallest the game offers).
    await touchBy(host, h);
    await scoreInto(host, into(teams[h]));
    await waitFor(() => guest.evaluate(() => !document.getElementById('winScreen').classList.contains('hidden')), 6000, 'the win screen');
    const win = await guest.evaluate(() => ({
        title: document.getElementById('winTitle').textContent,
        score: document.getElementById('winFinalScore').textContent,
        awards: [...document.querySelectorAll('#winAwards li')].map((li) => li.textContent) }));
    r.check(/wins/.test(win.title) && /3 – 0|0 – 3/.test(win.score), `the win screen shows the winner and the score (${win.title}, ${win.score})`);
    r.check(win.awards.some((a) => a.startsWith('Top scorer') && a.includes(h + ', 2 goals')) && win.awards.some((a) => a.startsWith('Own goal')),
        `and the awards: top scorer and own goal (${JSON.stringify(win.awards)})`);
}

/** One person and a bot: the bot is added with the host's button and plays the puck. */
async function solo(b, room) {
    const me = await joinOne(b, '/apps/mini-games/air-hockey/index.html', GAME, room, 'Solo', 'e2e-solo-pass');
    await sleep(3000);
    const p = me.page;
    r.check(await p.isVisible('#addBotBtn'), 'the host is offered "Add a bot"');
    await p.click('#addBotBtn');
    await sleep(500);
    r.check(/Bot Barry \(bot\)/.test(await p.evaluate(() => document.getElementById('playersList').innerText)),
        'the bot joins the player list as a bot');
    await p.evaluate(() => window.startGame());
    await sleep(1500);
    // A still puck in the middle of the bot's half: it has to go and hit it.
    const side = await p.evaluate(() => {
        const g = window.airHockeyGame, team = g.players.get('Bot Barry').team;
        g.resetRally();
        Object.assign(g.puck, { x: team === 'left' ? 280 : 720, y: 330, vx: 0, vy: 0 });
        return team;
    });
    await waitFor(() => p.evaluate(() => window.airHockeyGame.touch.last === 'Bot Barry'), 8000, 'the bot to hit the puck');
    await sleep(150);
    const after = await p.evaluate(() => ({ last: window.airHockeyGame.touch.last, vx: window.airHockeyGame.puck.vx }));
    r.check(after.last === 'Bot Barry' && (side === 'left' ? after.vx > 0 : after.vx < 0),
        `the bot goes to a still puck on its half and hits it towards the other goal (${JSON.stringify(after)}, ${side})`);
    await me.ctx.close();
}

/** A bot in a room with a guest: the guest sees it, as a bot, where the host moves it. */
async function botForGuest(host, guest) {
    await host.evaluate(() => window.airHockeyGame.addBot());
    await sleep(1500);
    r.check(await guest.evaluate(() => !!(window.airHockeyGame.players.get('Bot Barry') || {}).bot), 'the guest is told about the bot, as a bot');
    await host.evaluate(() => window.startGame());
    await sleep(3000);
    const where = await Promise.all([host, guest].map((pg) => pg.evaluate(() => {
        const p = window.airHockeyGame.players.get('Bot Barry').paddle;
        return { x: Math.round(p.x), y: Math.round(p.y) };
    })));
    r.check(Math.abs(where[0].x - where[1].x) < 25 && Math.abs(where[0].y - where[1].y) < 25,
        `and sees its paddle where the host has it (${JSON.stringify(where)})`);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const room = 'ah' + Math.floor(Date.now() / 1000);
    const pass = 'e2e-pass-' + Math.random().toString(36).slice(2, 8);
    const host = await joinOne(b, '/apps/mini-games/air-hockey/index.html', GAME, room, 'Mara', pass);
    await sleep(2200);
    const guest = await joinOne(b, '/apps/mini-games/air-hockey/index.html', GAME, room, 'Odell', pass);
    await sleep(4000);
    try {
        const sound = await host.page.evaluate(() => ({ on: GameKit.Sfx.enabled, label: document.getElementById('soundBtn').textContent }));
        r.check(!sound.on && sound.label === 'Sound off', `sound starts off (${JSON.stringify(sound)})`);
        await host.page.click('#soundBtn');
        r.check(await host.page.evaluate(() => GameKit.Sfx.enabled && localStorage.getItem('party_sound') === 'on'),
            'and Sound turns it on, remembered for the party games');

        await host.page.evaluate(() => { document.getElementById('winScore').value = '3'; window.startGame(); });
        await sleep(2500);

        // The host is the elected one; a guest claiming a goal is still refused.
        await guest.page.evaluate(() => window.airHockeyGame.sendData({ type: 'goal', scoringTeam: 'right', scores: [['Odell', 9]] }));
        await sleep(1500);
        r.check(await host.page.evaluate(() => window.airHockeyGame.players.get('Odell').score === 0),
            'a goal message from a guest is ignored by the host');
        await play(host.page, guest.page, ['Mara', 'Odell']);
        await sleep(8000);   // the win screen's moment, then the lobby
        await botForGuest(host.page, guest.page);
        await solo(b, room + 's');
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    const errors = [...host.errors, ...guest.errors].filter((e) => !/8094|ERR_CONNECTION_REFUSED/.test(e));
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    await b.close();
    console.log('room: ' + room);
    process.exitCode = r.report() ? 1 : 0;
})();
