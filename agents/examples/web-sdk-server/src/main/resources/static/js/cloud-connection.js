ad/**
 * Messaging Platform Cloud Connection Component
 * Reusable JavaScript for cloud connectivity
 *
 * Dependencies:
 * - config-loader.js (for API key fetching)
 * - web-agent.js (AgentConnection)
 *
 * Usage:
 * <script src="../js/cloud-connection.js"></script>
 *
 * Version: 1.0
 * Date: February 14, 2026
 */

(function(window) {
    'use strict';

    /**
     * Cloud Connection Manager
     * Handles connection to Messaging Platform cloud via channels
     */
    class CloudConnectionManager {
        constructor(options = {}) {
            this.options = {
                onConnect: options.onConnect || null,
                onDisconnect: options.onDisconnect || null,
                onAgentConnected: options.onAgentConnected || null,
                onAgentDisconnected: options.onAgentDisconnected || null,
                onMessage: options.onMessage || null,
                onError: options.onError || null,
                statusDotId: options.statusDotId || 'cloudStatus',
                statusTextId: options.statusTextId || 'cloudStatusText',
                agentListId: options.agentListId || 'cloudAgentsList',
                messagingApiUrl: options.messagingApiUrl || 'https://hmdevonline.com/messaging-platform/api/v1/messaging-service'
            };

            this.channel = null;
            this.connected = false;
            this.agentName = null;
            this.connectedAgents = new Map();
        }

        /**
         * Generate random agent name
         * @returns {string} Generated name like "swift-hawk-42"
         */
        generateAgentName() {
            const adjectives = ['swift', 'bright', 'cool', 'dark', 'fast', 'blue', 'red', 'green', 'brave', 'wise', 'bold', 'calm'];
            const nouns = ['hawk', 'wolf', 'eagle', 'lion', 'tiger', 'bear', 'fox', 'owl', 'shark', 'dragon', 'phoenix', 'falcon'];
            const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
            const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
            const randomNum = Math.floor(Math.random() * 100);

            return `${randomAdj}-${randomNoun}-${randomNum}`;
        }

        /**
         * Update status indicator
         * @param {string} status - 'online', 'offline', 'checking'
         * @param {string} text - Status text to display
         */
        updateStatus(status, text) {
            const dot = document.getElementById(this.options.statusDotId);
            const statusText = document.getElementById(this.options.statusTextId);

            if (dot) {
                dot.className = 'status-dot ' + status;
            }

            if (statusText) {
                statusText.textContent = text;
            }
        }

        /**
         * Update agents list in UI
         * @param {Array} agents - Array of agent objects
         */
        updateAgentsList(agents) {
            const list = document.getElementById(this.options.agentListId);
            if (!list) return;

            // Filter out self
            const otherAgents = agents.filter(a => a.agentName !== this.agentName);

            if (otherAgents.length === 0) {
                list.innerHTML = '<div style="color: var(--text-muted); font-size: 10px; padding: 4px;">No other agents connected</div>';
                return;
            }

            list.innerHTML = otherAgents.map(agent => `
                <div class="cloud-agent-item">
                    <div class="cloud-agent-dot"></div>
                    <span>${this.escapeHtml(agent.agentName)}</span>
                </div>
            `).join('');
        }

        /**
         * Escape HTML to prevent XSS
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        /**
         * Connect to cloud channel
         * @param {Object} config - Connection configuration
         * @param {string} config.channelName - Channel name
         * @param {string} config.channelPassword - Channel password
         * @param {string} config.agentName - Agent name (optional, auto-generated if empty)
         * @returns {Promise<void>}
         */
        async connect(config) {
            const { channelName, channelPassword } = config;
            let { agentName } = config;

            if (!channelName || !channelPassword) {
                throw new Error('Channel name and password are required');
            }

            // Auto-generate agent name if empty
            if (!agentName) {
                agentName = this.generateAgentName();
            }

            this.updateStatus('checking', 'Connecting...');

            try {
                // Get API key from config loader
                const appConfig = await window.fetchAppConfig(300, false, true);
                if (!appConfig || !appConfig.apiKey) {
                    throw new Error('Failed to get API key');
                }

                // Create channel connection
                this.channel = new AgentConnection();

                // Set up event handlers
                this.channel.addEventListener('connect', (event) => {
                    if (event.response && event.response.status === 'success') {
                        this.connected = true;
                        this.agentName = agentName;
                        this.updateStatus('online', 'Connected');

                        // Request agent list
                        this.channel.getConnectedAgents((response) => {
                            if (response.status === 'success' && response.data) {
                                response.data.forEach(agent => {
                                    this.connectedAgents.set(agent.agentName, agent);
                                });
                                this.updateAgentsList(response.data);
                            }
                        });

                        // Call user callback
                        if (this.options.onConnect) {
                            this.options.onConnect(agentName);
                        }
                    } else {
                        throw new Error(event.response?.statusMessage || 'Connection failed');
                    }
                });

                this.channel.addEventListener('agent-connected', (event) => {
                    const agent = event.data;
                    this.connectedAgents.set(agent.agentName, agent);
                    this.updateAgentsList(Array.from(this.connectedAgents.values()));

                    if (this.options.onAgentConnected) {
                        this.options.onAgentConnected(agent);
                    }
                });

                this.channel.addEventListener('agent-disconnected', (event) => {
                    const agent = event.data;
                    this.connectedAgents.delete(agent.agentName);
                    this.updateAgentsList(Array.from(this.connectedAgents.values()));

                    if (this.options.onAgentDisconnected) {
                        this.options.onAgentDisconnected(agent);
                    }
                });

                this.channel.addEventListener('message', (event) => {
                    if (this.options.onMessage) {
                        this.options.onMessage(event);
                    }
                });

                this.channel.addEventListener('disconnect', () => {
                    this.handleDisconnect();
                });

                this.channel.addEventListener('error', (event) => {
                    console.error('Cloud connection error:', event);
                    if (this.options.onError) {
                        this.options.onError(event);
                    }
                });

                // Connect
                this.channel.connect({
                    channelName: channelName,
                    channelPassword: channelPassword,
                    agentName: agentName,
                    api: appConfig.messagingApiUrl || this.options.messagingApiUrl,
                    apiKey: appConfig.apiKey,
                    apiKeyScope: 'public'
                });

                return agentName;

            } catch (error) {
                this.updateStatus('offline', 'Disconnected');
                throw error;
            }
        }

        /**
         * Disconnect from cloud
         */
        disconnect() {
            if (this.channel) {
                this.channel.disconnect();
            }
            this.handleDisconnect();
        }

        /**
         * Handle disconnection
         */
        handleDisconnect() {
            this.connected = false;
            this.channel = null;
            this.connectedAgents.clear();

            this.updateStatus('offline', 'Disconnected');
            this.updateAgentsList([]);

            if (this.options.onDisconnect) {
                this.options.onDisconnect();
            }
        }

        /**
         * Send message to channel (broadcast)
         * @param {Object} message - Message object
         */
        broadcastMessage(message) {
            if (!this.connected || !this.channel) {
                throw new Error('Not connected to cloud');
            }
            this.channel.broadcastMessage(message);
        }

        /**
         * Send message to specific agent
         * @param {string} targetAgent - Target agent name
         * @param {Object} message - Message object
         */
        sendMessageToAgent(targetAgent, message) {
            if (!this.connected || !this.channel) {
                throw new Error('Not connected to cloud');
            }
            this.channel.sendMessageToAgent(targetAgent, message);
        }

        /**
         * Check if connected
         * @returns {boolean}
         */
        isConnected() {
            return this.connected;
        }

        /**
         * Get agent name
         * @returns {string|null}
         */
        getAgentName() {
            return this.agentName;
        }

        /**
         * Get connected agents
         * @returns {Array}
         */
        getConnectedAgents() {
            return Array.from(this.connectedAgents.values());
        }
    }

    // Export to global scope
    window.CloudConnectionManager = CloudConnectionManager;

})(window);

