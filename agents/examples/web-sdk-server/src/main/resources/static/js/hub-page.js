/*
 * Behaviour shared by the hub's standalone product pages (pricing,
 * quickstart, built-with): the theme toggle, copy buttons on code blocks, and
 * language tabs. The theme itself is applied by a one-line inline script in
 * <head> (same key as the hub, 'hub-theme') so the page never flashes.
 */
(function () {
    'use strict';

    function store(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
    }
    function recall(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function wireTheme() {
        var button = document.querySelector('[data-theme-toggle]');
        if (!button) return;
        var root = document.documentElement;
        function label() {
            button.textContent = root.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode';
        }
        button.addEventListener('click', function () {
            root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
            store('hub-theme', root.dataset.theme);
            label();
        });
        label();
    }

    function wireCopy() {
        document.querySelectorAll('.mp-code').forEach(function (pre) {
            var wrap = document.createElement('div');
            wrap.className = 'mp-code-wrap';
            // A language panel's visibility must cover its copy button too.
            if (pre.dataset.lang) { wrap.dataset.lang = pre.dataset.lang; delete pre.dataset.lang; }
            pre.parentNode.insertBefore(wrap, pre);
            wrap.appendChild(pre);
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'mp-copy';
            button.textContent = 'Copy';
            button.addEventListener('click', function () {
                navigator.clipboard.writeText(pre.innerText).then(function () {
                    button.textContent = 'Copied';
                    setTimeout(function () { button.textContent = 'Copy'; }, 1400);
                }, function () { button.textContent = 'Select and copy'; });
            });
            wrap.appendChild(button);
        });
    }

    /* Tabs: buttons carry data-tab="js"; panels carry data-lang="js". One
       choice drives every panel on the page, and is remembered. */
    function wireTabs() {
        var buttons = document.querySelectorAll('[data-tab]');
        if (!buttons.length) return;
        function select(lang) {
            buttons.forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === lang)); });
            document.querySelectorAll('[data-lang]').forEach(function (p) { p.hidden = p.dataset.lang !== lang; });
            store('hub-lang', lang);
        }
        buttons.forEach(function (b) { b.addEventListener('click', function () { select(b.dataset.tab); }); });
        function offered(lang) {
            return Array.prototype.some.call(buttons, function (b) { return b.dataset.tab === lang; });
        }
        var hash = location.hash.slice(1), saved = recall('hub-lang');
        select(offered(hash) ? hash : offered(saved) ? saved : buttons[0].dataset.tab);
    }

    wireTheme();
    wireCopy();
    wireTabs();
})();
