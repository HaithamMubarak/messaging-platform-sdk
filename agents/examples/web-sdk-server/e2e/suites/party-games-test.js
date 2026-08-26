/*
 * Chorus, Autocue, Gavel and Nudge — three real clients through each game,
 * against the real backend.
 *
 *     xvfb-run -a node suites/party-games-test.js
 *
 * All four are built on the same rule: a client message is ADDRESSED to the
 * host, never broadcast, because every one of these games is made of secrets
 * (the slot you were dealt, the line you wrote, the way you voted, the mission
 * in your pocket). So every game here is checked twice — once that it plays,
 * and once that a guest never receives anything belonging to another guest.
 */
const { chromium } = require('playwright');
const { BASE, LAUNCH, results } = require('../lib/harness');

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
    return ok;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if (await fn()) return true; } catch (_) {}
        await sleep(250);
    }
    console.log(`  (timed out waiting for ${label})`);
    return false;
}

const NAMES = ['Mara', 'Odell', 'Priya'];

/** Open three clients into one room and install a wire spy on each. */
async function openRoom(browser, path, globalName, room) {
    const pass = 'party-pass-' + Math.random().toString(36).slice(2, 8);
    const clients = [];
    for (const name of NAMES) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(60000);
        const errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));

        await page.goto(`${BASE}${path}?debug`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#connectionModal.active', { timeout: 30000 });
        await page.fill('#usernameInput', name);
        await page.fill('#channelInput', room);
        await page.fill('#passwordInput', pass);
        await page.click('#connectBtn');

        const ok = await waitFor(async () =>
            !(await page.evaluate(() => document.getElementById('connectionModal')?.classList.contains('active'))),
            45000, `${name} to connect`);

        await page.evaluate(g => {
            const game = window[g];
            if (!game || game.__spied) return;
            game.__spied = true;
            game.__seen = [];
            const orig = game.onDataChannelMessage.bind(game);
            game.onDataChannelMessage = function (peerId, data) {
                try { game.__seen.push({ from: peerId, t: data && data.t }); } catch (_) {}
                return orig(peerId, data);
            };
        }, globalName);

        clients.push({ name, page, ctx, errors, connected: ok, g: globalName });
        await sleep(2200);
    }
    return clients;
}

const val = (c, expr) => c.page.evaluate(new Function('g', `const game = window["${c.g}"]; return (${expr});`), c.g);
const phaseOf = c => val(c, 'game.phase');

async function rosterReady(clients) {
    const ok = await waitFor(async () =>
        (await val(clients[0], 'game.playerCount()')) === 3, 30000, 'a roster of 3');
    for (const c of clients) {
        const n = await val(c, 'game.playerCount()');
        check(n === 3, `${c.name} sees three players`, `${n}`);
    }
    return ok;
}

/** Every guest heard only from the host, and never one of the banned types. */
async function assertPrivacy(clients, banned, label) {
    const hostName = await val(clients[0], 'game.username');
    for (const c of clients.slice(1)) {
        const seen = await val(c, 'game.__seen || []');
        const wrongSender = seen.filter(m => m.from !== hostName);
        const leaked = seen.filter(m => banned.includes(m.t));
        check(wrongSender.length === 0, `${label}: ${c.name} only ever heard from the host`,
            wrongSender.length ? JSON.stringify(wrongSender[0]) : `${seen.length} messages`);
        check(leaked.length === 0, `${label}: ${c.name} never received a private message meant for somebody else`,
            leaked.length ? leaked.map(m => m.t).join(',') : `types: ${[...new Set(seen.map(m => m.t))].join(',')}`);
    }
}

async function consoleClean(clients, label) {
    for (const c of clients) {
        const bad = c.errors.filter(e => !/favicon|404/.test(e));
        check(bad.length === 0, `${label}: ${c.name} had no console errors`, bad.slice(0, 2).join(' | '));
    }
}

async function closeAll(clients) {
    for (const c of clients) { try { await c.ctx.close(); } catch (_) {} }
}

