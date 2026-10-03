/**
 * The site shell's phone menu (hub consolidation phase 2, 2026-10-03). The header markup is
 * written into every page by tools/site-shell.cjs; landing.js already drives the same toggle on
 * the pages that load it, so this binds only once (data-shell-bound) and is a no-op there.
 */
(function (document) {
    'use strict';

    function bind() {
        var header = document.getElementById('siteHeader');
        var toggle = document.getElementById('navToggle');
        if (!header || !toggle || toggle.hasAttribute('data-shell-bound')) return;
        toggle.setAttribute('data-shell-bound', '');
        toggle.addEventListener('click', function () {
            var open = header.getAttribute('data-open') !== 'true';
            header.setAttribute('data-open', String(open));
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || header.getAttribute('data-open') !== 'true') return;
            header.setAttribute('data-open', 'false');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.focus();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
})(document);
