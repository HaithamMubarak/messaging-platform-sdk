/*
 * Renders the pricing page from the plans messaging-service serves
 * (GET /billing/plans, via js/plan-format.js), falling back to the snapshot in
 * data/plans.json only when the service cannot be reached. Anything a plan is not sure of says so: 'planned' plans are
 * labelled as not on sale, and only limits listed in a plan's `enforced`
 * array are marked as enforced today.
 *
 * The same functions write the plans into pricing.html at build time
 * (tools/prerender-pricing.cjs, 2026-10-26), so a visitor without script, and
 * a crawler, sees the prices; in the browser this only refreshes them.
 */
(function () {
    'use strict';

    function esc(s) {
        return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    var STATUS = { available: 'Available now', contact: 'By agreement' };

    function statusLabel(plan) {
        return STATUS[plan.status] || 'Planned — not on sale yet';
    }

    function card(plan, rows) {
        var items = ['connections', 'messages', 'channels', 'turn'].map(function (key) {
            var row = rows.find(function (r) { return r.key === key; });
            return '<li><b>' + esc(plan.limits[key]) + '</b> ' + esc(row.card || row.label) + '</li>';
        }).join('');
        var primary = plan.featured || plan.status === 'available' ? ' mp-btn--primary' : '';
        return '<article class="mp-plan' + (plan.featured ? ' mp-plan--featured' : '') + '">'
            + '<span class="mp-status mp-status--' + esc(plan.status) + '">' + esc(statusLabel(plan)) + '</span>'
            + '<h3>' + esc(plan.name) + '</h3>'
            + '<div class="mp-plan-price">' + esc(plan.priceLabel) + '<small>' + esc(plan.period) + '</small></div>'
            + '<p>' + esc(plan.audience) + '</p><ul>' + items + '</ul>'
            + '<a class="mp-btn' + primary + '" href="' + esc(plan.cta.href) + '">' + esc(plan.cta.label) + '</a></article>';
    }

    function table(data) {
        var head = '<tr><th>Limit</th>' + data.plans.map(function (p) { return '<th>' + esc(p.name) + '</th>'; }).join('') + '</tr>';
        var body = data.rows.map(function (row) {
            return '<tr><td>' + esc(row.label) + '</td>' + data.plans.map(function (p) {
                var mark = (p.enforced || []).indexOf(row.key) >= 0
                    ? '<span class="mp-enforced" title="Enforced today" aria-label="enforced today">●</span>' : '';
                return '<td>' + esc(p.limits[row.key]) + mark + '</td>';
            }).join('') + '</tr>';
        }).join('');
        return '<table class="mp-caps"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    }

    /** The page's four regions as markup: {notice, plans, enforced, compare}. */
    function regions(data) {
        return {
            notice: esc(data.notice),
            plans: data.plans.map(function (p) { return card(p, data.rows); }).join(''),
            enforced: esc(data.enforcedToday),
            compare: table(data)
        };
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = { regions: regions, statusLabel: statusLabel };
        return;
    }

    function render(data) {
        var r = regions(data);
        document.getElementById('plansNotice').innerHTML = r.notice;
        document.getElementById('plansEnforced').innerHTML = r.enforced;
        document.getElementById('plans').innerHTML = r.plans;
        document.getElementById('compare').innerHTML = r.compare;
        if (data.source === 'snapshot') {
            document.getElementById('plansEnforced').textContent +=
                ' (Showing a saved copy of the plans: the live list could not be loaded.)';
        }
    }

    // The page already shows the snapshot; a failed refresh leaves it, and says so once.
    window.PlanFormat.load('').then(render).catch(function () {
        document.getElementById('plansEnforced').textContent +=
            ' (Showing a saved copy of the plans: the live list could not be loaded.)';
    });
})();
