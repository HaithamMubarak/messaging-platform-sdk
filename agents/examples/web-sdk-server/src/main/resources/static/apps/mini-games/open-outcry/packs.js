// ============================================================================
// Open Outcry — claim packs.
//
// A round trades one claim. There are two kinds, and the difference decides
// who gets dealt the truth:
//
//   fact   an objectively true/false statement. The truth is in the pack, so
//          the host deals it to ONE randomly chosen player — the insider.
//   room   a statement about a specific person in the room. Nobody in the pack
//          knows the answer, so the SUBJECT is the insider by construction:
//          they answer privately before the market opens, and then have to
//          trade on what they know without the room reading it off them.
//
// `{P}` in a room claim is replaced with the subject's name.
//
// Packs are the product's revenue line (see RUNBOOK.md): the base game ships
// with `house`, the rest are sold. `locked: true` is presentation only — the
// showcase build leaves every pack playable.
// ============================================================================
(function () {
    'use strict';

    const PACKS = {
        house: {
            id: 'house',
            name: 'House Pack',
            blurb: 'The starter floor. General claims and a few personal ones.',
            locked: false,
            claims: [
                { t: 'fact', text: 'A day on Venus is longer than a year on Venus.', a: true },
                { t: 'fact', text: 'The Great Wall of China is visible to the naked eye from the Moon.', a: false },
                { t: 'fact', text: 'Honey found in ancient tombs was still edible.', a: true },
                { t: 'fact', text: 'Bananas are berries. Strawberries are not.', a: true },
                { t: 'fact', text: 'Lightning never strikes the same place twice.', a: false },
                { t: 'fact', text: 'There are more trees on Earth than stars in the Milky Way.', a: true },
                { t: 'fact', text: 'Goldfish have a three-second memory.', a: false },
                { t: 'fact', text: 'The shortest war in recorded history lasted under an hour.', a: true },
                { t: 'fact', text: 'Octopuses have three hearts.', a: true },
                { t: 'fact', text: 'Humans use only ten percent of their brains.', a: false },
                { t: 'fact', text: 'Iceland has no mosquitoes.', a: true },
                { t: 'fact', text: 'The Eiffel Tower can be more than fifteen centimetres taller in summer.', a: true },
                { t: 'fact', text: 'Sharks existed before trees did.', a: true },
                { t: 'fact', text: 'Napoleon Bonaparte was unusually short for his time.', a: false },
                { t: 'fact', text: 'A group of flamingos is called a flamboyance.', a: true },
                { t: 'fact', text: 'Sound travels faster in water than in air.', a: true },
                { t: 'fact', text: 'Chameleons change colour mainly to match their background.', a: false },
                { t: 'fact', text: 'Oxford University is older than the Aztec Empire.', a: true },
                { t: 'room', text: '{P} has broken a bone.' },
                { t: 'room', text: '{P} can name every planet in order, right now, without help.' },
                { t: 'room', text: '{P} has been on television.' },
                { t: 'room', text: '{P} has more than a thousand unread emails.' },
                { t: 'room', text: '{P} has met someone famous.' },
                { t: 'room', text: '{P} knows how to swim properly.' },
                { t: 'room', text: '{P} has lied about having read a book.' },
                { t: 'room', text: '{P} has driven a car in another country.' },
                { t: 'room', text: '{P} still has a school report card somewhere.' },
                { t: 'room', text: '{P} has been stung by a jellyfish.' },
            ],
        },

        work: {
            id: 'work',
            name: 'Work Night',
            blurb: 'For the team dinner. Careers, calendars and quiet mutinies.',
            locked: true,
            claims: [
                { t: 'room', text: '{P} has cried about a job.' },
                { t: 'room', text: '{P} has been in a meeting that should have been an email today.' },
                { t: 'room', text: '{P} has applied for another job in the last six months.' },
                { t: 'room', text: '{P} has been fired or made redundant.' },
                { t: 'room', text: '{P} has told a colleague a deadline was earlier than it really was.' },
                { t: 'room', text: '{P} has more than fifty browser tabs open right now.' },
                { t: 'room', text: '{P} has fallen asleep on a work call.' },
                { t: 'room', text: '{P} could explain what the company mission statement actually says.' },
                { t: 'room', text: '{P} has a side project they have not told work about.' },
                { t: 'room', text: '{P} has sent a message to the wrong channel and had to delete it.' },
                { t: 'room', text: '{P} would take a pay cut for a four-day week.' },
                { t: 'room', text: '{P} has worked somewhere they would never recommend.' },
                { t: 'fact', text: 'The forty-hour work week was popularised by Henry Ford.', a: true },
                { t: 'fact', text: 'The phrase "spam" for junk email came from a Monty Python sketch.', a: true },
                { t: 'fact', text: 'Open-plan offices were designed to increase privacy.', a: false },
                { t: 'fact', text: 'The average office worker sends over one hundred emails a day.', a: false },
                { t: 'fact', text: 'The QWERTY layout was designed to slow typists down.', a: false },
                { t: 'fact', text: 'Iceland trialled a shorter working week and called it a success.', a: true },
            ],
        },

        bar: {
            id: 'bar',
            name: 'Bar Night',
            blurb: 'Loud room, short rounds, claims that start arguments.',
            locked: true,
            claims: [
                { t: 'room', text: '{P} has been thrown out of somewhere.' },
                { t: 'room', text: '{P} has sung karaoke sober.' },
                { t: 'room', text: '{P} could win a fight against a goose.' },
                { t: 'room', text: '{P} has texted an ex in the last year.' },
                { t: 'room', text: '{P} has a tattoo.' },
                { t: 'room', text: '{P} has left a party without saying goodbye to anyone.' },
                { t: 'room', text: '{P} knows all the words to a song they are embarrassed by.' },
                { t: 'room', text: '{P} has spent more than a hundred on a single night out.' },
                { t: 'room', text: '{P} has been in a band.' },
                { t: 'room', text: '{P} can do a handstand right now.' },
                { t: 'room', text: '{P} has stolen a glass from a pub.' },
                { t: 'room', text: '{P} has run a marathon or a half marathon.' },
                { t: 'fact', text: 'Tequila and mezcal are both made from agave.', a: true },
                { t: 'fact', text: 'Guinness is black.', a: false },
                { t: 'fact', text: 'Champagne can only be called champagne if it comes from Champagne.', a: true },
                { t: 'fact', text: 'Vodka must be made from potatoes.', a: false },
                { t: 'fact', text: 'A pint in the United States is smaller than a pint in the United Kingdom.', a: true },
                { t: 'fact', text: 'Darts players have been world champions while smoking on stage.', a: true },
            ],
        },
    };

    const PACK_ORDER = ['house', 'work', 'bar'];

    // Build a shuffled round list for a pack. Room claims need at least two
    // players (a subject and somebody to trade against them), so with a single
    // trader the deck is facts only.
    function buildDeck(packId, playerCount, rounds) {
        const pack = PACKS[packId] || PACKS.house;
        let pool = pack.claims.slice();
        if (playerCount < 2) pool = pool.filter(c => c.t === 'fact');
        if (!pool.length) pool = PACKS.house.claims.filter(c => c.t === 'fact');

        // Fisher-Yates.
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        const deck = [];
        while (deck.length < rounds) {
            deck.push(pool[deck.length % pool.length]);
        }
        return deck.slice(0, rounds);
    }

    window.OpenOutcryPacks = { PACKS, PACK_ORDER, buildDeck };
})();
