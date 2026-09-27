/*
 * Catalogue — the one list of demos, games and apps (data/catalogue.json).
 *
 * The hub and the Playground each used to carry their own copy of this list,
 * and the copies disagreed with each other and with the code. Both now read
 * the same file through this, and test/js/catalogue.test.js checks the file
 * against the code: a card cannot claim a primitive its demo never calls.
 *
 *   Catalogue.load().then((cat) => {
 *       Catalogue.shelf(cat, 'learn');       // live entries on one shelf, in order
 *       Catalogue.moved(cat);                // what left the gallery, and where to
 *       Catalogue.hubTags(cat, entry);       // Messaging / Presence / Storage / WebRTC
 *   });
 */
(function (root) {
    'use strict';

    let pending = null;

    /** The catalogue, fetched once per page. Relative: hub/ and sdk/ both serve data/. */
    function load() {
        if (!pending) {
            pending = fetch('data/catalogue.json', { cache: 'no-cache' }).then((r) => {
                if (!r.ok) throw new Error('catalogue ' + r.status);
                return r.json();
            });
        }
        return pending;
    }

    function shelf(cat, name) {
        return cat.entries.filter((e) => e.status === 'live' && e.shelf === name);
    }

    function moved(cat) {
        return cat.entries.filter((e) => e.status === 'moved');
    }

    function byId(cat, id) {
        return cat.entries.find((e) => e.id === id) || null;
    }

    /** A product has its own category; a demo's comes from what it proves. */
    function hubTags(cat, entry) {
        if (entry.category) return [entry.category];
        const tags = [];
        (entry.primitives || []).forEach((p) => {
            const tag = cat.primitives[p] && cat.primitives[p].hub;
            if (tag && tags.indexOf(tag) === -1) tags.push(tag);
        });
        return tags;
    }

    function imageAlt(entry) {
        return entry.imageAlt || 'Screenshot of ' + entry.name;
    }

    root.Catalogue = { load, shelf, moved, byId, hubTags, imageAlt };
})(typeof window !== 'undefined' ? window : this);
