/**
 * Developer Portal API client.
 *
 * Two deliberate changes from the previous version:
 *
 *  1. No mock fallbacks. A failed request throws, so the UI can render a real
 *     error state instead of confidently displaying fabricated zeros.
 *  2. Credentials live in sessionStorage, not localStorage — they die with the
 *     tab instead of persisting on disk indefinitely. Moving the session token
 *     to an HttpOnly cookie remains the right long-term fix and needs a
 *     backend change.
 */
const DeveloperAPI = (function () {
    'use strict';

    const TOKEN_KEY = 'developer_token';
    const PROFILE_KEY = 'developer_profile';

    const store = window.sessionStorage;

    function setToken(token) { store.setItem(TOKEN_KEY, token); }
    function getToken() { return store.getItem(TOKEN_KEY); }

    function setProfile(profile) { store.setItem(PROFILE_KEY, JSON.stringify(profile)); }
    function getProfile() {
        const raw = store.getItem(PROFILE_KEY);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function clearAuth() {
        store.removeItem(TOKEN_KEY);
        store.removeItem(PROFILE_KEY);
        // Legacy keys written by earlier builds of the portal and test console.
        ['developer_token', 'developer_profile', 'devConsoleApiKey', 'devConsoleApiUrl']
            .forEach((k) => localStorage.removeItem(k));
    }

    function isLoggedIn() { return !!getToken(); }

    function sessionExpired() {
        clearAuth();
        window.location.replace('index.html?expired=1');
    }

    /** Parse a response body defensively — proxies can return HTML error pages. */
    async function readBody(response) {
        const text = await response.text();
        if (!text) return null;
        try { return JSON.parse(text); } catch (e) { return { message: text.slice(0, 200) }; }
    }

    async function request(url, options) {
        const opts = options || {};
        const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers);
        const token = getToken();
        if (token) headers.Authorization = 'Bearer ' + token;

        let response;
        try {
            response = await fetch(url, Object.assign({}, opts, { headers }));
        } catch (e) {
            throw new Error('Network error — could not reach the messaging service.');
        }

        if (response.status === 401 || response.status === 403) {
            sessionExpired();
            throw new Error('Your session expired. Please sign in again.');
        }

        const body = await readBody(response);

        // The messaging service answers failures with HTTP 200 and
        // {"status":"error"|"unauthorized"|"forbidden", "statusMessage":…}, so
        // response.ok alone is not success. Checking only the status code meant
        // a refused delete still toasted "Channel deleted." and a rejected
        // broadcast still toasted "Broadcast sent." — the console confirmed
        // things that had not happened. The admin client already checks this.
        const failed = body && typeof body === 'object'
            && (body.status === 'error' || body.status === 'unauthorized' || body.status === 'forbidden');

        if (!response.ok || failed) {
            if (failed && (body.status === 'unauthorized')) {
                sessionExpired();
            }
            throw new Error(
                (body && (body.error || body.message || body.statusMessage)) ||
                'Request failed (' + response.status + ')'
            );
        }
        return body;
    }

    const devApi = (path, options) => request(ApiConfig.getDeveloperApiUrl() + path, options);
    const authApi = (path, options) => request(ApiConfig.getDeveloperAuthUrl() + path, options);

    /**
     * Calls against the messaging service itself (broadcast, temporary keys,
     * message recovery, channel deletion) authenticate with the API key rather
     * than the session token.
     */
    async function serviceApi(path, options) {
        const opts = options || {};
        const key = getApiKey();
        if (!key) {
            throw new Error('Your API key is not available in this session. Sign in again to use this tool.');
        }
        return request(ApiConfig.getMessagingServiceUrl() + path, Object.assign({}, opts, {
            headers: Object.assign({ 'X-API-Key': key }, opts.headers)
        }));
    }

    function getApiKey() {
        const profile = getProfile();
        return (profile && profile.apiKey) || null;
    }

    /* ------------------------------------------------------------------ auth */

    async function login(email, password) {
        const response = await fetch(ApiConfig.getDeveloperAuthUrl() + '/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const body = await readBody(response);
        if (!response.ok) {
            throw new Error((body && (body.error || body.message)) || 'Sign-in failed. Check your email and password.');
        }
        setToken(body.sessionToken);
        setProfile(body);
        return body;
    }

    async function logout() {
        const token = getToken();
        if (token) {
            try {
                await fetch(ApiConfig.getDeveloperAuthUrl() + '/logout', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + token }
                });
            } catch (e) { /* the local session is cleared regardless */ }
        }
        clearAuth();
    }

    function changePassword(currentPassword, newPassword) {
        return authApi('/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });
    }

    /* ------------------------------------------------------------------ data */

    const getStats     = () => devApi('/stats');
    const getApiKeys   = () => devApi('/api-keys');
    const getUsage     = () => devApi('/usage');
    const getChannels  = (page, size) => devApi('/channels?page=' + (page || 0) + '&size=' + (size || 10));
    const getChannelMetrics = (id) => devApi('/channels/' + encodeURIComponent(id) + '/metrics');
    const getApiKeyUsage    = (id) => devApi('/api-keys/' + encodeURIComponent(id) + '/usage');
    const revokeApiKey      = (id) => devApi('/api-keys/' + encodeURIComponent(id) + '/revoke', { method: 'POST' });

    /* ----------------------------------------------------------------- tools */

    const createTemporaryKey = (ttlSeconds, singleUse) => serviceApi('/channels/api-access', {
        method: 'POST',
        body: JSON.stringify({ ttlSeconds, singleUse })
    });

    const broadcast = (message, channelId) => serviceApi('/broadcast', {
        method: 'POST',
        body: JSON.stringify({ message, channelId: channelId || null, encrypted: false, timestamp: Date.now() })
    });

    const recoverMessages = (channelId, fromOffset, maxMessages) => serviceApi('/recover-messages', {
        method: 'POST',
        body: JSON.stringify({ channelId, fromOffset, maxMessages })
    });

    const getChannelAgents = (channelId) =>
        serviceApi('/channels/' + encodeURIComponent(channelId) + '/agents');

    const deleteChannel = (channelId) =>
        serviceApi('/channels/' + encodeURIComponent(channelId), { method: 'DELETE' });

    /* ---------------------------------------------------- platform account */

    /*
     * The Platform account and this developer account are separate on purpose:
     * one is a person, the other is the tenant that owns the plan and the keys.
     * Linking records that one person holds both, and grants nothing —
     * every call below still authenticates with the DEVELOPER session.
     *
     * The proof comes from Rooms, where the person's password already lives,
     * so no Platform password is ever handled here.
     */
    const getAccountLink    = () => devApi('/account-link');
    const linkPlatform      = (assertion) => devApi('/account-link', {
        method: 'POST',
        body: JSON.stringify({ assertion })
    });
    const unlinkPlatform    = () => devApi('/account-link', { method: 'DELETE' });

    return {
        login, logout, isLoggedIn, changePassword,
        getToken, getProfile, setProfile, getApiKey, clearAuth,
        getStats, getApiKeys, getUsage, getChannels, getChannelMetrics, getApiKeyUsage, revokeApiKey,
        createTemporaryKey, broadcast, recoverMessages, getChannelAgents, deleteChannel,
        getAccountLink, linkPlatform, unlinkPlatform
    };
})();
