/**
 * Type declarations for @messaging-platform/web-agent-js.
 *
 * Hand-written against the runtime API rather than generated, so anything here
 * that drifts from js/web-agent.js is a bug in this file. Only the surface a
 * consumer is expected to use is declared.
 */

export interface ConnectOptions {
    /** Base URL of the messaging service. */
    api: string;
    apiKey?: string;
    channelName: string;
    channelPassword: string;
    agentName: string;
    /**
     * For a MANAGED channel: this agent's key, from the app that owns the
     * channel (it registered agentName + agentKey with its API key). Not needed
     * for ordinary channels. See "Managed channels" in the SDK guide.
     */
    agentKey?: string;
    /**
     * Ask for a shorter channel life (ms), used only if this connect creates
     * the channel. The service holds it to [5 min, 24 h], the default; it can
     * shorten a channel's life, never lengthen it. Omit for 24 h.
     */
    channelAgeMs?: number;
    /** Connect to a server-side channel id instead of a name. */
    channelId?: string;
    autoReceive?: boolean;
    enableWebrtcRelay?: boolean;
    /** 'private' (default) or 'public'. */
    apiKeyScope?: string;
    useWebsocket?: boolean;
    /** Resume an existing session instead of opening a new one. */
    sessionId?: string;
    /** Wire type used for this agent's own events. */
    customEventType?: string;
    /** Start receiving from the offsets the connect response suggests. */
    useInitialReceiveConfig?: boolean;
    /** Messages per receive call. */
    defaultLimit?: number;
    /** Where receive reads from; defaults to 'AUTO'. */
    pollSource?: string;
}

/**
 * The platform's JSON envelope, as the attest, vault and knock callbacks (and
 * getActiveAgents) receive it. On failure `data` is the server's sentence.
 */
export type PlatformResponse<D> =
    | { status: 'success'; statusMessage?: string; data: D }
    | { status: 'error' | 'unauthorized' | 'forbidden'; statusMessage?: string; data?: string };

export interface SendOptions {
    /** A string or any JSON-serialisable value. */
    content: unknown;
    /** Send to one agent by name instead of the whole channel. */
    to?: string;
    /** A regex over agent names, instead of `to`. */
    filter?: string;
    /** Wire type; defaults to 'chat-text'. */
    type?: string;
    customType?: string;
    /** Deliver live only; not stored for replay. */
    ephemeral?: boolean;
}

export interface AgentInfo {
    agentName: string;
    alias?: string;
}

/** What a storage callback receives. */
export interface StorageResult<D = any> {
    status: 'success' | 'error';
    /** The server's envelope on success; the server's sentence on failure. */
    data: D | any;
    /** HTTP status of a failed request. */
    httpStatus?: number;
    /** True when the key may only be appended to (HTTP 409). */
    appendOnly?: boolean;
}

/** One stored version as getList returns it. */
export interface StorageVersion {
    id: number;
    storageKey: string;
    content: unknown;
    version: number;
    createdAt: string;
    updatedAt: string;
    metadata?: object;
    /** Agent name of the session that wrote it, stamped by the server; null on older rows. */
    writtenBy: string | null;
    /** The key was locked by an appendOnly add. */
    appendOnly: boolean;
}

export interface StorageEntry<T = unknown> {
    value: T;
    writtenBy: string | null;
    appendOnly: boolean;
    id: number;
    version: number;
    createdAt: string;
}

export type AgentEvent =
    | 'connect'
    | 'disconnect'
    | 'message'
    | 'agent-connect'
    | 'agent-disconnect'
    | 'connection-lost'
    | 'reconnecting'
    | 'session-not-found'
    | 'socket-open';

export declare class AgentConnection {
    constructor(options?: {
        usePubKey?: boolean;
        enableWebrtcRelay?: boolean;
        useWebsocket?: boolean;
    });

    connect(options: ConnectOptions): void;
    disconnect(): void;
    /** Go silent without a goodbye, as a crash would; the server announces the departure ~10 s later. */
    dropWithoutGoodbye(): void;

