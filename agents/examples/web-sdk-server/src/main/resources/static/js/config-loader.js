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
     * @returns {Promise<object>} Config with fresh temporary key
     */
    window.fetchAppConfig = async function(ttlSeconds = 60, singleUse = false, allowFallback = false) {
        try {
            const configUrl = window.getConfigUrl();
            
            console.log('[Config] Fetching fresh temporary key...');

            const response = await fetch(configUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ttlSeconds: ttlSeconds,
                    singleUse: singleUse
                })
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
                        body: JSON.stringify({
                            ttlSeconds: ttlSeconds,
                            singleUse: singleUse
                        })
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

})();
