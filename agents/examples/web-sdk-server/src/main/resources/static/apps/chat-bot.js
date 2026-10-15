/**
 * What the chat companion says back.
 *
 * Pure: a message in, a reply out (or nothing), no connection and no page.
 * chat-extras.js runs it on a real second connection in the tab; this file
 * only decides, so it is tested without a browser
 * (src/test/js/chat-bot.test.js). `rng` is injectable for the tests.
 *
 * It is small on purpose. It answers a handful of commands, says hello,
 * answers a question like a magic 8-ball, and otherwise reacts to what you
 * said, which is enough to show a room where somebody else is typing,
 * replying and reacting, before anybody else has arrived.
 */
(function (root) {
    'use strict';

    const NAME = 'Companion';
    const ANSWERS = ['Yes, definitely.', 'Ask me again after coffee.', 'Signs point to yes.',
        'I would not count on it.', 'Without a doubt.', 'Hard to say from inside a browser tab.',
        'Probably!', 'My sources say no.'];

    const HELP = 'I am a second connection in this tab, so everything you see me do went through the ' +
        'platform for real. Try /roll, /roll 20, /flip or /time, ask me a question, or just say something.';

    function pick(list, rng) { return list[Math.floor((rng || Math.random)() * list.length) % list.length]; }

    function roll(arg, rng) {
        const sides = Math.min(1000, Math.max(2, parseInt(arg, 10) || 6));
        const n = 1 + Math.floor((rng || Math.random)() * sides);
        return { text: `🎲 You rolled ${n} (1–${sides}).` };
    }

    function command(cmd, arg, opts) {
        switch (cmd) {
            case '/help': return { text: HELP };
            case '/roll': return roll(arg, opts.rng);
            case '/flip': return { text: '🪙 ' + ((opts.rng || Math.random)() < 0.5 ? 'Heads.' : 'Tails.') };
            case '/time': {
                const d = opts.now ? new Date(opts.now) : new Date();
                return { text: '🕒 It is ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' here.' };
            }
            default: return { text: 'I do not know ' + cmd + '. ' + HELP };
        }
    }

    /** An emoji that fits what was said, for a reaction instead of a reply. */
    function mood(text) {
        if (/\b(love|thanks?|thank you|great|nice|cool)\b|❤|♥/i.test(text)) return '❤️';
        if (/\b(haha|lol|lmao|funny)\b|😂|🤣/i.test(text)) return '😂';
        if (/\b(yay|done|shipped|won|win)\b|🎉/i.test(text)) return '🎉';
        return '👍';
    }

    /**
     * The companion's answer to `text` from `from`: { text } to say something,
     * { react } to react to the message, or null to stay quiet (its own lines).
     */
    function reply(text, from, opts) {
        const o = opts || {};
        const said = String(text || '').trim();
        // Any companion, this tab's or someone else's: two must never talk forever.
        if (!said || String(from || '').indexOf(NAME) === 0) return null;
        const m = said.match(/^(\/[a-z]+)\s*(.*)$/i);
        if (m) return command(m[1].toLowerCase(), m[2], o);
        if (/^(hi|hello|hey|hiya|yo|good (morning|afternoon|evening))\b/i.test(said)) {
            return { text: `Hi ${from}! 👋 ${HELP}` };
        }
        if (/\?\s*$/.test(said)) return { text: '🎱 ' + pick(ANSWERS, o.rng) };
        return { react: mood(said) };
    }

    const ChatBot = { reply, mood, NAME, HELP };
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatBot;
    else root.ChatBot = ChatBot;
})(typeof window !== 'undefined' ? window : this);
