/**
 * Share Modal - Reusable Component
 *
 * Provides functionality for sharing channel connections via public or encrypted links.
 * Can be used across multiple pages (chat, WebRTC, etc.)
 *
 * Dependencies:
 * - QRCode library (qrcode.min.js) for QR code generation
 * - Channel auth encoding/decoding functions
 *
 * Usage:
 * 1. Include this script in your HTML
 * 2. Include share-modal.css for styling
 * 3. Add the share modal HTML structure to your page
 * 4. Call ShareModal.show(channelName, channelPassword, apiKey) to display
 */

(function(window) {
    'use strict';

    // ===== Encryption Helper Functions =====

    // Encoding/decoding functions are in common-utils.js
    // Use ChannelAuthUtils.encode(), ChannelAuthUtils.decode(), etc.
    // Or use global functions: encodeChannelAuth(), decodeChannelAuth(), etc.

    // ===== Share Modal Component =====

    const ShareModal = {
        // Initialize the share modal (call once on page load)
        init: function() {
            this._wireEventListeners();
            this._checkForSharedLink();
        },

        // Show the share modal with channel details
        show: function(channelName, channelPassword, apiKey) {
            const modal = document.getElementById('share-modal');
            const publicBtn = document.getElementById('share-public-btn');
            const encryptedBtn = document.getElementById('share-encrypted-btn');
            const linkContainer = document.getElementById('share-link-container');
            const linkOutput = document.getElementById('share-link-output');
            const linkLabel = document.getElementById('share-link-label');
            const copyBtn = document.getElementById('share-copy-btn');
            const closeBtn = document.getElementById('share-close');
            const encryptionInfo = document.getElementById('share-encryption-info');
            const keyDisplay = document.getElementById('share-key-display');
            const keyInputContainer = document.getElementById('share-encryption-key-input');
            const keyInput = document.getElementById('share-key-input');
            const qrBtn = document.getElementById('share-qr-btn');
            const qrContainer = document.getElementById('share-qr-container');

            if (!modal) {
                console.error('Share modal not found in DOM');
                return;
            }

            // Reset state
            linkContainer.style.display = 'none';
            encryptionInfo.style.display = 'none';
            keyInputContainer.style.display = 'none';
            if (qrContainer) qrContainer.style.display = 'none';

            // Generate unique agent name for encryption key input
            if (keyInput) {
                keyInput.value = this._generateUniqueAgentName();
            }

            // Show modal (use flex for centering)
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');

            // Public link handler
            publicBtn.onclick = () => {
                keyInputContainer.style.display = 'none';

                const encoded = this._encodeChannelAuth(channelName, channelPassword, apiKey);
                if (!encoded) {
                    this._showToast('Failed to generate share link', 'error');
                    return;
                }

                // Add channel name as descriptive hashtag (for display only, not parsed)
                const channelHashtag = this._sanitizeChannelNameForUrl(channelName);
                const shareUrl = window.location.origin + window.location.pathname + '#' + encoded + '#' + channelHashtag;
                linkOutput.value = shareUrl;
                linkLabel.textContent = '📋 Public Share Link';
                linkContainer.style.display = 'block';
                encryptionInfo.style.display = 'none';
            };

            // Function to generate encrypted link
            const generateEncryptedLink = () => {
                const agentName = keyInput?.value?.trim();

                if (!agentName) {
                    this._showToast('Encryption key (agent name) is required', 'error');
                    keyInput.focus();
                    return;
                }

                // Check if agent name conflicts with active agents
                const activeAgents = this._getActiveAgents();
                if (activeAgents.includes(agentName)) {
                    this._showToast('This agent name is already active. Please choose another.', 'error');
                    keyInput.focus();
                    keyInput.select();
                    return;
                }

                const encoded = this._encodeChannelAuthEncrypted(channelName, channelPassword, apiKey, agentName);
                if (!encoded) {
                    this._showToast('Failed to encrypt share link', 'error');
                    return;
                }

                // Add channel name as descriptive hashtag (before #encrypted marker)
                const channelHashtag = this._sanitizeChannelNameForUrl(channelName);
                const shareUrl = window.location.origin + window.location.pathname + '#' + encoded + '#' + channelHashtag + '#encrypted';
                linkOutput.value = shareUrl;
                linkLabel.textContent = '🔐 Encrypted Share Link';
                linkContainer.style.display = 'block';
                encryptionInfo.style.display = 'block';
                keyDisplay.textContent = agentName;

                // Reset button text
                this._resetEncryptedButton();
            };

            // Encrypted link handler
            encryptedBtn.onclick = () => {
                if (keyInputContainer.style.display === 'none') {
                    keyInputContainer.style.display = 'block';
                    linkContainer.style.display = 'none';

                    setTimeout(() => {
                        keyInput.focus();
                        keyInput.select();

                        if (keyInput.value.trim().length > 0) {
                            this._updateEncryptedButton('confirm');
                        }
                    }, 100);
                    return;
                }

                generateEncryptedLink();
            };

            // Add input listener to show checkmark when key is entered
            if (keyInput) {
                keyInput.addEventListener('input', () => {
                    const hasValue = keyInput.value.trim().length > 0;
                    if (hasValue && keyInputContainer.style.display !== 'none') {
                        this._updateEncryptedButton('confirm');
                    } else {
                        this._resetEncryptedButton();
                    }
                });

                keyInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        generateEncryptedLink();
                    }
                });
            }

            // Copy button handler
            copyBtn.onclick = () => {
                const url = linkOutput.value;
                const isEncrypted = url.includes('#encrypted');
                this._copyToClipboard(url, isEncrypted);
            };

            // QR Code button handler
            let qrCodeInstance = null;
            if (qrBtn) {
                qrBtn.onclick = () => {
                    const url = linkOutput.value;
                    if (!url) {
                        this._showToast('Generate a link first', 'error');
                        return;
                    }

                    if (qrContainer.style.display === 'none') {
                        this._generateQRCode(url, qrContainer);
                    } else {
                        qrContainer.style.display = 'none';
                    }
                };
            }

            // Close button
            closeBtn.onclick = () => this.hide();

            // Click output to select all
            linkOutput.onclick = () => {
                linkOutput.select();
            };

            // Automatically generate and show public link on modal open
            const encoded = this._encodeChannelAuth(channelName, channelPassword, apiKey);
            if (encoded) {
                const channelHashtag = this._sanitizeChannelNameForUrl(channelName);
                const shareUrl = window.location.origin + window.location.pathname + '#' + encoded + '#' + channelHashtag;
                linkOutput.value = shareUrl;
                linkLabel.textContent = '📋 Public Share Link';
                linkContainer.style.display = 'block';
                encryptionInfo.style.display = 'none';
            }

            // Escape key to close modal
            const handleEscapeKey = (e) => {
                if (e.key === 'Escape' && modal.style.display === 'flex') {
                    this.hide();
                }
            };
            document.addEventListener('keydown', handleEscapeKey);
        },

        // Hide the share modal
        hide: function() {
            const modal = document.getElementById('share-modal');
            const qrContainer = document.getElementById('share-qr-container');
            const encryptedBtn = document.getElementById('share-encrypted-btn');

            if (modal) {
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
            }

            if (qrContainer) {
                qrContainer.style.display = 'none';
            }

            this._resetEncryptedButton();
        },

        // Process incoming shared link from URL hash
        processSharedLink: function(onConnect) {
            try {
                const hash = window.location.hash;
                if (!hash || hash.length <= 1) return;

                const { encoded, isEncrypted } = this._parseChannelHash(hash);

                if (!encoded) {
                    console.warn('Invalid share link');
                    return;
                }

                if (isEncrypted) {
                    this._showDecryptionModal(encoded, onConnect);
                } else {
                    this._processShareLink(encoded, null, onConnect);
                }
            } catch (e) {
                console.error('Share link processing error:', e);
            }
        },

        // Private methods
        _wireEventListeners: function() {
            // Can be extended for global listeners
        },

        _checkForSharedLink: function() {
            // Auto-check on init if needed
        },

        _parseChannelHash: function(hash) {
            const parts = hash.substring(1).split('#');
            return {
                encoded: parts[0],
                isEncrypted: parts.length > 1 && parts[parts.length - 1] === 'encrypted'
            };
        },

        _sanitizeChannelNameForUrl: function(channelName) {
            if (!channelName) return 'channel';

            // Remove special characters, replace spaces with dashes, make URL-safe
            return channelName
                .trim()
                .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special chars except spaces and dashes
                .replace(/\s+/g, '-') // Replace spaces with dashes
                .replace(/-+/g, '-') // Replace multiple dashes with single dash
                .replace(/^-|-$/g, '') // Remove leading/trailing dashes
                .toLowerCase()
                .substring(0, 50) // Limit length
                || 'channel'; // Fallback if empty after sanitization
        },

        _encodeChannelAuth: function(channelName, channelPassword, apiKey) {
            if (typeof window.encodeChannelAuth === 'function') {
                return window.encodeChannelAuth(channelName, channelPassword, apiKey);
            }
            console.error('encodeChannelAuth function not found');
            return null;
        },

        _encodeChannelAuthEncrypted: function(channelName, channelPassword, apiKey, agentName) {
            if (typeof window.encodeChannelAuthEncrypted === 'function') {
                return window.encodeChannelAuthEncrypted(channelName, channelPassword, apiKey, agentName);
            }
            console.error('encodeChannelAuthEncrypted function not found');
            return null;
        },

        _decodeChannelAuth: function(encoded) {
            if (typeof window.decodeChannelAuth === 'function') {
                return window.decodeChannelAuth(encoded);
            }
            console.error('decodeChannelAuth function not found');
            return null;
        },

        _decodeChannelAuthEncrypted: function(encoded, agentName) {
            if (typeof window.decodeChannelAuthEncrypted === 'function') {
                return window.decodeChannelAuthEncrypted(encoded, agentName);
            }
            console.error('decodeChannelAuthEncrypted function not found');
            return null;
        },

        _generateUniqueAgentName: function() {
            if (typeof window.generateRandomAgentName === 'function') {
                const activeAgents = this._getActiveAgents();
                let attempts = 0;
                let name;

                do {
                    name = window.generateRandomAgentName();
                    attempts++;
                } while (activeAgents.includes(name) && attempts < 50);

                if (activeAgents.includes(name)) {
                    name = name + Date.now().toString().slice(-4);
                }

                return name;
            }
            return 'agent-' + Math.random().toString(36).substring(2, 9);
        },

        _getActiveAgents: function() {
            if (window.channel && window.channel._connectedAgentsMap) {
                return Object.keys(window.channel._connectedAgentsMap || {});
            }
            return [];
        },

        _updateEncryptedButton: function(state) {
            const encryptedBtn = document.getElementById('share-encrypted-btn');
            if (!encryptedBtn) return;

            if (state === 'confirm') {
                encryptedBtn.innerHTML = `
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    Confirm & Generate
                `;
                encryptedBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            }
        },

        _resetEncryptedButton: function() {
            const encryptedBtn = document.getElementById('share-encrypted-btn');
            if (!encryptedBtn) return;

            encryptedBtn.innerHTML = `
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
                Encrypted Link
            `;
            encryptedBtn.style.background = '';
        },

        _copyToClipboard: function(text, isEncrypted) {
            const copyBtn = document.getElementById('share-copy-btn');

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    this._showToast(isEncrypted ? '🔐 Encrypted link copied!' : '📋 Link copied!', 'success');
                    if (copyBtn) {
                        copyBtn.textContent = 'Copied!';
                        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
                    }
                }).catch(() => {
                    this._fallbackCopyToClipboard(text, isEncrypted);
                });
            } else {
                this._fallbackCopyToClipboard(text, isEncrypted);
            }
        },

        _fallbackCopyToClipboard: function(text, isEncrypted) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                this._showToast(isEncrypted ? '🔐 Encrypted link copied!' : '📋 Link copied!', 'success');
            } catch (err) {
                console.error('Fallback copy failed:', err);
                this._showToast('Could not copy link', 'error');
            }
            document.body.removeChild(textArea);
        },

        _generateQRCode: function(url, container) {
            try {
                if (typeof QRCode === 'undefined') {
                    console.error('QRCode library not loaded');
                    this._showToast('QR code library not loaded', 'error');
                    return;
                }

                const qrDisplay = document.getElementById('share-qr-display');
                if (!qrDisplay) {
                    console.error('QR display element not found');
                    this._showToast('QR display element not found', 'error');
                    return;
                }

                // Clear previous QR code
                qrDisplay.innerHTML = '';

                // Create new QR code
                new QRCode(qrDisplay, {
                    text: url,
                    width: 256,
                    height: 256,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.L
                });

                container.style.display = 'block';
                this._showToast('📱 QR code generated!', 'success');
            } catch (e) {
                console.error('QR generation error:', e);
                this._showToast('Failed to generate QR code: ' + e.message, 'error');
            }
        },

        _showDecryptionModal: function(encoded, onConnect) {
            const modal = document.getElementById('decrypt-modal');
            const input = document.getElementById('decrypt-agent-name');
            const confirmBtn = document.getElementById('decrypt-confirm');
            const cancelBtn = document.getElementById('decrypt-cancel');

            if (!modal || !input || !confirmBtn || !cancelBtn) return;

            // Generate unique agent name
            input.value = this._generateUniqueAgentName();

            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');

            setTimeout(() => {
                input.focus();
                input.select();
            }, 100);

            const closeModal = () => {
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
                // Don't clear hash - keep the share URL intact
                // history.replaceState(null, null, ' ');
            };

            cancelBtn.onclick = () => {
                closeModal();
                this._addEvent('Encrypted link decryption cancelled', 'disconnected');
            };

            confirmBtn.onclick = () => {
                const agentName = input.value.trim();
                if (!agentName) {
                    this._showToast('Agent name is required', 'error');
                    return;
                }

                const activeAgents = this._getActiveAgents();
                if (activeAgents.includes(agentName)) {
                    this._showToast('Agent name already in use. Please choose another.', 'error');
                    return;
                }

                closeModal();
                this._processShareLink(encoded, agentName, onConnect);
            };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmBtn.click();
                }
            };

            modal.onkeydown = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelBtn.click();
                }
            };
        },

        _processShareLink: function(encoded, agentName, onConnect) {
            try {
                let auth;

                if (agentName) {
                    auth = this._decodeChannelAuthEncrypted(encoded, agentName);
                    if (!auth) {
                        this._showToast('Failed to decrypt. Wrong agent name?', 'error');
                        this._addEvent('Decryption failed - incorrect agent name', 'disconnected');
                        return;
                    }
                    this._addEvent('Share link decrypted successfully', 'connected');
                } else {
                    // Try decoding using multiple strategies to be tolerant of URL-encoding or URL-safe base64
                    auth = this._decodeChannelAuth(encoded);
                    if (!auth) {
                        // try decodeURIComponent
                        try { auth = this._decodeChannelAuth(decodeURIComponent(encoded)); } catch(e) { auth = null; }
                    }
                    if (!auth) {
                        // try URL-safe base64 variant
                        try {
                            let alt = encoded.replace(/-/g, '+').replace(/_/g, '/');
                            // pad with '=' to length multiple of 4
                            while (alt.length % 4 !== 0) alt += '=';
                            auth = this._decodeChannelAuth(alt);
                        } catch (e) { auth = null; }
                    }
                    if (!auth) {
                        this._showToast('Invalid share link', 'error');
                        // Try to show what the raw decoded payload looks like for debugging
                        try {
                            const raw = atob(encoded);
                            console.warn('ShareModal: atob(decoded) ->', raw);
                        } catch (e) {
                            // ignore
                        }
                        console.warn('ShareModal: failed to decode encoded payload. Tried plain, decodeURIComponent, and URL-safe variants. Encoded fragment:', encoded);
                        return;
                    }
                }

                // Relaxed validation: accept links without an embedded API key (auth.k). The client will request a temporary API key at connect time if needed.
                // Accept alternative password keys if present
                if (!auth.p) {
                    if (auth.password) auth.p = auth.password;
                    else if (auth.pw) auth.p = auth.pw;
                    else if (auth.pass) auth.p = auth.pass;
                }

                if (!auth.c || !auth.p) {
                    console.warn('Invalid share link data - missing channel or password', auth);
                    this._showToast('Invalid share link data (missing channel or password)', 'error');
                    return;
                }

                if (!auth.k) {
                    console.info('Share link contains no API key; client will request a temporary API key at connect time.');
                }

                console.log('Share link detected, auto-filling connection details...');

                // Call the onConnect callback with the decoded auth data
                if (typeof onConnect === 'function') {
                    onConnect(auth, agentName);
                }

                // Apply visual highlight to readonly channel/password inputs if present
                try {
                    this._applyReadonlyHighlight();
                } catch (e) { /* non-fatal */ }

                // If MiniGameUtils is present, let it start any configured auto-connect behavior
                try { if (window.MiniGameUtils && typeof window.MiniGameUtils._startAutoConnectIfConfigured === 'function') { window.MiniGameUtils._startAutoConnectIfConfigured(); } } catch (e) { /* ignore */ }

                // Don't clear hash from URL - keep the share URL intact
                // history.replaceState(null, null, ' ');
            } catch (e) {
                console.error('Share link processing error:', e);
                this._showToast('Failed to process share link', 'error');
            }
        },

        _showToast: function(msg, type) {
            if (typeof window.showToast === 'function') {
                window.showToast(msg, type);
            } else {
                console.log('[Toast] ' + msg);
            }
        },

        // Add a small helper to mark readonly channel/password inputs so they're visually distinct
        _applyReadonlyHighlight: function() {
            try {
                const ids = ['channelInput', 'channel', 'room', 'passwordInput', 'password', 'pw'];
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && (el.readOnly || el.hasAttribute('readonly'))) {
                        el.classList.add('readonly-highlight');
                        // also add wrapper class if parent available
                        if (el.parentElement) el.parentElement.classList.add('readonly-wrapper');
                        el.title = el.title || 'This value was supplied by a shared link';

                    }
                });

                // Generic selector: any input marked readonly that looks like channel/password
                const inputs = Array.from(document.querySelectorAll('input[readonly], input[readonly="readonly"]'));
                inputs.forEach(inp => {
                    const name = (inp.id || inp.name || '').toLowerCase();
                    if (name.includes('chan') || name.includes('room') || name.includes('channel') || name.includes('pass') || name.includes('pw')) {
                        inp.classList.add('readonly-highlight');
                        if (inp.parentElement) inp.parentElement.classList.add('readonly-wrapper');
                        inp.title = inp.title || 'This value was supplied by a shared link';
                      }
                });
            } catch (e) { console.warn('applyReadonlyHighlight failed', e); }
        },

        /**
         * Update the current URL with auth credentials in the hash
         * @param {Object} auth - {channel, password}
         */
        updateUrlWithAuth: function(auth) {
            if (!auth || !auth.channel || !auth.password) {
                console.warn('[ShareModal] updateUrlWithAuth: Missing channel or password');
                return;
            }

            try {
                // Create auth object with channel and password
                const authData = {
                    c: auth.channel,
                    p: auth.password
                };

                // Encode to base64
                const authStr = JSON.stringify(authData);
                const authEncoded = btoa(authStr);

                // Update URL hash
                const newHash = '#' + authEncoded;
                window.history.replaceState(null, '', window.location.pathname + window.location.search + newHash);

                console.log('[ShareModal] URL hash updated with connection credentials');
            } catch (e) {
                console.error('[ShareModal] Failed to update URL hash:', e);
            }
        },

    };

    // Export to global scope
    window.ShareModal = ShareModal;

})(window);

