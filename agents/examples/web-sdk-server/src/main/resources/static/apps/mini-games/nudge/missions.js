// ============================================================================
// Nudge — the deck.
//
// The deck IS the design work, and one bad card ruins an evening. Every
// mission here obeys three rules, and a new one must obey them too:
//
//   1. it produces a PUBLIC, OBSERVABLE moment the table can vote on;
//   2. it is achievable by TALKING, with no props and nobody leaving the room;
//   3. it is never cruel — the target should laugh when it is revealed.
//
// {target} is replaced with the name of another player at the table.
// ============================================================================
(function () {
    'use strict';

    const MISSIONS = [
        'Get {target} to name a country beginning with M.',
        'Get {target} to show the table a photo on their phone.',
        'Get {target} to swap seats with somebody.',
        'Get {target} to say the word "obviously" twice.',
        'Get {target} to talk about their commute for a full minute.',
        'Get {target} to ask you a question about your job.',
        'Get {target} to mention an animal.',
        'Get {target} to stand up.',
        'Get {target} to offer you something to eat or drink.',
        'Get {target} to say the name of a film out loud.',
        'Get {target} to check the time.',
        'Get {target} to spell a word out loud.',
        'Get {target} to say "I don\'t know".',
        'Get {target} to agree with something they clearly disagree with.',
        'Get {target} to recommend something to the whole table.',
        'Get {target} to say a number over one thousand.',
        'Get {target} to talk about the weather without being asked.',
        'Get {target} to mention somebody who is not in the room.',
        'Get {target} to laugh at something you said.',
        'Get {target} to describe a journey that went wrong.',
        'Get {target} to say the word "actually".',
        'Get {target} to name a vegetable they dislike.',
        'Get {target} to tell the table how they slept.',
        'Get {target} to ask somebody else to pass them something.',
    ];

    window.NudgeMissions = { MISSIONS };
})();
