/**
 * Floating Collapsible Control Panel
 * Reusable component for all mini-games
 * Features: draggable, collapsible, pause/resume, share, settings
 * Singleton pattern - only one instance allowed
 */

// Singleton instance
let _controlPanelInstance = null;

class GameControlPanel {
    constructor(options = {}) {
        // Singleton: destroy existing instance if any
        if (_controlPanelInstance) {
            console.log('[ControlPanel] Destroying existing instance');
            _controlPanelInstance.destroy();
        }
        _controlPanelInstance = this;

        // Configuration
        this.config = {
            gameName: options.gameName || 'Game',
            gameIcon: options.gameIcon || '⚙️',  // Customizable game icon
            agentName: options.agentName || null, // Current player/agent name
            isHost: options.isHost || false,
            isPaused: options.isPaused || false,
            isPauseEnabled: options.isPauseEnabled !== false,  // Default true - pause is enabled
            roomCode: options.roomCode || null,
            roomPassword: options.roomPassword || null, // For share modal
            shareUrl: options.shareUrl || null,

            // Position options
            savePosition: options.savePosition !== false,  // Default true - save to localStorage
            defaultPosition: options.defaultPosition || null,  // Custom default position { x, y }

            // Optional features (disabled by default)
            showSound: options.showSound || false,
            showFullscreen: options.showFullscreen || false,
            showHelp: options.showHelp || false,
            showSettings: options.showSettings || false,
            startCollapsed: options.startCollapsed !== undefined ? options.startCollapsed : true,  // Default to collapsed

            // Custom buttons (array of button configs)
            customButtons: options.customButtons || [],

            // Callbacks
            onPauseToggle: options.onPauseToggle || null,
            onShare: options.onShare || null,
            onLeave: options.onLeave || null,
            onToggleSound: options.onToggleSound || null,
            onToggleFullscreen: options.onToggleFullscreen || null,
            onOpenHelp: options.onOpenHelp || null,
            onOpenSettings: options.onOpenSettings || null
        };

        // State
        this.isCollapsed = options.startCollapsed !== undefined ? options.startCollapsed : true;  // Default to collapsed
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.position = this.loadPosition();
        this.isSoundOn = true;
        this.isFullscreen = false;

        // Smooth dragging
        this.targetPosition = { ...this.position };
        this.currentPosition = { ...this.position };
        this.animationFrame = null;

        // Create UI
        this.createPanel();
        this.attachEventListeners();
        this.updateUI();
        this.startSmoothPositionUpdate();
    }

    /**
     * Load last position from localStorage (if savePosition is enabled)
     */
    loadPosition() {
        let position = null;

        // Only load from localStorage if savePosition is enabled
        if (this.config.savePosition) {
            const storageKey = `controlPanel_${this.config.gameName}_position`;
            const saved = localStorage.getItem(storageKey);

            if (saved) {
                try {
                    position = JSON.parse(saved);
                } catch (e) {
                    console.warn('[ControlPanel] Failed to load position', e);
                }
            }
        }

        // If no saved position, use custom default or fall back to bottom-right corner
        if (!position) {
            if (this.config.defaultPosition) {
                position = { ...this.config.defaultPosition };
            } else {
                position = {
                    x: window.innerWidth - 80,  // 60px icon + 20px margin
                    y: window.innerHeight - 80   // 60px icon + 20px margin
                };
            }
        }

        // Ensure position is within viewport bounds (in case window was resized)
        position.x = Math.max(10, Math.min(position.x, window.innerWidth - 70));
        position.y = Math.max(10, Math.min(position.y, window.innerHeight - 70));

        console.log('[ControlPanel] Loading position:', position, 'viewport:', { w: window.innerWidth, h: window.innerHeight });

        return position;
    }

    /**
     * Save position to localStorage (if savePosition is enabled)
     */
    savePosition() {
        if (!this.config.savePosition) {
            return;  // Don't save if disabled
        }
        const storageKey = `controlPanel_${this.config.gameName}_position`;
        localStorage.setItem(storageKey, JSON.stringify(this.position));
    }