// ===========================================================================
// CHORUS
// ===========================================================================
async function testChorus(browser) {
    console.log('\n=== CHORUS ===');
    const room = 'chorus-e2e-' + Math.random().toString(36).slice(2, 7);
    const clients = await openRoom(browser, '/apps/mini-games/chorus/index.html', 'chorusGame', room);
    try {
        clients.forEach(c => check(c.connected, `Chorus: ${c.name} connected`));
        await rosterReady(clients);

        const host = clients[0];
        await host.page.selectOption('#roundsSelect', '2');
        await host.page.click('#startBtn');

        check(await waitFor(async () => (await phaseOf(host)) === 'choose', 20000, 'the choosing phase'),
            'Chorus: the round starts');

        // Every player owns at least one slot, and no two players share one.
        await sleep(1200);
        const owned = [];
        for (const c of clients) owned.push(await val(c, 'game.mySlots.map(s => s.i)'));
        check(owned.every(o => o.length >= 1), 'Chorus: everybody was dealt a piece',
            owned.map(o => o.length).join('/'));
        const all = owned.flat();
        check(new Set(all).size === all.length, 'Chorus: nobody shares a slot');

        // Each client takes its first option for each slot it owns.
        for (const c of clients) {
            const n = await c.page.evaluate(() => document.querySelectorAll('#mineBody .pk-choice').length);
            for (let i = 0; i < n; i++) {
                await c.page.evaluate(k => {
                    const groups = document.querySelectorAll('#mineBody .ch-mine');
                    const g = groups[k] || document.getElementById('mineBody');
                    const b = g.querySelector('.pk-choice');
                    if (b) b.click();
                }, i);
                await sleep(150);
            }
        }

        check(await waitFor(async () => (await phaseOf(host)) === 'assemble', 40000, 'the assembly'),
            'Chorus: the assembly begins');

        // Mara and Odell tap when their slot is live. Priya never taps — the
        // hole with her name in it is the second half of the game.
        const tappers = clients.slice(0, 2);
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
            const p = await phaseOf(host);
            if (p !== 'assemble') break;
            for (const c of tappers) {
                const mine = await val(c, 'game.mySlots.some(s => s.i === game.liveSlot)');
                if (mine) { await c.page.click('#tapBtn').catch(() => {}); await sleep(120); }
            }
            await sleep(200);
        }

        check(await waitFor(async () => ['reveal', 'over'].includes(await phaseOf(host)), 60000, 'the reveal'),
            'Chorus: the creation is revealed');

        const holes = await val(host, 'game.holes');
        check(holes.length > 0, 'Chorus: a missed slot leaves a hole', `${holes.length} holes`);
        check(holes.some(h => h.who === 'Priya'), 'Chorus: the hole carries the name of whoever left it',
            holes.map(h => h.who).join(','));

        const filled = await val(host, 'game.parts.filter(p => typeof p !== "string" && p.value).length');
        check(filled > 0, 'Chorus: the pieces that were tapped are on the board', `${filled} placed`);

        for (const c of clients) {
            const seen = await val(c, 'game.parts.filter(p => typeof p !== "string" && p.value).length');
            check(seen === filled, `Chorus: ${c.name} sees the same board`, `${seen} vs ${filled}`);
        }

        const scores = await val(host, 'game.scores');
        check(scores.some(s => s.score > 0), 'Chorus: placing scores', JSON.stringify(scores));

        const blame = await val(host, 'game.blame');
        check(blame.some(b => b.name === 'Priya' && b.holes > 0),
            'Chorus: the blame board tallies who left the holes', JSON.stringify(blame));

        check(await waitFor(async () => ['best', 'over'].includes(await phaseOf(host)), 120000, 'the end of the match'),
            'Chorus: the match reaches the vote');

        if ((await phaseOf(host)) === 'best') {
            const gallery = await val(host, 'game.gallery');
            check(gallery.length >= 2, 'Chorus: every creation is kept for the vote', `${gallery.length}`);
            check(gallery.every(g => typeof g.text === 'string' && g.text.length > 0),
                'Chorus: each one reads back as a finished line',
                (gallery[0] && gallery[0].text || '').slice(0, 50));
            check(gallery.some(g => /missed this/.test(g.text)),
                'Chorus: and the holes are still visible in it');

            // Round two gives everybody less time than round one did.
            const cue = await val(host, 'game.cueMs()');
            check(cue < 2400, 'Chorus: the cue speeds up as the match goes on', `${cue}ms by round ${await val(host, 'game.round')}`);

            for (const c of clients) {
                await c.page.evaluate(() => {
                    const b = document.querySelector('#bestList .ch-gallery');
                    if (b) b.click();
                });
                await sleep(300);
            }
            check(await waitFor(async () => (await phaseOf(host)) === 'over', 40000, 'the winner'),
                'Chorus: the room picks a favourite');
            const winner = await val(host, 'game.winner');
            check(winner && winner.votes > 0, 'Chorus: the winning creation is named',
                winner ? `round ${winner.round}, ${winner.votes} votes` : 'none');
        }

        // A guest must never learn another guest's slot or option.
        await assertPrivacy(clients, ['choose', 'tap'], 'Chorus');
        await consoleClean(clients, 'Chorus');
    } catch (e) {
        console.error('CHORUS THREW:', e && e.stack || e);
        check(false, 'Chorus: the suite ran to the end');
    } finally {
        await closeAll(clients);
    }
}

