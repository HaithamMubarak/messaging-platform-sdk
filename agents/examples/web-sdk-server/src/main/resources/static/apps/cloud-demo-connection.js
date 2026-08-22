/**
 * CloudDemoConnection — the data layer for cloud-connection-demo.html.
 *
 * This page used to borrow TerminalSharing, the terminal app's own class. The
 * demo exists to show the *connection component* on its own, so depending on
 * another app's internals made it the one demo that could break because a
 * different app changed. Everything it needs is on UserConnectionBase already;
 * what is left below is only the handler table the page dispatches through.
 */
class CloudDemoConnection extends UserConnectionBase {
    constructor(options = {}) {
        super({
            storagePrefix: 'clouddemo',
            customType: 'clouddemo',
            ...options
        });
        /** message type -> handler(payload, fromAgent) */
        this.handlers = new Map();
    }

    /** Register a handler for one message type. Last registration wins. */
    registerHandler(type, fn) {
        if (typeof fn === 'function') this.handlers.set(type, fn);
    }

    /** Peers arriving over the data channel. */
    onDataChannelMessage(fromAgent, data) {
        this._dispatch(data, fromAgent);
    }

    /** ...and the same payloads when they come over the reliable channel. */
    onGameMessage(detail) {
        if (!detail) return;
        this._dispatch(detail.content || detail.data, detail.from);
    }

    _dispatch(payload, fromAgent) {
        if (!payload || typeof payload !== 'object') return;
        const fn = this.handlers.get(payload.type);
        if (fn) {
            try {
                fn(payload, fromAgent);
            } catch (e) {
                console.warn('[CloudDemoConnection] handler for', payload.type, 'threw', e);
            }
        }
    }
}

window.CloudDemoConnection = CloudDemoConnection;
