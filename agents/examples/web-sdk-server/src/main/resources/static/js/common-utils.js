/**
 * Mini-Games Common Utilities
 *
 * Shared utilities for all mini-games including:
 * - Page unload cleanup
 * - Share modal integration
 * - Common UI helpers
 */

(function(window) {
    'use strict';

    const MiniGameUtils = {
        /**
         * Setup cleanup on page unload/navigation
         * Ensures proper disconnect when user closes tab or navigates away
         *
         * @param {Object|Function} channelOrGetter - The AgentConnection instance or function that returns it
         * @param {string} context - Optional context name for logging (e.g., 'Whiteboard', 'Chat', 'Storage')
         */
        setupCleanupOnUnload: function(channelOrGetter, context) {
            if (!channelOrGetter) {
                console.warn('[Cleanup] Cannot setup cleanup: channelOrGetter is null');
                return;
            }

            const contextName = context || 'Page';

            const cleanupBeforeUnload = () => {
                try {
                    // Get channel (support both direct reference and getter function)
                    const channel = typeof channelOrGetter === 'function' ? channelOrGetter() : channelOrGetter;

                    if (channel && typeof channel.disconnect === 'function') {
                        // Use beacon API for disconnect during unload (best-effort)
                        channel.disconnect({ useBeacon: true });
                        console.log(`[${contextName}] Requested channel disconnect with beacon`);
                    }
                } catch (err) {
                    console.warn(`[${contextName}] Error while calling channel.disconnect({useBeacon:true}) during unload:`, err);
                }
            };

            // Register cleanup handlers
            // NOTE: Using BOTH 'unload' and 'pagehide' for maximum compatibility:
            // - 'unload': Works on desktop browsers
            // - 'pagehide': More reliable on mobile browsers and handles bfcache
            // - Both only fire when page actually closes (not during warning dialog)
            try {
                window.addEventListener('unload', cleanupBeforeUnload);
                window.addEventListener('pagehide', cleanupBeforeUnload);
                console.log(`[${contextName}] ✅ Cleanup handlers registered for page unload`);
            } catch (e) {
                console.warn(`[${contextName}] Could not register cleanup handlers:`, e);
            }
        },

        /**
         * Show the share modal for current game/channel
         *
         * @param {string} channelName - Channel name
         * @param {string} channelPassword - Channel password
         * @param {string} apiKey - API key (optional)
         */
        showShareModal: function(channelName, channelPassword, apiKey) {
            if (typeof ShareModal !== 'undefined' && ShareModal.show) {
                ShareModal.show(channelName, channelPassword, apiKey);
            } else {
                console.error('ShareModal not available. Make sure share-modal.js is loaded.');
                alert('Share functionality not available');
            }
        },

        /**
         * Generate a unique agent name for the current user
         *
         * @param {string} prefix - Optional prefix (e.g., 'Player', 'User')
         * @returns {string} Generated agent name
         */
        generateAgentName: function(prefix = 'User') {
            const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
            return `${prefix}-${rand}`;
        },

        /**
         * Show a toast notification
         *
         * @param {string} message - Message to display
         * @param {string} type - Type: 'success', 'error', 'info'
         * @param {number} duration - Duration in ms (default 3000)
         */
        showToast: function(message, type = 'info', duration = 3000) {
            // Create toast container if doesn't exist (styling comes from toast.css)
            let toastContainer = document.getElementById('toast-container');
            if (!toastContainer) {
                toastContainer = document.createElement('div');
                toastContainer.id = 'toast-container';
                // No inline styles - uses toast.css for positioning (bottom-right)
                document.body.appendChild(toastContainer);
            }

            // Create toast
            const toast = document.createElement('div');
            const colors = {
                success: '#4CAF50',
                error: '#f44336',
                info: '#2196F3',
                warning: '#FFC107'
            };
            const color = colors[type] || colors.info;

            toast.style.cssText = `
                background: ${color};
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-size: 14px;
                max-width: 300px;
                animation: slideIn 0.3s ease-out;
            `;
            toast.textContent = message;

            // Add animation
            const style = document.createElement('style');
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(400px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(400px); opacity: 0; }
                }
            `;
            if (!document.getElementById('toast-animations')) {
                style.id = 'toast-animations';
                document.head.appendChild(style);
            }

            toastContainer.appendChild(toast);

            // Auto remove
            setTimeout(() => {
                toast.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }, duration);
        },

        /**
         * Add share button to a connection modal
         *
         * @param {string} modalId - ID of the modal element
         * @param {Function} getChannelDetails - Function that returns {channelName, channelPassword, apiKey}
         */
        addShareButtonToModal: function(modalId, getChannelDetails) {
            // Do not add share button inside the connection modal (connection dialog should not include share UI)
            if (modalId === 'connectionModal' || modalId === 'connection-modal' || modalId === 'connection') {
                console.info('Skipping adding share button to connection modal:', modalId);
                return;
            }

            const modal = document.getElementById(modalId);
            if (!modal) {
                console.warn(`Modal ${modalId} not found`);
                return;
            }

            // Check if share button already exists
            if (document.getElementById('minigame-share-btn')) {
                return;
            }

            // Find the connect button or footer inside the modal
            let connectBtn = modal.querySelector('button[onclick*="connect"]') || modal.querySelector('.btn.primary');

            // If not found inside modal, try a global connect button elsewhere on the page
            if (!connectBtn) {
                connectBtn = document.querySelector('button[onclick*="connect"]') || document.querySelector('.global-connect') || document.querySelector('.btn-primary');
            }

            if (!connectBtn) {
                console.warn('Could not find connect button to add share button');
                // As a last resort, attach the share button to the modal footer area if present
            }

            // Create share button
            const shareBtn = document.createElement('button');
            shareBtn.id = 'minigame-share-btn';
            shareBtn.className = 'btn ghost';
            // Show by default so users can share pre-connection; games can hide/show via toggle
            shareBtn.style.cssText = 'display: inline-block; margin-left: 8px; padding: 8px 12px;';
            shareBtn.innerHTML = '🔗 Share Channel';

            shareBtn.onclick = () => {
                const details = getChannelDetails();
                if (details && details.channelName && details.channelPassword) {
                    MiniGameUtils.showShareModal(
                        details.channelName,
                        details.channelPassword,
                        details.apiKey || ''
                    );
                } else {
                    // Attempt to read from inputs if available
                    try {
                        const modalEl = document.getElementById(modalId);
                        if (modalEl) {
                            const ch = modalEl.querySelector('#channelInput, input[placeholder="Room name"]');
                            const pw = modalEl.querySelector('#passwordInput, input[placeholder="Room password"]');
                            const channelNameVal = ch ? ch.value.trim() : '';
                            const channelPasswordVal = pw ? pw.value.trim() : '';
                            if (channelNameVal && channelPasswordVal) {
                                MiniGameUtils.showShareModal(channelNameVal, channelPasswordVal, '');
                                return;
                            }
                        }
                    } catch (e) {
                        // ignore
                    }

                    MiniGameUtils.showToast('No channel name/password found to share', 'error');
                }
            };

            // Insert the share button next to the found connect button if possible
            try {
                if (connectBtn && connectBtn.parentNode) {
                    connectBtn.parentNode.insertBefore(shareBtn, connectBtn.nextSibling);
                } else {
                    // Fallback: append to modal content footer if available
                    const footer = modal.querySelector('.modal-buttons') || modal.querySelector('.footer') || modal.querySelector('.modal-content');
                    if (footer) footer.appendChild(shareBtn);
                    else document.body.appendChild(shareBtn); // last resort
                }
            } catch (e) {
                console.warn('Failed to insert share button near connect button, appending to modal', e);
                const footer = modal.querySelector('.modal-buttons') || modal.querySelector('.footer') || modal.querySelector('.modal-content');
                if (footer) footer.appendChild(shareBtn);
                else document.body.appendChild(shareBtn);
            }
        },

        /**
         * Show/hide share button based on connection status
         *
         * @param {boolean} connected - Whether connected or not
         */
        toggleShareButton: function(connected) {
            const shareBtn = document.getElementById('minigame-share-btn');
            if (shareBtn) {
                shareBtn.style.display = connected ? 'block' : 'none';
            }
        },

        // --- Auto-connect after prefill ---
        _autoConnectMode: null, // 'immediate' | 'timed' | null
        _autoConnectDelay: 3000,
        _autoConnectTimer: null,
        _autoConnectCallback: null, // Callback function to execute on auto-connect

        /**
         * Enable automatic connect after a shared link prefill.
         * @param {string} mode - 'immediate' | 'timed' | null
         * @param {number} delay - milliseconds (used for 'timed')
         * @param {Function} callback - Optional callback to execute instead of window.connect()
         */
        enableAutoConnect: function(mode = 'timed', delay = 3000, callback = null) {
            this._autoConnectMode = mode;
            this._autoConnectDelay = delay;
            if (callback && typeof callback === 'function') {
                this._autoConnectCallback = callback;
            }
        },

        /**
         * Start auto-connect if configured
         * This is called by share-modal.js after processing a shared link
         */
        _startAutoConnectIfConfigured: function() {
            try {
                if (!this._autoConnectMode) {
                    console.log('[MiniGameUtils] Auto-connect not enabled');
                    return;
                }

                // Prevent multiple timers - clear any existing timer first
                if (this._autoConnectTimer) {
                    console.log('[MiniGameUtils] Auto-connect already in progress, clearing previous timer');
                    clearInterval(this._autoConnectTimer);
                    this._autoConnectTimer = null;
                    try { document.getElementById('minigame-autoconnect-toast')?.remove(); } catch(e){}
                }

                // Get the connect method (prefer callback, fallback to window.connect)
                const connectMethod = this._autoConnectCallback || window.connect;
                if (typeof connectMethod !== 'function') {
                    console.warn('[MiniGameUtils] No connect method available for auto-connect');
                    return;
                }

                if (this._autoConnectMode === 'immediate') {
                    console.log('[MiniGameUtils] Starting immediate auto-connect');
                    setTimeout(() => {
                        try {
                            connectMethod();
                        } catch(e) {
                            console.warn('[MiniGameUtils] Auto-connect failed:', e);
                        }
                    }, 200);
                    return;
                }

                if (this._autoConnectMode === 'timed') {
                    // Show cancellable toast with countdown
                    const delay = Math.max(500, this._autoConnectDelay || 3000);
                    let remaining = Math.ceil(delay / 1000);
                    const id = 'minigame-autoconnect-toast';

                    // Remove existing toast if any
                    document.getElementById(id)?.remove();

                    const toast = document.createElement('div');
                    toast.id = id;
                    toast.style.cssText = 'position:fixed;top:18px;right:18px;z-index:100004;background:#111827;color:#fff;padding:10px 12px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.4);font-size:13px;display:flex;align-items:center;gap:10px';
                    const txt = document.createElement('span');
                    txt.textContent = `Connecting in ${remaining}s...`;
                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = 'btn ghost';
                    cancelBtn.style.cssText = 'padding:6px 10px;border-radius:6px;background:transparent;color:#e6eef8;border:1px solid rgba(230,238,248,0.08)';
                    cancelBtn.textContent = 'Cancel';
                    cancelBtn.onclick = () => { this._cancelAutoConnect(); };
                    toast.appendChild(txt);
                    toast.appendChild(cancelBtn);
                    document.body.appendChild(toast);

                    console.log(`[MiniGameUtils] Starting timed auto-connect (${remaining}s countdown)`);

                    this._autoConnectTimer = setInterval(() => {
                        remaining -= 1;
                        if (remaining <= 0) {
                            clearInterval(this._autoConnectTimer);
                            this._autoConnectTimer = null;
                            try { toast.remove(); } catch(e){}

                            console.log('[MiniGameUtils] Auto-connect countdown finished, connecting...');
                            try {
                                connectMethod();
                            } catch(e) {
                                console.warn('[MiniGameUtils] Auto-connect failed:', e);
                            }
                            return;
                        }
                        txt.textContent = `Connecting in ${remaining}s...`;
                    }, 1000);
                }
            } catch (e) {
                console.warn('[MiniGameUtils] startAutoConnectIfConfigured failed:', e);
            }
        },

        _cancelAutoConnect: function() {
            try {
                if (this._autoConnectTimer) { clearInterval(this._autoConnectTimer); this._autoConnectTimer = null; }
                const id = 'minigame-autoconnect-toast';
                document.getElementById(id)?.remove();
                this._autoConnectMode = null;
            } catch (e) { console.warn('cancelAutoConnect failed', e); }
        },

        /**
         * Centralized shared link processing with auto-connect support.
         * This eliminates duplicate code across all mini-games.
         *
         * @param {Object} config - Configuration object
         * @param {string} config.gameName - Game name for logging (e.g., 'Reactor')
         * @param {string} config.storagePrefix - LocalStorage prefix (e.g., 'reactor_')
         * @param {Function} config.connectCallback - Async function to call for connection
         * @param {number} [config.autoConnectDelay=3000] - Delay in ms before auto-connect
         *
         * @example
         * MiniGameUtils.processSharedLinkAndAutoConnect({
         *     gameName: 'Reactor',
         *     storagePrefix: 'reactor_',
         *     connectCallback: async () => {
         *         const username = document.getElementById('usernameInput')?.value?.trim();
         *         const channel = document.getElementById('channelInput')?.value?.trim();
         *         const password = document.getElementById('passwordInput')?.value || '';
         *         if (username && channel) {
         *             await connectReactor(username, channel, password);
         *         }
         *     }
         * });
         */
        processSharedLinkAndAutoConnect: function(config) {
            const { gameName, storagePrefix, connectCallback, autoConnectDelay = 3000 } = config;

            if (typeof ShareModal === 'undefined' || !ShareModal.processSharedLink) {
                console.log(`[${gameName}] ShareModal not available`);
                return;
            }

            try {
                let hasSharedLink = false;

                ShareModal.processSharedLink((auth, agentName) => {
                    try {
                        const chEl = document.getElementById('channelInput');
                        const pwEl = document.getElementById('passwordInput');
                        const userEl = document.getElementById('usernameInput');

                        // Prefill channel/password from shared link
                        if (auth && chEl && pwEl) {
                            hasSharedLink = true;
                            chEl.value = auth.c || chEl.value || '';
                            pwEl.value = auth.p || pwEl.value || '';
                            chEl.readOnly = true;
                            pwEl.readOnly = true;
                            chEl.title = 'This channel was supplied by a shared link';
                            pwEl.title = 'This channel was supplied by a shared link';
                        }

                        // Agent name priority: encrypted name > saved username > generate
                        let finalName = null;
                        if (agentName && agentName.trim()) {
                            finalName = agentName;
                        } else {
                            try {
                                const savedUsername = localStorage.getItem(storagePrefix + 'username');
                                if (savedUsername && savedUsername.trim()) {
                                    finalName = savedUsername;
                                    console.log(`[${gameName}] Using saved username:`, savedUsername);
                                }
                            } catch (e) { /* ignore */ }
                        }
                        if (!finalName) {
                            finalName = window.generateRandomAgentName
                                ? window.generateRandomAgentName()
                                : ('Player-' + Math.random().toString(36).slice(2, 8));
                        }

                        // Set username and focus
                        if (userEl) {
                            userEl.value = finalName;
                            userEl.disabled = false;
                            requestAnimationFrame(() => {
                                userEl.focus();
                                userEl.select();
                            });
                        }

                        // Show connection modal - collapsed when auto-connect is enabled
                        const modal = document.getElementById('connectionModal');
                        if (modal) {
                            modal.classList.add('active');
                            
                            // Collapse modal immediately when auto-connect is enabled
                            if (hasSharedLink && connectCallback && typeof connectCallback === 'function') {
                                modal.classList.add('collapsed');
                                console.log(`[${gameName}] Modal collapsed for auto-connect`);
                            }
                        }

                        // Enable auto-connect ONLY if there's a shared link - immediate mode (no timer)
                        if (hasSharedLink && connectCallback && typeof connectCallback === 'function') {
                            console.log(`[${gameName}] Shared link detected - enabling immediate auto-connect`);
                            this.enableAutoConnect('immediate', 0, connectCallback);
                        }
                    } catch (e) {
                        console.warn(`[${gameName}] Share link handler failed`, e);
                    }
                });
            } catch (e) {
                console.warn(`[${gameName}] ShareModal.processSharedLink failed`, e);
            }
        },

        // --- Connection status placement and disconnect button ---
        relocateConnectionStatus: function() {
            try {
                // Prefer the compact agents badge; fall back to legacy userCount element
                const userCount = document.getElementById('agentsCountBadge') || document.getElementById('userCount') || document.querySelector('.user-count');
                const connStatus = document.querySelector('.connection-status') || document.getElementById('connection-status');
                if (userCount && connStatus && userCount.parentElement) {
                    // insert connection status after userCount
                    userCount.parentElement.insertBefore(connStatus, userCount.nextSibling);
                }
            } catch (e) { console.warn('relocateConnectionStatus failed', e); }
        },

        addDisconnectButton: function() {
            // No longer needed - using disconnectBtn in whiteboard.html
        },

        disconnectAndShowForm: function() {
            try {
                // disconnect channel if present
                try {
                    if (window.channel && typeof window.channel.disconnect === 'function') {
                        window.channel.disconnect();
                        console.log('Channel disconnected');
                    }
                } catch (e) { console.warn('Ewrror disconnecting channel', e); }

                // Show connection modal if present
                try { document.getElementById('connectionModal')?.classList.add('active'); } catch(e){}

                // Ensure channel/password inputs are editable again
                const ids = ['channelInput','passwordInput','channel','password','pw'];
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        try { el.readOnly = false; } catch(e){}
                        el.classList.remove('readonly-highlight');
                        if (el.parentElement) el.parentElement.classList.remove('readonly-wrapper');
                        el.title = el.title && String(el.title).includes('shared') ? '' : el.title;
                    }
                });

                // hide share button until reconnect
                try { this.toggleShareButton(false); } catch(e){}
                // cancel any pending auto-connect
                this._cancelAutoConnect();
            } catch (e) { console.warn('disconnectAndShowForm failed', e); }
        },

        // --- Agents modal utilities ---
        initAgentsUI: function() {
            try {
                // Inject modal HTML if missing
                if (!document.getElementById('agents-overlay')) {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = `
<div id="agents-overlay" class="agents-overlay" aria-hidden="true" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;align-items:center;justify-content:center;">
  <div id="agents-modal" class="agents-modal" role="dialog" aria-labelledby="agentsModalTitle" aria-describedby="agentsModalDesc" style="background:#0b1220;color:#e6eef8;padding:12px;border-radius:10px;width:420px;max-width:calc(100% - 24px);">
    <div class="header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div>
        <div id="agentsModalTitle" class="title" style="font-weight:700">Connected Agents</div>
        <div id="agentsModalDesc" class="sub" style="font-size:13px;color:var(--muted);">Total: <span id="agents-title-count">0</span></div>
      </div>
      <button class="close-btn" aria-label="Close modal" style="background:transparent;border:none;color:inherit;font-size:16px">×</button>
    </div>
    <div id="agents-list" class="agents-list" style="max-height:320px;overflow:auto;"> </div>
    <div class="footer" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button class="btn ghost close-btn">Close</button>
      <button class="btn primary copy-btn">Copy List</button>
    </div>
  </div>
</div>
`;
                    document.body.appendChild(wrapper.firstElementChild);

                    // wire events
                    document.getElementById('agents-overlay')?.addEventListener('click', function(e){ if (e.target === this) MiniGameUtils.hideAgentsModal(); });
                    const modal = document.getElementById('agents-modal');
                    modal?.addEventListener('click', function(e){
                        const close = e.target.closest && e.target.closest('.close-btn');
                        if (close) { e.stopPropagation(); MiniGameUtils.hideAgentsModal(); return; }
                        const copy = e.target.closest && e.target.closest('.copy-btn');
                        if (copy) { e.stopPropagation(); MiniGameUtils.copyAgentsToClipboard(); return; }
                    });
                    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') MiniGameUtils.hideAgentsModal(); });
                }

                // Wire click on user count to show modal
                // const badge = document.getElementById('userCount') || document.querySelector('.user-count');
                // if (badge) {
                //     badge.style.cursor = 'pointer';
                //     badge.addEventListener('click', function(ev){ ev && ev.stopPropagation && ev.stopPropagation(); const agents = MiniGameUtils.getConnectedAgentsList(); MiniGameUtils.showAgentsModal(agents); });
                // }
                // Create or attach an agents count badge next to the sidebar "Active Users" header
                try {
                    // Find a header that looks like the Active Users header (common variants)
                    const candidates = Array.from(document.querySelectorAll('.sidebar h3, .sidebar .title, .sidebar header h3, h3'));
                    let headerEl = candidates.find(el => el && /active users/i.test((el.textContent||'').trim()));
                    // fallback: look for emoji prefix '👥' in any h3
                    if (!headerEl) headerEl = candidates.find(el => el && (el.textContent||'').trim().startsWith('👥'));

                    if (headerEl) {
                        // If badge already exists, don't duplicate
                        let badge = document.getElementById('agentsCountBadge');
                        if (!badge) {
                            badge = document.createElement('span');
                            badge.id = 'agentsCountBadge';
                            badge.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 8px;border-radius:12px;background:#667eea;color:#fff;font-size:12px;cursor:pointer;';
                            badge.textContent = '0';
                            headerEl.appendChild(badge);
                        }

                        // clicking the header or badge opens the agents modal
                        const showAgents = (ev) => { ev && ev.stopPropagation && ev.stopPropagation(); const agents = MiniGameUtils.getConnectedAgentsList(); MiniGameUtils.showAgentsModal(agents); };
                        headerEl.style.cursor = 'pointer';
                        headerEl.addEventListener('click', showAgents);
                        document.getElementById('agentsCountBadge')?.addEventListener('click', showAgents);
                    }
                } catch (e) { console.warn('Failed to attach agents count badge', e); }
            } catch (e) { console.warn('initAgentsUI failed', e); }
        },

        /**
         * Set the compact agents count badge (used by games to display active count)
         * @param {number} count
         */
        setAgentsCount: function(count) {
            try {
                const badge = document.getElementById('agentsCountBadge');
                if (badge) {
                    badge.textContent = String(Number(count) || 0);
                } else {
                    // If badge missing, attempt to create via initAgentsUI
                    try { this.initAgentsUI(); } catch (e) {}
                    const b2 = document.getElementById('agentsCountBadge'); if (b2) b2.textContent = String(Number(count)||0);
                }
            } catch (e) { console.warn('setAgentsCount failed', e); }
        },

        getConnectedAgentsList: function() {
            try {
                const ch = window.channel || {};
                if (Array.isArray(ch.connectedAgents)) return ch.connectedAgents.slice();
                if (typeof ch.connectedAgents === 'string') return ch.connectedAgents.split(',').map(s => s.trim()).filter(Boolean);
                if (ch._connectedAgentsMap && typeof ch._connectedAgentsMap === 'object') {
                    return Object.keys(ch._connectedAgentsMap).map(k => {
                        const info = ch._connectedAgentsMap[k];
                        return (info && (info.name || info.agentName)) ? (info.name || info.agentName) : k;
                    });
                }
                if (Array.isArray(ch._connectedAgents)) return ch._connectedAgents.slice();
                if (ch.connectedAgents && typeof ch.connectedAgents === 'object') return Object.values(ch.connectedAgents).map(v => (typeof v === 'string' ? v : (v && (v.name || v.agentName)) || '') ).filter(Boolean);
                return [];
            } catch (e) { console.warn('getConnectedAgentsList failed', e); return []; }
        },

        showAgentsModal: function(list) {
            try {
                const overlay = document.getElementById('agents-overlay');
                const modal = document.getElementById('agents-modal');
                const listEl = document.getElementById('agents-list');
                const titleCount = document.getElementById('agents-title-count');
                if (!overlay || !modal || !listEl) return;
                listEl.innerHTML = '';
                const agents = Array.isArray(list) ? list : [];
                titleCount.textContent = agents.length;
                if (!agents.length) {
                    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No connected agents';
                    listEl.appendChild(empty);
                } else {
                    agents.forEach(a => {
                        const name = String(a || 'Unknown');
                        const item = document.createElement('div'); item.className = 'agent-item'; item.style.display = 'flex'; item.style.alignItems='center'; item.style.gap='12px'; item.style.padding='8px 6px';
                        const avatar = document.createElement('div'); avatar.className = 'agent-avatar'; avatar.textContent = (name || 'U').charAt(0).toUpperCase(); avatar.style.width='36px'; avatar.style.height='36px'; avatar.style.borderRadius='50%'; avatar.style.background='#334155'; avatar.style.display='flex'; avatar.style.alignItems='center'; avatar.style.justifyContent='center'; avatar.style.fontWeight='700';
                        const meta = document.createElement('div'); meta.style.display = 'flex'; meta.style.flexDirection = 'column';
                        const nm = document.createElement('div'); nm.className = 'agent-name'; nm.textContent = name; nm.style.fontWeight='600';
                        const m2 = document.createElement('div'); m2.className = 'agent-meta'; m2.textContent = 'online'; m2.style.fontSize='12px'; m2.style.color='var(--muted)';
                        meta.appendChild(nm); meta.appendChild(m2);
                        item.appendChild(avatar); item.appendChild(meta);
                        listEl.appendChild(item);
                    });
                }
                overlay.style.display = 'flex'; overlay.setAttribute('aria-hidden','false'); modal.style.display='block'; modal.setAttribute('aria-hidden','false'); modal.setAttribute('tabindex','-1'); modal.focus();
            } catch (e) { console.warn('showAgentsModal failed', e); }
        },

        hideAgentsModal: function() {
            try {
                const overlay = document.getElementById('agents-overlay');
                const modal = document.getElementById('agents-modal');
                if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden','true'); }
                if (modal) { modal.style.display = 'none'; modal.setAttribute('aria-hidden','true'); try { modal.removeAttribute('tabindex'); } catch(e){} }
            } catch (e) { console.warn('hideAgentsModal failed', e); }
        },

        copyAgentsToClipboard: function() {
            try {
                const list = this.getConnectedAgentsList();
                const txt = list.join('\n') || '';
                if (!txt) { this.showToast('No agents to copy', 'error'); return; }
                navigator.clipboard.writeText(txt).then(() => this.showToast('Agent list copied', 'success')).catch(() => this.showToast('Copy failed', 'error'));
            } catch (e) { console.warn('copyAgentsToClipboard failed', e); this.showToast('Copy failed', 'error'); }
        },

        // Channel monitor: detect global window.channel and attach UI handlers
        _channelMonitorInterval: null,
        _startChannelMonitor: function() {
            try {
                if (this._channelMonitorInterval) return;
                this._channelMonitorInterval = setInterval(() => {
                    try {
                        const ch = window.channel;
                        if (ch && typeof ch.addEventListener === 'function') {
                            clearInterval(this._channelMonitorInterval);
                            this._channelMonitorInterval = null;
                            this._attachChannelUi(ch);
                        }
                    } catch (e) { /* ignore and retry */ }
                }, 500);
            } catch (e) { console.warn('startChannelMonitor failed', e); }
        },

        _attachChannelUi: function(channel) {
            try {
                if (!channel) return;
                if (channel.__miniGameUiAttached) return;
                channel.__miniGameUiAttached = true;

                channel.addEventListener && channel.addEventListener('connect', () => {
                    try { this.toggleShareButton(true); } catch(e){}
                    // update agents count badge on connect
                    try {
                        const list = this.getConnectedAgentsList();
                        this.setAgentsCount(list.length);
                    } catch (e) {}
                });

                channel.addEventListener && channel.addEventListener('disconnect', () => {
                    try { this.toggleShareButton(false); } catch(e){}
                    try { this.disconnectAndShowForm(); } catch(e){}
                    // clear agents badge
                    try { this.setAgentsCount(0); } catch(e){}
                });

                // Update agents count on agent connect/disconnect events if channel emits them
                try {
                    channel.addEventListener && channel.addEventListener('agent-connect', (ev) => {
                        try { const list = this.getConnectedAgentsList(); this.setAgentsCount(list.length); } catch(e) {}
                    });
                    channel.addEventListener && channel.addEventListener('agent-disconnect', (ev) => {
                        try { const list = this.getConnectedAgentsList(); this.setAgentsCount(list.length); } catch(e) {}
                    });
                } catch (e) { /* ignore */ }
            } catch (e) { console.warn('attachChannelUi failed', e); }
        },

    };

    // =========================================================================
    // Channel Auth Encoding/Decoding Utilities
    // =========================================================================

    /**
     * Simple XOR encryption/decryption
     * @param {string} text - Text to encrypt/decrypt
     * @param {string} key - Encryption key (agent name)
     * @returns {string} Encrypted/decrypted text
     */
    function xorEncryptDecrypt(text, key) {
        if (!text || !key) return text;
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    }

    /**
     * Encode channel auth (no encryption)
     * @param {string} channelName - Channel name
     * @param {string} channelPassword - Channel password
     * @param {string} apiKey - API key (optional)
     * @returns {string} Base64 encoded auth
     */
    function encodeChannelAuth(channelName, channelPassword, apiKey) {
        try {
            const data = {
                c: channelName,
                p: channelPassword,
                t: Date.now()
            };
            if (apiKey) {
                data.k = apiKey;
            }
            const json = JSON.stringify(data);
            return btoa(json);
        } catch (e) {
            console.error('[ChannelAuth] Encode error:', e);
            return null;
        }
    }

    /**
     * Encode channel auth with encryption
     * @param {string} channelName - Channel name
     * @param {string} channelPassword - Channel password
     * @param {string} apiKey - API key (optional)
     * @param {string} agentName - Agent name (encryption key)
     * @returns {string} Base64 encoded encrypted auth
     */
    function encodeChannelAuthEncrypted(channelName, channelPassword, apiKey, agentName) {
        try {
            if (!agentName || agentName.trim().length === 0) {
                throw new Error('Agent name required for encryption');
            }

            const data = {
                c: channelName,
                p: channelPassword,
                t: Date.now(),
                e: 1 // encrypted flag
            };
            if (apiKey) {
                data.k = apiKey;
            }
            const json = JSON.stringify(data);
            const encrypted = xorEncryptDecrypt(json, agentName);
            return btoa(encrypted);
        } catch (e) {
            console.error('[ChannelAuth] Encrypt error:', e);
            return null;
        }
    }

    /**
     * Decode channel auth (no decryption)
     * @param {string} encoded - Base64 encoded auth
     * @returns {object|null} Decoded auth data
     */
    function decodeChannelAuth(encoded) {
        try {
            const json = atob(encoded);
            const data = JSON.parse(json);
            return data;
        } catch (e) {
            console.error('[ChannelAuth] Decode error:', e);
            return null;
        }
    }

    /**
     * Decode channel auth with decryption
     * @param {string} encoded - Base64 encoded encrypted auth
     * @param {string} agentName - Agent name (decryption key)
     * @returns {object|null} Decoded auth data
     */
    function decodeChannelAuthEncrypted(encoded, agentName) {
        try {
            if (!agentName || agentName.trim().length === 0) {
                throw new Error('Agent name required for decryption');
            }

            const encrypted = atob(encoded);
            const json = xorEncryptDecrypt(encrypted, agentName);
            const data = JSON.parse(json);

            // Validate it was encrypted (has 'e' flag)
            if (!data.e) {
                throw new Error('Data was not encrypted');
            }

            return data;
        } catch (e) {
            console.error('[ChannelAuth] Decrypt error:', e);
            return null;
        }
    }

    /**
     * Decode channel auth with fallback (tries decryption first, then plain)
     * @param {string} encoded - Base64 encoded auth
     * @param {string} agentName - Agent name (decryption key, optional)
     * @returns {object|null} Decoded auth data
     */
    function decodeChannelAuthAuto(encoded, agentName) {
        if (!encoded || encoded.trim().length === 0) {
            return null;
        }

        // Try encrypted first if agent name provided
        if (agentName) {
            try {
                const encrypted = atob(encoded);
                const json = xorEncryptDecrypt(encrypted, agentName);
                const data = JSON.parse(json);
                if (data && data.e) {
                    // Valid encrypted data
                    return data;
                }
            } catch (e) {
                // Fall through to plain decode (suppress error)
            }
        }

        // Try plain decode
        try {
            const json = atob(encoded);
            const data = JSON.parse(json);
            if (data) {
                return data;
            }
        } catch (e) {
            // Failed to decode
        }

        return null;
    }

    // Export channel auth utilities
    const ChannelAuthUtils = {
        encode: encodeChannelAuth,
        encodeEncrypted: encodeChannelAuthEncrypted,
        decode: decodeChannelAuth,
        decodeEncrypted: decodeChannelAuthEncrypted,
        decodeAuto: decodeChannelAuthAuto
    };

    window.ChannelAuthUtils = ChannelAuthUtils;

    // Export individual functions for backward compatibility
    window.encodeChannelAuth = encodeChannelAuth;
    window.encodeChannelAuthEncrypted = encodeChannelAuthEncrypted;
    window.decodeChannelAuth = decodeChannelAuth;
    window.decodeChannelAuthEncrypted = decodeChannelAuthEncrypted;

    // Expose to window
    window.MiniGameUtils = MiniGameUtils;

    // Backwards-compatible global expected by share-modal.js
    if (typeof window.generateRandomAgentName !== 'function') {
        window.generateRandomAgentName = function(prefix) {
            return MiniGameUtils.generateAgentName(prefix);
        };
    }

    // Auto-init common UI on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            try { MiniGameUtils.relocateConnectionStatus(); } catch(e){}
            try { MiniGameUtils.addDisconnectButton(); } catch(e){}
            try { MiniGameUtils.initAgentsUI(); } catch(e){}
            try { MiniGameUtils.enableAutoConnect('immediate', 0); } catch(e){}
            try { MiniGameUtils._startChannelMonitor(); } catch(e){}
        });
    } else {
        try { MiniGameUtils.relocateConnectionStatus(); } catch(e){}
        try { MiniGameUtils.addDisconnectButton(); } catch(e){}
        try { MiniGameUtils.initAgentsUI(); } catch(e){}
        try { MiniGameUtils.enableAutoConnect('immediate', 0); } catch(e){}
        try { MiniGameUtils._startChannelMonitor(); } catch(e){}
    }

})(window);