// ===========================================================================
// AUTOCUE
// ===========================================================================
async function testAutocue(browser) {
    console.log('\n=== AUTOCUE ===');
    const room = 'autocue-e2e-' + Math.random().toString(36).slice(2, 7);
    const clients = await openRoom(browser, '/apps/mini-games/autocue/index.html', 'autocueGame', room);
    try {
        clients.forEach(c => check(c.connected, `Autocue: ${c.name} connected`));
        await rosterReady(clients);

        const host = clients[0], speaker = clients[1], writer = clients[2];

        await host.page.selectOption('#formatSelect', 'toast');
        await host.page.selectOption('#targetSelect', '6');
        await host.page.evaluate(() => {
            const s = document.getElementById('speakerSelect');
            s.value = 'Odell';
        });
        await host.page.click('#startBtn');

        check(await waitFor(async () => (await phaseOf(host)) === 'live', 20000, 'the speech to open'),
            'Autocue: the speech opens');
        check(await val(host, 'game.speaker') === 'Odell', 'Autocue: the chosen speaker is on stage',
            await val(host, 'game.speaker'));

        await sleep(1200);
        const speakerRole = await val(speaker, 'game.myRole');
        check(speakerRole === 'speaker', 'Autocue: the speaker knows it', speakerRole);
        const firstLine = await val(speaker, 'game.currentLine');
        check(!!firstLine, 'Autocue: the speaker was given a line privately', (firstLine || '').slice(0, 40));
        const writerLine = await val(writer, 'game.currentLine');
        check(!writerLine, 'Autocue: a writer is never sent the speaker\'s line');

        // Writers submit; the editor approves. Six lines clears the floor.
        for (let i = 0; i < 4; i++) {
            await writer.page.fill('#lineInput', `Line number ${i + 1} from the floor.`);
            await writer.page.click('#sendBtn');
            await sleep(300);
        }
        await host.page.evaluate(() => {
            document.getElementById('lineInput').value = 'And I say that as his oldest friend.';
        });
        await host.page.click('#sendBtn');
        await sleep(900);

        const pendingSeen = await val(host, 'game.pending.length');
        check(pendingSeen >= 4, 'Autocue: the editor sees the queue', `${pendingSeen} waiting`);

        const approved = await host.page.evaluate(() => {
            const btns = [...document.querySelectorAll('#pendingList .ac-ok')];
            btns.forEach(b => b.click());
            return btns.length;
        });
        check(approved >= 4, 'Autocue: the editor approves them', `${approved}`);
        await sleep(900);

        check(await waitFor(async () => await val(host, 'game.unlocked'), 15000, 'the floor of five'),
            'Autocue: Deliver unlocks once the floor is met');

        // A stage direction goes to the speaker and shows on the television —
        // and to nobody else's phone.
        await host.page.evaluate(() => window.autocueGame.hostDirect('Say the next line in a whisper.'));
        await sleep(900);
        check(await val(speaker, 'game.myDirection') === 'Say the next line in a whisper.',
            'Autocue: a stage direction reaches the speaker');
        check(!(await val(writer, 'game.myDirection')),
            'Autocue: and is not pushed to a writer\'s phone');
        check(await val(writer, 'game.direction') === 'Say the next line in a whisper.',
            'Autocue: but the room can see it on the screen');

        // Heckling.
        const heckBefore = await val(host, 'game.heckles');
        await writer.page.click('#heckleBtn');
        await sleep(800);
        check((await val(host, 'game.heckles')) === heckBefore + 1, 'Autocue: the audience can heckle');

        // The rescue — the thing that stops a speaker dying in silence.
        const before = await val(speaker, 'game.currentLine');
        const rescues = await val(host, 'game.rescuesLeft');
        await speaker.page.click('#rescueBtn');
        await sleep(1100);
        check((await val(host, 'game.rescuesLeft')) === rescues - 1, 'Autocue: a rescue is spent');
        check((await val(speaker, 'game.currentLine')) !== before,
            'Autocue: and hands the speaker a line that always works');

        // The speaker works through the speech.
        for (let i = 0; i < 6; i++) {
            const p = await phaseOf(host);
            if (p !== 'live') break;
            await speaker.page.click('#deliverBtn').catch(() => {});
            await sleep(1700);
        }

        const delivered = await val(host, 'game.delivered.length');
        check(delivered >= 3, 'Autocue: lines are delivered', `${delivered}`);

        const attributed = await val(host, 'game.delivered.filter(d => d.author).length');
        check(attributed >= 1, 'Autocue: delivered lines carry their author', `${attributed} attributed`);
        const shown = await val(host, 'game.delivered.filter(d => d.shown).length');
        check(shown >= 1, 'Autocue: the name lands a beat after the line', `${shown} shown`);

        for (const c of clients) {
            const n = await val(c, 'game.delivered.length');
            check(n === delivered, `Autocue: ${c.name} sees the same speech`, `${n} vs ${delivered}`);
        }

        // Line of the night.
        if ((await phaseOf(host)) === 'live') {
            await speaker.page.click('#endBtn').catch(() => {});
            await sleep(900);
        }
        if ((await phaseOf(host)) === 'best') {
            const options = await host.page.evaluate(() =>
                document.querySelectorAll('#bestList .ac-bestline').length);
            check(options >= 3, 'Autocue: the room is offered the delivered lines', `${options}`);
            for (const c of clients) {
                await c.page.evaluate(() => {
                    const b = document.querySelector('#bestList .ac-bestline');
                    if (b) b.click();
                });
                await sleep(300);
            }
            check(await waitFor(async () => (await phaseOf(host)) === 'done', 40000, 'the line of the night'),
                'Autocue: a line of the night is chosen');
            const best = await val(host, 'game.bestLine');
            check(best && best.text, 'Autocue: and it is named with its author',
                best ? `${(best.text || '').slice(0, 30)} — ${best.author}` : 'none');
        }

        // A writer must never receive another writer's unapproved line, and a
        // direction meant for the speaker must not arrive on their phone.
        await assertPrivacy(clients, ['submit'], 'Autocue');
        const writerDirs = await val(writer, 'game.__seen.filter(m => m.t === "direction").length');
        check(writerDirs === 0, 'Autocue: a writer never receives the speaker\'s direction', `${writerDirs}`);
        await consoleClean(clients, 'Autocue');
    } catch (e) {
        console.error('AUTOCUE THREW:', e && e.stack || e);
        check(false, 'Autocue: the suite ran to the end');
    } finally {
        await closeAll(clients);
    }
}

