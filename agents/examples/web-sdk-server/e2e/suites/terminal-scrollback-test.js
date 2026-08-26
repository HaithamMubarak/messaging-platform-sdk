/**
 * A viewer joining a shared terminal should see what is already on screen.
 *
 * They used to arrive at a blank window: output was only forwarded as it
 * happened, so unless somebody typed next there was nothing to look at and no
 * way to tell whether the share was even working.
 *
 * The full path (real shell -> SDK Local Service -> browser) cannot run here:
 * the helper on this machine predates the stream-ticket endpoint. So this
 * drives the sharing layer directly, which is where the scrollback lives.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
    const p = await b.newPage();
    p.on('pageerror', e => check(false, 'threw: ' + e.message.split('\n')[0].slice(0, 80)));

    await p.goto(BASE + '/apps/terminal/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);

    const result = await p.evaluate(() => {
        if (typeof TerminalSharing === 'undefined') return { error: 'TerminalSharing not loaded' };

        // A sharing instance with the transport stubbed: this test is about
        // what gets remembered and what gets sent, not about the channel.
        const sharing = Object.create(TerminalSharing.prototype);
        sharing.connected = true;
        sharing.sharedSessions = new Map([['s1', {}]]);
        sharing.viewers = new Map();
        const sent = [];
        sharing.sendData = (data, target) => { sent.push({ data, target }); return true; };
        sharing.addViewer = () => {};

        // Output happens before anybody is watching.
        sharing.sendOutputFromSession('s1', 'first line\r\n');
        sharing.sendOutputFromSession('s1', 'second line\r\n');
        const liveSends = sent.length;

        // Now a viewer arrives.
        sharing.handleSessionViewerJoin({ sessionId: 's1' }, 'Watcher');
        const replay = sent.slice(liveSends).find(m => m.data && m.data.replay);

        // And the cap holds for a long-running session.
        const big = 'x'.repeat(TerminalSharing.SCROLLBACK_LIMIT * 2);
        sharing.sendOutputFromSession('s1', big);
        const kept = sharing._scrollback.get('s1').length;

        // Unsharing forgets it.
        sharing.forgetScrollback('s1');
        const afterForget = sharing._scrollback.get('s1');

        return {
            replaySent: !!replay,
            replayTarget: replay ? replay.target : null,
            replayText: replay ? replay.data.data : '',
            kept,
            limit: TerminalSharing.SCROLLBACK_LIMIT,
            forgotten: afterForget === undefined
        };
    });

    if (result.error) {
        check(false, result.error);
    } else {
        check(result.replaySent, 'a joining viewer is sent the scrollback');
        check(result.replayTarget === 'Watcher',
            `addressed to that viewer alone, not the room (${result.replayTarget})`);
        check(/first line/.test(result.replayText) && /second line/.test(result.replayText),
            'and it contains what was printed before they arrived');
        check(result.kept === result.limit,
            `a long session is capped rather than growing without limit (${result.kept} = ${result.limit})`);
        check(result.forgotten, 'unsharing forgets the history');
    }

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
