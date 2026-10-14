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
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    const errors = [...host.errors, ...guest.errors].filter((e) => !/8094|ERR_CONNECTION_REFUSED/.test(e));
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    await b.close();
    console.log('room: ' + room);
    process.exitCode = r.report() ? 1 : 0;
})();