// ===========================================================================
// GAVEL
// ===========================================================================
async function testGavel(browser) {
    console.log('\n=== GAVEL ===');
    const room = 'gavel-e2e-' + Math.random().toString(36).slice(2, 7);
    const clients = await openRoom(browser, '/apps/mini-games/gavel/index.html', 'gavelGame', room);
    try {
        clients.forEach(c => check(c.connected, `Gavel: ${c.name} connected`));
        await rosterReady(clients);

        const host = clients[0], juror = clients[1], accused = clients[2];

        await host.page.fill('#caseTitle', 'The People v. Priya');
        await host.page.fill('#caseCharge', 'Re: the communal milk');
        await host.page.evaluate(() => { document.getElementById('defendantSelect').value = 'Priya'; });
        await host.page.click('#openBtn');

        check(await waitFor(async () => (await phaseOf(host)) === 'plea', 20000, 'the case to open'),
            'Gavel: the case opens with the plea');
        check(await val(host, 'game.defendant') === 'Priya', 'Gavel: the right person is in the dock');

        // The defendant finally has something to do.
        const pleaVisible = await accused.page.evaluate(() =>
            !document.getElementById('pleaPanel').hidden);
        check(pleaVisible, 'Gavel: only the defendant is asked for a plea');
        const jurorSeesPlea = await juror.page.evaluate(() =>
            !document.getElementById('pleaPanel').hidden);
        check(!jurorSeesPlea, 'Gavel: a juror is not');

        await accused.page.fill('#pleaInput', 'The milk was, in my view, communal.');
        await accused.page.click('#sendPlea');
        await sleep(1400);
        check((await val(host, 'game.plea')) === 'The milk was, in my view, communal.',
            'Gavel: the plea is entered');

        check(await waitFor(async () => (await phaseOf(host)) === 'evidence', 20000, 'testimony'),
            'Gavel: testimony opens after the plea');
        for (const c of clients) {
            const seen = await val(c, 'game.plea');
            check(seen === 'The milk was, in my view, communal.', `Gavel: ${c.name} sees the plea`, seen || 'none');
        }

        for (const c of [juror, accused]) {
            await c.page.fill('#testimonyInput', `${c.name} saw something they cannot unsee.`);
            await c.page.click('#sendTestimony');
            await sleep(400);
        }
        await sleep(900);

        const pending = await val(host, 'game.pending.length');
        check(pending >= 2, 'Gavel: testimony reaches the bench', `${pending}`);

        // The bench knows who wrote what; nobody else ever does.
        const authorsKnown = await val(host, 'game.pending.every(p => !!p.author)');
        check(authorsKnown, 'Gavel: the bench alone holds the authors');

        const admitted = await host.page.evaluate(() => {
            const btns = [...document.querySelectorAll('#benchList .gv-ok')];
            btns.forEach(b => b.click());
            return btns.length;
        });
        check(admitted >= 2, 'Gavel: the bench admits exhibits', `${admitted}`);
        await sleep(700);

        const publicExhibits = await val(juror, 'JSON.stringify(game.admitted)');
        check(!/author|Odell|Priya/.test(publicExhibits.replace(/saw something/g, '')) || !/"author"/.test(publicExhibits),
            'Gavel: admitted exhibits carry no author');

        // Objections are pure ceremony and must still be ruled on.
        await juror.page.click('#objectBtn');
        await sleep(900);
        const obj = await val(host, 'game.objection');
        check(obj && obj.by === 'Odell', 'Gavel: a juror may object', JSON.stringify(obj));
        await host.page.click('#sustainBtn');
        await sleep(700);
        check((await val(juror, 'game.objection.ruling')) === 'sustained',
            'Gavel: and the bench rules on it');

        await host.page.click('#juryNowBtn');
        check(await waitFor(async () => (await phaseOf(host)) === 'jury', 15000, 'the jury'),
            'Gavel: the jury retires');

        await host.page.click('#guiltyBtn');
        await sleep(400);
        await juror.page.click('#guiltyBtn');
        await sleep(400);

        const dockHidden = await accused.page.evaluate(() =>
            document.getElementById('juryPanel').hidden && !document.getElementById('dockPanel').hidden);
        check(dockHidden, 'Gavel: the defendant does not sit on their own jury');

        check(await waitFor(async () => (await phaseOf(host)) === 'sentence', 40000, 'the verdict'),
            'Gavel: a verdict is returned');
        check(await val(host, 'game.verdict') === 'guilty', 'Gavel: the tally decides it',
            await val(host, 'game.verdict'));

        await host.page.click('#passBtn');
        check(await waitFor(async () => (await phaseOf(host)) === 'done', 15000, 'sentencing'),
            'Gavel: sentence is passed');

        for (const c of clients) {
            const s = await val(c, 'game.sentence');
            check(!!s, `Gavel: ${c.name} sees the sentence`, (s || '').slice(0, 40));
        }

        // The record is the retention mechanism and the joke, so it has to be
        // readable back by a client that was not the one that wrote it.
        await sleep(2500);
        const law = await juror.page.evaluate(() => new Promise(resolve => {
            const g = window.gavelGame;
            g.channel.storageGetList(g.lawKey(), res => {
                resolve(window.PartyKit.storedVersions(res).map(window.PartyKit.decodeStored).filter(Boolean));
            });
        }));
        check(law.length >= 1, 'Gavel: the verdict is on the record', `${law.length} case(s)`);
        check(law.some(c => c.title === 'The People v. Priya' && c.verdict === 'guilty'),
            'Gavel: and another client can read it back', JSON.stringify(law[0] || {}).slice(0, 80));

        // A second case can cite the first — the record is only funny if used.
        await host.page.click('#adjournBtn');
        await sleep(2500);
        const options = await host.page.evaluate(() =>
            document.querySelectorAll('#precedentSelect option').length);
        check(options >= 2, 'Gavel: the earlier case is offered as precedent', `${options} options`);
        await host.page.fill('#caseTitle', 'The People v. Odell');
        await host.page.fill('#caseCharge', 'Re: the thermostat');
        await host.page.evaluate(() => {
            document.getElementById('defendantSelect').value = 'Odell';
            const p = document.getElementById('precedentSelect');
            p.value = p.options[1].value;
        });
        await host.page.click('#openBtn');
        await sleep(1500);
        const cited = await val(juror, 'game.precedent');
        check(cited && cited.title === 'The People v. Priya',
            'Gavel: and a later trial cites it', JSON.stringify(cited));

        await assertPrivacy(clients, ['submit', 'vote', 'plea'], 'Gavel');
        await consoleClean(clients, 'Gavel');
    } catch (e) {
        console.error('GAVEL THREW:', e && e.stack || e);
        check(false, 'Gavel: the suite ran to the end');
    } finally {
        await closeAll(clients);
    }
}

