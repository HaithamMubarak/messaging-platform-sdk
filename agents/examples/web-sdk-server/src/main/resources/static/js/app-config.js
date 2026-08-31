/**
 * Per-app settings, which may point AT a saved channel.
 *
 * The dependency runs one way and only one way:
 *
 *     app config  ---->  saved channels
 *
 * An app may record which channel it last used, and anything else that is
 * its own business. The channel list knows nothing about apps in return: a
 * saved channel is a room, not a record of who visited it.
 *
 * That inversion is easy to get wrong -- an `apps: []` array on the channel
 * row reads as harmless bookkeeping and quietly makes the channel list a
 * function of which apps exist. It is the wrong way round: apps come and go,
 * and a channel outlives all of them. Keeping the arrow pointing this way
 * means a channel can be exported, imported and reasoned about without
 * dragging any app's state with it.
 *
 * Stored per account so two people on one machine do not share app state,
 * and separately from the keyring so an export of your channels is exactly
 * that -- your channels.
 */
(function (window) {
    'use strict';

    var PREFIX = 'mp.appconfig.v1.';

    function keyFor(accountId) { return PREFIX + accountId; }

    function read(accountId) {
        if (!accountId) return {};
        try {
            var raw = localStorage.getItem(keyFor(accountId));
            if (!raw) return {};
            var v = JSON.parse(raw);
            return (v && typeof v === 'object') ? v : {};
        } catch (e) { return {}; }
    }

    function write(accountId, data) {
        if (!accountId) return;
        try { localStorage.setItem(keyFor(accountId), JSON.stringify(data)); } catch (e) {}
    }

    var AppConfig = {
        /** Everything this app has recorded. */
        get: function (accountId, appId) {
            return read(accountId)[appId] || {};
        },

        /** Merge settings into one app's record. */
        set: function (accountId, appId, patch) {
            if (!accountId || !appId) return;
            var all = read(accountId);
            var cur = all[appId] || {};
            Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
            all[appId] = cur;
            write(accountId, all);
        },

        /**
         * Note that this app used a saved channel. Stores the channel's ID --
         * a reference, never a copy: the name and password live in exactly
         * one place, so renaming or forgetting a channel cannot leave a stale
         * duplicate behind in some app's settings.
         */
        noteChannel: function (accountId, appId, channelId) {
            if (!accountId || !appId || !channelId) return;
            var all = read(accountId);
            var cur = all[appId] || {};
            cur.lastChannelId = channelId;
            cur.usedChannelIds = (cur.usedChannelIds || []).filter(function (id) {
                return id !== channelId;
            });
            cur.usedChannelIds.unshift(channelId);
            cur.usedChannelIds = cur.usedChannelIds.slice(0, 20);
            all[appId] = cur;
            write(accountId, all);
        },

        /**
         * Which apps have used this channel -- derived by asking the APPS,
         * which is the only direction that keeps the arrow pointing one way.
         * @returns {string[]}
         */
        appsUsing: function (accountId, channelId) {
            var all = read(accountId);
            return Object.keys(all).filter(function (appId) {
                var ids = all[appId] && all[appId].usedChannelIds;
                return Array.isArray(ids) && ids.indexOf(channelId) !== -1;
            }).sort();
        },

        /** Drop references to a channel that no longer exists. */
        forgetChannel: function (accountId, channelId) {
            var all = read(accountId);
            var touched = false;
            Object.keys(all).forEach(function (appId) {
                var cur = all[appId];
                if (cur.lastChannelId === channelId) { delete cur.lastChannelId; touched = true; }
                if (Array.isArray(cur.usedChannelIds) && cur.usedChannelIds.indexOf(channelId) !== -1) {
                    cur.usedChannelIds = cur.usedChannelIds.filter(function (id) { return id !== channelId; });
                    touched = true;
                }
            });
            if (touched) write(accountId, all);
        },

        clear: function (accountId) {
            if (!accountId) return;
            try { localStorage.removeItem(keyFor(accountId)); } catch (e) {}
        },

        KEY_PREFIX: PREFIX
    };

    window.AppConfig = AppConfig;
})(window);
