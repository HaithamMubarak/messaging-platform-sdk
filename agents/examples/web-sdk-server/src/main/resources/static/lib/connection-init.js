/**
 * Common Connection Initialization
 *
 * Loads the unified connection modal and handles auto-connect from URL parameters.
 * This file should be included in all demo pages to provide consistent connection behavior.
 *
 * Usage:
 *   1. Include this script after web-agent.js
 *   2. Define initializeConnection() callback with your page-specific logic
 *   3. Optionally define cleanupConnection() for disconnect handling
 *
 * Example:
 *   <script src="../lib/web-agent.js"></script>
 *   <script src="../lib/connection-init.js"></script>
 *   <script>
 *     function initializeConnection(agent, info) {
 *       console.log('Connected!', info);
 *       // Your page-specific initialization
 *     }
 *
 *     function cleanupConnection() {
 *       // Your page-specific cleanup
 *     }
 *   </script>
 */

(function() {
    'use strict';

    console.log('[ConnectionInit] Loading unified connection modal...');

    // Load unified connection modal
    fetch('/components/connection-modal.html')
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch connection modal: ' + response.status);
            }
            return response.text();
        })
        .then(html => {
            // Create a temporary container to parse HTML
            const temp = document.createElement('div');
            temp.innerHTML = html;

            // Extract and insert non-script content
            const scripts = temp.querySelectorAll('script');
            const nonScriptContent = temp.innerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
            document.body.insertAdjacentHTML('beforeend', nonScriptContent);

            // Execute scripts manually (insertAdjacentHTML doesn't execute scripts)
            scripts.forEach(script => {
                const newScript = document.createElement('script');
                if (script.src) {
                    newScript.src = script.src;
                } else {
                    newScript.textContent = script.textContent;
                }
                document.body.appendChild(newScript);
            });

            // Wait a moment for scripts to execute
            return new Promise(resolve => setTimeout(resolve, 100));
        })
        .then(() => {
            // Check if ConnectionModal is defined
            if (typeof ConnectionModal === 'undefined') {
                throw new Error('ConnectionModal not defined after loading');
            }

            console.log('[ConnectionInit] Connection modal loaded successfully');

            // Set up connection callback
            ConnectionModal.onConnect = function(connectedAgent, info) {
                console.log('[ConnectionInit] Connected as ' + info.agentName + ' to channel: ' + info.channelName);

                // Call page-specific initialization if defined
                if (typeof window.initializeConnection === 'function') {
                    try {
                        window.initializeConnection(connectedAgent, info);
                    } catch (error) {
                        console.error('[ConnectionInit] Error in initializeConnection:', error);
                    }
                } else {
                    console.warn('[ConnectionInit] No initializeConnection() function defined. Define window.initializeConnection = function(agent, info) { ... } in your page.');
                }
            };

            // Set up disconnect callback
            ConnectionModal.onDisconnect = function() {
                console.log('[ConnectionInit] Disconnected from channel');

                // Call page-specific cleanup if defined
                if (typeof window.cleanupConnection === 'function') {
                    try {
                        window.cleanupConnection();
                    } catch (error) {
                        console.error('[ConnectionInit] Error in cleanupConnection:', error);
                    }
                }
            };

            console.log('[ConnectionInit] Callbacks configured. Ready for connection.');

            // Note: ConnectionModal component now handles URL params and auto-show/auto-connect internally
        })
        .catch(error => {
            console.error('[ConnectionInit] Failed to load connection modal:', error);

            // Show user-friendly error if possible
            if (typeof alert !== 'undefined') {
                alert('Failed to load connection interface. Please refresh the page.\n\nError: ' + error.message);
            }
        });

})();