    sendMessage(options: SendOptions | string, callback?: (result: any) => void,
                perCall?: { useWebsocket?: boolean }): void;
    /** Agents in the channel now, as the envelope: `res.data` is the list. Throws before the channel is ready. */
    getActiveAgents(callback: (result: PlatformResponse<AgentInfo[]>) => void): void;
    /** System agents in the channel, same envelope. Throws before the channel is ready. */
    getSystemAgents(callback: (result: PlatformResponse<AgentInfo[]>) => void): void;
    /** Ask the server for this session's channel status. */
    status(callback: (result: any) => void): void;
    /** This connection's own channel name, password and ids. */
    getSessionInfo(): SessionInfo;
    /**
     * Fetch fresh ICE servers now (TURN credentials expire). Calls back with
     * the new list, or null when not connected or the server gave none.
     */
    refreshIceServers(callback?: (servers: RTCIceServer[] | null) => void): void;
    /** The ICE servers the last connect or refresh handed out. */
    iceServers?: RTCIceServer[];
    /** Truthy once the channel is usable ('connecting' while it is opening). */
    readonly readyState?: boolean | 'connecting';

    addEventListener(event: AgentEvent, handler: (event: any) => void): void;
    removeEventListener(event: AgentEvent, handler: (event: any) => void): void;

    /**
     * Channel storage: state every client can read and late joiners catch up on.
     * put and deleteByKey on a key locked by an appendOnly add answer
     * StorageResult with appendOnly: true (HTTP 409).
     */
    storagePut(options: { storageKey: string; content: unknown; encrypted?: boolean; metadata?: object },
               callback?: (result: StorageResult) => void): void;
    /**
     * Append a version. appendOnly on the key's first add locks it against
     * put and delete for every session; ignored once the key has versions.
     */
    storageAdd(options: { storageKey: string; content: unknown; encrypted?: boolean; metadata?: object; appendOnly?: boolean },
               callback?: (result: StorageResult) => void): void;
    storageGet(options: { storageKey: string }, callback: (result: any) => void): void;
    /** Every version of a key, newest first, as the server sent them (decrypted where possible). */
    storageGetList(storageKey: string, callback: (result: StorageResult<{ versions: StorageVersion[] }>) => void): void;
    /** The value as written (JSON parsed back); null when nothing is stored. Rejects on any failure. */
    storageRead<T = unknown>(storageKey: string): Promise<T | null>;
    /** Every version of an append-only key, decoded (and decrypted), newest first. Rejects on any failure. */
    storageReadList<T = unknown>(storageKey: string): Promise<T[]>;
    /** storageReadList with each version's server-stamped writer and lock. */
    storageReadEntries<T = unknown>(storageKey: string): Promise<StorageEntry<T>[]>;
    storageKeys(callback: (result: any) => void): void;
    /** Metadata of every key in the channel. */
    storageValues(callback: (result: any) => void): void;
    storageDeleteByKey(storageKey: string, callback?: (result: StorageResult) => void): void;

    // ---- Attest: tamper-evident receipts ----

    /** Lowercase hex SHA-256 of the content, computed the way Attest expects. */
    attestHash(content: string | BufferSource): Promise<string>;
    /** Append one record to a chain, creating the chain on first use. */
    attest(options: AttestOptions, callback?: (result: PlatformResponse<{ record: AttestRecord }>) => void): void;
    /** A chain, oldest first, with the genesis and keys needed to verify it. */
    attestList(chainKey: string, callback: (result: PlatformResponse<AttestChain>) => void): void;
    /** A self-contained bundle to file or send on; the server walks the chain first. */
    attestExport(chainKey: string, callback: (result: PlatformResponse<{ bundle: AttestBundle }>) => void): void;
    /** Every chain name in this channel. */
    attestChains(callback: (result: PlatformResponse<{ chainKeys: string[] }>) => void): void;
    /** Re-derive a chain and check every signature, offline, from plain data. */
    static attestVerify(bundle: AttestVerifiable): Promise<AttestVerdict>;

    // ---- Key escrow ----

    /** Seal a secret behind a recovery phrase plus an owner share returned once. Rejects on a phrase under 12 characters. */
    escrowSeal(options: { secret: string; recoveryPhrase: string; label?: string }): Promise<EscrowSealed>;
    /** Open an escrow with both halves; success and failure are both attested. Rejects when they do not open it. */
    escrowRecover(options: { escrowId: string; recoveryPhrase: string; ownerShare: string }): Promise<EscrowRecovered>;
    /** Escrows in this channel: labels and dates, never a half. */
    escrowList(callback: (result: { status: 'success'; data: { escrows: EscrowSummary[] } }) => void): void;
    /** The ceremony's Attest chain (`keyring-escrow`): seals, recoveries, failed attempts. */
    escrowHistory(callback: (result: PlatformResponse<AttestChain>) => void): void;

