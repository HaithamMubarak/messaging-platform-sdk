/**
 * A network between one browser and the site that can fail the way real
 * networks do, without either end being told.
 *
 *   const net = await faultyProxy();
 *   chromium.launch({ proxy: { server: net.server } })   // one browser per proxy
 *   net.cut();          // a closed lid or a dead network: sockets stay open, bytes vanish
 *   net.delay(3000);    // 3 s added each way: slow, but alive
 *   net.reset();        // a killed tab: every connection reset at once
 *
 * It is an HTTP CONNECT proxy, so TLS runs end to end through it (the real
 * certificate, the real host) and it carries everything the browser sends:
 * the page, the API, and the WebSocket. Put a proxy in front of a page's
 * assets only and the page's agent still talks to the platform directly, so
 * a "cut" cuts nothing (the first version of dead-peer-test did exactly that).
 *
 * cut() swallows every byte in both directions and leaves new connections
 * hanging, with no FIN, no RST and no close frame, so neither the browser nor
 * the server notices by itself. That is the case a server's own dead-peer
 * detection exists for, and the one a page cannot fake from the inside.
 */
const http = require('http');
const net = require('net');

function faultyProxy() {
    const sockets = new Set();
    let cut = false;
    let delayMs = 0;

    const track = (s) => {
        s.setNoDelay(true);
        s.on('error', () => {});
        s.on('close', () => sockets.delete(s));
        sockets.add(s);
    };
    const forward = (from, to) => from.on('data', (chunk) => {
        if (cut) return;                              // into the void
        if (!delayMs) { to.write(chunk); return; }
        setTimeout(() => { if (!cut && !to.destroyed) to.write(chunk); }, delayMs);   // same delay keeps order
    });

    const server = http.createServer((req, res) => { res.writeHead(405); res.end(); });
    server.on('connect', (req, client, head) => {
        track(client);
        if (cut) return;                              // a dead network does not refuse; it never answers
        const [host, port] = req.url.split(':');
        const up = net.connect(Number(port) || 443, host, () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) up.write(head);
            forward(client, up);
            forward(up, client);
        });
        track(up);
        client.on('end', () => { if (!cut) up.end(); });
        up.on('end', () => { if (!cut) client.end(); });
    });

    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        server: 'http://127.0.0.1:' + server.address().port,
        cut() { cut = true; },
        delay(ms) { delayMs = ms; },
        reset() { for (const s of sockets) s.resetAndDestroy ? s.resetAndDestroy() : s.destroy(); },
        close() { for (const s of sockets) s.destroy(); server.close(); }
    })));
}

module.exports = { faultyProxy };
