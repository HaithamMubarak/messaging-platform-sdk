/**
 * Admin Panel API Client
 * Handles communication with the messaging service admin endpoints
 */
const AdminAPI = (function() {
    // Configuration - uses shared ApiConfig
    const CONFIG = {
        baseUrl: ApiConfig.getAdminUrl(),
        tokenKey: 'admin_token',
        adminInfoKey: 'admin_info'
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
        localStorage.removeItem(CONFIG.adminInfoKey);
    }

    /**
     * Store admin info
     */
    function setAdminInfo(info) {
        localStorage.setItem(CONFIG.adminInfoKey, JSON.stringify(info));
    }

    /**
     * Get stored admin info
     */
    function getAdminInfo() {
        const info = localStorage.getItem(CONFIG.adminInfoKey);
        return info ? JSON.parse(info) : null;
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
            headers['X-Admin-Token'] = token;
        }

        const response = await fetch(`${CONFIG.baseUrl}${endpoint}`, {
            ...options,
            headers
        });

        const data = await response.json();

        if (data.status === 'unauthorized') {
            clearAuth();
            window.location.href = 'index.html';
            throw new Error('Session expired. Please log in again.');
        }

        if (data.status === 'error') {
            throw new Error(data.statusMessage || 'Request failed');
        }

        return data.data;
    }

    /**
     * Login with email and password
     */
    async function login(email, password) {
        try {
            const response = await fetch(`${CONFIG.baseUrl}/auth`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.status === 'success' && data.data) {
                setToken(data.data.token);
                setAdminInfo(data.data.admin);
                return { success: true, admin: data.data.admin };
            } else {
                return { success: false, error: data.statusMessage || 'Authentication failed' };
            }
        } catch (error) {
            return { success: false, error: error.message || 'Network error' };
        }
    }

    /**
     * Logout
     */
    async function logout() {
        try {
            await apiRequest('/logout', { method: 'POST' });
        } catch (e) {
            // Ignore errors on logout
        }
        clearAuth();
    }

    /**
     * Get dashboard statistics
     */
    async function getStats() {
        return apiRequest('/stats');
    }

    /**
     * Get all developers (paginated)
     */
    async function getDevelopers(page = 0, size = 20, sort = 'createdAt', dir = 'desc') {
        return apiRequest(`/developers?page=${page}&size=${size}&sort=${sort}&dir=${dir}`);
    }

    /**
     * Get developer by ID
     */
    async function getDeveloper(id) {
        return apiRequest(`/developers/${id}`);
    }

    /**
     * Create new developer
     */
    async function createDeveloper(data) {
        return apiRequest('/developers', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /**
     * Update developer's plan
     */
    async function updateDeveloperPlan(developerId, planId) {
        return apiRequest(`/developers/${developerId}/plan`, {
            method: 'PUT',
            body: JSON.stringify({ planId })
        });
    }

    /**
     * Get all plans
     */
    async function getPlans() {
        return apiRequest('/plans');
    }

    /**
     * Get API key requests (paginated)
     */
    async function getApiRequests(page = 0, size = 20, status = null) {
        let url = `/api-requests?page=${page}&size=${size}`;
        if (status) {
            url += `&status=${status}`;
        }
        return apiRequest(url);
    }

    /**
     * Get pending request count
     */
    async function getPendingRequestCount() {
        return apiRequest('/api-requests/pending-count');
    }

    /**
     * Approve an API key request
     */
    async function approveApiRequest(requestId) {
        return apiRequest(`/api-requests/${requestId}/approve`, {
            method: 'POST'
        });
    }

    /**
     * Reject an API key request
     */
    async function rejectApiRequest(requestId, reason = null) {
        return apiRequest(`/api-requests/${requestId}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
    }

    // Public API
    return {
        login,
        logout,
        isLoggedIn,
        getAdminInfo,
        getStats,
        getDevelopers,
        getDeveloper,
        createDeveloper,
        updateDeveloperPlan,
        getPlans,
        getApiRequests,
        getPendingRequestCount,
        approveApiRequest,
        rejectApiRequest
    };
})();