    /**
     * Create panel HTML structure
     */
    createPanel() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'gameControlPanel';
        // Start collapsed or expanded based on config
        this.container.className = this.isCollapsed ? 'game-control-panel collapsed' : 'game-control-panel expanded';
        this.container.style.left = `${this.position.x}px`;
        this.container.style.top = `${this.position.y}px`;
        this.container.style.display = 'block';  // Ensure it's visible
        this.container.style.visibility = 'visible';  // Ensure it's not hidden

        console.log('[ControlPanel] Creating panel at position:', this.position, 'className:', this.container.className);

        // Collapsed icon button
        this.collapsedIcon = document.createElement('div');
        this.collapsedIcon.className = 'control-panel-icon';
        this.collapsedIcon.innerHTML = `
            <span class="icon-emoji">${this.config.gameIcon}</span>
            <span class="icon-host-badge" style="display: ${this.config.isHost ? 'flex' : 'none'};">👑</span>
        `;
        this.collapsedIcon.title = this.config.gameName;

        // Expanded panel
        this.expandedPanel = document.createElement('div');
        this.expandedPanel.className = 'control-panel-expanded';
        this.expandedPanel.innerHTML = this.createPanelHTML();

        // Append elements
        this.container.appendChild(this.collapsedIcon);
        this.container.appendChild(this.expandedPanel);
        document.body.appendChild(this.container);

