/*
 * Gavel — three real clients through a whole trial, against the real backend.
 *
 *     xvfb-run -a node suites/gavel-test.js
 *
 * Gavel is built on PartyKit's one rule: a client message is ADDRESSED to the
 * host, never broadcast, because the game is made of secrets (the testimony you
 * wrote, the way you voted). So it is checked twice — once that a trial plays
 * end to end, and once that a guest never receives anything belonging to
 * another guest.
 *
 * This was party-games-test.js, which also drove Chorus, Autocue and Nudge.
 * Those moved to Party Arcade in hub phase 4 and are tested there
 * (apps/party-arcade/tests/{chorus,autocue,nudge}-browser.mjs).
 */
const { chromium } = require('playwright');
const { LAUNCH, results, waitForService } = require('../lib/harness');
const { sleep, waitFor, openRoom, val, closeAll } = require('../lib/party-room');

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, 'Gavel: ' + label + (extra ? '  — ' + extra : ''));
    return ok;
}

const PLEA = 'The milk was, in my view, communal.';
const phaseOf = c => val(c, 'game.phase');
const reaches = (c, phase, ms, label) => waitFor(async () => (await phaseOf(c)) === phase, ms, label);

async function rosterReady(clients) {
    await waitFor(async () => (await val(clients[0], 'game.playerCount()')) === 3, 30000, 'a roster of 3');
    for (const c of clients) {
        const n = await val(c, 'game.playerCount()');
        check(n === 3, `${c.name} sees three players`, `${n}`);
    }
}

/** Every guest heard only from the host, and never one of the banned types. */
async function assertPrivacy(clients, banned) {
    const hostName = await val(clients[0], 'game.username');
    for (const c of clients.slice(1)) {
        const seen = await val(c, 'game.__seen || []');
        const wrongSender = seen.filter(m => m.from !== hostName);
        const leaked = seen.filter(m => banned.includes(m.t));
        check(wrongSender.length === 0, `${c.name} only ever heard from the host`,
            wrongSender.length ? JSON.stringify(wrongSender[0]) : `${seen.length} messages`);
        check(leaked.length === 0, `${c.name} never received a private message meant for somebody else`,
            leaked.length ? leaked.map(m => m.t).join(',') : `types: ${[...new Set(seen.map(m => m.t))].join(',')}`);
    }
}

function consoleClean(clients) {
    for (const c of clients) {
        const bad = c.errors.filter(e => !/favicon|404/.test(e));
        check(bad.length === 0, `${c.name} had no console errors`, bad.slice(0, 2).join(' | '));
    }
}

async function openCase(host, juror, accused, title, charge, defendant, precedent) {
    await host.page.fill('#caseTitle', title);
    await host.page.fill('#caseCharge', charge);
    await host.page.evaluate(([who, cite]) => {
        document.getElementById('defendantSelect').value = who;
        const p = document.getElementById('precedentSelect');
        if (cite) p.value = p.options[1].value;
    }, [defendant, !!precedent]);
    await host.page.click('#openBtn');
}

async function thePlea(clients, host, juror, accused) {
    await openCase(host, juror, accused, 'The People v. Priya', 'Re: the communal milk', 'Priya');
    check(await reaches(host, 'plea', 20000, 'the case to open'), 'the case opens with the plea');
    check(await val(host, 'game.defendant') === 'Priya', 'the right person is in the dock');

    // The defendant finally has something to do.
    check(await accused.page.evaluate(() => !document.getElementById('pleaPanel').hidden),
        'only the defendant is asked for a plea');
    check(!(await juror.page.evaluate(() => !document.getElementById('pleaPanel').hidden)), 'a juror is not');

    await accused.page.fill('#pleaInput', PLEA);
    await accused.page.click('#sendPlea');
    await sleep(1400);
    check((await val(host, 'game.plea')) === PLEA, 'the plea is entered');
    check(await reaches(host, 'evidence', 20000, 'testimony'), 'testimony opens after the plea');
    for (const c of clients) {
        const seen = await val(c, 'game.plea');
        check(seen === PLEA, `${c.name} sees the plea`, seen || 'none');
    }
}

