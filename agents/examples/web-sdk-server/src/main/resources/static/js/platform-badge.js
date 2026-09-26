/*
 * "Powered by Messaging Platform" — the small link that turns a player or a
 * meeting guest into a developer who knows what the app was built with.
 *
 * Opt-in and in-flow: a page places
 *     <span data-mp-powered="blockparty"></span>
 * where the label belongs (usually its footer) and loads this script. Nothing
 * is injected anywhere else and nothing is position:fixed, so it can never
 * cover a control an app or its tests rely on.
 *
 * White-label: a placeholder with data-mp-powered-hidden, or a page that sets
 * window.MP_HIDE_POWERED_BY = true before this runs, renders nothing.
 *
 * Colours come from the page (currentColor), so it sits in any theme. Sizes
 * respect tools/mobile-audit.js: text >= 12px, target >= 32px tall.
 */
(function () {
    'use strict';

    var LANDING = 'https://hmdevonline.com/messaging-platform/hub/built-with.html';
    var STYLE_ID = 'mp-powered-style';

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '.mp-powered{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:4px 8px;' +
            'font:500 12px/1.2 system-ui,sans-serif;color:inherit;opacity:.72;text-decoration:none;border-radius:6px}' +
            '.mp-powered:hover,.mp-powered:focus-visible{opacity:1;text-decoration:underline;text-underline-offset:3px}' +
            '.mp-powered svg{width:12px;height:12px;flex-shrink:0}';
        document.head.appendChild(style);
    }

    function badge(appId) {
        var a = document.createElement('a');
        a.className = 'mp-powered';
        a.href = LANDING + (appId ? '?from=' + encodeURIComponent(appId) : '');
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z" fill="currentColor"/></svg>' +
            '<span>Powered by Messaging Platform</span>';
        return a;
    }

    function render() {
        if (window.MP_HIDE_POWERED_BY) return;
        var slots = document.querySelectorAll('[data-mp-powered]');
        if (!slots.length) return;
        injectStyle();
        slots.forEach(function (slot) {
            if (slot.hasAttribute('data-mp-powered-hidden') || slot.childElementCount) return;
            slot.appendChild(badge(slot.getAttribute('data-mp-powered')));
        });
    }

    window.MPPoweredBy = { render: render };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
    else render();
})();
