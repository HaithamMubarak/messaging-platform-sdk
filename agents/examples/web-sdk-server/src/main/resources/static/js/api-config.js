/**
 * Common API configuration.
 *
 * Resolves the messaging-service base URL from the environment instead of a
 * hardcoded flag, so a local or staging portal never mutates production data
 * by accident. Resolution order:
 *
 *   1. window.MESSAGING_API_BASE — explicit override injected by the host page.
 *   2. Same origin, when the page is served from the platform host or from
 *      under the /messaging-platform prefix (gateway-proxied). Avoids CORS.
 *   3. The public platform host — the documented fallback for a portal opened
 *      directly from a developer machine.
 */
const ApiConfig = (function () {
    'use strict';

    const PUBLIC_HOST = 'https://hmdevonline.com';
    const PLATFORM_PREFIX = '/messaging-platform/api/v1';

    function resolveOrigin() {
        if (typeof window.MESSAGING_API_BASE === 'string' && window.MESSAGING_API_BASE) {
            return window.MESSAGING_API_BASE.replace(/\/+$/, '');
        }
        const host = window.location.hostname || '';
        const path = window.location.pathname || '';
        // Served by the platform itself → same-origin relative paths.
        if (host.endsWith('hmdevonline.com') || path.startsWith('/messaging-platform')) {
            return '';
        }
        return PUBLIC_HOST;
    }

    function environment() {
        const origin = resolveOrigin();
        const host = origin ? new URL(origin, window.location.href).hostname : window.location.hostname;
        if (host.endsWith('hmdevonline.com')) return 'production';
        if (host === 'localhost' || host === '127.0.0.1') return 'local';
        return 'custom';
    }

    /** Messaging service base URL, optionally with a suffix such as '/admin'. */
    function getMessagingServiceUrl(suffix) {
        const base = resolveOrigin() + PLATFORM_PREFIX + '/messaging-service';
        return suffix ? base + suffix : base;
    }

    /** Developer authentication base URL. */
    function getDeveloperAuthUrl() {
        return resolveOrigin() + PLATFORM_PREFIX + '/developer/auth';
    }

    /** Developer API base URL (stats, keys, channels, usage). */
    function getDeveloperApiUrl() {
        return resolveOrigin() + PLATFORM_PREFIX + '/developer';
    }

    /** Admin API base URL. */
    function getAdminUrl() {
        return getMessagingServiceUrl('/admin');
    }

    /** Public, unauthenticated API-key request endpoint. */
    function getApiKeyRequestUrl() {
        return getMessagingServiceUrl('/request-api-key');
    }

    function isProduction() {
        return environment() === 'production';
    }

    return {
        getMessagingServiceUrl,
        getDeveloperAuthUrl,
        getDeveloperApiUrl,
        getAdminUrl,
        getApiKeyRequestUrl,
        environment,
        isProduction
    };
})();