    // ---- Vault: encrypted blobs ----

    /** A fresh AES-256-GCM key for one blob, base64. */
    vaultNewKey(): Promise<string>;
    /** Encrypt, chunk and upload resumably. The key is returned and never sent. */
    vaultPut(source: Blob | ArrayBuffer, options?: VaultPutOptions): Promise<VaultPutResult>;
    /** Download and decrypt chunk by chunk. Rejects for an unknown or unfinished blob. */
    vaultGet(blobId: string, base64Key: string,
             options?: { onProgress?: (p: { received: number; total: number }) => void }): Promise<Uint8Array>;
    /** Blobs in this channel: sizes and hashes, never keys. */
    vaultList(callback: (result: PlatformResponse<{ blobs: VaultBlobInfo[] }>) => void): void;
    /** This deployment's limits and what the channel has used. */
    vaultQuota(callback: (result: PlatformResponse<VaultQuota>) => void): void;
    /** Delete one blob (an error envelope when there is no such blob). */
    vaultDelete(blobId: string, callback?: (result: PlatformResponse<{ deleted: true }>) => void): void;
    /** What arrived and what is missing. */
    vaultStatus(blobId: string, callback: (result: PlatformResponse<VaultStatus>) => void): void;

    // ---- Knock: content-free push ----

    /** Ask this browser to accept knocks in this channel. Call it from a click. */
    knockSubscribe(options?: KnockSubscribeOptions): Promise<KnockSubscribeResult>;
    /** Stop knocks to this browser in this channel. */
    knockUnsubscribe(): Promise<{ ok: boolean; reason?: 'unsupported' | 'not_subscribed' }>;
    /** Knock on one member; the result is per device, and `meaning` is the sentence to show. */
    knock(agentName: string, options: { tag?: string } | null,
          callback?: (result: PlatformResponse<KnockSendResult>) => void): void;
    knock(agentName: string, callback?: (result: PlatformResponse<KnockSendResult>) => void): void;
    /** Who here can be knocked on: names and device counts, never endpoints. */
    knockReachable(callback: (result: PlatformResponse<{ reachable: KnockReachable[] }>) => void): void;

    // ---- Disk sinks (origin-private file system) ----

    /** Open or reopen a disk-backed sink for an incoming transfer; null where OPFS is unavailable. */
    static diskSink(options?: { name?: string; resume?: boolean }): Promise<DiskSink | null>;
    /** Part-finished transfers this origin holds; null where OPFS is unavailable. */
    static diskSinkList(): Promise<Array<{ name: string; size: number; lastModified: number }> | null>;

    /** Licences and seats. A browser-side check is a courtesy, not protection. */
    static Till: Till;

    /** Whether this agent is host against that peer, or of the channel when no peer is named. */
    isHostAgent(agentName?: string): boolean;
    getHostAgentName(): string | null;

    /**
     * Whether leaving the page would lose work. Drives the unload prompt, which
     * stays silent unless something is actually unsaved.
     */
    setUnsavedChanges(hasUnsaved: boolean): this;
    hasUnsavedChanges?: boolean;

    readonly sessionId?: string;
    readonly channelId?: string;
}

export declare const MySecurity: {
    encrypt(plain: string | object, key: string): string;
    decrypt(cipher: string, key: string): string;
};

export declare const FileSystem: unknown;

export declare function generateRandomAgentName(): string;

export interface SessionInfo {
    name?: string;
    password?: string;
    channelId?: string;
    sessionId?: string;
}

// ---- Attest ----

export interface AttestOptions {
    /** Your name for the chain: one per consent, per shift, per delivery. */
    chainKey: string;
    /** Your vocabulary for what happened. */
    kind: string;
    /** From attestHash; the content itself never leaves the page. */
    contentHash: string;
    /** Small (4 KB) and public-safe: it travels with every export. */
    meta?: object | null;
}

