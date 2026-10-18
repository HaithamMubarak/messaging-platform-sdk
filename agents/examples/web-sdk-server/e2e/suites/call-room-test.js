/**
 * Call, three people: everyone sees everyone, reactions land on the right
 * tile, and the tile of whoever is talking glows.
 *
 * Each camera is an animated canvas of one colour with a tone for its
 * microphone (guidelines 6.20: not the browser's fake device), so a tile's
 * centre colour says exactly whose picture it is.
 *
 *  - Hana (host), Bea and Cal turn their cameras on; every one of them sees
 *    the other two, in the right colour. Before the fix the two guests never
 *    saw each other: each one's "camera on" reached the other through the
 *    host and was filed under the host's name;
 *  - Bea's reaction floats over Bea's tile on Cal's screen;
 *  - with Bea's microphone on, her tile glows on Cal's screen; muted, it stops.
 *  - over time: Dan, arriving after every camera is on, sees all three; Cal's
 *    camera off empties his tile everywhere; Bea closing her tab removes hers.
 *
 * Channels are 'clr<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^clr[0-9]+' --yes
 */
const { chromium } = require('playwright');
const { BASE, LAUNCH, results } = require('../lib/harness');
const { sleep, useChannelForm } = require('../lib/party-room');

const r = results();
const COLOURS = { Hana: [220, 40, 40], Bea: [40, 60, 220], Cal: [40, 200, 60], Dan: [230, 200, 40] };
const ROOM = 'clr' + Math.floor(Date.now() / 1000);
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(200); }
    return false;
}

/** Runs before the page: getUserMedia answers with a moving canvas of one colour and a tone. */
function canvasCamera(rgb) {
    navigator.mediaDevices.getUserMedia = async () => {
        const c = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
        const g = c.getContext('2d');
        let n = 0;
        setInterval(() => {
            g.fillStyle = `rgb(${rgb.join(',')})`;
            g.fillRect(0, 0, 320, 240);
            g.fillStyle = '#fff';
            g.fillRect((n++ * 8) % 320, 0, 6, 24);
        }, 66);
        const stream = c.captureStream(15);
        const ac = new AudioContext();
        const tone = ac.createOscillator();
        const sink = ac.createMediaStreamDestination();
        tone.connect(sink); tone.start();
        stream.addTrack(sink.stream.getAudioTracks()[0]);
        return stream;
    };
    // A shared screen is purple, whoever shares it, so a tile says which it shows.
    navigator.mediaDevices.getDisplayMedia = async () => {
        const c = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
        const g = c.getContext('2d');
        let n = 0;
        setInterval(() => { g.fillStyle = 'rgb(150, 40, 200)'; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.fillRect(0, (n++ * 8) % 240, 320, 6); }, 66);
        return c.captureStream(15);
    };
}
const SCREEN = [150, 40, 200];

/** Hana shares her screen: Cal's tile for her shows it, then her camera again when she stops. */
async function screenShare(P) {
    const watch = async (want, ms) => {
        let rgb = null; const t0 = Date.now();
        while (Date.now() - t0 < ms && !near(rgb, want)) { rgb = await centre(P.Cal, 'Hana'); await sleep(500); }
        return rgb;
    };
    await P.Hana.click('#screenBtn');
    const shared = await watch(SCREEN, 20000);
    r.check(near(shared, SCREEN), `Hana shares her screen, and Cal sees it in her tile (${JSON.stringify(shared)})`);
    r.check(await waitFor(P.Cal, `/sharing screen/.test(document.querySelector('.call-tile[data-name="Hana"] figcaption').textContent)`, 5000),
        "and her tile says she is sharing");
    await P.Hana.click('#screenBtn');
    const back = await watch(COLOURS.Hana, 20000);
    r.check(near(back, COLOURS.Hana), `she stops, and Cal sees her camera again (${JSON.stringify(back)})`);
}

async function join(b, name, errors) {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } });
    await ctx.addInitScript(canvasCamera, COLOURS[name]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(`${BASE}/apps/call/index.html`, { waitUntil: 'domcontentloaded' });
    await useChannelForm(p);
    await p.waitForSelector('#usernameInput', { state: 'attached', timeout: 30000 });
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.callApp && callApp.connected', 45000);
    return p;
}

