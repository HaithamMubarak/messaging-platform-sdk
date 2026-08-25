/**
 * SponsorPulse, with a real organiser and real attendees.
 *
 * The core rules are unit-tested without a browser; this asks the question those
 * cannot: does an attendee who scanned a link actually end up in the room, see
 * what the host launched, and have their answer counted once — over the channel
 * relay, through the host's console.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

const room = 'sp' + Math.floor(Date.now() / 1000);
const key = 'pw12345';

async function openHost(b) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, 'host threw: ' + e.message.split('\n')[0].slice(0, 80)));
    await p.goto(BASE + '/apps/sponsorpulse/host.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', 'Organiser');
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', key);
    await p.click('#connectBtn');
    await p.waitForTimeout(9000);
    return p;
}

async function openAttendee(b, name, consent) {
    const ctx = await b.newContext({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ` + e.message.split('\n')[0].slice(0, 80)));
    // Exactly what a QR code encodes.
    const url = `${BASE}/apps/sponsorpulse/join.html#r=${encodeURIComponent(room)}&k=${encodeURIComponent(key)}&l=en`;
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#attendeeName', { timeout: 30000 });
    await p.fill('#attendeeName', name);
    if (consent) {
        await p.check('#consent');
        await p.fill('#attendeeEmail', name.toLowerCase() + '@example.com');
    }
    await p.click('#joinBtn');
    await p.waitForTimeout(9000);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const host = await openHost(b);
    check(await host.evaluate(() => !!window.sponsorPulseHost), 'the organiser console starts');

    // The invite link must carry the room and its key, or a QR is useless.
    const link = await host.evaluate(() => window.sponsorPulseHost._joinLink || '');
    check(link.includes('#r=') && link.includes('k='),
        'the invite link carries the room and key in its hash');
    check(!link.includes('?r='), 'and in the hash rather than the query, so it stays out of Referer');

    // One ticks the consent box, one does not — the difference is what the
    // organiser is allowed to export.
    const amina = await openAttendee(b, 'Amina', true);
    const jordan = await openAttendee(b, 'Jordan', false);
    await host.waitForTimeout(3000);

    const seen = await host.evaluate(() => Object.keys(window.sponsorPulseHost.profiles).length);
    check(seen === 2, `both attendees reach the organiser's roster (saw ${seen})`);

    // ---- run a quiz question -------------------------------------------------
    await host.click('#modeQuiz');
    await host.fill('#promptInput', 'Which primitive keeps the score honest?');
    const rows = await host.$$('[data-option-row]');
    await rows[0].$eval('input[type="text"]', (el) => { el.value = 'Host authority'; });
    await rows[0].$eval('input[type="checkbox"]', (el) => { el.checked = true; });
    await rows[1].$eval('input[type="text"]', (el) => { el.value = 'Hope'; });
    await host.fill('#timerSecs', '0');
    await host.click('#launchBtn');
    await host.waitForTimeout(3000);

    const promptSeen = await amina.evaluate(() => {
        const el = document.querySelector('#segment .sp-prompt');
        return el ? el.textContent : '';
    });
    check(promptSeen.includes('honest'), `the attendee sees the question (${promptSeen.slice(0, 40)})`);

    const optionCount = await amina.evaluate(() => document.querySelectorAll('.sp-option').length);
    check(optionCount === 2, `and both options (${optionCount})`);

    // ---- answering -----------------------------------------------------------
    await amina.click('.sp-option:first-of-type');           // correct
    await jordan.evaluate(() => document.querySelectorAll('.sp-option')[1].click());
    await host.waitForTimeout(3000);

    let votes = await host.evaluate(() => Object.keys(window.sponsorPulseHost.segment.votes).length);
    check(votes === 2, `both answers reach the host (${votes})`);

    // Tapping again must not add a second vote — the rule lives at the host.
    await amina.click('.sp-option:first-of-type');
    await amina.click('.sp-option:first-of-type');
    await host.waitForTimeout(2500);
    votes = await host.evaluate(() => Object.keys(window.sponsorPulseHost.segment.votes).length);
    check(votes === 2, `tapping repeatedly still counts one answer per person (${votes})`);

    // ---- reveal and score ----------------------------------------------------
    await host.click('#revealBtn');
    await host.waitForTimeout(3000);

    const scores = await host.evaluate(() => window.sponsorPulseHost.segment.scores);
    check(scores.Amina === 1, `the correct answer scores (Amina=${scores.Amina})`);
    check(!scores.Jordan, 'and the wrong one does not');

    const boardShown = await amina.evaluate(() => {
        const rows = document.querySelectorAll('#board .sp-board__row');
        return rows.length > 0 && rows[0].textContent.includes('Amina');
    });
    check(boardShown, 'the leaderboard reaches the attendee with the leader on top');

    // ---- Q&A and moderation --------------------------------------------------
    await host.click('#modeQa');
    await host.fill('#promptInput', 'Ask us anything');
    await host.click('#launchBtn');
    await host.waitForTimeout(3000);

    await jordan.evaluate(() => {
        const input = document.querySelector('#segment input[type="text"]');
        input.value = 'When does the offer expire?';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#segment .btn--primary').click();
    });
    await host.waitForTimeout(3000);

    const queued = await host.evaluate(() => window.sponsorPulseHost.segment.questions.length);
    check(queued === 1, `a question reaches the moderation queue (${queued})`);

    const visibleBeforeApproval = await amina.evaluate(() =>
        document.querySelectorAll('#segment .sp-question').length);
    check(visibleBeforeApproval === 0,
        'and is NOT shown to the room before the host approves it');

    await host.evaluate(() => {
        const id = window.sponsorPulseHost.segment.questions[0].id;
        window.sponsorPulseHost.moderate(id, 'approved');
    });
    await host.waitForTimeout(3000);

    const visibleAfter = await amina.evaluate(() =>
        document.querySelectorAll('#segment .sp-question').length);
    check(visibleAfter === 1, 'once approved it appears for everyone');

    // ---- consent gate --------------------------------------------------------
    const report = await host.evaluate(() => window.sponsorPulseHost.report());
    check(report.attendees === 2, `the report counts everyone present (${report.attendees})`);
    check(report.leads.length === 1,
        `only the attendee who consented becomes a lead (${report.leads.length})`);
    check(report.leads[0] && report.leads[0].name === 'Amina',
        'and it is the one who ticked the box');

    // The CSV is the thing actually handed to a sponsor, so check that, not
    // just the object it was built from.
    const csv = await host.evaluate(() =>
        window.SponsorPulseCore.leadsToCsv(window.sponsorPulseHost.report()));
    check(csv.includes('amina@example.com'), 'the export contains the consenting attendee');
    check(!csv.includes('jordan@example.com'),
        'and never the one who did not consent');

    await host.screenshot({ path: SHOTS + '/sponsorpulse-host.png' });
    await amina.screenshot({ path: SHOTS + '/sponsorpulse-attendee.png' });

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
