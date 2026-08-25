/**
 * The rules SponsorPulse enforces at the host, tested without a browser.
 *
 * An attendee page runs on someone else's phone and can be edited there, so
 * every rule that matters — one answer per person, a closed segment stays
 * closed, an unknown option is refused, the rate limit — has to hold at the
 * tally rather than at the button. These run the real core module.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

// Load the module the app actually ships.
const sandbox = { window: {}, console, Date, Math, Object, String, RegExp, JSON };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(__dirname, '..', '..',
    'src/main/resources/static/apps/sponsorpulse/sponsorpulse-core.js'), 'utf8');
vm.runInContext(src, sandbox);
const Core = sandbox.window.SponsorPulseCore;

check(!!Core, 'the core module loads');

function pollSegment() {
    const s = Core.emptySegment();
    s.kind = 'poll';
    s.id = 'seg-1';
    s.options = [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }];
    return s;
}

function quizSegment() {
    const s = pollSegment();
    s.kind = 'quiz';
    s.options = [{ id: 'a', label: 'Yes', correct: true }, { id: 'b', label: 'No' }];
    return s;
}

// ---- one person, one answer ------------------------------------------------
{
    const s = pollSegment();
    Core.applyAction(s, { type: Core.MSG.VOTE, segmentId: 'seg-1', optionId: 'a' }, 'Amina');
    Core.applyAction(s, { type: Core.MSG.VOTE, segmentId: 'seg-1', optionId: 'a' }, 'Amina');
    const counts = Core.tally(s);
    check(counts.a === 1, `voting twice counts once (a=${counts.a})`);

    Core.applyAction(s, { type: Core.MSG.VOTE, segmentId: 'seg-1', optionId: 'b' }, 'Amina');
    const after = Core.tally(s);
    check(after.a === 0 && after.b === 1, 'changing an answer moves the vote rather than adding one');
}

// ---- a closed segment stays closed -----------------------------------------
{
    const s = pollSegment();
    s.endsAt = Date.now() - 1000;
    const r = Core.applyAction(s, { type: Core.MSG.VOTE, segmentId: 'seg-1', optionId: 'a' }, 'Amina');
    check(!!r.error, `a vote after the timer is refused (${r.error})`);
    check(Core.tally(s).a === 0, 'and does not reach the tally');
}

// ---- an option nobody offered ----------------------------------------------
{
    const s = pollSegment();
    const r = Core.applyAction(s, { type: Core.MSG.VOTE, segmentId: 'seg-1', optionId: 'write-in' }, 'Mallory');
    check(!!r.error, 'an option that was never offered is refused');
    check(Object.keys(s.votes).length === 0, 'and no phantom option appears in the tally');
}

// ---- a stale segment id ----------------------------------------------------
{
    const s = pollSegment();
    const r = Core.applyAction(s, { type: Core.MSG.VOTE, segmentId: 'seg-OLD', optionId: 'a' }, 'Amina');
    check(!!r.error, 'a vote for a finished segment does not land on the current one');
}

// ---- scoring ---------------------------------------------------------------
{
    const s = quizSegment();
    Core.applyAction(s, { type: Core.MSG.ANSWER, segmentId: 'seg-1', optionId: 'a' }, 'Amina');
    Core.applyAction(s, { type: Core.MSG.ANSWER, segmentId: 'seg-1', optionId: 'b' }, 'Jordan');
    Core.scoreQuiz(s);
    check(s.scores.Amina === 1, 'a correct answer scores');
    check(!s.scores.Jordan, 'a wrong answer does not');

    const board = Core.leaderboard(s);
    check(board[0].name === 'Amina', 'the leaderboard is ordered by points');
}

// ---- Q&A -------------------------------------------------------------------
{
    const s = Core.emptySegment();
    s.kind = 'qa';
    Core.applyAction(s, { type: Core.MSG.ASK, text: '  How does pricing work?  ' }, 'Priya');
    check(s.questions.length === 1, 'a question is accepted');
    check(s.questions[0].text === 'How does pricing work?', 'and is trimmed');
    check(s.questions[0].state === 'pending', 'and waits for the host rather than appearing straight away');

    const empty = Core.applyAction(s, { type: Core.MSG.ASK, text: '   ' }, 'Priya');
    check(!!empty.error, 'an empty question is refused');

    const long = 'x'.repeat(500);
    Core.applyAction(s, { type: Core.MSG.ASK, text: long }, 'Priya');
    check(s.questions[1].text.length === Core.LIMITS.MAX_QUESTION_CHARS,
        `an over-long question is capped (${s.questions[1].text.length})`);

    const qid = s.questions[0].id;
    Core.applyAction(s, { type: Core.MSG.UPVOTE, questionId: qid }, 'Amina');
    check(s.questions[0].upvotes.length === 1, 'an upvote counts');
    Core.applyAction(s, { type: Core.MSG.UPVOTE, questionId: qid }, 'Amina');
    check(s.questions[0].upvotes.length === 0, 'and the same person tapping again takes it back');
    Core.applyAction(s, { type: Core.MSG.UPVOTE, questionId: qid }, 'Amina');
    Core.applyAction(s, { type: Core.MSG.UPVOTE, questionId: qid }, 'Amina');
    check(s.questions[0].upvotes.length === 0, 'upvotes never stack for one person');
}

// ---- rate limiting ---------------------------------------------------------
{
    const limiter = new Core.RateLimiter();
    let allowed = 0;
    for (let i = 0; i < Core.LIMITS.ACTIONS_PER_WINDOW + 15; i++) {
        if (limiter.allow('Flooder')) allowed++;
    }
    check(allowed === Core.LIMITS.ACTIONS_PER_WINDOW,
        `a flood is capped at ${Core.LIMITS.ACTIONS_PER_WINDOW} (allowed ${allowed})`);
    check(limiter.allow('Someone else'), 'and one attendee flooding does not silence the room');
}

// ---- consent and export ----------------------------------------------------
{
    const s = quizSegment();
    Core.applyAction(s, { type: Core.MSG.ANSWER, segmentId: 'seg-1', optionId: 'a' }, 'Amina');
    const campaign = Core.emptyCampaign();
    campaign.eventName = 'Launch night';
    campaign.sponsorName = 'Northwind';

    const profiles = {
        Amina:  { name: 'Amina', email: 'amina@example.com', consent: true, consentedAt: 1700000000000 },
        Jordan: { name: 'Jordan', email: 'jordan@example.com', consent: false }
    };
    const report = Core.buildReport(campaign, s, profiles);
    check(report.leads.length === 1, 'only consenting attendees become leads');
    check(report.leads[0].name === 'Amina', 'and it is the one who ticked the box');
    check(report.attendees === 2, 'while the headline attendee count includes everyone');

    const csv = Core.leadsToCsv(report);
    check(!csv.includes('jordan@example.com'), 'the CSV never contains a non-consenting attendee');
    check(csv.includes('amina@example.com'), 'and does contain the consenting one');

    // A spreadsheet executes a leading =, so an injected formula must be defused.
    const nasty = Core.buildReport(campaign, s, {
        Evil: { name: '=cmd|calc', email: '=1+1', consent: true, consentedAt: 1 }
    });
    const nastyCsv = Core.leadsToCsv(nasty);
    check(!/(^|,)"=/.test(nastyCsv), 'a formula in a name cannot execute when the CSV is opened');
}

console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
process.exit(fail.length ? 1 : 0);
