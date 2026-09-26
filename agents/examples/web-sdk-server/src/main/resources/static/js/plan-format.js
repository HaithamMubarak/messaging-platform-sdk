/*
 * Developer plans, as the site shows them.
 *
 * The plans live in messaging-service (plans table, V21) and are served at
 * GET /billing/plans. data/plans.json is the page's WORDING (notice, row
 * labels) plus a snapshot of the ladder used only when the API cannot be
 * reached, so pricing still renders during an outage. The pricing page and
 * the developer dashboard both format through here, so the same plan can
 * never read differently in the two places.
 */
(function () {
    'use strict';

    var API = '/messaging-platform/api/v1/messaging-service/billing/plans';

    /* API limit key -> display row key in data/plans.json. */
    var FROM_API = {
        connections: 'connections', messagesPerMonth: 'messages', channels: 'channels',
        apiKeys: 'apiKeys', historyDays: 'history', storageMb: 'storage', turnGb: 'turn',
        teamMembers: 'team'
    };

    /* What each API limit is called, for pages that list one plan's limits. */
    var LABELS = {
        connections: 'Concurrent connections', messagesPerMonth: 'Messages / month', channels: 'Active channels',
        apiKeys: 'API keys', historyDays: 'Message history', storageMb: 'Channel storage',
        turnGb: 'WebRTC TURN relay', teamMembers: 'Team members'
    };

    function num(n) { return Number(n).toLocaleString('en-US'); }

    function short(n) {
        if (n >= 1e9 && n % 1e9 === 0) return n / 1e9 + 'B';
        if (n >= 1e6 && n % 1e6 === 0) return n / 1e6 + 'M';
        if (n >= 1e3 && n % 1e3 === 0 && n >= 1e5) return n / 1e3 + 'K';
        return num(n);
    }

    function days(d) {
        if (d % 365 === 0) return d / 365 === 1 ? '1 year' : d / 365 + ' years';
        return d === 1 ? '1 day' : d + ' days';
    }

    function megabytes(mb) { return mb >= 1024 && mb % 1024 === 0 ? mb / 1024 + ' GB' : mb + ' MB'; }

    /* One limit value as text; null means custom (Enterprise), never unlimited. */
    function limit(apiKey, value) {
        if (value === null || value === undefined) return 'Custom';
        switch (apiKey) {
            case 'messagesPerMonth': return short(value);
            case 'historyDays': return days(value);
            case 'storageMb': return megabytes(value);
            case 'turnGb': return value + ' GB';
            default: return num(value);
        }
    }

    function price(cents) {
        if (cents === null || cents === undefined) return { label: 'Custom', period: 'annual agreement' };
        if (cents === 0) return { label: '$0', period: 'forever' };
        return { label: '$' + (cents % 100 ? (cents / 100).toFixed(2) : cents / 100), period: 'per month' };
    }

    var CTA = {
        available: { label: 'Start free', href: 'developer/index.html?start=free' },
        planned: { label: 'Start free, upgrade later', href: 'developer/index.html?start=free' },
        contact: { label: 'Contact sales', href: 'profile.html#pDeveloperCard' }
    };

    /* A /billing/plans entry in the shape the pricing page renders. */
    function fromApi(p) {
        var limits = {}, enforced = [];
        Object.keys(FROM_API).forEach(function (k) { limits[FROM_API[k]] = limit(k, (p.limits || {})[k]); });
        limits.support = p.support || '—';
        (p.enforced || []).forEach(function (k) { if (FROM_API[k]) enforced.push(FROM_API[k]); });
        var pr = price(p.priceMonthlyCents);
        return {
            id: p.slug, name: p.name, status: p.saleStatus, priceLabel: pr.label, period: pr.period,
            audience: p.audience || p.description || '', featured: p.slug === 'pro',
            cta: CTA[p.saleStatus] || CTA.planned, limits: limits,
            // Free is the only plan anyone holds without an operator, so it is the
            // one whose enforced limits are worth marking on a price list.
            enforced: p.saleStatus === 'available' ? enforced : []
        };
    }

    function getJson(url) {
        return fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } })
            .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    }

    /**
     * {rows, notice, enforcedToday, plans, source}: wording from plans.json,
     * plans from the service ('live'), or the snapshot when it is unreachable.
     */
    function load(basePath) {
        return getJson((basePath || '') + 'data/plans.json').then(function (page) {
            return getJson(API).then(function (body) {
                var list = body && body.data && body.data.plans;
                if (!Array.isArray(list) || !list.length) throw new Error('empty');
                page.plans = list.map(fromApi);
                page.source = 'live';
                return page;
            }).catch(function () {
                page.source = 'snapshot';
                return page;
            });
        });
    }

    window.PlanFormat = { API: API, load: load, fromApi: fromApi, limit: limit, price: price, FROM_API: FROM_API, LABELS: LABELS };
})();
