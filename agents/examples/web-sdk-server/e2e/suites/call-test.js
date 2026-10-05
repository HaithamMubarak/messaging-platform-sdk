/**
 * Call: two browsers, and each one sees the other's camera.
 *
 *     xvfb-run -a node suites/call-test.js
 *
 * The cameras are animated canvases, one red and one blue, with a tone for the
 * microphone, handed to the page as getUserMedia. Not the browser's fake
 * device: that track sometimes ENDS by itself about 1.4 s in, and a call test
 * then goes red with the app blameless (guidelines 6.20). A colour per person
 * also makes the claim exact: Alpha's tile on Beta's screen must be RED, so a
 * tile showing your own camera back to you cannot pass.
 *
 * The last section puts back the bug call.js warns about first: a stream
 * offered with {} negotiates nothing, and the camera shows in your own tab and
 * nowhere else. If the far side still gets pictures, this suite cannot see
 * that bug and proves nothing.
 */
const { chromium } = require('playwright');
const { BASE, SHOTS, LAUNCH, results } = require('../lib/harness');
const { sleep, waitFor, useChannelForm } = require('../lib/party-room');

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
    return ok;
}

const COLOURS = { Alpha: [220, 40, 40], Beta: [40, 60, 220] };

/** Runs before the page: getUserMedia answers with a moving canvas of one colour. */
function canvasCamera(rgb) {
    navigator.mediaDevices.getUserMedia = async () => {
        const c = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
        const g = c.getContext('2d');
        let n = 0;
        setInterval(() => {
            g.fillStyle = `rgb(${rgb.join(',')})`;
            g.fillRect(0, 0, 320, 240);
            g.fillStyle = '#fff';
            g.fillRect((n++ * 8) % 320, 0, 6, 24);   // movement, kept off the sampled centre
        }, 66);
        const stream = c.captureStream(15);
        const ac = new AudioContext();
        const tone = ac.createOscillator();
        const sink = ac.createMediaStreamDestination();
        tone.connect(sink); tone.start();
        stream.addTrack(sink.stream.getAudioTracks()[0]);
        return stream;
    };
}

async function join(browser, name, room) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    await ctx.addInitScript(canvasCamera, COLOURS[name]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    await page.goto(`${BASE}/apps/call/index.html`, { waitUntil: 'domcontentloaded' });
    await useChannelForm(page);
    await page.waitForSelector('#usernameInput', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => document.getElementById('tabCustom')?.click());
    await page.fill('#usernameInput', name);
    await page.fill('#channelInput', room);
    await page.fill('#passwordInput', 'pw12345');
    await page.click('#connectBtn');
    const connected = await waitFor(() => page.evaluate(() => !!(window.callApp && window.callApp.connected)),
        45000, `${name} to connect`);
    return { name, page, ctx, errors, connected };
}

/** What `viewer` shows in `sender`'s tile: frames decoded, and the centre colour. */
const tileOf = (viewer, sender) => viewer.page.evaluate((who) => {
    const v = document.querySelector(`.call-tile[data-name="${who}"] video`);
    if (!v || !v.videoWidth) return { frames: 0, rgb: null };
    const c = Object.assign(document.createElement('canvas'), { width: v.videoWidth, height: v.videoHeight });
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0);
    const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return { frames: v.getVideoPlaybackQuality().totalVideoFrames, rgb: [d[0], d[1], d[2]] };
}, sender.name);

const near = (rgb, want) => !!rgb && rgb.every((v, i) => Math.abs(v - want[i]) < 60);

async function pictureArrives(viewer, sender) {
    await waitFor(async () => (await tileOf(viewer, sender)).frames > 0, 30000, `${sender.name} on ${viewer.name}'s screen`);
    const first = await tileOf(viewer, sender);
    await sleep(2000);
    const later = await tileOf(viewer, sender);
    check(later.frames > first.frames, `${viewer.name} receives ${sender.name}'s camera, and it moves`,
        `${first.frames} -> ${later.frames} frames`);
    check(near(later.rgb, COLOURS[sender.name]), `and it is ${sender.name}'s picture, not their own`,
        JSON.stringify(later.rgb));
}

async function camerasOn(a, b) {
    for (const c of [a, b]) await c.page.click('#camBtn');
}

async function aRealCall(browser) {
    console.log('\n[1] two people, two cameras');
    const room = 'call-e2e-' + Math.random().toString(36).slice(2, 7);
    const a = await join(browser, 'Alpha', room), b = await join(browser, 'Beta', room);
    try {
        [a, b].forEach(c => check(c.connected, `${c.name} connected`));
        await waitFor(() => a.page.evaluate(() => window.callApp.peers().length === 1), 30000, 'the other person');
        await camerasOn(a, b);
        await pictureArrives(b, a);
        await pictureArrives(a, b);
        await a.page.screenshot({ path: SHOTS + '/call-alpha.png' });
        [a, b].forEach(c => check(c.errors.length === 0, `${c.name}'s page throws nothing`, c.errors[0] || 'clean'));
    } finally {
        await a.ctx.close(); await b.ctx.close();
    }
}

/** The bug: the stream left out of the offer. */
function offerWithoutTheStream() {
    const h = window.callApp.webrtcHelper;
    const orig = h.createStreamOffer.bind(h);
    h.createStreamOffer = (peer) => orig(peer, {});
}

async function theSuiteCanFail(browser) {
    console.log('\n[2] the same call with the stream left out of the offer');
    const room = 'call-e2e-' + Math.random().toString(36).slice(2, 7);
    const a = await join(browser, 'Alpha', room), b = await join(browser, 'Beta', room);
    try {
        await waitFor(() => a.page.evaluate(() => window.callApp.peers().length === 1), 30000, 'the other person');
        for (const c of [a, b]) await c.page.evaluate(offerWithoutTheStream);
        await camerasOn(a, b);
        await sleep(15000);
        const seen = await tileOf(b, a);
        check(seen.frames === 0, 'the broken offer shows nothing — so this suite can see that bug',
            seen.frames ? `${seen.frames} frames arrived anyway: this suite proves nothing` : 'no picture');
    } finally {
        await a.ctx.close(); await b.ctx.close();
    }
}

(async () => {
    console.log('\nCall E2E');
    const browser = await chromium.launch({ ...LAUNCH, args: [...LAUNCH.args, '--autoplay-policy=no-user-gesture-required'] });
    try {
        await aRealCall(browser);
        await theSuiteCanFail(browser);
    } catch (err) {
        console.error('\nTEST THREW:', err && err.stack || err);
        check(false, 'the suite ran to the end');
    } finally {
        await browser.close();
    }
    process.exitCode = R.report() === 0 ? 0 : 1;
})();
