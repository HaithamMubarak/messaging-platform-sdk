/**
 * CoShell, three people: a shared terminal obeys its owner, and only its owner.
 *
 * Hal joins first (the room host, who relays every guest's broadcast), then
 * Ola, who owns a shared terminal, then Vic, who may only watch. Hal has write
 * on Ola's terminal; Vic does not.
 *  - Hal's keystrokes reach Ola's shell (the control). Vic's, broadcast to the
 *    room, reach Ola FROM Hal through the relay; Ola used to credit them to
 *    Hal and run them (guidelines §6.68: senderOf(peerId, data)).
 *  - The same for a file write request.
 *  - Vic re-announcing Ola's session id, saying it was unshared or that its
 *    owner left, or changing its permission, changes nothing anywhere: only the
 *    owner speaks for a session. Each forgery is bracketed by output from Ola
 *    that must arrive after it. (On production a forged unshare, relayed to
 *    Ola, closed Ola's own terminal.)
 *  - Ola granting Vic write lets Vic type, and nobody else: approval used to
 *    flip the whole session to read-write on every viewer's screen while
 *    Ola's own gate still refused Vic.
 *  - A burst of viewer-joins is not answered with a burst of 64 KB replays.
 *
 * There is no local shell service on a test box, so Ola's shell is a stub
 * (the session's dataSender): the suite asserts on what reached it. Pages run
 * with ?test (viewer mode, no local service).
 *
 * Channels are 'tmt<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^tmt[0-9]+' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const ROOM = 'tmt' + Math.floor(Date.now() / 1000);
const SID = 'tmt-session-1';
const NAMES = { host: 'Hal' + ROOM.slice(-4), owner: 'Ola' + ROOM.slice(-4), viewer: 'Vic' + ROOM.slice(-4) };

const run = (p, fn, arg) => p.evaluate(fn, arg);
async function waitFor(p, fn, arg, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await p.evaluate(fn, arg)) return true; await sleep(200); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1200, height: 820 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/terminal/app.html?test', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof connectToCloud === 'function', null, { timeout: 25000 });
    await p.evaluate(({ room, name }) => {
        document.getElementById('cloudChannelName').value = room;
        document.getElementById('cloudChannelPassword').value = 'pw12345';
        document.getElementById('cloudAgentName').value = name;
        connectToCloud();
    }, { room: ROOM, name });
    const ok = await waitFor(p, () => !!(window.terminalSharing && window.terminalSharing.connected), null, 30000);
    if (!ok) throw new Error(name + ' never connected to ' + ROOM);
    // Every output a page's sharing layer hands up, for brackets.
    await p.evaluate(() => {
        window.__out = [];
        const inner = terminalSharing.onSessionOutput;
        terminalSharing.onSessionOutput = (sid, data, src) => { window.__out.push(data); if (inner) inner(sid, data, src); };
    });
    return p;
}

/** Ola's terminal: a stub shell that records what it is told to run. */
async function ownerShares(ola, names) {
    return run(ola, ({ sid, names }) => {
        window.__shell = [];
        window.__fsAnswers = [];
        const realAnswer = terminalSharing.sendFileSystemResponse.bind(terminalSharing);
        terminalSharing.sendFileSystemResponse = (s, id, data, to) => { window.__fsAnswers.push({ id, to, data }); return realAnswer(s, id, data, to); };
        sessions.set(sid, { isShared: true, owner: null, name: 'trust', type: 'local', config: { shell: 'bash' },
            dataSender: { type: 'stub', isReady: true, send: (d) => window.__shell.push(d), close() {} },
            permission: 'readonly', agentPermissions: { [names.host]: 'readwrite' } });
        return terminalSharing.shareSession(sid, { name: 'trust', shell: 'bash', type: 'local', permission: 'readonly' });
    }, { sid: SID, names });
}

let marks = 0;
/** Ola prints a line; it must reach both others. Anything sent before it has had its chance. */
async function bracket(ola, others) {
    const mark = 'mark-' + (++marks);
    await run(ola, ({ sid, mark }) => terminalSharing.sendOutputFromSession(sid, mark + '\r\n'), { sid: SID, mark });
    let landed = true;
    for (const p of others) landed = (await waitFor(p, (m) => window.__out.some((d) => d.includes(m)), mark, 10000)) && landed;
    r.check(landed, `bracket: Ola's ${mark} reaches Hal and Vic`);
}

