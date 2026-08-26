/**
 * A small XMLHttpRequest for Node, so the SDK can be used off-browser.
 *
 * js/web-agent.js talks to the service through XMLHttpRequest. That is the
 * right choice for the browser the SDK was written for, but it means importing
 * the package into Node got as far as the first request and then threw — so the
 * package was importable without being usable, and nothing could drive the SDK
 * from a script or a load test.
 *
 * This implements only what the SDK actually calls, on top of Node's own http
 * and https. It is not a general-purpose XHR: no synchronous mode, no cookies,
 * no CORS (there is no origin here to enforce one against).
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const UNSENT = 0, OPENED = 1, HEADERS_RECEIVED = 2, LOADING = 3, DONE = 4;

class NodeXMLHttpRequest {
    constructor() {
        this.readyState = UNSENT;
        this.status = 0;
        this.statusText = '';
        this.responseText = '';
        this.response = '';
        this.responseType = '';
        this.timeout = 0;
        this.onload = null;
        this.onerror = null;
        this.ontimeout = null;
        this.onabort = null;
        this.onloadend = null;
        this.onreadystatechange = null;

        this._headers = {};
        this._responseHeaders = {};
        this._listeners = {};
        this._request = null;
        this._aborted = false;
    }

    open(method, url) {
        this._method = (method || 'GET').toUpperCase();
        this._url = url;
        this.readyState = OPENED;
        this._fire('readystatechange');
    }

    setRequestHeader(name, value) {
        this._headers[name] = value;
    }

    getResponseHeader(name) {
        const key = String(name).toLowerCase();
        return this._responseHeaders[key] !== undefined ? this._responseHeaders[key] : null;
    }

    addEventListener(type, handler) {
        (this._listeners[type] = this._listeners[type] || []).push(handler);
    }

    removeEventListener(type, handler) {
        const list = this._listeners[type];
        if (!list) return;
        const at = list.indexOf(handler);
        if (at !== -1) list.splice(at, 1);
    }

    _fire(type, detail) {
        const event = detail || { type };
        const direct = this['on' + type];
        if (typeof direct === 'function') {
            try { direct.call(this, event); } catch (e) { /* a handler must not kill the request */ }
        }
        (this._listeners[type] || []).forEach((handler) => {
            try { handler.call(this, event); } catch (e) { /* as above */ }
        });
    }

    send(body) {
        let target;
        try {
            target = new URL(this._url);
        } catch (e) {
            this.readyState = DONE;
            this._fire('error');
            this._fire('loadend');
            return;
        }

        const transport = target.protocol === 'https:' ? https : http;
        const options = {
            method: this._method,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: target.pathname + target.search,
            headers: Object.assign({}, this._headers)
        };

        if (body !== undefined && body !== null && !options.headers['Content-Length']) {
            options.headers['Content-Length'] = Buffer.byteLength(
                typeof body === 'string' ? body : String(body));
        }

        this._request = transport.request(options, (res) => {
            this.status = res.statusCode;
            this.statusText = res.statusMessage || '';
            Object.keys(res.headers).forEach((k) => {
                this._responseHeaders[k.toLowerCase()] = res.headers[k];
            });

            this.readyState = HEADERS_RECEIVED;
            this._fire('readystatechange');

            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
                this.readyState = LOADING;
            });
            res.on('end', () => {
                if (this._aborted) return;
                const buffer = Buffer.concat(chunks);
                this.responseText = buffer.toString('utf8');
                // arraybuffer is used for binary transfers; everything else is text.
                this.response = this.responseType === 'arraybuffer'
                    ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
                    : this.responseText;
                this.readyState = DONE;
                this._fire('readystatechange');
                this._fire('load');
                this._fire('loadend');
            });
        });

        if (this.timeout > 0) {
            this._request.setTimeout(this.timeout, () => {
                this.abort();
                this._fire('timeout');
                this._fire('loadend');
            });
        }

        this._request.on('error', () => {
            if (this._aborted) return;
            this.readyState = DONE;
            this.status = 0;
            this._fire('error');
            this._fire('loadend');
        });

        if (body !== undefined && body !== null) this._request.write(body);
        this._request.end();
    }

    abort() {
        this._aborted = true;
        if (this._request) {
            try { this._request.destroy(); } catch (e) { /* already gone */ }
        }
        this.readyState = DONE;
        this._fire('abort');
        // A browser fires loadend after abort too, and the SDK listens ONLY to
        // loadend (its onerror/ontimeout handlers are commented out). Without
        // this, any abort the SDK did not initiate loses its callback — another
        // way a polling loop dies quietly.
        this._fire('loadend');
    }
}

NodeXMLHttpRequest.UNSENT = UNSENT;
NodeXMLHttpRequest.OPENED = OPENED;
NodeXMLHttpRequest.HEADERS_RECEIVED = HEADERS_RECEIVED;
NodeXMLHttpRequest.LOADING = LOADING;
NodeXMLHttpRequest.DONE = DONE;

module.exports = NodeXMLHttpRequest;
