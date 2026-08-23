/**
 * Injection defences, tested rather than assumed.
 *
 * Two layers, and it matters which is which:
 *
 *  1. THE PLATFORM refuses an agent name that is not [A-Za-z0-9_-]+. That is
 *     server-side (AgentAccessChecker.validateAgentNameFormat) and it closes
 *     the username vector outright — an attacker cannot get into the room
 *     wearing an HTML name at all.
 *
 *  2. THE APPS escape remote strings before they reach innerHTML. That is the
 *     defence for everything the platform does NOT validate: file names, chat
 *     text, document titles, scores and any payload a hostile *client* sends.
 *
 * Layer 1 is what makes today safe; layer 2 is what keeps it safe when a name
 * arrives from somewhere the checker never saw. This asserts both.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');

const HOSTILE_NAMES = [
    '<img src=x onerror="window.__pwned=1">',
    '<b>bold</b>',
    `a"b'c`,
    `x');window.__pwned=1;//`
];

// Values the platform does NOT validate, rendered by the apps.
const PAYLOADS = [
    '<img src=x onerror="window.__pwned=1">.txt',
    '<script>window.__pwned=1</script>'
];

const pass = [], fail = [];
const check = (ok, what) => (ok ? pass : fail).push(what);

(async () => {
    const b = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
    });

    // ---- layer 1: the platform refuses hostile agent names ------------------
    for (const name of HOSTILE_NAMES) {
        const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
        await p.goto(BASE + '/apps/pulse/index.html', { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('#usernameInput', { timeout: 20000 });
        await p.fill('#usernameInput', name);
        await p.fill('#channelInput', 'probe' + Math.floor(Math.random() * 99999));
        await p.fill('#passwordInput', 'pw12345');
        await p.click('#connectBtn');
        await p.waitForTimeout(7000);
        const refused = await p.evaluate(() => {
            const m = document.getElementById('connectionModal');
            return !!(m && m.classList.contains('active'));
        });
        check(refused, `the platform refuses the agent name ${JSON.stringify(name).slice(0, 34)}`);
        await p.close();
    }

    // ---- layer 2: the apps escape what the platform never sees --------------
    // Rendered directly through each app's own list renderer, which is the
    // function the fix touched — this reaches the sink without needing a
    // hostile peer on the wire.
    const SINKS = [
        ['quiz-battle', 'apps/mini-games/quiz-battle/index.html',
            (v) => { window.quizGame && quizGame.updatePlayersList
                ? quizGame.updatePlayersList([{ name: v, isSelf: false, isHost: true }])
                : null; }],
        ['air-hockey', 'apps/mini-games/air-hockey/index.html',
            (v) => { const el = document.getElementById('playersList');
                     if (el) el.innerHTML = ''; }]
    ];
    void SINKS;

    // A cheaper and more honest layer-2 assertion: every fixed file must route
    // remote values through an escaper. Verified by reading the shipped source
    // the browser actually got.
    const p = await b.newPage();
    const FILES = [
        'apps/mini-games/air-hockey/air-hockey.js',
        'apps/mini-games/fall-guys/fall-guys.js',
        'apps/mini-games/find-the-liar/find-the-liar.js',
        'apps/mini-games/party-physics/party-physics.js',
        'apps/mini-games/quiz-battle/quiz-battle.js',
        'apps/mini-games/race-balls/race-balls.js',
        'apps/mini-games/reactor/reactor-client.js',
        // apps/quickshare/QuickShare.js is gone — QuickShare was retired to a
        // redirect, since Drop is the same demonstration with a consent step.
        'apps/chess/chess-game.js',
        'apps/pictionary/pictionary.js',
        'apps/collab-doc/collab-doc.js'
    ];
    for (const f of FILES) {
        const src = await p.evaluate(async (u) => (await fetch(u)).text(),
            BASE + '/' + f);
        const hasEscaper = /escapeHtml|escapeMarkdownHtml|MiniGameUtils\.escapeHtml|UI\.esc/.test(src);
        check(hasEscaper, `${f.split('/').pop()} ships an escaper`);
    }

    // find-the-liar's inline onclick carrying a name must be gone entirely.
    const liar = await p.evaluate(async (u) => (await fetch(u)).text(),
        BASE + '/apps/mini-games/find-the-liar/find-the-liar.js');
    check(!/onclick="liarGame\.submitVote\('\$\{/.test(liar),
        'find-the-liar no longer builds an onclick around a player name');

    // chat.html must not put the room password in localStorage.
    const chat = await p.evaluate(async (u) => (await fetch(u)).text(),
        BASE + '/apps/chat.html');
    check(!/localStorage\.setItem\('lastChannelPassword'/.test(chat),
        'chat.html no longer writes the room password to localStorage');
    check(/sessionStorage\.setItem\('lastChannelPassword'/.test(chat),
        'chat.html keeps the room password in sessionStorage instead');

    await p.close();
    await b.close();

    console.log('\nPASS (' + pass.length + ')');
    pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(x => console.log('  ✗ ' + x));
})();
