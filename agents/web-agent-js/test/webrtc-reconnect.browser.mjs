/**
 * WebRtcHelper reconnects, in a real browser with real peer connections.
 *
 *     node test/webrtc-reconnect.browser.mjs
 *
 * Two helpers in one page, joined by a loopback signalling channel that can
 * be cut, delayed and re-pointed. Media is an animated canvas, so "the
 * picture arrives" is measured as frames decoded on the receiver, not as an
 * event having fired. Needs Playwright (resolved from the apps repo beside
 * this one, or PLAYWRIGHT_DIR) and Edge on Windows (PW_CHANNEL to change it).
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperFile = path.join(here, '..', 'js', 'web-agent.webrtc.js');
const require = createRequire(import.meta.url);
const pwDir = process.env.PLAYWRIGHT_DIR
    || path.resolve(here, '..', '..', '..', '..', 'messaging-platform-apps', 'node_modules', 'playwright');
const { chromium } = require(fs.existsSync(pwDir) ? pwDir : 'playwright');

const channel = process.env.PW_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ channel, headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
await page.setContent('<!doctype html><title>rtc</title>');
await page.addScriptTag({ path: helperFile });

// Harness inside the page: loopback channels, a canvas camera, frame counting.
await page.evaluate(() => {
    console.log = () => {}; console.warn = () => {};
    let online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    window.setOnline = (v) => { online = v; window.dispatchEvent(new Event(v ? 'online' : 'offline')); };
    // A phone suspending and resuming the tab, and switching networks.
    let visible = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible });
    window.setVisible = (v) => { visible = v ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };
    window.netChange = () => {
        if (!navigator.connection) throw new Error('navigator.connection missing in this browser');
        navigator.connection.dispatchEvent(new Event('change'));
    };
    window.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Count the restarts a helper starts, letting each one run for real.
    window.countRecovers = (h) => {
        const calls = [], real = Object.getPrototypeOf(h)._recover;
        h._recover = function (id, opts) { calls.push(id); return real.call(this, id, opts); };
        return { calls, done: () => { delete h._recover; } };
    };
    // How a resumed phone finds a connection: not connected, nothing fired yet.
    window.fakeState = (pc, state) => Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => state });

    const helpers = {};
    window.cut = new Set();          // agent names whose outgoing signalling is dropped
    window.sent = [];                // every signalling message, for assertions
    function channelFor(name) {
        return {
            agentName: name, readyState: true,
            sendWebRtcSignaling(msg, to) {
                window.sent.push({ from: name, to, type: msg.type, renegotiate: !!msg.renegotiate, reason: msg.reason });
                if (window.cut.has(name)) return;
                const copy = JSON.parse(JSON.stringify(msg));
                setTimeout(() => {
                    const target = helpers[to];
                    if (target) target.channel.onWebRtcSignaling({ streamId: copy.streamSessionId, sourceAgent: name, signalingMsg: copy });
                }, 5);
            }
        };
    }
    window.makeHelper = (name) => {
        const h = new WebRtcHelper(channelFor(name));
        Object.assign(h.reconnect, { disconnectedGraceMs: 300, attemptTimeoutMs: 4000, offlinePollMs: 200, answererGiveUpMs: 1500 });
        h.log = [];
        ['stream-reconnecting', 'stream-recovered', 'stream-failed', 'stream-closed', 'remote-stream',
         'datachannel-open', 'datachannel-close', 'datachannel-message'].forEach((ev) =>
            h.on(ev, (...args) => h.log.push([ev, ...args.map((a) => (typeof a === 'string' || typeof a === 'number') ? a : null)])));
        h.on('remote-stream', (sid, stream) => { h.lastRemote = stream; });
        helpers[name] = h;
        return h;
    };
    window.helpers = helpers;
    window.canvasStream = (hue) => {
        const c = document.createElement('canvas'); c.width = 160; c.height = 120;
        const ctx = c.getContext('2d'); let n = 0;
        setInterval(() => { ctx.fillStyle = `hsl(${hue + (n++ % 60)},80%,50%)`; ctx.fillRect(0, 0, 160, 120); }, 30);
        return c.captureStream(20);
    };
    window.framesDecoded = async (h, sid) => {
        const pc = h.peerConnections.get(sid); if (!pc) return -1;
        let n = 0; (await pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') n += r.framesDecoded || 0; });
        return n;
    };
    window.waitFor = (fn, ms = 10000) => new Promise((resolve, reject) => {
        const t0 = Date.now();
        (async function poll() {
            try { if (await fn()) return resolve(true); } catch (_) { /* keep polling */ }
            if (Date.now() - t0 > ms) return reject(new Error('timed out'));
            setTimeout(poll, 100);
        })();
    });
    // Frames are flowing to `h` on `sid` if the decoded count rises over a second.
    window.flowing = async (h, sid) => {
        await waitFor(async () => (await framesDecoded(h, sid)) > 0);
        const a = await framesDecoded(h, sid);
        await new Promise((r) => setTimeout(r, 1000));
        return (await framesDecoded(h, sid)) > a;
    };
});

