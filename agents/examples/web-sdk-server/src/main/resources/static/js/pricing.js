/*
 * Renders the pricing page from data/plans.json — the one place prices and
 * limits live. Anything a plan is not sure of says so: 'planned' plans are
 * labelled as not on sale, and only limits listed in a plan's `enforced`
 * array are marked as enforced today.
 */
(function () {
    'use strict';

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function statusLabel(plan) {
        return plan.status === 'available' ? 'Available now' : 'Planned — not on sale yet';
    }

    function card(plan, rows) {
        var c = el('article', 'mp-plan' + (plan.featured ? ' mp-plan--featured' : ''));
        c.append(el('span', 'mp-status mp-status--' + plan.status, statusLabel(plan)), el('h3', '', plan.name));
        var price = el('div', 'mp-plan-price', plan.priceLabel);
        price.append(el('small', '', plan.period));
        c.append(price, el('p', '', plan.audience));
        var list = el('ul');
        ['connections', 'messages', 'channels', 'turn'].forEach(function (key) {
            var row = rows.find(function (r) { return r.key === key; });
            var li = el('li');
            li.append(el('b', '', plan.limits[key]), document.createTextNode(' ' + (row.card || row.label)));
            list.append(li);
        });
        var cta = el('a', 'mp-btn' + (plan.featured || plan.status === 'available' ? ' mp-btn--primary' : ''), plan.cta.label);
        cta.href = plan.cta.href;
        c.append(list, cta);
        return c;
    }

    function table(data) {
        var t = el('table', 'mp-caps');
        var head = el('tr');
        head.append(el('th', '', 'Limit'));
        data.plans.forEach(function (p) { head.append(el('th', '', p.name)); });
        var thead = el('thead');
        thead.append(head);
        var tbody = el('tbody');
        data.rows.forEach(function (row) {
            var tr = el('tr');
            tr.append(el('td', '', row.label));
            data.plans.forEach(function (p) {
                var td = el('td', '', p.limits[row.key]);
                if ((p.enforced || []).indexOf(row.key) >= 0) {
                    var mark = el('span', 'mp-enforced', '●');
                    mark.title = 'Enforced today';
                    mark.setAttribute('aria-label', 'enforced today');
                    td.append(mark);
                }
                tr.append(td);
            });
            tbody.append(tr);
        });
        t.append(thead, tbody);
        return t;
    }

    function render(data) {
        document.getElementById('plansNotice').textContent = data.notice;
        document.getElementById('plansEnforced').textContent = data.enforcedToday;
        document.getElementById('plans').replaceChildren.apply(
            document.getElementById('plans'), data.plans.map(function (p) { return card(p, data.rows); }));
        document.getElementById('compare').replaceChildren(table(data));
    }

    fetch('data/plans.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(render)
        .catch(function () {
            document.getElementById('plans').textContent =
                'Pricing could not be loaded. Every plan is free during the public beta.';
        });
})();
