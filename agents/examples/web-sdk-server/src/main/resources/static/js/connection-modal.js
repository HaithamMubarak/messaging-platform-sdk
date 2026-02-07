/**
 * Connection Modal - Common JavaScript
 * Extracted from whiteboard for reuse across all demos
 *
 * Usage:
 * 1. Include connection-modal.css
 * 2. Include this script
 * 3. Call loadConnectionModal(config) with:
 *    - localStoragePrefix: prefix for localStorage keys (e.g., 'whiteboard_', 'chat_')
 *    - channelPrefix: prefix for generated channel names (e.g., 'whiteboard-', 'channel-')
 *    - onConnect: function(username, channel, password) - called when user clicks connect
 *    - onHideModal: function() - called after successful connection to hide modal
 */

(function(window) {
    'use strict';

    // Embedded HTML template (no need for external file or fetch)
    const HTML_TEMPLATE = `
<!-- Connection Modal HTML Template -->
<div id="connectionModal" class="connection-modal active">
    <div class="collapsed-header" role="button" aria-expanded="false" tabindex="0">
        <div class="ch-left">
            <div class="ch-title">{{COLLAPSED_TITLE}}</div>
            <div class="ch-sub">
                <span id="collapsedUsernameDisplay" style="display:none;">Name: <strong id="collapsedUsernameValue">-</strong> | </span>
                Channel: <span id="collapsedChannelDisplay">-</span>
            </div>
        </div>
        <div class="quick-connect">
            <input id="quickUsernameInput" type="text" placeholder="Your name" aria-label="Your name" />
            <button id="quickConnectBtn" type="button" class="btn-primary" aria-label="Quick connect">Connect</button>
        </div>
        <button id="modalToggleBtn" class="modal-toggle-btn" aria-label="Toggle connection form">▾</button>
    </div>

    <div class="modal-content">
        <div class="modal-header-row">
            <h2>{{MODAL_TITLE}}</h2>
            <button id="modalToggleBtn2" class="modal-toggle-btn" aria-label="Toggle form">🗕</button>
        </div>

        <div class="connection-info-note">
            <p><strong>💡 Tip:</strong> Channel name and password are freely chosen by you. Pick any values you like, then share them with others to connect together on the same channel.</p>
        </div>

        <form id="connectionForm" onsubmit="return false;">
            <label for="usernameInput" class="sr-only">Your name</label>
            <input type="text" id="usernameInput" placeholder="Your name">

            <label for="channelInput" class="sr-only">Channel name</label>
            <input type="text" id="channelInput" placeholder="Channel name">

            <label for="passwordInput" class="sr-only">Channel password</label>
            <div class="password-input-wrapper">
                <input type="password" id="passwordInput" placeholder="Channel password">
                <button type="button" id="togglePasswordBtn" class="password-toggle-btn" onclick="togglePasswordVisibility()" aria-label="Show password" title="Show password">
                    <span id="passwordToggleIcon">👁️</span>
                </button>
            </div>

            <div class="modal-buttons">
                <button type="button" id="connectBtn" class="btn-primary">Connect</button>
                <button type="button" id="regenerateBtn" class="ghost">Regenerate</button>
            </div>
        </form>
    </div>
</div>
`;

    // Helper functions
    function randomDigits(length) {
        let result = '';
        for (let i = 0; i < length; i++) {
            result += Math.floor(Math.random() * 10);
        }
        return result;
    }

    function generatePassword() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 8; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    function _generateRandomAgentNameBase() {
        const adjectives = ['Quick', 'Swift', 'Kind', 'Brave', 'Wise', 'Cool'];
        const nouns = ['Wolf', 'Bear', 'Fox', 'Eagle', 'Tiger', 'Lion'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return adj + noun + Math.floor(Math.random() * 100);
    }

    /**
     * Load and initialize connection modal
     * @param {Object} config - Configuration object
     * @param {string} config.localStoragePrefix - Prefix for localStorage keys (e.g., 'whiteboard_')
     * @param {string} config.channelPrefix - Prefix for channel names (e.g., 'whiteboard-')
     * @param {string} config.title - Modal title (e.g., '🎨 Join Whiteboard')
     * @param {string} config.collapsedTitle - Collapsed header title (optional, defaults to title)
     * @param {Function} config.onConnect - Callback when user clicks connect: function(username, channel, password)
     * @param {Function} config.onHideModal - Callback to hide modal after connection (optional)
     */
    window.loadConnectionModal = function(config) {
        // Use embedded template - no fetch needed!
        const collapsedTitle = config.collapsedTitle || config.title || '🔗 Connect';
        const modalTitle = config.title || '🔗 Connect to Channel';

        // Replace placeholders in template
        let html = HTML_TEMPLATE;
        html = html.replace('{{COLLAPSED_TITLE}}', collapsedTitle);
        html = html.replace('{{MODAL_TITLE}}', modalTitle);

        // Insert into page
        document.body.insertAdjacentHTML('beforeend', html);

        console.log('[ConnectionModal] Template loaded (embedded)');

        // Initialize
        window.initConnectionModal(config);
    };

    /**
     * Initialize connection modal (after HTML is loaded)
     * @param {Object} config - Configuration object
     */
    window.initConnectionModal = function(config) {
        const localStoragePrefix = config.localStoragePrefix || '';
        const channelPrefix = config.channelPrefix || 'channel-';
        const onConnect = config.onConnect;
        const onHideModal = config.onHideModal;

        const chEl = document.getElementById('channelInput');
        const pwEl = document.getElementById('passwordInput');
        const userEl = document.getElementById('usernameInput');
        const quickUserEl = document.getElementById('quickUsernameInput');

        // Helper to persist values
        function persistValues(u, c, p) {
            localStorage.setItem(localStoragePrefix + 'username', u || '');
            localStorage.setItem(localStoragePrefix + 'channel', c || '');
            localStorage.setItem(localStoragePrefix + 'password', p || '');
        }

        // Helper to load persisted values
        function loadPersisted() {
            try {
                return {
                    u: localStorage.getItem(localStoragePrefix + 'username') || '',
                    c: localStorage.getItem(localStoragePrefix + 'channel') || '',
                    p: localStorage.getItem(localStoragePrefix + 'password') || ''
                };
            } catch (e) {
                return {u: '', c: '', p: ''};
            }
        }

        // Regenerate function
        function doRegenerate() {
            if (chEl && !chEl.readOnly) chEl.value = channelPrefix + randomDigits(8);
            if (pwEl && !pwEl.readOnly) pwEl.value = generatePassword();
            // Don't regenerate username - keep it persistent across channels
            if (userEl && !userEl.value.trim()) {
                const base = (window.generateRandomAgentName && typeof window.generateRandomAgentName === 'function')
                    ? window.generateRandomAgentName()
                    : _generateRandomAgentNameBase();
                userEl.value = base + '-' + randomDigits(4);
            }
            if (quickUserEl) quickUserEl.value = userEl ? userEl.value : '';
            persistValues(userEl ? userEl.value : '', chEl ? chEl.value : '', pwEl ? pwEl.value : '');
        }

        // Load persisted values
        const persisted = loadPersisted();

        // Priority 1: Check URL parameters (hash-based from share links)
        let urlChannel = null;
        let urlPassword = null;
        let urlApiKey = null;
        try {
            let hash = window.location.hash;
            if (hash && hash.startsWith('#')) {
                // Remove leading #
                hash = hash.substring(1);

                // Handle multiple # in URL (e.g., #base64data#channel-name)
                // Take only the first part (the base64 encoded data)
                const hashParts = hash.split('#');
                const hashContent = hashParts[0];

                if (!hashContent || hashContent.length === 0) {
                    console.log('[ConnectionModal] Empty hash, skipping URL decode');
                } else {
                    // Try to decode using ChannelAuthUtils (supports both encrypted and plain)
                    if (window.ChannelAuthUtils) {
                        const decoded = window.ChannelAuthUtils.decodeAuto(hashContent, persisted.u);
                        if (decoded) {
                            if (decoded.c) urlChannel = decoded.c;
                            if (decoded.p) urlPassword = decoded.p;
                            if (decoded.k) urlApiKey = decoded.k;
                            console.log('[ConnectionModal] Loaded from URL hash:', {
                                channel: urlChannel,
                                password: '***',
                                apiKey: urlApiKey ? '***' : 'none'
                            });
                        } else {
                            console.log('[ConnectionModal] Failed to decode hash, using defaults');
                        }
                    } else {
                        // Fallback to simple base64 JSON parsing if ChannelAuthUtils not loaded
                        try {
                            const decoded = atob(hashContent);
                            const params = JSON.parse(decoded);
                            if (params.c) urlChannel = params.c;
                            if (params.p) urlPassword = params.p;
                            if (params.k) urlApiKey = params.k;
                            console.log('[ConnectionModal] Loaded from URL hash (fallback)');
                        } catch (e) {
                            console.log('[ConnectionModal] Hash is not base64 JSON');
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[ConnectionModal] Failed to parse URL hash:', e);
        }

        // Priority 2: ALWAYS restore username from localStorage if it exists
        if (persisted.u && userEl) {
            userEl.value = persisted.u;
            userEl.disabled = false;
        } else if (userEl) {
            // No saved username - generate one ONCE
            const base = (window.generateRandomAgentName && typeof window.generateRandomAgentName === 'function')
                ? window.generateRandomAgentName()
                : _generateRandomAgentNameBase();
            userEl.value = base + '-' + randomDigits(4);
            userEl.disabled = false;
        }

        // Update quick username input
        if (quickUserEl) quickUserEl.value = userEl ? userEl.value : '';

        // Priority 3: For channel and password - URL > localStorage > generate
        if (chEl && !chEl.readOnly) {
            chEl.value = urlChannel || persisted.c || (channelPrefix + randomDigits(8));
        }
        if (pwEl && !pwEl.readOnly) {
            pwEl.value = urlPassword || persisted.p || generatePassword();
        }

        // Persist initial values
        persistValues(userEl ? userEl.value : '', chEl ? chEl.value : '', pwEl ? pwEl.value : '');

        // Wire regenerate button - disable if auto-connect URL is detected
        const regenBtn = document.getElementById('regenerateBtn');
        const hasAutoConnectUrl = !!(urlChannel || urlPassword);

        // Hide info note if auto-connect URL is detected
        const infoNote = document.querySelector('.connection-info-note');
        if (infoNote && hasAutoConnectUrl) {
            infoNote.style.display = 'none';
        }

        if (regenBtn) {
            // Disable regenerate if channel/password came from URL (auto-connect link)
            if (hasAutoConnectUrl) {
                regenBtn.disabled = true;
                regenBtn.title = 'Cannot regenerate - using shared link credentials';
                regenBtn.style.opacity = '0.5';
                regenBtn.style.cursor = 'not-allowed';
            } else {
                regenBtn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    doRegenerate();
                });
            }
        }

        // Persist whenever user edits the inputs
        if (userEl) userEl.addEventListener('change', () => persistValues(userEl.value, chEl ? chEl.value : '', pwEl ? pwEl.value : ''));
        if (chEl) chEl.addEventListener('change', () => persistValues(userEl ? userEl.value : '', chEl.value, pwEl ? pwEl.value : ''));
        if (pwEl) pwEl.addEventListener('change', () => persistValues(userEl ? userEl.value : '', chEl ? chEl.value : '', pwEl.value));

        // Update collapsed channel display
        if (chEl) {
            const collapsedDisplay = document.getElementById('collapsedChannelDisplay');
            if (collapsedDisplay) {
                collapsedDisplay.textContent = chEl.value;
                chEl.addEventListener('input', () => {
                    collapsedDisplay.textContent = chEl.value;
                });
            }
        }

        // Update collapsed username display
        if (userEl) {
            const collapsedUsernameDisplay = document.getElementById('collapsedUsernameDisplay');
            const collapsedUsernameValue = document.getElementById('collapsedUsernameValue');
            
            // Helper function to update username display
            const updateUsernameDisplay = () => {
                if (collapsedUsernameValue && userEl.value.trim()) {
                    collapsedUsernameValue.textContent = userEl.value.trim();
                    if (collapsedUsernameDisplay) {
                        collapsedUsernameDisplay.style.display = 'inline';
                    }
                } else if (collapsedUsernameDisplay) {
                    collapsedUsernameDisplay.style.display = 'none';
                }
            };
            
            // Update on input
            updateUsernameDisplay();
            userEl.addEventListener('input', updateUsernameDisplay);
            
            // Also update when quick username input changes
            if (quickUserEl) {
                quickUserEl.addEventListener('input', () => {
                    if (userEl) userEl.value = quickUserEl.value;
                    updateUsernameDisplay();
                });
            }
        }

        // Wire connect button
        const connectBtn = document.getElementById('connectBtn');
        if (connectBtn && onConnect) {
            connectBtn.onclick = function() {
                const username = userEl ? userEl.value.trim() : '';
                const channel = chEl ? chEl.value.trim() : '';
                const password = pwEl ? pwEl.value.trim() : '';

                if (!username || !channel || !password) {
                    if (window.MiniGameUtils && window.MiniGameUtils.showToast) {
                        window.MiniGameUtils.showToast('All fields are required', 'error');
                    } else {
                        alert('Please fill in all fields');
                    }
                    return;
                }

                // Call the page-specific connect callback
                onConnect(username, channel, password);
            };
        }

        // Wire quick connect button
        const quickConnectBtn = document.getElementById('quickConnectBtn');
        if (quickConnectBtn && onConnect) {
            quickConnectBtn.onclick = function() {
                const username = quickUserEl ? quickUserEl.value.trim() : '';
                const channel = chEl ? chEl.value.trim() : '';
                const password = pwEl ? pwEl.value.trim() : '';

                if (!username) {
                    if (window.MiniGameUtils && window.MiniGameUtils.showToast) {
                        window.MiniGameUtils.showToast('Please enter your name', 'error');
                    } else {
                        alert('Please enter your name');
                    }
                    return;
                }

                // Sync username
                if (userEl) userEl.value = username;
                persistValues(username, channel, password);

                // Call the page-specific connect callback
                onConnect(username, channel, password);
            };
        }

        // Cancel auto-connect when user clicks username field
        const cancelAutoConnect = () => {
            if (window.MiniGameUtils && typeof window.MiniGameUtils._cancelAutoConnect === 'function') {
                window.MiniGameUtils._cancelAutoConnect();
                console.log('[Auto-Connect] Canceled - user is editing username');
            }
        };

        if (userEl) userEl.addEventListener('click', cancelAutoConnect);
        if (quickUserEl) quickUserEl.addEventListener('click', cancelAutoConnect);

        // Toggle modal collapse/expand
        function toggleModal() {
            const modal = document.getElementById('connectionModal');
            if (modal) {
                modal.classList.toggle('collapsed');
                const header = modal.querySelector('.collapsed-header');
                if (header) {
                    const isCollapsed = modal.classList.contains('collapsed');
                    header.setAttribute('aria-expanded', !isCollapsed);
                }
            }
        }

        const toggleBtn = document.getElementById('modalToggleBtn');
        const toggleBtn2 = document.getElementById('modalToggleBtn2');
        const collapsedHeader = document.querySelector('.collapsed-header');

        if (toggleBtn) toggleBtn.addEventListener('click', toggleModal);
        if (toggleBtn2) toggleBtn2.addEventListener('click', toggleModal);
        if (collapsedHeader) {
            collapsedHeader.addEventListener('click', (e) => {
                // Don't toggle if clicking on input or button
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                    toggleModal();
                }
            });
        }

        // Public API for hiding modal after connection
        window.ConnectionModal = {
            hide: function() {
                const modal = document.getElementById('connectionModal');
                if (modal) {
                    modal.classList.remove('active');
                    modal.classList.remove('collapsed');
                    console.log('[ConnectionModal] Hidden');
                }
                if (onHideModal) onHideModal();
            },
            show: function() {
                const modal = document.getElementById('connectionModal');
                if (modal) {
                    modal.classList.add('active');
                    console.log('[ConnectionModal] Shown');
                }
            },
            collapse: function() {
                const modal = document.getElementById('connectionModal');
                if (modal) {
                    modal.classList.add('collapsed');
                    console.log('[ConnectionModal] Collapsed');
                }
            },
            expand: function() {
                const modal = document.getElementById('connectionModal');
                if (modal) {
                    modal.classList.remove('collapsed');
                    console.log('[ConnectionModal] Expanded');
                }
            }
        };

        console.log('[ConnectionModal] Initialized with prefix:', localStoragePrefix);
    };

    // Password visibility toggle (global function)
    window.togglePasswordVisibility = function() {
        const pwInput = document.getElementById('passwordInput');
        const icon = document.getElementById('passwordToggleIcon');
        const btn = document.getElementById('togglePasswordBtn');
        if (pwInput && icon && btn) {
            if (pwInput.type === 'password') {
                pwInput.type = 'text';
                icon.textContent = '🙈';
                btn.setAttribute('aria-label', 'Hide password');
                btn.setAttribute('title', 'Hide password');
            } else {
                pwInput.type = 'password';
                icon.textContent = '👁️';
                btn.setAttribute('aria-label', 'Show password');
                btn.setAttribute('title', 'Show password');
            }
        }
    };

})(window);