// ===========================================================================
// NUDGE
// ===========================================================================
async function testNudge(browser) {
    console.log('\n=== NUDGE ===');
    const room = 'nudge-e2e-' + Math.random().toString(36).slice(2, 7);
    const clients = await openRoom(browser, '/apps/mini-games/nudge/index.html', 'nudgeGame', room);
    try {
        clients.forEach(c => check(c.connected, `Nudge: ${c.name} connected`));
        await rosterReady(clients);

        const host = clients[0];
        await host.page.click('#startBtn');
        check(await waitFor(async () => (await phaseOf(host)) === 'live', 20000, 'the deal'),
            'Nudge: the missions are dealt');

        await sleep(1500);
        const hands = [];
        for (const c of clients) {
            hands.push({
                name: c.name,
                has: await val(c, 'game.hasMission'),
                text: await val(c, 'game.mission'),
            });
        }
        const innocents = hands.filter(h => !h.has);
        check(innocents.length === 1, 'Nudge: three players means exactly one innocent',
            `${innocents.length} — ${innocents.map(i => i.name).join(',')}`);
        check(hands.filter(h => h.has).every(h => !!h.text), 'Nudge: everybody else got a mission');
        const texts = hands.filter(h => h.has).map(h => h.text);
        check(new Set(texts).size === texts.length, 'Nudge: no two people share a mission');
        check(innocents.every(i => !i.text), 'Nudge: the innocent is told nothing at all');

        // Somebody with a mission claims it; the rest of the table votes.
        const claimer = clients.find(c => hands.find(h => h.name === c.name).has);
        await claimer.page.click('#claimBtn');
        check(await waitFor(async () => !!(await val(host, 'game.claim')), 15000, 'the claim'),
            'Nudge: a claim opens a table vote');

        for (const c of clients) {
            if (c.name === claimer.name) continue;
            await c.page.click('#voteYes').catch(() => {});
            await sleep(300);
        }
        check(await waitFor(async () => (await val(host, 'game.completed')) >= 1, 25000, 'the claim to carry'),
            'Nudge: the table can allow a claim');

        // A completed mission is replaced, not retired.
        const after = await val(claimer, 'game.mission');
        const before2 = hands.find(h => h.name === claimer.name).text;
        check(after && after !== before2, 'Nudge: a completed mission is replaced with a new one',
            `${(before2 || '').slice(0, 26)} -> ${(after || '').slice(0, 26)}`);
        check((await val(claimer, 'game.missionsDone')) === 1, 'Nudge: and the tally follows you');

        const claimerScore = (await val(host, 'game.score ? [...game.score].map(([n,v]) => ({name:n,score:v})) : []'))
            .find(r => r.name === claimer.name);
        check(claimerScore && (claimerScore.score === 100 || claimerScore.score === 150),
            'Nudge: an easy mission and a hard one pay differently',
            claimerScore ? String(claimerScore.score) : 'none');

        // One accusation each, and only one.
        const accuser = clients[1];
        const target = innocents[0].name;
        await accuser.page.evaluate(t => window.nudgeGame.accuse(t), target);
        await sleep(1200);
        check(await val(accuser, 'game.myAccusation') === target, 'Nudge: an accusation is registered', target);
        await accuser.page.evaluate(() => window.nudgeGame.accuse('Mara'));
        await sleep(800);
        check(await val(accuser, 'game.myAccusation') === target, 'Nudge: and a second one is refused');

        await host.page.click('#endBtn');
        check(await waitFor(async () => (await phaseOf(host)) === 'over', 20000, 'the reveal'),
            'Nudge: the evening is revealed');

        const reveal = await val(host, 'game.reveal');
        check(reveal && reveal.rows.length === 3, 'Nudge: every hand is shown', `${reveal ? reveal.rows.length : 0} rows`);
        check(reveal.rows.some(r => r.done > 0), 'Nudge: the reveal shows what each of them landed');
        check(reveal.rows.filter(r => r.mission).every(r => typeof r.hard === 'boolean'),
            'Nudge: and how hard it was');
        check(reveal.rows.filter(r => r.mission === null).length === 1,
            'Nudge: the innocent is finally named');

        const scores = await val(host, 'game.scores');
        const accuserScore = scores.find(s => s.name === accuser.name);
        check(accuserScore && accuserScore.score > 0, 'Nudge: naming the innocent correctly pays',
            JSON.stringify(scores));

        for (const c of clients) {
            const rows = await val(c, 'game.reveal ? game.reveal.rows.length : 0');
            check(rows === 3, `Nudge: ${c.name} sees the reveal`, `${rows}`);
        }

        // The whole game is one secret per pocket. This is the assertion.
        await assertPrivacy(clients, ['claim', 'accuse', 'vote'], 'Nudge');
        const guestSeen = await val(clients[1], 'game.__seen.filter(m => m.t === "mission").length');
        check(guestSeen === 1, 'Nudge: a guest receives exactly one mission — their own', `${guestSeen}`);

        await consoleClean(clients, 'Nudge');
    } catch (e) {
        console.error('NUDGE THREW:', e && e.stack || e);
        check(false, 'Nudge: the suite ran to the end');
    } finally {
        await closeAll(clients);
    }
}

// ===========================================================================

(async () => {
    console.log(`\nParty games E2E — ${BASE}`);
    const only = (process.argv[2] || '').toLowerCase();
    const browser = await chromium.launch(LAUNCH);
    try {
        if (!only || only === 'chorus')  await testChorus(browser);
        if (!only || only === 'autocue') await testAutocue(browser);
        if (!only || only === 'gavel')   await testGavel(browser);
        if (!only || only === 'nudge')   await testNudge(browser);
    } finally {
        await browser.close();
    }
    process.exit(R.report() === 0 ? 0 : 1);
})();
