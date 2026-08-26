// ============================================================================
// Fieldstamp — the inspector console.
//
// The inspector is the host: they open the session, they ask for the shots,
// and their browser assembles the evidence log. What the console is careful
// about is the difference between a record and a picture of one:
//
//   * the photo is hashed on the phone that took it, and the console re-hashes
//     what arrived. If the two disagree the capture is REJECTED — a photo that
//     did not survive the wire intact is not evidence.
//   * every accepted entry's chain hash covers the one before it, so the log
//     can only be appended to. Delete or reorder anything and `Verify` says so.
//   * annotations are stored as marks NEXT TO the photo, never drawn into it.
//     The evidence has to stay the thing the sensor produced.
//   * only the stamp, the hashes and a small thumbnail go to storage — via
//     `storageAdd`, which appends a version rather than replacing the last.
//     The full-resolution photos live in this browser until the report is
//     exported, and never touch the platform's servers.
// ============================================================================

const FS = window.Fieldstamp;

class FieldstampInspector extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'fieldstamp',
            customType: 'fieldstamp',
            autoCreateDataChannel: true,
            dataChannelName: 'fieldstamp-data',
            dataChannelOptions: { ordered: true },
        });

        this.ref = '';                 // the claim or job reference
        this.template = 'motor';
        this.prompts = [];             // [{text, done}]
        this.entries = [];             // the evidence log, in order
        this.genesis = '';
        this.full = new Map();         // id -> full-resolution data URL (this browser only)
        this.pending = new Map();      // id -> {stamp, imageHash, prompt}
        this.reasm = new FS.Reassembler();
        this.claimant = null;
        this.rejected = 0;
        this.viewing = null;
        this.ended = false;
    }

    async onInitialize() { this.setupUI(); }

    onConnect() {
        setTimeout(() => {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
        }, 700);

        this.ref = this.channelName || 'session';
        this.genesis = 'fieldstamp:' + this.ref;
        document.getElementById('sessionRef').textContent = this.ref;
        document.getElementById('shareBtn').hidden = false;

        this.listenForVideo();
        this.loadLog();
        this.render();
    }

    onUserJoin(detail) {
        const who = detail && (detail.username || detail.name || detail.agentName);
        if (who && who !== this.username) {
            this.claimant = who;
            this.setLink('waiting', `${who} joined. Waiting for their camera…`);
            this.render();
        }
    }

    onUserLeave() {
        this.claimant = null;
        this.setLink('gone', 'The other person has left the session.');
        this.render();
    }

    /**
     * The camera arrives as a WebRTC stream, which is a different event from
     * everything else in this app — it does not come through the data channel.
     */
    listenForVideo() {
        if (!this.webrtcHelper || this._listening) return;
        this._listening = true;
        this.webrtcHelper.on('remote-stream', (streamId, stream, from) => {
            const v = document.getElementById('liveVideo');
            v.srcObject = stream;
            v.play().catch(() => {});
            document.getElementById('noVideo').hidden = true;
            this.claimant = from || this.claimant;
            this.setLink('live', `Live from ${this.claimant || 'the other device'}`);
            this.render();
        });
    }

    onDataChannelMessage(peerId, data) {
        if (!data || typeof data !== 'object') return;
        switch (data.t) {
            case 'live':
                this.claimant = data.by || peerId;
                this.listenForVideo();
                break;
            case 'capture-meta':
                this.pending.set(data.id, { stamp: data.stamp, imageHash: data.imageHash, from: peerId });
                this.reasm.expect(data.id, data.chunks);
                this.setLink('live', `Receiving a photo (${FS.fmtBytes(data.stamp.bytes)})…`);
                break;
            case 'capture-chunk': {
                const whole = this.reasm.add(data.id, data.i, data.data);
                if (whole) this.acceptCapture(data.id, whole);
                break;
            }
            default: break;
        }
    }

    // ------------------------------------------------------- evidence

    /**
     * A capture is only evidence once the bytes that arrived hash to the value
     * the phone published for them.
     */
    async acceptCapture(id, dataUrl) {
        const meta = this.pending.get(id);
        this.pending.delete(id);
        if (!meta) return;

        const bytes = FS.dataUrlBytes(dataUrl);
        const check = await FS.sha256Hex(bytes.buffer);
        if (check !== meta.imageHash) {
            this.rejected += 1;
            this.toast('A photo arrived damaged and was rejected. Ask for it again.', 'error');
            this.render();
            return;
        }

        const prev = this.entries.length ? this.entries[this.entries.length - 1].chain : this.genesis;
        const chain = await FS.chainNext(prev, meta.imageHash, meta.stamp);
        const thumb = await FS.thumbnail(dataUrl, 320);

        const entry = {
            seq: this.entries.length + 1,
            id,
            stamp: meta.stamp,
            imageHash: meta.imageHash,
            chain,
            thumb,
            note: '',
            marks: [],
        };
        this.entries.push(entry);
        this.full.set(id, dataUrl);

        this.markPromptDone(meta.stamp.prompt);
        this.saveEntry(entry);
        if (this.claimant) this.sendData({ t: 'ack', id }, this.claimant);
        this.setLink('live', `Live from ${this.claimant || 'the other device'}`);
        this.render();
    }

    /** Append-only: storageAdd keeps every previous version of this key. */
    saveEntry(entry) {
        if (!this.channel) return;
        const record = {
            seq: entry.seq, id: entry.id, stamp: entry.stamp,
            imageHash: entry.imageHash, chain: entry.chain, thumb: entry.thumb,
        };
        this.channel.storageAdd({
            storageKey: this.logKey(),
            content: record,
            encrypted: false,
            metadata: { description: `Fieldstamp capture ${entry.seq} — ${this.ref}` },
        }, (res) => {
            if (!res || res.status !== 'success') {
                console.warn('[Fieldstamp] storageAdd failed:', res && res.statusMessage);
                this.toast('That capture is on screen but did not reach storage.', 'warning');
            }
        });
    }

    logKey() { return 'fieldstamp-' + this.ref; }

    /** Rebuild the log from storage — what a second inspector would see. */
    loadLog() {
        if (!this.channel) return;
        this.channel.storageGetList(this.logKey(), (res) => {
            if (!res || res.status !== 'success') return;
            const rows = FS.storedVersions(res);
            if (!rows.length) return;

            const restored = rows
                .map(FS.decodeStored)
                .filter(r => r && r.chain && r.stamp)
                .sort((a, b) => (a.seq || 0) - (b.seq || 0));

            if (!restored.length) return;
            // Only adopt stored entries we do not already hold live.
            const have = new Set(this.entries.map(e => e.id));
            restored.forEach(r => {
                if (have.has(r.id)) return;
                this.entries.push({ ...r, note: r.note || '', marks: [], restored: true });
            });
            this.entries.sort((a, b) => a.seq - b.seq);
            this.render();
            this.toast(`Restored ${restored.length} earlier capture${restored.length === 1 ? '' : 's'} from storage.`, 'info');
        });
    }

    async verify() {
        const out = document.getElementById('verifyResult');
        out.hidden = false;
        out.className = 'fs-verify';
        out.textContent = 'Checking…';

        const res = await FS.verifyChain(this.entries, this.genesis);
        if (!this.entries.length) {
            out.className = 'fs-verify';
            out.textContent = 'Nothing to check yet.';
            return;
        }
        if (res.ok) {
            out.className = 'fs-verify is-ok';
            out.textContent = `Intact. All ${this.entries.length} entries hash forward from the session genesis — nothing has been removed, reordered or edited.`;
        } else {
            out.className = 'fs-verify is-bad';
            out.textContent = `Broken at entry ${res.brokenAt + 1}. Expected ${res.expected.slice(0, 16)}…, found ${res.found.slice(0, 16)}…`;
        }
    }

    // ------------------------------------------------------- asking

    setTemplate(id) {
        this.template = id;
        const t = FS.TEMPLATES[id];
        this.prompts = (t ? t.prompts : []).map(text => ({ text, done: false }));
        this.render();
    }

    addPrompt(text) {
        if (!text || !text.trim()) return;
        this.prompts.push({ text: text.trim(), done: false });
        this.render();
    }

    ask(index) {
        const p = this.prompts[index];
        if (!p || !this.claimant) return;
        this.sendData({ t: 'prompt', text: p.text }, this.claimant);
        this.asking = index;
        this.render();
    }

    capture(index) {
        if (!this.claimant) { this.toast('Nobody has joined the session yet.', 'warning'); return; }
        const p = index === null || index === undefined ? null : this.prompts[index];
        const id = FS.shortId();
        if (p) this.sendData({ t: 'prompt', text: p.text }, this.claimant);
        this.sendData({ t: 'capture-request', id, prompt: p ? p.text : '' }, this.claimant);
        this.setLink('live', 'Asked for a photo…');
    }

    markPromptDone(text) {
        if (!text) return;
        const p = this.prompts.find(x => x.text === text);
        if (p) p.done = true;
    }

    endSession() {
        if (this.claimant) this.sendData({ t: 'ended', reason: 'The inspector closed the session.' }, this.claimant);
        this.ended = true;
        this.render();
        this.toast('Session closed. The report is still here.', 'info');
    }

    // ------------------------------------------------------- report

    /**
     * A single self-contained HTML file: every photo at full resolution, its
     * stamp, and the hash chain, plus the instructions to re-derive it. Print
     * it to PDF and it is the same document.
     */
    buildReport() {
        const esc = FS.escapeHtml;
        const rows = this.entries.map(e => {
            const img = this.full.get(e.id) || e.thumb;
            const g = e.stamp.geo;
            return `
            <section class="cap">
              <header>
                <h2>${e.seq}. ${esc(e.stamp.prompt || 'Capture')}</h2>
                <p class="when">${esc(e.stamp.time.local)} <span>(${esc(e.stamp.time.iso)}, ${esc(e.stamp.time.tz)})</span></p>
              </header>
              <img src="${img}" alt="Capture ${e.seq}">
              <dl>
                <dt>Taken by</dt><dd>${esc(e.stamp.by)}</dd>
                <dt>Device</dt><dd>${esc(e.stamp.device.hint)} · ${esc(e.stamp.device.platform)} · ${esc(e.stamp.device.screen)}</dd>
                <dt>Image</dt><dd>${e.stamp.width}×${e.stamp.height}, ${FS.fmtBytes(e.stamp.bytes)}, ${esc(e.stamp.mime)}</dd>
                <dt>Location</dt><dd>${g ? `${g.lat}, ${g.lon} (±${g.precision_m} m, shared with consent)` : 'not shared'}</dd>
                <dt>Image hash</dt><dd class="hash">${esc(e.imageHash)}</dd>
                <dt>Chain hash</dt><dd class="hash">${esc(e.chain)}</dd>
                ${e.note ? `<dt>Note</dt><dd>${esc(e.note)}</dd>` : ''}
              </dl>
            </section>`;
        }).join('');

        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Fieldstamp report — ${esc(this.ref)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.6 ui-serif, Georgia, serif; color: #16211f; background: #fff; margin: 0; padding: 40px; max-width: 900px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .meta { color: #5b6b67; font-size: 14px; margin: 0 0 28px; }
  .chainnote { background: #f2f5f3; border: 1px solid #dfe6e2; border-radius: 6px; padding: 14px 16px; font-size: 13px; margin-bottom: 32px; }
  .cap { border-top: 2px solid #16211f; padding-top: 14px; margin-bottom: 40px; page-break-inside: avoid; }
  .cap h2 { font-size: 18px; margin: 0 0 2px; }
  .when { margin: 0 0 12px; color: #5b6b67; font-size: 13px; }
  .when span { color: #8b9994; }
  .cap img { max-width: 100%; border: 1px solid #dfe6e2; border-radius: 4px; display: block; margin-bottom: 12px; }
  dl { display: grid; grid-template-columns: 130px 1fr; gap: 4px 16px; font-size: 13px; margin: 0; }
  dt { color: #5b6b67; }
  dd { margin: 0; }
  .hash { font-family: ui-monospace, Menlo, monospace; font-size: 11px; word-break: break-all; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>Inspection report — ${esc(this.ref)}</h1>
<p class="meta">${this.entries.length} capture${this.entries.length === 1 ? '' : 's'} ·
   inspector ${esc(this.username)} ·
   ${this.claimant ? 'with ' + esc(this.claimant) : 'no other party recorded'} ·
   generated ${esc(new Date().toLocaleString())}</p>
<div class="chainnote">
  <strong>How to check this report has not been altered.</strong>
  Each capture carries the SHA-256 of its own image bytes and a chain hash.
  The chain hash is <code>SHA-256(previous chain hash + "|" + image hash + "|" + canonical stamp JSON)</code>,
  where the stamp is serialised with its keys sorted, and the first entry's previous value is
  <code>${esc(this.genesis)}</code>. Recompute the chain from the top: if any capture has been
  removed, reordered or edited, every hash after it stops matching.
  The live video in this session was peer-to-peer and was never recorded or uploaded.
</div>
${rows || '<p>No captures were taken.</p>'}
</body></html>`;
    }

    exportReport() {
        if (!this.entries.length) { this.toast('There is nothing to export yet.', 'warning'); return; }
        const blob = new Blob([this.buildReport()], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fieldstamp-${this.ref}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        this.toast('Report saved. Open it and print to PDF.', 'success');
    }

    // ------------------------------------------------------- UI

    setupUI() {
        const $ = id => document.getElementById(id);

        const tpl = $('templateSelect');
        FS.TEMPLATE_ORDER.forEach(id => {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = FS.TEMPLATES[id].name;
            tpl.appendChild(o);
        });
        tpl.value = 'motor';
        tpl.addEventListener('change', () => this.setTemplate(tpl.value));
        this.setTemplate('motor');

        $('addPromptBtn').addEventListener('click', () => {
            const input = $('newPrompt');
            this.addPrompt(input.value);
            input.value = '';
        });
        $('newPrompt').addEventListener('keydown', e => {
            if (e.key === 'Enter') { this.addPrompt(e.target.value); e.target.value = ''; }
        });

        $('captureNowBtn').addEventListener('click', () => this.capture(null));
        $('verifyBtn').addEventListener('click', () => this.verify());
        $('exportBtn').addEventListener('click', () => this.exportReport());
        $('endBtn').addEventListener('click', () => this.endSession());
        $('closeViewer').addEventListener('click', () => this.closeViewer());
        $('viewerNote').addEventListener('input', e => {
            const entry = this.entries.find(x => x.id === this.viewing);
            if (entry) entry.note = e.target.value;
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.viewing) this.closeViewer();
        });
    }

    render() {
        this.renderPrompts();
        this.renderLog();
        this.renderCounts();
        const ready = !!this.claimant && !this.ended;
        document.getElementById('captureNowBtn').disabled = !ready;
        document.getElementById('endBtn').disabled = this.ended;
    }

    renderPrompts() {
        const el = document.getElementById('promptList');
        if (!el) return;
        if (!this.prompts.length) {
            el.innerHTML = '<li class="fs-empty">No prompts. Add one below, or pick a template.</li>';
            return;
        }
        el.innerHTML = this.prompts.map((p, i) => `
            <li class="fs-prompt${p.done ? ' is-done' : ''}">
                <span class="fs-prompt__tick" aria-hidden="true">${p.done ? '✓' : ''}</span>
                <span class="fs-prompt__text">${FS.escapeHtml(p.text)}</span>
                <button type="button" class="btn btn--sm fs-ask" data-i="${i}">Ask</button>
                <button type="button" class="btn btn--sm btn--primary fs-cap" data-i="${i}">Capture</button>
            </li>`).join('');
        el.querySelectorAll('.fs-ask').forEach(b =>
            b.addEventListener('click', () => this.ask(parseInt(b.dataset.i, 10))));
        el.querySelectorAll('.fs-cap').forEach(b =>
            b.addEventListener('click', () => this.capture(parseInt(b.dataset.i, 10))));
    }

    renderLog() {
        const el = document.getElementById('evidenceLog');
        if (!el) return;
        if (!this.entries.length) {
            el.innerHTML = '<li class="fs-empty">Nothing captured yet.</li>';
            return;
        }
        el.innerHTML = this.entries.map(e => `
            <li class="fs-entry" data-id="${FS.escapeHtml(e.id)}">
                <img class="fs-entry__thumb" src="${e.thumb || ''}" alt="Capture ${e.seq}">
                <div class="fs-entry__body">
                    <div class="fs-entry__head">
                        <span class="fs-entry__seq">${e.seq}</span>
                        <span class="fs-entry__prompt">${FS.escapeHtml(e.stamp.prompt || 'Capture')}</span>
                    </div>
                    <div class="fs-entry__meta">
                        ${FS.escapeHtml(e.stamp.time.local)}
                        ${e.stamp.geo ? ` · ${e.stamp.geo.lat}, ${e.stamp.geo.lon}` : ' · no location'}
                        ${e.restored ? ' · from storage' : ''}
                    </div>
                    <div class="fs-entry__hash">chain ${FS.escapeHtml(e.chain.slice(0, 20))}…</div>
                </div>
            </li>`).join('');
        el.querySelectorAll('.fs-entry').forEach(li =>
            li.addEventListener('click', () => this.openViewer(li.dataset.id)));
    }

    renderCounts() {
        document.getElementById('captureCount').textContent = this.entries.length;
        const rej = document.getElementById('rejectCount');
        rej.hidden = this.rejected === 0;
        rej.textContent = `${this.rejected} rejected`;
    }

    openViewer(id) {
        const e = this.entries.find(x => x.id === id);
        if (!e) return;
        this.viewing = id;
        const full = this.full.get(id);
        document.getElementById('viewerImg').src = full || e.thumb || '';
        document.getElementById('viewerTitle').textContent = `${e.seq}. ${e.stamp.prompt || 'Capture'}`;
        document.getElementById('viewerNote').value = e.note || '';
        document.getElementById('viewerStamp').innerHTML = `
            <dl class="fs-stamp">
                <dt>Time</dt><dd>${FS.escapeHtml(e.stamp.time.local)} <span class="fs-dim">${FS.escapeHtml(e.stamp.time.iso)}</span></dd>
                <dt>By</dt><dd>${FS.escapeHtml(e.stamp.by)}</dd>
                <dt>Device</dt><dd>${FS.escapeHtml(e.stamp.device.hint)} · ${FS.escapeHtml(e.stamp.device.screen)}</dd>
                <dt>Image</dt><dd>${e.stamp.width}×${e.stamp.height} · ${FS.fmtBytes(e.stamp.bytes)}</dd>
                <dt>Location</dt><dd>${e.stamp.geo ? `${e.stamp.geo.lat}, ${e.stamp.geo.lon} <span class="fs-dim">±${e.stamp.geo.precision_m} m</span>` : '<span class="fs-dim">not shared</span>'}</dd>
                <dt>Image hash</dt><dd class="fs-hash">${FS.escapeHtml(e.imageHash)}</dd>
                <dt>Chain hash</dt><dd class="fs-hash">${FS.escapeHtml(e.chain)}</dd>
            </dl>
            ${full ? '' : '<p class="fs-dim">Only the thumbnail is here — this entry was restored from storage, and full-resolution photos are never uploaded.</p>'}`;
        document.getElementById('viewer').hidden = false;
    }

    closeViewer() {
        this.viewing = null;
        document.getElementById('viewer').hidden = true;
    }

    setLink(state, text) {
        const pill = document.getElementById('linkPill');
        if (!pill) return;
        pill.className = 'pill-status ' + (state === 'live' ? 'is-live' : state === 'waiting' ? 'is-busy' : 'is-off');
        pill.innerHTML = '<span class="pill-status__dot"></span>' + FS.escapeHtml(text);
    }

    toast(msg, type) { this.showToast(msg, type || 'info', 4000); }
}

// ---------------------------------------------------------------- bootstrap

let fsInspector = null;

async function connectInspector(username, channel, password) {
    try {
        fsInspector = new FieldstampInspector();
        window.fsInspector = fsInspector;
        await fsInspector.initialize();
        await fsInspector.connect({ username, channelName: channel, channelPassword: password });
        fsInspector.start();

        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' +
                    channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }
    } catch (error) {
        console.error('[Fieldstamp] connect failed:', error);
        if (window.ConnectionModal) ConnectionModal.fail(error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.loadConnectionModal({
        localStoragePrefix: 'fsinsp_',
        channelPrefix: 'fs-',
        title: 'Open an inspection',
        collapsedTitle: 'Fieldstamp',
        onConnect: function (username, channel, password) {
            connectInspector(username, channel, password);
        },
    });

    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'FieldstampInspector',
            storagePrefix: 'fsinsp_',
            connectCallback: async function () {
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';
                if (username && channel) await connectInspector(username, channel, password);
            },
        });
    }

    setTimeout(() => {
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.add('active');
    }, 200);
});