/* Inject the shared Share Modal DOM if it's not already present */
(function() {
    function createShareModal() {
        if (document.getElementById('share-modal')) return; // already present

        var wrapper = document.createElement('div');
        wrapper.innerHTML = `
<div id="share-modal" class="modal" aria-hidden="true" role="dialog" aria-labelledby="share-title">
    <div class="modal-content" style="max-width:520px;">
        <div class="modal-body">
            <h3 id="share-title" style="margin-top:0;">🔗 Share Channel</h3>
            <div style="margin-bottom:16px;">
                <p style="margin:8px 0;color:var(--muted);font-size:13px;">
                    📱 Share with other devices or invite friends to collaborate!
                </p>

                <!-- Encryption Key Input (shown when encrypted option selected) -->
                <div id="share-encryption-key-input" style="display:none;margin-top:16px;">
                    <div class="form-row">
                        <label for="share-key-input">Encryption Key (Agent Name)</label>
                        <input id="share-key-input" type="text" placeholder="Agent name for encryption" style="font-weight:600;"/>
                        <div class="small" style="color:var(--muted);margin-top:4px;">
                            💡 A unique key has been generated. You can edit it if needed. Press Enter or click "Encrypted Link" again to confirm.
                        </div>
                    </div>
                </div>

                <div style="display:flex;gap:12px;margin:16px 0;">
                    <button id="share-public-btn" class="btn" style="flex:1;display:none;align-items:center;justify-content:center;gap:6px;padding:12px;">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        Public Link
                    </button>
                    <button id="share-encrypted-btn" class="btn primary" style="flex:1;display:none;align-items:center;justify-content:center;gap:6px;padding:12px;">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                        </svg>
                        Encrypted Link
                    </button>
                </div>

                <div id="share-link-container" style="display:none;margin-top:16px;">
                    <div class="form-row">
                        <label for="share-link-output" id="share-link-label">Share Link</label>
                        <div style="display:flex;gap:8px;">
                            <input id="share-link-output" type="text" readonly style="flex:1;font-size:11px;font-family:monospace;padding:8px 12px;"/>
                            <button id="share-copy-btn" class="btn primary" style="padding:8px 16px;">Copy</button>
                            <button id="share-qr-btn" class="btn ghost" style="padding:8px 16px;" title="Generate QR Code">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- QR Code Display -->
                    <div id="share-qr-container" style="display:none;margin-top:16px;text-align:center;">
                        <div style="padding:16px;background:white;border-radius:8px;display:inline-block;">
                            <div id="share-qr-display"></div>
                        </div>
                        <div style="margin-top:8px;font-size:12px;color:var(--muted);">
                            📱 Scan with mobile device to open link
                        </div>
                    </div>

                    <div id="share-encryption-info" style="display:none;margin-top:8px;padding:8px;background:rgba(79,70,229,0.1);border-radius:6px;font-size:12px;color:var(--muted);">
                        🔐 <strong style="color:#e6eef8;">Encryption Key:</strong> <span id="share-key-display"></span>
                        <br/>Share this agent name with the recipient to decrypt the link.
                    </div>
                </div>
            </div>
            <div class="footer" style="margin-top:12px;">
                <div style="display:flex;gap:8px;justify-content:flex-end;width:100%">
                    <button id="share-close" class="btn ghost close-btn">Close</button>
                </div>
            </div>
        </div>
    </div>
</div>
`;
        document.body.appendChild(wrapper.firstElementChild);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createShareModal);
    } else {
        createShareModal();
    }
})();
