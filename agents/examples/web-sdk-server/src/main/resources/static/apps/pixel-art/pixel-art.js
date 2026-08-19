/**
 * Pixel Art Editor - Collaborative Pixel Art Creation
 * Uses UserConnectionBase for real-time synchronization
 */

// ============================================
// PIXEL ART APP CLASS
// ============================================

class PixelArtApp extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'pixelart',
            customType: 'pixel-art',
            autoCreateDataChannel: true,
            dataChannelName: 'pixel-data',
            dataChannelOptions: {
                ordered: false,
                maxRetransmits: 0
            }
        });

        // Canvas
        this.canvas = null;
        this.ctx = null;

        // Grid
        this.gridSize = 32;
        this.pixelSize = 16; // Display size of each pixel
        this.zoom = 1.0;

        // Drawing state
        this.isDrawing = false;
        this.currentTool = 'pen';
        this.currentColor = '#000000';

        // Pixel grid data (gridSize x gridSize)
        this.pixels = [];

        // Users and cursors
        this.users = new Map();
        this.remoteCursors = new Map();

        // Cursor throttle
        this.lastCursorSend = 0;
        this.cursorSendInterval = 50;
    }

    async onInitialize() {
        console.log('[PixelArt] Initializing...');

        // Setup canvas
        this.canvas = document.getElementById('pixelCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Initialize pixel grid
        this.initializeGrid();

        // Setup UI
        this.setupTools();
        this.setupCanvas();

        // Start cursor animation loop
        this.startCursorLoop();

        console.log('[PixelArt] Initialized');
    }

    initializeGrid() {
        this.pixels = [];
        for (let y = 0; y < this.gridSize; y++) {
            this.pixels[y] = [];
            for (let x = 0; x < this.gridSize; x++) {
                this.pixels[y][x] = null; // null = transparent
            }
        }

        this.updateCanvasSize();
        this.render();
    }

    updateCanvasSize() {
        const displaySize = this.gridSize * this.pixelSize * this.zoom;
        this.canvas.width = this.gridSize;
        this.canvas.height = this.gridSize;
        this.canvas.style.width = displaySize + 'px';
        this.canvas.style.height = displaySize + 'px';

        // Update grid info
        document.getElementById('gridSize').textContent = `${this.gridSize}x${this.gridSize}`;
    }

    setupTools() {
        // Tool buttons
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentTool = btn.dataset.tool;
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Color swatches
        document.querySelectorAll('.color-swatch').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentColor = btn.dataset.color;
                this.updateColorUI();
            });
        });

        // Custom color picker
        document.getElementById('customColor').addEventListener('input', (e) => {
            this.currentColor = e.target.value;
            this.updateColorUI();
        });

        // Grid size
        document.getElementById('gridSizeSelect').addEventListener('change', (e) => {
            const newSize = parseInt(e.target.value);
            if (confirm(`Change grid to ${newSize}x${newSize}? This will clear the canvas.`)) {
                this.gridSize = newSize;
                this.initializeGrid();
            } else {
                e.target.value = this.gridSize;
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') this.setTool('pen');
            if (e.key === 'e' || e.key === 'E') this.setTool('eraser');
            if (e.key === 'f' || e.key === 'F') this.setTool('fill');
            if (e.key === 'i' || e.key === 'I') this.setTool('eyedropper');
        });
    }

    setTool(tool) {
        this.currentTool = tool;
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    updateColorUI() {
        document.querySelectorAll('.color-swatch').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === this.currentColor);
        });
        document.getElementById('currentColorDisplay').style.background = this.currentColor;
        document.getElementById('currentColorHex').textContent = this.currentColor;
    }

    setupCanvas() {
        this.canvas.addEventListener('mousedown', (e) => this.handleDrawStart(e));
        this.canvas.addEventListener('mousemove', (e) => {
            this.handleDrawMove(e);
            this.handleCursorMove(e);
        });
        this.canvas.addEventListener('mouseup', () => this.handleDrawEnd());
        this.canvas.addEventListener('mouseleave', () => this.handleDrawEnd());

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), {passive: false});
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), {passive: false});
        this.canvas.addEventListener('touchend', () => this.handleDrawEnd());
    }

    onConnect(detail) {
        // Dismiss the connection dialog — without this it stays over the app
        // even though the session is live.
        if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
            window.ConnectionModal.hide();
        }
        console.log('[PixelArt] Connected:', detail);

        // Show app container
        document.getElementById('appContainer').classList.remove('hidden');

        // Update connection status
        document.getElementById('connectionStatus').classList.add('connected');
        document.getElementById('statusText').textContent = 'Connected';

        // Show room name
        document.getElementById('roomName').textContent = this.channelName;

        // Show share button
        document.getElementById('shareBtn').style.display = 'block';

        // Initialize users
        detail.users.forEach(username => {
            if (username !== this.username) {
                this.users.set(username, {
                    color: this.generateUserColor(username)
                });
            }
        });

        this.updateUsersUI();
    }

    onUserJoin(detail) {
        console.log('[PixelArt] User joined:', detail.agentName);

        this.users.set(detail.agentName, {
            color: this.generateUserColor(detail.agentName)
        });

        this.updateUsersUI();
        this.showToast(`${detail.agentName} joined`, 'success');

        // Sync canvas to new user
        if (this.isHost()) {
            this.syncCanvasTo(detail.agentName);
        }
    }

    onUserLeave(detail) {
        console.log('[PixelArt] User left:', detail.agentName);

        this.users.delete(detail.agentName);
        this.remoteCursors.delete(detail.agentName);

        this.updateUsersUI();
        this.showToast(`${detail.agentName} left`, 'info');
    }

    onDataChannelMessage(peerId, data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'pixel-set':
                this.handleRemotePixel(data);
                break;
            case 'fill':
                this.handleRemoteFill(data);
                break;
            case 'clear':
                this.clearCanvas(true);
                break;
            case 'canvas-sync':
                this.handleCanvasSync(data);
                break;
            case 'cursor-move':
                this.handleRemoteCursor(data);
                break;
        }
    }

    generateUserColor(username) {
        const colors = [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
            '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
        ];
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    updateUsersUI() {
        const usersList = document.getElementById('usersList');
        const userCountNum = document.getElementById('userCountNum');

        userCountNum.textContent = this.users.size + 1;

        let html = `
            <div class="user-item">
                <div class="user-color-indicator" style="background: var(--primary)"></div>
                <span>${this.username} (You)</span>
            </div>
        `;

        this.users.forEach((user, username) => {
            html += `
                <div class="user-item">
                    <div class="user-color-indicator" style="background: ${MiniGameUtils.safeColor(user.color)}"></div>
                    <span>${MiniGameUtils.escapeHtml(username)}</span>
                </div>
            `;
        });

        usersList.innerHTML = html;
    }

    // ============================================
    // DRAWING
    // ============================================

    handleDrawStart(e) {
        this.isDrawing = true;
        this.handleDraw(e);
    }

    handleDrawMove(e) {
        if (this.isDrawing) {
            this.handleDraw(e);
        }
    }

    handleDrawEnd() {
        this.isDrawing = false;
    }

    handleTouchStart(e) {
        e.preventDefault();
        this.isDrawing = true;
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        this.handleDraw(mouseEvent);
    }

    handleTouchMove(e) {
        e.preventDefault();
        if (this.isDrawing) {
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.handleDraw(mouseEvent);
        }
    }

    handleDraw(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / rect.width * this.gridSize);
        const y = Math.floor((e.clientY - rect.top) / rect.height * this.gridSize);

        if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return;

        if (this.currentTool === 'pen') {
            this.setPixel(x, y, this.currentColor);
        } else if (this.currentTool === 'eraser') {
            this.setPixel(x, y, null);
        } else if (this.currentTool === 'fill') {
            this.floodFill(x, y, this.currentColor);
        } else if (this.currentTool === 'eyedropper') {
            const color = this.pixels[y][x];
            if (color) {
                this.currentColor = color;
                this.updateColorUI();
                this.setTool('pen');
            }
        }
    }

    setPixel(x, y, color, isRemote = false) {
        if (this.pixels[y][x] === color) return;

        this.pixels[y][x] = color;
        this.render();

        if (!isRemote) {
            // Broadcast pixel change
            const data = {
                type: 'pixel-set',
                x: x,
                y: y,
                color: color
            };
            this.sendData(data);
        }
    }

    handleRemotePixel(data) {
        this.setPixel(data.x, data.y, data.color, true);
    }

    floodFill(startX, startY, newColor) {
        const oldColor = this.pixels[startY][startX];

        if (oldColor === newColor) return;

        const stack = [[startX, startY]];
        const visited = new Set();
        const changes = [];

        while (stack.length > 0) {
            const [x, y] = stack.pop();
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) continue;
            if (this.pixels[y][x] !== oldColor) continue;

            visited.add(key);
            this.pixels[y][x] = newColor;
            changes.push({x, y});

            // Add neighbors
            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }

        this.render();

        // Broadcast fill operation
        const data = {
            type: 'fill',
            startX: startX,
            startY: startY,
            oldColor: oldColor,
            newColor: newColor
        };
        this.sendData(data);
    }

    handleRemoteFill(data) {
        const stack = [[data.startX, data.startY]];
        const visited = new Set();

        while (stack.length > 0) {
            const [x, y] = stack.pop();
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) continue;
            if (this.pixels[y][x] !== data.oldColor) continue;

            visited.add(key);
            this.pixels[y][x] = data.newColor;

            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }

        this.render();
    }

    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw pixels
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const color = this.pixels[y][x];
                if (color) {
                    this.ctx.fillStyle = color;
                    this.ctx.fillRect(x, y, 1, 1);
                }
            }
        }
    }

    clearCanvas(isRemote = false) {
        if (!isRemote && !confirm('Clear the entire canvas?')) return;

        this.initializeGrid();

        if (!isRemote) {
            this.sendData({ type: 'clear' });
        }
    }

    // ============================================
    // ZOOM
    // ============================================

    zoomIn() {
        this.zoom = Math.min(this.zoom + 0.25, 4.0);
        this.updateCanvasSize();
        document.getElementById('zoomLevel').textContent = `${Math.round(this.zoom * 100)}%`;
    }

    zoomOut() {
        this.zoom = Math.max(this.zoom - 0.25, 0.5);
        this.updateCanvasSize();
        document.getElementById('zoomLevel').textContent = `${Math.round(this.zoom * 100)}%`;
    }

    resetZoom() {
        this.zoom = 1.0;
        this.updateCanvasSize();
        document.getElementById('zoomLevel').textContent = '100%';
    }

    // ============================================
    // EXPORT
    // ============================================

    exportImage() {
        // Create a temporary canvas at actual pixel size
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = this.gridSize;
        exportCanvas.height = this.gridSize;
        const exportCtx = exportCanvas.getContext('2d');

        // Draw all pixels
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const color = this.pixels[y][x];
                if (color) {
                    exportCtx.fillStyle = color;
                    exportCtx.fillRect(x, y, 1, 1);
                }
            }
        }

        // Download
        exportCanvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pixel-art-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);

            this.showToast('Image exported!', 'success');
        });
    }

    // ============================================
    // CURSORS
    // ============================================

    handleCursorMove(e) {
        const now = Date.now();
        if (now - this.lastCursorSend < this.cursorSendInterval) return;

        this.lastCursorSend = now;

        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / rect.width * this.gridSize);
        const y = Math.floor((e.clientY - rect.top) / rect.height * this.gridSize);

        const data = {
            type: 'cursor-move',
            username: this.username,
            x: x,
            y: y
        };

        this.sendData(data);
    }

    handleRemoteCursor(data) {
        let cursor = this.remoteCursors.get(data.username);

        if (!cursor) {
            // Create cursor
            cursor = this.createRemoteCursor(data.username);
            this.remoteCursors.set(data.username, cursor);
        }

        // Update position
        const rect = this.canvas.getBoundingClientRect();
        const pixelX = rect.left + (data.x / this.gridSize) * rect.width;
        const pixelY = rect.top + (data.y / this.gridSize) * rect.height;

        cursor.style.left = pixelX + 'px';
        cursor.style.top = pixelY + 'px';
    }

    createRemoteCursor(username) {
        const cursor = document.createElement('div');
        cursor.className = 'remote-cursor';

        const user = this.users.get(username);
        const color = user ? user.color : '#999';

        cursor.innerHTML = `
            <div class="remote-cursor-dot" style="background: ${MiniGameUtils.safeColor(color)}"></div>
            <div class="remote-cursor-label" style="background: ${MiniGameUtils.safeColor(color)}">${MiniGameUtils.escapeHtml(username)}</div>
        `;

        document.body.appendChild(cursor);
        return cursor;
    }

    startCursorLoop() {
        // Nothing to do: remote cursors are removed when their owner leaves.
        // This used to run an empty callback every 2s for the life of the page,
        // with the handle discarded so it could never be cleared.
    }

    // ============================================
    // SYNC
    // ============================================

    syncCanvasTo(username) {
        const data = {
            type: 'canvas-sync',
            pixels: this.pixels,
            gridSize: this.gridSize
        };

        this.sendData(data, username);
    }

    handleCanvasSync(data) {
        if (data.gridSize !== this.gridSize) {
            this.gridSize = data.gridSize;
            document.getElementById('gridSizeSelect').value = this.gridSize;
            this.updateCanvasSize();
        }

        this.pixels = data.pixels;
        this.render();
    }

    // ============================================
    // UTILITIES
    // ============================================

    showToast(message, type = 'info') {
        if (typeof MiniGameUtils !== 'undefined' && MiniGameUtils.showToast) {
            MiniGameUtils.showToast(message, type);
        } else {
            console.log(`[Toast] ${message}`);
        }
    }

    openShareModal() {
        if (typeof window.openShareModal === 'function') {
            window.openShareModal();
        }
    }
}