let failed = 0;
async function check(name, fn) {
    try { await page.evaluate(fn); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message.split('\n')[0]); }
}

await check('an offer connects and the picture arrives', async () => {
    const a = makeHelper('alice'), b = makeHelper('bob');
    window.cam = canvasStream(0);
    window.sid = await a.createStreamOffer('bob', { stream: cam });
    await waitFor(() => b.peerConnections.get(sid) && b.peerConnections.get(sid).connectionState === 'connected');
    if (!(await flowing(b, sid))) throw new Error('no frames decoded');
});

await check('replaceStream swaps camera for screen in place, and leaves the camera running', async () => {
    const a = helpers.alice, b = helpers.bob, pcA = a.peerConnections.get(sid), pcB = b.peerConnections.get(sid);
    const offersBefore = sent.filter((m) => m.type === 'offer').length;
    window.screen2 = canvasStream(200);
    if (!(await a.replaceStream(sid, screen2))) throw new Error('not replaced in place');
    if (a.peerConnections.get(sid) !== pcA || b.peerConnections.get(sid) !== pcB) throw new Error('connection changed');
    if (sent.filter((m) => m.type === 'offer').length !== offersBefore) throw new Error('it renegotiated');
    if (cam.getVideoTracks()[0].readyState !== 'live') throw new Error('the camera was stopped');
    if (!(await flowing(b, sid))) throw new Error('no frames after the swap');
});

await check('an audio-only call turning video on renegotiates the SAME connection, and the picture arrives', async () => {
    const a = helpers.alice, b = helpers.bob;
    const ac = new AudioContext(), dest = ac.createMediaStreamDestination(); ac.createOscillator().connect(dest);
    const sid2 = await a.createStreamOffer('bob', { stream: dest.stream });
    await waitFor(() => b.peerConnections.get(sid2) && b.peerConnections.get(sid2).connectionState === 'connected');
    const pcA = a.peerConnections.get(sid2), pcB = b.peerConnections.get(sid2);
    const video = canvasStream(90);
    dest.stream.getAudioTracks().forEach((t) => video.addTrack(t));
    if (!(await a.replaceStream(sid2, video))) throw new Error('refused');
    if (!(await flowing(b, sid2))) throw new Error('no frames after the renegotiation');
    if (a.peerConnections.get(sid2) !== pcA || b.peerConnections.get(sid2) !== pcB) throw new Error('a connection was rebuilt');
    if (!sent.some((m) => m.type === 'offer' && m.renegotiate && m.from === 'alice')) throw new Error('no renegotiate offer');
    a.closeStream(sid2);
});

await check('an answerer with nothing on starts sharing: it asks, the offerer renegotiates, the screen arrives', async () => {
    const a = makeHelper('ivan'), b = makeHelper('judy');
    const s = await a.createStreamOffer('judy', { stream: canvasStream(10) });
    await waitFor(() => b.peerConnections.get(s) && b.peerConnections.get(s).connectionState === 'connected');
    if (!(await b.replaceStream(s, canvasStream(240)))) throw new Error('refused');
    await waitFor(() => sent.some((m) => m.type === 'renegotiate' && m.from === 'judy'), 3000);
    if (!(await flowing(a, s))) throw new Error("the offerer never got the answerer's screen");
    a.closeStream(s);
});

await check('the ANSWERING side swaps its camera for its screen in place too', async () => {
    const a = makeHelper('gina'), b = makeHelper('hank');
    b.setLocalMediaStream(canvasStream(120));
    const s = await a.createStreamOffer('hank', { stream: canvasStream(10) });
    await waitFor(() => a.peerConnections.get(s) && a.peerConnections.get(s).connectionState === 'connected');
    if (!(await flowing(a, s))) throw new Error('answerer media never arrived');
    if (!(await b.replaceStream(s, canvasStream(300)))) throw new Error('not replaced in place');
    if (!(await flowing(a, s))) throw new Error('no frames after the answerer swapped');
    a.closeStream(s);
});

