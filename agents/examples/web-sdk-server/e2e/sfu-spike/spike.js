/*
 * SFU spike — does the relay carry a frame, and what does each viewer cost?
 *
 * The question this answers is not "is there an SFU". There is: 13 relay
 * agents have been alive for weeks. It is whether any of them has ever moved
 * a pixel — /api/stats says sourceStreams: 0 everywhere — and if it can,
 * whether it FORWARDS (cost flat per viewer, ceiling is bandwidth) or
 * TRANSCODES (cost linear per viewer, ceiling is single digits).
 *
 *     xvfb-run -a node spike.js [viewers]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const DIR = __dirname;
const PORT = 8177;
const VIEWERS = parseInt(process.argv[2] || '3', 10);
const API = process.env.SPIKE_API
    || 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service';
const SFU = process.env.SPIKE_SFU || 'http://127.0.0.1:3000';
const CHANNEL = 'spike-' + Date.now().toString(36);
const PASSWORD = 'spike-' + Math.random().toString(36).slice(2, 10);

function serve() {
    return new Promise((res) => {
        const s = http.createServer((rq, rs) => {
            const f = path.join(DIR, rq.url === '/' ? 'spike.html' : rq.url.split('?')[0]);
            fs.readFile(f, (e, b) => {
                if (e) { rs.writeHead(404); return rs.end(); }
                rs.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'application/javascript' });
                rs.end(b);
            });
        });
        s.listen(PORT, () => res(s));
    });
}

const get = (url) => new Promise((res, rej) => {
    require(url.startsWith('https') ? 'https' : 'http').get(url, (r) => {
        let b = ''; r.on('data', (d) => b += d); r.on('end', () => res(b));
    }).on('error', rej);
});

/** SFU process CPU, as a share of one core, sampled over a window. */
function cpuSample(seconds) {
    const read = () => {
        const out = execSync(
            "docker stats --no-stream --format '{{.CPUPerc}}' webrtc-sfu-nodejs 2>/dev/null || echo 0%"
        ).toString().trim();
        return parseFloat(out) || 0;
    };
    const taken = [];
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) taken.push(read());
    taken.sort((a, b) => a - b);
    return { median: taken[Math.floor(taken.length / 2)] || 0, samples: taken.length };
}

const pass = [], fail = [];
const check = (ok, what) => (ok ? pass : fail).push(what) && console.log((ok ? '  ✓ ' : '  ✗ ') + what);

