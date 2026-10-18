/**
 * Whiteboard, three people: what one person does to the board reaches the
 * other two exactly, and nobody can act as somebody else.
 *
 * Hana (the host), Bea and Cal, on real data channels:
 *  - Bea's line arrives on Cal's board stamped with Bea's name and one action
 *    id for the whole line, fast part and slow part alike;
 *  - Hana's undo takes ALL of her line off Bea's and Cal's boards (it used to
 *    leave the fast half of the line behind on every other screen);
 *  - Bea, claiming to be Hana, cannot undo Hana's work on Cal's board;
 *  - Cal, who drew nothing, loses the "Draw anything" hint once ink arrives;
 *  - a stroke is held to what the tools can make (real coordinates, the
 *    widest pen, the text tool's length); a cursor and a Clear carry their
 *    sender's name on the third screen;
 *  - Hana starts Guess the Doodle, Cal guesses right in the chat, and Hana's
 *    tab (the referee) announces it to the room.
 *
 * Channels are 'wbr<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^wbr[0-9]+' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const ROOM = 'wbr' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto(BASE + '/apps/whiteboard/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'typeof connected !== "undefined" && connected', 45000);
    await sleep(5000);
    return p;
}

/** A pen line with fast moves, so part of it goes out in the binary batch. */
async function line(p, fx, fy) {
    const box = await p.evaluate(() => { const r = document.getElementById('whiteboard').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await p.evaluate(() => setTool('draw'));
    const x = box.x + box.w * fx, y = box.y + box.h * fy;
    await p.mouse.move(x, y); await p.mouse.down();
    for (let i = 1; i <= 12; i++) { await p.mouse.move(x + i * 14, y + Math.sin(i) * 24); await sleep(20); }
    await p.mouse.up(); await sleep(500);
}

// Counted by the peer the transport named, which the old code set too: the owner
// stamp is part of the fix, and counting by it would read 0 over the old bug.
const inkBy = (p, who) => game(p, `boardState.filter((s) => s.peerId === ${JSON.stringify(who)}).length`);

async function strokesAndUndo(hana, bea, cal) {
    await line(bea, 0.3, 0.6);
    await sleep(2500);
    const beaOnCal = await game(cal, "({ n: boardState.filter((s) => s.peerId === 'Bea').length, owned: boardState.filter((s) => s.peerId === 'Bea').every((s) => s.by === 'Bea' && s.op), ops: new Set(boardState.filter((s) => s.peerId === 'Bea').map((s) => s.op)).size })");
    r.check(beaOnCal.n > 0 && beaOnCal.owned && beaOnCal.ops === 1,
        `Bea's line reaches Cal as one action, every stroke stamped hers (${JSON.stringify(beaOnCal)})`);
    r.check(await waitFor(cal, "document.getElementById('emptyHint').hidden", 3000), "Cal's empty-board hint goes once someone else's ink arrives");

    await line(hana, 0.3, 0.3);
    await sleep(2500);
    r.check((await inkBy(cal, 'Hana')) > 0, "control: Hana's line reaches Cal");
    await game(hana, 'triggerUndo()');
    await sleep(3000);
    for (const [p, who] of [[bea, 'Bea'], [cal, 'Cal']]) {
        const left = await inkBy(p, 'Hana');
        r.check(left === 0, `Hana's undo takes all of her line off ${who}'s board (${left} strokes left)`);
    }
}

async function forgedUndo(hana, bea, cal) {
    await line(hana, 0.5, 0.3);
    await sleep(2500);
    const before = await inkBy(cal, 'Hana');
    const op = await game(hana, "boardState.filter((s) => s.by === 'Hana').map((s) => s.op).pop()");
    await bea.evaluate((op) => whiteboardGame.sendData({ type: 'undo-redo-action', action: 'undo', commandId: op, sender: 'Hana', commandType: 'draw-strokes' }), op);
    await sleep(3000);
    const after = await inkBy(cal, 'Hana');
    r.check(before > 0 && after === before, `Bea cannot undo Hana's line on Cal's board by naming her (${before} -> ${after})`);
}

/**
 * Bea's cursor and Bea's Clear, seen from Cal's screen: each must carry Bea's
 * name. In p2p-host mode what a guest broadcasts can reach the other guests
 * through the host's connection, and a handler that names the connection
 * instead of the sender draws Bea's cursor as Hana's and says Hana cleared.
 */
async function cursorAndClear(hana, bea, cal) {
    await game(bea, "webrtcHelper.broadcastDataChannel({ type: 'cursor', x: 123, y: 45, color: '#e11d48' })");
    await sleep(2500);
    const cur = await game(cal, "Object.fromEntries([...whiteboardGame.remoteCursorTargets].map(([k, v]) => [k, Math.round(v.x)]))");
    r.check(cur.Bea === 123, `Bea's cursor reaches Cal's board under her name (${JSON.stringify(cur)})`);
    r.check(cur.Hana !== 123, "and is not drawn as Hana's");
    await cal.evaluate(() => { window.__toasts = []; const o = window.showToast; window.showToast = (m, t) => { window.__toasts.push(m); return o && o(m, t); }; });
    await game(bea, "sendWhiteboardEvent('clear', {})");
    await sleep(2500);
    const said = await game(cal, 'window.__toasts');
    r.check(said.some((m) => /^Bea cleared the board/.test(m)), `Cal is told Bea cleared the board (${JSON.stringify(said)})`);
}

/**
 * A stroke from someone else is their claim. Bea sends what no tool can make:
 * coordinates that are not numbers, a line 10 million px wide, a 200,000
 * character note. Cal's board keeps none of the first, and bounds the others
 * by what the tools allow (a 160 px font, 500 characters); a normal stroke
 * still lands as sent (the control).
 */
async function strokeClaims(bea, cal) {
    const send = (s) => bea.evaluate((s) => webrtcHelper.broadcastDataChannel({ type: 'stroke', stroke: s, op: 'op_claim_' + Math.random() }), s);
    await game(cal, 'window.__n0 = boardState.length');
    await send({ type: 'draw', x1: 'nope', y1: null, x2: {}, y2: [], color: '#000', size: 3, erase: false });
    await send({ type: 'draw', x1: 10, y1: 10, x2: 900, y2: 600, color: '#000', size: 1e7, erase: false });
    await send({ type: 'note', x1: 100, y1: 100, x2: 300, y2: 200, color: '#f59e0b', size: 20, text: 'x'.repeat(200000), erase: false });
    await send({ type: 'draw', x1: 20, y1: 20, x2: 60, y2: 60, color: '#2563eb', size: 4, erase: false });
    await sleep(3000);
    const got = await game(cal, "boardState.slice(window.__n0).map((s) => ({ ok: [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite), size: s.size, text: s.text ? s.text.length : null }))");
    r.check(got.every((s) => s.ok), `a stroke with no real coordinates is not kept on Cal's board (${JSON.stringify(got.map((s) => s.ok))})`);
    r.check(got.every((s) => s.size <= 160), `no stroke is wider than the widest tool (${got.map((s) => s.size).join(', ')})`);
    r.check(got.every((s) => s.text === null || s.text <= 500), `no note is longer than the text tool allows (${got.map((s) => s.text).filter((x) => x !== null).join(', ')})`);
    r.check(got.some((s) => s.size === 4), 'control: a normal stroke lands as sent');
}

async function guessTogether(hana, cal) {
    await game(hana, 'DoodleGame.start()');
    await sleep(1500);
    const name = await game(hana, 'DoodleGame.round.doodle.name');
    await waitFor(cal, "boardState.some((s) => s.peerId === 'Hana' && /^op_doodle_/.test(s.op || ''))", 6000);
    r.check(await game(cal, "boardState.some((s) => s.peerId === 'Hana' && /^op_doodle_/.test(s.op || ''))"), 'the doodle appears on Cal\'s board as it is drawn');
    await cal.evaluate((n) => { document.getElementById('chatInput').value = 'is it a ' + n + '?'; sendChat(); }, name);
    r.check(await waitFor(hana, "DoodleGame.round && DoodleGame.round.winner === 'Cal'", 8000), `Cal's guess in the chat wins on the referee's tab (${name})`);
    r.check(await waitFor(cal, "[...document.querySelectorAll('#chatMessages .chat-message')].some((m) => /Cal got it/.test(m.textContent))", 8000),
        'and the room is told who got it');
    await game(hana, 'DoodleGame.stop()');
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const hana = await join(b, 'Hana', errors);
        const bea = await join(b, 'Bea', errors);
        const cal = await join(b, 'Cal', errors);
        await sleep(3000);
        await strokesAndUndo(hana, bea, cal);
        await forgedUndo(hana, bea, cal);
        await strokeClaims(bea, cal);
        await cursorAndClear(hana, bea, cal);
        await guessTogether(hana, cal);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
