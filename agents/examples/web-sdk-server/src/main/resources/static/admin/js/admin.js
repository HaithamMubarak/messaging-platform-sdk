/**
 * Admin console API client.
 *
 * Credentials live in sessionStorage rather than localStorage so a token does
 * not survive the browser session. Every response is checked with response.ok
 * before parsing, so a proxy error page surfaces as a clear message instead of
 * a JSON syntax error.
 */
const AdminAPI = (function () {
    'use strict';

    const TOKEN_KEY = 'admin_token';
    const INFO_KEY = 'admin_info';
    const store = window.sessionStorage;

    function getToken() { return store.getItem(TOKEN_KEY); }
    function setToken(token) { store.setItem(TOKEN_KEY, token); }

    function setAdminInfo(info) { store.setItem(INFO_KEY, JSON.stringify(info)); }
    function getAdminInfo() {
        const raw = store.getItem(INFO_KEY);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function clearAuth() {
        store.removeItem(TOKEN_KEY);
        store.removeItem(INFO_KEY);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(INFO_KEY);
    }

    function isLoggedIn() { return !!getToken(); }

    function sessionExpired() {
        clearAuth();
        window.location.replace('index.html?expired=1');
    }

    /** Raised for HTTP 403 so callers can probe for owner-only capabilities. */
    function ForbiddenError(message) {
        const err = new Error(message || 'This action requires owner privileges.');
        err.forbidden = true;
        return err;
    }

    async function request(path, options) {
        const opts = options || {};
        const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers);
        const token = getToken();
        if (token) headers['X-Admin-Token'] = token;

        let response;
        try {
            response = await fetch(ApiConfig.getAdminUrl() + path, Object.assign({}, opts, { headers }));
        } catch (e) {
            throw new Error('Network error — could not reach the messaging service.');
        }

        const text = await response.text();
        let body = null;
        if (text) {
            try { body = JSON.parse(text); } catch (e) { body = { statusMessage: text.slice(0, 200) }; }
        }

        if (response.status === 401 || (body && body.status === 'unauthorized')) {
            sessionExpired();
            throw new Error('Your admin session expired. Please sign in again.');
        }
        if (response.status === 403 || (body && body.status === 'forbidden')) {
            throw ForbiddenError(body && body.statusMessage);
        }
        if (!response.ok || (body && body.status === 'error')) {
            const err = new Error((body && (body.statusMessage || body.message)) || 'Request failed (' + response.status + ')');
            err.status = response.status;
            throw err;
        }
        return body ? body.data : null;
    }

    /* ------------------------------------------------------------------ auth */

    async function login(email, password) {
        let response;
        try {
            response = await fetch(ApiConfig.getAdminUrl() + '/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
        } catch (e) {
            throw new Error('Network error — could not reach the messaging service.');
        }

        const text = await response.text();
        let body = null;
        if (text) {
            try { body = JSON.parse(text); } catch (e) { body = null; }
        }

        if (!response.ok || !body || body.status !== 'success' || !body.data) {
            throw new Error((body && body.statusMessage) || 'Invalid credentials or insufficient privileges.');
        }
        setToken(body.data.token);
        setAdminInfo(body.data.admin);
        return body.data.admin;
    }

    async function logout() {
        try { await request('/logout', { method: 'POST' }); } catch (e) { /* clear locally regardless */ }
        clearAuth();
    }

    /* ------------------------------------------------------------------ data */

    const getStats = () => request('/stats');
    const getPlans = () => request('/plans');

    const getDevelopers = (page, size, sort, dir, query) =>
        request('/developers?page=' + (page || 0) + '&size=' + (size || 20) +
                '&sort=' + (sort || 'createdAt') + '&dir=' + (dir || 'desc') +
                (query ? '&q=' + encodeURIComponent(query) : ''));

    /** Tail of the admin audit log — every privileged mutation is recorded. */
    const getAuditLog = (limit) => request('/audit?limit=' + (limit || 100));

    const getDeveloper = (id) => request('/developers/' + encodeURIComponent(id));

    const createDeveloper = (data) =>
        request('/developers', { method: 'POST', body: JSON.stringify(data) });

    const updateDeveloperPlan = (id, planId) =>
        request('/developers/' + encodeURIComponent(id) + '/plan', {
            method: 'PUT', body: JSON.stringify({ planId })
        });

    const resetDeveloperPassword = (id) =>
        request('/developers/' + encodeURIComponent(id) + '/reset-password', { method: 'POST' });

    /* --------------------------------------------------------- owner-only ---
       These return a ForbiddenError for a non-owner admin; the console probes
       with listAdmins() on boot and hides the controls when that happens. */

    const listAdmins = () => request('/admins');

    const updateDeveloperRoles = (id, roles) =>
        request('/developers/' + encodeURIComponent(id) + '/roles', {
            method: 'PUT', body: JSON.stringify({ roles })
        });

    const deleteDeveloper = (id) =>
        request('/developers/' + encodeURIComponent(id), { method: 'DELETE' });

    /* --------------------------------------------------------- key requests */

    const getApiRequests = (page, size, status) =>
        request('/api-requests?page=' + (page || 0) + '&size=' + (size || 20) +
                (status ? '&status=' + encodeURIComponent(status) : ''));

    const getPendingRequestCount = () => request('/api-requests/pending-count');

    const approveApiRequest = (id) =>
        request('/api-requests/' + encodeURIComponent(id) + '/approve', { method: 'POST' });

    const rejectApiRequest = (id, reason) =>
        request('/api-requests/' + encodeURIComponent(id) + '/reject', {
            method: 'POST', body: JSON.stringify({ reason: reason || null })
        });

    return {
        login, logout, isLoggedIn, getAdminInfo, clearAuth,
        getStats, getPlans, getAuditLog,
        getDevelopers, getDeveloper, createDeveloper, updateDeveloperPlan, resetDeveloperPassword,
        listAdmins, updateDeveloperRoles, deleteDeveloper,
        getApiRequests, getPendingRequestCount, approveApiRequest, rejectApiRequest
    };
})();
