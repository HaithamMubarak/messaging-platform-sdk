/**
 * Web Agent Configuration Loader
 * Fetches secure configuration (including API key) from backend
 */
(function() {
    'use strict';

    // Configuration state
    window.webAgentConfig = {
        loaded: false,
        apiKey: null,
        messagingApiUrl: null,
        error: null
    };

    /**
     * Get the configuration URL (for fetching fresh temporary keys)
     * Automatically detects environment and returns appropriate URL
     * @returns {string} The config endpoint URL
     */
    window.getConfigUrl = function() {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;

        let configUrl;

        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            // Local development: use absolute path to service
            configUrl = '/app/api/config';
            console.log('[Config] Local environment detected, using:', configUrl);
        } else if (pathname && pathname.startsWith('/messaging-platform')) {
            // When already under messaging-platform prefix (gateway proxied), call the web-agent service via prefixed path
            configUrl = '/messaging-platform/sdk/app/api/config';
            console.log('[Config] Under messaging-platform prefix, using:', configUrl);
        } else {
            // Unsupported deployment configuration
            throw new Error('[Config] Unsupported deployment: Not localhost and not under /messaging-platform prefix. Current path: ' + pathname);
        }

        return configUrl;
    };

    /**
     * Fetch a fresh temporary key with custom parameters
     * @param {number} ttlSeconds - Time to live in seconds (default: 60)
     * @param {boolean} singleUse - Whether key is single-use (default: false)
     * @param {boolean} allowFallback - Whether to fallback to hmdevonline.com on failure (default: false)
     * @param {boolean} joinOnly - A key that joins rooms that exist and never creates one (default: false)
     * @returns {Promise<object>} Config with fresh temporary key
     */
    window.fetchAppConfig = async function(ttlSeconds = 60, singleUse = false, allowFallback = false, joinOnly = false) {
        const body = { ttlSeconds: ttlSeconds, singleUse: singleUse };
        if (joinOnly) body.createChannels = false;
        try {
            const configUrl = window.getConfigUrl();
            
            console.log('[Config] Fetching fresh temporary key...');

            const response = await fetch(configUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch config: ${response.statusText}`);
            }

            const result = await response.json();
            const config = result.status === 'success' ? result.data : result;
            
            console.log('[Config] Fresh temporary key obtained');

            // Backend now returns apiKey directly (via @JsonProperty annotation)
            return config;
        } catch (error) {
            console.error('[Config] Failed to fetch config from local:', error);

            // Fallback to hmdevonline.com if allowed
            if (allowFallback) {
                console.log('[Config] Attempting fallback to hmdevonline.com...');
                try {
                    const fallbackUrl = 'https://hmdevonline.com/messaging-platform/web-agent/app/api/config';

                    const response = await fetch(fallbackUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(body)
                    });

                    if (!response.ok) {
                        throw new Error(`Fallback failed: ${response.statusText}`);
                    }

                    const result = await response.json();
                    const config = result.status === 'success' ? result.data : result;

                    console.log('[Config] ✅ Fallback successful - using hmdevonline.com');
                    return config;
                } catch (fallbackError) {
                    console.error('[Config] ❌ Fallback to hmdevonline.com also failed:', fallbackError);
                    throw new Error('Both local and fallback config fetch failed');
                }
            }

            throw error;
        }
    };

    /**
     * Fetch a single-use temporary key for secure connections
     * Single-use keys are automatically deleted after first use for maximum security
     * @param {number} ttlSeconds - Time to live in seconds (default: 30)
     * @returns {Promise<object>} Config with single-use temporary key
     */
    window.fetchSingleUseConfig = async function(ttlSeconds = 30) {
        return await window.fetchAppConfig(ttlSeconds, true);
    };

    /**
     * Fetch a join-only temporary key for a guest: it joins rooms that exist and
     * never creates one, so a guest cannot open a room of its own and be first in
     * it. Pair it with a room your backend opened (openHostedRoom). The server
     * refuses rather than hand out a key that creates rooms.
     * @param {number} ttlSeconds - Time to live in seconds (default: 60)
     * @returns {Promise<object>} Config with a join-only key (createChannels: false)
     */
    window.fetchJoinOnlyConfig = async function(ttlSeconds = 60) {
        return await window.fetchAppConfig(ttlSeconds, false, false, true);
    };

    /**
     * Open a room whose host is this page (POST /app/api/host, beside /config).
     * The backend makes the room's name and password and names agentName its
     * host, so nobody who reaches the room first becomes its host.
     * @param {string} app - the page's customType (the room is `<channelName>.<app>`)
     * @param {string} agentName - the name this page connects as
     * @param {string} [tenant] - whose account, as for /config
     * @returns {Promise<{channelName, channelPassword, channelId, hostAgent, agentKey, agentKeyTtlSeconds}>}
     *          pass agentKey to connect() and to nobody else
     */
    window.openHostedRoom = async function(app, agentName, tenant) {
        const url = window.getConfigUrl().replace(/\/config$/, '/host');
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app: app, agentName: agentName, tenant: tenant || undefined })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.status !== 'success') {
            throw new Error(result.message || result.statusMessage || ('Could not open a room (' + response.status + ')'));
        }
        return result.data;
    };

    /**
     * The room a page connects to, for an app whose authority (the host)
     * opens its room through the backend and everyone else arrives by its link.
     *
     * A page opened with a shared link (`#<auth>#<slug>` in its address) joins
     * the room the link names, as a guest, with what the person typed. Any
     * other page is the host: it opens a room (openHostedRoom), or gets back
     * the one this tab opened while the host key lasts, so a reload rejoins it.
     *
     *   const args = await HostedRoom.connectArgs('myapp', username, channel, password);
     *   await app.connect(args);   // {username, channelName, channelPassword, agentKey?}
     */
    window.HostedRoom = {
        storageKey: function (app) { return 'hosted-room.' + app; },

        /** The room this tab opened as host for app, while its key lasts; else null. */
        kept: function (app) {
            try {
                const kept = JSON.parse(sessionStorage.getItem(this.storageKey(app)) || 'null');
                return kept && kept.expiresAt > Date.now() + 60000 ? kept : null;
            } catch (_) { return null; }
        },

        /** The room the page's link names ({c, p}), unless it is this tab's own hosted room. */
        linked: function (app) {
            const encoded = window.location.hash.replace(/^#/, '').split('#')[0];
            const auth = encoded && window.ChannelAuthUtils ? window.ChannelAuthUtils.decodeAuto(encoded) : null;
            if (!auth || !auth.c) return null;
            const kept = this.kept(app);
            return kept && kept.channelName === auth.c ? null : auth;
        },

        /** Open a room for app with username as its host, or get back this tab's own. */
        open: async function (app, username) {
            const kept = this.kept(app);
            if (kept && kept.hostAgent === username) return kept;
            const room = await window.openHostedRoom(app, username);
            room.expiresAt = Date.now() + (room.agentKeyTtlSeconds || 0) * 1000;
            try { sessionStorage.setItem(this.storageKey(app), JSON.stringify(room)); } catch (_) { /* this page only */ }
            return room;
        },

        /** What to pass to connect(): the linked room as a guest, else this page's hosted room as its host. */
        connectArgs: async function (app, username, channel, password) {
            if (this.linked(app)) return { username: username, channelName: channel, channelPassword: password };
            const room = await this.open(app, username);
            return { username: room.hostAgent, channelName: room.channelName,
                channelPassword: room.channelPassword, agentKey: room.agentKey };
        }
    };

})();