// ============================================
// INITIALIZATION
// ============================================

let pixelArtApp = null;
let isConnecting = false;

async function connectPixelArt(username, channel, password) {
    if (isConnecting) {
        console.warn('[PixelArt] Connection already in progress');
        return;
    }
    if (pixelArtApp && pixelArtApp.connected) {
        console.warn('[PixelArt] Already connected');
        return;
    }

    isConnecting = true;

    try {
        pixelArtApp = new PixelArtApp();
        window.pixelArtApp = pixelArtApp;

        await pixelArtApp.initialize();
        await pixelArtApp.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });

        pixelArtApp.start();

        // Update URL for sharing
        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' + channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }

        console.log('[PixelArt] Connected and ready!');
    } catch (error) {
        console.error('[PixelArt] Connection failed:', error);
        if (window.ConnectionModal) ConnectionModal.fail(error);
        pixelArtApp = null;
    } finally {
        isConnecting = false;
    }
}

function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'pixelart_',
        channelPrefix: 'pixel-',
        title: '🎨 Join Pixel Art Editor',
        collapsedTitle: '🎨 Pixel Art',
        onConnect: function(username, channel, password) {
            connectPixelArt(username, channel, password);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[PixelArt] Page loaded');

    initializeConnectionModal();

    // Process shared link
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'PixelArt',
            storagePrefix: 'pixelart_',
            connectCallback: async function() {
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectPixelArt(username, channel, password);
                }
            }
        });
    }

    // Show modal
    setTimeout(() => {
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.add('active');
    }, 200);
});

