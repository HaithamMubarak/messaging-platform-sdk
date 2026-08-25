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
    msg: unknown;
    destAgent?: string;
    encrypted?: boolean;
}

export interface AgentInfo {
    agentName: string;
    alias?: string;
}

export type AgentEvent =
    | 'connect'
    | 'disconnect'
    | 'message'
    | 'error'
    | 'agentConnected'
    | 'agentDisconnected';

export declare class AgentConnection {
    constructor(options?: {
        usePubKey?: boolean;
        enableWebrtcRelay?: boolean;
        useWebsocket?: boolean;
    });

    connect(options: ConnectOptions): void;
    disconnect(): void;

    sendMessage(options: SendOptions): void;
    getActiveAgents(callback: (agents: AgentInfo[]) => void): void;

    addEventListener(event: AgentEvent, handler: (event: any) => void): void;
    on(event: AgentEvent, handler: (event: any) => void): void;

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
