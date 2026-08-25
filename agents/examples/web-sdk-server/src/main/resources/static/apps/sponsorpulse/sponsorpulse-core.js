/**
 * SponsorPulse — shared state and wire protocol.
 *
 * One authority, always. Every vote, answer and upvote is addressed to the
 * host, tallied there, and broadcast back as a whole segment state. Attendees
 * never compute a score locally, because UserConnectionBase relays anything
 * sent with a plain sendData() to every client: a tally each browser applied
 * itself would count one vote once per browser, and a leaderboard shown on a
 * screen in a room has to agree with itself.
 *
 * That also means the rules live in one place. An attendee page can be
 * modified by whoever is holding the phone, so the cap, the rate limit and
 * one-vote-per-person are enforced where the tally is, not where the button is.
 */
(function (window) {
    'use strict';

    var LIMITS = {
        /** Beyond this the room stops admitting people. */
        MAX_ATTENDEES: 500,
        /** Per attendee, per rolling window — stops a script flooding the tally. */
        ACTIONS_PER_WINDOW: 20,
        WINDOW_MS: 10000,
        MAX_QUESTION_CHARS: 280,
        MAX_QUESTIONS: 200,
        MAX_NAME_CHARS: 40
    };

    var MSG = {
        STATE: 'sp_state',          // host -> everyone: the whole segment
        CAMPAIGN: 'sp_campaign',    // host -> everyone: branding and sponsor
        VOTE: 'sp_vote',            // attendee -> host
        ANSWER: 'sp_answer',        // attendee -> host
        ASK: 'sp_ask',              // attendee -> host
        UPVOTE: 'sp_upvote',        // attendee -> host
        PROFILE: 'sp_profile',      // attendee -> host: consent and contact
        REJECTED: 'sp_rejected'     // host -> one attendee: why an action failed
    };

    var STORAGE = {
        CAMPAIGN: 'sp_campaign',
        SEGMENT: 'sp_segment',
        LEADS: 'sp_leads'
    };

    /** A campaign is the organiser's branding plus the sponsor's slot. */
    function emptyCampaign() {
        return {
            brandName: '',
            logoDataUrl: '',
            accent: '#5d60ef',
            eventName: '',
            eventDate: '',
            language: 'en',
            sponsorName: '',
            sponsorLogoDataUrl: '',
            sponsorOffer: '',
            sponsorVisible: false
        };
    }

    /**
     * A segment is whatever the room is doing right now: one poll, one quiz
     * question, or the Q&A board. Only one runs at a time, which is what makes
     * a single broadcast state enough.
     */
    function emptySegment() {
        return {
            kind: 'idle',       // idle | poll | quiz | qa
            id: '',
            prompt: '',
            options: [],        // [{id, label, correct?}]
            votes: {},          // attendeeName -> optionId
            endsAt: 0,          // epoch ms; 0 means no timer
            revealed: false,    // quiz: whether the answer is shown
            questions: [],      // qa: [{id, text, by, at, upvotes:[names], state}]
            scores: {}          // attendeeName -> points, across the whole event
        };
    }

    function newId(prefix) {
        return prefix + '-' + Date.now().toString(36) + '-' +
            Math.floor(Math.random() * 1e6).toString(36);
    }

    /** Trim and cap free text before it reaches anyone else's screen. */
    function cleanText(value, max) {
        if (typeof value !== 'string') return '';
        var trimmed = value.replace(/\s+/g, ' ').trim();
        return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
    }

    /**
     * Per-attendee action budget, held by the host.
     *
     * A fixed window is deliberate: the point is to stop a loop hammering the
     * tally, not to be exact at the boundary.
     */
    function RateLimiter(limits) {
        this.limits = limits || LIMITS;
        this.buckets = Object.create(null);
    }

    RateLimiter.prototype.allow = function (who) {
        var now = Date.now();
        var window = Math.floor(now / this.limits.WINDOW_MS);
        var bucket = this.buckets[who];
        if (!bucket || bucket.window !== window) {
            bucket = { window: window, count: 0 };
            this.buckets[who] = bucket;
        }
        if (bucket.count >= this.limits.ACTIONS_PER_WINDOW) return false;
        bucket.count++;
        return true;
    };

    RateLimiter.prototype.forget = function (who) {
        delete this.buckets[who];
    };

    /**
     * Apply an attendee action to the segment. Returns null when the action is
     * refused, with the reason, so the host can tell that one attendee why
     * without broadcasting it.
     *
     * This is pure so it can be tested without a browser or a channel.
     */
    function applyAction(segment, action, from, limits) {
        limits = limits || LIMITS;

        if (action.type === MSG.VOTE || action.type === MSG.ANSWER) {
            if (segment.kind !== 'poll' && segment.kind !== 'quiz') {
                return { error: 'no segment is open' };
            }
            if (segment.id !== action.segmentId) {
                return { error: 'that segment has moved on' };
            }
            if (segment.endsAt && Date.now() > segment.endsAt) {
                return { error: 'voting has closed' };
            }
            var known = segment.options.some(function (o) { return o.id === action.optionId; });
            if (!known) return { error: 'unknown option' };
            // One answer per person: changing it is allowed while the segment is
            // open, but it replaces rather than adds.
            segment.votes[from] = action.optionId;
            return { changed: true };
        }

        if (action.type === MSG.ASK) {
            if (segment.questions.length >= limits.MAX_QUESTIONS) {
                return { error: 'the board is full' };
            }
            var text = cleanText(action.text, limits.MAX_QUESTION_CHARS);
            if (!text) return { error: 'a question needs some words' };
            segment.questions.push({
                id: newId('q'),
                text: text,
                by: from,
                at: Date.now(),
                upvotes: [],
                state: 'pending'        // pending | approved | hidden | pinned | answered
            });
            return { changed: true };
        }

        if (action.type === MSG.UPVOTE) {
            var question = segment.questions.filter(function (q) { return q.id === action.questionId; })[0];
            if (!question) return { error: 'that question is gone' };
            var at = question.upvotes.indexOf(from);
            // Toggle, so a second tap takes the vote back rather than stacking.
            if (at === -1) question.upvotes.push(from);
            else question.upvotes.splice(at, 1);
            return { changed: true };
        }

        return { error: 'unknown action' };
    }

    /** Award points for a finished quiz segment. Highest first, ties keep order. */
    function scoreQuiz(segment) {
        if (segment.kind !== 'quiz') return;
        var correct = segment.options.filter(function (o) { return o.correct; })
            .map(function (o) { return o.id; });
        Object.keys(segment.votes).forEach(function (name) {
            if (correct.indexOf(segment.votes[name]) !== -1) {
                segment.scores[name] = (segment.scores[name] || 0) + 1;
            }
        });
    }

    function leaderboard(segment) {
        return Object.keys(segment.scores)
            .map(function (name) { return { name: name, points: segment.scores[name] }; })
            .sort(function (a, b) { return b.points - a.points || a.name.localeCompare(b.name); });
    }

    function tally(segment) {
        var counts = {};
        segment.options.forEach(function (o) { counts[o.id] = 0; });
        Object.keys(segment.votes).forEach(function (name) {
            var id = segment.votes[name];
            if (counts[id] !== undefined) counts[id]++;
        });
        return counts;
    }

    /**
     * Build the event report. Only attendees who ticked the consent box appear
     * in the lead rows — that is the whole point of asking.
     */
    function buildReport(campaign, segment, profiles) {
        var board = leaderboard(segment);
        var consented = Object.keys(profiles || {})
            .map(function (name) { return profiles[name]; })
            .filter(function (p) { return p && p.consent; });

        return {
            event: campaign.eventName || 'Untitled event',
            date: campaign.eventDate || '',
            sponsor: campaign.sponsorName || '',
            attendees: Object.keys(profiles || {}).length,
            questionsAsked: segment.questions.length,
            votesCast: Object.keys(segment.votes).length,
            leaderboard: board,
            leads: consented
        };
    }

    /** CSV for the organiser. Consented rows only, and quoted properly. */
    function leadsToCsv(report) {
        function cell(value) {
            var s = value === null || value === undefined ? '' : String(value);
            // A field starting with = + - @ is executed by spreadsheet apps;
            // prefixing breaks that without changing what a human reads.
            if (/^[=+\-@]/.test(s)) s = "'" + s;
            return '"' + s.replace(/"/g, '""') + '"';
        }
        var rows = [['name', 'email', 'consented_at', 'event', 'sponsor'].map(cell).join(',')];
        (report.leads || []).forEach(function (lead) {
            rows.push([
                cell(lead.name),
                cell(lead.email || ''),
                cell(lead.consentedAt ? new Date(lead.consentedAt).toISOString() : ''),
                cell(report.event),
                cell(report.sponsor)
            ].join(','));
        });
        return rows.join('\r\n');
    }

    window.SponsorPulseCore = {
        LIMITS: LIMITS,
        MSG: MSG,
        STORAGE: STORAGE,
        emptyCampaign: emptyCampaign,
        emptySegment: emptySegment,
        newId: newId,
        cleanText: cleanText,
        RateLimiter: RateLimiter,
        applyAction: applyAction,
        scoreQuiz: scoreQuiz,
        leaderboard: leaderboard,
        tally: tally,
        buildReport: buildReport,
        leadsToCsv: leadsToCsv
    };
})(window);
