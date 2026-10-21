/**
 * A TCP hop between one browser and the site that can fail the way real
 * networks do, without either end being told.
 *
 *   const link = await faultyLink(8086);   // browse http://localhost:<link.port>/...
 *   link.cut();          // a closed lid or a dead network: sockets stay open, bytes vanish
 *   link.delay(3000);    // 3 s added each way: slow, but alive
 *   link.reset();        // a killed tab: every connection reset at once
 *
 * cut() swallows every byte in both directions and leaves new connections
 * hanging, with no FIN, no RST and no close frame, so neither the browser nor
 * the server notices by itself. That is the case a server's own dead-peer
 * detection exists for, and the one a page cannot fake from the inside.
 */
const net = require('net');

function faultyLink(upstreamPort, upstreamHost = '127.0.0.1') {
    const sockets = new Set();
    let cut = false;
    let delayMs = 0;

    const forward = (from, to) => from.on('data', (chunk) => {
        if (cut) return;                              // into the void
        if (!delayMs) { to.write(chunk); return; }
        setTimeout(() => { if (!cut && !to.destroyed) to.write(chunk); }, delayMs);   // same delay keeps order
    });

    const server = net.createServer((client) => {
        if (cut) { sockets.add(client); return; }     // a dead network does not refuse; it never answers
        const up = net.connect(upstreamPort, upstreamHost);
        for (const s of [client, up]) {
            s.setNoDelay(true);
            s.on('error', () => {});
            s.on('close', () => sockets.delete(s));
            sockets.add(s);
        }
        forward(client, up);
        forward(up, client);
        client.on('end', () => { if (!cut) up.end(); });
        up.on('end', () => { if (!cut) client.end(); });
    });

    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        port: server.address().port,
        cut() { cut = true; },
        delay(ms) { delayMs = ms; },
        reset() { for (const s of sockets) s.resetAndDestroy ? s.resetAndDestroy() : s.destroy(); },
        close() { for (const s of sockets) s.destroy(); server.close(); }
    })));
}

module.exports = { faultyLink };
