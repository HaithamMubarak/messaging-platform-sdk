/**
 * Playground — the catalogue, rendered, and filtered by the primitive each
 * entry proves.
 *
 * The cards used to be hand-written here and drifted from the code (the
 * Attest demo claimed only "storage versions"); they now come from
 * data/catalogue.json through js/catalogue.js, and the filter chips come from
 * the same file, so a chip cannot exist without a primitive behind it.
 *
 * The filter is a chip row plus a "playable alone" toggle, and the state
 * rides in the URL hash so a filtered view can be linked to and survives a
 * reload — "here are the storage ones" is a sendable thing. Entries are
 * hidden with the `hidden` attribute so the auto-fit grid re-packs itself.
 */
(function () {
    'use strict';

    var bar = document.getElementById('filterBar');
    var rootEl = document.getElementById('catalogueRoot');
    if (!bar || !rootEl || !window.Catalogue) return;

    // ------------------------------------------------------------- render

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function icon(name, extra) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon' + (extra ? ' ' + extra : ''));
        svg.setAttribute('aria-hidden', 'true');
        var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#' + name);
        svg.appendChild(use);
        return svg;
    }

    function link(href, cls, text) {
        var a = el('a', cls, text);
        a.href = href;
        return a;
    }

    function chips(cat) {
        var after = bar.querySelector('[data-filter="all"]');
        Object.keys(cat.primitives).forEach(function (key) {
            var b = el('button', 'filter-chip', cat.primitives[key].label);
            b.type = 'button';
            b.setAttribute('data-filter', key);
            b.setAttribute('aria-pressed', 'false');
            var n = el('span', 'filter-chip__n');
            n.setAttribute('data-count', key);
            b.appendChild(n);
            bar.insertBefore(b, after.nextSibling);
            after = b;
        });
    }

    /** What sits under the text: facts first (players, pattern), then links, then "Open". */
    function foot(entry) {
        var f = el('div', 'entry-foot');
        if (entry.about) f.appendChild(link(entry.about, 'btn btn--sm btn--ghost entry-alt', 'What it does'));
        (entry.links || []).forEach(function (l) { f.appendChild(link(l.url, 'btn btn--sm btn--ghost entry-alt', l.label)); });
        if (entry.source && entry.shelf === 'templates') {
            f.appendChild(link('/messaging-platform/sdk/' + entry.source[0], 'btn btn--sm btn--ghost entry-alt', 'Read the source'));
        }
        var open = el('span', 'demo-card__link', 'Open ');
        open.appendChild(icon('i-arrow-right', 'icon--sm'));
        f.appendChild(open);
        return f;
    }

    function card(cat, entry) {
        var a = el('article', 'card card--interactive game-card entry');
        a.setAttribute('data-proves', (entry.primitives || []).join(' '));
        a.setAttribute('data-solo', entry.solo ? 'true' : 'false');
        var hit = link(entry.url, 'entry-hit');
        hit.appendChild(el('span', 'sr-only', 'Open ' + entry.name));
        var shot = el('figure', 'entry-shot'), img = el('img');
        Object.assign(img, { src: entry.image, width: 960, height: 600, loading: 'lazy', decoding: 'async', alt: Catalogue.imageAlt(entry) });
        shot.appendChild(img);
        var head = el('div', 'game-card__head'), tile = el('span', 'tile-icon');
        tile.style.margin = '0';
        tile.appendChild(icon(entry.icon || 'i-layers'));
        head.append(tile, el('h3', '', entry.name));
        var facts = [entry.pattern, entry.players, entry.label].filter(Boolean);
        var badges = el('div', 'game-card__proves');
        (entry.badges || []).forEach(function (b, i) { badges.appendChild(el('span', i ? 'badge' : 'badge badge--brand', b)); });
        a.append(hit, shot, head);
        if (facts.length) a.appendChild(el('p', 'entry-facts', facts.join(' · ')));
        a.append(el('p', '', entry.text), badges, foot(entry));
        return a;
    }

    function section(cat, name) {
        var entries = Catalogue.shelf(cat, name);
        if (!entries.length) return null;
        var s = el('section'), wrap = el('div', 'wrap'), head = el('div', 'section-head');
        s.style.paddingTop = '0';
        var h = el('h2', '', cat.shelves[name].title);
        h.style.fontSize = 'var(--fs-2xl)';
        head.append(h, el('p', '', cat.shelves[name].lead));
        var grid = el('div', 'grid-3');
        grid.setAttribute('data-entry-grid', '');
        entries.forEach(function (e) { grid.appendChild(card(cat, e)); });
        wrap.append(head, grid);
        s.appendChild(wrap);
        return s;
    }

    /** What left the gallery says where it went, rather than silently vanishing. */
    function movedNote(cat) {
        var gone = Catalogue.moved(cat);
        if (!gone.length) return null;
        var s = el('section'), wrap = el('div', 'wrap'), list = el('ul', 'moved-list');
        s.style.paddingTop = '0';
        wrap.appendChild(el('h2', 'moved-title', 'Moved'));
        gone.forEach(function (e) {
            var li = el('li'), to = e.movedTo && Catalogue.byId(cat, e.movedTo);
            li.append(link(e.url, '', e.name), document.createTextNode(' — ' + e.note + ' '));
            if (to) li.appendChild(link(to.url, '', 'Open ' + to.name));
            list.appendChild(li);
        });
        wrap.appendChild(list);
        s.appendChild(wrap);
        return s;
    }

    function render(cat) {
        chips(cat);
        Object.keys(cat.shelves).forEach(function (name) {
            var s = section(cat, name);
            if (s) rootEl.appendChild(s);
        });
        var m = movedNote(cat);
        if (m) rootEl.appendChild(m);
    }

    // ------------------------------------------------------------- filter

    var chipEls = [], entries = [], state = { proves: 'all', solo: false };
    var soloBox = document.getElementById('soloOnly');
    var empty = document.getElementById('filterEmpty');

    function has(node, key) {
        return (' ' + (node.getAttribute('data-proves') || '') + ' ').indexOf(' ' + key + ' ') !== -1;
    }

    /** How many entries each primitive has, so a chip can carry its own count. */
    function countAll() {
        chipEls.forEach(function (chip) {
            var key = chip.getAttribute('data-filter');
            var n = key === 'all' ? entries.length : entries.filter(function (e) { return has(e, key); }).length;
            var slot = chip.querySelector('.filter-chip__n');
            if (slot) slot.textContent = n;
            // A primitive with nothing behind it is dimmed rather than removed:
            // an empty chip is a visible gap in what the SDK demonstrates.
            chip.classList.toggle('is-empty', n === 0);
        });
    }

    function apply() {
        var shown = 0;
        entries.forEach(function (e) {
            var ok = (state.proves === 'all' || has(e, state.proves))
                && (!state.solo || e.getAttribute('data-solo') === 'true');
            e.hidden = !ok;
            if (ok) shown++;
        });
        chipEls.forEach(function (chip) {
            var on = chip.getAttribute('data-filter') === state.proves;
            chip.classList.toggle('is-on', on);
            chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (soloBox) soloBox.checked = state.solo;
        if (empty) empty.hidden = shown !== 0;
        // A shelf with nothing left in it hides its heading too.
        rootEl.querySelectorAll('[data-entry-grid]').forEach(function (grid) {
            var any = Array.prototype.some.call(grid.children, function (c) { return !c.hidden; });
            grid.closest('section').hidden = !any;
        });
    }

    /** The filter is part of the address, so a filtered view can be sent. */
    function toHash() {
        var parts = [];
        if (state.proves !== 'all') parts.push(state.proves);
        if (state.solo) parts.push('solo');
        if (history.replaceState) history.replaceState(null, '', parts.length ? '#' + parts.join('+') : location.pathname);
    }

    function fromHash() {
        var parts = (location.hash || '').replace(/^#/, '').split('+').filter(Boolean);
        state.solo = parts.indexOf('solo') !== -1;
        var known = parts.filter(function (p) {
            return p !== 'solo' && chipEls.some(function (c) { return c.getAttribute('data-filter') === p; });
        });
        if (known.length) state.proves = known[0];
    }

    function filter() {
        chipEls = Array.prototype.slice.call(bar.querySelectorAll('[data-filter]'));
        entries = Array.prototype.slice.call(rootEl.querySelectorAll('.entry'));
        chipEls.forEach(function (chip) {
            chip.addEventListener('click', function () {
                var key = chip.getAttribute('data-filter');
                // Clicking the chip that is already on clears it.
                state.proves = (state.proves === key && key !== 'all') ? 'all' : key;
                apply();
                toHash();
            });
        });
        if (soloBox) soloBox.addEventListener('change', function () { state.solo = soloBox.checked; apply(); toHash(); });
        window.addEventListener('hashchange', function () { state = { proves: 'all', solo: false }; fromHash(); apply(); });
        countAll();
        fromHash();
        apply();
    }

    Catalogue.load().then(function (cat) {
        render(cat);
        filter();
    }, function () {
        rootEl.appendChild(el('p', 'filter-empty', 'The catalogue did not load. Reload the page to try again.'));
    });
})();
