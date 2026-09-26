/*
 * The dashboard's plan card: this plan's limits (each marked enforced or
 * target, as the service declares), and asking for another plan.
 *
 * There is no payment provider. Asking records a request; an operator
 * invoices and confirms it, and only then does the plan change. The copy
 * says so, and there is no "Upgrade now" button that could imply otherwise.
 */
(function () {
    'use strict';

    const el = UI.el;

    /* One row per limit the plan carries, marked enforced or target. */
    function renderLimits(host, detail) {
        host.innerHTML = '';
        if (!detail || !detail.limits) return;
        const enforced = detail.enforced || [];
        const list = el('ul', { class: 'features-list' });
        Object.keys(PlanFormat.LABELS).forEach((key) => {
            if (!(key in detail.limits)) return;
            const li = el('li');
            li.appendChild(el('strong', { text: PlanFormat.limit(key, detail.limits[key]) + ' ' }));
            li.appendChild(document.createTextNode(PlanFormat.LABELS[key]));
            li.appendChild(el('span', {
                class: enforced.includes(key) ? 'badge badge--success' : 'badge',
                style: 'margin-left:var(--sp-2)',
                text: enforced.includes(key) ? 'enforced' : 'target'
            }));
            list.appendChild(li);
        });
        host.appendChild(list);
    }

    function describe(req) {
        const when = req.createdAt ? ' on ' + UI.fmtDate(req.createdAt) : '';
        const what = req.planName + ' (' + req.billingCycle + ')';
        if (req.status === 'pending') return 'You asked for ' + what + when + '. We will invoice you and confirm; nothing changes until then.';
        if (req.status === 'approved') return 'Your request for ' + what + ' was approved.';
        if (req.status === 'rejected') return 'Your request for ' + what + ' was declined' + (req.decisionNote ? ': ' + req.decisionNote : '.');
        return 'Your request for ' + what + ' was withdrawn.';
    }

    function pendingView(host, req, reload) {
        host.appendChild(el('p', { class: 'panel__desc', text: describe(req) }));
        const cancel = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Withdraw request' });
        cancel.addEventListener('click', () => UI.withBusy(cancel, async () => {
            try {
                await DeveloperAPI.cancelPlanRequest();
                UI.toast.success('Request withdrawn.');
                reload();
            } catch (err) { UI.toast.error(err.message); }
        }));
        host.appendChild(cancel);
    }

    function select(id, label, options) {
        const wrap = el('div', { class: 'field' });
        wrap.appendChild(el('label', { class: 'field__label', for: id, text: label }));
        const s = el('select', { class: 'field__select', id: id });
        options.forEach((o) => s.appendChild(el('option', { value: o[0], text: o[1] })));
        wrap.appendChild(s);
        return { wrap, input: s };
    }

    function requestForm(host, plans, currentSlug, reload) {
        const choices = plans.filter((p) => p.slug !== currentSlug)
            .map((p) => [p.slug, p.name + ' — ' + PlanFormat.price(p.priceMonthlyCents).label +
                (p.priceMonthlyCents ? ' / month' : '')]);
        if (!choices.length) return;
        const plan = select('planRequestPlan', 'Plan', choices);
        const cycle = select('planRequestCycle', 'Billing', [['monthly', 'Monthly'], ['yearly', 'Yearly']]);
        const note = el('input', { class: 'field__input', id: 'planRequestNote', maxlength: '1000',
            placeholder: 'Company name for the invoice, or anything we should know (optional)' });
        const button = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Request this plan' });
        button.addEventListener('click', () => UI.withBusy(button, async () => {
            try {
                await DeveloperAPI.requestPlan(plan.input.value, cycle.input.value, note.value);
                UI.toast.success('Request sent. We will invoice you and confirm.');
                reload();
            } catch (err) { UI.toast.error(err.message); }
        }));
        host.append(plan.wrap, cycle.wrap, note, button,
            el('p', { class: 'field__hint', text: 'Paid plans are invoiced. An operator confirms the change; nothing is charged automatically.' }));
    }

    /** Render the upgrade area for a developer whose plan is `detail`. */
    async function renderUpgrade(host, detail) {
        const reload = () => renderUpgrade(host, detail);
        host.innerHTML = '';
        host.appendChild(el('h4', { style: 'margin:var(--sp-5) 0 var(--sp-2)', text: 'Change plan' }));
        try {
            const [plans, latest] = await Promise.all([DeveloperAPI.getBillingPlans(), DeveloperAPI.getMyPlanRequest()]);
            if (latest && latest.status === 'pending') return pendingView(host, latest, reload);
            if (latest && latest.status !== 'cancelled') host.appendChild(el('p', { class: 'panel__desc', text: describe(latest) }));
            requestForm(host, plans, detail && detail.slug, reload);
        } catch (err) {
            host.appendChild(el('p', { class: 'field__hint', text: 'Plan changes are unavailable right now: ' + err.message }));
        }
    }

    window.DeveloperPlanPanel = { renderLimits, renderUpgrade };
})();
