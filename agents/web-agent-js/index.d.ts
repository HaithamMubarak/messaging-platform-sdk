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
    /** Connect to a server-side channel id instead of a name. */
    channelId?: string;
    autoReceive?: boolean;
    enableWebrtcRelay?: boolean;
    /** 'private' (default) or 'public'. */
    apiKeyScope?: string;
    useWebsocket?: boolean;
}

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

export type AgentEvent =
    | 'connect'
    | 'disconnect'
    | 'message'
    | 'agent-connect'
    | 'agent-disconnect'
    | 'connection-lost'
    | 'reconnecting'
    | 'session-not-found';

export declare class AgentConnection {
    constructor(options?: {
        usePubKey?: boolean;
        enableWebrtcRelay?: boolean;
        useWebsocket?: boolean;
    });

    connect(options: ConnectOptions): void;
    disconnect(): void;

    sendMessage(options: SendOptions | string, callback?: (result: any) => void): void;
    getActiveAgents(callback: (agents: AgentInfo[]) => void): void;

    addEventListener(event: AgentEvent, handler: (event: any) => void): void;
    removeEventListener(event: AgentEvent, handler: (event: any) => void): void;

    /** Channel storage: state every client can read and late joiners catch up on. */
    storagePut(options: { storageKey: string; content: unknown; encrypted?: boolean; metadata?: object },
               callback?: (result: any) => void): void;
    storageGet(options: { storageKey: string }, callback: (result: any) => void): void;
    /** The value as written (JSON parsed back); null when nothing is stored. Rejects on any failure. */
    storageRead<T = unknown>(storageKey: string): Promise<T | null>;
    /** Every version of an append-only key, decoded (and decrypted), newest first. Rejects on any failure. */
    storageReadList<T = unknown>(storageKey: string): Promise<T[]>;
    storageKeys(callback: (result: any) => void): void;
    storageDeleteByKey(storageKey: string, callback?: (result: any) => void): void;

    isHostAgent(agentName: string): boolean;
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
