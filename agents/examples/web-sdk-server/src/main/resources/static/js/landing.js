/**
 * Landing page + playground behaviour: mobile nav, language tabs, copy buttons
 * and the API key request dialog.
 */
(function () {
    'use strict';

    function ready(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    /* ------------------------------------------------------------ mobile nav */

    function initNav() {
        const header = document.getElementById('siteHeader');
        const toggle = document.getElementById('navToggle');
        if (!header || !toggle) return;

        const setOpen = (open) => {
            header.dataset.open = open ? 'true' : 'false';
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        };
        toggle.addEventListener('click', () => setOpen(header.dataset.open !== 'true'));
        header.querySelectorAll('.site-nav a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
        setOpen(false);
    }

    /* ----------------------------------------------------------------- tabs */

    function initTabs() {
        document.querySelectorAll('[role="tablist"]').forEach((list) => {
            const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
            if (!tabs.length) return;

            function select(tab) {
                tabs.forEach((t) => {
                    const on = t === tab;
                    t.setAttribute('aria-selected', on ? 'true' : 'false');
                    t.tabIndex = on ? 0 : -1;
                    const panel = document.getElementById(t.getAttribute('aria-controls'));
                    if (panel) panel.hidden = !on;
                });
            }

            tabs.forEach((tab) => {
                tab.addEventListener('click', () => select(tab));
                tab.addEventListener('keydown', (e) => {
                    const i = tabs.indexOf(tab);
                    let next = null;
                    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
                    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
                    else if (e.key === 'Home') next = tabs[0];
                    else if (e.key === 'End') next = tabs[tabs.length - 1];
                    if (next) { e.preventDefault(); select(next); next.focus(); }
                });
            });
        });
    }

    /* ---------------------------------------------------------------- copy */

    function initCopy() {
        document.querySelectorAll('[data-copy-target]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const source = document.getElementById(btn.dataset.copyTarget);
                if (source) UI.copy(source.textContent.trim(), 'Snippet copied');
            });
        });
    }

    /* --------------------------------------------------- API key request form */

    const FIELDS = [
        { id: 'email',   label: 'Email',   type: 'email', required: true,
          placeholder: 'you@example.com', autocomplete: 'email' },
        { id: 'name',    label: 'Name',    type: 'text',  required: false,
          placeholder: 'Your name', autocomplete: 'name' },
        { id: 'company', label: 'Company', type: 'text',  required: false,
          placeholder: 'Acme Corp, university, or independent' }
    ];

    function buildField(spec) {
        const wrap = UI.el('div', { class: 'field' });
        const label = UI.el('label', { class: 'field__label', for: 'req-' + spec.id });
        label.appendChild(document.createTextNode(spec.label + ' '));
        label.appendChild(UI.el('span', {
            class: spec.required ? 'req' : 'opt',
            text: spec.required ? '*' : '(optional)'
        }));
        wrap.appendChild(label);

        const input = UI.el('input', {
            class: 'field__input',
            id: 'req-' + spec.id,
            name: spec.id,
            type: spec.type,
            placeholder: spec.placeholder,
            autocomplete: spec.autocomplete || 'off',
            required: spec.required || null
        });
        wrap.appendChild(input);
        wrap.appendChild(UI.el('p', { class: 'field__error', id: 'req-' + spec.id + '-err' }));
        input.setAttribute('aria-describedby', 'req-' + spec.id + '-err');
        return { wrap, input };
    }

    function openRequestDialog() {
        UI.openModal((close) => {
            const form = UI.el('form', { id: 'apiKeyRequestForm', novalidate: true });
            const inputs = {};

            form.appendChild(UI.el('p', {
                style: 'margin-bottom:1.25rem',
                text: 'Tell us where to send your key. Requests are reviewed by hand, usually within a day, and the credentials arrive by email.'
            }));

            FIELDS.forEach((spec) => {
                const built = buildField(spec);
                inputs[spec.id] = built.input;
                form.appendChild(built.wrap);
            });

            const reasonWrap = UI.el('div', { class: 'field' });
            const reasonLabel = UI.el('label', { class: 'field__label', for: 'req-reason' });
            reasonLabel.appendChild(document.createTextNode('What are you building? '));
            reasonLabel.appendChild(UI.el('span', { class: 'opt', text: '(optional)' }));
            reasonWrap.appendChild(reasonLabel);
            const reason = UI.el('textarea', {
                class: 'field__textarea', id: 'req-reason', name: 'reason', rows: '3',
                placeholder: 'A multiplayer game, a collaborative editor, an IoT dashboard…'
            });
            reasonWrap.appendChild(reason);
            form.appendChild(reasonWrap);

            const submit = UI.el('button', { class: 'btn btn--gradient btn--block', type: 'submit', text: 'Submit request' });
            form.appendChild(submit);

            function setError(id, message) {
                const field = inputs[id].closest('.field');
                const err = field.querySelector('.field__error');
                if (message) {
                    field.dataset.state = 'invalid';
                    inputs[id].setAttribute('aria-invalid', 'true');
                    err.textContent = message;
                } else {
                    delete field.dataset.state;
                    inputs[id].removeAttribute('aria-invalid');
                    err.textContent = '';
                }
            }

            inputs.email.addEventListener('blur', () => {
                if (inputs.email.value && !inputs.email.checkValidity()) {
                    setError('email', 'Enter a valid email address.');
                } else setError('email', null);
            });

            form.addEventListener('submit', async (event) => {
                event.preventDefault();

                const email = inputs.email.value.trim();
                if (!email || !inputs.email.checkValidity()) {
                    setError('email', 'Enter a valid email address so we can send your key.');
                    inputs.email.focus();
                    return;
                }
                setError('email', null);

                await UI.withBusy(submit, async () => {
                    try {
                        const response = await fetch(ApiConfig.getApiKeyRequestUrl(), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: email,
                                name: inputs.name.value.trim() || null,
                                company: inputs.company.value.trim() || null,
                                reason: reason.value.trim() || null
                            })
                        });

                        let payload = null;
                        try { payload = await response.json(); } catch (e) { /* non-JSON error page */ }

                        if (!response.ok) {
                            throw new Error(
                                (payload && (payload.statusMessage || payload.message || payload.error)) ||
                                'Request failed (' + response.status + '). Please try again shortly.'
                            );
                        }

                        close(true);
                        UI.toast.success('Request received. Watch your inbox for the approval email.', { timeout: 8000 });
                    } catch (err) {
                        UI.toast.error(err.message || 'Could not submit your request. Please try again.');
                    }
                });
            });

            return UI.modalCard({
                title: 'Request an API key',
                titleId: 'request-modal-title',
                body: form
            }, close);
        });
    }

    function initRequestButtons() {
        document.querySelectorAll('[data-open-request]').forEach((btn) => {
            btn.addEventListener('click', openRequestDialog);
        });
    }

    ready(function () {
        initNav();
        initTabs();
        initCopy();
        initRequestButtons();
    });

    window.openApiKeyRequest = openRequestDialog;
})();