/** The centre colour of `who`'s tile on this page, once it has frames. */
const centre = (p, who) => p.evaluate((who) => {
    const v = document.querySelector(`.call-tile[data-name="${who}"] video`);
    if (!v || !v.videoWidth) return null;
    const c = Object.assign(document.createElement('canvas'), { width: v.videoWidth, height: v.videoHeight });
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0);
    const d = g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return [d[0], d[1], d[2]];
}, who);
const near = (rgb, want) => !!rgb && rgb.every((v, i) => Math.abs(v - want[i]) < 60);

async function everyoneSeesEveryone(P) {
    const names = Object.keys(P);
    for (const n of names) { await P[n].click('#camBtn'); await sleep(1200); }
    for (const viewer of names) {
        for (const sender of names) {
            if (viewer === sender) continue;
            let rgb = null;
            const t0 = Date.now();
            while (Date.now() - t0 < 30000 && !near(rgb, COLOURS[sender])) { rgb = await centre(P[viewer], sender); await sleep(500); }
            r.check(near(rgb, COLOURS[sender]), `${viewer} sees ${sender}'s camera (${JSON.stringify(rgb)})`);
        }
    }
}

async function reactions(P) {
    await P.Bea.click('#reactions [data-react="👏"]');
    // Her own first: it shows at once, and fades in 2.4 s.
    r.check(await waitFor(P.Bea, `!!document.querySelector('.call-tile[data-name="Bea"] .call-react')`, 1000),
        'a reaction floats over your own tile');
    r.check(await waitFor(P.Cal, `!!document.querySelector('.call-tile[data-name="Bea"] .call-react')`, 5000),
        "and over Bea's tile on Cal's screen");
}

async function speaking(P) {
    // The tone is always playing: the microphone button decides whether it is heard.
    r.check(await waitFor(P.Cal, `document.querySelector('.call-tile[data-name="Bea"]').classList.contains('is-speaking')`, 8000),
        "with Bea's microphone on, her tile glows on Cal's screen");
    await P.Bea.click('#micBtn');
    r.check(await waitFor(P.Cal, `!document.querySelector('.call-tile[data-name="Bea"]').classList.contains('is-speaking')`, 8000),
        'muted, it stops');
}

/** Tile state for `who` on this page: missing, empty (no picture) or live. */
const tileOf = (p, who) => p.evaluate((who) => {
    const el = document.querySelector(`.call-tile[data-name="${who}"]`);
    return !el ? 'missing' : el.classList.contains('is-empty') ? 'empty' : 'live';
}, who);

/**
 * A call over time, not just at the start: Dan arrives after every camera is
 * on and must see all three; Cal's camera goes off and his tile empties on
 * every screen; Bea closes her tab and her tile goes from every screen.
 */
async function overTime(b, P, errors) {
    P.Dan = await join(b, 'Dan', errors);
    for (const sender of ['Hana', 'Bea', 'Cal']) {
        let rgb = null;
        const t0 = Date.now();
        while (Date.now() - t0 < 30000 && !near(rgb, COLOURS[sender])) { rgb = await centre(P.Dan, sender); await sleep(500); }
        r.check(near(rgb, COLOURS[sender]), `Dan, arriving late, sees ${sender}'s camera (${JSON.stringify(rgb)})`);
    }
    await P.Cal.click('#camBtn');
    for (const viewer of ['Hana', 'Dan']) {
        r.check(await waitFor(P[viewer], `(() => { const el = document.querySelector('.call-tile[data-name="Cal"]'); return !!el && el.classList.contains('is-empty'); })()`, 10000),
            `Cal turns his camera off and his tile empties on ${viewer}'s screen (${await tileOf(P[viewer], 'Cal')})`);
    }
    await P.Bea.close({ runBeforeUnload: true });
    delete P.Bea;
    for (const viewer of ['Hana', 'Cal', 'Dan']) {
        r.check(await waitFor(P[viewer], `!document.querySelector('.call-tile[data-name="Bea"]')`, 15000),
            `Bea closes her tab and her tile goes from ${viewer}'s screen (${await tileOf(P[viewer], 'Bea')})`);
    }
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    const P = {};
    try {
        for (const n of ['Hana', 'Bea', 'Cal']) { P[n] = await join(b, n, errors); await sleep(2500); }
        await sleep(2000);
        await everyoneSeesEveryone(P);
        await reactions(P);
        await speaking(P);
        await screenShare(P);
        await overTime(b, P, errors);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
