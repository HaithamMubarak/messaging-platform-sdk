/**
 * Admin console.
 *
 * Requests arrive from a public, unauthenticated form, so every field on this
 * screen is attacker-controlled. Nothing is ever interpolated into HTML or an
 * inline handler: rows are built with createElement and textContent.
 */
(function () {
    'use strict';

    const el = UI.el;

    const SECTIONS = {
        overview:   { title: 'Overview',        load: loadOverview },
        requests:   { title: 'API key requests', load: loadRequests },
        developers: { title: 'Developers',      load: loadDevelopers },
        plans:      { title: 'Plans',           load: loadPlans },
        audit:      { title: 'Audit log',       load: loadAudit },
        admins:     { title: 'Administrators',  load: loadAdmins }
    };

    const state = {
        isOwner: false,
        plans: [],
        developerPage: 0,
        developerPageSize: 20,
        developerTotalPages: 1,
        developerSort: 'createdAt',
        developerDir: 'desc',
        developerRows: [],
        developerQuery: '',
        auditRows: [],
        requestPage: 0,
        requestTotalPages: 1
    };

    /* --------------------------------------------------------------- routing */

    function currentSection() {
        const name = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
        if (name === 'admins' && !state.isOwner) return 'overview';
        return SECTIONS[name] ? name : 'overview';
    }

    function route() {
        const name = currentSection();
        Object.keys(SECTIONS).forEach((key) => {
            document.getElementById('section-' + key).hidden = key !== name;
        });
        document.querySelectorAll('.nav-item').forEach((item) => {
            if (item.dataset.section === name) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
        document.getElementById('pageTitle').textContent = SECTIONS[name].title;
        document.title = SECTIONS[name].title + ' — Admin console';
        SECTIONS[name].load();
    }

    /* ---------------------------------------------------------------- chrome */

    function initChrome() {
        const info = AdminAPI.getAdminInfo();
        document.getElementById('adminEmail').textContent = (info && info.email) || '—';

        const env = ApiConfig.environment();
        const badge = document.getElementById('envBadge');
        badge.className = 'env-badge ' + (env === 'production' ? 'env-badge--production' : 'env-badge--other');
        document.getElementById('envBadgeText').textContent =
            env === 'production' ? 'Production' : env;
    }

    /**
     * Owner status decides whether the Administrators section and the
     * destructive controls are offered at all.
     *
     * The auth response now carries it, so normally this is just a read. An
     * older backend omits the field, and there the only way to tell an owner
     * from a plain admin is to call an owner-only endpoint and read the 403 —
     * so that probe is kept as a fallback rather than removed.
     *
     * Either way this is presentation only: every owner-only route is enforced
     * server side, so a tampered value hides or reveals UI, not capability.
     */
    async function resolveOwner() {
        const info = AdminAPI.getAdminInfo();

        if (info && typeof info.owner === 'boolean') {
            state.isOwner = info.owner;
        } else {
            try {
                await AdminAPI.listAdmins();
                state.isOwner = true;
            } catch (err) {
                state.isOwner = false;
                if (!err.forbidden) return;   // network trouble — stay conservative
            }
        }

        document.getElementById('navAdmins').hidden = !state.isOwner;
        document.getElementById('adminRole').textContent = state.isOwner ? 'Owner' : 'Administrator';
    }

    async function refreshPendingBadge() {
        const badge = document.getElementById('pendingBadge');
        try {
            const result = await AdminAPI.getPendingRequestCount();
            const count = typeof result === 'number' ? result : (result && (result.count || result.pendingCount)) || 0;
            badge.textContent = UI.fmtNumber(count);
            badge.hidden = count === 0;
        } catch (e) {
            badge.hidden = true;
        }
    }

    /* -------------------------------------------------------------- overview */

    function setStat(name, value, status) {
        const card = document.querySelector('[data-stat="' + name + '"]');
        if (!card) return;
        card.dataset.state = status || 'ready';
        card.querySelector('.stat-card__value').textContent = value;
    }

    async function loadOverview() {
        document.querySelectorAll('#statsGrid .stat-card').forEach((c) => { c.dataset.state = 'loading'; });
        const errorHost = document.getElementById('statsError');
        errorHost.innerHTML = '';

        try {
            const stats = await AdminAPI.getStats();
            setStat('totalDevelopers', UI.fmtNumber(stats.totalDevelopers));
            setStat('activeDevelopers', UI.fmtNumber(stats.activeDevelopers));
            setStat('pendingRequests', UI.fmtNumber(stats.pendingRequests));
            setStat('totalChannels', UI.fmtNumber(stats.totalChannels));
            setStat('totalPlans', UI.fmtNumber(stats.totalPlans));
        } catch (err) {
            document.querySelectorAll('#statsGrid .stat-card').forEach((c) => {
                c.dataset.state = 'error';
                c.querySelector('.stat-card__value').textContent = '—';
            });
            errorHost.appendChild(errorAlert(err.message || 'Could not load platform statistics.', loadOverview));
        }

        refreshPendingBadge();
        loadRecentDevelopers();
    }

    function errorAlert(message, onRetry) {
        const alert = el('div', { class: 'alert alert--danger', role: 'alert' });
        alert.appendChild(UI.iconNode('alert-circle'));
        alert.appendChild(el('p', { style: 'flex:1', text: message }));
        if (onRetry) alert.appendChild(el('button', { class: 'btn btn--sm btn--ghost', text: 'Retry', onclick: onRetry }));
        return alert;
    }

    async function loadRecentDevelopers() {
        const host = document.getElementById('recentDevelopers');
        host.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const row = el('div', { class: 'recent-item' });
            row.appendChild(el('span', { class: 'skeleton', style: 'width:35%' }));
            host.appendChild(row);
        }

        try {
            // Always the newest five, independent of the Developers table paging.
            const data = await AdminAPI.getDevelopers(0, 5, 'createdAt', 'desc');
            const developers = (data && (data.developers || data.content)) || [];
            host.innerHTML = '';

            if (!developers.length) {
                host.appendChild(el('p', { class: 'field__hint', text: 'No developer accounts yet.' }));
                return;
            }

            developers.forEach((dev) => {
                const item = el('div', { class: 'recent-item' });
                item.appendChild(UI.iconNode('users'));
                const info = el('div', { style: 'min-width:0;flex:1' });
                info.appendChild(el('strong', { text: dev.email || '—' }));
                info.appendChild(el('span', {
                    class: 'meta',
                    text: (dev.name || 'No name') + ' · joined ' + UI.fmtRelative(dev.createdAt)
                }));
                item.appendChild(info);
                item.appendChild(el('button', {
                    class: 'btn btn--sm btn--ghost', text: 'Open',
                    onclick: () => openDeveloper(dev.id)
                }));
                host.appendChild(item);
            });
        } catch (err) {
            host.innerHTML = '';
            host.appendChild(errorAlert(err.message || 'Could not load recent developers.', loadRecentDevelopers));
        }
    }

    /* -------------------------------------------------------------- requests */

    const REQUEST_COLUMNS = 7;

    async function loadRequests() {
        const tbody = document.getElementById('requestsBody');
        UI.tableLoading(tbody, REQUEST_COLUMNS);

        const status = document.getElementById('requestStatus').value;
        try {
            const data = await AdminAPI.getApiRequests(state.requestPage, 20, status || null);
            const requests = (data && (data.requests || data.content)) || [];
            state.requestTotalPages = Math.max(1, (data && data.totalPages) || 1);
            renderRequests(requests);
        } catch (err) {
            UI.tableError(tbody, REQUEST_COLUMNS, { body: err.message, onAction: loadRequests });
            document.getElementById('requestCount').textContent = '';
        }
    }

    function statusBadge(status) {
        const value = String(status || '').toUpperCase();
        const cls = value === 'APPROVED' ? 'badge--success'
            : value === 'REJECTED' ? 'badge--danger'
            : value === 'PENDING' ? 'badge--warning' : '';
        return el('span', { class: 'badge ' + cls, text: value || 'UNKNOWN' });
    }

    function renderRequests(requests) {
        const tbody = document.getElementById('requestsBody');
        tbody.removeAttribute('aria-busy');
        tbody.innerHTML = '';

        if (!requests.length) {
            UI.tableEmpty(tbody, REQUEST_COLUMNS, {
                icon: 'inbox',
                title: 'Nothing in this queue',
                body: 'New key requests from the public site land here.'
            });
            document.getElementById('requestCount').textContent = '';
            updateRequestPager();
            return;
        }

        requests.forEach((req) => {
            const tr = el('tr');
            tr.appendChild(el('td', { class: 'email-cell', text: req.email || '—' }));
            tr.appendChild(el('td', { text: req.name || '—' }));
            tr.appendChild(el('td', { text: req.company || '—' }));

            // `title` is set as a property, never interpolated into markup.
            const reasonCell = el('td', { class: 'reason-cell', text: UI.truncate(req.reason || '—', 60) });
            if (req.reason) reasonCell.title = req.reason;
            tr.appendChild(reasonCell);

            tr.appendChild(el('td', { text: UI.fmtDate(req.createdAt || req.requestedAt, 'date') }));

            const statusCell = el('td');
            statusCell.appendChild(statusBadge(req.status));
            tr.appendChild(statusCell);

            const actions = el('td');
            const group = el('div', { class: 'cell-actions' });
            if (String(req.status || '').toUpperCase() === 'PENDING') {
                group.appendChild(el('button', {
                    class: 'btn btn--sm btn--primary', text: 'Approve',
                    onclick: () => approveRequest(req)
                }));
                group.appendChild(el('button', {
                    class: 'btn btn--sm btn--danger', text: 'Reject',
                    onclick: () => rejectRequest(req)
                }));
            } else {
                group.appendChild(el('span', { class: 'field__hint', text: '—' }));
            }
            actions.appendChild(group);
            tr.appendChild(actions);
            tbody.appendChild(tr);
        });

        document.getElementById('requestCount').textContent =
            'Showing ' + requests.length + ' request' + (requests.length === 1 ? '' : 's');
        updateRequestPager();
    }

    function updateRequestPager() {
        document.getElementById('requestPageInfo').textContent =
            'Page ' + (state.requestPage + 1) + ' of ' + state.requestTotalPages;
        document.getElementById('requestPrev').disabled = state.requestPage === 0;
        document.getElementById('requestNext').disabled = state.requestPage >= state.requestTotalPages - 1;
    }

    async function approveRequest(req) {
        await UI.confirm({
            title: 'Approve this request?',
            body: 'Approving creates a developer account for ' + (req.email || 'this address') +
                  ' and emails them credentials. The temporary password is shown here once.',
            confirmLabel: 'Approve and create account',
            onConfirm: async () => {
                const result = await AdminAPI.approveApiRequest(req.id);
                const secret = result && (result.apiKey || result.fullKey || result.tempPassword);
                if (secret) {
                    UI.showSecret({
                        title: 'Credentials for ' + (req.email || 'the new account'),
                        description: 'These are shown only once. The developer also receives them by email.',
                        value: secret,
                        meta: result.tempPassword && result.apiKey
                            ? 'Temporary password: ' + result.tempPassword
                            : null,
                        copyLabel: 'Credential copied'
                    });
                } else {
                    UI.toast.success('Request approved.');
                }
                loadRequests();
                refreshPendingBadge();
            }
        });
    }

    async function rejectRequest(req) {
        await UI.confirm({
            title: 'Reject this request?',
            body: 'The request from ' + (req.email || 'this address') + ' is closed. ' +
                  'The reason is recorded and may be included in the notification.',
            confirmLabel: 'Reject request',
            danger: true,
            reasonRequired: true,
            onConfirm: async (payload) => {
                await AdminAPI.rejectApiRequest(req.id, payload.reason);
                UI.toast.success('Request rejected.');
                loadRequests();
                refreshPendingBadge();
            }
        });
    }

    /* ------------------------------------------------------------ developers */

    const DEVELOPER_COLUMNS = 8;

    async function loadDevelopers() {
        const tbody = document.getElementById('developersBody');
        UI.tableLoading(tbody, DEVELOPER_COLUMNS);

        if (!state.plans.length) loadPlans();

        try {
            const data = await AdminAPI.getDevelopers(
                state.developerPage, state.developerPageSize, state.developerSort,
                state.developerDir, state.developerQuery);
            state.developerRows = (data && (data.developers || data.content)) || [];
            state.developerTotalPages = Math.max(1, (data && data.totalPages) || 1);
            renderDevelopers();
        } catch (err) {
            state.developerRows = [];
            UI.tableError(tbody, DEVELOPER_COLUMNS, { body: err.message, onAction: loadDevelopers });
        }
    }

    function quotaCell(dev) {
        const td = el('td');
        const value = UI.pct(dev.quotaUsed, dev.quotaLimit);
        if (value === null) {
            td.appendChild(el('span', { class: 'field__hint', text: 'No limit' }));
            return td;
        }
        const meter = el('div', {
            class: 'meter', role: 'progressbar',
            'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(value)),
            'aria-label': 'Quota used', style: 'min-width:7rem'
        });
        meter.dataset.level = value >= 90 ? 'danger' : value >= 75 ? 'warning' : 'ok';
        const track = el('div', { class: 'meter__track' });
        const fill = el('div', { class: 'meter__fill' });
        fill.style.width = value + '%';
        track.appendChild(fill);
        meter.appendChild(track);
        meter.appendChild(el('p', {
            class: 'meter__text',
            text: Number(dev.quotaUsed || 0).toFixed(1) + ' / ' + UI.fmtNumber(dev.quotaLimit)
        }));
        td.appendChild(meter);
        return td;
    }

    function renderDevelopers() {
        const tbody = document.getElementById('developersBody');
        // The server already applied the search term, so nothing is filtered here.
        const rows = state.developerRows;
        const query = state.developerQuery;

        tbody.removeAttribute('aria-busy');
        tbody.innerHTML = '';

        if (!rows.length) {
            UI.tableEmpty(tbody, DEVELOPER_COLUMNS, {
                icon: query ? 'search' : 'users',
                title: query ? 'No developers match "' + query + '"' : 'No developer accounts yet',
                body: query ? 'Search covers email and name across every account.' : 'Approve a key request to create the first one.',
                actionLabel: query ? 'Clear search' : null,
                onAction: query ? () => {
                    document.getElementById('developerFilter').value = '';
                    state.developerQuery = '';
                    state.developerPage = 0;
                    loadDevelopers();
                } : null
            });
            updateDeveloperPager(0);
            return;
        }

        rows.forEach((dev) => {
            const tr = el('tr');
            tr.appendChild(el('td', { class: 'email-cell', text: dev.email || '—' }));
            tr.appendChild(el('td', { text: dev.name || '—' }));

            const planCell = el('td');
            planCell.appendChild(el('span', {
                class: 'badge',
                text: (dev.plan && dev.plan.name) || dev.planName || 'No plan'
            }));
            tr.appendChild(planCell);

            tr.appendChild(el('td', { class: 'cell-num', text: UI.fmtNumber(dev.channelCount || 0) }));
            tr.appendChild(quotaCell(dev));
            tr.appendChild(el('td', { text: UI.fmtDate(dev.createdAt, 'date') }));

            const statusCell = el('td');
            statusCell.appendChild(el('span', {
                class: 'badge ' + (dev.active ? 'badge--success' : 'badge--danger'),
                text: dev.active ? 'Active' : 'Inactive'
            }));
            tr.appendChild(statusCell);

            const actions = el('td');
            const group = el('div', { class: 'cell-actions' });
            group.appendChild(el('button', {
                class: 'btn btn--sm btn--ghost', text: 'Details',
                onclick: () => openDeveloper(dev.id)
            }));
            actions.appendChild(group);
            tr.appendChild(actions);
            tbody.appendChild(tr);
        });

        updateDeveloperPager(rows.length);
    }

    function updateDeveloperPager(shown) {
        const searching = state.developerQuery.length > 0;
        document.getElementById('developerCount').textContent = shown
            ? 'Showing ' + shown + (searching ? ' matching' : '') + ' developer' + (shown === 1 ? '' : 's')
            : '';
        document.getElementById('developerPageInfo').textContent =
            'Page ' + (state.developerPage + 1) + ' of ' + state.developerTotalPages;
        document.getElementById('developerPrev').disabled = state.developerPage === 0;
        document.getElementById('developerNext').disabled = state.developerPage >= state.developerTotalPages - 1;
    }

    /* --------------------------------------------------- developer detail --- */

    async function openDeveloper(id) {
        UI.openModal((close) => {
            const body = el('div');
            const grid = el('div', { class: 'detail-grid' });
            for (let i = 0; i < 8; i++) {
                const item = el('div', { class: 'detail-item' });
                item.appendChild(el('span', { class: 'skeleton', style: 'width:55%' }));
                item.appendChild(el('span', { class: 'skeleton', style: 'width:75%' }));
                grid.appendChild(item);
            }
            body.appendChild(grid);

            AdminAPI.getDeveloper(id).then((dev) => {
                body.innerHTML = '';
                body.appendChild(buildDeveloperDetail(dev, close));
            }).catch((err) => {
                body.innerHTML = '';
                body.appendChild(errorAlert(err.message || 'Could not load this developer.'));
            });

            return UI.modalCard({ title: 'Developer details', body: body, wide: true }, close);
        });
    }

    function buildDeveloperDetail(dev, close) {
        const frag = document.createDocumentFragment();

        const grid = el('div', { class: 'detail-grid' });
        [
            ['ID', String(dev.id)],
            ['Email', dev.email || '—'],
            ['Name', dev.name || '—'],
            ['Company', dev.company || '—'],
            ['Plan', (dev.plan && dev.plan.name) || 'No plan'],
            ['Channels', UI.fmtNumber(dev.channelCount || 0)],
            ['Quota', Number(dev.quotaUsed || 0).toFixed(2) + ' / ' + UI.fmtNumber(dev.quotaLimit)],
            ['Status', dev.active ? 'Active' : 'Inactive'],
            ['Created', UI.fmtDate(dev.createdAt)],
            ['Updated', UI.fmtDate(dev.updatedAt)]
        ].forEach((pair) => {
            const item = el('div', { class: 'detail-item' });
            item.appendChild(el('span', { class: 'label', text: pair[0] }));
            item.appendChild(el('span', { class: 'value', text: pair[1] }));
            grid.appendChild(item);
        });
        frag.appendChild(grid);

        // --- Plan assignment
        const planSection = el('div', { class: 'drawer-section' });
        planSection.appendChild(el('h4', { text: 'Plan' }));
        const planRow = el('div', { style: 'display:flex;gap:var(--sp-3);flex-wrap:wrap;align-items:flex-end' });

        const planField = el('div', { class: 'field', style: 'flex:1;min-width:12rem;margin:0' });
        planField.appendChild(el('label', { class: 'field__label', for: 'planSelect', text: 'Assign plan' }));
        const select = el('select', { class: 'field__select', id: 'planSelect' });
        state.plans.forEach((plan) => {
            const option = el('option', { value: String(plan.id), text: plan.name + (plan.isDefault ? ' (default)' : '') });
            if (dev.plan && dev.plan.id === plan.id) option.selected = true;
            select.appendChild(option);
        });
        planField.appendChild(select);
        planRow.appendChild(planField);

        const applyBtn = el('button', { class: 'btn btn--primary', text: 'Update plan' });
        applyBtn.addEventListener('click', async () => {
            const planId = parseInt(select.value, 10);
            const target = state.plans.find((p) => p.id === planId);
            const current = dev.plan && dev.plan.name;
            if (!target) return;

            await UI.confirm({
                title: 'Change plan for ' + (dev.email || 'this developer') + '?',
                body: 'Moving from ' + (current || 'no plan') + ' to ' + target.name +
                      ' changes their quota to ' + UI.fmtNumber(target.channelUnits) +
                      ' channel units. It takes effect immediately.',
                confirmLabel: 'Change plan',
                onConfirm: async () => {
                    await AdminAPI.updateDeveloperPlan(dev.id, planId);
                    UI.toast.success('Plan updated.');
                    close(true);
                    loadDevelopers();
                }
            });
        });
        planRow.appendChild(applyBtn);
        planSection.appendChild(planRow);
        frag.appendChild(planSection);

        // --- Danger zone
        const danger = el('div', { class: 'danger-zone' });
        danger.appendChild(el('h4', { text: 'Danger zone' }));
        danger.appendChild(el('p', {
            text: state.isOwner
                ? 'Resetting a password invalidates the current one immediately. Deleting an account cannot be undone.'
                : 'Resetting a password invalidates the current one immediately. Account deletion is restricted to owners.'
        }));

        const actions = el('div', { class: 'danger-zone__actions' });

        const resetBtn = el('button', { class: 'btn btn--danger', text: 'Reset password' });
        resetBtn.addEventListener('click', async () => {
            await UI.confirm({
                title: 'Reset this password?',
                body: 'A new temporary password is generated for ' + (dev.email || 'this developer') +
                      ' and their current password stops working right away. The new password is shown once.',
                confirmLabel: 'Reset password',
                danger: true,
                onConfirm: async () => {
                    const result = await AdminAPI.resetDeveloperPassword(dev.id);
                    const temp = result && result.tempPassword;
                    if (temp) {
                        UI.showSecret({
                            title: 'Temporary password',
                            description: 'Send this to ' + (dev.email || 'the developer') +
                                         ' over a secure channel. They must change it on next sign-in.',
                            value: temp,
                            copyLabel: 'Temporary password copied'
                        });
                    } else {
                        UI.toast.success('Password reset.');
                    }
                }
            });
        });
        actions.appendChild(resetBtn);

        if (state.isOwner) {
            const deleteBtn = el('button', { class: 'btn btn--danger', text: 'Delete account' });
            deleteBtn.addEventListener('click', async () => {
                await UI.confirm({
                    title: 'Delete this developer permanently?',
                    body: 'This removes ' + (dev.email || 'the account') + ', its API keys and its ' +
                          UI.fmtNumber(dev.channelCount || 0) + ' channel(s). Clients using their keys ' +
                          'start failing immediately. This cannot be undone.',
                    confirmLabel: 'Delete permanently',
                    danger: true,
                    typeToConfirm: dev.email,
                    reasonRequired: true,
                    onConfirm: async () => {
                        await AdminAPI.deleteDeveloper(dev.id);
                        UI.toast.success('Developer deleted.');
                        close(true);
                        loadDevelopers();
                    }
                });
            });
            actions.appendChild(deleteBtn);
        }

        danger.appendChild(actions);
        frag.appendChild(danger);

        return frag;
    }

    /* ------------------------------------------------------ create developer */

    function openCreateDeveloper() {
        UI.openModal((close) => {
            const form = el('form', { novalidate: true });

            const emailField = el('div', { class: 'field' });
            emailField.appendChild(el('label', { class: 'field__label', for: 'newEmail', text: 'Email' }));
            const emailInput = el('input', {
                class: 'field__input', type: 'email', id: 'newEmail',
                autocomplete: 'off', placeholder: 'developer@example.com', 'data-autofocus': true
            });
            emailField.appendChild(emailInput);
            emailField.appendChild(el('p', { class: 'field__error', id: 'newEmailError' }));
            form.appendChild(emailField);

            const nameField = el('div', { class: 'field' });
            nameField.appendChild(el('label', { class: 'field__label', for: 'newName', text: 'Name (optional)' }));
            const nameInput = el('input', { class: 'field__input', type: 'text', id: 'newName', autocomplete: 'off' });
            nameField.appendChild(nameInput);
            form.appendChild(nameField);

            const planField = el('div', { class: 'field' });
            planField.appendChild(el('label', { class: 'field__label', for: 'newPlan', text: 'Plan' }));
            const planSelect = el('select', { class: 'field__select', id: 'newPlan' });
            state.plans.forEach((plan) => {
                const option = el('option', { value: String(plan.id), text: plan.name + (plan.isDefault ? ' (default)' : '') });
                if (plan.isDefault) option.selected = true;
                planSelect.appendChild(option);
            });
            planField.appendChild(planSelect);
            form.appendChild(planField);

            const emailToggle = el('label', {
                class: 'field__hint',
                style: 'display:flex;gap:.5rem;align-items:center;cursor:pointer'
            });
            const sendEmail = el('input', { type: 'checkbox', id: 'sendEmail' });
            sendEmail.checked = true;
            emailToggle.appendChild(sendEmail);
            emailToggle.appendChild(document.createTextNode('Email the credentials to this address'));
            form.appendChild(emailToggle);

            const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: () => close(null) });
            const submit = el('button', { class: 'btn btn--primary', type: 'submit', text: 'Create developer' });

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const field = emailInput.closest('.field');
                if (!emailInput.value.trim() || !emailInput.checkValidity()) {
                    field.dataset.state = 'invalid';
                    document.getElementById('newEmailError').textContent = 'Enter a valid email address.';
                    emailInput.focus();
                    return;
                }
                delete field.dataset.state;

                await UI.withBusy(submit, async () => {
                    try {
                        const result = await AdminAPI.createDeveloper({
                            email: emailInput.value.trim(),
                            name: nameInput.value.trim() || null,
                            planId: parseInt(planSelect.value, 10),
                            sendEmail: sendEmail.checked
                        });
                        close(true);
                        const secret = result && (result.apiKey || result.tempPassword);
                        if (secret) {
                            UI.showSecret({
                                title: 'Credentials for ' + emailInput.value.trim(),
                                description: 'Shown once. Share them over a secure channel.',
                                value: secret,
                                meta: result.tempPassword && result.apiKey ? 'Temporary password: ' + result.tempPassword : null
                            });
                        } else {
                            UI.toast.success('Developer created.');
                        }
                        loadDevelopers();
                    } catch (err) {
                        UI.toast.error(err.message || 'Could not create the developer.');
                    }
                });
            });

            const card = UI.modalCard({
                title: 'Create a developer account',
                body: form,
                actions: [cancel, submit]
            }, close);

            // The action bar lives outside the form element, so wire it up.
            submit.addEventListener('click', (e) => { e.preventDefault(); form.requestSubmit(); });
            return card;
        });
    }

    /* ----------------------------------------------------------------- plans */

    async function loadPlans() {
        const grid = document.getElementById('plansGrid');
        if (!grid.children.length) {
            for (let i = 0; i < 3; i++) {
                const card = el('div', { class: 'plan-card' });
                card.appendChild(el('span', { class: 'skeleton', style: 'width:40%' }));
                grid.appendChild(card);
            }
        }

        try {
            const plans = await AdminAPI.getPlans();
            state.plans = Array.isArray(plans) ? plans : [];
            grid.innerHTML = '';

            if (!state.plans.length) {
                grid.appendChild(el('p', { class: 'field__hint', text: 'No plans are configured on the server.' }));
                return;
            }

            state.plans.forEach((plan) => {
                const card = el('div', { class: 'plan-card' + (plan.isDefault ? ' plan-card--default' : '') });
                const head = el('div', { class: 'plan-card__head' });
                head.appendChild(el('h3', { text: plan.name }));
                if (plan.isDefault) head.appendChild(el('span', { class: 'badge badge--warning', text: 'Default' }));
                card.appendChild(head);

                card.appendChild(el('p', { class: 'plan-card__desc', text: plan.description || 'No description.' }));

                const stats = el('div', { class: 'plan-stats' });
                [['Channel units', plan.channelUnits], ['Bandwidth / min', plan.bandwidthPerMinute]]
                    .forEach((pair) => {
                        const stat = el('div', { class: 'plan-stat' });
                        stat.appendChild(el('strong', { text: UI.fmtNumber(pair[1]) }));
                        stat.appendChild(el('span', { text: pair[0] }));
                        stats.appendChild(stat);
                    });
                card.appendChild(stats);

                const caps = el('div', { class: 'plan-caps' });
                (plan.capabilities || []).forEach((cap) => {
                    caps.appendChild(el('span', { class: 'badge badge--brand', text: String(cap) }));
                });
                card.appendChild(caps);
                grid.appendChild(card);
            });
        } catch (err) {
            grid.innerHTML = '';
            grid.appendChild(errorAlert(err.message || 'Could not load plans.', loadPlans));
        }
    }


    /* ------------------------------------------------------------------ audit */

    const AUDIT_COLUMNS = 4;

    // Entries arrive as "[ISO] ADMIN:<id> ACTION:<NAME> - <details>".
    const AUDIT_PATTERN = /^\[([^\]]+)\]\s+ADMIN:(\S+)\s+ACTION:(\S+)\s+-\s*([\s\S]*)$/;

    function parseAuditEntry(line) {
        const match = AUDIT_PATTERN.exec(String(line || ''));
        if (!match) return { when: null, admin: '—', action: '—', details: String(line || '') };
        return { when: match[1], admin: match[2], action: match[3], details: match[4] };
    }

    // Destructive actions read red, privileged ones amber, everything else plain.
    const DESTRUCTIVE = ['DELETE', 'REVOKE', 'REJECT', 'REMOVE'];
    const PRIVILEGED = ['CREATE', 'UPDATE', 'RESET', 'APPROVE', 'ROLES', 'PLAN'];

    function actionBadge(action) {
        const upper = String(action || '').toUpperCase();
        let cls = '';
        if (DESTRUCTIVE.some((w) => upper.includes(w))) cls = 'badge--danger';
        else if (PRIVILEGED.some((w) => upper.includes(w))) cls = 'badge--warning';
        return el('span', { class: 'badge ' + cls, text: action || '—' });
    }

    async function loadAudit() {
        const tbody = document.getElementById('auditBody');
        UI.tableLoading(tbody, AUDIT_COLUMNS, 8);

        const limit = parseInt(document.getElementById('auditLimit').value, 10) || 100;
        try {
            const data = await AdminAPI.getAuditLog(limit);
            const entries = (data && (data.entries || data)) || [];
            state.auditRows = (Array.isArray(entries) ? entries : []).map(parseAuditEntry);
            renderAudit();
        } catch (err) {
            state.auditRows = [];
            if (err.status === 404) {
                // The console can ship ahead of the messaging service; say so
                // plainly rather than implying the log itself is broken.
                UI.tableEmpty(tbody, AUDIT_COLUMNS, {
                    icon: 'info',
                    title: 'Audit endpoint not available on this server',
                    body: 'Actions are still being recorded server-side. Reading them needs a messaging-service build that includes GET /admin/audit.'
                });
            } else {
                UI.tableError(tbody, AUDIT_COLUMNS, { body: err.message, onAction: loadAudit });
            }
            document.getElementById('auditCount').textContent = '';
        }
    }

    function renderAudit() {
        const tbody = document.getElementById('auditBody');
        const filter = document.getElementById('auditFilter').value.trim().toLowerCase();
        const rows = filter
            ? state.auditRows.filter((r) =>
                (r.action + ' ' + r.admin + ' ' + r.details).toLowerCase().includes(filter))
            : state.auditRows;

        tbody.removeAttribute('aria-busy');
        tbody.innerHTML = '';

        if (!rows.length) {
            UI.tableEmpty(tbody, AUDIT_COLUMNS, {
                icon: filter ? 'search' : 'list',
                title: filter ? 'No entries match this filter' : 'No audit entries recorded yet',
                body: filter ? null : 'Entries appear here as soon as an administrator changes something.',
                actionLabel: filter ? 'Clear filter' : null,
                onAction: filter ? () => { document.getElementById('auditFilter').value = ''; renderAudit(); } : null
            });
            document.getElementById('auditCount').textContent = '';
            return;
        }

        rows.forEach((entry) => {
            const tr = el('tr');

            const when = el('td', { class: 'mono-cell', text: entry.when ? UI.fmtDate(entry.when) : '—' });
            if (entry.when) when.title = entry.when;
            tr.appendChild(when);

            tr.appendChild(el('td', { class: 'mono-cell', text: entry.admin }));

            const actionCell = el('td');
            actionCell.appendChild(actionBadge(entry.action));
            tr.appendChild(actionCell);

            tr.appendChild(el('td', { text: entry.details || '—' }));
            tbody.appendChild(tr);
        });

        document.getElementById('auditCount').textContent =
            'Showing ' + rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') +
            (filter ? ' matching "' + filter + '"' : '');
    }

    /* ---------------------------------------------------------------- admins */

    async function loadAdmins() {
        if (!state.isOwner) return;
        const tbody = document.getElementById('adminsBody');
        UI.tableLoading(tbody, 4);

        try {
            const admins = await AdminAPI.listAdmins();
            const rows = Array.isArray(admins) ? admins : (admins && admins.admins) || [];
            tbody.removeAttribute('aria-busy');
            tbody.innerHTML = '';

            if (!rows.length) {
                UI.tableEmpty(tbody, 4, { icon: 'shield', title: 'No administrator accounts found' });
                return;
            }

            rows.forEach((admin) => {
                const tr = el('tr');
                tr.appendChild(el('td', { class: 'email-cell', text: admin.email || '—' }));
                tr.appendChild(el('td', { text: admin.name || '—' }));
                const rolesCell = el('td');
                String(admin.roles || 'admin').split(',').map((r) => r.trim()).filter(Boolean).forEach((role) => {
                    rolesCell.appendChild(el('span', {
                        class: 'badge ' + (role === 'owner' ? 'badge--warning' : ''),
                        text: role,
                        style: 'margin-right:4px'
                    }));
                });
                tr.appendChild(rolesCell);
                tr.appendChild(el('td', { text: UI.fmtDate(admin.createdAt, 'date') }));
                tbody.appendChild(tr);
            });
        } catch (err) {
            UI.tableError(tbody, 4, { body: err.message, onAction: loadAdmins });
        }
    }

    /* --------------------------------------------------------------- wiring */

    function initControls() {
        document.getElementById('requestStatus').addEventListener('change', () => {
            state.requestPage = 0;
            loadRequests();
        });
        document.getElementById('requestRefresh').addEventListener('click', loadRequests);
        document.getElementById('requestPrev').addEventListener('click', () => {
            if (state.requestPage > 0) { state.requestPage--; loadRequests(); }
        });
        document.getElementById('requestNext').addEventListener('click', () => {
            if (state.requestPage < state.requestTotalPages - 1) { state.requestPage++; loadRequests(); }
        });

        let debounce;
        document.getElementById('developerFilter').addEventListener('input', (e) => {
            clearTimeout(debounce);
            const value = e.target.value.trim();
            debounce = setTimeout(() => {
                if (value === state.developerQuery) return;
                state.developerQuery = value;
                state.developerPage = 0;
                loadDevelopers();
            }, 300);
        });
        document.getElementById('developerPageSize').addEventListener('change', (e) => {
            state.developerPageSize = parseInt(e.target.value, 10) || 20;
            state.developerPage = 0;
            loadDevelopers();
        });
        document.getElementById('developerRefresh').addEventListener('click', loadDevelopers);
        document.getElementById('developerPrev').addEventListener('click', () => {
            if (state.developerPage > 0) { state.developerPage--; loadDevelopers(); }
        });
        document.getElementById('developerNext').addEventListener('click', () => {
            if (state.developerPage < state.developerTotalPages - 1) { state.developerPage++; loadDevelopers(); }
        });
        document.getElementById('createDeveloperBtn').addEventListener('click', openCreateDeveloper);

        let auditDebounce;
        document.getElementById('auditFilter').addEventListener('input', () => {
            clearTimeout(auditDebounce);
            auditDebounce = setTimeout(renderAudit, 200);
        });
        document.getElementById('auditLimit').addEventListener('change', loadAudit);
        document.getElementById('auditRefresh').addEventListener('click', loadAudit);

        // Sortable columns — the backend already accepts sort and dir.
        document.querySelectorAll('#section-developers th[data-sort]').forEach((th) => {
            th.querySelector('.table__sort').addEventListener('click', () => {
                const key = th.dataset.sort;
                if (state.developerSort === key) {
                    state.developerDir = state.developerDir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.developerSort = key;
                    state.developerDir = 'asc';
                }
                document.querySelectorAll('#section-developers th[data-sort]')
                    .forEach((other) => other.removeAttribute('aria-sort'));
                th.setAttribute('aria-sort', state.developerDir === 'asc' ? 'ascending' : 'descending');
                state.developerPage = 0;
                loadDevelopers();
            });
        });

        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await AdminAPI.logout();
            window.location.replace('index.html');
        });
    }

    /* ------------------------------------------------------------------ boot */

    document.addEventListener('DOMContentLoaded', async function () {
        if (!AdminAPI.isLoggedIn()) { window.location.replace('index.html'); return; }

        UI.initShell();
        initChrome();
        initControls();

        await resolveOwner();

        window.addEventListener('hashchange', route);
        route();

        // Keep the pending count fresh without hammering the service.
        refreshPendingBadge();
        setInterval(refreshPendingBadge, 60000);
    });
})();
