/**
 * Messaging Platform SDK — icon sprite.
 *
 * Injects a hidden <svg> sprite of <symbol> definitions into the document so
 * pages can render icons with:
 *
 *     <svg class="icon" aria-hidden="true"><use href="#i-key"></use></svg>
 *
 * All icons share one grammar: 24x24 viewBox, no fill, currentColor stroke,
 * 1.75 width, round caps and joins. Loading this file replaces every emoji
 * that used to stand in for an icon.
 */
(function () {
    'use strict';

    var ICONS = {
        // Navigation / chrome
        'menu':        '<path d="M3 12h18M3 6h18M3 18h18"/>',
        'x':           '<path d="M18 6 6 18M6 6l12 12"/>',
        'check':       '<path d="M20 6 9 17l-5-5"/>',
        'plus':        '<path d="M12 5v14M5 12h14"/>',
        'chevron-down':  '<path d="m6 9 6 6 6-6"/>',
        'chevron-up':    '<path d="m18 15-6-6-6 6"/>',
        'chevron-right': '<path d="m9 18 6-6-6-6"/>',
        'arrow-right':   '<path d="M5 12h14M12 5l7 7-7 7"/>',
        'external':    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
        'search':      '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
        'refresh':     '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
        'log-out':     '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
        'copy':        '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        'download':    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
        'eye':         '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
        'eye-off':     '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="m1 1 22 22"/>',

        // Status
        'info':        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
        'check-circle':'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m22 4-10 10.01-3-3"/>',
        'alert-circle':'<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
        'alert-triangle':'<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
        'clock':       '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',

        // Product primitives
        'channel':     '<path d="M4.93 19.07a10 10 0 0 1 0-14.14M19.07 4.93a10 10 0 0 1 0 14.14M7.76 16.24a6 6 0 0 1 0-8.48M16.24 7.76a6 6 0 0 1 0 8.48"/><circle cx="12" cy="12" r="2"/>',
        'video':       '<path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
        'video-off':   '<path d="M16 16v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m5 0h4a2 2 0 0 1 2 2v3l7-5v10"/><path d="m1 1 22 22"/>',
        'mic':         '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 19v3"/>',
        'mic-off':     '<path d="M15 9V5a3 3 0 0 0-5.66-1.4M9 9v1a3 3 0 0 0 4.5 2.6"/><path d="M17 12a5 5 0 0 1-.4 1.9M5 10v1a7 7 0 0 0 10.7 5.95M12 19v3"/><path d="m1 1 22 22"/>',
        'monitor':     '<rect x="2" y="3" width="20" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',
        'grid':        '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
        'users':       '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        'database':    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
        'key':         '<circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13 20 3"/><path d="m17 6 3 3M14.5 8.5l3 3"/>',
        'shield-check':'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
        'shield':      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        'globe':       '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
        'layers':      '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
        'lock':        '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        'zap':         '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
        'code':        '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
        'terminal':    '<path d="m4 17 6-6-6-6M12 19h8"/>',
        'hard-drive':  '<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
        'activity':    '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
        'trending-up': '<path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
        'bar-chart':   '<path d="M18 20V10M12 20V4M6 20v-6"/>',
        'mail':        '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
        'send':        '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
        'message':     '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
        'pen':         '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
        'gamepad':     '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4M15.5 13h.01M18 11h.01"/>',
        'book':        '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
        'dashboard':   '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
        'settings':    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        'wrench':      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94L14.7 6.3z"/>',
        'inbox':       '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
        'card':        '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
        'user-plus':   '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
        'list':        '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
        'trash':       '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
        'ban':         '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/>'
    };

    // GitHub is the one filled mark in the set; it keeps its own attributes.
    var GITHUB = '<symbol id="i-github" viewBox="0 0 16 16" fill="currentColor" stroke="none">' +
        '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></symbol>';

    // The product mark, also used as the logo.
    var LOGO = '<symbol id="i-logo" viewBox="0 0 24 24" fill="none" stroke="none">' +
        '<rect width="24" height="24" rx="6" fill="url(#logoGradient)"/>' +
        '<path d="M6 9.5A2.5 2.5 0 0 1 8.5 7h7A2.5 2.5 0 0 1 18 9.5v3a2.5 2.5 0 0 1-2.5 2.5H11l-3.2 2.4A.5.5 0 0 1 7 17V15h-.5A.5.5 0 0 1 6 14.5z" fill="#fff" fill-opacity=".95"/>' +
        '<circle cx="9.6" cy="11" r="1" fill="#4338ca"/><circle cx="12" cy="11" r="1" fill="#4338ca"/><circle cx="14.4" cy="11" r="1" fill="#4338ca"/></symbol>';

    function build() {
        var parts = ['<defs><linearGradient id="logoGradient" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#22d3ee"/>' +
            '</linearGradient></defs>', LOGO, GITHUB];

        Object.keys(ICONS).forEach(function (name) {
            parts.push(
                '<symbol id="i-' + name + '" viewBox="0 0 24 24" fill="none" ' +
                'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
                'stroke-linejoin="round">' + ICONS[name] + '</symbol>'
            );
        });

        var sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        sprite.setAttribute('aria-hidden', 'true');
        sprite.setAttribute('focusable', 'false');
        sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        sprite.innerHTML = parts.join('');
        document.body.insertBefore(sprite, document.body.firstChild);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }

    /** Markup helper for scripts that build DOM strings. */
    window.icon = function (name, cls) {
        return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' +
               '<use href="#i-' + name + '"></use></svg>';
    };
})();
