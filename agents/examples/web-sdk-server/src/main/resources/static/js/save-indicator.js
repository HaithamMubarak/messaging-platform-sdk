/**
 * "Is my work safe?" — answered in the corner of the page.
 *
 * The three apps that gained durable boards save quietly on a debounce, which
 * is the right behaviour and a terrible experience: there is no way to tell
 * whether anything is being kept, so people either assume it is not or find out
 * the hard way. This is the smallest honest answer — what the store is doing,
 * in words, without pretending to be more precise than it is.
 *
 * Deliberately does NOT claim "saved" while a save is only scheduled.
 */
(function (window) {
    'use strict';

    function attach(options) {
        var opts = options || {};
        var node = document.createElement('div');
        node.className = 'save-indicator';
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');
        node.hidden = true;
        (opts.parent || document.body).appendChild(node);

        var hideTimer = null;

        function show(text, kind, autoHide) {
            node.textContent = text;
            node.className = 'save-indicator' + (kind ? ' save-indicator--' + kind : '');
            node.hidden = false;
            clearTimeout(hideTimer);
            if (autoHide) {
                hideTimer = setTimeout(function () { node.hidden = true; }, 2600);
            }
        }

        return function onState(state, at) {
            if (state === 'pending') show('Unsaved changes', 'pending', false);
            else if (state === 'saving') show('Saving…', 'saving', false);
            else if (state === 'saved') {
                var when = at ? new Date(at) : new Date();
                show('Saved ' + String(when.getHours()).padStart(2, '0') + ':' +
                     String(when.getMinutes()).padStart(2, '0'), 'saved', true);
            } else if (state === 'failed') {
                // Never auto-hidden: a failed save is the one thing somebody
                // needs to still be on screen when they look up.
                show('Could not save — your work is only in this tab', 'failed', false);
            }
        };
    }

    window.SaveIndicator = { attach: attach };
})(window);
