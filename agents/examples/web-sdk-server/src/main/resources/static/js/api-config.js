/**
 * Common API Configuration
 * Shared configuration for admin and developer portals
 */
const ApiConfig = (function() {
    // Force use hmdevonline.com base URL (set to true for testing against production)
    const FORCE_HMDEVONLINE = true;

    /**
     * Get messaging service base URL
     * @param {string} suffix - Optional suffix to append (e.g., '/admin', '/developer/auth')
     * @returns {string} Full base URL
     */
    function getMessagingServiceUrl(suffix = '') {
        const base = FORCE_HMDEVONLINE
            ? 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service'
            : (window.location.hostname === 'localhost'
                ? 'http://localhost:8081/messaging-platform/api/v1/messaging-service'
                : '/messaging-platform/api/v1/messaging-service');

        return suffix ? `${base}${suffix}` : base;
    }

    /**
     * Get developer auth base URL
     * @returns {string} Full developer auth base URL
     */
    function getDeveloperAuthUrl() {
        return FORCE_HMDEVONLINE
            ? 'https://hmdevonline.com/messaging-platform/api/v1/developer/auth'
            : (window.location.hostname === 'localhost'
                ? 'http://localhost:8081/messaging-platform/api/v1/developer/auth'
                : '/messaging-platform/api/v1/developer/auth');
    }

    /**
     * Get admin base URL
     * @returns {string} Full admin base URL
     */
    function getAdminUrl() {
        return getMessagingServiceUrl('/admin');
    }

    /**
     * Check if using production environment
     * @returns {boolean}
     */
    function isProduction() {
        return FORCE_HMDEVONLINE;
    }

    // Public API
    return {
        getMessagingServiceUrl,
        getDeveloperAuthUrl,
        getAdminUrl,
        isProduction,
        FORCE_HMDEVONLINE
    };
})();
