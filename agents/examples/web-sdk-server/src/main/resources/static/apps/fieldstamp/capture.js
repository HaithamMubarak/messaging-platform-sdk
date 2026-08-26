// ============================================================================
// Fieldstamp — the capture page.
//
// This is what the claimant, tenant or driver opens on their phone. There is
// no account, no app and nothing to learn: the camera comes on, the inspector
// tells them where to point it, and taps to take the picture.
//
// The photo is grabbed HERE, at the camera's own resolution, and hashed HERE
// before it travels — so the hash in the evidence log is a hash of what this
// sensor produced, not of a frame re-encoded out of a compressed video stream.
// The live video is peer-to-peer; the stills go over the data channel in
// chunks, because a phone photo is many times larger than one message.
// ============================================================================

const FS = window.Fieldstamp;

class FieldstampCapture extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'fieldstamp',
            customType: 'fieldstamp',
            autoCreateDataChannel: true,
            dataChannelName: 'fieldstamp-data',
            dataChannelOptions: { ordered: true },
        });

        this.stream = null;
        this.facing = 'environment';
        this.shareLocation = false;
        this.lastPosition = null;
        this.sent = 0;
        this.prompt = '';
        this.busy = false;
        this._offered = new Set();
    }

    async onInitialize() { this.setupUI(); }

    onConnect() {
        setTimeout(() => {
            if (window.ConnectionModal && window.ConnectionModal.hide) window.ConnectionModal.hide();
        }, 700);
        this.setStatus('Connected. Turning the camera on…');
        this.startCamera();
    }

    onUserJoin() { this.offerCamera(); }
    onDataChannelOpen() { this.offerCamera(); }

    onDataChannelMessage(peerId, data) {
        if (!data || typeof data !== 'object') return;
        // Only the inspector gives instructions. Anyone else is ignored.
        if (peerId !== this._getHostName()) return;

        switch (data.t) {
            case 'prompt':
                this.prompt = data.text || '';
                this.renderPrompt();
                break;
            case 'capture-request':
                this.takeAndSend(data.id, data.prompt);
                break;
            case 'ack':
                this.setStatus(`Sent. ${this.sent} photo${this.sent === 1 ? '' : 's'} on the record.`);
                break;
            case 'ended':
                this.finish(data.reason || 'The inspector ended the session.');
                break;
            default: break;
        }
    }

    // ------------------------------------------------------------- camera

    async startCamera() {
        try {
            if (this.stream) this.stream.getTracks().forEach(t => t.stop());
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: this.facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: true,
            });
            const v = document.getElementById('preview');
            v.srcObject = this.stream;
            await v.play().catch(() => {});
            if (this.webrtcHelper && this.webrtcHelper.setLocalMediaStream) {
                this.webrtcHelper.setLocalMediaStream(this.stream);
            }
            document.getElementById('cameraOff').hidden = true;
            this.setStatus('Camera on. Wait for the inspector.');
            this.offerCamera();
        } catch (err) {
            console.error('[Fieldstamp] camera refused:', err);
            document.getElementById('cameraOff').hidden = false;
            this.setStatus('The camera is blocked. Allow it in your browser, then reload.', true);
        }
    }

    /**
     * Offer the camera to the inspector. The stream id only exists once the
     * offer is made, so the inspector is told what it is afterwards.
     */
    async offerCamera() {
        if (!this.stream || !this.webrtcHelper || !this.connected) return;
        const host = this._getHostName();
        if (!host || host === this.username || this._offered.has(host)) return;
        this._offered.add(host);
        try {
            const id = await this.webrtcHelper.createStreamOffer(host, { stream: this.stream });
            this.sendData({ t: 'live', stream: id, by: this.username }, host);
            this.setStatus('The inspector can see you.');
        } catch (err) {
            this._offered.delete(host);
            console.warn('[Fieldstamp] could not offer the camera:', err.message);
        }
    }

    async flip() {
        this.facing = this.facing === 'environment' ? 'user' : 'environment';
        this._offered.clear();
        await this.startCamera();
    }

    // ------------------------------------------------------------- capture

    async takeAndSend(id, promptText) {
        if (this.busy) return;
        const video = document.getElementById('preview');
        const frame = FS.grabFrame(video, 0.92);
        if (!frame) { this.setStatus('The camera is not ready yet.', true); return; }

        this.busy = true;
        this.flash();
        this.setStatus('Sending…');

        try {
            const bytes = FS.dataUrlBytes(frame.dataUrl);
            const imageHash = await FS.sha256Hex(bytes.buffer);

            // Location is only read if the person turned it on, and it is
            // rounded before it is stamped, let alone sent.
            let geo = null;
            if (this.shareLocation) {
                geo = await FS.getPosition(7000);
                this.lastPosition = geo || this.lastPosition;
            }

            const stamp = {
                at: Date.now(),
                time: FS.stampTime(Date.now()),
                by: this.username,
                prompt: promptText || this.prompt || '',
                width: frame.w,
                height: frame.h,
                bytes: bytes.length,
                mime: 'image/jpeg',
                geo: geo,
                device: FS.deviceLabel(),
            };

            const parts = FS.chunk(frame.dataUrl);
            const host = this._getHostName();
            this.sendData({ t: 'capture-meta', id, stamp, imageHash, chunks: parts.length }, host);
            for (let i = 0; i < parts.length; i++) {
                this.sendData({ t: 'capture-chunk', id, i, data: parts[i] }, host);
                // Give the data channel room to drain between chunks.
                if (i % 4 === 3) await new Promise(r => setTimeout(r, 30));
            }

            this.sent += 1;
            document.getElementById('sentCount').textContent = this.sent;
            this.setStatus(`Sent. ${this.sent} photo${this.sent === 1 ? '' : 's'} on the record.`);
        } catch (err) {
            console.error('[Fieldstamp] capture failed:', err);
            this.setStatus('That photo did not send. The inspector can ask again.', true);
        } finally {
            this.busy = false;
        }
    }

    flash() {
        const f = document.getElementById('flash');
        if (!f) return;
        f.classList.remove('is-on');
        void f.offsetWidth;
        f.classList.add('is-on');
    }

    finish(reason) {
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        document.getElementById('liveView').hidden = true;
        document.getElementById('donePanel').hidden = false;
        document.getElementById('doneReason').textContent = reason;
        document.getElementById('doneCount').textContent =
            `${this.sent} photo${this.sent === 1 ? '' : 's'} went on the record.`;
    }

    // ------------------------------------------------------------- UI

    setupUI() {
        document.getElementById('flipBtn').addEventListener('click', () => this.flip());

        const geoToggle = document.getElementById('geoToggle');
        geoToggle.addEventListener('change', async () => {
            this.shareLocation = geoToggle.checked;
            const note = document.getElementById('geoNote');
            if (this.shareLocation) {
                note.textContent = 'Checking…';
                const p = await FS.getPosition(8000);
                if (p) {
                    this.lastPosition = p;
                    note.textContent = `Stamping about ${p.lat}, ${p.lon} — accurate to roughly ${p.precision_m} m.`;
                } else {
                    note.textContent = 'Your device would not give a location. Photos will be stamped without one.';
                    geoToggle.checked = false;
                    this.shareLocation = false;
                }
            } else {
                note.textContent = 'Off. Photos are stamped with the time only.';
            }
        });

        document.getElementById('retryCamera').addEventListener('click', () => this.startCamera());
        this.renderPrompt();
    }

    renderPrompt() {
        const el = document.getElementById('promptText');
        const box = document.getElementById('promptBox');
        if (!el || !box) return;
        if (this.prompt) {
            el.textContent = this.prompt;
            box.hidden = false;
        } else {
            box.hidden = true;
        }
    }

    setStatus(text, bad) {
        const el = document.getElementById('captureStatus');
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('is-bad', !!bad);
    }
}

// ---------------------------------------------------------------- bootstrap

let fsCapture = null;

async function connectCapture(username, channel, password) {
    try {
        fsCapture = new FieldstampCapture();
        window.fsCapture = fsCapture;
        await fsCapture.initialize();
        await fsCapture.connect({ username, channelName: channel, channelPassword: password });
        fsCapture.start();
    } catch (error) {
        console.error('[Fieldstamp] connect failed:', error);
        if (window.ConnectionModal) ConnectionModal.fail(error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.loadConnectionModal({
        localStoragePrefix: 'fscap_',
        channelPrefix: 'fs-',
        title: 'Join the inspection',
        collapsedTitle: 'Fieldstamp',
        onConnect: function (username, channel, password) {
            connectCapture(username, channel, password);
        },
    });

    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'FieldstampCapture',
            storagePrefix: 'fscap_',
            connectCallback: async function () {
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';
                if (username && channel) await connectCapture(username, channel, password);
            },
        });
    }

    setTimeout(() => {
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.add('active');
    }, 200);
});
