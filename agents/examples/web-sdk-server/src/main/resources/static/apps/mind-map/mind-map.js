/**
 * Mind Map Builder - Collaborative Mind Mapping
 * Uses UserConnectionBase for real-time synchronization
 */

// ============================================
// NODE & CONNECTION CLASSES
// ============================================

class MindMapNode {
    constructor(id, x, y, text = 'New Node', color = '#3b82f6') {
        this.id = id;
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color;
        this.width = 120;
        this.height = 60;
        this.connections = []; // Array of node IDs this node connects to
    }

    contains(x, y) {
        return x >= this.x - this.width / 2 && x <= this.x + this.width / 2 &&
               y >= this.y - this.height / 2 && y <= this.y + this.height / 2;
    }
}

class Connection {
    constructor(fromId, toId) {
        this.fromId = fromId;
        this.toId = toId;
    }
}

// ============================================
// MIND MAP APP CLASS
// ============================================

class MindMapApp extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'mindmap',
            customType: 'mind-map',
            autoCreateDataChannel: true,
            dataChannelName: 'mindmap-data',
            supportsPauseResume: false
        });

        // Canvas
        this.canvas = null;
        this.ctx = null;

        // Mind map data
        this.nodes = new Map(); // id -> MindMapNode
        this.connections = []; // Array of Connection objects
        this.nextNodeId = 1;

        // View state
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;

        // Interaction state
        this.selectedNode = null;
        this.draggingNode = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.connectingMode = false;
        this.connectingFromNode = null;

        // Users and cursors
        this.users = new Map();
        this.remoteCursors = new Map();

        // Cursor sync
        this.lastCursorSend = 0;
        this.cursorSendInterval = 50;

        // Edit state
        this.editingNode = null;
    }

    async onInitialize() {
        console.log('[MindMap] Initializing...');

        // Setup canvas
        this.canvas = document.getElementById('mindMapCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Setup events
        this.setupEvents();

        // Setup keyboard shortcuts
        this.setupKeyboard();

        // Start render loop
        this.startRenderLoop();

        // Show instructions
        this.showInstructions();

        console.log('[MindMap] Initialized');
    }

    resizeCanvas() {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        this.render();
    }

    setupEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), {passive: false});
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this.handleContextMenu(e));

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), {passive: false});
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), {passive: false});
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));

        // Resize
        window.addEventListener('resize', () => this.resizeCanvas());

        // Click outside context menu
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                this.hideContextMenu();
            }
        });
    }

    setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;

            if (e.key === 'a' || e.key === 'A') {
                this.addNode();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                this.deleteSelected();
            } else if (e.key === '+' || e.key === '=') {
                this.zoomIn();
            } else if (e.key === '-') {
                this.zoomOut();
            } else if (e.key === '0') {
                this.resetView();
            }
        });
    }

    onConnect(detail) {
        // Dismiss the connection dialog — without this it stays over the app
        // even though the session is live.
        if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
            window.ConnectionModal.hide();
        }
        console.log('[MindMap] Connected:', detail);

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

        // Create initial node if host
        if (this.isHost() && this.nodes.size === 0) {
            const centerNode = new MindMapNode(
                this.generateNodeId(),
                this.canvas.width / 2,
                this.canvas.height / 2,
                'Central Idea',
                '#0891b2'
            );
            this.nodes.set(centerNode.id, centerNode);
            this.broadcastAddNode(centerNode);
        }
    }

    onUserJoin(detail) {
        console.log('[MindMap] User joined:', detail.agentName);

        this.users.set(detail.agentName, {
            color: this.generateUserColor(detail.agentName)
        });

        this.updateUsersUI();
        this.showToast(`${detail.agentName} joined`, 'success');

        // Sync map to new user
        if (this.isHost()) {
            this.syncMapTo(detail.agentName);
        }
    }

    onUserLeave(detail) {
        console.log('[MindMap] User left:', detail.agentName);

        this.users.delete(detail.agentName);

        // The cursor is a DOM element; dropping the map entry alone left a
        // ghost cursor on screen for ever.
        const cursor = this.remoteCursors.get(detail.agentName);
        if (cursor) cursor.remove();
        this.remoteCursors.delete(detail.agentName);

        this.updateUsersUI();
        this.showToast(`${detail.agentName} left`, 'info');
    }

    onDataChannelMessage(peerId, data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'add-node':
                this.handleRemoteAddNode(data);
                break;
            case 'update-node':
                this.handleRemoteUpdateNode(data);
                break;
            case 'delete-node':
                this.handleRemoteDeleteNode(data);
                break;
            case 'add-connection':
                this.handleRemoteAddConnection(data);
                break;
            case 'delete-connection':
                this.handleRemoteDeleteConnection(data);
                break;
            case 'clear-all':
                this.clearAll(true);
                break;
            case 'map-sync':
                this.handleMapSync(data);
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

    generateNodeId() {
        return `node_${this.username}_${this.nextNodeId++}_${Date.now()}`;
    }

    // ============================================
    // NODE OPERATIONS
    // ============================================

    addNode() {
        // Create node at center of view
        const centerX = this.canvas.width / 2 - this.panX;
        const centerY = this.canvas.height / 2 - this.panY;

        const node = new MindMapNode(
            this.generateNodeId(),
            centerX / this.zoom,
            centerY / this.zoom,
            'New Node',
            '#3b82f6'
        );

        this.nodes.set(node.id, node);
        this.broadcastAddNode(node);

        // Auto-select for editing
        this.selectedNode = node;
        this.editNode(node);
    }

    broadcastAddNode(node) {
        const data = {
            type: 'add-node',
            node: {
                id: node.id,
                x: node.x,
                y: node.y,
                text: node.text,
                color: node.color
            }
        };

        this.sendData(data);
    }

    handleRemoteAddNode(data) {
        const node = new MindMapNode(
            data.node.id,
            data.node.x,
            data.node.y,
            data.node.text,
            data.node.color
        );

        this.nodes.set(node.id, node);
        this.updateNodeCount();
    }

    updateNode(node) {
        const data = {
            type: 'update-node',
            nodeId: node.id,
            x: node.x,
            y: node.y,
            text: node.text,
            color: node.color
        };

        this.sendData(data);
    }

    handleRemoteUpdateNode(data) {
        const node = this.nodes.get(data.nodeId);
        if (node) {
            node.x = data.x;
            node.y = data.y;
            node.text = data.text;
            node.color = data.color;
        }
    }

    deleteNode(nodeId) {
        if (!this.nodes.has(nodeId)) return;

        // Remove connections
        this.connections = this.connections.filter(conn =>
            conn.fromId !== nodeId && conn.toId !== nodeId
        );

        this.nodes.delete(nodeId);

        const data = {
            type: 'delete-node',
            nodeId: nodeId
        };

        this.sendData(data);
        this.updateNodeCount();
    }

    handleRemoteDeleteNode(data) {
        this.connections = this.connections.filter(conn =>
            conn.fromId !== data.nodeId && conn.toId !== data.nodeId
        );

        this.nodes.delete(data.nodeId);
        this.updateNodeCount();
    }

    deleteSelected() {
        if (this.selectedNode) {
            this.deleteNode(this.selectedNode.id);
            this.selectedNode = null;
        }
    }

    // ============================================
    // CONNECTIONS
    // ============================================

    addConnection(fromId, toId) {
        // Check if connection already exists
        const exists = this.connections.some(conn =>
            (conn.fromId === fromId && conn.toId === toId) ||
            (conn.fromId === toId && conn.toId === fromId)
        );

        if (exists) return;

        const connection = new Connection(fromId, toId);
        this.connections.push(connection);

        const data = {
            type: 'add-connection',
            fromId: fromId,
            toId: toId
        };

        this.sendData(data);
    }

    handleRemoteAddConnection(data) {
        const exists = this.connections.some(conn =>
            (conn.fromId === data.fromId && conn.toId === data.toId) ||
            (conn.fromId === data.toId && conn.toId === data.fromId)
        );

        if (!exists) {
            this.connections.push(new Connection(data.fromId, data.toId));
        }
    }

    deleteConnection(fromId, toId) {
        this.connections = this.connections.filter(conn =>
            !(conn.fromId === fromId && conn.toId === toId)
        );

        const data = {
            type: 'delete-connection',
            fromId: fromId,
            toId: toId
        };

        this.sendData(data);
    }

    handleRemoteDeleteConnection(data) {
        this.connections = this.connections.filter(conn =>
            !(conn.fromId === data.fromId && conn.toId === data.toId)
        );
    }

    // ============================================
    // MOUSE INTERACTION
    // ============================================

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - this.panX) / this.zoom;
        const mouseY = (e.clientY - rect.top - this.panY) / this.zoom;

        // Check if clicking on a node
        let clickedNode = null;
        this.nodes.forEach(node => {
            if (node.contains(mouseX, mouseY)) {
                clickedNode = node;
            }
        });

        if (this.connectingMode && clickedNode) {
            // Connect mode
            if (this.connectingFromNode && clickedNode.id !== this.connectingFromNode.id) {
                this.addConnection(this.connectingFromNode.id, clickedNode.id);
                this.connectingMode = false;
                this.connectingFromNode = null;
                this.canvas.classList.remove('connecting');
            } else {
                this.connectingFromNode = clickedNode;
            }
        } else if (clickedNode) {
            // Select and start dragging
            this.selectedNode = clickedNode;
            this.draggingNode = clickedNode;
            this.dragOffsetX = mouseX - clickedNode.x;
            this.dragOffsetY = mouseY - clickedNode.y;
        } else if (e.button === 0) {
            // Start panning
            this.isPanning = true;
            this.panStartX = e.clientX - this.panX;
            this.panStartY = e.clientY - this.panY;
            this.canvas.classList.add('dragging');
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - this.panX) / this.zoom;
        const mouseY = (e.clientY - rect.top - this.panY) / this.zoom;

        // Track the pointer in world coordinates (used by the connect-mode
        // preview line).
        this.mouseWorldX = mouseX;
        this.mouseWorldY = mouseY;

        // Send cursor position in world coordinates — screen coordinates only
        // line up when both windows share the same pan/zoom/size, so peers saw
        // the cursor in the wrong place.
        const now = Date.now();
        if (now - this.lastCursorSend > this.cursorSendInterval) {
            this.lastCursorSend = now;
            this.sendData({
                type: 'cursor-move',
                username: this.username,
                x: mouseX,
                y: mouseY
            });
        }

        if (this.draggingNode) {
            // Update node position
            this.draggingNode.x = mouseX - this.dragOffsetX;
            this.draggingNode.y = mouseY - this.dragOffsetY;
            this.updateNode(this.draggingNode);
        } else if (this.isPanning) {
            // Pan view
            this.panX = e.clientX - this.panStartX;
            this.panY = e.clientY - this.panStartY;
        }
    }

    handleMouseUp(e) {
        this.draggingNode = null;
        this.isPanning = false;
        this.canvas.classList.remove('dragging');
    }

    handleWheel(e) {
        e.preventDefault();

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.3, Math.min(3.0, this.zoom * delta));

        // Zoom towards mouse position
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
        this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
        this.zoom = newZoom;
    }

    handleDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - this.panX) / this.zoom;
        const mouseY = (e.clientY - rect.top - this.panY) / this.zoom;

        // Check if double-clicking a node
        this.nodes.forEach(node => {
            if (node.contains(mouseX, mouseY)) {
                this.editNode(node);
            }
        });
    }

    handleContextMenu(e) {
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - this.panX) / this.zoom;
        const mouseY = (e.clientY - rect.top - this.panY) / this.zoom;

        // Check if right-clicking a node
        let clickedNode = null;
        this.nodes.forEach(node => {
            if (node.contains(mouseX, mouseY)) {
                clickedNode = node;
            }
        });

        if (clickedNode) {
            this.selectedNode = clickedNode;
            this.showContextMenu(e.clientX, e.clientY);
        }
    }

    handleTouchStart(e) {
        e.preventDefault();
        // Simplified touch - treat as mouse
        const touch = e.touches[0];
        this.handleMouseDown({
            clientX: touch.clientX,
            clientY: touch.clientY,
            button: 0
        });
    }

    handleTouchMove(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this.handleMouseMove({
            clientX: touch.clientX,
            clientY: touch.clientY
        });
    }

    handleTouchEnd(e) {
        this.handleMouseUp(e);
    }

    // ============================================
    // NODE EDITING
    // ============================================

    editNode(node) {
        this.editingNode = node;

        const modal = document.getElementById('textEditModal');
        const input = document.getElementById('nodeTextInput');

        input.value = node.text;
        modal.classList.remove('hidden');
        input.focus();

        input.onkeypress = (e) => {
            if (e.key === 'Enter') {
                this.saveNodeText();
            }
        };
    }

    saveNodeText() {
        if (!this.editingNode) return;

        const input = document.getElementById('nodeTextInput');
        const newText = input.value.trim() || 'Node';

        this.editingNode.text = newText;
        this.updateNode(this.editingNode);

        document.getElementById('textEditModal').classList.add('hidden');
        this.editingNode = null;
    }

    cancelNodeEdit() {
        document.getElementById('textEditModal').classList.add('hidden');
        this.editingNode = null;
    }

    // ============================================
    // CONTEXT MENU
    // ============================================

    showContextMenu(x, y) {
        const menu = document.getElementById('contextMenu');
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.remove('hidden');
    }

    hideContextMenu() {
        document.getElementById('contextMenu').classList.add('hidden');
    }

    contextMenuAction(action) {
        this.hideContextMenu();

        if (!this.selectedNode) return;

        switch (action) {
            case 'edit':
                this.editNode(this.selectedNode);
                break;
            case 'color':
                this.showColorPicker();
                break;
            case 'connect':
                this.startConnectMode();
                break;
            case 'delete':
                this.deleteNode(this.selectedNode.id);
                this.selectedNode = null;
                break;
        }
    }

    showColorPicker() {
        const dialog = document.getElementById('colorPickerDialog');
        dialog.classList.remove('hidden');

        document.querySelectorAll('.color-option').forEach(btn => {
            btn.onclick = () => {
                if (this.selectedNode) {
                    this.selectedNode.color = btn.dataset.color;
                    this.updateNode(this.selectedNode);
                }
                this.closeColorPicker();
            };
        });
    }

    closeColorPicker() {
        document.getElementById('colorPickerDialog').classList.add('hidden');
    }

    startConnectMode() {
        if (!this.selectedNode) return;

        this.connectingMode = true;
        this.connectingFromNode = this.selectedNode;
        this.canvas.classList.add('connecting');
        this.showToast('Click another node to connect', 'info');
    }

    // ============================================
    // VIEW CONTROLS
    // ============================================

    zoomIn() {
        this.zoom = Math.min(this.zoom * 1.2, 3.0);
    }

    zoomOut() {
        this.zoom = Math.max(this.zoom / 1.2, 0.3);
    }

    resetView() {
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
    }

    clearAll(isRemote = false) {
        if (!isRemote) {
            MiniGameUtils.ask({
                title: 'Clear the map?',
                body: 'Every node and connection goes, for everyone in the room.',
                confirmLabel: 'Clear it', danger: true
            }).then((yes) => {
                if (!yes) return;
                this._doClearAll();
                // The dialog promises "for everyone in the room" — this used to
                // be re-entered with isRemote=true, which skipped the broadcast
                // and silently forked the room.
                this.sendData({ type: 'clear-all' });
            });
            return;
        }

        this._doClearAll();
    }

    _doClearAll() {
        this.nodes.clear();
        this.connections = [];
        this.selectedNode = null;
        this.updateNodeCount();
    }

    // ============================================
    // EXPORT
    // ============================================

    exportImage() {
        // Create temporary canvas with white background
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = this.canvas.width;
        exportCanvas.height = this.canvas.height;
        const exportCtx = exportCanvas.getContext('2d');

        // White background
        exportCtx.fillStyle = 'white';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        // Copy current canvas
        exportCtx.drawImage(this.canvas, 0, 0);

        // Download
        exportCanvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mindmap-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);

            this.showToast('Image exported!', 'success');
        });
    }

    exportJSON() {
        const data = {
            nodes: Array.from(this.nodes.values()).map(node => ({
                id: node.id,
                x: node.x,
                y: node.y,
                text: node.text,
                color: node.color
            })),
            connections: this.connections.map(conn => ({
                from: conn.fromId,
                to: conn.toId
            }))
        };

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mindmap-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('JSON exported!', 'success');
    }

    // ============================================
    // RENDERING
    // ============================================

    startRenderLoop() {
        const render = () => {
            this.render();
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    render() {
        // Clear
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Apply transform
        this.ctx.save();
        this.ctx.translate(this.panX, this.panY);
        this.ctx.scale(this.zoom, this.zoom);

        // Draw connections
        this.connections.forEach(conn => {
            const fromNode = this.nodes.get(conn.fromId);
            const toNode = this.nodes.get(conn.toId);

            if (fromNode && toNode) {
                this.drawConnection(fromNode, toNode);
            }
        });

        // Connect-mode preview: a dashed line from the source node to the
        // pointer, so the user can see what they are about to connect.
        if (this.connectingMode && this.connectingFromNode &&
            this.mouseWorldX !== undefined && this.mouseWorldY !== undefined) {
            this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(this.connectingFromNode.x, this.connectingFromNode.y);
            this.ctx.lineTo(this.mouseWorldX, this.mouseWorldY);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw nodes
        this.nodes.forEach(node => {
            this.drawNode(node, node === this.selectedNode);
        });

        this.ctx.restore();

        // Remote cursors live in world coordinates; keep them pinned to the
        // map while this window pans or zooms.
        this.remoteCursors.forEach(cursor => this.positionRemoteCursor(cursor));
    }

    drawNode(node, isSelected = false) {
        const x = node.x;
        const y = node.y;
        const w = node.width;
        const h = node.height;

        // Shadow
        if (isSelected) {
            this.ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.ctx.shadowBlur = 15;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 4;
        }

        // Node rectangle
        this.ctx.fillStyle = node.color;
        this.ctx.strokeStyle = isSelected ? '#000' : 'rgba(0, 0, 0, 0.2)';
        this.ctx.lineWidth = isSelected ? 3 : 2;

        this.roundRect(x - w/2, y - h/2, w, h, 8);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;

        // Text
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 14px "Segoe UI"';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Wrap text
        const words = node.text.split(' ');
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const metrics = this.ctx.measureText(testLine);

            if (metrics.width > w - 20 && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });

        if (currentLine) lines.push(currentLine);

        const lineHeight = 18;
        const totalHeight = lines.length * lineHeight;
        const startY = y - totalHeight / 2 + lineHeight / 2;

        lines.forEach((line, i) => {
            this.ctx.fillText(line, x, startY + i * lineHeight);
        });
    }

    drawConnection(fromNode, toNode) {
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);

        this.ctx.beginPath();
        this.ctx.moveTo(fromNode.x, fromNode.y);
        this.ctx.lineTo(toNode.x, toNode.y);
        this.ctx.stroke();

        this.ctx.setLineDash([]);

        // Arrow head
        const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
        const arrowSize = 10;

        this.ctx.beginPath();
        this.ctx.moveTo(toNode.x, toNode.y);
        this.ctx.lineTo(
            toNode.x - arrowSize * Math.cos(angle - Math.PI / 6),
            toNode.y - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        this.ctx.lineTo(
            toNode.x - arrowSize * Math.cos(angle + Math.PI / 6),
            toNode.y - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        this.ctx.closePath();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.fill();
    }

    roundRect(x, y, w, h, r) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.closePath();
    }

    // ============================================
    // CURSORS
    // ============================================

    handleRemoteCursor(data) {
        if (data.username === this.username) return;

        let cursor = this.remoteCursors.get(data.username);

        if (!cursor) {
            const user = this.users.get(data.username);
            const color = user ? user.color : '#999';

            cursor = document.createElement('div');
            cursor.className = 'remote-cursor';
            cursor.style.color = color;
            cursor.innerHTML = `
                <div class="remote-cursor-icon"></div>
                <div class="remote-cursor-label">${MiniGameUtils.escapeHtml(data.username)}</div>
            `;

            document.getElementById('cursorsContainer').appendChild(cursor);
            this.remoteCursors.set(data.username, cursor);
        }

        // The wire carries world coordinates; place the cursor through this
        // window's own pan/zoom.
        cursor.dataset.worldX = data.x;
        cursor.dataset.worldY = data.y;
        this.positionRemoteCursor(cursor);
    }

    /** Project a remote cursor's world coordinates into this window's view. */
    positionRemoteCursor(cursor) {
        const wx = parseFloat(cursor.dataset.worldX);
        const wy = parseFloat(cursor.dataset.worldY);
        if (isNaN(wx) || isNaN(wy)) return;
        const x = wx * this.zoom + this.panX;
        const y = wy * this.zoom + this.panY;
        cursor.style.transform = `translate(${x}px, ${y}px)`;
    }

    // ============================================
    // SYNC
    // ============================================

    syncMapTo(username) {
        const data = {
            type: 'map-sync',
            nodes: Array.from(this.nodes.values()).map(node => ({
                id: node.id,
                x: node.x,
                y: node.y,
                text: node.text,
                color: node.color
            })),
            connections: this.connections.map(conn => ({
                fromId: conn.fromId,
                toId: conn.toId
            }))
        };

        this.sendData(data, username);
    }

    handleMapSync(data) {
        // Clear existing
        this.nodes.clear();
        this.connections = [];

        // Add nodes
        data.nodes.forEach(nodeData => {
            const node = new MindMapNode(
                nodeData.id,
                nodeData.x,
                nodeData.y,
                nodeData.text,
                nodeData.color
            );
            this.nodes.set(node.id, node);
        });

        // Add connections
        data.connections.forEach(connData => {
            this.connections.push(new Connection(connData.fromId, connData.toId));
        });

        this.updateNodeCount();
    }

    // ============================================
    // UI UPDATES
    // ============================================

    updateNodeCount() {
        document.getElementById('nodeCountNum').textContent = this.nodes.size;
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
    // INSTRUCTIONS
    // ============================================

    showInstructions() {
        const overlay = document.createElement('div');
        overlay.className = 'instructions-overlay';
        overlay.innerHTML = `
            <h3>Mind Map Controls</h3>
            <ul>
                <li>🖱️ <strong>Click & Drag</strong> - Move nodes</li>
                <li>🖱️ <strong>Double Click</strong> - Edit node text</li>
                <li>🖱️ <strong>Right Click</strong> - Context menu</li>
                <li>⌨️ <strong>A</strong> - Add new node</li>
                <li>⌨️ <strong>Del</strong> - Delete selected</li>
                <li>🖱️ <strong>Scroll</strong> - Zoom in/out</li>
                <li>🖱️ <strong>Drag Empty Space</strong> - Pan view</li>
            </ul>
            <button onclick="this.parentElement.remove()">Got it!</button>
        `;

        document.querySelector('.canvas-container').appendChild(overlay);

        setTimeout(() => {
            if (overlay.parentElement) {
                overlay.remove();
            }
        }, 10000);
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

let mindMapApp = null;
let isConnecting = false;

async function connectMindMap(username, channel, password) {
    if (isConnecting) {
        console.warn('[MindMap] Connection already in progress');
        return;
    }
    if (mindMapApp && mindMapApp.connected) {
        console.warn('[MindMap] Already connected');
        return;
    }

    isConnecting = true;

    try {
        mindMapApp = new MindMapApp();
        window.mindMapApp = mindMapApp;

        await mindMapApp.initialize();
        await mindMapApp.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });

        mindMapApp.start();

        // Update URL for sharing
        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' + channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }

        console.log('[MindMap] Connected and ready!');
    } catch (error) {
        console.error('[MindMap] Connection failed:', error);
        if (window.ConnectionModal) ConnectionModal.fail(error);
        mindMapApp = null;
    } finally {
        isConnecting = false;
    }
}

function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'mindmap_',
        channelPrefix: 'mindmap-',
        title: 'Join Mind Map',
        collapsedTitle: 'Mind Map',
        onConnect: function(username, channel, password) {
            connectMindMap(username, channel, password);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[MindMap] Page loaded');

    initializeConnectionModal();

    // Process shared link
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'MindMap',
            storagePrefix: 'mindmap_',
            connectCallback: async function() {
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectMindMap(username, channel, password);
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