        // Cache button references
        this.cacheElements();
    }

    /**
     * Create expanded panel HTML
     */
    createPanelHTML() {
        const hostBadgeVisible = this.config.isHost ? 'flex' : 'none';
        const agentInfo = this.config.agentName ? `<div class="agent-info">👤 ${this.config.agentName}</div>` : '';
        const roomInfo = this.config.roomCode ? `<div class="room-info">🏠 Room: ${this.config.roomCode}</div>` : '';

        return `
            <div class="panel-header" data-drag-handle>
                <div class="panel-title">
                    <span class="game-icon">${this.config.gameIcon}</span>
                    <span class="game-name">${this.config.gameName}</span>
                    <div class="host-badge" style="display: ${hostBadgeVisible};">👑 Host</div>
                </div>
                <button class="btn-collapse" title="Collapse">−</button>
            </div>
            <div class="panel-info">
                ${agentInfo}
                ${roomInfo}
            </div>
            <div class="panel-body">
                <button class="panel-btn btn-pause" ${(this.config.isHost && this.config.isPauseEnabled) ? '' : 'disabled'}>
                    <span class="btn-icon">${this.config.isPaused ? '▶️' : '⏸️'}</span>
                    <span class="btn-label">${this.config.isPaused ? 'Resume' : 'Pause'}</span>
                </button>
                <button class="panel-btn btn-share">
                    <span class="btn-icon">📤</span>
                    <span class="btn-label">Share</span>
                </button>
                ${this.renderCustomButtons()}
                <button class="panel-btn btn-leave">
                    <span class="btn-icon">🚪</span>
                    <span class="btn-label">Leave Game</span>
                </button>
                ${this.config.showSound ? `
                <button class="panel-btn btn-sound">
                    <span class="btn-icon">🔊</span>
                    <span class="btn-label">Sound</span>
                </button>` : ''}
                ${this.config.showFullscreen ? `
                <button class="panel-btn btn-fullscreen">
                    <span class="btn-icon">⛶</span>
                    <span class="btn-label">Fullscreen</span>
                </button>` : ''}
                ${this.config.showHelp ? `
                <button class="panel-btn btn-help">
                    <span class="btn-icon">❓</span>
                    <span class="btn-label">Help</span>
                </button>` : ''}
                ${this.config.showSettings ? `
                <button class="panel-btn btn-settings">
                    <span class="btn-icon">⚙️</span>
                    <span class="btn-label">Settings</span>
                </button>` : ''}
            </div>
        `;
    }

    /**
     * Render custom buttons HTML
     * Custom button format: { id, icon, label, onClick, visible, hostOnly, class }
     */
    renderCustomButtons() {
        if (!this.config.customButtons || this.config.customButtons.length === 0) {
            return '';
        }

        return this.config.customButtons.map(btn => {
            // Always render the button in DOM, but control visibility with style
            // This allows updateCustomButtonsVisibility() to work properly
            const shouldShow = btn.visible !== false && (!btn.hostOnly || this.config.isHost);
            const displayStyle = shouldShow ? 'flex' : 'none';
            const customClass = btn.class || '';
            const disabled = btn.disabled ? 'disabled' : '';

            return `
                <button class="panel-btn custom-btn-${btn.id} ${customClass}" data-custom-btn="${btn.id}" ${disabled} style="display: ${displayStyle};">
                    <span class="btn-icon">${btn.icon}</span>
                    <span class="btn-label">${btn.label}</span>
                </button>
            `;
        }).join('');
    }

    /**
     * Cache DOM element references
     */
    cacheElements() {
        this.btnCollapse = this.container.querySelector('.btn-collapse');
        this.btnPause = this.container.querySelector('.btn-pause');
        this.btnShare = this.container.querySelector('.btn-share');
        this.btnLeave = this.container.querySelector('.btn-leave');
        this.btnSound = this.container.querySelector('.btn-sound');
        this.btnFullscreen = this.container.querySelector('.btn-fullscreen');
        this.btnHelp = this.container.querySelector('.btn-help');
        this.btnSettings = this.container.querySelector('.btn-settings');
        this.dragHandle = this.container.querySelector('[data-drag-handle]');
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Toggle collapse/expand
        this.collapsedIcon.addEventListener('click', () => this.expand());
        this.btnCollapse.addEventListener('click', () => this.collapse());

        // Dragging (collapsed icon)
        this.collapsedIcon.addEventListener('pointerdown', (e) => this.startDrag(e));

        // Dragging (expanded panel header)
        this.dragHandle.addEventListener('pointerdown', (e) => this.startDrag(e));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Button clicks
        if (this.btnPause) {
            this.btnPause.addEventListener('click', () => this.handlePauseToggle());
        }
        if (this.btnShare) {
            this.btnShare.addEventListener('click', () => this.handleShare());
        }
        if (this.btnLeave) {
            this.btnLeave.addEventListener('click', () => this.handleLeave());
        }
        if (this.btnSound) {
            this.btnSound.addEventListener('click', () => this.handleToggleSound());
        }
        if (this.btnFullscreen) {
            this.btnFullscreen.addEventListener('click', () => this.handleToggleFullscreen());
        }
        if (this.btnHelp) {
            this.btnHelp.addEventListener('click', () => this.handleOpenHelp());
        }
        if (this.btnSettings) {
            this.btnSettings.addEventListener('click', () => this.handleOpenSettings());
        }

        // Pointer events for dragging
        document.addEventListener('pointermove', (e) => this.onDrag(e));
        document.addEventListener('pointerup', () => this.stopDrag());

        // Attach custom button listeners
        this.attachCustomButtonListeners();
    }

    /**
     * Attach event listeners for custom buttons
     */
    attachCustomButtonListeners() {
        this.config.customButtons.forEach(btn => {
            const element = this.container.querySelector(`[data-custom-btn="${btn.id}"]`);
            if (element && btn.onClick) {
                element.addEventListener('click', () => btn.onClick());
            }
        });
    }

    /**
     * Start dragging
     */
    startDrag(e) {
        // Don't drag if clicking a button
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            return;
        }

        this.isDragging = true;
        this.container.classList.add('dragging');

        const rect = this.container.getBoundingClientRect();
        this.dragOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };

        // Prevent text selection, scrolling, and event bubbling (important for mobile)
        e.preventDefault();
        e.stopPropagation();
    }

    /**
     * Handle drag movement with smooth interpolation
     */
    onDrag(e) {
        if (!this.isDragging) return;

        // Prevent default and bubbling during drag (important for mobile)
        e.preventDefault();

        let x = e.clientX - this.dragOffset.x;
        let y = e.clientY - this.dragOffset.y;

        // Clamp to viewport bounds
        const rect = this.container.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;

        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));

        // Update target position (smooth animation will follow)
        this.targetPosition = { x, y };
        this.position = { x, y };
    }

    /**
     * Start smooth position update loop
     */
    startSmoothPositionUpdate() {
        const animate = () => {
            // Lerp interpolation for smooth movement
            const lerpFactor = this.isDragging ? 0.3 : 0.15; // Faster when dragging

            this.currentPosition.x += (this.targetPosition.x - this.currentPosition.x) * lerpFactor;
            this.currentPosition.y += (this.targetPosition.y - this.currentPosition.y) * lerpFactor;

            // Apply position
            this.container.style.left = `${this.currentPosition.x}px`;
            this.container.style.top = `${this.currentPosition.y}px`;

            this.animationFrame = requestAnimationFrame(animate);
        };

        animate();
    }

    /**
     * Stop dragging
     */
    stopDrag() {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.container.classList.remove('dragging');
        this.savePosition();
    }

    /**
     * Reset position to default (bottom-right corner)
     */
    resetPosition() {
        const defaultPos = {
            x: window.innerWidth - 80,
            y: window.innerHeight - 80
        };

        // Ensure within bounds
        defaultPos.x = Math.max(10, Math.min(defaultPos.x, window.innerWidth - 70));
        defaultPos.y = Math.max(10, Math.min(defaultPos.y, window.innerHeight - 70));

        this.position = defaultPos;
        this.targetPosition = { ...defaultPos };
        this.currentPosition = { ...defaultPos };

        this.container.style.left = `${defaultPos.x}px`;
        this.container.style.top = `${defaultPos.y}px`;

        this.savePosition();

        console.log('[ControlPanel] Position reset to:', defaultPos);
    }

    /**
     * Expand panel
     */
    expand() {
        this.isCollapsed = false;
        this.container.classList.remove('collapsed');
        this.container.classList.add('expanded');
    }

    /**
     * Collapse panel
     */
    collapse() {
        this.isCollapsed = true;
        this.container.classList.remove('expanded');
        this.container.classList.add('collapsed');
    }


    /**
     * Handle keyboard shortcuts
     */
    handleKeyboard(e) {
        // Escape: collapse panel
        if (e.key === 'Escape' && !this.isCollapsed) {
            this.collapse();
            e.preventDefault();
        }
    }

    /**
     * Handle pause toggle
     */
    handlePauseToggle() {
        if (!this.config.isHost || !this.config.isPauseEnabled) return;

        this.config.isPaused = !this.config.isPaused;
        this.updateUI();

        if (this.config.onPauseToggle) {
            this.config.onPauseToggle(this.config.isPaused);
        }
    }

    /**
     * Handle share button - shows share modal
     */
    handleShare() {
        // Use ShareModal if available
        if (typeof ShareModal !== 'undefined' && this.config.roomCode) {
            ShareModal.show(this.config.roomCode, this.config.roomPassword);
        } else {
            // Fallback: copy URL to clipboard
            const url = this.config.shareUrl || window.location.href;
            navigator.clipboard.writeText(url).then(() => {
                this.showToast('✅ Link copied to clipboard!');
            }).catch(() => {
                this.showToast('❌ Failed to copy link');
            });
        }

        if (this.config.onShare) {
            this.config.onShare(this.config.shareUrl || window.location.href);
        }
    }

    /**
     * Handle leave game - calls onLeave callback directly (callback handles confirmation if needed)
     */
    handleLeave() {
        if (this.config.onLeave) {
            this.config.onLeave();
        }
    }

    /**
     * Handle toggle sound
     */
    handleToggleSound() {
        this.isSoundOn = !this.isSoundOn;
        this.updateUI();

        if (this.config.onToggleSound) {
            this.config.onToggleSound(this.isSoundOn);
        }
    }

    /**
     * Handle toggle fullscreen
     */
    handleToggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => {
                this.isFullscreen = true;
                this.updateUI();
            });
        } else {
            document.exitFullscreen().then(() => {
                this.isFullscreen = false;
                this.updateUI();
            });
        }

        if (this.config.onToggleFullscreen) {
            this.config.onToggleFullscreen(this.isFullscreen);
        }
    }

    /**
     * Handle open help
     */
    handleOpenHelp() {
        if (this.config.onOpenHelp) {
            this.config.onOpenHelp();
        }
    }

    /**
     * Handle open settings
     */
    handleOpenSettings() {
        if (this.config.onOpenSettings) {
            this.config.onOpenSettings();
        }
    }

    /**
     * Update UI based on state
     */
    updateUI() {
        // Update pause button
        if (this.btnPause) {
            if (this.config.isHost && this.config.isPauseEnabled) {
                this.btnPause.disabled = false;
                if (this.config.isPaused) {
                    this.btnPause.querySelector('.btn-icon').textContent = '▶️';
                    this.btnPause.querySelector('.btn-label').textContent = 'Resume';
                } else {
                    this.btnPause.querySelector('.btn-icon').textContent = '⏸️';
                    this.btnPause.querySelector('.btn-label').textContent = 'Pause';
                }
            } else {
                this.btnPause.disabled = true;
            }
        }

        // Update sound button
        if (this.btnSound) {
            this.btnSound.querySelector('.btn-icon').textContent = this.isSoundOn ? '🔊' : '🔇';
        }

        // Update fullscreen button
        if (this.btnFullscreen) {
            this.btnFullscreen.querySelector('.btn-icon').textContent = this.isFullscreen ? '⛶' : '⛶';
        }

        // Update host badge in expanded panel (use flex for proper display)
        const hostBadge = this.container.querySelector('.host-badge');
        if (hostBadge) {
            hostBadge.style.display = this.config.isHost ? 'inline-flex' : 'none';
        }

        // Update host badge in collapsed icon
        const iconHostBadge = this.container.querySelector('.icon-host-badge');
        if (iconHostBadge) {
            iconHostBadge.style.display = this.config.isHost ? 'flex' : 'none';
        }

        // Update agent info
        const agentInfo = this.container.querySelector('.agent-info');
        if (agentInfo && this.config.agentName) {
            agentInfo.textContent = `👤 ${this.config.agentName}`;
        }

        // Update room info
        const roomInfo = this.container.querySelector('.room-info');
        if (roomInfo && this.config.roomCode) {
            roomInfo.textContent = `🏠 Room: ${this.config.roomCode}`;
        }

        // Update custom buttons visibility
        this.updateCustomButtonsVisibility();
    }

    /**
     * Update custom buttons visibility based on their current state
     */
    updateCustomButtonsVisibility() {
        this.config.customButtons.forEach(btn => {
            const element = this.container.querySelector(`[data-custom-btn="${btn.id}"]`);
            if (element) {
                // Check visibility conditions
                const shouldShow = btn.visible !== false && (!btn.hostOnly || this.config.isHost);
                element.style.display = shouldShow ? 'flex' : 'none';

                // Update disabled state
                element.disabled = !!btn.disabled;
            }
        });
    }

    /**
     * Update state from external source
     */
    updateState(updates) {
        Object.assign(this.config, updates);
        this.updateUI();
    }

    /**
     * Show toast notification
     */
    showToast(message) {
        // Use existing toast system if available
        if (typeof window.showToast === 'function') {
            window.showToast(message);
        } else {
            // Fallback: simple alert
            const toast = document.createElement('div');
            toast.className = 'control-panel-toast';
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }

    /**
     * Destroy panel and cleanup
     */
    destroy() {
        // Cancel animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.container) {
            this.container.remove();
            this.container = null;
        }

        // Clear singleton reference
        if (_controlPanelInstance === this) {
            _controlPanelInstance = null;
        }
    }

    /**
     * Static method to get current instance
     */
    static getInstance() {
        return _controlPanelInstance;
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameControlPanel;
}