export interface AttestRecord {
    seq: number;
    kind: string;
    contentHash: string;
    /** The canonical JSON string exactly as it was hashed, or null. */
    meta: string | null;
    /** What the server witnessed: the authenticated agent and its own clock. */
    stamp: { agent: string; serverTime: string };
    prev: string;
    chain: string;
    /** ECDSA P-256 signature over `chain`, raw r||s, base64. */
    sig: string;
    kid: string;
}

export interface AttestPublicKey {
    kid: string;
    alg: string;
    curve: string;
    /** SPKI, base64. */
    publicKey: string;
    /** True on a dev key that stops verifying after a restart. */
    ephemeral: boolean;
}

/** What attestVerify needs; an attestList answer or an export bundle both fit. */
export interface AttestVerifiable {
    genesis: string;
    records: AttestRecord[];
    publicKeys: AttestPublicKey[];
    channelId?: string;
    chainKey?: string;
}

export interface AttestChain extends AttestVerifiable {
    chainKey: string;
    channelId: string;
}

export interface AttestBundle extends AttestChain {
    format: string;
    chainRule: string;
    signatureAlg: string;
    timeSource: string;
    /** The server's own walk of the chain before it issued the bundle. */
    verified: boolean;
    brokenAt?: number | null;
    reason?: string;
}

export type AttestVerdict =
    | { ok: true; length: number }
    | { ok: false; brokenAt: number | null; reason: string };

// ---- Escrow ----

export interface EscrowSealed {
    escrowId: string;
    /** Returned once and stored nowhere. Show it; never offer to remember it. */
    ownerShare: string;
    label: string;
    sealedAt: string;
}

export interface EscrowRecovered {
    escrowId: string;
    label: string;
    secret: string;
}

export interface EscrowSummary {
    escrowId: string;
    label: string;
    sealedBy: string;
    at: string;
}

// ---- Vault ----

export interface VaultPutOptions {
    /** Seconds until the blob expires; capped by the deployment. */
    ttlSeconds?: number;
    /** A base64 key from vaultNewKey; a fresh one is made when omitted. */
    key?: string;
    quotaTag?: string;
    onProgress?: (p: { sent: number; total: number; seq: number }) => void;
}

export interface VaultPutResult {
    blobId: string;
    /** Share it with whoever should read the blob. Lose it and the bytes are gone. */
    key: string;
    sizeBytes: number;
    chunkCount: number;
    /** SHA-256 of the ciphertext, which the server checked before sealing. */
    sha256: string;
    /** Chunks sent by this call (fewer than chunkCount on a resume). */
    sent: number;
}

export interface VaultBlobInfo {
    blobId: string;
    agent: string;
    sizeBytes: number;
    chunkCount: number;
    sha256: string;
    quotaTag: string | null;
    complete: boolean;
    createdAt: string;
    expiresAt: string;
}

export interface VaultQuota {
    usedBytes: number;
    quotaBytes: number;
    maxBlobBytes: number;
    maxChunkBytes: number;
    defaultTtlSeconds: number;
    maxTtlSeconds: number;
}

export interface VaultStatus {
    blobId: string;
    chunkCount: number;
    received: number;
    /** Missing chunk numbers, at most 500 of them; missingCount has the total. */
    missing: number[];
    missingCount: number;
    bytesStored: number;
    sizeBytes: number;
    complete: boolean;
    expiresAt: string;
}

// ---- Knock ----

export interface KnockSubscribeOptions {
    /** The service worker; defaults to '/knock-sw.js'. It controls only its own directory. */
    swPath?: string;
    /** Narrow the worker to one app's directory. */
    swScope?: string;
    /** Subscribe even when the platform's VAPID key is ephemeral (demos only). */
    allowEphemeralKey?: boolean;
}

export type KnockSubscribeResult =
    | { ok: true; endpoint: string; subscriptions?: number }
    | {
          ok: false;
          reason: 'not_connected' | 'unsupported' | 'denied' | 'no_key' | 'ephemeral_key' | 'subscribe_failed';
          detail?: string;
      };

export interface KnockSendResult {
    agent: string;
    devices: number;
    sent: number;
    rateCapped: number;
    failed: number;
    results: Array<{ endpointHost: string; outcome: 'sent' | 'rate_capped' | 'failed' | 'dropped' }>;
    /** What "sent" is worth, to show the user instead of a checkmark. */
    meaning: string;
}

