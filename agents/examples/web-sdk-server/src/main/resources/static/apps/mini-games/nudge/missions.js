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
// `hard: true` is worth more — a mission you can land in one sentence should
// not pay the same as one that needs the whole evening.
// ============================================================================
(function () {
    'use strict';

    const MISSIONS = [
        { text: 'Get {target} to name a country beginning with M.', hard: false },
        { text: 'Get {target} to show the table a photo on their phone.', hard: false },
        { text: 'Get {target} to swap seats with somebody.', hard: true },
        { text: 'Get {target} to say the word "obviously" twice.', hard: true },
        { text: 'Get {target} to talk about their commute for a full minute.', hard: true },
        { text: 'Get {target} to ask you a question about your job.', hard: true },
        { text: 'Get {target} to mention an animal.', hard: false },
        { text: 'Get {target} to stand up.', hard: true },
        { text: 'Get {target} to offer you something to eat or drink.', hard: true },
        { text: 'Get {target} to say the name of a film out loud.', hard: true },
        { text: 'Get {target} to check the time.', hard: false },
        { text: 'Get {target} to spell a word out loud.', hard: true },
        { text: 'Get {target} to say "I don\'t know".', hard: true },
        { text: 'Get {target} to agree with something they clearly disagree with.', hard: true },
        { text: 'Get {target} to recommend something to the whole table.', hard: true },
        { text: 'Get {target} to say a number over one thousand.', hard: true },
        { text: 'Get {target} to talk about the weather without being asked.', hard: false },
        { text: 'Get {target} to mention somebody who is not in the room.', hard: false },
        { text: 'Get {target} to laugh at something you said.', hard: false },
        { text: 'Get {target} to describe a journey that went wrong.', hard: true },
        { text: 'Get {target} to say the word "actually".', hard: true },
        { text: 'Get {target} to name a vegetable they dislike.', hard: false },
        { text: 'Get {target} to tell the table how they slept.', hard: false },
        { text: 'Get {target} to ask somebody else to pass them something.', hard: false },
    ];

    window.NudgeMissions = { MISSIONS };
})();
