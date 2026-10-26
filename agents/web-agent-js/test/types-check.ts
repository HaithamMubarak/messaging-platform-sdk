/**
 * Compile-only check of index.d.ts: every declaration added for attest,
 * escrow, vault, knock, Till, disk sinks and WebRtcHelper is used once here
 * the way the guide uses it. Nothing runs: `npm run test:types` compiles it.
 */
import {
    AgentConnection, Till, AttestVerdict, AttestBundle, PlatformResponse,
    KnockSubscribeResult, VaultPutResult, DiskSink, WebRtcHelper, PeerFileInfo
} from '..';

declare const file: File;
declare const camera: MediaStream;

async function features(agent: AgentConnection): Promise<void> {
    const info = agent.getSessionInfo();
    const channelId: string | undefined = info.channelId;
    agent.refreshIceServers(servers => servers && servers.map(s => s.urls));
    agent.getSystemAgents(res => { if (res.status === 'success') res.data.map(a => a.agentName); });
    agent.getActiveAgents(res => { if (res.status === 'success') res.data.forEach(a => a.alias); });
    agent.status(() => {});
    const entries = await agent.storageReadEntries<{ n: number }>('log');
    const firstWriter: string | null = entries[0].writtenBy;
    const board = await agent.storageRead<number[]>('board');

    // Attest
    const contentHash = await agent.attestHash(JSON.stringify({ signed: true }));
    agent.attest({ chainKey: 'consent-9f2e', kind: 'consent-signed', contentHash, meta: { formVersion: 7 } }, r => {
        if (r.status === 'success') console.log(r.data.record.seq, r.data.record.chain, r.data.record.stamp.agent);
    });
    agent.attestList('consent-9f2e', async r => {
        if (r.status !== 'success') return;
        const verdict: AttestVerdict = await AgentConnection.attestVerify(r.data);
        if (verdict.ok) console.log(verdict.length); else console.log(verdict.brokenAt, verdict.reason);
    });
    agent.attestExport('consent-9f2e', r => {
        if (r.status === 'success') { const b: AttestBundle = r.data.bundle; console.log(b.verified, b.publicKeys[0].kid); }
    });
    agent.attestChains(r => { if (r.status === 'success') r.data.chainKeys.join(','); });

    // Escrow
    const sealed = await agent.escrowSeal({ secret: 'pw', recoveryPhrase: 'seventeen rusty lanterns', label: 'clinic' });
    const opened = await agent.escrowRecover({ escrowId: sealed.escrowId, recoveryPhrase: 'x'.repeat(12), ownerShare: sealed.ownerShare });
    const secret: string = opened.secret;
    agent.escrowList(r => r.data.escrows.map(e => e.label + e.sealedBy + e.at));
    agent.escrowHistory(r => { if (r.status === 'success') AgentConnection.attestVerify(r.data); });

    // Vault
    const key: string = await agent.vaultNewKey();
    const put: VaultPutResult = await agent.vaultPut(file, {
        ttlSeconds: 3600, key, onProgress: p => console.log(p.sent / p.total, p.seq)
    });
    const bytes: Uint8Array = await agent.vaultGet(put.blobId, put.key, { onProgress: p => p.received / p.total });
    agent.vaultList(r => { if (r.status === 'success') r.data.blobs.forEach(b => b.expiresAt); });
    agent.vaultQuota(r => { if (r.status === 'success') console.log(r.data.usedBytes / r.data.quotaBytes); });
    agent.vaultStatus(put.blobId, r => { if (r.status === 'success') console.log(r.data.missing, r.data.complete); });
    agent.vaultDelete(put.blobId, r => { if (r.status === 'error') console.log(r.statusMessage); });

    // Knock
    const sub: KnockSubscribeResult = await agent.knockSubscribe({ swPath: '/knock-sw.js', swScope: '/apps/x/' });
    if (!sub.ok) console.log(sub.reason, sub.detail); else console.log(sub.endpoint);
    const off = await agent.knockUnsubscribe();
    agent.knock('Dana', { tag: 'shift-handover' }, r => { if (r.status === 'success') console.log(r.data.meaning, r.data.results[0].outcome); });
    agent.knock('Dana', r => r.status);
    agent.knockReachable(r => { if (r.status === 'success') r.data.reachable.map(x => x.agent + x.devices); });

    // Disk sinks
    const sink: DiskSink | null = await AgentConnection.diskSink({ name: 'movie.mp4' });
    if (sink) { await sink.writeAt(sink.written, new Uint8Array(4)); const f: File = await sink.finish(); await sink.discard(); }
    const held = await AgentConnection.diskSinkList();

    // Till, both as the export and as AgentConnection.Till
    const till = AgentConnection.Till.configure('/messaging-platform/api/v1/messaging-service');
    const verdict = await till.check({ app: 'signet', key: Till.recall('signet') });
    if (!verdict.valid) console.log(verdict.reason);
    await Till.claimSeat({ app: 'signet', key: 'k', seatRef: 'a@b.c' });
    await Till.releaseSeat({ app: 'signet', key: 'k', seatRef: 'a@b.c' });
    await Till.require({ app: 'signet', key: 'k' }).catch((e: Error & { verdict?: typeof verdict }) => e.verdict);

    console.log(channelId, firstWriter, board, secret, bytes, off, held);
}

async function webrtc(agent: AgentConnection): Promise<void> {
    const rtc: WebRtcHelper = new WebRtcHelper(agent);
    rtc.reconnect.maxAttempts = 2;
    rtc.on('remote-stream', (id, stream, from) => stream.getTracks().length + id + from);
    rtc.on('datachannel-open', (peer, dc, ms) => dc.label + peer + ms);
    rtc.on('datachannel-message', (peer, data) => console.log(peer, data));
    rtc.on('stream-closed', (id, peer, reason) => reason === 'remote');
    rtc.on('connection-state', (id, state) => state === 'failed');
    rtc.on('file', (peer, f) => f.blob.size + f.sha256);
    rtc.on('file-failed', (peer, f) => f.reason);
    rtc.setLocalMediaStream(camera);
    const sid = await rtc.createStreamOffer('Dana', { stream: camera, dataChannel: { name: 'files', options: { ordered: true } } });
    if (!(await rtc.replaceStream(sid, camera))) await rtc.closeStream(sid, { notify: true });
    rtc.restartStream(sid);
    const sent: boolean = rtc.sendData('Dana', { hello: 1 });
    const meta: PeerFileInfo = await rtc.sendFile('Dana', file, { onProgress: p => p.sent / p.size });
    const reached: number = rtc.broadcastDataChannel({ tick: 1 });
    rtc.getActiveDataChannels().forEach(p => rtc.closeDataChannel(p));
    console.log(sent, meta, reached, rtc.getStats().ready, rtc.getIceServersFromConfig(agent));
    rtc.closeAllStreams();
    rtc.destroy();
}

export { features, webrtc };
export type Unused = PlatformResponse<unknown>;
