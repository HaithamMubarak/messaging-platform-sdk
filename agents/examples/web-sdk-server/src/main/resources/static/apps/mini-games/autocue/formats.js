// ============================================================================
// Autocue — the formats.
//
// A format is a ninety-second scaffold: the line the speaker opens with, the
// prompts the audience is nudged with, and the filler lines that keep the
// speaker talking if the queue ever runs dry. That last list is not decoration
// — a speaker standing in silence is the one failure that ends the purchase,
// so every format must be able to limp along on its own.
// ============================================================================
(function () {
    'use strict';

    const FORMATS = [
        {
            id: 'toast',
            name: 'The best man\'s toast',
            blurb: 'Warm, sincere, and entirely out of the speaker\'s hands.',
            opening: 'I have known the groom for a very long time, and I want to say a few words.',
            prompts: [
                'A story that starts somewhere reasonable',
                'Something you have never told anyone',
                'A compliment that goes wrong halfway',
                'Advice for the marriage',
            ],
            scaffolds: [
                'And another thing.',
                'Where was I. Yes.',
                'Which brings me neatly to my next point.',
                'I was asked to keep this short.',
                'Anyway.',
            ],
        },
        {
            id: 'apology',
            name: 'The public apology',
            blurb: 'A full, unreserved apology for something the speaker has not been told about.',
            opening: 'I want to address what happened, properly, in front of everybody.',
            prompts: [
                'Name the thing you are sorry for',
                'Explain yourself, badly',
                'Blame something that cannot answer back',
                'Promise something specific',
            ],
            scaffolds: [
                'I take full responsibility.',
                'That is on me.',
                'I have reflected a great deal.',
                'Let me be clear.',
                'And I stand by that.',
            ],
        },
        {
            id: 'launch',
            name: 'The product launch',
            blurb: 'A confident keynote for a product nobody has described to the speaker.',
            opening: 'Thank you all for coming. Today we are announcing something I am genuinely proud of.',
            prompts: [
                'What the product does',
                'Who it is for',
                'A number that sounds impressive',
                'Why the competition should be worried',
            ],
            scaffolds: [
                'And that is just the beginning.',
                'Let me show you what I mean.',
                'This is the part I love.',
                'We have been working on this for years.',
                'One more thing.',
            ],
        },
        {
            id: 'eulogy',
            name: 'The eulogy for the stag',
            blurb: 'A moving farewell to the man he used to be.',
            opening: 'We are gathered here to remember him as he was, before all this.',
            prompts: [
                'What he was like before',
                'The last time you saw the old him',
                'What he will not be doing any more',
                'What he leaves behind',
            ],
            scaffolds: [
                'He would have wanted that.',
                'We all knew this day was coming.',
                'Let us take a moment.',
                'He was, in many ways, ordinary.',
                'Rest easy.',
            ],
        },
    ];

    window.AutocueFormats = { FORMATS };
})();
