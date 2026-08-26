// ============================================================================
// Fieldstamp — shared core for the inspector console and the capture page.
//
// What makes an inspection worth anything is that the record cannot be quietly
// edited afterwards. Three things here do that work:
//
//   sha256Hex     the bytes of every capture are hashed on the device that
//                 took them, before they travel
//   chain         each entry's chain hash covers the previous entry's chain
//                 hash, so removing or reordering one entry breaks every hash
//                 after it — you cannot rewrite one photo out of the middle
//   canonical     stamps are serialised with sorted keys, so the same stamp
//                 always hashes to the same value on any browser
//
// The evidence log itself is appended with the platform's `storageAdd`, which
// keeps every version rather than replacing the last — the log is append-only
// underneath as well as by construction here.
//
// Images travel over the data channel in chunks: a full-resolution phone photo
// is far bigger than one message, so the sender splits it and the receiver
// reassembles before anything is shown or hashed.
// ============================================================================
(function () {
    'use strict';

    // A data-channel message has to stay well under the SCTP limit; 48 KB of
    // base64 per chunk leaves room for the envelope.
    const CHUNK = 48 * 1024;

    // ---------------------------------------------------------------- hashing

    async function sha256Hex(buffer) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function sha256Text(text) {
        return sha256Hex(new TextEncoder().encode(text));
    }

    /** Stable JSON: same object, same string, same hash, on every browser. */
    function canonical(obj) {
        if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
        if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
        return '{' + Object.keys(obj).sort()
            .map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
    }

    /**
     * The chain hash for one entry.
     * prev is the previous entry's chain hash, or the session's genesis string.
     */
    async function chainNext(prev, imageHash, stamp) {
        return sha256Text(prev + '|' + imageHash + '|' + canonical(stamp));
    }

    /** Re-derive a whole log and report the first entry that does not hold. */
    async function verifyChain(entries, genesis) {
        let prev = genesis;
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const expect = await chainNext(prev, e.imageHash, e.stamp);
            if (expect !== e.chain) {
                return { ok: false, brokenAt: i, expected: expect, found: e.chain };
            }
            prev = e.chain;
        }
        return { ok: true, brokenAt: -1 };
    }

    // ---------------------------------------------------------------- chunking

    function chunk(str) {
        const out = [];
        for (let i = 0; i < str.length; i += CHUNK) out.push(str.slice(i, i + CHUNK));
        return out;
    }

    /** Collects chunks for many captures at once and reports when one is whole. */
    class Reassembler {
        constructor() { this.parts = new Map(); }
        expect(id, total) { this.parts.set(id, { total, got: new Array(total) }); }
        add(id, index, data) {
            const slot = this.parts.get(id);
            if (!slot) return null;
            slot.got[index] = data;
            if (slot.got.filter(x => typeof x === 'string').length < slot.total) return null;
            this.parts.delete(id);
            return slot.got.join('');
        }
        progress(id) {
            const slot = this.parts.get(id);
            if (!slot) return 1;
            return slot.got.filter(x => typeof x === 'string').length / slot.total;
        }
        drop(id) { this.parts.delete(id); }
    }

    // ---------------------------------------------------------------- location

    /**
     * Location is opt-in and deliberately coarse. Four decimal places is about
     * eleven metres — enough to say which building, not which window.
     */
    function coarse(lat, lon) {
        return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, precision_m: 11 };
    }

    function getPosition(timeoutMs) {
        return new Promise(resolve => {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                p => resolve(coarse(p.coords.latitude, p.coords.longitude)),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: timeoutMs || 8000, maximumAge: 30000 }
            );
        });
    }

    // ---------------------------------------------------------------- templates

    const TEMPLATES = {
        motor: {
            id: 'motor',
            name: 'Motor claim',
            blurb: 'A vehicle after an incident. Plate, damage, context, mileage.',
            prompts: [
                'Stand back and show me the whole vehicle',
                'The number plate, close enough to read',
                'The damage, as close as you can get',
                'The same damage from further back, so I can see where it sits',
                'The odometer, with the ignition on',
                'The VIN plate — usually the door frame or the windscreen corner',
            ],
        },
        property: {
            id: 'property',
            name: 'Property condition',
            blurb: 'Move-in, move-out or a damage claim. Room by room.',
            prompts: [
                'Stand in the doorway and show me the whole room',
                'The floor, corner to corner',
                'Any mark or damage, close',
                'Kitchen surfaces and the sink',
                'Bathroom seals and grouting',
                'The meter readings — electricity, gas, water',
            ],
        },
        equipment: {
            id: 'equipment',
            name: 'Equipment handover',
            blurb: 'Plant and machinery going out or coming back.',
            prompts: [
                'The whole machine, from the front',
                'The serial plate',
                'The hour meter or the display',
                'All four sides, one at a time',
                'Any existing damage, close',
                'The tyres or tracks',
            ],
        },
        freeform: {
            id: 'freeform',
            name: 'No template',
            blurb: 'Ask for whatever the job needs.',
            prompts: [],
        },
    };

    const TEMPLATE_ORDER = ['motor', 'property', 'equipment', 'freeform'];

    // ---------------------------------------------------------------- images

    /**
     * Pull a still out of a video element at the track's own resolution.
     * The frame is taken on the device that holds the camera, so what travels
     * is the photo the sensor produced, not a re-encode of a compressed stream.
     */
    function grabFrame(video, quality) {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return null;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(video, 0, 0, w, h);
        return { dataUrl: c.toDataURL('image/jpeg', quality || 0.92), w, h };
    }

    /** A small copy for the evidence log and the report index. */
    function thumbnail(dataUrl, maxEdge) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, (maxEdge || 320) / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * scale);
                c.height = Math.round(img.height * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                resolve(c.toDataURL('image/jpeg', 0.72));
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });
    }

    function dataUrlBytes(dataUrl) {
        const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    // ---------------------------------------------------------------- storage

    /**
     * The platform's storage list comes back nested, and each version's
     * `content` is base64-encoded JSON rather than the object that was put in.
     * Both of those have to be unwrapped or the log reads back empty — which
     * looks exactly like "there is nothing stored".
     */
    function storedVersions(res) {
        let rows = res && res.data && res.data.data ? res.data.data : (res && res.data);
        if (rows && !Array.isArray(rows) && rows.versions) rows = rows.versions;
        return Array.isArray(rows) ? rows : [];
    }

    function decodeStored(row) {
        const raw = row && row.content !== undefined ? row.content : row;
        if (raw && typeof raw === 'object') return raw;
        if (typeof raw !== 'string') return null;
        try {
            const bin = atob(raw);
            const text = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
            return JSON.parse(text);
        } catch (_) { /* not base64 JSON — try it as plain JSON */ }
        try { return JSON.parse(raw); } catch (_) { return null; }
    }

    // ---------------------------------------------------------------- misc

    function shortId() {
        return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    }

    function deviceLabel() {
        const ua = navigator.userAgent || '';
        const m = ua.match(/\((?:[^;]*;\s*)?([^;)]{3,40})/);
        return {
            platform: navigator.platform || 'unknown',
            hint: (m && m[1] || 'unknown browser').trim(),
            screen: `${window.screen.width}x${window.screen.height}`,
        };
    }

    function stampTime(ms) {
        const d = new Date(ms);
        return {
            iso: d.toISOString(),
            local: d.toLocaleString(),
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
            offset_min: -d.getTimezoneOffset(),
        };
    }

    function fmtBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.Fieldstamp = {
        CHUNK,
        sha256Hex, sha256Text, canonical, chainNext, verifyChain,
        chunk, Reassembler,
        storedVersions, decodeStored,
        coarse, getPosition,
        TEMPLATES, TEMPLATE_ORDER,
        grabFrame, thumbnail, dataUrlBytes,
        shortId, deviceLabel, stampTime, fmtBytes, escapeHtml,
    };
})();
