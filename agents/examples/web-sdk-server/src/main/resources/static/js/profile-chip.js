/**
 * The account entry, on every landing page.
 *
 * The top nav is duplicated inline across twenty pages with no shared header
 * component, so adding a control by hand means twenty edits and a twenty-first
 * page that quietly misses out. This follows app-chrome.js instead: find the
 * existing markup at runtime and place the control into it.
 *
 * The whole contract is `.site-nav`. A page participates by having one, which
 * all twenty already do, and a page without one is a no-op rather than an
 * error -- the demos have no site nav and carry the account in their
 * connection modal instead.
 */
(function (window, document) {
    'use strict';

    var PROFILE = '/messaging-platform/profile.html';

    function build(user) {
        var a = document.createElement('a');
        a.className = 'mp-chip';
        if (!user) {
            a.href = PROFILE + '#signin';
            a.textContent = 'Sign in';
            return a;
        }
        var name = (user.displayName || user.email || '').trim();
        a.href = PROFILE;
        a.setAttribute('aria-label', 'Your profile — ' + name);
        var dot = document.createElement('span');
        dot.className = 'mp-chip__initial';
        dot.setAttribute('aria-hidden', 'true');
        dot.textContent = (name[0] || '?').toUpperCase();
        var label = document.createElement('span');
        label.className = 'mp-chip__name';
        // textContent, never innerHTML: a display name is somebody's input.
        label.textContent = name.split(/\s+/)[0] || name;
        a.appendChild(dot);
        a.appendChild(label);
        return a;
    }

    function place(nav, node) {
        // Before the sales CTA when there is one, so the nav still ends on it.
        var cta = nav.querySelector('.btn--gradient');
        if (cta) nav.insertBefore(node, cta);
        else nav.appendChild(node);
    }

    function render(user) {
        var nav = document.querySelector('.site-nav');
        if (!nav) return;                       // not a landing page: nothing to do
        var existing = nav.querySelector('.mp-chip');
        if (existing) existing.remove();
        place(nav, build(user));
    }

    function start() {
        // Render signed-out immediately so the nav never jumps once /me answers.
        render(null);
        if (!window.MPAccount || !window.MPAccount.signedIn()) return;
        window.MPAccount.me().then(render).catch(function () {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.ProfileChip = { render: render };
})(window, document);
