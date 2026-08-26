// ============================================================================
// Chorus — the templates.
//
// This file IS the product surface. A template says what the finished thing
// looks like and where the holes are; the engine knows nothing about
// headlines or recipes. Adding a round type is writing an entry here, not
// shipping a release — which is why making the game more general made it
// cheaper rather than dearer.
//
//   parts   an ordered list. A string is literal text; an object {k} is a
//           slot to be owned by a player, filled from WORDS[k].
//   extra   slot kinds appended, cycling, when there are more players than
//           slots — because everybody must always own something.
// ============================================================================
(function () {
    'use strict';

    const WORDS = {
        adj: ['newly promoted', 'visibly damp', 'award-winning', 'interim', 'famously calm',
              'recently vindicated', 'unpaid', 'clinically exhausted', 'self-appointed', 'part-time'],
        verb: ['reversed', 'married', 'quietly buried', 'invoiced', 'personally escorted',
               'blamed', 'renamed', 'test-drove', 'confiscated', 'live-streamed'],
        noun: ['traffic cone', 'regional pie', 'wheelie bin', 'karaoke machine', 'ceremonial sword',
               'trampoline', 'filing cabinet', 'ice sculpture', 'novelty mug', 'lawnmower'],
        place: ['lift', 'car park', 'stationery cupboard', 'canteen', 'roundabout',
                'gents', 'loading bay', 'reception', 'fire escape', 'boardroom'],
        adverb: ['aggressively', 'tenderly', 'legally', 'twice', 'without warning',
                 'under oath', 'on expenses', 'in silence', 'at speed', 'reluctantly'],
        ingredient: ['cold potatoes', 'a full jar of capers', 'eleven eggs', 'leftover trifle',
                     'a swan', 'four litres of gravy', 'one very old lemon', 'a brick of feta'],
        side: ['a warm sausage roll', 'regret', 'more gravy', 'a small salad nobody wanted',
               'the good cutlery', 'a wet lettuce', 'chips, obviously'],
        thing: ['the incident at the Christmas party', 'what happened to the printer',
                'the group email', 'the state of the fridge', 'the fire drill',
                'the karaoke', 'my behaviour in the car park'],
        promise: ['never do it again', 'do it somewhere else next time', 'pay for the door',
                  'stop bringing it up', 'buy biscuits until March', 'seek help', 'get a receipt'],
        plural: ['Wheelie Bins', 'Fire Doors', 'Regional Managers', 'Damp Sundays',
                 'Motorway Services', 'Wet Lettuces', 'Interim Chief Execs'],
        exclaim: ['Frankly.', 'Again.', 'Allegedly.', 'As usual.', 'On a Tuesday.',
                  'In this economy.', 'With the lights on.', 'And nobody said anything.'],
    };

    const TEMPLATES = [
        {
            id: 'headline',
            name: 'The company announcement',
            blurb: 'A sentence about somebody senior, assembled by people who cannot see it.',
            parts: [
                'Our ', { k: 'adj' }, ' chief executive ', { k: 'verb' },
                ' a ', { k: 'noun' }, ' in the ', { k: 'place' }, '.',
            ],
            extra: ['exclaim', 'adverb'],
        },
        {
            id: 'recipe',
            name: 'A recipe nobody should follow',
            blurb: 'Eight people write one dish. None of them know what the others chose.',
            parts: [
                'Take ', { k: 'ingredient' }, ' and ', { k: 'verb' }, ' them ', { k: 'adverb' },
                '. Serve in the ', { k: 'place' }, ' with ', { k: 'side' }, '.',
            ],
            extra: ['exclaim', 'ingredient'],
        },
        {
            id: 'apology',
            name: 'A public apology',
            blurb: 'Sincere, heartfelt, and written by a committee that has never met.',
            parts: [
                'I would like to apologise for ', { k: 'thing' }, '. It was ', { k: 'adverb' },
                ' ', { k: 'adj' }, ', and I promise to ', { k: 'promise' }, '.',
            ],
            extra: ['exclaim', 'adverb'],
        },
        {
            id: 'band',
            name: 'Tonight on stage',
            blurb: 'A support act you would absolutely go and see.',
            parts: [
                'Please welcome ', { k: 'adj' }, ' ', { k: 'noun' },
                ' and the ', { k: 'plural' }, ', live from the ', { k: 'place' }, '.',
            ],
            extra: ['exclaim', 'adverb'],
        },
    ];

    /** Three options for one slot, never repeating within the slot. */
    function optionsFor(kind) {
        const pool = WORDS[kind] || WORDS.noun;
        const picked = [];
        const seen = new Set();
        while (picked.length < 3 && seen.size < pool.length) {
            const w = pool[Math.floor(Math.random() * pool.length)];
            if (seen.has(w)) continue;
            seen.add(w);
            picked.push(w);
        }
        return picked;
    }

    const KIND_LABEL = {
        adj: 'a description', verb: 'a verb', noun: 'a thing', place: 'a place',
        adverb: 'how it happened', ingredient: 'an ingredient', side: 'what to serve with it',
        thing: 'the thing you are sorry for', promise: 'what you promise', plural: 'a band name',
        exclaim: 'a closing remark',
    };

    /**
     * Turn a template into the round: a parts list where every slot has an
     * index, a prompt and three options. `playerCount` grows the creation so
     * that nobody is left watching.
     */
    function buildRound(template, playerCount) {
        const parts = template.parts.map(p => (typeof p === 'string' ? p : { k: p.k }));
        let slotCount = parts.filter(p => typeof p !== 'string').length;

        let e = 0;
        while (slotCount < playerCount) {
            const kind = template.extra[e % template.extra.length];
            parts.push(' ');
            parts.push({ k: kind });
            slotCount++;
            e++;
        }

        let i = 0;
        const slots = [];
        parts.forEach(p => {
            if (typeof p === 'string') return;
            p.i = i;
            p.prompt = KIND_LABEL[p.k] || 'a word';
            p.options = optionsFor(p.k);
            p.value = null;
            slots.push(p);
            i++;
        });

        return { parts, slots };
    }

    window.ChorusTemplates = { TEMPLATES, WORDS, buildRound, optionsFor, KIND_LABEL };
})();
