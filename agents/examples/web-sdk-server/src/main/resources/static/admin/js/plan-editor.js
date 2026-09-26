/*
 * Operator console: edit a plan (PUT /admin/plans/{id}).
 *
 * Sends only the fields the operator changed. The server owns the rules
 * (PlanAdminService): unknown fields refused, the default plan stays public
 * and available, an available plan needs a price. Its message is shown as is.
 *
 * Enforced limits move live quotas, so changing one on a plan that has
 * developers asks for confirmation first, naming how many are on it.
 */
(function () {
    'use strict';

    const el = UI.el;

    /* [key, label, kind, hint]. kind: text | area | int | target | money | status | bool */
    const SECTIONS = [
        ['On sale', [
            ['saleStatus', 'Sale status', 'status', 'available: can be had today · planned: shown, not sold · contact: talk to us'],
            ['publicPlan', 'Shown on the pricing page', 'bool'],
            ['priceMonthlyCents', 'Price per month (USD)', 'money', 'Blank = custom price. 0 = free.'],
            ['displayOrder', 'Order on the pricing page', 'int']]],
        ['Enforced limits', [
            ['channelUnits', 'Channel units', 'int', 'Checked when a channel is created.'],
            ['bandwidthPerMinute', 'Throughput per minute', 'int', 'The daily call allowance is this × 1,440.'],
            ['maxApiKeys', 'API keys per account', 'target', 'Blank = the default of 10.']]],
        ['Targets (shown, not metered yet)', [
            ['maxConnections', 'Concurrent connections', 'target'],
            ['messagesPerMonth', 'Messages per month', 'target'],
            ['historyDays', 'Message history (days)', 'target'],
            ['storageMb', 'Channel storage (MB)', 'target'],
            ['turnGb', 'TURN relay (GB)', 'target'],
            ['teamMembers', 'Team members', 'target']]],
        ['Wording', [
            ['audience', 'Who it is for', 'text'],
            ['description', 'Description', 'area'],
            ['support', 'Support', 'text']]]
    ];
    const ENFORCED = ['channelUnits', 'bandwidthPerMinute', 'maxApiKeys'];

    function input(key, kind, value) {
        const id = 'plan-' + key;
        if (kind === 'status') {
            const s = el('select', { class: 'field__select', id });
            ['available', 'planned', 'contact'].forEach((v) => s.appendChild(el('option', { value: v, text: v, selected: v === value })));
            return s;
        }
        if (kind === 'bool') {
            const c = el('input', { type: 'checkbox', id });
            c.checked = value === true;
            return c;
        }
        if (kind === 'area') return el('textarea', { class: 'field__textarea', id, rows: '2', maxlength: '500', text: value || '' });
        const numeric = kind !== 'text';
        const shown = kind === 'money' ? (value == null ? '' : String(value / 100)) : (value == null ? '' : String(value));
        return el('input', { class: 'field__input', id, type: numeric ? 'number' : 'text', value: shown,
            min: numeric ? '0' : null, step: kind === 'money' ? '0.01' : (numeric ? '1' : null),
            maxlength: numeric ? null : '500', placeholder: kind === 'target' ? 'Custom' : null });
    }

    /* The value a control holds, in the API's terms. */
    function read(kind, node) {
        if (kind === 'bool') return node.checked;
        if (kind === 'text' || kind === 'area' || kind === 'status') return node.value.trim() || null;
        if (node.value.trim() === '') return null;
        return kind === 'money' ? Math.round(Number(node.value) * 100) : Number(node.value);
    }

    function buildForm(plan) {
        const form = el('form', { novalidate: true });
        const controls = [];
        SECTIONS.forEach(([title, fields], i) => {
            form.appendChild(el('h3', {
                style: 'margin:' + (i ? 'var(--sp-6)' : '0') + ' 0 var(--sp-3);padding-top:' + (i ? 'var(--sp-4)' : '0') +
                    ';border-top:' + (i ? '1px solid var(--border)' : '0') +
                    ';font-size:var(--fs-xs);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)',
                text: title }));
            fields.forEach(([key, label, kind, hint]) => {
                const field = el('div', { class: 'field' });
                const node = input(key, kind, plan[key]);
                if (kind === 'bool') {
                    // The console's toggle style (as on "Email the credentials").
                    field.appendChild(el('label', { class: 'field__hint', for: node.id,
                        style: 'display:flex;gap:.5rem;align-items:center;cursor:pointer' }, [node, label]));
                } else {
                    field.appendChild(el('label', { class: 'field__label', for: node.id, text: label }));
                    field.appendChild(node);
                }
                if (hint) field.appendChild(el('p', { class: 'field__hint', text: hint }));
                form.appendChild(field);
                controls.push({ key, kind, node, before: plan[key] });
            });
        });
        return { form, controls };
    }

    function changes(controls) {
        const out = {};
        controls.forEach((c) => {
            const after = read(c.kind, c.node);
            const before = c.before === undefined ? null : c.before;
            if (after !== before && !(after === null && (before === '' || before === null))) out[c.key] = after;
        });
        return out;
    }

    async function confirmIfLive(plan, changed) {
        const live = Object.keys(changed).filter((k) => ENFORCED.includes(k));
        if (!live.length || !plan.developerCount) return true;
        // Resolves false on cancel, a payload on confirm.
        const answer = await UI.confirm({
            title: 'Change a live quota?',
            body: plan.developerCount + ' developer(s) are on ' + plan.name + '. Changing ' + live.join(', ') +
                ' changes what they can do within about a minute.',
            confirmLabel: 'Change it',
            danger: true
        });
        return answer !== false && answer !== undefined && answer !== null;
    }

    function open(plan, onSaved) {
        UI.openModal((close) => {
            const { form, controls } = buildForm(plan);
            const error = el('p', { class: 'field__error', role: 'alert' });
            form.appendChild(error);
            const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: () => close(null) });
            const submit = el('button', { class: 'btn btn--primary', type: 'submit', text: 'Save plan' });
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const changed = changes(controls);
                if (!Object.keys(changed).length) { close(null); return; }
                if (!(await confirmIfLive(plan, changed))) return;
                await UI.withBusy(submit, async () => {
                    try {
                        await AdminAPI.updatePlan(plan.id, changed);
                        close(true);
                        UI.toast.success(plan.name + ' updated.');
                        onSaved();
                    } catch (err) { error.textContent = err.message || 'Could not save the plan.'; }
                });
            });
            const card = UI.modalCard({ title: 'Edit ' + plan.name, body: form, actions: [cancel, submit], wide: true }, close);
            submit.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });
            return card;
        });
    }

    window.PlanEditor = { open, changes, read };
})();