(async () => {
    const srv = await serve();
    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
               '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });

    const open = async (agent, relay) => {
        const p = await (await browser.newContext({ permissions: [] })).newPage();
        p.on('console', (m) => { if (/error|fail/i.test(m.text())) console.log(`   [${agent}] ${m.text()}`); });
        await p.goto(`http://127.0.0.1:${PORT}/spike.html`, { waitUntil: 'domcontentloaded' });
        await p.evaluate((o) => window.SPIKE.join(o), {
            agent, channel: CHANNEL, password: PASSWORD, apiUrl: API,
            apiKey: process.env.SPIKE_KEY || '', relay: !!relay,
        });
        return p;
    };

    console.log(`channel ${CHANNEL}, ${VIEWERS} viewers, SFU at ${SFU}\n`);

    // The publisher creates the channel; the relay is provisioned by the
    // messaging service, which is why 13 of them already exist.
    // The relay is provisioned on CONNECT, and only when the connecting agent
    // asks for it — enableWebrtcRelay. Nothing in Rooms has ever set that flag,
    // which is the second half of why the media path is untested.
    const before = JSON.parse(await get(`${SFU}/api/stats`)).relays.map((r) => r.channelId);
    const pub = await open('publisher', true);
    const viewers = [];
    for (let i = 0; i < VIEWERS; i++) viewers.push(await open('viewer' + i));
    await pub.waitForTimeout(3000);

    /*
     * The relay does NOT appear in getActiveAgents: it is a system agent with
     * role webrtc-relay and the service filters those out of the roster. So
     * the relay for this channel is identified from the SFU's own stats — the
     * one that was not there before the publisher connected.
     */
    const now = JSON.parse(await get(`${SFU}/api/stats`)).relays.map((r) => r.channelId);
    const fresh = now.filter((c) => !before.includes(c));
    const channelId = fresh[fresh.length - 1];
    const relayAgent = channelId ? 'webrtc-relay-' + channelId : null;
    check(!!relayAgent, `connecting provisions a relay for the channel (${channelId || 'none'})`);
    if (!relayAgent) { report(); return; }

    const idle = cpuSample(4);
    const sid = await pub.evaluate((r) => window.SPIKE.publish(r), relayAgent);
    check(!!sid, `the publisher offered its stream to the relay (${sid})`);

    // Give the relay its 500ms track-collection delay plus negotiation.
    const t0 = Date.now();
    let arrived = 0;
    for (let waited = 0; waited < 60000 && arrived < viewers.length; waited += 1000) {
        await pub.waitForTimeout(1000);
        arrived = 0;
        for (const v of viewers) if ((await v.evaluate(() => window.SPIKE.painted())).ok) arrived++;
    }
    const latency = Date.now() - t0;

    if (arrived === 0) {
        console.log('\npublisher:');
        for (const r of await pub.evaluate(() => window.SPIKE.ice())) console.log('  ' + JSON.stringify(r));
        for (let i = 0; i < viewers.length; i++) {
            console.log('viewer' + i + ': painted=' + JSON.stringify(
                await viewers[i].evaluate(() => window.SPIKE.painted()))
                + ' streams=' + JSON.stringify(await viewers[i].evaluate(() => window.SPIKE.streams())));
            for (const r of await viewers[i].evaluate(() => window.SPIKE.ice())) console.log('  ' + JSON.stringify(r));
        }
    }

    const stats = JSON.parse(await get(`${SFU}/api/stats`));
    const mine = stats.relays.find((r) => r.channelId === channelId);
    console.log('\nrelay with media: ' + JSON.stringify(mine || null));

    check(arrived > 0, `a frame reaches a viewer through the relay (${arrived} of ${viewers.length})`);
    check(arrived === viewers.length,
        `every viewer gets one (${arrived}/${viewers.length}, first within ${Math.round(latency / 1000)}s)`);

    /*
     * Frame rate per viewer, over a window, while the CPU is also sampled.
     * A relay that is saturating does not stop delivering — it delivers a
     * slideshow, and every "did a frame arrive" check in this file would keep
     * passing right through the point where the product stops working.
     */
    const fBefore = [];
    for (const v of viewers) fBefore.push(await v.evaluate(() => window.SPIKE.frames()));
    const busy = cpuSample(6);
    const fAfter = [];
    for (const v of viewers) fAfter.push(await v.evaluate(() => window.SPIKE.frames()));
    const fps = fBefore.map((b, i) => {
        const a = fAfter[i];
        if (!b || !a || a.t <= b.t) return null;
        return +(((a.total - b.total) * 1000) / (a.t - b.t)).toFixed(1);
    }).filter((x) => x !== null);
    const meanFps = fps.length ? +(fps.reduce((s, x) => s + x, 0) / fps.length).toFixed(1) : 0;
    console.log(`\nframe rate per viewer: ${JSON.stringify(fps)}  (mean ${meanFps}/s)`);
    check(meanFps >= 10,
        `viewers are getting video, not a slideshow (mean ${meanFps} fps across ${fps.length})`);
    const perViewer = arrived ? (busy.median - idle.median) / arrived : 0;
    console.log(`\nSFU CPU: idle ${idle.median}% → ${busy.median}% with ${arrived} viewers`);
    console.log(`         ${perViewer.toFixed(1)}% of a core per viewer`);
    console.log(perViewer > 10
        ? '         → that is TRANSCODING territory; the ceiling is single digits.'
        : '         → flat enough to look like forwarding; the ceiling is bandwidth.');

    // A late viewer must also get video — _onAgentConnect claims to share
    // existing streams, and that claim has never been exercised.
    const late = await open('late');
    let lateOk = false;
    for (let i = 0; i < 20 && !lateOk; i++) {
        await late.waitForTimeout(1000);
        lateOk = (await late.evaluate(() => window.SPIKE.painted())).ok;
    }
    check(lateOk, 'a viewer who arrives after the stream started still gets it');

    report();

    function report() {
        console.log(`\nPASS ${pass.length}  FAIL ${fail.length}`);
        browser.close(); srv.close();
        process.exit(fail.length ? 1 : 0);
    }
})().catch((e) => { console.error('CRASHED', e); process.exit(2); });
