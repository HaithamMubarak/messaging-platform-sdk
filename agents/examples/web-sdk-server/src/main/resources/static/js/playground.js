/**
 * Playground — the catalogue, rendered, and filtered by the primitive each
 * entry proves.
 *
 * The cards used to be hand-written here and drifted from the code (the
 * Attest demo claimed only "storage versions"); they now come from
 * data/catalogue.json through js/catalogue.js, and the filter chips come from
 * the same file, so a chip cannot exist without a primitive behind it.
 *
 * The filter is a chip row plus a "works alone" toggle and a live count, and the state
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

    /** "New here?": three Learn demos, in order, each with what it teaches. */
    function startHere(cat) {
        var list = document.getElementById('startList');
        if (!list) return;
        (cat.start || []).forEach(function (s) {
            var e = Catalogue.byId(cat, s.id), li = el('li'), a = link(e.url, 'hub-start__item');
            a.append(el('strong', '', e.name), document.createTextNode(' · ' + s.what));
            li.appendChild(a);
            list.appendChild(li);
        });
    }

    /** Who it needs: a Learn demo works alone or wants a second person; a template says its players. */
    function tags(entry) {
        var t = el('div', 'media-card__tags');
        if (entry.shelf === 'learn') t.appendChild(el('span', entry.solo ? 'tag tag--solo' : 'tag', entry.solo ? 'Works alone' : 'Best with 2'));
        else if (entry.players) t.appendChild(el('span', 'tag', entry.players));
        return t;
    }

    /** Two clear actions, then the links: Open, Source (or Details), then the product it became. */
    function actions(entry) {
        var f = el('div', 'media-card__actions');
        f.appendChild(link(entry.url, 'btn-primary', 'Open'));
        if (entry.source) f.appendChild(link('/messaging-platform/sdk/' + entry.source[0], 'btn-secondary', 'Source'));
        else if (entry.about && entry.about !== entry.url) f.appendChild(link(entry.about, 'btn-secondary', 'Details'));
        if (entry.product) f.appendChild(link(entry.product.url, 'btn-secondary', 'Product: ' + entry.product.name));
        (entry.links || []).forEach(function (l) { f.appendChild(link(l.url, 'btn-secondary', l.label)); });
        return f;
    }

    function card(cat, entry) {
        var a = el('article', 'media-card entry');
        a.setAttribute('data-proves', (entry.primitives || []).join(' '));
        a.setAttribute('data-solo', entry.solo ? 'true' : 'false');
        var art = el('figure', 'media-card__art'), img = el('img');
        Object.assign(img, { src: entry.image, width: 960, height: 600, loading: 'lazy', decoding: 'async', alt: Catalogue.imageAlt(entry) });
        art.appendChild(img);
        var body = el('div', 'media-card__body');
        body.append(el('p', 'media-card__meta', entry.pattern || entry.category || (entry.badges || []).slice(0, 3).join(' · ')),
            el('h3', '', entry.name), el('p', 'media-card__lead', entry.blurb));
        if (entry.call) body.appendChild(el('code', 'media-card__call', entry.call));
        body.append(tags(entry), actions(entry));
        a.append(art, body);
        return a;
    }

    function section(cat, name) {
        var entries = Catalogue.shelf(cat, name);
        if (!entries.length) return null;
        var shelf = cat.shelves[name], s = el('section', 'hub-shelf hub-shelf--' + name), wrap = el('div', 'wrap');
        var head = el('div', 'hub-shelf__head'), text = el('div');
        text.append(el('h2', '', shelf.title), el('p', '', shelf.lead));
        head.appendChild(text);
        if (shelf.more) head.appendChild(link(shelf.more.url, 'hub-shelf__more', shelf.more.label + ' →'));
        var grid = el('div', 'card-grid');
        grid.setAttribute('data-entry-grid', '');
        entries.forEach(function (e) { grid.appendChild(card(cat, e)); });
        wrap.append(head, grid);
        s.appendChild(wrap);
        return s;
    }

    /** What left the gallery says where it went, folded away: no dead ends, little noise. */
    function movedNote(cat) {
        var gone = Catalogue.moved(cat), box = document.getElementById('movedRoot');
        if (!gone.length || !box) return;
        var d = el('details', 'hub-moved'), list = el('ul', 'moved-list');
        d.appendChild(el('summary', '', 'Looking for an older demo? (' + gone.length + ' moved)'));
        gone.forEach(function (e) {
            var li = el('li'), to = e.movedTo && Catalogue.byId(cat, e.movedTo);
            li.append(link(e.url, '', e.name), document.createTextNode(' — ' + e.note + ' '));
            if (to) li.appendChild(link(to.url, '', 'Open ' + to.name));
            list.appendChild(li);
        });
        d.appendChild(list);
        box.appendChild(d);
    }

    function render(cat) {
        chips(cat);
        startHere(cat);
        Object.keys(cat.shelves).forEach(function (name) {
            var s = section(cat, name);
            if (s) rootEl.appendChild(s);
        });
        movedNote(cat);
    }

    // ------------------------------------------------------------- filter

    var chipEls = [], entries = [], state = { proves: 'all', solo: false };
    var soloBox = document.getElementById('soloOnly');
    var empty = document.getElementById('filterEmpty');
    var countEl = document.getElementById('filterCount');

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
        if (countEl) countEl.textContent = shown + ' shown';
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
