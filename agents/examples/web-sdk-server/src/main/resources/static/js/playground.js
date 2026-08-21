/**
 * Playground — filter the catalogue by the primitive each entry proves.
 *
 * Every card already declared what it demonstrates; this makes that claim
 * navigable. The filter is a chip row plus a "playable alone" toggle, and the
 * state rides in the URL hash so a filtered view can be linked to and survives
 * a reload — "here are the storage ones" is a sendable thing.
 *
 * No framework, no rebuild: entries are hidden with the `hidden` attribute so
 * the auto-fit grid re-packs itself.
 */
(function () {
    'use strict';

    var bar = document.getElementById('filterBar');
    if (!bar) return;

    var chips = Array.prototype.slice.call(bar.querySelectorAll('[data-filter]'));
    var soloBox = document.getElementById('soloOnly');
    var empty = document.getElementById('filterEmpty');
    var entries = Array.prototype.slice.call(document.querySelectorAll('.entry'));

    var state = { proves: 'all', solo: false };

    /** How many entries each primitive has, so a chip can carry its own count. */
    function countAll() {
        chips.forEach(function (chip) {
            var key = chip.getAttribute('data-filter');
            var n = key === 'all'
                ? entries.length
                : entries.filter(function (el) { return has(el, key); }).length;
            var slot = chip.querySelector('.filter-chip__n');
            if (slot) slot.textContent = n;
            // A primitive with nothing behind it is dimmed rather than removed:
            // an empty chip is a visible gap in what the SDK demonstrates.
            chip.classList.toggle('is-empty', n === 0);
        });
    }

    function has(el, key) {
        return (' ' + (el.getAttribute('data-proves') || '') + ' ').indexOf(' ' + key + ' ') !== -1;
    }

    function apply() {
        var shown = 0;
        entries.forEach(function (el) {
            var ok = (state.proves === 'all' || has(el, state.proves))
                && (!state.solo || el.getAttribute('data-solo') === 'true');
            el.hidden = !ok;
            if (ok) shown++;
        });

        chips.forEach(function (chip) {
            var on = chip.getAttribute('data-filter') === state.proves;
            chip.classList.toggle('is-on', on);
            chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (soloBox) soloBox.checked = state.solo;
        if (empty) empty.hidden = shown !== 0;

        // Section headings for a section with nothing left in it are noise.
        // Every grid that holds entries, not a hardcoded pair — a third tier
        // was added and the old list silently left its heading behind.
        document.querySelectorAll('[data-entry-grid]').forEach(function (grid) {
            var any = Array.prototype.some.call(grid.children, function (c) { return !c.hidden; });
            var section = grid.closest('section');
            if (section) section.hidden = !any;
        });
    }

    /** The filter is part of the address, so a filtered view can be sent. */
    function toHash() {
        var parts = [];
        if (state.proves !== 'all') parts.push(state.proves);
        if (state.solo) parts.push('solo');
        var next = parts.length ? '#' + parts.join('+') : ' ';
        if (history.replaceState) history.replaceState(null, '', next === ' ' ? location.pathname : next);
    }

    function fromHash() {
        var raw = (location.hash || '').replace(/^#/, '');
        if (!raw) return;
        var parts = raw.split('+');
        state.solo = parts.indexOf('solo') !== -1;
        var known = parts.filter(function (p) {
            return p !== 'solo' && chips.some(function (c) { return c.getAttribute('data-filter') === p; });
        });
        if (known.length) state.proves = known[0];
    }

    chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            var key = chip.getAttribute('data-filter');
            // Clicking the chip that is already on clears it, rather than
            // leaving no way back to everything except finding "Everything".
            state.proves = (state.proves === key && key !== 'all') ? 'all' : key;
            apply();
            toHash();
        });
    });

    if (soloBox) {
        soloBox.addEventListener('change', function () {
            state.solo = soloBox.checked;
            apply();
            toHash();
        });
    }

    window.addEventListener('hashchange', function () {
        state = { proves: 'all', solo: false };
        fromHash();
        apply();
    });

    countAll();
    fromHash();
    apply();
})();
