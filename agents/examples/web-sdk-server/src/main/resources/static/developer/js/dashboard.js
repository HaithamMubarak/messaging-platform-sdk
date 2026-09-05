/**
 * Developer Portal dashboard.
 *
 * Every row is built with DOM APIs and textContent — no server or user data is
 * ever interpolated into HTML or into an inline event handler.
 */
(function () {
    'use strict';

    const el = UI.el;

    const SECTIONS = {
        overview: { title: 'Overview', load: loadOverview },
        keys:     { title: 'API keys', load: loadApiKeys },
        channels: { title: 'Channels', load: loadChannels },
        tools:    { title: 'Tools',    load: null },
        usage:    { title: 'Usage & quota', load: loadUsage },
        settings: { title: 'Settings', load: null }
    };

    const state = {
        section: 'overview',
        channelPage: 0,
        channelPageSize: 10,
        channelTotalPages: 1,
        channelRows: [],
        channelSort: 'createdAt',
        channelDir: 'desc',
        channelSelection: new Set(),
        storageLimitMB: null,
        keyRefreshTokens: new Map()
    };

    /* --------------------------------------------------------------- routing */

    function currentSection() {
        const name = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
        return SECTIONS[name] ? name : 'overview';
    }

    function route() {
        const name = currentSection();
        state.section = name;

        Object.keys(SECTIONS).forEach((key) => {
            document.getElementById('section-' + key).hidden = key !== name;
        });
        document.querySelectorAll('.nav-item').forEach((item) => {
            if (item.dataset.section === name) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });

        document.getElementById('pageTitle').textContent = SECTIONS[name].title;
        document.title = SECTIONS[name].title + ' — Developer Portal';
        if (SECTIONS[name].load) SECTIONS[name].load();
    }

    /* --------------------------------------------------------------- profile */

    function initProfile() {
        const profile = DeveloperAPI.getProfile();
        if (!profile) return;

        document.getElementById('developerEmail').textContent = profile.email || '—';
        document.getElementById('planBadge').textContent = profile.plan || 'Free';
        document.getElementById('planBadgeText').textContent = profile.plan || 'Free';
        document.getElementById('settingsEmail').value = profile.email || '';
        document.getElementById('settingsName').value = profile.name || '';

        const env = ApiConfig.environment();
        if (env !== 'production') {
            const badge = document.getElementById('envBadge');
            badge.textContent = env === 'local' ? 'Local API' : 'Custom API';
            badge.className = 'badge badge--warning';
            badge.hidden = false;
        }

        if (profile.passwordChangeRequired) showPasswordNotice();
    }

    function showPasswordNotice() {
        const host = document.getElementById('passwordNotice');
        if (host.firstChild) return;

        const alert = el('div', { class: 'alert alert--warning', style: 'margin-bottom:var(--sp-6)' });
        alert.appendChild(UI.iconNode('alert-triangle'));
        const body = el('div', { style: 'flex:1' });
        body.appendChild(el('strong', { text: 'You are still using a temporary password. ' }));
        body.appendChild(document.createTextNode('Set your own before sharing this account. '));
        body.appendChild(el('a', { href: '#/settings', text: 'Change password' }));
        alert.appendChild(body);
        host.appendChild(alert);
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
            const stats = await DeveloperAPI.getStats();
            setStat('channelCount', UI.fmtNumber(stats.channelCount));
            setStat('apiKeyCount', UI.fmtNumber(stats.apiKeyCount));
            setStat('apiCallsToday', UI.fmtNumber(stats.apiCallsToday));
            setStat('quotaUsedPercent',
                stats.quotaUsedPercent === null || stats.quotaUsedPercent === undefined
                    ? '—' : Math.round(stats.quotaUsedPercent) + '%');
            setStat('storageMB', UI.fmtMB(stats.storageMB));
            setStat('plan', stats.plan || 'Free');
        } catch (err) {
            document.querySelectorAll('#statsGrid .stat-card').forEach((c) => {
                c.dataset.state = 'error';
                c.querySelector('.stat-card__value').textContent = '—';
            });
            const alert = el('div', { class: 'alert alert--danger', role: 'alert' });
            alert.appendChild(UI.iconNode('alert-circle'));
            const body = el('div', { style: 'flex:1' });
            body.appendChild(el('p', { text: err.message || 'Could not load your account statistics.' }));
            alert.appendChild(body);
            alert.appendChild(el('button', { class: 'btn btn--sm btn--ghost', text: 'Retry', onclick: loadOverview }));
            errorHost.appendChild(alert);
        }

        loadRecentChannels();
    }

    async function loadRecentChannels() {
        const host = document.getElementById('recentChannels');
        host.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const row = el('div', { class: 'recent-item' });
            row.appendChild(el('span', { class: 'skeleton', style: 'width:40%' }));
            host.appendChild(row);
        }

        try {
            const data = await DeveloperAPI.getChannels(0, 5);
            const channels = (data && data.channels) || [];
            host.innerHTML = '';

            if (!channels.length) {
                host.appendChild(el('p', {
                    class: 'field__hint',
                    text: 'No channels yet. One is created the first time an agent connects with your key.'
                }));
                return;
            }

            channels.forEach((ch) => {
                const item = el('div', { class: 'recent-item' });
                item.appendChild(UI.iconNode('channel'));
                const info = el('div', { style: 'min-width:0' });
                info.appendChild(el('strong', { text: ch.name || ch.channelId || 'Unnamed channel' }));
                info.appendChild(el('span', { class: 'meta', text: 'Created ' + UI.fmtRelative(ch.createdAt) }));
                item.appendChild(info);
                host.appendChild(item);
            });
        } catch (err) {
            host.innerHTML = '';
            const alert = el('div', { class: 'alert alert--danger', role: 'alert' });
            alert.appendChild(UI.iconNode('alert-circle'));
            alert.appendChild(el('p', { style: 'flex:1', text: err.message || 'Could not load recent channels.' }));
            alert.appendChild(el('button', { class: 'btn btn--sm btn--ghost', text: 'Retry', onclick: loadRecentChannels }));
            host.appendChild(alert);
        }
    }

    /* -------------------------------------------------------------- API keys */

    const KEY_COLUMNS = 8;

    function maskKeyId(keyId) {
        const id = String(keyId || '');
        return id.length > 8 ? '••••' + id.slice(-8) : id;
    }

    /**
     * Show the key for the signed-in account.
     *
     * It arrives with the sign-in response and already sits in sessionStorage,
     * but the console never surfaced it: the table shows key IDs only, so the
     * one way to obtain a usable key was "Revoke and rotate" — which breaks
     * every client already using the old one. Masked by default; revealing is
     * a deliberate click.
     */
    function renderActiveKey() {
        const panel = document.getElementById('activeKeyPanel');
        const code = document.getElementById('activeKeyValue');
        const revealBtn = document.getElementById('activeKeyReveal');
        const copyBtn = document.getElementById('activeKeyCopy');
        const verifyLink = document.getElementById('activeKeyVerify');
        if (!panel || !code || !revealBtn || !copyBtn) return;

        const key = DeveloperAPI.getApiKey();
        if (!key) {
            // An older session predates the key being stored; the table still works.
            panel.hidden = true;
            return;
        }
        panel.hidden = false;

        const mask = () => '•'.repeat(Math.min(48, key.length));
        code.textContent = mask();
        code.dataset.masked = 'true';

        if (!revealBtn.dataset.bound) {
            revealBtn.dataset.bound = 'true';
            revealBtn.addEventListener('click', () => {
                const masked = code.dataset.masked === 'true';
                code.dataset.masked = masked ? 'false' : 'true';
                code.textContent = masked ? key : mask();
                revealBtn.setAttribute('aria-pressed', masked ? 'true' : 'false');
                revealBtn.setAttribute('aria-label', masked ? 'Hide API key' : 'Reveal API key');
                revealBtn.innerHTML = '';
                revealBtn.appendChild(UI.iconNode(masked ? 'eye-off' : 'eye', 'icon--sm'));
            });
        }

        if (!copyBtn.dataset.bound) {
            copyBtn.dataset.bound = 'true';
            copyBtn.addEventListener('click', () => UI.copy(key, 'API key copied.'));
        }

        // Hand the key to the verifier rather than asking the developer to paste
        // one they had no way of reading.
        if (verifyLink) {
            try {
                sessionStorage.setItem('verify_api_key', key);
            } catch (e) { /* private mode: the verifier still accepts a paste */ }
        }
    }

    async function loadApiKeys() {
        renderActiveKey();

        const tbody = document.getElementById('apiKeysBody');
        UI.tableLoading(tbody, KEY_COLUMNS);

        let keys;
        try {
            keys = await DeveloperAPI.getApiKeys();
        } catch (err) {
            UI.tableError(tbody, KEY_COLUMNS, { body: err.message, onAction: loadApiKeys });
            return;
        }

        if (!Array.isArray(keys) || !keys.length) {
            UI.tableEmpty(tbody, KEY_COLUMNS, {
                icon: 'key',
                title: 'No API keys on this account',
                body: 'Contact an administrator if you expected a key here.'
            });
            return;
        }

        tbody.removeAttribute('aria-busy');
        tbody.dataset.state = 'ready';
        tbody.innerHTML = '';

        keys.forEach((key) => {
            const tr = el('tr');

            const idCell = el('td');
            idCell.appendChild(el('code', { class: 'key-chip', text: maskKeyId(key.keyId) }));
            tr.appendChild(idCell);

            tr.appendChild(el('td', { text: key.name || 'Default' }));

            const planCell = el('td');
            planCell.appendChild(el('span', { class: 'badge', text: key.plan || 'Free' }));
            tr.appendChild(planCell);

            tr.appendChild(el('td', { text: UI.fmtDate(key.createdAt, 'date') }));
            tr.appendChild(el('td', { text: key.lastUsed ? UI.fmtRelative(key.lastUsed) : 'Never' }));

            const callsCell = el('td', { class: 'cell-num' });
            callsCell.appendChild(el('span', { class: 'skeleton', style: 'width:2.5rem;display:inline-block' }));
            tr.appendChild(callsCell);

            const statusCell = el('td');
            statusCell.appendChild(el('span', {
                class: 'badge ' + (key.active ? 'badge--success' : 'badge--danger'),
                text: key.active ? 'Active' : 'Revoked'
            }));
            tr.appendChild(statusCell);

            const actions = el('td');
            const group = el('div', { class: 'cell-actions' });

            const copyBtn = el('button', {
                class: 'btn btn--icon btn--ghost',
                title: 'Copy key ID',
                'aria-label': 'Copy key ID for ' + (key.name || 'this key'),
                onclick: () => UI.copy(key.keyId, 'Key ID copied')
            });
            copyBtn.appendChild(UI.iconNode('copy', 'icon--sm'));
            group.appendChild(copyBtn);

            if (key.active) {
                const revokeBtn = el('button', {
                    class: 'btn btn--icon btn--danger',
                    title: 'Revoke and rotate',
                    'aria-label': 'Revoke and rotate ' + (key.name || 'this key'),
                    onclick: () => revokeKey(key)
                });
                revokeBtn.appendChild(UI.iconNode('ban', 'icon--sm'));
                group.appendChild(revokeBtn);
            }

            actions.appendChild(group);
            tr.appendChild(actions);
            tbody.appendChild(tr);

            if (key.active) loadKeyUsage(key.keyId, callsCell);
            else callsCell.textContent = '—';
        });
    }

    async function loadKeyUsage(keyId, cell) {
        try {
            const usage = await DeveloperAPI.getApiKeyUsage(keyId);
            if (cell.isConnected) cell.textContent = UI.fmtNumber(usage.callsToday || 0);
        } catch (e) {
            if (cell.isConnected) cell.textContent = '—';
        }
    }

    async function revokeKey(key) {
        await UI.confirm({
            title: 'Revoke and rotate this key?',
            body: 'The current key stops working immediately and a replacement is generated. ' +
                  'Any client still using the old key will start failing with 401 responses. ' +
                  'The new secret is shown once and cannot be retrieved later.',
            confirmLabel: 'Revoke and rotate',
            danger: true,
            typeToConfirm: key.keyId,
            onConfirm: async () => {
                const response = await DeveloperAPI.revokeApiKey(key.keyId);
                const newSecret = response && (response.fullKey || response.apiKey);

                if (newSecret) {
                    const profile = DeveloperAPI.getProfile();
                    if (profile) {
                        profile.apiKey = newSecret;
                        DeveloperAPI.setProfile(profile);
                    }
                    UI.showSecret({
                        title: 'Your new API key',
                        value: newSecret,
                        meta: response.newKeyId ? 'Key ID: ' + response.newKeyId : null,
                        copyLabel: 'API key copied'
                    });
                } else {
                    UI.toast.success('Key revoked and rotated.');
                }
                loadApiKeys();
            }
        });
    }

    function initTempKeyForm() {
        const form = document.getElementById('tempKeyForm');
        const button = document.getElementById('tempKeyBtn');

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const ttl = parseInt(document.getElementById('tempKeyTtl').value, 10) || 15;
            const singleUse = document.getElementById('tempKeySingleUse').value === 'true';

            await UI.withBusy(button, async () => {
                try {
                    const response = await DeveloperAPI.createTemporaryKey(ttl, singleUse);
                    const data = (response && response.data) || response;
                    if (!data || !data.temporaryKey) throw new Error('The service did not return a temporary key.');

                    UI.showSecret({
                        title: 'Temporary API key',
                        description: 'Hand this to a client instead of your long-lived key. It expires on its own.',
                        value: data.temporaryKey,
                        meta: 'TTL ' + (data.ttlSeconds || ttl) + 's · ' +
                              (data.singleUse ? 'single use' : 'multi-use') +
                              (data.expiresAt ? ' · expires ' + UI.fmtDate(data.expiresAt) : ''),
                        ackLabel: 'I have copied this key',
                        copyLabel: 'Temporary key copied'
                    });
                } catch (err) {
                    UI.toast.error(err.message || 'Could not create a temporary key.');
                }
            });
        });
    }

    /* -------------------------------------------------------------- channels */

    const CHANNEL_COLUMNS = 8;

    /**
     * The storage limit comes from /usage; channel rows only carry raw bytes.
     * Fetched once and cached so the quota column can show a real share.
     */
    async function ensureStorageLimit() {
        if (state.storageLimitMB !== null) return;
        try {
            const usage = await DeveloperAPI.getUsage();
            const limit = Number(usage && usage.storageLimitMB);
            state.storageLimitMB = Number.isFinite(limit) && limit > 0 ? limit : 0;
        } catch (e) {
            state.storageLimitMB = 0;   // 0 means "unknown", never render a fake %
        }
    }

    async function loadChannels() {
        const tbody = document.getElementById('channelsBody');
        UI.tableLoading(tbody, CHANNEL_COLUMNS);
        ensureStorageLimit();

        try {
            const data = await DeveloperAPI.getChannels(state.channelPage, state.channelPageSize);
            state.channelRows = (data && data.channels) || [];
            state.channelTotalPages = Math.max(1, (data && data.totalPages) || 1);
            // Selections do not survive a page change — they would silently
            // point at rows the user can no longer see.
            state.channelSelection.clear();
            renderChannels();
        } catch (err) {
            state.channelRows = [];
            state.channelSelection.clear();
            UI.tableError(tbody, CHANNEL_COLUMNS, { body: err.message, onAction: loadChannels });
            updateChannelPager(0);
            updateChannelSelectionUI();
        }
    }

    /** Sort comparator for the loaded page. Strings compare case-insensitively. */
    function sortChannelRows(rows) {
        const key = state.channelSort;
        const dir = state.channelDir === 'asc' ? 1 : -1;
        return rows.slice().sort((a, b) => {
            let av, bv;
            if (key === 'quota' || key === 'storageUsed') {
                av = Number(a.storageUsed) || 0;
                bv = Number(b.storageUsed) || 0;
            } else if (key === 'messageCount') {
                av = Number(a.messageCount) || 0;
                bv = Number(b.messageCount) || 0;
            } else if (key === 'createdAt') {
                av = new Date(a.createdAt || 0).getTime() || 0;
                bv = new Date(b.createdAt || 0).getTime() || 0;
            } else {
                av = String(a[key] || '').toLowerCase();
                bv = String(b[key] || '').toLowerCase();
            }
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
        });
    }

    /** Storage share of the account quota, or null when the limit is unknown. */
    function quotaShare(channel) {
        const limitBytes = (state.storageLimitMB || 0) * 1024 * 1024;
        if (!limitBytes) return null;
        const used = Number(channel.storageUsed) || 0;
        return Math.min(100, (used / limitBytes) * 100);
    }

    function quotaCell(channel) {
        const td = el('td');
        const wrap = el('div', { class: 'quota-cell' });
        const share = quotaShare(channel);

        if (share === null) {
            wrap.appendChild(el('span', { class: 'quota-value', text: '1 unit · storage limit unknown' }));
            td.appendChild(wrap);
            return td;
        }

        const meter = el('div', {
            class: 'meter', role: 'progressbar',
            'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(share)),
            'aria-label': 'Share of storage quota used by this channel',
            style: 'flex:1'
        });
        meter.dataset.level = share >= 90 ? 'danger' : share >= 75 ? 'warning' : 'ok';
        const track = el('div', { class: 'meter__track' });
        const fill = el('div', { class: 'meter__fill' });
        fill.style.width = share + '%';
        track.appendChild(fill);
        meter.appendChild(track);
        wrap.appendChild(meter);

        const label = share > 0 && share < 0.1 ? '<0.1%' : share.toFixed(1) + '%';
        const value = el('span', { class: 'quota-value', text: label + ' · 1 unit' });
        value.title = UI.fmtBytes(channel.storageUsed) + ' of a ' + UI.fmtMB(state.storageLimitMB) +
                      ' storage quota, plus the one channel unit this channel occupies.';
        wrap.appendChild(value);

        td.appendChild(wrap);
        return td;
    }

    function renderChannels() {
        const tbody = document.getElementById('channelsBody');
        const filter = document.getElementById('channelFilter').value.trim().toLowerCase();
        const matched = filter
            ? state.channelRows.filter((ch) =>
                String(ch.channelId || '').toLowerCase().includes(filter) ||
                String(ch.name || '').toLowerCase().includes(filter))
            : state.channelRows;
        const rows = sortChannelRows(matched);

        tbody.removeAttribute('aria-busy');
        tbody.innerHTML = '';

        if (!rows.length) {
            if (filter) {
                UI.tableEmpty(tbody, CHANNEL_COLUMNS, {
                    icon: 'search',
                    title: 'No channels match this filter',
                    body: 'The filter only looks at the channels loaded on this page.',
                    actionLabel: 'Clear filter',
                    onAction: () => { document.getElementById('channelFilter').value = ''; renderChannels(); }
                });
            } else {
                UI.tableEmpty(tbody, CHANNEL_COLUMNS, {
                    icon: 'channel',
                    title: 'No channels yet',
                    body: 'A channel is created the first time an agent connects with your API key.'
                });
            }
            updateChannelPager(0);
            updateChannelSelectionUI();
            return;
        }

        rows.forEach((ch) => {
            const tr = el('tr');
            const id = ch.channelId;
            const selected = state.channelSelection.has(id);
            if (selected) tr.dataset.selected = 'true';

            const checkCell = el('td', { class: 'cell-check' });
            const checkbox = el('input', {
                type: 'checkbox',
                'aria-label': 'Select channel ' + (id || '')
            });
            checkbox.checked = selected;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) state.channelSelection.add(id);
                else state.channelSelection.delete(id);
                tr.dataset.selected = checkbox.checked ? 'true' : 'false';
                updateChannelSelectionUI();
            });
            checkCell.appendChild(checkbox);
            tr.appendChild(checkCell);

            const idCell = el('td');
            idCell.appendChild(el('code', { class: 'key-chip', text: id || '—' }));
            tr.appendChild(idCell);

            tr.appendChild(el('td', { text: ch.name || '—' }));
            tr.appendChild(el('td', { text: UI.fmtDate(ch.createdAt, 'date') }));
            tr.appendChild(el('td', { class: 'cell-num', text: UI.fmtNumber(ch.messageCount || 0) }));
            tr.appendChild(el('td', { class: 'cell-num', text: UI.fmtBytes(ch.storageUsed) }));
            tr.appendChild(quotaCell(ch));

            const actions = el('td');
            const group = el('div', { class: 'cell-actions' });

            const metricsBtn = el('button', {
                class: 'btn btn--sm btn--ghost',
                onclick: () => showChannelMetrics(id)
            });
            metricsBtn.appendChild(UI.iconNode('bar-chart', 'icon--sm'));
            metricsBtn.appendChild(document.createTextNode('Metrics'));
            group.appendChild(metricsBtn);

            const deleteBtn = el('button', {
                class: 'btn btn--icon btn--danger',
                title: 'Delete channel',
                'aria-label': 'Delete channel ' + (id || ''),
                onclick: () => deleteChannel(ch)
            });
            deleteBtn.appendChild(UI.iconNode('trash', 'icon--sm'));
            group.appendChild(deleteBtn);

            actions.appendChild(group);
            tr.appendChild(actions);
            tbody.appendChild(tr);
        });

        updateChannelPager(rows.length);
        updateChannelSelectionUI();
    }

    /* ------------------------------------------------- channel bulk actions */

    /** Channel IDs currently visible after filtering — what "select all" covers. */
    function visibleChannelIds() {
        const filter = document.getElementById('channelFilter').value.trim().toLowerCase();
        return state.channelRows
            .filter((ch) => !filter ||
                String(ch.channelId || '').toLowerCase().includes(filter) ||
                String(ch.name || '').toLowerCase().includes(filter))
            .map((ch) => ch.channelId);
    }

    function updateChannelSelectionUI() {
        const visible = visibleChannelIds();
        const selected = visible.filter((id) => state.channelSelection.has(id));
        const bar = document.getElementById('channelBulkBar');
        const selectAll = document.getElementById('channelSelectAll');

        bar.hidden = selected.length === 0;
        document.getElementById('channelSelectedCount').textContent =
            selected.length + ' channel' + (selected.length === 1 ? '' : 's') + ' selected';

        selectAll.checked = visible.length > 0 && selected.length === visible.length;
        selectAll.indeterminate = selected.length > 0 && selected.length < visible.length;
        selectAll.disabled = visible.length === 0;
    }

    /**
     * Bulk delete behind two separate confirmations: the first states the blast
     * radius and needs the count typed, the second is a plain last check. Two
     * dialogs is deliberate — this is unrecoverable and hits many channels.
     */
    async function deleteSelectedChannels() {
        const ids = visibleChannelIds().filter((id) => state.channelSelection.has(id));
        if (!ids.length) return;

        const preview = ids.slice(0, 8).join(', ') + (ids.length > 8 ? ` and ${ids.length - 8} more` : '');
        const totalBytes = state.channelRows
            .filter((ch) => ids.includes(ch.channelId))
            .reduce((sum, ch) => sum + (Number(ch.storageUsed) || 0), 0);

        const first = await UI.confirm({
            title: 'Delete ' + ids.length + ' channel' + (ids.length === 1 ? '' : 's') + '?',
            body: 'This permanently deletes ' + preview + ', along with their stored messages and ' +
                  UI.fmtBytes(totalBytes) + ' of channel storage. Connected agents are disconnected. ' +
                  'This cannot be undone.',
            confirmLabel: 'Continue',
            danger: true,
            typeToConfirm: String(ids.length)
        });
        if (!first) return;

        const second = await UI.confirm({
            title: 'Last check',
            body: 'There is no undo and no backup. Delete ' + ids.length + ' channel' +
                  (ids.length === 1 ? '' : 's') + ' now?',
            confirmLabel: 'Delete permanently',
            cancelLabel: 'Keep them',
            danger: true
        });
        if (!second) return;

        const results = await Promise.allSettled(ids.map((id) => DeveloperAPI.deleteChannel(id)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        const deleted = ids.length - failed;

        if (deleted) UI.toast.success(deleted + ' channel' + (deleted === 1 ? '' : 's') + ' deleted.');
        if (failed) UI.toast.error(failed + ' channel' + (failed === 1 ? '' : 's') + ' could not be deleted.');

        state.channelSelection.clear();
        loadChannels();
    }

    function updateChannelPager(shown) {
        const filtered = document.getElementById('channelFilter').value.trim().length > 0;
        document.getElementById('channelCount').textContent = shown
            ? 'Showing ' + shown + (filtered ? ' matching' : '') + ' channel' + (shown === 1 ? '' : 's')
            : '';
        document.getElementById('channelPageInfo').textContent =
            'Page ' + (state.channelPage + 1) + ' of ' + state.channelTotalPages;
        document.getElementById('channelPrev').disabled = state.channelPage === 0;
        document.getElementById('channelNext').disabled = state.channelPage >= state.channelTotalPages - 1;
    }

    async function showChannelMetrics(channelId) {
        UI.openModal((close) => {
            const body = el('div');
            body.appendChild(el('p', { class: 'field__hint', text: channelId }));
            const grid = el('div', { class: 'metrics-grid', style: 'margin-top:var(--sp-4)' });
            for (let i = 0; i < 8; i++) {
                const item = el('div', { class: 'metric-item' });
                item.appendChild(el('span', { class: 'skeleton', style: 'width:60%' }));
                item.appendChild(el('span', { class: 'skeleton', style: 'width:40%' }));
                grid.appendChild(item);
            }
            body.appendChild(grid);

            DeveloperAPI.getChannelMetrics(channelId).then((m) => {
                grid.innerHTML = '';
                [
                    ['Messages', UI.fmtNumber(m.messageCount || 0)],
                    ['Latest offset', UI.fmtNumber(m.maxOffset || 0)],
                    ['Message data', UI.fmtBytes(m.messageBytes)],
                    ['Channel storage', UI.fmtBytes(m.storageBytes)],
                    ['Storage keys', UI.fmtNumber(m.storageKeys || 0)],
                    ['Total size', UI.fmtBytes(m.totalBytes)],
                    ['Created', UI.fmtDate(m.createdAt)],
                    ['Expires', m.expired ? 'Expired' : UI.fmtDate(m.expiresAt)]
                ].forEach((pair) => {
                    const item = el('div', { class: 'metric-item' });
                    item.appendChild(el('span', { class: 'metric-label', text: pair[0] }));
                    item.appendChild(el('span', { class: 'metric-value', text: pair[1] }));
                    grid.appendChild(item);
                });
            }).catch((err) => {
                grid.innerHTML = '';
                const alert = el('div', { class: 'alert alert--danger', role: 'alert' });
                alert.appendChild(UI.iconNode('alert-circle'));
                alert.appendChild(el('p', { text: err.message || 'Could not load metrics for this channel.' }));
                body.appendChild(alert);
            });

            return UI.modalCard({ title: 'Channel metrics', body: body, wide: true }, close);
        });
    }

    async function deleteChannel(channel) {
        const id = channel.channelId;
        await UI.confirm({
            title: 'Delete this channel?',
            body: 'Deleting "' + id + '" removes its stored messages and channel storage. ' +
                  'Connected agents are disconnected. This cannot be undone.',
            confirmLabel: 'Delete channel',
            danger: true,
            typeToConfirm: id,
            onConfirm: async () => {
                await DeveloperAPI.deleteChannel(id);
                UI.toast.success('Channel deleted.');
                loadChannels();
            }
        });
    }

    function initChannelControls() {
        const filter = document.getElementById('channelFilter');
        let debounce;
        filter.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(renderChannels, 200);
        });

        // Sorting applies to the loaded page; the backend has no sort parameter
        // for developer channels, and pretending otherwise would mislead.
        document.querySelectorAll('#section-channels th[data-sort]').forEach((th) => {
            const button = th.querySelector('.table__sort');
            if (!button) return;
            button.addEventListener('click', () => {
                const key = th.dataset.sort;
                if (state.channelSort === key) {
                    state.channelDir = state.channelDir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.channelSort = key;
                    state.channelDir = key === 'channelId' || key === 'name' ? 'asc' : 'desc';
                }
                document.querySelectorAll('#section-channels th[data-sort]')
                    .forEach((other) => other.removeAttribute('aria-sort'));
                th.setAttribute('aria-sort', state.channelDir === 'asc' ? 'ascending' : 'descending');
                renderChannels();
            });
        });

        document.getElementById('channelSelectAll').addEventListener('change', (e) => {
            const visible = visibleChannelIds();
            if (e.target.checked) visible.forEach((id) => state.channelSelection.add(id));
            else visible.forEach((id) => state.channelSelection.delete(id));
            renderChannels();
        });

        document.getElementById('channelClearSelection').addEventListener('click', () => {
            state.channelSelection.clear();
            renderChannels();
        });

        document.getElementById('channelDeleteSelected').addEventListener('click', deleteSelectedChannels);

        document.getElementById('channelPageSize').addEventListener('change', (e) => {
            state.channelPageSize = parseInt(e.target.value, 10) || 10;
            state.channelPage = 0;
            loadChannels();
        });

        document.getElementById('channelRefresh').addEventListener('click', loadChannels);

        document.getElementById('channelPrev').addEventListener('click', () => {
            if (state.channelPage > 0) { state.channelPage--; loadChannels(); }
        });
        document.getElementById('channelNext').addEventListener('click', () => {
            if (state.channelPage < state.channelTotalPages - 1) { state.channelPage++; loadChannels(); }
        });
    }

    /* ----------------------------------------------------------------- tools */

    function fieldError(inputId, message) {
        const input = document.getElementById(inputId);
        const field = input.closest('.field');
        const err = document.getElementById(inputId + 'Error');
        if (message) {
            field.dataset.state = 'invalid';
            input.setAttribute('aria-invalid', 'true');
            if (err) err.textContent = message;
            input.focus();
            return false;
        }
        delete field.dataset.state;
        input.removeAttribute('aria-invalid');
        if (err) err.textContent = '';
        return true;
    }

    function initTools() {
        // Broadcast
        const broadcastBtn = document.getElementById('broadcastBtn');
        document.getElementById('broadcastForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const message = document.getElementById('broadcastMessage').value.trim();
            const channelId = document.getElementById('broadcastChannel').value.trim();
            if (!message) { fieldError('broadcastMessage', 'Enter the message to broadcast.'); return; }
            fieldError('broadcastMessage', null);

            const confirmed = await UI.confirm({
                title: channelId ? 'Broadcast to this channel?' : 'Broadcast to every channel?',
                body: channelId
                    ? 'Every agent currently connected to "' + channelId + '" receives this message.'
                    : 'Every agent connected to any of your channels receives this message.',
                confirmLabel: 'Send broadcast'
            });
            if (!confirmed) return;

            await UI.withBusy(broadcastBtn, async () => {
                try {
                    await DeveloperAPI.broadcast(message, channelId);
                    document.getElementById('broadcastMessage').value = '';
                    UI.toast.success('Broadcast sent.');
                } catch (err) {
                    UI.toast.error(err.message || 'Broadcast failed.');
                }
            });
        });

        // Message recovery
        const recoverBtn = document.getElementById('recoverBtn');
        document.getElementById('recoverForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const channelId = document.getElementById('recoverChannelId').value.trim();
            if (!channelId) { fieldError('recoverChannelId', 'Enter the channel ID to recover from.'); return; }
            fieldError('recoverChannelId', null);

            const fromOffset = parseInt(document.getElementById('recoverFromOffset').value, 10) || 0;
            const maxMessages = parseInt(document.getElementById('recoverMaxMessages').value, 10) || 20;

            await UI.withBusy(recoverBtn, async () => {
                const host = document.getElementById('recoverResults');
                host.innerHTML = '';
                try {
                    const response = await DeveloperAPI.recoverMessages(channelId, fromOffset, maxMessages);
                    renderRecovered(host, (response && response.data) || response);
                } catch (err) {
                    UI.toast.error(err.message || 'Recovery failed.');
                }
            });
        });

        // Connected agents
        const agentsBtn = document.getElementById('agentsBtn');
        document.getElementById('agentsForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const channelId = document.getElementById('agentsChannelId').value.trim();
            if (!channelId) { fieldError('agentsChannelId', 'Enter a channel ID.'); return; }
            fieldError('agentsChannelId', null);

            await UI.withBusy(agentsBtn, async () => {
                const host = document.getElementById('agentsResults');
                host.innerHTML = '';
                try {
                    const response = await DeveloperAPI.getChannelAgents(channelId);
                    const data = (response && response.data) || response;
                    const agents = Array.isArray(data) ? data : (data && (data.agents || data.connectedAgents)) || [];
                    if (!agents.length) {
                        host.appendChild(el('p', { class: 'field__hint', text: 'No agents are currently connected to this channel.' }));
                        return;
                    }
                    const list = el('div', { class: 'agent-list' });
                    agents.forEach((agent) => {
                        const name = typeof agent === 'string'
                            ? agent
                            : (agent.agentName || agent.name || agent.sessionId || 'unknown');
                        const pill = el('span', { class: 'agent-pill' });
                        pill.appendChild(el('span', { class: 'dot' }));
                        pill.appendChild(document.createTextNode(name));
                        list.appendChild(pill);
                    });
                    host.appendChild(el('p', {
                        class: 'field__hint',
                        style: 'margin-bottom:var(--sp-3)',
                        text: agents.length + ' agent' + (agents.length === 1 ? '' : 's') + ' connected'
                    }));
                    host.appendChild(list);
                } catch (err) {
                    UI.toast.error(err.message || 'Could not list agents.');
                }
            });
        });
    }

    function renderRecovered(host, data) {
        const messages = (data && data.messages) || [];
        if (!messages.length) {
            host.appendChild(el('p', { class: 'field__hint', text: 'No messages found at that offset.' }));
            return;
        }

        host.appendChild(el('p', {
            class: 'field__hint',
            style: 'margin-bottom:var(--sp-3)',
            text: 'Recovered ' + messages.length + ' message' + (messages.length === 1 ? '' : 's') +
                  ' (offset ' + data.fromOffset + ' → ' + data.toOffset + ')'
        }));

        const list = el('div', { class: 'message-list' });
        messages.forEach((msg) => {
            const item = el('div', { class: 'message-item' });
            const meta = el('div', { class: 'meta' });
            [
                'Offset ' + (msg.localOffset != null ? msg.localOffset : '—'),
                'From ' + (msg.from || '—'),
                'To ' + (msg.to || 'all'),
                'Type ' + (msg.type || '—'),
                msg.date ? UI.fmtDate(msg.date) : '—'
            ].forEach((part) => meta.appendChild(el('span', { text: part })));
            item.appendChild(meta);
            item.appendChild(el('div', { class: 'content', text: msg.content == null ? '' : String(msg.content) }));
            list.appendChild(item);
        });
        host.appendChild(list);

        if (data.hasMore) {
            host.appendChild(el('button', {
                class: 'btn btn--ghost',
                style: 'margin-top:var(--sp-4)',
                text: 'Load more from offset ' + (data.toOffset + 1),
                onclick: () => {
                    document.getElementById('recoverFromOffset').value = data.toOffset + 1;
                    document.getElementById('recoverForm').requestSubmit();
                }
            }));
        }
    }

    /* ----------------------------------------------------------------- usage */

    async function loadUsage() {
        const errorHost = document.getElementById('usageError');
        errorHost.innerHTML = '';

        try {
            const usage = await DeveloperAPI.getUsage();

            UI.setMeter(document.getElementById('meterChannelUnits'),
                usage.channelUnitsUsed, usage.channelUnitsLimit, UI.fmtNumber);
            UI.setMeter(document.getElementById('meterApiCalls'),
                usage.apiCallsToday, usage.apiCallsLimit, UI.fmtNumber);
            UI.setMeter(document.getElementById('meterStorage'),
                usage.storageMB, usage.storageLimitMB, UI.fmtMB);

            document.getElementById('currentPlan').textContent = usage.plan || 'Free';

            const features = document.getElementById('planFeatures');
            features.innerHTML = '';
            if (Array.isArray(usage.planFeatures) && usage.planFeatures.length) {
                const list = el('ul', { class: 'features-list' });
                usage.planFeatures.forEach((feature) => {
                    const li = el('li');
                    li.appendChild(UI.iconNode('check', 'icon--sm'));
                    li.appendChild(document.createTextNode(String(feature)));
                    list.appendChild(li);
                });
                features.appendChild(list);
            } else {
                features.appendChild(el('p', { class: 'field__hint', text: 'No plan details published for this plan.' }));
            }

            const series = (usage.apiCallsSeries || []).map((point) => {
                const date = new Date(point.date + 'T00:00:00');
                return {
                    label: isNaN(date.getTime()) ? String(point.date) : date.toLocaleDateString([], { weekday: 'short' }),
                    title: String(point.date),
                    value: point.calls
                };
            });
            UI.renderBarChart(document.getElementById('apiCallsChart'), series, {
                unit: 'calls',
                emptyText: 'No API activity recorded in the last 7 days.'
            });
        } catch (err) {
            const alert = el('div', { class: 'alert alert--danger', role: 'alert' });
            alert.appendChild(UI.iconNode('alert-circle'));
            alert.appendChild(el('p', { style: 'flex:1', text: err.message || 'Could not load usage data.' }));
            alert.appendChild(el('button', { class: 'btn btn--sm btn--ghost', text: 'Retry', onclick: loadUsage }));
            errorHost.appendChild(alert);
        }
    }

    /* -------------------------------------------------------------- settings */

    /* ---------------------------------------------------- platform account */

    /*
     * Link the tenant to the person, and show what the tenant is entitled to
     * once they are linked.
     *
     * Everything here is built with textContent and createElement rather than
     * innerHTML: the label rendered is an email string that came from another
     * service, and this repository has already shipped stored XSS once by
     * interpolating a name into markup.
     */
    function initPlatformLink() {
        const host = document.getElementById('platformLinkState');
        const errorEl = document.getElementById('platformLinkError');
        if (!host) return;

        function fail(message) {
            errorEl.textContent = message || '';
        }

        function line(text, className) {
            const p = document.createElement('p');
            p.className = className || 'panel__desc';
            p.textContent = text;
            return p;
        }

        function button(text, className, onClick) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = className;
            b.textContent = text;
            b.addEventListener('click', onClick);
            return b;
        }

        function usageLines(entitlement) {
            const out = [];
            if (!entitlement) return out;
            if (entitlement.developerEmail) {
                out.push(line('Tenant: ' + entitlement.developerEmail, 'field__hint'));
            }
            const usage = entitlement.usage;
            if (usage && typeof usage === 'object') {
                // The meter's own field names, whatever they are this month.
                Object.keys(usage).forEach(function (key) {
                    const value = usage[key];
                    if (value === null || typeof value === 'object') return;
                    out.push(line(key + ': ' + value, 'field__hint'));
                });
            } else {
                out.push(line('Usage is unavailable right now.', 'field__hint'));
            }
            return out;
        }

        function renderLinked(state) {
            host.textContent = '';
            const label = state.label || 'your Platform account';
            host.appendChild(line('Linked to ' + label + '.'));
            usageLines(state.entitlement).forEach(function (el) { host.appendChild(el); });
            host.appendChild(button('Unlink', 'btn btn--ghost', async function () {
                fail('');
                try {
                    await DeveloperAPI.unlinkPlatform();
                    await load();
                } catch (e) {
                    fail(e.message);
                }
            }));
        }

        function renderUnlinked() {
            host.textContent = '';
            if (!window.MPAccount || !window.MPAccount.signedIn()) {
                host.appendChild(line('Sign in to your Platform account first, then come back here.'));
                const a = document.createElement('a');
                a.className = 'btn btn--ghost';
                a.href = '/messaging-platform/profile.html';
                a.textContent = 'Open the Platform account';
                host.appendChild(a);
                return;
            }
            host.appendChild(button('Link this Platform account', 'btn btn--primary', async function () {
                fail('');
                try {
                    // Minted where the password lives; spent here. If the mint
                    // fails the session is the problem, and saying so beats a
                    // generic failure on the link button.
                    const assertion = await window.MPAccount.linkAssertion();
                    if (!assertion) throw new Error('Could not prove that Platform account. Sign in again.');
                    await DeveloperAPI.linkPlatform(assertion);
                    await load();
                } catch (e) {
                    fail(e.message);
                }
            }));
        }

        async function load() {
            fail('');
            host.textContent = '';
            host.appendChild(line('Checking\u2026'));
            let state;
            try {
                const body = await DeveloperAPI.getAccountLink();
                state = (body && body.data) || body || {};
            } catch (e) {
                host.textContent = '';
                host.appendChild(line('Could not read the link state.'));
                fail(e.message);
                return;
            }
            if (state.linked) renderLinked(state); else renderUnlinked();
        }

        load();
    }

    function initPasswordForm() {
        const form = document.getElementById('passwordForm');
        const button = document.getElementById('passwordBtn');
        const current = document.getElementById('currentPassword');
        const next = document.getElementById('newPassword');
        const confirmInput = document.getElementById('confirmPassword');

        confirmInput.addEventListener('blur', () => {
            if (confirmInput.value && confirmInput.value !== next.value) {
                fieldError('confirmPassword', 'The two passwords do not match.');
            } else fieldError('confirmPassword', null);
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (!current.value) { fieldError('currentPassword', 'Enter your current password.'); return; }
            fieldError('currentPassword', null);
            if (next.value.length < 8) { fieldError('newPassword', 'Use at least 8 characters.'); return; }
            fieldError('newPassword', null);
            if (confirmInput.value !== next.value) { fieldError('confirmPassword', 'The two passwords do not match.'); return; }
            fieldError('confirmPassword', null);

            await UI.withBusy(button, async () => {
                try {
                    await DeveloperAPI.changePassword(current.value, next.value);
                    form.reset();
                    const profile = DeveloperAPI.getProfile();
                    if (profile) {
                        profile.passwordChangeRequired = false;
                        DeveloperAPI.setProfile(profile);
                    }
                    document.getElementById('passwordNotice').innerHTML = '';
                    UI.toast.success('Password changed.');
                } catch (err) {
                    UI.toast.error(err.message || 'Could not change your password.');
                }
            });
        });
    }

    /* ------------------------------------------------------------------ boot */

    document.addEventListener('DOMContentLoaded', function () {
        if (!DeveloperAPI.isLoggedIn()) { window.location.replace('index.html'); return; }

        UI.initShell();
        initProfile();
        initTempKeyForm();
        initChannelControls();
        initTools();
        initPasswordForm();
        initPlatformLink();

        document.getElementById('logoutBtn').addEventListener('click', async function () {
            await DeveloperAPI.logout();
            window.location.replace('index.html');
        });

        window.addEventListener('hashchange', route);
        route();
    });
})();
