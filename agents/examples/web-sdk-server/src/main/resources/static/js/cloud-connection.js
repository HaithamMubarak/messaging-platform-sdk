/**
 * Cloud Connection UI Component
 * Pure UI logic - manages DOM elements, status updates, and agent list rendering
 * Data interaction is handled by TerminalShareManager/TerminalSharing (like games)
 *
 * Similar to connection-modal.js pattern - UI only, no data logic
 *
 * Dependencies:
 * - terminal-sharing.js (TerminalShareManager - handles all data/messaging)
 *
 * Usage:
 * <script src="../js/UserConnectionBase.js"></script>
 * <script src="../apps/terminal/terminal-sharing.js"></script>
 * <script src="../js/cloud-connection.js"></script>
 *
 * Version: 3.0 - Pure UI component
 * Date: February 20, 2026
 */

(function(window) {
    'use strict';

    /**
     * CloudConnectionUI - Pure UI component for cloud connection panel
     * Like connection-modal.js, this only handles DOM and user interactions
     */
    window.CloudConnectionUI = {
        /**
         * Initialize cloud connection panel
         * @param {Object} options - Configuration
         * @param {string} options.panelId - Cloud panel element ID
         * @param {string} options.statusDotId - Status dot element ID
         * @param {string} options.statusTextId - Status text element ID
         * @param {string} options.agentListId - Agent list container ID
         * @param {string} options.connectBtnId - Connect button ID
         * @param {string} options.channelNameId - Channel name input ID
         * @param {string} options.channelPasswordId - Channel password input ID
         * @param {string} options.agentNameId - Agent name input ID
         * @param {Function} options.onConnect - Called when user clicks connect
         * @param {Function} options.onDisconnect - Called when user clicks disconnect
         */
        init: function(options) {
            this.options = options;
            this.setupEventListeners();
        },

        /**
         * Setup event listeners for UI elements
         */
        setupEventListeners: function() {
            const connectBtn = document.getElementById(this.options.connectBtnId);
            if (connectBtn) {
                connectBtn.addEventListener('click', () => {
                    if (this.options.onConnect) {
                        this.options.onConnect();
                    }
                });
            }
        },

        /**
         * Update status indicator
         * @param {string} status - 'online', 'offline', 'checking'
         * @param {string} text - Status text to display
         */
        updateStatus: function(status, text) {
            const dot = document.getElementById(this.options.statusDotId);
            const statusText = document.getElementById(this.options.statusTextId);

            if (dot) {
                dot.className = 'status-dot ' + status;
            }

            if (statusText) {
                statusText.textContent = text;
            }
        },

        /**
         * Update agents list in UI
         * @param {Array} agents - Array of agent objects
         * @param {string} currentAgent - Current agent name (to filter out)
         */
        updateAgentsList: function(agents, currentAgent) {
            const list = document.getElementById(this.options.agentListId);
            if (!list) return;

            // Filter out self
            const otherAgents = agents.filter(a => a.agentName !== currentAgent);

            if (otherAgents.length === 0) {
                list.innerHTML = '<div class="cloud-agent-item">No other agents connected</div>';
                return;
            }

            list.innerHTML = otherAgents.map(agent => `
                <div class="cloud-agent-item">
                    <div class="cloud-agent-dot"></div>
                    <span>${this.escapeHtml(agent.agentName)}</span>
                </div>
            `).join('');
        },

        /**
         * Update shared sessions list in UI
         * @param {Array} sessions - Array of shared session objects
         */
        updateSharedSessionsList: function(sessions) {
            const list = document.getElementById(this.options.agentListId);
            if (!list) return;

            if (sessions.length === 0) return;

            let html = '';
            sessions.forEach(session => {
                const icon = session.shell === 'bash' ? '🐧' : '🖥️';
                html += `
                    <div class="cloud-agent-item">
                        <div class="cloud-agent-dot" style="background: var(--accent-cyan);"></div>
                        <span>${icon} ${this.escapeHtml(session.name)} (${this.escapeHtml(session.owner)})</span>
                    </div>
                `;
            });

            list.innerHTML += html;
        },

        /**
         * Show connecting state
         */
        showConnecting: function() {
            const connectBtn = document.getElementById(this.options.connectBtnId);
            if (connectBtn) {
                connectBtn.disabled = true;
                connectBtn.textContent = 'Connecting...';
            }
            this.updateStatus('checking', 'Connecting...');
        },

        /**
         * Show connected state
         * @param {string} agentName - Connected agent name
         */
        showConnected: function(agentName) {
            const connectBtn = document.getElementById(this.options.connectBtnId);
            if (connectBtn) {
                connectBtn.textContent = 'Disconnect';
                connectBtn.classList.add('disconnect');
                connectBtn.disabled = false;
            }

            this.updateStatus('online', 'Connected');
            this.setInputsEnabled(false);
        },

        /**
         * Show disconnected state
         */
        showDisconnected: function() {
            const connectBtn = document.getElementById(this.options.connectBtnId);
            if (connectBtn) {
                connectBtn.textContent = 'Connect to Cloud';
                connectBtn.classList.remove('disconnect');
                connectBtn.disabled = false;
            }

            this.updateStatus('offline', 'Disconnected');
            this.setInputsEnabled(true);
            this.updateAgentsList([], null);
        },

        /**
         * Enable/disable input fields
         * @param {boolean} enabled - True to enable, false to disable
         */
        setInputsEnabled: function(enabled) {
            const channelName = document.getElementById(this.options.channelNameId);
            const channelPassword = document.getElementById(this.options.channelPasswordId);
            const agentName = document.getElementById(this.options.agentNameId);

            if (channelName) channelName.disabled = !enabled;
            if (channelPassword) channelPassword.disabled = !enabled;
            if (agentName) agentName.disabled = !enabled;
        },

        /**
         * Get connection config from inputs
         * @returns {Object} { channelName, channelPassword, agentName }
         */
        getConnectionConfig: function() {
            return {
                channelName: document.getElementById(this.options.channelNameId)?.value.trim() || '',
                channelPassword: document.getElementById(this.options.channelPasswordId)?.value.trim() || '',
                agentName: document.getElementById(this.options.agentNameId)?.value.trim() || ''
            };
        },

        /**
         * Set agent name in input
         * @param {string} agentName - Agent name to set
         */
        setAgentName: function(agentName) {
            const input = document.getElementById(this.options.agentNameId);
            if (input) {
                input.value = agentName;
            }
        },

        /**
         * Toggle cloud panel visibility
         */
        togglePanel: function() {
            const panel = document.getElementById(this.options.panelId);
            if (panel) {
                panel.classList.toggle('expanded');
            }
        },

        /**
         * Escape HTML to prevent XSS
         */
        escapeHtml: function(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        /**
         * Generate random agent name
         */
        generateAgentName: function() {
            const adjectives = ['swift', 'bright', 'cool', 'dark', 'fast', 'blue', 'red', 'green', 'brave', 'wise', 'bold', 'calm'];
            const nouns = ['hawk', 'wolf', 'eagle', 'lion', 'tiger', 'bear', 'fox', 'owl', 'shark', 'dragon', 'phoenix', 'falcon'];
            const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
            const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
            const randomNum = Math.floor(Math.random() * 100);
            return `${randomAdj}-${randomNoun}-${randomNum}`;
        }
    };

})(window);