const shellGot = (ola, text) => run(ola, (t) => window.__shell.some((d) => d.includes(t)), text);
const shared = (p) => run(p, (sid) => { const s = terminalSharing.sharedSessions.get(sid); return s ? { owner: s.owner, permission: s.permission } : null; }, SID);

async function keystrokes(hal, ola, vic) {
    await run(vic, (sid) => terminalSharing.sendData({ type: 'session-input', sessionId: sid, data: 'vic-relayed\r' }), SID);
    await run(vic, ({ sid, owner }) => terminalSharing.sendData({ type: 'session-input', sessionId: sid, data: 'vic-direct\r' }, owner), { sid: SID, owner: NAMES.owner });
    await run(hal, ({ sid, owner }) => terminalSharing.sendInputToSession(sid, 'hal-real\r', owner), { sid: SID, owner: NAMES.owner });
    r.check(await waitFor(ola, () => window.__shell.some((d) => d.includes('hal-real')), null, 10000),
        "control: Hal (write) types, and it reaches Ola's shell");
    await sleep(1500);
    r.check(!(await shellGot(ola, 'vic-direct')), "Vic's keystrokes sent straight to Ola do not run");
    r.check(!(await shellGot(ola, 'vic-relayed')), "Vic's keystrokes broadcast through Hal's relay do not run as Hal's");
    const noTarget = await run(vic, (sid) => terminalSharing.sendInputToSession(sid, 'vic-untargeted\r'), SID);
    r.check(noTarget === false, `input with no owner named is refused, not broadcast (${noTarget})`);
}

async function fileWrite(hal, ola, vic) {
    const req = (id) => ({ type: 'fs-request', sessionId: SID, operation: 'write', params: { path: 'x.txt', content: 'y' }, requestId: id });
    await run(vic, (m) => terminalSharing.sendData(m), req('vic-fs'));
    await run(hal, ({ m, owner }) => terminalSharing.sendData(m, owner), { m: req('hal-fs'), owner: NAMES.owner });
    await waitFor(ola, () => window.__fsAnswers.filter((a) => /fs$/.test(a.id)).length >= 2, null, 10000);
    const answers = await run(ola, () => window.__fsAnswers);
    const hal1 = answers.find((a) => a.id === 'hal-fs'), vic1 = answers.find((a) => a.id === 'vic-fs');
    r.check(!!hal1 && hal1.data.errorCode !== 'PERMISSION_DENIED', "control: Hal's file write passes Ola's permission gate");
    r.check(!!vic1 && vic1.data.errorCode === 'PERMISSION_DENIED' && vic1.to === NAMES.viewer,
        `Vic's relayed file write is refused, and answered to Vic (${vic1 && vic1.to}, ${vic1 && vic1.data.errorCode})`);
}

async function forgeries(hal, ola, vic) {
    const before = await shared(hal);
    r.check(!!before && before.owner === NAMES.owner, `Hal lists the session as Ola's (${before && before.owner})`);
    const onVic = await shared(vic);
    r.check(!!onVic && onVic.owner === NAMES.owner, `Vic, who hears Ola through the relay, lists it as Ola's (${onVic && onVic.owner})`);
    await run(vic, (sid) => {
        terminalSharing.sendData({ type: 'session-shared', sessionId: sid, sessionInfo: { name: 'evil', permission: 'readwrite' } });
        terminalSharing.sendData({ type: 'permission-update', sessionId: sid, permission: 'readwrite' });
    }, SID);
    await bracket(ola, [hal, vic]);
    const after = await shared(hal);
    r.check(!!after && after.owner === NAMES.owner, `Vic re-sharing Ola's id leaves Ola the owner on Hal's screen (${after && after.owner})`);
    r.check(!!after && after.permission === 'readonly', `Vic's permission-update leaves it read-only (${after && after.permission})`);
    await run(vic, (sid) => {
        terminalSharing.sendData({ type: 'session-unshared', sessionId: sid });
        terminalSharing.sendData({ type: 'owner-disconnect', sessionId: sid });
    }, SID);
    await bracket(ola, [hal, vic]);
    r.check(!!(await shared(hal)), "Vic saying Ola's session ended does not end it on Hal's screen");
    // Relayed to Ola too, where it used to close her own terminal and unshare it.
    r.check(await run(ola, (sid) => terminalSharing.sharedSessions.has(sid) && sessions.has(sid), SID),
        "nor on Ola's: her terminal stays open and shared");
}

