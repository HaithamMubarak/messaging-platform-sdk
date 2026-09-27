/**
 * sendFile: a file between two WebRtcHelpers over a pair of fake data
 * channels that behave like real ones where it matters -- ordered delivery,
 * a bufferedAmount that fills on send and drains on delivery, and a
 * 'bufferedamountlow' event.
 *
 *     node test/send-file.test.js
 *
 * What is pinned is what "sent" has to mean: the sender's promise resolves
 * only when the receiver has the bytes and they hash to what was sent, and it
 * REJECTS -- with a reason -- when the file was refused, damaged, cut off, or
 * put on a channel that could lose a chunk.
 */
const assert = require('assert');
const path = require('path');
const { WebRtcHelper } = require(path.join(__dirname, '..', 'js', 'web-agent.webrtc.js'));

let failed = 0;
async function check(name, fn) {
    try { await fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + ' -- ' + e.message); }
}

class FakeChannel {
    constructor() {
        this.readyState = 'open'; this.ordered = true; this.maxRetransmits = null; this.maxPacketLifeTime = null;
        this.bufferedAmount = 0; this.bufferedAmountLowThreshold = 0; this.listeners = {};
        this.peakBuffered = 0; this.binaryFrames = 0; this.tamper = null;
    }
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    removeEventListener(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter((f) => f !== fn); }
    fire(ev) { (this.listeners[ev] || []).slice().forEach((f) => f()); }
    send(data) {
        if (this.readyState !== 'open') throw new Error('closed');
        const size = typeof data === 'string' ? data.length : data.byteLength;
        if (typeof data !== 'string') this.binaryFrames++;
        this.bufferedAmount += size;
        this.peakBuffered = Math.max(this.peakBuffered, this.bufferedAmount);
        const copy = typeof data === 'string' ? data : data.slice(0);
        if (this.tamper && typeof data !== 'string') this.tamper(copy);
        setImmediate(() => {
            this.bufferedAmount -= size;
            if (this.other.readyState === 'open') this.other.onmessage({ data: copy });
            if (this.bufferedAmount <= this.bufferedAmountLowThreshold) this.fire('bufferedamountlow');
        });
    }
    close() {
        this.readyState = 'closed'; this.other.readyState = 'closed';
        this.fire('close'); this.onclose(); this.other.onclose();
    }
}

/** alice and bob, each with a helper, joined by one channel. */
function pair() {
    const a = new WebRtcHelper({}), b = new WebRtcHelper({});
    const ab = new FakeChannel(), ba = new FakeChannel();
    ab.other = ba; ba.other = ab;
    a._setupDataChannelHandlers(ab, 'bob'); a.dataChannels.set('bob', ab);
    b._setupDataChannelHandlers(ba, 'alice'); b.dataChannels.set('alice', ba);
    const got = { files: [], failed: [], messages: [], progress: 0 };
    b.on('file', (peer, f) => got.files.push(Object.assign({ peer }, f)));
    b.on('file-failed', (peer, f) => got.failed.push(f));
    b.on('file-progress', () => got.progress++);
    b.on('datachannel-message', (peer, m) => got.messages.push(m));
    return { a, b, ab, ba, got };
}

function randomBytes(n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = (i * 2654435761) >>> 24;
    return out;
}

(async () => {
    console.log('sendFile');
    const quiet = console.log; console.warn = () => {};

    await check('a 3 MB file arrives byte for byte, and the sender hears so', async () => {
        const { a, ab, got } = pair();
        const bytes = randomBytes(3 * 1024 * 1024 + 7);
        const meta = await a.sendFile('bob', new Blob([bytes], { type: 'application/pdf' }), { name: 'plan.pdf' });
        assert.strictEqual(got.files.length, 1);
        const f = got.files[0];
        assert.deepStrictEqual([f.peer, f.name, f.size, f.mime], ['alice', 'plan.pdf', bytes.length, 'application/pdf']);
        assert.strictEqual(f.sha256, meta.sha256);
        assert.ok(Buffer.from(await f.blob.arrayBuffer()).equals(Buffer.from(bytes)));
        assert.ok(got.progress > 100, 'progress was reported');
        assert.ok(ab.peakBuffered <= 1024 * 1024 + 16 * 1024 + 64, 'buffer stayed near the high-water mark: ' + ab.peakBuffered);
    });

    await check('ordinary messages still reach the app, and no file control leaks to it', async () => {
        const { a, got } = pair();
        a.sendData('bob', { t: 'hi' });
        await a.sendFile('bob', new Blob(['x']));
        await new Promise((r) => setImmediate(r));
        assert.deepStrictEqual(got.messages, [{ t: 'hi' }]);
    });

    await check('an empty file is still a file', async () => {
        const { a, got } = pair();
        await a.sendFile('bob', new Blob([]), { name: 'empty.txt' });
        assert.strictEqual(got.files[0].size, 0);
    });

    await check('too large for the receiver: refused, and the sender stops sending', async () => {
        const { a, b, ab, got } = pair();
        b.files.maxBytes = 10000;
        await assert.rejects(a.sendFile('bob', new Blob([randomBytes(2 * 1024 * 1024)])), /too_large/);
        assert.ok(ab.binaryFrames < 128, 'stopped early, sent ' + ab.binaryFrames + ' of 128 chunks');
        assert.strictEqual(got.files.length, 0);
    });

    await check('a damaged chunk: the receiver says corrupt, the sender rejects', async () => {
        const { a, ab, got } = pair();
        let n = 0;
        ab.tamper = (buf) => { if (++n === 3) new Uint8Array(buf)[20] ^= 0xff; };
        await assert.rejects(a.sendFile('bob', new Blob([randomBytes(100000)])), /corrupt/);
        assert.strictEqual(got.files.length, 0);
        assert.strictEqual(got.failed[0].reason, 'corrupt');
    });

    await check('an unreliable channel is refused before a byte is sent', async () => {
        const { a, ab } = pair();
        ab.maxRetransmits = 0;
        await assert.rejects(a.sendFile('bob', new Blob(['x'])), /not reliable/);
        assert.strictEqual(ab.binaryFrames, 0);
    });

    await check('the channel closing mid-transfer fails both ends', async () => {
        const { a, ab, got } = pair();
        const sending = a.sendFile('bob', new Blob([randomBytes(4 * 1024 * 1024)]));
        setTimeout(() => ab.close(), 5);
        await assert.rejects(sending, /did not arrive/);
        assert.strictEqual(got.failed.length, 1);
        assert.strictEqual(got.failed[0].reason, 'channel_closed');
    });

    await check('no channel at all rejects, it does not throw', async () => {
        const { a } = pair();
        await assert.rejects(a.sendFile('carol', new Blob(['x'])), /No open data channel/);
    });

    console.log = quiet;
    console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
    process.exitCode = failed ? 1 : 0;
})();
