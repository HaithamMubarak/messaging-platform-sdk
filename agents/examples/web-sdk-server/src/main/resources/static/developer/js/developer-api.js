/**
 * Developer Portal API Client
 * Handles communication with the messaging service developer endpoints
 */
const DeveloperAPI = (function() {
    // Configuration - uses shared ApiConfig
    // Developer endpoints are at /messaging-platform/api/v1/developer (without /messaging-service)
    const CONFIG = {
        baseUrl: ApiConfig.getDeveloperAuthUrl().replace('/auth', ''), // Remove /auth to get base developer URL
        tokenKey: 'developer_token',
        profileKey: 'developer_profile'
    };

    /**
     * Store authentication token
     */
    function setToken(token) {
        localStorage.setItem(CONFIG.tokenKey, token);
    }

    /**
     * Get stored authentication token
     */
    function getToken() {
        return localStorage.getItem(CONFIG.tokenKey);
    }

    /**
     * Clear authentication data
     */
    function clearAuth() {
        localStorage.removeItem(CONFIG.tokenKey);
        localStorage.removeItem(CONFIG.profileKey);
    }

    /**
     * Store developer profile
     */
    function setProfile(profile) {
        localStorage.setItem(CONFIG.profileKey, JSON.stringify(profile));
    }

    /**
     * Get stored developer profile
     */
    function getProfile() {
        const profile = localStorage.getItem(CONFIG.profileKey);
        return profile ? JSON.parse(profile) : null;
    }

    /**
     * Check if user is logged in
     */
    function isLoggedIn() {
        return !!getToken();
    }

    /**
     * Make API request with authentication
     */
    async function apiRequest(endpoint, options = {}) {
        const token = getToken();

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${CONFIG.baseUrl}${endpoint}`, {
            ...options,
            headers
        });

        if (response.status === 401) {
            clearAuth();
            window.location.href = 'index.html';
            throw new Error('Session expired. Please log in again.');
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.message || 'Request failed');
        }

        return data;
    }

    /**
     * Login with email and password
     */
    async function login(email, password) {
        const response = await fetch(`${ApiConfig.getDeveloperAuthUrl()}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        // Store token and profile
        setToken(data.sessionToken);
        setProfile(data);

        return data;
    }

    /**
     * Logout current user
     */
    async function logout() {
        const token = getToken();
        if (token) {
            try {
                await fetch(`${ApiConfig.getDeveloperAuthUrl()}/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            } catch (e) {
                // Ignore logout errors
            }
        }
        clearAuth();
    }

    /**
     * Change password
     */
    async function changePassword(currentPassword, newPassword) {
        const token = getToken();
        const response = await fetch(`${ApiConfig.getDeveloperAuthUrl()}/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to change password');
        }

        return data;
    }

    /**
     * Get developer stats for dashboard
     */
    async function getStats() {
        try {
            return await apiRequest('/stats');
        } catch (e) {
            // Return mock data if endpoint not available
            const profile = getProfile();
            return {
                channelCount: 0,
                apiKeyCount: 1,
                quotaUsedPercent: 0,
                plan: profile?.plan || 'Free'
            };
        }
    }

    /**
     * Get developer's API keys
     */
    async function getApiKeys() {
        try {
            return await apiRequest('/api-keys');
        } catch (e) {
            // Return profile API key if endpoint not available
            const profile = getProfile();
            if (profile && profile.apiKey) {
                return [{
                    keyId: profile.apiKey.split('.')[0],
                    name: 'Primary Key',
                    plan: profile.plan || 'Free',
                    active: true,
                    createdAt: new Date().toISOString()
                }];
            }
            return [];
        }
    }

    /**
     * Get developer's channels
     */
    async function getChannels(page = 0, size = 10) {
        try {
            return await apiRequest(`/channels?page=${page}&size=${size}`);
        } catch (e) {
            return { channels: [], totalPages: 0, totalCount: 0 };
        }
    }

    /**
     * Get usage statistics
     */
    async function getUsage() {
        try {
            return await apiRequest('/usage');
        } catch (e) {
            const profile = getProfile();
            return {
                channelUnitsUsed: 0,
                channelUnitsLimit: 100,
                apiCallsToday: 0,
                apiCallsLimit: 10000,
                storageMB: 0,
                storageLimitMB: 100,
                plan: profile?.plan || 'Free',
                planFeatures: [
                    'Up to 100 channel units',
                    '10,000 API calls per day',
                    '100 MB storage',
                    'Community support'
                ]
            };
        }
    }

    /**
     * Revoke an API key
     */
    async function revokeApiKey(keyId) {
        return await apiRequest(`/api-keys/${keyId}/revoke`, {
            method: 'POST'
        });
    }

    // Public API
    return {
        login,
        logout,
        isLoggedIn,
        getToken,
        getProfile,
        setProfile,
        changePassword,
        getStats,
        getApiKeys,
        getChannels,
        getUsage,
        revokeApiKey,
        apiRequest
    };
})();
