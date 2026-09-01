/**
 * A question you can answer without the page stopping.
 *
 * window.confirm(), alert() and prompt() block the event loop: no frame is
 * drawn, no timer runs, no message is read off the channel. In a single-player
 * form that is merely rude; in a room where other people are waiting for your
 * connection to keep answering, a dialog left open while somebody goes to make
 * tea drops them all.
 *
 * It brings its own stylesheet rather than depending on one. The apps that
 * need it are older than the design system, and adopting the whole UI kit
 * would restyle every button they already have.
 *
 *     const yes = await AppDialog.ask({title, body, confirmLabel, danger});
 *     const name = await AppDialog.askFor('New name', current);
 *     await AppDialog.tell('That file could not be read.');
 */
(function (window) {
    'use strict';

    // The stacking order across the site, since it is spread over three files:
    //   100000-100003  connection modal and share modal (connection-modal.css,
    //                  share-modal.css)
    //   100010         this dialog — it is raised BY those modals ("Regenerate
    //                  the channel?" comes off the connect card) and has to
    //                  cover whatever opened it. At 99999 it opened behind the
    //                  connection modal, which is a dialog nobody can answer.
    //   100020         toasts (toast.css), so a notice is never buried by a
    //                  dialog that is waiting on an answer.
    const DIALOG_CSS = `
.mgu-scrim{position:fixed;inset:0;z-index:100010;display:flex;align-items:center;justify-content:center;
 padding:16px;background:rgba(2,6,23,.72);backdrop-filter:blur(2px)}
.mgu-card{width:100%;max-width:420px;padding:20px;border-radius:12px;background:#101827;
 border:1px solid rgba(148,163,184,.22);box-shadow:0 24px 56px -16px rgba(2,6,23,.65);
 font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e2e8f0}
.mgu-card h3{margin:0 0 8px;font-size:16px;font-weight:700;color:#f8fafc}
.mgu-card p{margin:0;font-size:14px;line-height:1.55;color:#cbd5e1;overflow-wrap:anywhere}
.mgu-input{width:100%;margin-top:12px;padding:9px 11px;font:inherit;font-size:14px;color:#f8fafc;
 background:#0b1120;border:1px solid rgba(148,163,184,.3);border-radius:8px;outline:none;box-sizing:border-box}
.mgu-input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.25)}
.mgu-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}
.mgu-btn{min-height:38px;padding:8px 16px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;
 border-radius:8px;border:1px solid rgba(148,163,184,.3);background:#1e293b;color:#e2e8f0}
.mgu-btn:hover{background:#273449}
.mgu-btn--go{background:#6366f1;border-color:#6366f1;color:#fff}
.mgu-btn--go:hover{background:#4f46e5}
.mgu-btn--danger{background:#b91c1c;border-color:#b91c1c;color:#fff}
.mgu-btn--danger:hover{background:#991b1b}
.mgu-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(99,102,241,.45)}
`;

function mountDialogStyles() {
    if (document.getElementById('mgu-dialog-css')) return;
    const style = document.createElement('style');
    style.id = 'mgu-dialog-css';
    style.textContent = DIALOG_CSS;
    document.head.appendChild(style);
}

/**
 * @param {Object} opts {title, body, confirmLabel, cancelLabel, danger,
 *                       input:boolean, value, placeholder, cancellable,
 *                       confirmWord}
 *
 * `confirmWord` is for the handful of actions that cannot be undone by
 * anyone, ever. It shows the input, holds the confirm button disabled until
 * the field matches that word exactly, and leaves focus on Cancel -- so the
 * action cannot be reached by a reflex Enter, and cannot be reached at all
 * without reading. Enter does nothing until the word matches.
 * @returns {Promise<boolean|string|null>} the answer: true/false for a
 *          question, the text or null when `input` is set.
 */
function ask(opts) {
    opts = opts || {};
    mountDialogStyles();

    return new Promise(function (resolve) {
        const scrim = document.createElement('div');
        scrim.className = 'mgu-scrim';
        const card = document.createElement('div');
        card.className = 'mgu-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');

        if (opts.title) {
            const h = document.createElement('h3');
            h.textContent = opts.title;
            card.appendChild(h);
        }
        const p = document.createElement('p');
        p.textContent = opts.body || '';
        card.appendChild(p);

        let field = null;
        if (opts.confirmWord) opts.input = true;
        if (opts.input) {
            field = document.createElement('input');
            field.className = 'mgu-input';
            field.type = 'text';
            field.value = opts.value == null ? '' : String(opts.value);
            if (opts.placeholder) field.placeholder = opts.placeholder;
            card.appendChild(field);
        }

        const actions = document.createElement('div');
        actions.className = 'mgu-actions';

        const cancellable = opts.cancellable !== false;
        let cancelBtn = null;
        if (cancellable) {
            cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'mgu-btn';
            cancelBtn.textContent = opts.cancelLabel || 'Cancel';
            actions.appendChild(cancelBtn);
        }

        const goBtn = document.createElement('button');
        goBtn.type = 'button';
        goBtn.className = 'mgu-btn ' + (opts.danger ? 'mgu-btn--danger' : 'mgu-btn--go');
        goBtn.textContent = opts.confirmLabel || (cancellable ? 'OK' : 'Close');
        actions.appendChild(goBtn);

        card.appendChild(actions);
        scrim.appendChild(card);

        const before = document.activeElement;
        let done = false;
        function finish(value) {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey, true);
            scrim.remove();
            if (before && before.focus) { try { before.focus(); } catch (e) { /* gone */ } }
            resolve(value);
        }
        const no = function () { finish(opts.input ? null : false); };
        // A word-gated dialog refuses to fire until the word is right, whether
        // it is reached by click, by Enter, or by anything added later.
        const armed = function () {
            return !opts.confirmWord || (field && field.value === opts.confirmWord);
        };
        const yes = function () {
            if (!armed()) return;
            finish(opts.input ? (field ? field.value : '') : true);
        };

        function onKey(e) {
            if (e.key === 'Escape' && cancellable) { e.preventDefault(); no(); }
            else if (e.key === 'Enter' && (opts.input || document.activeElement !== cancelBtn)) {
                e.preventDefault(); yes();
            } else if (e.key === 'Tab') {
                // Keep the keyboard inside the dialog while it is open.
                const stops = card.querySelectorAll('button, input');
                if (!stops.length) return;
                const first = stops[0], last = stops[stops.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }

        if (cancelBtn) cancelBtn.onclick = no;
        goBtn.onclick = yes;
        scrim.onclick = function (e) { if (e.target === scrim && cancellable) no(); };
        document.addEventListener('keydown', onKey, true);

        if (opts.confirmWord && field) {
            const sync = function () {
                goBtn.disabled = !armed();
                goBtn.setAttribute('aria-disabled', goBtn.disabled ? 'true' : 'false');
            };
            field.addEventListener('input', sync);
            sync();
        }

        document.body.appendChild(scrim);
        // Destructive-by-typing dialogs open on Cancel, not on the field: the
        // safe way out should be what a reflex Enter finds.
        if (opts.confirmWord && cancelBtn) cancelBtn.focus();
        else {
            (field || goBtn).focus();
            if (field) field.select();
        }
    });
}


    window.AppDialog = {
        ask: ask,
        confirm: function (body, opts) {
            return ask(Object.assign({ body: body, confirmLabel: 'Yes', cancelLabel: 'No' }, opts || {}));
        },
        tell: function (body, opts) {
            return ask(Object.assign({ body: body, cancellable: false }, opts || {}));
        },
        askFor: function (body, value, opts) {
            return ask(Object.assign({ body: body, input: true, value: value }, opts || {}));
        }
    };
})(window);