export interface KnockReachable {
    agent: string;
    devices: number;
}

// ---- Disk sinks ----

export interface DiskSink {
    name: string;
    /** Bytes on disk; above 0 means there is something to resume. */
    written: number;
    /** Write at an explicit offset; resolves the new size. */
    writeAt(offset: number, bytes: BufferSource | Blob | string): Promise<number>;
    /** Append at `written`. */
    write(bytes: BufferSource | Blob | string): Promise<number>;
    /** Re-read the size on disk. */
    size(): Promise<number>;
    /** The finished file, without loading it into memory. */
    finish(): Promise<File>;
    /** Throw the transfer away; false if it could not be removed. */
    discard(): Promise<boolean>;
}

// ---- Till ----

export type TillReason =
    | 'unknown_or_revoked'
    | 'revoked'
    | 'past_due'
    | 'expired'
    | 'site_mismatch'
    | 'no_seats_available'
    | 'unavailable';

export interface TillVerdict {
    valid: boolean;
    plan?: string | null;
    /** 0 means unmetered (a site licence). */
    seats: number;
    seatsUsed: number;
    expiresAt?: string | null;
    reason?: TillReason;
    /** Why it was unavailable, on a refusal or a network failure. */
    detail?: string;
}

export interface TillRequest {
    /** The API base; omit after Till.configure(api). */
    api?: string | null;
    app: string;
    key: string | null;
    seatRef?: string | null;
}

export interface Till {
    api: string | null;
    /** Set the API base once so later calls can omit `api`. */
    configure(api: string): Till;
    /** Is this key good for this app now? Never rejects: a failure resolves reason 'unavailable'. */
    check(request: TillRequest): Promise<TillVerdict>;
    /** Take or refresh a seat; `seatRef` is hashed before the server stores it. */
    claimSeat(request: TillRequest & { seatRef: string }): Promise<TillVerdict>;
    /** Give a seat back. */
    releaseSeat(request: TillRequest & { seatRef: string }): Promise<TillVerdict>;
    /** check (or claimSeat with a seatRef), rejecting with an Error carrying `verdict` when the answer is no. */
    require(request: TillRequest): Promise<TillVerdict>;
    /** Keep the holder's own key in this browser's localStorage. */
    remember(app: string, key: string): void;
    /** The key remember() kept, or null. */
    recall(app: string): string | null;
    forget(app: string): void;
}

export declare const Till: Till;

// ---- WebRtcHelper (js/web-agent.webrtc.js) ----

export interface StreamOfferConstraints {
    video?: boolean;
    audio?: boolean;
    /** A stream the caller owns; closing never stops its tracks. */
    stream?: MediaStream;
    /** Relay a remote stream this helper already receives (SFU mode). */
    sourceStreamId?: string;
    /**
     * Open a data channel alongside (or instead of) media. Without options it
     * is unordered with no retransmits, which sendFile refuses: pass
     * `{ options: { ordered: true } }` for files.
     */
    dataChannel?: boolean | { name?: string; options?: RTCDataChannelInit };
    /** Camera capture size when the helper acquires the stream itself. */
    width?: ConstrainULong;
    height?: ConstrainULong;
    frameRate?: ConstrainDouble;
}

export interface PeerFileInfo {
    id: string;
    name: string;
    size: number;
    mime: string;
    sha256: string;
}

export interface WebRtcReconnectSettings {
    disconnectedGraceMs: number;
    attemptTimeoutMs: number;
    maxAttempts: number;
    offlinePollMs: number;
    answererGiveUpMs: number;
    dataChannelCloseGraceMs: number;
    wakeDebounceMs: number;
}

export interface WebRtcStats {
    peerConnections: number;
    remoteStreams: number;
    localStreams: number;
    dataChannels: number;
    activeDataChannels: number;
    ready: boolean;
}

