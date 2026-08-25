#!/usr/bin/env node
/**
 * Can SponsorPulse hold a room the size it is sold for?
 *
 * The pitch is "a hundred people in a room scan a code and answer", so the
 * number that matters is whether a hundred concurrent attendees can connect,
 * answer, and have every answer reach the host — not how fast one browser is.
 *
 * A hundred real browsers is not a realistic harness, so this drives the SDK
 * directly: each attendee is an agent from the npm package, which is only
 * possible because the package can now be required from Node at all.
 *
 * It runs against a LOCAL messaging service. It deliberately takes the endpoint
 * as an argument with no default pointing anywhere shared: a load test is the
 * last thing that should find its way to a production deployment by accident.
 *
 *   node load/sponsorpulse-load.js http://127.0.0.1:8082/messaging-platform/api/v1/messaging-service [attendees]
 *
 * KNOWN FINDING, not yet fixed (measured here, reproducible):
 *
 *   Up to about ten attendees, everything is delivered. From roughly twenty-five
 *   upwards the host's auto-receive loop reports NOTHING while a single forced
 *   pull from offset zero immediately finds ~85% of the answers. The host is
 *   healthy at that moment — session valid, readyState true, poll timer
 *   scheduled — so the messages were never lost: its read cursor has advanced
 *   past where the answers landed, while a burst of join traffic was being
 *   written.
 *
 *   This is NOT caused by the offset handling changed in this branch: reverting
 *   that to the previous `||` form reproduces it exactly. It predates it.
 *
 *   It matters for this product specifically — a host tallying a busy room is
 *   the whole premise — so it belongs at the top of the SDK reliability list,
 *   not in the app.
 */
const path = require('path');

const API = process.argv[2];
const ATTENDEES = parseInt(process.argv[3] || '100', 10);
// Where to get a short-lived developer key, the same way the web app does.
const KEY_SOURCE = process.argv[4] || 'http://localhost:8084/app/api/config';

if (!API) {
    console.error('Refusing to run without an explicit local API endpoint.');
    console.error('Usage: node load/sponsorpulse-load.js <apiUrl> [attendees]');
    process.exit(2);
}
if (/hmdevonline\.com|https:\/\/(?!127|localhost)/.test(API)) {
    console.error('That endpoint looks like a shared deployment. This test only runs locally.');
    process.exit(2);
}

const sdk = require(path.join(__dirname, '..', '..', '..', '..', 'web-agent-js', 'index.js'));
const { AgentConnection } = sdk;

const ROOM = 'sp-load-' + Date.now().toString(36);
const KEY = 'load' + Math.random().toString(36).slice(2, 10);

const results = {
    connected: 0, failed: 0, answersSent: 0, answersSeenByHost: 0,
    connectMs: [], answerMs: [], failReasons: {}, hostErrors: {}
};

function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Fetch a temporary developer key, as the browser app does on load. */
function fetchApiKey() {
    return new Promise((resolve, reject) => {
        const url = new URL(KEY_SOURCE);
        const transport = url.protocol === 'https:' ? require('https') : require('http');
        const body = JSON.stringify({ ttlSeconds: 300 });
        const req = transport.request({
            method: 'POST', hostname: url.hostname, port: url.port,
            path: url.pathname,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).data.apiKey);
                } catch (e) {
                    reject(new Error('could not read an api key from ' + KEY_SOURCE));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function connect(agent, name, apiKey) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setTimeout(() => reject(new Error('timed out')), 45000);
        // The SDK dispatches `connect` for a REFUSED connection too, carrying
        // status: 'error' — so the event alone is not success. Reading it as
        // success is how an early version of this test reported 100% connected
        // while every agent had in fact been turned away.
        agent.addEventListener('connect', (ev) => {
            const response = ev && ev.response;
            if (response && response.status === 'error') {
                clearTimeout(timer);
                reject(new Error(response.statusMessage || 'refused'));
                return;
            }
            clearTimeout(timer);
            results.connectMs.push(Date.now() - started);
            resolve();
        });
        agent.addEventListener('error', (e) => {
            clearTimeout(timer);
            reject(new Error((e && e.message) || 'connect error'));
        });
        agent.connect({
            api: API, apiKey: apiKey || API_KEY, channelName: ROOM, channelPassword: KEY,
            agentName: name, autoReceive: true
        });
    });
}

let API_KEY = '';

