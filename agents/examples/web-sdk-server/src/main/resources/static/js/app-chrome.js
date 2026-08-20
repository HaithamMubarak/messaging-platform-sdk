/**
 * Shared chrome placement for the collaboration demos.
 *
 * These apps all render their own header bar, but the connection pill and the
 * Share button were `position: fixed` in the viewport corners — a layout that
 * only works for a full-bleed canvas with no header. In practice the pill sat
 * on top of the app title and the button sat on top of the header actions.
 *
 * Rather than restyle five apps, move both controls into the header's action
 * row (`.header-right`, which all of them have) and let them flow. Apps
 * without that row keep a bottom-left dock, defined in css/app-chrome.css.
 */
(function () {
    'use strict';

    function relocate() {
        // Collaboration apps expose a dedicated action row; the mini-games put
        // everything straight into a single top bar. Both are valid anchors.
        const header = document.querySelector(
            '.app-header .header-right, .game-header .header-right, .top-bar, .game-header, .app-header'
        );
        if (!header) return false;

        const status = document.querySelector('.connection-status');
        const share = document.getElementById('shareBtn') || document.querySelector('.share-btn');

        // The pill reads as context for the room badge, so it goes first.
        if (status && status.parentElement !== header) {
            status.classList.add('in-header');
            status.setAttribute('role', 'status');
            header.insertBefore(status, header.firstChild);
            keepLabelled(status);
        }
        // The share button is an action, so it goes last with the other actions.
        if (share && share.parentElement !== header) {
            share.classList.add('in-header');
            header.appendChild(share);
        }

        relocateHostBadge(header);
        return !!(status || share);
    }

    /**
     * UserConnectionBase pins its host badge to the bottom-right of the
     * viewport with inline styles, which is where these apps put chat inputs
     * and player lists. Move it into the header and strip the inline
     * positioning so it flows with the other controls.
     */
    function relocateHostBadge(header) {
        const badge = document.getElementById('gameHostIndicator');
        if (!badge || badge.parentElement === header) return;

        ['position', 'bottom', 'right', 'top', 'left', 'boxShadow', 'animation', 'zIndex']
            .forEach((prop) => { badge.style[prop] = ''; });
        badge.style.padding = '5px 12px';
        badge.style.fontSize = '12px';
        badge.style.borderRadius = '999px';
        badge.style.opacity = '1';
        badge.classList.add('in-header');
        // A dedicated action row reads better with the badge first; a full-width
        // top bar reads better with it last, next to the other controls.
        if (header.classList.contains('header-right')) header.insertBefore(badge, header.firstChild);
        else header.appendChild(badge);
    }

    /**
     * The pill collapses to a dot once connected, so the state has to survive
     * in the accessible name and the tooltip instead of the visible text.
     */
    function keepLabelled(status) {
        const sync = () => {
            const text = (status.textContent || '').trim() || 'Connection status';
            status.setAttribute('aria-label', text);
            status.title = text;
        };
        sync();
        new MutationObserver(sync).observe(status, {
            childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class']
        });
    }

    /**
     * A way back to the site.
     *
     * Every demo was a dead end: a visitor arrives from the landing page, plays
     * with the thing, and then has no route to the docs, the playground or the
     * key they came for. The demos are the marketing, so ending the journey in
     * them is the one thing they must not do.
     *
     * A small fixed chip rather than a header item, because these apps lay out
     * their own headers and half of them have none at all.
     */
    function addHomeChip() {
        if (document.querySelector('.sdk-home-chip')) return;
        // How deep this page sits under the site root, so the link works from
        // /apps/x.html and /apps/mini-games/y/index.html alike.
        const path = location.pathname;
        const cut = path.indexOf('/apps/');
        const depth = cut < 0 ? 1 : path.slice(cut + 6).split('/').length;
        const root = '../'.repeat(depth);

        const nav = document.createElement('nav');
        nav.className = 'sdk-home-chip';
        nav.setAttribute('aria-label', 'Messaging Platform SDK');

        const home = document.createElement('a');
        home.href = root + 'index.html';
        home.className = 'sdk-home-chip__home';
        home.textContent = 'SDK';
        home.title = 'Messaging Platform SDK';

        const more = document.createElement('a');
        more.href = root + 'playground.html';
        more.className = 'sdk-home-chip__more';
        more.textContent = 'More demos';

        nav.appendChild(home);
        nav.appendChild(more);
        document.body.appendChild(nav);
    }

    function start() {
        addHomeChip();
        relocate();
        // Some apps build the header only after the connection succeeds.
        // Both the header and the host badge can appear late, so keep watching
        // until the badge has been placed rather than stopping at first success.
        const observer = new MutationObserver(() => {
            relocate();
            const badge = document.getElementById('gameHostIndicator');
            if (badge && badge.classList.contains('in-header')) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 30000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