await check('restartStream: an ICE restart on the same connections, and the picture keeps coming', async () => {
    const a = helpers.alice, b = helpers.bob, pcA = a.peerConnections.get(sid), pcB = b.peerConnections.get(sid);
    a.restartStream(sid);
    await waitFor(() => a.log.some((e) => e[0] === 'stream-recovered' && e[1] === sid));
    const restart = sent.filter((m) => m.type === 'offer' && m.renegotiate);
    if (!restart.length) throw new Error('no renegotiate offer was sent');
    if (a.peerConnections.get(sid) !== pcA || b.peerConnections.get(sid) !== pcB) throw new Error('a connection was rebuilt');
    if (!(await flowing(b, sid))) throw new Error('no frames after the restart');
});

await check('an ICE restart gathers with the CURRENT ice servers on both sides (minted TURN credentials expire)', async () => {
    const a = helpers.alice, b = helpers.bob;
    // Not in the helper's fallback list, so only a refresh can put it there.
    const fresh = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    a.channel.iceServers = fresh; b.channel.iceServers = fresh;
    const pcA = a.peerConnections.get(sid), pcB = b.peerConnections.get(sid);
    const recovered = a.log.filter((e) => e[0] === 'stream-recovered').length;
    a.restartStream(sid);
    await waitFor(() => a.log.filter((e) => e[0] === 'stream-recovered').length > recovered);
    for (const [who, h] of [['offerer', a], ['answerer', b]]) {
        const got = JSON.stringify(h.peerConnections.get(sid).getConfiguration().iceServers.map((s) => s.urls));
        if (!got.includes('stun.cloudflare')) throw new Error(`the ${who} restarted with ${got}`);
    }
    if (a.peerConnections.get(sid) !== pcA || b.peerConnections.get(sid) !== pcB) throw new Error('rebuilt, not restarted');
    delete a.channel.iceServers; delete b.channel.iceServers;
});

await check('the answerer reloaded (state gone): unknown-stream, then a new connection under the same id', async () => {
    const a = helpers.alice;
    const old = helpers.bob;
    old.channel.onWebRtcSignaling = () => {};
    old.peerConnections.forEach((pc) => pc.close());   // the tab died: no bye
    const b2 = makeHelper('bob');                      // ...and came back
    a.restartStream(sid);
    await waitFor(() => b2.peerConnections.get(sid) && b2.peerConnections.get(sid).connectionState === 'connected');
    if (!sent.some((m) => m.type === 'bye' && m.reason === 'unknown-stream')) throw new Error('no unknown-stream bye');
    if (!(await flowing(b2, sid))) throw new Error('no frames on the new connection');
});

await check('the peer vanishes without a word: the offerer notices on its own and reconnects', async () => {
    const a = helpers.alice;
    const old = helpers.bob;
    old.channel.onWebRtcSignaling = () => {};
    old.peerConnections.forEach((pc) => pc.close());
    const b3 = makeHelper('bob');
    await waitFor(() => b3.peerConnections.get(sid) && b3.peerConnections.get(sid).connectionState === 'connected', 25000);
    if (!(await flowing(b3, sid))) throw new Error('no frames after the automatic reconnect');
});

await check('offline: recovery waits without spending attempts, and coming back online reconnects at once', async () => {
    const a = helpers.alice, b = helpers.bob;
    const pcB = b.peerConnections.get(sid);
    const recovered = a.log.filter((e) => e[0] === 'stream-recovered').length;
    setOnline(false);
    const offers = sent.filter((m) => m.type === 'offer').length;
    a.restartStream(sid);
    await new Promise((r) => setTimeout(r, 1500));
    if (sent.filter((m) => m.type === 'offer').length !== offers) throw new Error('offered while offline');
    if (a.streamSessions.get(sid).attempts !== 0) throw new Error('spent an attempt while offline');
    if (b.peerConnections.get(sid) !== pcB) throw new Error('the answerer let go while it was the one offline');
    setOnline(true);
    await waitFor(() => a.log.filter((e) => e[0] === 'stream-recovered').length > recovered && a.peerConnections.get(sid).connectionState === 'connected');
    if (!(await flowing(b, sid))) throw new Error('no frames after coming back');
});