(async () => {
    API_KEY = await fetchApiKey();
    console.log(`SponsorPulse load: ${ATTENDEES} attendees against ${API}`);
    console.log(`room ${ROOM}\n`);

    // The host joins first and becomes the authority, as in the real app.
    const host = new AgentConnection({});
    const seen = new Set();
    host.addEventListener('message', (ev) => {
        const items = (ev && ev.response && ev.response.data) || [];
        items.forEach((item) => {
            let payload;
            try { payload = JSON.parse(item.content || '{}'); } catch (e) { return; }
            if (payload.type === 'sp_answer' || payload.type === 'sp_vote') {
                seen.add(item.from || payload.from);
                results.answersSeenByHost++;
            }
        });
    });

    await connect(host, 'Organiser');
    console.log('host connected');
    // If the host stops receiving, every answer looks lost — so say why.
    host.addEventListener('error', (e) => {
        const why = ((e && e.message) || JSON.stringify(e || {})).slice(0, 100);
        results.hostErrors[why] = (results.hostErrors[why] || 0) + 1;
    });
    let rawEvents = 0;
    host.addEventListener('message', () => { rawEvents++; });
    results._rawEvents = () => rawEvents;

    // Attendees arrive in waves — a room does not scan the code in lockstep,
    // and one big burst measures the harness rather than the service.
    const WAVE = 10;
    const agents = [];
    for (let start = 0; start < ATTENDEES; start += WAVE) {
        // A fresh key per wave. The endpoint caps a temporary key at five
        // minutes, and a hundred agents took longer than that to bring up — so
        // the later waves were refused with "Invalid API key", which looked
        // like a capacity limit and was really an expiry. Every attendee's
        // browser fetches its own key anyway, so this is also the truer shape.
        const waveKey = await fetchApiKey().catch(() => API_KEY);
        const wave = [];
        for (let i = start; i < Math.min(start + WAVE, ATTENDEES); i++) {
            const agent = new AgentConnection({});
            agents.push(agent);
            wave.push(
                connect(agent, 'Attendee' + i, waveKey)
                    .then(() => { results.connected++; agent._joined = true; })
                    .catch((e) => {
                        results.failed++;
                        const why = e.message.slice(0, 90);
                        results.failReasons[why] = (results.failReasons[why] || 0) + 1;
                    })
            );
        }
        await Promise.all(wave);
        process.stdout.write(`  connected ${results.connected}/${ATTENDEES}\r`);
    }
    console.log(`\nconnected ${results.connected}, failed ${results.failed}`);
    Object.keys(results.failReasons).forEach((why) => {
        console.log(`  ${results.failReasons[why]} x ${why}`);
    });

    // Everyone answers at once — this is the moment a live quiz actually creates.
    const answerStart = Date.now();
    // Only agents that actually joined can answer. Sending from the rest
    // inflates "answers sent" with messages that were never going to arrive,
    // and makes a capacity problem look like a delivery problem.
    agents.filter((a) => a && a._joined).forEach((agent, i) => {
        try {
            agent.sendMessage({
                content: JSON.stringify({ type: 'sp_answer', segmentId: 'seg-load', optionId: 'a' }),
                to: 'Organiser',
                customType: 'sponsorpulse'
            });
            results.answersSent++;
        } catch (e) {
            if (results.sendErrors === undefined) results.sendErrors = [];
            if (results.sendErrors.length < 3) results.sendErrors.push(e.message);
        }
    });
    console.log(`sent ${results.answersSent} answers in ${Date.now() - answerStart}ms`);

    // Give the relay time to deliver before judging it.
    await new Promise((r) => setTimeout(r, 15000));

    // Then ask explicitly. If a forced pull finds what the polling loop did
    // not, the messages were never lost — the host simply stopped asking, and
    // that is a different bug from a dropped relay.
    console.log(`host state before forcing: readyState=${host.readyState} session=${host.sessionId ? 'yes' : 'NONE'} ` +
                `receiveTimer=${host._receiveTimer ? 'scheduled' : 'NONE'} autoReceive=${host.autoReceive}`);
    const beforeForced = seen.size;
    try {
        host.receive({ globalOffset: 0, localOffset: 0, limit: 500 }, false);
    } catch (e) { /* reported below */ }
    await new Promise((r) => setTimeout(r, 8000));
    console.log(`seen by polling ${beforeForced}, after a forced pull ${seen.size}`);

    const delivered = seen.size;
    console.log('\n--- results ---');
    console.log(`attendees connected       ${results.connected}/${ATTENDEES}`);
    console.log(`connect p50 / p95         ${percentile(results.connectMs, 50)}ms / ${percentile(results.connectMs, 95)}ms`);
    console.log(`answers sent              ${results.answersSent}`);
    console.log(`distinct answerers seen   ${delivered}`);
    console.log(`delivery                  ${results.answersSent ? Math.round((delivered / results.answersSent) * 100) : 0}%`);
    console.log(`host message events       ${results._rawEvents ? results._rawEvents() : 'n/a'}`);
    Object.keys(results.hostErrors).forEach((why) => {
        console.log(`host error: ${results.hostErrors[why]} x ${why}`);
    });

    agents.forEach((a) => { try { a.disconnect(); } catch (e) {} });
    try { host.disconnect(); } catch (e) {}

    if (results.sendErrors && results.sendErrors.length) {
        console.log('send errors:', results.sendErrors.join(' | '));
    }

    // Requiring answersSent > 0 explicitly: without it a run where nothing was
    // sent satisfies "95% of zero was delivered" and reports success, which is
    // the one result a load test must never give.
    const ok = results.connected >= ATTENDEES * 0.95
        && results.answersSent >= results.connected * 0.95
        && delivered >= results.answersSent * 0.95;
    console.log(ok
        ? '\nPASS'
        : '\nBELOW TARGET (95% connect, 95% sent, 95% delivered)');
    process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('load test failed:', e); process.exit(1); });
