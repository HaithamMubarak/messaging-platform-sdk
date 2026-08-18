/**
 * Messaging Platform SDK — shared UI kit.
 *
 * Provides the primitives the developer portal, admin console and landing page
 * all need: HTML escaping, toasts, focus-trapped modals, confirm dialogs,
 * one-time secret reveal, clipboard, formatters and table state rendering.
 *
 * Nothing here ever injects untrusted data as HTML. `UI.esc` is the only
 * sanctioned way to interpolate server data into a template string, and
 * `UI.text` / `UI.el` are the preferred alternatives.
 */
const UI = (function () {
    'use strict';

    /* ---------------------------------------------------------------- escape */

    const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

    /** Escape a value for safe interpolation into HTML text or attributes. */
    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
    }

    /** Create an element with attributes and text/children. Never parses HTML. */
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach((k) => {
                const v = attrs[k];
                if (v === null || v === undefined || v === false) return;
                if (k === 'class') node.className = v;
                else if (k === 'text') node.textContent = v;
                else if (k === 'html') node.innerHTML = v;      // caller-owned, static only
                else if (k.startsWith('on') && typeof v === 'function') {
                    node.addEventListener(k.slice(2).toLowerCase(), v);
                } else node.setAttribute(k, v === true ? '' : v);
            });
        }
        (Array.isArray(children) ? children : children ? [children] : []).forEach((c) => {
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    /* -------------------------------------------------------------- formatters */

    function fmtNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n.toLocaleString() : '—';
    }

    function fmtDate(value, opts) {
        if (!value) return '—';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '—';
        if (opts === 'date') return d.toLocaleDateString();
        return d.toLocaleDateString() + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /** Relative time ("2 h ago"); falls back to absolute for anything older than a week. */
    function fmtRelative(value) {
        if (!value) return '—';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '—';
        const secs = Math.round((Date.now() - d.getTime()) / 1000);
        if (secs < 60) return 'just now';
        if (secs < 3600) return Math.floor(secs / 60) + ' min ago';
        if (secs < 86400) return Math.floor(secs / 3600) + ' h ago';
        if (secs < 604800) return Math.floor(secs / 86400) + ' d ago';
        return fmtDate(value, 'date');
    }

    function fmtBytes(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0, v = n;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
    }

    function fmtMB(mb) {
        const n = Number(mb);
        if (!Number.isFinite(n)) return '—';
        return n >= 1024 ? (n / 1024).toFixed(2) + ' GB' : n.toFixed(n < 10 ? 2 : 1) + ' MB';
    }

    /** Percentage guarded against missing/zero limits — returns null when unknown. */
    function pct(used, limit) {
        const u = Number(used), l = Number(limit);
        if (!Number.isFinite(u) || !Number.isFinite(l) || l <= 0) return null;
        return Math.min(100, Math.max(0, (u / l) * 100));
    }

    function truncate(str, max) {
        const s = String(str == null ? '' : str);
        return s.length > max ? s.slice(0, max - 1) + '…' : s;
    }

    /* ------------------------------------------------------------------ icons */

    function iconMarkup(name, cls) {
        return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
    }

    function iconNode(name, cls) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-' + name);
        svg.appendChild(use);
        return svg;
    }

    /* ----------------------------------------------------------------- toasts */

    let politeRegion = null;
    let assertiveRegion = null;

    function region(assertive) {
        let node = assertive ? assertiveRegion : politeRegion;
        if (node && node.isConnected) return node;
        node = el('div', {
            class: 'toast-region',
            role: assertive ? 'alert' : 'status',
            'aria-live': assertive ? 'assertive' : 'polite'
        });
        document.body.appendChild(node);
        if (assertive) assertiveRegion = node; else politeRegion = node;
        return node;
    }

    const TOAST_ICON = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };

    /**
     * Show a toast. `message` is always rendered as text — never HTML.
     * Errors are assertive and persist until dismissed.
     */
    function toast(message, options) {
        const opts = options || {};
        const type = opts.type || 'info';
        const isError = type === 'error';
        const timeout = opts.timeout !== undefined ? opts.timeout : (isError ? 0 : 5000);

        const node = el('div', { class: 'toast toast--' + type });
        node.appendChild(iconNode(TOAST_ICON[type] || 'info', 'toast__icon'));
        node.appendChild(el('p', { class: 'toast__msg', text: String(message) }));

        let timer = null;
        const dismiss = () => { if (timer) clearTimeout(timer); node.remove(); };

        if (opts.action && typeof opts.onAction === 'function') {
            node.appendChild(el('button', {
                class: 'btn btn--sm btn--ghost', text: opts.action,
                onclick: () => { dismiss(); opts.onAction(); }
            }));
        }

        const close = el('button', { class: 'toast__close', 'aria-label': 'Dismiss', onclick: dismiss });
        close.appendChild(iconNode('x', 'icon--sm'));
        node.appendChild(close);

        const host = region(isError);
        host.appendChild(node);
        while (host.children.length > 3) host.firstElementChild.remove();

        if (timeout > 0) {
            const start = () => { timer = setTimeout(dismiss, timeout); };
            const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
            node.addEventListener('mouseenter', stop);
            node.addEventListener('focusin', stop);
            node.addEventListener('mouseleave', start);
            node.addEventListener('focusout', start);
            start();
        }
        return dismiss;
    }

    toast.success = (m, o) => toast(m, Object.assign({ type: 'success' }, o));
    toast.error   = (m, o) => toast(m, Object.assign({ type: 'error' }, o));
    toast.warning = (m, o) => toast(m, Object.assign({ type: 'warning' }, o));
    toast.info    = (m, o) => toast(m, Object.assign({ type: 'info' }, o));

    /* ----------------------------------------------------------------- modals */

    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    /**
     * Mount a focus-trapped, ESC-closable dialog.
     * `build(close)` returns the .modal__card element.
     */
    function openModal(build, options) {
        const opts = options || {};
        const opener = document.activeElement;

        const root = el('div', { class: 'modal' });
        const scrim = el('div', { class: 'modal__scrim' });
        root.appendChild(scrim);

        let closed = false;
        function close(result) {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKey, true);
            root.remove();
            if (!document.querySelector('.modal')) document.body.classList.remove('modal-open');
            if (opener && typeof opener.focus === 'function') opener.focus();
            if (typeof opts.onClose === 'function') opts.onClose(result);
        }

        function onKey(e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(null); return; }
            if (e.key !== 'Tab') return;
            const items = Array.from(root.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null);
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }

        const card = build(close);
        root.appendChild(card);
        document.body.appendChild(root);
        document.body.classList.add('modal-open');
        document.addEventListener('keydown', onKey, true);

        // Scrim dismissal is disabled for destructive dialogs.
        if (!opts.persistent) scrim.addEventListener('click', () => close(null));

        const target = card.querySelector('[data-autofocus]') || card.querySelector(FOCUSABLE);
        if (target) target.focus();

        return { root, card, close };
    }

    /** Build a standard modal card with header / body / actions. */
    function modalCard(opts, close) {
        const card = el('div', {
            class: 'modal__card' + (opts.wide ? ' modal__card--wide' : '') + (opts.danger ? ' modal__card--danger' : ''),
            role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': opts.titleId || 'modal-title'
        });

        const header = el('div', { class: 'modal__header' });
        header.appendChild(el('h2', { class: 'modal__title', id: opts.titleId || 'modal-title', text: opts.title }));
        if (opts.dismissible !== false) {
            const btn = el('button', { class: 'modal__close', 'aria-label': 'Close', onclick: () => close(null) });
            btn.appendChild(iconNode('x'));
            header.appendChild(btn);
        }
        card.appendChild(header);

        const body = el('div', { class: 'modal__body' });
        (Array.isArray(opts.body) ? opts.body : [opts.body]).forEach((n) => n && body.appendChild(n));
        card.appendChild(body);

        if (opts.actions && opts.actions.length) {
            const actions = el('div', { class: 'modal__actions' });
            opts.actions.forEach((a) => actions.appendChild(a));
            card.appendChild(actions);
        }
        return card;
    }

    /**
     * Confirm dialog. Resolves true only when the user explicitly confirms.
     *
     * options: { title, body, confirmLabel, cancelLabel, danger,
     *            typeToConfirm, reasonRequired, onConfirm }
     * When `onConfirm` is supplied it runs inside the dialog with an in-flight
     * button state, so the dialog stays open if the request fails.
     */
    function confirm(options) {
        const opts = options || {};
        return new Promise((resolve) => {
            let settled = false;
            const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

            openModal((close) => {
                const body = [];
                body.push(el('p', { text: opts.body || 'This action cannot be undone.' }));

                let reasonInput = null;
                if (opts.reasonRequired) {
                    const field = el('div', { class: 'field', style: 'margin-top:1rem' });
                    field.appendChild(el('label', { class: 'field__label', for: 'ui-confirm-reason', text: 'Reason' }));
                    reasonInput = el('textarea', {
                        class: 'field__textarea', id: 'ui-confirm-reason',
                        placeholder: 'Recorded in the audit log', rows: '2'
                    });
                    field.appendChild(reasonInput);
                    body.push(field);
                }

                let typeInput = null;
                if (opts.typeToConfirm) {
                    const field = el('div', { class: 'field', style: 'margin-top:1rem' });
                    field.appendChild(el('label', {
                        class: 'field__label', for: 'ui-confirm-type',
                        text: 'Type ' + opts.typeToConfirm + ' to confirm'
                    }));
                    typeInput = el('input', {
                        class: 'field__input', id: 'ui-confirm-type', type: 'text',
                        autocomplete: 'off', spellcheck: 'false', 'data-autofocus': true
                    });
                    field.appendChild(typeInput);
                    body.push(field);
                }

                const errorLine = el('p', { class: 'field__error', style: 'display:none;margin-top:.75rem' });
                body.push(errorLine);

                const cancel = el('button', {
                    class: 'btn btn--ghost', text: opts.cancelLabel || 'Cancel',
                    onclick: () => { finish(false); close(false); }
                });
                const confirmBtn = el('button', {
                    class: 'btn ' + (opts.danger ? 'btn--danger-solid' : 'btn--primary'),
                    text: opts.confirmLabel || 'Confirm'
                });

                function valid() {
                    if (opts.typeToConfirm && typeInput.value.trim() !== opts.typeToConfirm) return false;
                    if (opts.reasonRequired && !reasonInput.value.trim()) return false;
                    return true;
                }
                function sync() { confirmBtn.disabled = !valid(); }
                if (typeInput) typeInput.addEventListener('input', sync);
                if (reasonInput) reasonInput.addEventListener('input', sync);
                sync();

                confirmBtn.addEventListener('click', async () => {
                    if (!valid()) return;
                    const payload = { reason: reasonInput ? reasonInput.value.trim() : null };
                    if (typeof opts.onConfirm !== 'function') { finish(payload); close(payload); return; }

                    errorLine.style.display = 'none';
                    confirmBtn.dataset.busy = 'true';
                    cancel.disabled = true;
                    try {
                        await opts.onConfirm(payload);
                        finish(payload);
                        close(payload);
                    } catch (err) {
                        errorLine.textContent = (err && err.message) || 'The action failed. Please try again.';
                        errorLine.style.display = 'block';
                        delete confirmBtn.dataset.busy;
                        cancel.disabled = false;
                    }
                });

                const card = modalCard({
                    title: opts.title || 'Are you sure?',
                    danger: opts.danger,
                    dismissible: false,
                    body: body,
                    actions: [cancel, confirmBtn]
                }, close);

                if (!typeInput) cancel.setAttribute('data-autofocus', '');
                return card;
            }, { persistent: true, onClose: () => finish(false) });
        });
    }

    /**
     * Show a credential exactly once: masked by default, copyable, and only
     * dismissible after the user acknowledges they stored it. The value is
     * removed from the DOM on close.
     */
    function showSecret(options) {
        const opts = options || {};
        return openModal((close) => {
            const body = [];
            body.push(el('p', { text: opts.description || 'This value is shown only once. Store it somewhere safe before closing this dialog.' }));

            const box = el('div', { class: 'secret-box', style: 'margin-top:1rem' });
            const code = el('code', { text: '•'.repeat(Math.min(48, String(opts.value).length)) });
            code.dataset.masked = 'true';
            box.appendChild(code);

            const revealBtn = el('button', { class: 'btn btn--icon btn--ghost', 'aria-label': 'Reveal value' });
            revealBtn.appendChild(iconNode('eye', 'icon--sm'));
            revealBtn.addEventListener('click', () => {
                const masked = code.dataset.masked === 'true';
                code.dataset.masked = masked ? 'false' : 'true';
                code.textContent = masked ? opts.value : '•'.repeat(Math.min(48, String(opts.value).length));
                revealBtn.innerHTML = '';
                revealBtn.appendChild(iconNode(masked ? 'eye-off' : 'eye', 'icon--sm'));
                revealBtn.setAttribute('aria-label', masked ? 'Hide value' : 'Reveal value');
            });
            box.appendChild(revealBtn);

            const copyBtn = el('button', { class: 'btn btn--icon btn--ghost', 'aria-label': 'Copy to clipboard' });
            copyBtn.appendChild(iconNode('copy', 'icon--sm'));
            copyBtn.addEventListener('click', () => copy(opts.value, opts.copyLabel || 'Copied'));
            box.appendChild(copyBtn);
            body.push(box);

            if (opts.meta) body.push(el('p', { class: 'field__hint', text: opts.meta }));

            const ack = el('input', { type: 'checkbox', id: 'ui-secret-ack' });
            const ackRow = el('label', {
                class: 'field__hint',
                for: 'ui-secret-ack',
                style: 'display:flex;gap:.5rem;align-items:center;margin-top:1rem;cursor:pointer'
            });
            ackRow.appendChild(ack);
            ackRow.appendChild(document.createTextNode(opts.ackLabel || 'I have securely stored this value'));
            body.push(ackRow);

            const done = el('button', { class: 'btn btn--primary', text: 'Done', disabled: true });
            ack.addEventListener('change', () => { done.disabled = !ack.checked; });
            done.addEventListener('click', () => { code.textContent = ''; close(true); });

            return modalCard({
                title: opts.title || 'Save this value now',
                dismissible: false,
                body: body,
                actions: [done]
            }, close);
        }, { persistent: true });
    }

    /* -------------------------------------------------------------- clipboard */

    async function copy(value, successMessage) {
        const text = String(value == null ? '' : value);
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                // Fallback for non-secure contexts where the async API is absent.
                const ta = el('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                ta.remove();
                if (!ok) throw new Error('Copy command rejected');
            }
            toast.success(successMessage || 'Copied to clipboard');
            return true;
        } catch (err) {
            toast.error('Could not copy automatically. Select the value and copy it manually.');
            return false;
        }
    }

    /* ------------------------------------------------------- table/card states */

    /** Replace a <tbody> with skeleton rows while data loads. */
    function tableLoading(tbody, columns, rows) {
        tbody.setAttribute('aria-busy', 'true');
        tbody.dataset.state = 'loading';
        tbody.innerHTML = '';
        for (let r = 0; r < (rows || 5); r++) {
            const tr = el('tr');
            for (let c = 0; c < columns; c++) {
                const td = el('td');
                td.appendChild(el('span', { class: 'skeleton', style: 'width:' + (45 + ((r + c) % 4) * 15) + '%' }));
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
    }

    function stateRow(tbody, columns, opts) {
        tbody.removeAttribute('aria-busy');
        tbody.dataset.state = opts.kind;
        tbody.innerHTML = '';
        const td = el('td', {
            colspan: columns,
            class: 'state-cell' + (opts.kind === 'error' ? ' state-cell--error' : '')
        });
        td.appendChild(iconNode(opts.icon || (opts.kind === 'error' ? 'alert-circle' : 'inbox')));
        td.appendChild(el('div', { class: 'state-title', text: opts.title }));
        if (opts.body) td.appendChild(el('div', { class: 'state-body', text: opts.body }));
        if (opts.actionLabel && typeof opts.onAction === 'function') {
            td.appendChild(el('button', {
                class: 'btn btn--ghost btn--sm', text: opts.actionLabel, onclick: opts.onAction
            }));
        }
        const tr = el('tr', opts.kind === 'error' ? { role: 'alert' } : null, td);
        tbody.appendChild(tr);
    }

    const tableEmpty = (tbody, columns, opts) => stateRow(tbody, columns, Object.assign({ kind: 'empty' }, opts));
    const tableError = (tbody, columns, opts) => stateRow(tbody, columns, Object.assign({
        kind: 'error', title: 'Could not load this data', actionLabel: 'Retry'
    }, opts));

    /* ------------------------------------------------------------ button state */

    async function withBusy(button, fn) {
        if (!button || button.dataset.busy === 'true') return;
        button.dataset.busy = 'true';
        button.disabled = true;
        try {
            return await fn();
        } finally {
            delete button.dataset.busy;
            button.disabled = false;
        }
    }

    /* -------------------------------------------------------------- app shell */

    /** Wire the mobile drawer for the console shell. */
    function initShell() {
        const shell = document.querySelector('.shell');
        if (!shell) return;
        const btn = shell.querySelector('.shell__menu-btn');
        const scrim = shell.querySelector('.shell__scrim');
        const setOpen = (open) => {
            shell.dataset.navOpen = open ? 'true' : 'false';
            if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        if (btn) btn.addEventListener('click', () => setOpen(shell.dataset.navOpen !== 'true'));
        if (scrim) scrim.addEventListener('click', () => setOpen(false));
        shell.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => setOpen(false)));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
        setOpen(false);
    }

    /* ----------------------------------------------------------------- charts */

    /**
     * Dependency-free bar chart. `series` is [{ label, value, title }].
     * Columns are focusable and carry an accessible name.
     */
    function renderBarChart(container, series, opts) {
        const options = opts || {};
        container.innerHTML = '';
        if (!series || !series.length) {
            container.appendChild(el('p', { class: 'field__hint', text: options.emptyText || 'No activity recorded yet.' }));
            return;
        }
        const max = Math.max(1, ...series.map((p) => Number(p.value) || 0));
        const bars = el('div', { class: 'chart__bars', role: 'list' });
        series.forEach((p) => {
            const value = Number(p.value) || 0;
            const col = el('div', {
                class: 'chart__col', role: 'listitem', tabindex: '0',
                'aria-label': (p.title || p.label) + ': ' + fmtNumber(value) + (options.unit ? ' ' + options.unit : '')
            });
            col.appendChild(el('span', { class: 'chart__tip', text: fmtNumber(value) }));
            const track = el('div', { class: 'chart__track' });
            track.appendChild(el('div', { class: 'chart__bar', style: '--h:' + Math.round((value / max) * 100) + '%' }));
            col.appendChild(track);
            col.appendChild(el('span', { class: 'chart__label', text: p.label }));
            bars.appendChild(col);
        });
        const figure = el('figure', { class: 'chart' });
        figure.appendChild(bars);
        const total = series.reduce((a, p) => a + (Number(p.value) || 0), 0);
        figure.appendChild(el('figcaption', {
            class: 'visually-hidden',
            text: 'Total ' + fmtNumber(total) + (options.unit ? ' ' + options.unit : '') + ' across ' + series.length + ' periods.'
        }));
        container.appendChild(figure);
    }

    /** Set a usage meter, handling unknown limits instead of rendering NaN. */
    function setMeter(meterEl, used, limit, formatter) {
        const fill = meterEl.querySelector('.meter__fill');
        const text = meterEl.querySelector('.meter__text');
        const value = pct(used, limit);
        const fmt = formatter || fmtNumber;

        if (value === null) {
            meterEl.dataset.level = 'unknown';
            meterEl.removeAttribute('aria-valuenow');
            if (fill) fill.style.width = '100%';
            if (text) text.textContent = 'Limit unavailable';
            return;
        }
        meterEl.dataset.level = value >= 90 ? 'danger' : value >= 75 ? 'warning' : 'ok';
        meterEl.setAttribute('aria-valuenow', Math.round(value));
        if (fill) fill.style.width = value + '%';
        if (text) text.innerHTML = '';
        if (text) {
            text.appendChild(el('strong', { text: fmt(used) }));
            text.appendChild(document.createTextNode(' / ' + fmt(limit)));
        }
        meterEl.setAttribute('aria-label', meterEl.getAttribute('aria-label') || 'Usage');
    }

    return {
        esc, el, text: (v) => document.createTextNode(String(v == null ? '' : v)),
        fmtNumber, fmtDate, fmtRelative, fmtBytes, fmtMB, pct, truncate,
        icon: iconMarkup, iconNode,
        toast, openModal, modalCard, confirm, showSecret, copy,
        tableLoading, tableEmpty, tableError, withBusy,
        initShell, renderBarChart, setMeter
    };
})();
