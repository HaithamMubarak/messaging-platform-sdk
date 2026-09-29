/*
 * RecoveryPanel — the recovery phrase, as an app shows it. Needs recovery.js.
 *
 *   const recovery = RecoveryPanel.mount(document.getElementById('recoveryPanel'), {
 *       app: 'signet',                        // one phrase per app, per clinic
 *       channel: () => this.channel,          // a connected channel, to read Vault
 *       toast: (text, kind) => this.toast(text, kind),
 *   });
 *   const sealKey = await recovery.forSeal(); // null until a phrase is set up here
 *   // Receipts.store(channel, record, { ttlDays, key: sealKey.key })
 *   // meta: Object.assign(meta, sealKey.meta)   -> { recordId, recovery }
 *
 * Three things a clinic does with it: set a phrase up (shown once, confirmed
 * by typing its last group back), bring an existing phrase to another console
 * of the same clinic, and open a sealed record from its receipt with either
 * the phrase or the per-record key file older records came with. Vendored into
 * apps as vendor/sdk-ui/recovery-panel.js.
 */
(function (root) {
    'use strict';
    const R = () => root.Recovery;

    function html(el, markup) { el.innerHTML = markup; return el; }
    function part(el, name) { return el.querySelector('[data-rc="' + name + '"]'); }

    const PANEL = '<p class="rc-status" data-rc="status" role="status"></p>'
        + '<div class="rc-actions"><button class="btn btn--sm" type="button" data-rc="setup">Set up a recovery phrase</button>'
        + '<button class="btn btn--sm btn--ghost" type="button" data-rc="existing">Use an existing phrase</button></div>'
        + '<details class="rc-open"><summary>Open a sealed record</summary>'
        + '<label class="field"><span class="field__label">Its receipt (.json)</span><input class="field__input" type="file" accept=".json,application/json" data-rc="receipt"></label>'
        + '<label class="field" data-rc="pickwrap" hidden><span class="field__label">Which record</span><select class="field__input" data-rc="pick"></select></label>'
        + '<label class="field"><span class="field__label">Recovery phrase, or paste the record\'s key file</span><textarea class="field__input" rows="3" autocomplete="off" spellcheck="false" data-rc="secret"></textarea></label>'
        + '<button class="btn btn--sm" type="button" data-rc="open">Open the record</button>'
        + '<p class="rc-result" data-rc="result" role="status"></p><pre class="rc-record" data-rc="record" hidden></pre>'
        + '<button class="btn btn--sm btn--ghost" type="button" data-rc="download" hidden>Download the record</button></details>';

    const DIALOG = '<form method="dialog" class="rc-dialog"><h3 data-rc="title"></h3><p data-rc="lead"></p>'
        + '<p class="rc-phrase" data-rc="phrase"></p>'
        + '<label class="field"><span class="field__label" data-rc="asklabel"></span><input class="field__input" autocomplete="off" spellcheck="false" data-rc="ask"></label>'
        + '<p class="rc-result" data-rc="error" role="alert"></p>'
        + '<div class="rc-actions"><button class="btn btn--sm" type="button" data-rc="confirm">Save on this browser</button>'
        + '<button class="btn btn--sm btn--ghost" value="cancel" data-rc="cancel">Cancel</button></div></form>';

    const VAULT_GONE = /vault|expired|not found|404/i;

    class Panel {
        constructor(rootEl, opts) {
            this.root = html(rootEl, PANEL);
            this.opts = opts;
            this.saved = null; this.receipt = null; this.opened = null;
            this.dialog = html(document.createElement('dialog'), DIALOG);
            this.dialog.className = 'rc-modal';
            document.body.appendChild(this.dialog);
            this.wire();
            this.ready = this.refresh();
        }

        say(text) { part(this.root, 'result').textContent = text; }

        async refresh() {
            this.saved = await R().load(this.opts.app);
            part(this.root, 'status').textContent = this.saved
                ? 'Recovery phrase on (' + this.saved.fingerprint + '). Records sealed here can be reopened with the phrase and their receipt.'
                : 'No recovery phrase on this browser. A record sealed now can be opened only with its own key file.';
            part(this.root, 'setup').textContent = this.saved ? 'Set up a new phrase' : 'Set up a recovery phrase';
        }

        /** New phrase: shown once, kept only when its last group is typed back. */
        setUp() {
            const phrase = R().newPhrase();
            this.ask('Your recovery phrase',
                'Write this down and keep it with your records, offline. It is shown once and we keep no copy. '
                + 'With it and a receipt, anyone can open that record; without it, nobody can.'
                + (this.saved ? ' Records sealed under the current phrase (' + this.saved.fingerprint + ') will still need that one.' : ''),
                phrase, 'Type the last group to confirm you wrote it down',
                (typed) => {
                    if (typed.trim().toUpperCase() !== phrase.slice(-4)) throw new Error('That is not the last group.');
                    return phrase;
                });
        }

        useExisting() {
            this.ask('Your existing recovery phrase',
                'Every console of one clinic or home should use the same phrase, so any of them can reopen any record.',
                '', 'Recovery phrase', (typed) => R().normalise(typed));
        }

        ask(title, lead, phrase, label, accept) {
            const d = this.dialog;
            part(d, 'title').textContent = title; part(d, 'lead').textContent = lead;
            part(d, 'phrase').textContent = phrase; part(d, 'phrase').hidden = !phrase;
            part(d, 'asklabel').textContent = label; part(d, 'ask').value = ''; part(d, 'error').textContent = '';
            part(d, 'confirm').onclick = async () => {
                try {
                    const fp = await R().save(this.opts.app, await R().master(accept(part(d, 'ask').value), this.opts.app));
                    d.close();
                    await this.refresh();
                    this.opts.toast('Recovery phrase saved on this browser (' + fp + ').', 'ok');
                } catch (e) { part(d, 'error').textContent = e.message; }
            };
            if (d.showModal) d.showModal(); else d.setAttribute('open', '');
        }

        async readReceipt(file) {
            this.receipt = null; this.say('');
            try { this.receipt = R().sealedRecords(JSON.parse(await file.text())); } catch (e) { this.say('That file is not a receipt.'); return; }
            if (!this.receipt.length) { this.say('This receipt names no stored record.'); return; }
            const pick = part(this.root, 'pick');
            pick.innerHTML = '';
            this.receipt.forEach((r, i) => pick.add(new Option('Record ' + (r.index + 1) + (r.recordId ? '' : ' (key file only)'), String(i))));
            pick.value = String(this.receipt.length - 1);
            part(this.root, 'pickwrap').hidden = this.receipt.length < 2;
        }

        /** The key for one entry: from a pasted key file, or from the phrase. */
        async keyFor(entry, secret) {
            const file = R().readKeyFile(secret);
            if (file) {
                if (file.blobId !== entry.blobId) throw new Error('That key file is for a different record.');
                return file.key;
            }
            if (!entry.recordId) throw new Error('This record was sealed before recovery was set up; it opens only with its key file.');
            const master = await R().master(secret, this.opts.app);
            const fp = await R().fingerprint(master);
            if (entry.recovery && entry.recovery !== fp) {
                throw new Error('That phrase (' + fp + ') is not the one this record was sealed with (' + entry.recovery + ').');
            }
            return R().recordKey(master, entry.recordId);
        }

        async openRecord() {
            const channel = this.opts.channel();
            if (!this.receipt || !this.receipt.length) { this.say('Choose the record\'s receipt first.'); return; }
            if (!channel) { this.say('Connect to the room first: the record is read from its Vault.'); return; }
            const entry = this.receipt[Number(part(this.root, 'pick').value) || 0];
            try {
                const opened = await R().open(channel, entry, await this.keyFor(entry, part(this.root, 'secret').value));
                this.show(opened.text);
                this.say(opened.matches ? 'Opened. It matches the hash its receipt sealed.'
                    : 'Opened, but it does NOT match the hash its receipt sealed.');
            } catch (e) {
                this.show(null);
                this.say(VAULT_GONE.test(e.message)
                    ? 'The record could not be read from the Vault (' + e.message + '). Records are kept for 30 days.' : e.message);
            }
        }

        show(text) {
            const out = part(this.root, 'record');
            let pretty = text;
            try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* not JSON: show as is */ }
            this.opened = text;
            out.textContent = text === null ? '' : pretty;
            out.hidden = part(this.root, 'download').hidden = text === null;
        }

        download() {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([this.opened || ''], { type: 'application/json' }));
            a.download = this.opts.app + '-record.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }

        wire() {
            part(this.root, 'setup').addEventListener('click', () => this.setUp());
            part(this.root, 'existing').addEventListener('click', () => this.useExisting());
            part(this.root, 'receipt').addEventListener('change', (e) => { if (e.target.files[0]) this.readReceipt(e.target.files[0]); });
            part(this.root, 'open').addEventListener('click', () => this.openRecord());
            part(this.root, 'download').addEventListener('click', () => this.download());
        }

        /** A key and meta for the record about to be sealed, or null with no phrase here. */
        async forSeal() {
            await this.ready;
            if (!this.saved) return null;
            const recordId = R().newRecordId();
            return { key: await R().recordKey(this.saved.master, recordId), meta: { recordId, recovery: this.saved.fingerprint } };
        }
    }

    root.RecoveryPanel = { mount: (rootEl, opts) => new Panel(rootEl, opts) };
})(typeof window !== 'undefined' ? window : this);