async function theTestimony(host, juror, accused) {
    for (const c of [juror, accused]) {
        await c.page.fill('#testimonyInput', `${c.name} saw something they cannot unsee.`);
        await c.page.click('#sendTestimony');
        await sleep(400);
    }
    await sleep(900);
    const pending = await val(host, 'game.pending.length');
    check(pending >= 2, 'testimony reaches the bench', `${pending}`);
    // The bench knows who wrote what; nobody else ever does.
    check(await val(host, 'game.pending.every(p => !!p.author)'), 'the bench alone holds the authors');

    const admitted = await host.page.evaluate(() => {
        const btns = [...document.querySelectorAll('#benchList .gv-ok')];
        btns.forEach(b => b.click());
        return btns.length;
    });
    check(admitted >= 2, 'the bench admits exhibits', `${admitted}`);
    await sleep(700);
    const publicExhibits = await val(juror, 'JSON.stringify(game.admitted)');
    check(!/author|Odell|Priya/.test(publicExhibits.replace(/saw something/g, '')) || !/"author"/.test(publicExhibits),
        'admitted exhibits carry no author');
}

/** Objections are pure ceremony and must still be ruled on. */
async function theObjection(host, juror) {
    await juror.page.click('#objectBtn');
    await sleep(900);
    const obj = await val(host, 'game.objection');
    check(obj && obj.by === 'Odell', 'a juror may object', JSON.stringify(obj));
    await host.page.click('#sustainBtn');
    await sleep(700);
    check((await val(juror, 'game.objection.ruling')) === 'sustained', 'and the bench rules on it');
}

async function theVerdict(clients, host, juror, accused) {
    await host.page.click('#juryNowBtn');
    check(await reaches(host, 'jury', 15000, 'the jury'), 'the jury retires');
    await host.page.click('#guiltyBtn');
    await sleep(400);
    await juror.page.click('#guiltyBtn');
    await sleep(400);
    check(await accused.page.evaluate(() =>
        document.getElementById('juryPanel').hidden && !document.getElementById('dockPanel').hidden),
    'the defendant does not sit on their own jury');

    check(await reaches(host, 'sentence', 40000, 'the verdict'), 'a verdict is returned');
    check(await val(host, 'game.verdict') === 'guilty', 'the tally decides it', await val(host, 'game.verdict'));
    await host.page.click('#passBtn');
    check(await reaches(host, 'done', 15000, 'sentencing'), 'sentence is passed');
    for (const c of clients) {
        const s = await val(c, 'game.sentence');
        check(!!s, `${c.name} sees the sentence`, (s || '').slice(0, 40));
    }
}

/** The record is the joke, so a client that did not write it must read it back. */
async function theRecord(host, juror, accused) {
    await sleep(2500);
    // Read the way Gavel reads it (loadCaseLaw), with a deadline: the helpers
    // this used to call were gone, so the read threw inside the callback and
    // the suite waited forever instead of failing.
    const law = await juror.page.evaluate(() => {
        const g = window.gavelGame;
        const read = g.channel.storageReadList(g.lawKey()).then(rows => rows.filter(r => r && r.title));
        return Promise.race([read, new Promise(r => setTimeout(() => r([]), 15000))]);
    });
    check(law.length >= 1, 'the verdict is on the record', `${law.length} case(s)`);
    check(law.some(c => c.title === 'The People v. Priya' && c.verdict === 'guilty'),
        'and another client can read it back', JSON.stringify(law[0] || {}).slice(0, 80));

    // A second case can cite the first — the record is only funny if used.
    await host.page.click('#adjournBtn');
    await sleep(2500);
    const options = await host.page.evaluate(() => document.querySelectorAll('#precedentSelect option').length);
    check(options >= 2, 'the earlier case is offered as precedent', `${options} options`);
    await openCase(host, juror, accused, 'The People v. Odell', 'Re: the thermostat', 'Odell', true);
    await sleep(1500);
    const cited = await val(juror, 'game.precedent');
    check(cited && cited.title === 'The People v. Priya', 'and a later trial cites it', JSON.stringify(cited));
}

(async () => {
    console.log('\nGavel E2E');
    const browser = await chromium.launch(LAUNCH);
    const room = 'gavel-e2e-' + Math.random().toString(36).slice(2, 7);
    let clients = [];
    try {
        await waitForService();
        clients = await openRoom(browser, '/apps/mini-games/gavel/index.html', 'gavelGame', room);
        clients.forEach(c => check(c.connected, `${c.name} connected`));
        await rosterReady(clients);
        const [host, juror, accused] = clients;
        await thePlea(clients, host, juror, accused);
        await theTestimony(host, juror, accused);
        await theObjection(host, juror);
        await theVerdict(clients, host, juror, accused);
        await theRecord(host, juror, accused);
        await assertPrivacy(clients, ['submit', 'vote', 'plea']);
        consoleClean(clients);
    } catch (e) {
        console.error('GAVEL THREW:', e && e.stack || e);
        check(false, 'the suite ran to the end');
    } finally {
        await closeAll(clients);
        await browser.close();
    }
    process.exitCode = R.report() === 0 ? 0 : 1;
})();