export interface WebRtcHelperEvents {
    'remote-stream': (streamId: string, stream: MediaStream, sourceAgent: string) => void;
    'stream-ready': (streamId: string, remoteAgent: string, connectionTimeMs: number | null,
                     peerConnectionTimeMs: number | null) => void;
    'stream-reconnecting': (streamId: string, peer: string, attempt: number) => void;
    'stream-recovered': (streamId: string, peer: string, attempts: number) => void;
    'stream-failed': (streamId: string, peer: string) => void;
    'stream-closed': (streamId: string, peer: string, reason: 'local' | 'remote' | 'failed') => void;
    'connection-state': (streamId: string, state: RTCPeerConnectionState) => void;
    'datachannel-open': (peerId: string, channel: RTCDataChannel, connectionTimeMs: number | null) => void;
    'datachannel-message': (peerId: string, data: any) => void;
    'datachannel-close': (peerId: string) => void;
    'datachannel-error': (peerId: string, error: Event, isGracefulClose: boolean) => void;
    'file-start': (peerId: string, info: PeerFileInfo) => void;
    'file-progress': (peerId: string, progress: { id: string; received: number; size: number }) => void;
    'file': (peerId: string, file: PeerFileInfo & { blob: Blob }) => void;
    'file-failed': (peerId: string, failure: { id: string; name: string; reason: string }) => void;
    'offer': (streamId: string, sdp: string) => void;
    'answer': (streamId: string, sdp: string) => void;
    'ice-candidate': (streamId: string, candidate: RTCIceCandidate) => void;
}

/**
 * Peer connections signalled over an AgentConnection. Load
 * js/web-agent.webrtc.js beside web-agent.js; it defines the WebRtcHelper
 * global. The package entry does not export it.
 */
export interface WebRtcHelper {
    readonly channel: AgentConnection;
    /** Data channels, by peer agent name. */
    readonly dataChannels: Map<string, RTCDataChannel>;
    /** How a broken connection is brought back; tunable per helper. */
    reconnect: WebRtcReconnectSettings;
    /** False where RTCPeerConnection is unavailable (Node without wrtc). */
    readonly ready: boolean;
    /** files.maxBytes is the largest incoming file this side accepts (256 MB). */
    readonly files: { maxBytes: number };

    /** Register a handler; see WebRtcHelperEvents for each event's arguments. */
    on<E extends keyof WebRtcHelperEvents>(event: E, handler: WebRtcHelperEvents[E]): void;
    /** Offer media and/or a data channel to one agent; resolves the stream id, kept across reconnects. */
    createStreamOffer(remoteAgent: string, constraints?: StreamOfferConstraints): Promise<string>;
    /** Swap what a connection sends without renegotiating; false when it has no slot for that kind. */
    replaceStream(streamId: string, stream: MediaStream): Promise<boolean>;
    /** Reconnect an outgoing stream now; false for an unknown or incoming one. */
    restartStream(streamId: string): boolean;
    /** Close one stream, telling the peer unless notify is false. Stops only tracks the helper acquired. */
    closeStream(streamId: string, options?: { notify?: boolean; reason?: 'local' | 'remote' | 'failed' }): Promise<void>;
    /** closeStream for every stream. */
    closeAllStreams(): void;
    /** Close everything and stop listening for network changes. */
    destroy(): void;
    /** The stream offered back when answering a peer's offer. */
    setLocalMediaStream(stream: MediaStream | null): void;
    /** JSON-encode and send over that peer's data channel; false if it is not open (nothing retries). */
    sendData(peerId: string, data: unknown): boolean;
    /** Send a file over a reliable, ordered data channel; resolves once the receiver checked its SHA-256. */
    sendFile(peerId: string, file: Blob,
             options?: { name?: string; chunkBytes?: number;
                         onProgress?: (p: { id: string; sent: number; size: number }) => void }): Promise<PeerFileInfo>;
    /** sendData to every open data channel; returns how many it reached. */
    broadcastDataChannel(data: unknown): number;
    /** Close one peer's data channel. */
    closeDataChannel(peerId: string): void;
    /** Peers whose data channel is open. */
    getActiveDataChannels(): string[];
    /** Counts of connections, streams and channels. */
    getStats(): WebRtcStats;
    /** The channel's ICE servers, else the built-in defaults. */
    getIceServersFromConfig(channel?: AgentConnection | null): RTCIceServer[];
}

export interface WebRtcHelperConstructor {
    /** Throws without a channel. The helper takes over channel.onWebRtcSignaling. */
    new (channel: AgentConnection): WebRtcHelper;
}

declare global {
    /** Defined by js/web-agent.webrtc.js. */
    var WebRtcHelper: WebRtcHelperConstructor;
}