async function grant(hal, ola, vic) {
    await run(vic, ({ sid, owner }) => terminalSharing.sendData({ type: 'permission-request', sessionId: sid }, owner), { sid: SID, owner: NAMES.owner });
    const asked = await waitFor(ola, () => !!document.querySelector('.permission-request-notification button'), null, 10000);
    r.check(asked, "Vic's request for write reaches Ola");
    if (!asked) return;
    await ola.click('.permission-request-notification button');            // the first button is Grant
    r.check(await waitFor(vic, (sid) => terminalSharing.getSessionPermission(sid) === 'readwrite', SID, 10000),
        'control: Vic is told he may write');
    await bracket(ola, [hal, vic]);
    const onHal = await shared(hal);
    r.check(!!onHal && onHal.permission === 'readonly', `granting Vic does not open the session on Hal's screen (${onHal && onHal.permission})`);
    const global = await run(ola, (sid) => sessions.get(sid).permission, SID);
    r.check(global === 'readonly', `Ola's own session stays read-only for everyone else (${global})`);
    await run(vic, ({ sid, owner }) => terminalSharing.sendInputToSession(sid, 'vic-granted\r', owner), { sid: SID, owner: NAMES.owner });
    r.check(await waitFor(ola, () => window.__shell.some((d) => d.includes('vic-granted')), null, 10000),
        "once granted, Vic's keystrokes reach Ola's shell");
}

async function joinBurst(ola, vic) {
    await run(ola, () => {
        window.__joins = 0;
        const inner = terminalSharing.onViewerJoin;
        terminalSharing.onViewerJoin = (sid, who) => { window.__joins++; if (inner) inner(sid, who); };
    });
    await run(vic, ({ sid, owner }) => { for (let i = 0; i < 10; i++) terminalSharing.sendData({ type: 'session-viewer-join', sessionId: sid }, owner); },
        { sid: SID, owner: NAMES.owner });
    await sleep(3000);
    const joins = await run(ola, () => window.__joins);
    r.check(joins >= 1, `control: a viewer-join is answered (${joins})`);
    r.check(joins <= 3, `ten viewer-joins in a burst are answered at most three times (${joins})`);
}

async function realUnshare(hal, ola, vic) {
    await run(ola, (sid) => terminalSharing.unshareSession(sid), SID);
    const gone = async (p) => waitFor(p, (sid) => !terminalSharing.sharedSessions.has(sid), SID, 10000);
    r.check((await gone(hal)) && (await gone(vic)), "control: Ola's real unshare ends the session for Hal and Vic");
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    console.log('room: ' + ROOM);
    try {
        const hal = await join(b, NAMES.host, errors);
        await sleep(3000);
        const ola = await join(b, NAMES.owner, errors);
        await sleep(3000);
        const vic = await join(b, NAMES.viewer, errors);
        await sleep(8000);                                          // data channels open
        const host = await run(vic, () => terminalSharing._getHostName());
        r.check(host === NAMES.host, `Hal is the room host (${host})`);
        r.check(await ownerShares(ola, NAMES) === true, 'Ola shares her terminal');
        await bracket(ola, [hal, vic]);
        await keystrokes(hal, ola, vic);
        await fileWrite(hal, ola, vic);
        await forgeries(hal, ola, vic);
        await grant(hal, ola, vic);
        await joinBurst(ola, vic);
        await realUnshare(hal, ola, vic);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    const real = errors.filter((e) => !/Failed to fetch|NetworkError|localhost:8088/.test(e));
    r.check(real.length === 0, 'no page errors ' + real.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