await check('a tab back in front restarts a stream that is not connected, once however many events fire', async () => {
    const a = helpers.alice, b = helpers.bob, pc = a.peerConnections.get(sid);
    const rec = countRecovers(a);
    try {
        setVisible(false); setVisible(true);
        await sleep(800);
        if (rec.calls.length) throw new Error('restarted a connected stream on resume');
        const recovered = a.log.filter((e) => e[0] === 'stream-recovered').length;
        fakeState(pc, 'disconnected');
        setVisible(false); setVisible(true);
        await sleep(800);
        if (rec.calls.length !== 1) throw new Error(`${rec.calls.length} restarts for coming back to the front`);
        // A real resume fires several at once: one restart, not one each.
        setVisible(false); setVisible(true); netChange(); window.dispatchEvent(new Event('online'));
        await sleep(800);
        delete pc.connectionState;
        if (rec.calls.length !== 2) throw new Error(`${rec.calls.length - 1} restarts for one burst of resume events`);
        await waitFor(() => a.log.filter((e) => e[0] === 'stream-recovered').length > recovered);
        if (!(await flowing(b, sid))) throw new Error('no frames after the resume');
    } finally { rec.done(); }
});

await check('a network change (wifi to mobile data) restarts it too; going to the background does not', async () => {
    const a = helpers.alice, pc = a.peerConnections.get(sid);
    const rec = countRecovers(a);
    try {
        fakeState(pc, 'disconnected');
        setVisible(false);
        await sleep(800);
        if (rec.calls.length) throw new Error('restarted when the tab was hidden');
        setVisible(true);   // back, but count only what the network change below starts
        await sleep(800);
        rec.calls.length = 0;
        netChange();
        await sleep(800);
        delete pc.connectionState;
        if (rec.calls.length !== 1) throw new Error(`${rec.calls.length} restarts for one network change`);
    } finally { rec.done(); }
    await waitFor(() => a.peerConnections.get(sid).connectionState === 'connected');
});

await check('signalling cut for good: bounded attempts, then stream-failed and everything released', async () => {
    const a = makeHelper('carol'), b = makeHelper('dave');
    Object.assign(a.reconnect, { attemptTimeoutMs: 800, maxAttempts: 2 });
    const s = await a.createStreamOffer('dave', { stream: canvasStream(30) });
    await waitFor(() => b.peerConnections.get(s) && b.peerConnections.get(s).connectionState === 'connected');
    cut.add('carol'); cut.add('dave');
    b.closeStream(s, { notify: false });               // dave is gone, and no word gets through
    await waitFor(() => a.log.some((e) => e[0] === 'stream-failed' && e[1] === s), 20000);
    const tries = a.log.filter((e) => e[0] === 'stream-reconnecting' && e[1] === s).length;
    if (tries !== 2) throw new Error('expected 2 attempts, saw ' + tries);
    if (a.peerConnections.has(s) || a.streamSessions.has(s) || a.localStreams.has(s)) throw new Error('state left behind');
    cut.clear();
});

await check('closeStream sends bye: the other side closes its end at once', async () => {
    const a = helpers.alice, b = helpers.bob;
    a.closeStream(sid);
    await waitFor(() => b.log.some((e) => e[0] === 'stream-closed' && e[1] === sid && e[3] === 'remote'), 3000);
    if (b.peerConnections.has(sid) || b.streamSessions.has(sid) || b.remoteStreams.has(sid)) throw new Error('answerer kept state');
    // After replaceStream the connection carries screen2: closing must not stop the caller's stream.
    if (screen2.getVideoTracks()[0].readyState !== 'live') throw new Error('closing stopped the caller\'s own stream');
});

await check('a data channel survives a rebuild: one open channel, no false close, messages flow', async () => {
    const a = makeHelper('erin'), b = makeHelper('frank');
    const s = await a.createStreamOffer('frank', { dataChannel: { name: 'd', options: { ordered: true } } });
    await waitFor(() => a.getActiveDataChannels().includes('frank') && b.getActiveDataChannels().includes('erin'));
    const oldA = a.dataChannels.get('frank');
    await a._recover(s, { fresh: true });
    await waitFor(() => a.dataChannels.get('frank') !== oldA && a.getActiveDataChannels().includes('frank')
        && b.getActiveDataChannels().includes('erin'));
    await new Promise((r) => setTimeout(r, 500));      // let the old channels' late close events land
    if (a.log.some((e) => e[0] === 'datachannel-close') || b.log.some((e) => e[0] === 'datachannel-close')) {
        throw new Error('a replaced channel was reported closed');
    }
    if (!a.sendData('frank', { hi: 1 })) throw new Error('send failed');
    await waitFor(() => b.log.some((e) => e[0] === 'datachannel-message'), 3000);
    if (b.peerConnections.size !== 1) throw new Error('answerer holds ' + b.peerConnections.size + ' connections');
});

await browser.close();
console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exitCode = failed ? 1 : 0;
