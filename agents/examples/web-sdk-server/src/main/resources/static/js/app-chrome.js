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
        const header = document.querySelector('.app-header .header-right, .game-header .header-right');
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
        header.insertBefore(badge, header.firstChild);
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

    function start() {
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
