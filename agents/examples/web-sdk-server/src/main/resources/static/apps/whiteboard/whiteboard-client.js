/**
 * Real-Time Collaborative Whiteboard Client
 * Uses Messaging Platform SDK for real-time synchronization
 * Includes WhiteboardGame framework integration
 */
const STORAGE_KEY = 'whiteboard-data';

// ============================================
// ENCAPSULATED STATE CLASSES
// ============================================

/**
 * ViewportState - Encapsulates pan & zoom state
 */
class ViewportState {
    static instance = null;

    constructor() {
        if (ViewportState.instance) {
            return ViewportState.instance;
        }

        // Viewport transform
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;

        // Panning state
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.spaceKeyPressed = false;

        // Touch gesture state (for mobile pinch zoom)
        this.touchStartDistance = 0;
        this.touchStartZoom = 1;
        this.touchStartPanX = 0;
        this.touchStartPanY = 0;
        this.touchStartMidX = 0;
        this.touchStartMidY = 0;

        ViewportState.instance = this;
    }

    static getInstance() {
        if (!ViewportState.instance) {
            ViewportState.instance = new ViewportState();
        }
        return ViewportState.instance;
    }

    reset() {
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.spaceKeyPressed = false;
    }

    getTransform() {
        return { zoom: this.zoom, panX: this.panX, panY: this.panY };
    }

    setTransform(zoom, panX, panY) {
        this.zoom = zoom;
        this.panX = panX;
        this.panY = panY;
    }
}

/**
 * DrawingState - Encapsulates drawing tool state
 */
class DrawingState {
    static instance = null;

    constructor() {
        if (DrawingState.instance) {
            return DrawingState.instance;
        }

        this.drawing = false;
        this.currentTool = 'draw'; // 'draw', 'erase', 'hand', or 'magic'
        this.previousTool = 'draw';
        this.autoHandModeActive = false;
        this.currentColor = '#000';
        this.currentSize = 3;
        this.lastX = 0;
        this.lastY = 0;

        // Incremental smoothing buffer for local drawing
        this._currentPath = null;
        this._currentPathDrawnSegments = 0;

        // Canvas snapshot (to preserve imported images on resize)
        this.canvasSnapshot = null;

        DrawingState.instance = this;
    }

    static getInstance() {
        if (!DrawingState.instance) {
            DrawingState.instance = new DrawingState();
        }
        return DrawingState.instance;
    }

    setTool(tool) {
        this.previousTool = this.currentTool;
        this.currentTool = tool;
    }

    setColor(color) {
        this.currentColor = color;
    }

    setSize(size) {
        this.currentSize = size;
    }
}

/**
 * ConnectionState - Encapsulates connection/channel state
 */
class ConnectionState {
    static instance = null;

    constructor() {
        if (ConnectionState.instance) {
            return ConnectionState.instance;
        }

        this.username = '';
        this.channelName = '';
        this.channelPassword = '';
        this.connected = false;
        this.channel = null;
        this.webrtcHelper = null;

        // Sync Mode: 'auto-accept' (default), 'confirm', 'offline'
        this.syncMode = localStorage.getItem('whiteboardSyncMode') || 'auto-accept';

        // Connection attempt timeout
        this.connectionAttemptTimeout = null;

        // Sync lock
        this.syncInProgress = false;
        this.syncInitiator = null;

        ConnectionState.instance = this;
    }

    static getInstance() {
        if (!ConnectionState.instance) {
            ConnectionState.instance = new ConnectionState();
        }
        return ConnectionState.instance;
    }

    isConnected() {
        return this.connected && this.channel !== null;
    }

    disconnect() {
        this.connected = false;
        this.channel = null;
        this.webrtcHelper = null;
    }
}

/**
 * UserState - Encapsulates user tracking state
 */
class UserState {
    static instance = null;

    constructor() {
        if (UserState.instance) {
            return UserState.instance;
        }

        this.users = new Map();
        this.remoteCursors = new Map();
        this.remoteCursorTargets = new Map(); // target positions for smooth interpolation
        this.remoteCursorPredictions = new Map(); // predictive interpolation data

        // Cursor update throttling
        this.lastSentCursorX = -1;
        this.lastSentCursorY = -1;

        UserState.instance = this;
    }

    static getInstance() {
        if (!UserState.instance) {
            UserState.instance = new UserState();
        }
        return UserState.instance;
    }

    addUser(name, data) {
        this.users.set(name, data);
    }

    removeUser(name) {
        this.users.delete(name);
        this.remoteCursors.delete(name);
        this.remoteCursorTargets.delete(name);
        this.remoteCursorPredictions.delete(name);
    }

    clear() {
        this.users.clear();
        this.remoteCursors.forEach(cursor => {
            if (cursor && cursor.parentElement) {
                cursor.parentElement.removeChild(cursor);
            }
        });
        this.remoteCursors.clear();
        this.remoteCursorTargets.clear();
        this.remoteCursorPredictions.clear();
    }
}

/**
 * RenderState - Encapsulates rendering queue/buffer state
 */
class RenderState {
    static instance = null;

    constructor() {
        if (RenderState.instance) {
            return RenderState.instance;
        }

        // Stroke batching
        this.strokeBuffer = [];
        this.strokeBatchTimer = null;

        // Incoming rendering queue
        this.incomingStrokeQueue = [];
        this._renderLoopRunning = false;
        this._lastRenderTs = 0;

        // Prepared-draw buffering for initial load
        this.preparedDraw = [];
        this.preparedTimer = null;

        // Magic pen strokes
        this.magicStrokes = [];
        this.magicStrokeIdCounter = 0;

        RenderState.instance = this;
    }

    static getInstance() {
        if (!RenderState.instance) {
            RenderState.instance = new RenderState();
        }
        return RenderState.instance;
    }

    clearQueues() {
        this.strokeBuffer = [];
        this.incomingStrokeQueue.length = 0;
        this.preparedDraw = [];
        this.magicStrokes = [];
    }
}

/**
 * BoardStateManager - Encapsulates board state persistence
 */
class BoardStateManager {
    static instance = null;

    constructor() {
        if (BoardStateManager.instance) {
            return BoardStateManager.instance;
        }

        // Board state array
        this.boardState = [];

        // Broadcast state
        this.boardStateTimer = null;
        this.boardStateOrderNumber = 0;
        this.lastBroadcastStrokeCount = 0;
        this.lastBroadcastCanvasHash = null;

        // Idle detection
        this.lastDrawActivityTime = 0;

        // Message caching (for multi-part messages)
        this.boardStateCache = {
            latestOrderNumber: 0,
            currentOrderNumber: 0,
            totalParts: 0,
            receivedParts: {},
            receivedCount: 0
        };

        // Initial state loading
        this.isLoadingInitialState = false;
        this.initialStateLoaded = false;
        this.lastStrokeEventTime = 0;
        this.lastBoardStateMessageTime = 0;
        this.stateLoadingMaxTimeout = null;
        this.cachedInitialStrokes = [];

        // Canvas hash tracking
        this.lastReceivedCanvasHash = null;
        this.currentCanvasHash = null;

        BoardStateManager.instance = this;
    }

    static getInstance() {
        if (!BoardStateManager.instance) {
            BoardStateManager.instance = new BoardStateManager();
        }
        return BoardStateManager.instance;
    }

    addStroke(stroke) {
        this.boardState.push(stroke);
        this.lastDrawActivityTime = Date.now();
    }

    clear() {
        this.boardState = [];
        this.lastDrawActivityTime = Date.now();
    }

    getStrokes() {
        return this.boardState;
    }

    setStrokes(strokes) {
        this.boardState = strokes || [];
    }
}

/**
 * ============================================================================
 * PROFESSIONAL UNDO/REDO SYSTEM - Command Pattern with DataChannel Sync
 * ============================================================================
 *
 * This implements a professional undo/redo system using the Command Pattern:
 * - Each action (draw, clear, import) is encapsulated as a Command
 * - Commands can be executed, undone, and redone
 * - Actions are broadcast to other agents via DataChannel
 * - Supports both local and remote undo/redo operations
 */

/**
 * Base Command class - all actions inherit from this
 */
class Command {
    constructor(type, data = {}) {
        this.id = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.type = type;
        this.data = data;
        this.timestamp = Date.now();
        this.executedBy = null; // Will be set when executed
    }

    execute() { throw new Error('execute() must be implemented'); }
    undo() { throw new Error('undo() must be implemented'); }

    // Serialize for DataChannel transmission
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            data: this.data,
            timestamp: this.timestamp,
            executedBy: this.executedBy
        };
    }

    // Deserialize from DataChannel
    static fromJSON(json) {
        const cmd = new Command(json.type, json.data);
        cmd.id = json.id;
        cmd.timestamp = json.timestamp;
        cmd.executedBy = json.executedBy;
        return cmd;
    }
}

/**
 * DrawStrokesCommand - Handles adding strokes to the canvas
 */
class DrawStrokesCommand extends Command {
    constructor(strokes, executedBy) {
        super('draw-strokes', { strokes: strokes });
        this.executedBy = executedBy;
    }

    execute() {
        // Strokes are already added during drawing, this is for redo
        const strokes = this.data.strokes;
        strokes.forEach(stroke => {
            boardState.push(stroke);
        });
        redrawCanvas();
        console.log(`[Command] Executed DrawStrokesCommand: +${strokes.length} strokes`);
    }

    undo() {
        // Remove the strokes that were added
        const strokesToRemove = this.data.strokes.length;
        boardState.splice(-strokesToRemove, strokesToRemove);
        redrawCanvas();
        console.log(`[Command] Undone DrawStrokesCommand: -${strokesToRemove} strokes`);
    }
}

/**
 * ClearCanvasCommand - Handles clearing the canvas
 */
class ClearCanvasCommand extends Command {
    constructor(previousState, executedBy) {
        super('clear-canvas', { previousState: previousState });
        this.executedBy = executedBy;
    }

    execute() {
        // Clear is already executed, this is for redo
        boardState = [];
        redrawCanvas();
        console.log(`[Command] Executed ClearCanvasCommand`);
    }

    undo() {
        // Restore the previous state
        boardState = JSON.parse(JSON.stringify(this.data.previousState));
        redrawCanvas();
        console.log(`[Command] Undone ClearCanvasCommand: restored ${boardState.length} strokes`);
    }
}

/**
 * ImportImageCommand - Handles importing an image
 */
class ImportImageCommand extends Command {
    constructor(previousState, imageDataUrl, executedBy) {
        super('import-image', {
            previousState: previousState,
            imageDataUrl: imageDataUrl
        });
        this.executedBy = executedBy;
    }

    execute() {
        // Re-import the image (for redo)
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = this.data.imageDataUrl;
        console.log(`[Command] Executed ImportImageCommand`);
    }

    undo() {
        // Restore the previous state
        boardState = JSON.parse(JSON.stringify(this.data.previousState));
        redrawCanvas();
        console.log(`[Command] Undone ImportImageCommand`);
    }
}

/**
 * UndoRedoManager - Professional command-based history management
 */
class UndoRedoManager {
    static instance = null;

    constructor() {
        if (UndoRedoManager.instance) {
            return UndoRedoManager.instance;
        }

        this.undoStack = [];      // Commands that can be undone
        this.redoStack = [];      // Commands that can be redone
        this.maxHistorySize = 50; // Increased for better UX
        this.isExecuting = false; // Prevent re-entrancy
        this.localUsername = '';  // Set when connected

        UndoRedoManager.instance = this;
    }

    static getInstance() {
        if (!UndoRedoManager.instance) {
            UndoRedoManager.instance = new UndoRedoManager();
        }
        return UndoRedoManager.instance;
    }

    setLocalUsername(username) {
        this.localUsername = username;
    }

    /**
     * Record a new command (after it's been executed locally)
     * This adds to undo stack and clears redo stack
     */
    recordCommand(command) {
        if (this.isExecuting) return;

        command.executedBy = this.localUsername || 'local';

        this.undoStack.push(command);
        this.redoStack = []; // Clear redo on new action

        // Limit stack size
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        this.updateButtons();
        console.log(`[UndoRedo] Recorded: ${command.type} (id: ${command.id})`);
    }

    /**
     * Undo the last command
     * @param {boolean} broadcast - Whether to broadcast to other agents
     * @returns {Command|null} The undone command
     */
    undo(broadcast = true) {
        if (this.undoStack.length === 0) {
            console.log('[UndoRedo] Nothing to undo');
            return null;
        }

        this.isExecuting = true;

        try {
            const command = this.undoStack.pop();
            command.undo();
            this.redoStack.push(command);

            // Limit redo stack
            if (this.redoStack.length > this.maxHistorySize) {
                this.redoStack.shift();
            }

            this.updateButtons();

            // Broadcast to other agents
            if (broadcast) {
                this.broadcastAction('undo', command);
            }

            console.log(`[UndoRedo] Undo: ${command.type} (stack: ${this.undoStack.length} undo, ${this.redoStack.length} redo)`);
            return command;

        } finally {
            this.isExecuting = false;
        }
    }

    /**
     * Redo the last undone command
     * @param {boolean} broadcast - Whether to broadcast to other agents
     * @returns {Command|null} The redone command
     */
    redo(broadcast = true) {
        if (this.redoStack.length === 0) {
            console.log('[UndoRedo] Nothing to redo');
            return null;
        }

        this.isExecuting = true;

        try {
            const command = this.redoStack.pop();
            command.execute();
            this.undoStack.push(command);

            // Limit undo stack
            if (this.undoStack.length > this.maxHistorySize) {
                this.undoStack.shift();
            }

            this.updateButtons();

            // Broadcast to other agents
            if (broadcast) {
                this.broadcastAction('redo', command);
            }

            console.log(`[UndoRedo] Redo: ${command.type} (stack: ${this.undoStack.length} undo, ${this.redoStack.length} redo)`);
            return command;

        } finally {
            this.isExecuting = false;
        }
    }

    /**
     * Apply a remote undo/redo action from another agent
     * NOTE: We receive lightweight messages, so we undo/redo our OWN local state
     * This keeps all clients in sync without sending huge data payloads
     * @param {string} action - 'undo' or 'redo'
     * @param {Object} messageData - The lightweight message data
     * @param {string} fromAgent - Who sent this action
     */
    applyRemoteAction(action, messageData, fromAgent) {
        console.log(`[UndoRedo] Received remote ${action} from ${fromAgent}:`, messageData);

        // Show toast notification for the remote action
        showUndoRedoToast(fromAgent, action);

        // NOTE: We DON'T actually apply undo/redo here!
        // The remote user has already applied their change and broadcast strokes/clear via DataChannel
        // Their drawing changes come through the normal stroke-batch/clear handlers
        // This message is just for notification purposes

        console.log(`[UndoRedo] Remote ${action} notification received - canvas will sync via normal DataChannel events`);
    }

    /**
     * Reconstruct a command from serialized data
     */
    reconstructCommand(data) {
        switch (data.type) {
            case 'draw-strokes':
                const drawCmd = new DrawStrokesCommand(data.data.strokes, data.executedBy);
                drawCmd.id = data.id;
                drawCmd.timestamp = data.timestamp;
                return drawCmd;
            case 'clear-canvas':
                const clearCmd = new ClearCanvasCommand(data.data.previousState, data.executedBy);
                clearCmd.id = data.id;
                clearCmd.timestamp = data.timestamp;
                return clearCmd;
            case 'import-image':
                const importCmd = new ImportImageCommand(
                    data.data.previousState,
                    data.data.imageDataUrl,
                    data.executedBy
                );
                importCmd.id = data.id;
                importCmd.timestamp = data.timestamp;
                return importCmd;
            default:
                console.warn(`[UndoRedo] Unknown command type: ${data.type}`);
                return null;
        }
    }

    /**
     * Broadcast undo/redo action to all connected agents
     * NOTE: We send a LIGHTWEIGHT message, not the full command data
     * Each client will undo/redo their own local state
     */
    broadcastAction(action, command) {
        if (!webrtcHelper || !connected) {
            console.log('[UndoRedo] Not connected, skipping broadcast');
            return;
        }

        // Create a lightweight message - DON'T send full command data
        // (which can be huge for clear/import commands with full boardState)
        const message = {
            type: 'undo-redo-action',
            action: action, // 'undo' or 'redo'
            commandType: command.type, // Just the type, not full data
            commandId: command.id,
            strokeCount: command.data.strokes ? command.data.strokes.length : 0,
            sender: this.localUsername || 'unknown',
            timestamp: Date.now()
        };

        // Broadcast to all connected peers
        webrtcHelper.broadcastDataChannel(message);
    }

    /**
     * Update undo/redo button states
     * OVERRIDE: Keep buttons permanently disabled - undo/redo not supported in whiteboard yet
     */
    updateButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        // Force buttons to stay disabled - undo/redo will be supported in future
        if (undoBtn) {
            undoBtn.disabled = true;
        }
        if (redoBtn) {
            redoBtn.disabled = true;
        }
    }

    /**
     * Clear all history
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.updateButtons();
        console.log('[UndoRedo] History cleared');
    }

    /**
     * Get current state for debugging
     */
    getState() {
        return {
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length,
            lastUndo: this.undoStack[this.undoStack.length - 1]?.type || 'none',
            lastRedo: this.redoStack[this.redoStack.length - 1]?.type || 'none'
        };
    }
}

// Create singleton instance
const undoRedoManager = UndoRedoManager.getInstance();

/**
 * Show toast notification for undo/redo actions
 */
function showUndoRedoToast(username, action) {
    const icon = action === 'undo' ? '↶' : '↷';
    const actionText = action === 'undo' ? 'undid' : 'redid';
    showToast(`${icon} ${username} ${actionText} an action`, 2000);
}

/**
 * HistoryManager - Legacy wrapper for backward compatibility
 * Delegates to UndoRedoManager internally
 */
class HistoryManager {
    static instance = null;

    constructor() {
        if (HistoryManager.instance) {
            return HistoryManager.instance;
        }

        // Delegate to UndoRedoManager
        this.undoRedoManager = UndoRedoManager.getInstance();

        // Legacy properties (for backward compatibility)
        this.historyStack = [];
        this.redoStack = [];
        this.isRestoringHistory = false;
        this.maxHistorySize = 50;

        HistoryManager.instance = this;
    }

    static getInstance() {
        if (!HistoryManager.instance) {
            HistoryManager.instance = new HistoryManager();
        }
        return HistoryManager.instance;
    }

    pushState(snapshot) {
        // Convert legacy snapshot to command
        if (snapshot && snapshot.addedStrokes && snapshot.addedStrokes.length > 0) {
            const command = new DrawStrokesCommand(
                snapshot.addedStrokes,
                this.undoRedoManager.localUsername || 'local'
            );
            this.undoRedoManager.recordCommand(command);
        }
    }

    undo() {
        return this.undoRedoManager.undo(true);
    }

    redo() {
        return this.undoRedoManager.redo(true);
    }

    clear() {
        this.undoRedoManager.clear();
    }
}

/**
 * OptimizationState - Encapsulates optimization/performance state
 */
class OptimizationState {
    static instance = null;

    constructor() {
        if (OptimizationState.instance) {
            return OptimizationState.instance;
        }

        // Adaptive send rate
        this.currentSendInterval = 4;
        this.lastStrokeDistance = 0;

        // Compression stats
        this.compressionStatsTotal = 0;
        this.compressionStatsSaved = 0;

        OptimizationState.instance = this;
    }

    static getInstance() {
        if (!OptimizationState.instance) {
            OptimizationState.instance = new OptimizationState();
        }
        return OptimizationState.instance;
    }

    updateSendRate(distance) {
        this.lastStrokeDistance = distance;
        if (distance > 10) {
            this.currentSendInterval = Math.max(2, this.currentSendInterval - 1);
        } else if (distance < 5) {
            this.currentSendInterval = Math.min(12, this.currentSendInterval + 1);
        }
    }
}

// ============================================
// CREATE SINGLETON INSTANCES
// ============================================
const viewportState = ViewportState.getInstance();
const drawingState = DrawingState.getInstance();
const connectionState = ConnectionState.getInstance();
const userState = UserState.getInstance();
const renderState = RenderState.getInstance();
const boardStateManager = BoardStateManager.getInstance();
const historyManager = HistoryManager.getInstance();
const optimizationState = OptimizationState.getInstance();

// ============================================
// LEGACY VARIABLE ALIASES (for backward compatibility during migration)
// These reference the encapsulated state - will be gradually removed
// ============================================
let canvas = null;
let ctx = null;
let magicCanvas = null;
let magicCtx = null;

// ...existing code...

/**
 * WhiteboardCanvas - Encapsulates ALL canvas operations and state
 * Singleton pattern - only one instance exists
 */
class WhiteboardCanvas {
    constructor() {
        // Canvas elements (initialized lazily when DOM is ready)
        this.canvas = null;
        this.ctx = null;
        this.magicCanvas = null;
        this.magicCtx = null;

        // Canvas state
        this.boardState = [];
        this.magicStrokes = [];
        this.incomingStrokeQueue = [];

        // Canvas snapshot
        this.canvasSnapshot = null;
    }

    /**
     * Initialize canvas elements from DOM (called when DOM is ready)
     * Returns true if successful, false if elements not ready
     */
    initialize() {
        // Get canvas elements from DOM
        this.canvas = document.getElementById('canvas');
        this.magicCanvas = document.getElementById('magicCanvas');

        if (!this.canvas || !this.magicCanvas) {
            console.warn('[WhiteboardCanvas] Canvas elements not found in DOM yet');
            return false;
        }

        // Get contexts
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.magicCtx = this.magicCanvas.getContext('2d');

        // Set canvas dimensions
        this.canvas.width = CANVAS_CONFIG.WIDTH;
        this.canvas.height = CANVAS_CONFIG.HEIGHT;
        this.magicCanvas.width = CANVAS_CONFIG.WIDTH;
        this.magicCanvas.height = CANVAS_CONFIG.HEIGHT;

        console.log('[WhiteboardCanvas] Initialized:', this.canvas.width, 'x', this.canvas.height);
        return true;
    }

    /**
     * Check if canvas is initialized
     */
    isInitialized() {
        return this.canvas !== null && this.ctx !== null;
    }

    /**
     * Get canvas element
     */
    getCanvas() {
        return this.canvas;
    }

    /**
     * Get canvas context
     */
    getContext() {
        return this.ctx;
    }

    /**
     * Get magic canvas context
     */
    getMagicContext() {
        return this.magicCtx;
    }

    /**
     * Clear canvas
     */
    /**
     * Clear canvas - uses global variables
     */
    clear() {
        const canvasElement = (typeof canvas !== 'undefined' && canvas) ? canvas : this.canvas;
        const ctxElement = (typeof ctx !== 'undefined' && ctx) ? ctx : this.ctx;
        const magicCanvasElement = (typeof magicCanvas !== 'undefined' && magicCanvas) ? magicCanvas : this.magicCanvas;
        const magicCtxElement = (typeof magicCtx !== 'undefined' && magicCtx) ? magicCtx : this.magicCtx;

        if (ctxElement && canvasElement) {
            ctxElement.clearRect(0, 0, canvasElement.width, canvasElement.height);
        }
        if (magicCtxElement && magicCanvasElement) {
            magicCtxElement.clearRect(0, 0, magicCanvasElement.width, magicCanvasElement.height);
        }

        // Clear global arrays
        if (typeof boardState !== 'undefined' && boardState) {
            boardState.length = 0;
        }
        if (typeof magicStrokes !== 'undefined' && magicStrokes) {
            magicStrokes.length = 0;
        }
        if (typeof incomingStrokeQueue !== 'undefined' && incomingStrokeQueue) {
            incomingStrokeQueue.length = 0;
        }

        // Also clear instance arrays
        this.boardState = [];
        this.magicStrokes = [];
        this.incomingStrokeQueue = [];
    }

    /**
     * Add stroke to board state - uses global boardState
     */
    addStroke(stroke) {
        if (stroke.isMagic) {
            this.addMagicStroke(stroke);
        } else {
            // Use global boardState if available
            const boardStateArray = (typeof boardState !== 'undefined' && boardState) ? boardState : this.boardState;
            boardStateArray.push(stroke);
        }
    }

    /**
     * Add magic stroke
     */
    addMagicStroke(stroke) {
        const now = Date.now();
        stroke.expiresAt = now + MAGIC_PEN_DURATION;

        // Add to global magicStrokes array so cleanup function can find it
        magicStrokes.push(stroke);

        // Also add to instance array for reference
        this.magicStrokes.push(stroke);

        // Use either instance magicCtx or global magicCtx (fallback for legacy code)
        const ctx = this.magicCtx || (typeof magicCtx !== 'undefined' ? magicCtx : null);

        // Draw immediately only if canvas is initialized
        if (!ctx) {
            console.warn('[WhiteboardCanvas] magicCtx not initialized yet, stroke queued for later drawing');
            // Start cleanup timer even if not drawn yet
            startMagicPenCleanup();
            return;
        }

        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.moveTo(stroke.x1, stroke.y1);
        ctx.lineTo(stroke.x2, stroke.y2);
        ctx.strokeStyle = stroke.erase ? '#ffffff' : stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();

        // Start cleanup timer
        startMagicPenCleanup();
    }

    /**
     * Get board state (uses global boardState which is the actual array being used)
     */
    getBoardState() {
        return (typeof boardState !== 'undefined' && boardState) ? boardState : this.boardState;
    }

    /**
     * Set board state
     */
    setBoardState(strokes) {
        this.boardState = strokes || [];
    }

    /**
     * Capture canvas snapshot
     * Uses global canvas variable since that's what gets initialized
     */
    captureSnapshot() {
        // Use global canvas variable instead of this.canvas
        const canvasElement = (typeof canvas !== 'undefined' && canvas) ? canvas : this.canvas;

        if (!canvasElement) {
            console.warn('[WhiteboardCanvas] Cannot capture snapshot - canvas not initialized');
            return null;
        }

        try {
            const dataUrl = canvasElement.toDataURL('image/png');
            this.canvasSnapshot = dataUrl;
            return {
                dataUrl: dataUrl,
                dataSize: dataUrl.length,
                dimensions: {
                    canvasWidth: canvasElement.width,
                    canvasHeight: canvasElement.height
                }
            };
        } catch (e) {
            console.error('[WhiteboardCanvas] Failed to capture snapshot:', e);
            return null;
        }
    }

    /**
     * Restore canvas from snapshot
     */
    restoreFromSnapshot(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
                resolve();
            };
            img.onerror = (err) => reject(err);
            img.src = dataUrl;
        });
    }

    /**
     * Redraw all strokes
     */
    redrawAll() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.canvasSnapshot) {
            this.restoreFromSnapshot(this.canvasSnapshot).catch(() => {
                // Fallback: redraw strokes
                this.boardState.forEach(stroke => this.drawStroke(stroke));
            });
        } else {
            this.boardState.forEach(stroke => this.drawStroke(stroke));
        }
    }

    /**
     * Draw a single stroke
     */
    drawStroke(stroke) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(stroke.x1, stroke.y1);
        this.ctx.lineTo(stroke.x2, stroke.y2);
        this.ctx.strokeStyle = stroke.erase ? '#ffffff' : stroke.color;
        this.ctx.lineWidth = stroke.size;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
        this.ctx.stroke();
        this.ctx.restore();
    }

    /**
     * Enqueue stroke for rendering
     */
    enqueueStroke(stroke, peerId) {
        this.incomingStrokeQueue.push({ stroke, peerId });
    }

    /**
     * Enqueue multiple strokes
     */
    enqueueStrokes(strokes, peerId) {
        strokes.forEach(stroke => this.enqueueStroke(stroke, peerId));
    }

    /**
     * Get incoming stroke queue
     */
    getIncomingQueue() {
        return this.incomingStrokeQueue;
    }

    /**
     * Clear incoming stroke queue
     */
    clearIncomingQueue() {
        this.incomingStrokeQueue = [];
    }
}

// Create singleton instance
const whiteboardCanvas = new WhiteboardCanvas();

// Helper functions to access canvas from legacy code (avoids window. assignment)
function getWhiteboardCanvas() {
    return whiteboardCanvas;
}


/**
 * Whiteboard Game Class - Integration with Common Game Framework
 * Wraps existing whiteboard logic with BaseGame structure
 */
class WhiteboardGame extends AgentInteractionBase {
    constructor() {
        super({
            storagePrefix: 'whiteboard',
            customType: 'whiteboard',
            autoCreateDataChannel: true,
            dataChannelName: 'whiteboard-draw',
            dataChannelOptions: {
                ordered: false,      // Fast unordered delivery
                maxRetransmits: 0    // No retransmits for real-time
            },
            supportsPauseResume: false  // Whiteboard doesn't support pause/resume
        });

        // Whiteboard-specific state (references to global state)
        this.users = null;           // Will reference global users Map
        this.remoteCursors = null;   // Will reference global remoteCursors Map
        this.remoteCursorTargets = null; // Will reference global remoteCursorTargets Map

        // Use singleton canvas instance (no need to create new one)
        this.whiteboardCanvas = whiteboardCanvas;
    }

    /**
     * Initialize with references to whiteboard state
     */
    initializeWhiteboardState(users, remoteCursors, remoteCursorTargets) {
        this.users = users;
        this.remoteCursors = remoteCursors;
        this.remoteCursorTargets = remoteCursorTargets;

        // Try to initialize canvas (will succeed if DOM is ready)
        // If not ready, it will be initialized in onConnect
        this.whiteboardCanvas.initialize();
    }

    /**
     * Get canvas instance
     */
    getCanvas() {
        return this.whiteboardCanvas;
    }

    /**
     * Pause - Not supported for whiteboard (override to prevent base class behavior)
     * Whiteboard is collaborative and always active, cannot be paused
     */
    pauseGame(reason) {
        // Whiteboard doesn't support pause - ignore
        console.log('[WhiteboardGame] Pause not supported - whiteboard is always active');
    }

    /**
     * Resume - Not supported for whiteboard (override to prevent base class behavior)
     * Whiteboard is collaborative and always active, cannot be resumed
     */
    resumeGame() {
        // Whiteboard doesn't support resume - ignore
        console.log('[WhiteboardGame] Resume not supported - whiteboard is always active');
    }

    /**
     * Pause callback - Not supported for whiteboard (override to prevent base class behavior)
     */
    onGamePaused(reason) {
        // Override to prevent showing pause messages
        // Whiteboard doesn't pause, so ignore this callback
    }

    /**
     * Resume callback - Not supported for whiteboard (override to prevent base class behavior)
     */
    onGameResumed() {
        // Override to prevent showing resume messages
        // Whiteboard doesn't resume, so ignore this callback
    }

    /**
     * Add chat message to UI
     */
    _addChatMessage(from, message, color = '#333') {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        const msgElement = document.createElement('div');
        msgElement.className = 'chat-message';
        msgElement.innerHTML = `<strong style="color: ${color}">${from}:</strong> ${message}`;
        chatMessages.appendChild(msgElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    /**
     * Update user list UI
     */
    _updateUserList() {
        const userListEl = document.getElementById('userList');
        if (!userListEl || !this.users) return;

        let html = '';

        // Add yourself
        html += `<div class="user-item"><span class="user-color" style="background: ${window.currentColor || '#000'}"></span>${this.username} (You)</div>`;

        // Add other users
        this.users.forEach((user, name) => {
            if (name !== this.username) {
                html += `<div class="user-item"><span class="user-color" style="background: ${user.color}"></span>${name}</div>`;
            }
        });

        userListEl.innerHTML = html;

        // Update user count badge - use BaseGame method that already includes self
        const badge = document.getElementById('userCountBadge');
        if (badge) {
            badge.textContent = this.getPlayerCount();
        }
    }

    /**
     * Send canvas state to specific agent via channel storage
     * Public method - called from global sendBoardStateToAgent function
     */
    sendBoardStateToAgent(agentId, actionType = 'sync') {
        // Check if sync is already in progress
        if (connectionState.syncInProgress) {
            console.log(`[WhiteboardGame] Sync already in progress, skipping send to ${agentId}`);
            return;
        }

        if (!connectionState.connected || !this.channel) {
            console.log(`[WhiteboardGame] Not ready to send to ${agentId} - connected: ${connectionState.connected}, channel: ${!!this.channel}`);
            return;
        }

        // Set sync lock
        connectionState.syncInProgress = true;
        connectionState.syncInitiator = 'sender';
        console.log(`[WhiteboardGame] 🔒 Sync lock acquired for ${agentId}`);

        console.log(`[WhiteboardGame] Syncing canvas to ${agentId} via Channel Storage...`);

        // Capture canvas snapshot using canvas instance
        const snapshot = this.whiteboardCanvas.captureSnapshot();
        if (!snapshot) {
            console.log(`[WhiteboardGame] Canvas is empty, skipping`);
            connectionState.syncInProgress = false;
            connectionState.syncInitiator = null;
            return;
        }

        const {dataUrl, dataSize} = snapshot;

        // Validate data URL
        if (!dataUrl || dataUrl.length < 100) {
            console.error(`[WhiteboardGame] Invalid canvas data`);
            connectionState.syncInProgress = false;
            connectionState.syncInitiator = null;
            return;
        }

        console.log(`[WhiteboardGame] Canvas size: ${Math.round(dataSize / 1024)}KB`);

        // Prepare board state data using canvas instance
        const boardStateData = {
            strokes: this.whiteboardCanvas.getBoardState(),
            canvasSnapshot: dataUrl,
            timestamp: Date.now(),
            author: this.username,
            version: STORAGE_FORMAT_VERSION.VERSION_1
        };

        const metadata = {
            contentType: 'application/json',
            description: `Whiteboard synced by ${this.username}`,
            version: STORAGE_FORMAT_VERSION.VERSION_1,
            properties: {
                strokeCount: this.whiteboardCanvas.getBoardState().length,
                savedBy: this.username,
                savedAt: new Date().toISOString(),
                actionType: actionType
            }
        };

        // Save to channel storage
        putChannelStorage(
            boardStateData,
            metadata,
            (response) => {
                console.log(`[WhiteboardGame] ✓ Saved to channel storage`);
                this.sendCanvasSyncNotification(agentId, actionType);

                setTimeout(() => {
                    connectionState.syncInProgress = false;
                    connectionState.syncInitiator = null;
                    console.log(`[WhiteboardGame] 🔓 Sync lock released`);
                }, 500);
            },
            (response) => {
                console.error(`[WhiteboardGame] Failed to save:`, response);
                connectionState.syncInProgress = false;
                connectionState.syncInitiator = null;
            }
        );
    }

    /**
     * Send notification that canvas is ready in storage
     * Public method - called from global sendCanvasSyncNotification function
     */
    sendCanvasSyncNotification(agentId, actionType) {
        if (!this.webrtcHelper) return;

        const notification = {
            type: 'canvas-sync-storage',
            action: actionType,
            timestamp: Date.now(),
            sender: this.username
        };

        this.webrtcHelper.sendData(agentId, notification);
        console.log(`[WhiteboardGame] Sent canvas sync notification to ${agentId}`);
    }

    /**
     * Handle connection
     */
    onConnect(detail) {
        console.log('[WhiteboardGame] Connected via framework:', detail);

        // Ensure canvas is initialized (if not already done)
        if (!this.whiteboardCanvas.isInitialized()) {
            this.whiteboardCanvas.initialize();
        }

        // Update connection state singleton
        connectionState.channel = this.channel;
        connectionState.webrtcHelper = this.webrtcHelper;
        connectionState.connected = true;

        // Set legacy module-level variables (for backward compatibility)
        channel = this.channel;
        webrtcHelper = this.webrtcHelper;
        connected = true;

        // Set username in UndoRedoManager for proper attribution
        undoRedoManager.setLocalUsername(this.username);

        // Expose canvas elements (only if initialized)
        if (this.whiteboardCanvas.isInitialized()) {
            // Set legacy global variables from singleton
            canvas = this.whiteboardCanvas.canvas;
            ctx = this.whiteboardCanvas.ctx;
            magicCanvas = this.whiteboardCanvas.magicCanvas;
            magicCtx = this.whiteboardCanvas.magicCtx;
            boardState = this.whiteboardCanvas.boardState;
            incomingStrokeQueue = this.whiteboardCanvas.incomingStrokeQueue;

            console.log('[WhiteboardGame] Canvas exposed:', canvas.width, 'x', canvas.height);
        } else {
            console.warn('[WhiteboardGame] Canvas not initialized yet');
        }

        // Notify about initial agents already in the whiteboard
        if (detail.users && detail.users.length > 0) {
            console.log('[WhiteboardGame] Initial agents in whiteboard:', detail.users);

            detail.users.forEach(agentName => {
                if (agentName !== this.username) {
                    // Get the user from this.users (already added by BaseGame)
                    const user = this.users.get(agentName);
                    if (user) {
                        // Show notification for initial user
                        this.showToast(`${agentName} is already here`, 'info');

                        // Add chat message
                        this._addChatMessage('System', `${agentName} is already here`, '#2196F3');
                    }
                }
            });

            // Update UI to show all users
            this._updateUserList();
        }

        // Lock board for non-host users until DataChannel is established
        if (!this.isHost() && detail.users && detail.users.length > 0) {
            lockBoard('Establishing connection to whiteboard...');
            console.log('[WhiteboardGame] Board locked for non-host - waiting for DataChannel');
        }

        // Show share notification balloon after connection is ready
        // Wait a moment for UI to settle and share button to be positioned
        setTimeout(() => {
            if (typeof showShareNotificationBalloon === 'function') {
                showShareNotificationBalloon();
            }
        }, 500);
    }

    /**
     * Handle player joining (loading state)
     */
    onPlayerJoining(detail) {
        console.log('[WhiteboardGame] Player joining:', detail.agentName);

        const agentName = detail.agentName;
        if (agentName === this.username) return;

        // Show loading notification
        this.showToast(`${agentName} is joining...`, 'info', 2000);

        // Add chat message
        this._addChatMessage('System', `${agentName} is joining the whiteboard...`, '#2196F3');
    }

    /**
     * Handle player join - integrated whiteboard logic
     */
    onPlayerJoin(detail) {
        console.log('[WhiteboardGame] Player joined successfully:', detail.agentName);

        const agentName = detail.agentName;
        if (agentName === this.username) return;

        // Show success notification
        this.showToast(`✅ ${agentName} joined the whiteboard!`, 'success');

        // Add to users map with color
        const color = this.generateUserColor(agentName);
        this.users.set(agentName, { color: color });

        // Add chat message
        this._addChatMessage('System', `${agentName} joined the whiteboard`, '#4CAF50');

        // Update UI
        this._updateUserList();

        console.log(`[WhiteboardGame] DataChannel established with ${agentName}`);
    }

    /**
     * Handle player leave - integrated whiteboard logic
     */
    onPlayerLeave(detail) {
        console.log('[WhiteboardGame] Player left:', detail.agentName);

        const agentName = detail.agentName;
        if (agentName === this.username) return;

        // Show notification (BaseGame method)
        this.showLeaveNotification(agentName);

        // Remove from users map
        this.users.delete(agentName);

        // Add chat message
        this._addChatMessage('System', `${agentName} left the whiteboard`, '#f44336');

        // Remove remote cursor
        const cursor = this.remoteCursors.get(agentName);
        if (cursor && cursor.parentElement) {
            cursor.parentElement.removeChild(cursor);
        }
        this.remoteCursors.delete(agentName);

        // Remove cursor target
        this.remoteCursorTargets.delete(agentName);

        // Close DataChannel
        if (this.webrtcHelper) {
            this.webrtcHelper.closeDataChannel(agentName);
        }

        // Update UI
        this._updateUserList();
    }

    /**
     * Handle chat messages
     */
    onChat(detail) {
        console.log('[WhiteboardGame] Chat from', detail.from, ':', detail.message);
        this._addChatMessage(detail.from, detail.message, '#333');
    }

    /**
     * Handle DataChannel open - new peer will fetch from storage
     */
    onDataChannelOpen(peerId) {
        console.log('[WhiteboardGame] DataChannel opened with', peerId);

        // Unlock board if it was locked (non-host user waiting for connection)
        if (isBoardLocked) {
            unlockBoard();
            this.showToast('✅ Connected! You can now draw on the whiteboard', 'success', 3000);
            console.log('[WhiteboardGame] Board unlocked - DataChannel ready');
        }

        // NOTE: We DON'T send board state here anymore!
        // The new peer will automatically fetch from channel storage API instead.
        // This prevents duplicate sync operations and ensures single source of truth.

        console.log('[WhiteboardGame] New peer will fetch canvas from storage (no push needed)');
    }

    /**
     * Handle DataChannel message - receive P2P drawing events
     */
    onDataChannelMessage(peerId, data) {
        console.log(`[WhiteboardGame] DataChannel message from ${peerId}:`, data.type);

        const type = data.type;
        const syncMode = window.syncMode || 'auto-accept';

        // OFFLINE MODE: Block incoming drawing events (except cursor)
        if (syncMode === 'offline' && type !== 'cursor') {
            console.log(`[WhiteboardGame] ⛔ OFFLINE MODE - Ignoring ${type} from ${peerId}`);
            return;
        }

        // Handle stroke-batch-binary
        if (type === 'stroke-batch-binary' && data.binaryStrokes) {
            const strokes = decodeStrokesBinary(new Float32Array(data.binaryStrokes));
            if (strokes && strokes.length > 0) {
                // Add to global queue for rendering (use local variable that render loop reads from)
                strokes.forEach(stroke => {
                    stroke.peerId = peerId;
                    incomingStrokeQueue.push(stroke);  // ✅ Use local variable
                    this.whiteboardCanvas.addStroke(stroke);
                });
                console.log(`[WhiteboardGame] Received ${strokes.length} binary strokes from ${peerId}`);
            }
        }
        // Handle stroke-batch (JSON)
        else if (type === 'stroke-batch' && data.strokes) {
            // Add to global queue for rendering
            data.strokes.forEach(stroke => {
                stroke.peerId = peerId;
                incomingStrokeQueue.push(stroke);  // ✅ Use local variable
                this.whiteboardCanvas.addStroke(stroke);
            });
            console.log(`[WhiteboardGame] Received ${data.strokes.length} JSON strokes from ${peerId}`);
        }
        // Handle single stroke
        else if (type === 'stroke' && data.stroke) {
            data.stroke.peerId = peerId;
            incomingStrokeQueue.push(data.stroke);  // ✅ Use local variable
            this.whiteboardCanvas.addStroke(data.stroke);
        }
        // Handle clear
        else if (type === 'clear') {
            this.whiteboardCanvas.clear();
            incomingStrokeQueue.length = 0;  // ✅ Clear local variable
            console.log(`[WhiteboardGame] Canvas cleared by ${peerId}`);
            showClearToast(peerId);
        }
        // Handle cursor
        else if (type === 'cursor' && data.x !== undefined && data.y !== undefined) {
            this.remoteCursorTargets.set(peerId, {
                x: data.x,
                y: data.y,
                color: data.color || '#667eea'
            });
        }
        // Handle canvas-sync-storage
        else if (type === 'canvas-sync-storage') {
            console.log(`[WhiteboardGame] Received canvas sync notification from ${peerId}`);
            if (data.sender !== this.username) {
                fetchCanvasFromStorage(peerId, data.action);
            }
        }
        // Handle board-state-chunk
        else if (type === 'board-state-chunk' && peerId !== this.username) {
            handleBoardStateChunk(peerId, data);
        }
        // Handle undo-redo-action from other agents (lightweight notification)
        else if (type === 'undo-redo-action') {
            console.log(`[WhiteboardGame] Received ${data.action} notification from ${data.sender} (${data.commandType})`);

            // Don't process our own actions
            if (data.sender === this.username) {
                console.log('[WhiteboardGame] Ignoring own undo-redo notification');
                return;
            }

            // Show notification about the remote action
            // The actual canvas sync will happen via storage fetch or stroke events
            undoRedoManager.applyRemoteAction(data.action, data, data.sender);
        }
    }

    /**
     * Handle channel error event
     */
    onError(error) {
        console.error('[WhiteboardGame] Channel error:', error);

        const resp = error.response || error.error || error || {};
        const errorMsg = resp.statusMessage || resp.message || resp.error || 'Connection error occurred';

        // Display error
        this._addChatMessage('Error', errorMsg, '#f44336');
        this.showToast(errorMsg, 'error', 5000);

        // Show connection modal
        showConnectionModal();

        // Update state
        connectionState.connected = false;
        connected = false;
        if (connectionState.connectionAttemptTimeout) {
            clearTimeout(connectionState.connectionAttemptTimeout);
            connectionState.connectionAttemptTimeout = null;
        }
    }

    /**
     * Handle disconnect event
     */
    onDisconnect() {
        console.log('[WhiteboardGame] Disconnected from channel');

        // Reset state
        connectionState.connected = false;
        connected = false;
        boardStateManager.initialStateLoaded = false;
        boardStateManager.lastBroadcastStrokeCount = 0;

        // Clear users
        this.users.clear();

        // Clear cursors
        this.remoteCursors.forEach(cursor => {
            if (cursor && cursor.parentElement) {
                cursor.parentElement.removeChild(cursor);
            }
        });
        this.remoteCursors.clear();
        this.remoteCursorTargets.clear();

        // Update UI
        this._updateUserList();
        updateUserCountBadge();

        // Update connection status
        const connEl = document.querySelector('.connection-status');
        if (connEl) {
            connEl.dataset.status = 'Disconnected';
            connEl.classList.remove('online');
            connEl.classList.add('offline');
        }

        // Show notifications
        this.showToast('Disconnected from whiteboard. Please reconnect.', 'warning');
        this._addChatMessage('System', 'You have been disconnected. Please reconnect to continue.', '#ff9800');

        // Show connection modal
        showConnectionModal();
    }
}

// Module-level whiteboard game instance (avoids window. assignment)
let whiteboardGame = null;

console.log('[WhiteboardGame] Framework integration loaded');

// ============================================
// CANVAS CONFIGURATION - Pan & Zoom System
// ============================================

// Fixed canvas dimensions (FHD - Full HD)
const CANVAS_CONFIG = {
    // Fixed canvas dimensions (absolute coordinate space)
    WIDTH: 1920,
    HEIGHT: 1080,

    // Default view settings
    DEFAULT_ZOOM: 1.0,
    MIN_ZOOM: 0.1,  // Zoom out to 10%
    MAX_ZOOM: 5.0,  // Zoom in to 500%
    ZOOM_STEP: 0.1, // Zoom increment for buttons
    ZOOM_WHEEL_STEP: 0.05, // Smaller steps for smoother mouse wheel zoom

    // Pan settings
    DEFAULT_PAN_X: 0,
    DEFAULT_PAN_Y: 0,

    // Viewport margins
    MARGIN_TOP: 80,    // Space for toolbar
    MARGIN_BOTTOM: 60, // Space for footer
    MARGIN_LEFT: 20,
    MARGIN_RIGHT: 20
};

// ============================================
// STORAGE FORMAT VERSIONS
// ============================================

// Format version constants for channel storage
const STORAGE_FORMAT_VERSION = {
    VERSION_1: 1,  // JSON format - legacy format with JSON strokes array
    VERSION_2: 2   // Binary format - optimized format using Float32Array for strokes (~50% smaller payload)
};

// Current format version to use for new saves
const CURRENT_STORAGE_VERSION = STORAGE_FORMAT_VERSION.VERSION_2;

// ============================================
// LEGACY VARIABLE ALIASES (reference encapsulated singletons)
// These provide backward compatibility - will be gradually removed
// ============================================

// Viewport transform state - references ViewportState singleton
let viewportTransform = viewportState.getTransform();
// Sync the reference object with singleton properties
Object.defineProperty(window, 'viewportTransform', {
    get: () => ({ zoom: viewportState.zoom, panX: viewportState.panX, panY: viewportState.panY }),
    set: (val) => { viewportState.zoom = val.zoom; viewportState.panX = val.panX; viewportState.panY = val.panY; }
});

// Panning state - references ViewportState singleton
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let spaceKeyPressed = false;

// Touch gesture state - references ViewportState singleton
let touchStartDistance = 0;
let touchStartZoom = 1;
let touchStartPanX = 0;
let touchStartPanY = 0;
let touchStartMidX = 0;
let touchStartMidY = 0;

// Configuration - references ConnectionState singleton
let username = '';
let channelName = '';
let channelPassword = '';
let connected = false;
let connecting = false; // Flag to prevent race condition when connect() called multiple times rapidly
var channel = null;
var webrtcHelper = null;

// Sync Mode - references ConnectionState singleton
let syncMode = connectionState.syncMode;

// Drawing state - references DrawingState singleton
let drawing = false;
let currentTool = 'draw';
let previousTool = 'draw';
let autoHandModeActive = false;
let currentColor = '#000';
let currentSize = 3;
let lastX = 0;
let lastY = 0;

// Magic Pen Configuration
const MAGIC_PEN_DURATION = 2000;
const MAGIC_PEN_FADE_DURATION = 500;
let magicStrokes = renderState.magicStrokes;
let magicStrokeIdCounter = 0;

// Canvas snapshot - references DrawingState singleton
let canvasSnapshot = null;

// Incremental smoothing buffer
let _currentPath = null;
let _currentPathDrawnSegments = 0;

// User tracking - references UserState singleton
let users = userState.users;
let remoteCursors = userState.remoteCursors;
let remoteCursorTargets = userState.remoteCursorTargets;

// Cursor update throttling
const CURSOR_MIN_DISTANCE_SCREEN = 5;
let lastSentCursorX = -1;
let lastSentCursorY = -1;

// Cursor interpolation settings
const CURSOR_INTERPOLATION_SPEED = 0.3;

// Prepared-draw buffering - references RenderState singleton
let preparedDraw = renderState.preparedDraw;
let preparedTimer = null;
const PREPARED_TIMEOUT = 2000;

// Performance optimization: Stroke batching - references RenderState singleton
let strokeBuffer = renderState.strokeBuffer;
let strokeBatchTimer = null;
const STROKE_BATCH_INTERVAL = 50;

// Incoming rendering queue - references RenderState singleton
let incomingStrokeQueue = renderState.incomingStrokeQueue;
let _renderLoopRunning = false;
let _lastRenderTs = 0;
const TARGET_FPS = 60;
const RENDER_INTERVAL = 1000 / TARGET_FPS;
const MAX_STROKES_PER_FRAME = 2000;
const MAX_STROKES_QUEUE = 20000;

// Board state persistence - references BoardStateManager singleton
let boardState = boardStateManager.boardState;

/**
 * Redraw entire canvas from boardState
 * Used after resize to properly render strokes at new resolution
 * Also restores canvas snapshot (imported images)
 */
function redrawCanvas() {
    if (!canvas || !ctx) {
        return;
    }

    try {
        console.log(`[Redraw] Redrawing canvas - strokes: ${boardState.length}, snapshot: ${!!canvasSnapshot}`);

        // Clear canvas
        const cssW = canvas.clientWidth || Math.max(1, Math.floor(canvas.width / (canvas._dpr || 1)));
        const cssH = canvas.clientHeight || Math.max(1, Math.floor(canvas.height / (canvas._dpr || 1)));
        ctx.clearRect(0, 0, cssW, cssH);

        // First, restore canvas snapshot if exists (imported images)
        if (canvasSnapshot) {
            const img = new Image();
            img.onload = function () {
                // Draw the snapshot scaled to current canvas size
                ctx.drawImage(img, 0, 0, cssW, cssH);

                // Then redraw all strokes on top
                if (boardState && boardState.length > 0) {
                    for (let i = 0; i < boardState.length; i++) {
                        drawStroke(boardState[i]);
                    }
                }

                // Magic pen strokes are now on separate layer, no need to draw here
                console.log(`[Redraw] Complete - snapshot restored, ${boardState.length} strokes redrawn`);
            };
            img.onerror = function () {
                console.warn('[Redraw] Failed to restore canvas snapshot, redrawing strokes only');
                // Fallback: just redraw strokes
                if (boardState && boardState.length > 0) {
                    for (let i = 0; i < boardState.length; i++) {
                        drawStroke(boardState[i]);
                    }
                }
            };
            img.src = canvasSnapshot;
        } else {
            // No snapshot, just redraw strokes
            if (boardState && boardState.length > 0) {
                for (let i = 0; i < boardState.length; i++) {
                    drawStroke(boardState[i]);
                }
                console.log(`[Redraw] Complete - ${boardState.length} strokes redrawn`);
            }

            // Magic pen strokes are now on separate layer, no need to draw here
        }
    } catch (e) {
        console.error('[Redraw] Error redrawing canvas:', e);
    }
}

const MAX_BOARD_STATE_SIZE = 50000;

// Board state management - references BoardStateManager singleton
let boardStateTimer = boardStateManager.boardStateTimer;
const BOARD_STATE_BROADCAST_INTERVAL = 30000;
let boardStateOrderNumber = boardStateManager.boardStateOrderNumber;
let lastBroadcastStrokeCount = boardStateManager.lastBroadcastStrokeCount;
let lastBroadcastCanvasHash = boardStateManager.lastBroadcastCanvasHash;

// Board state idle detection - references BoardStateManager singleton
let lastDrawActivityTime = boardStateManager.lastDrawActivityTime;

// Board state message caching - references BoardStateManager singleton
let boardStateCache = boardStateManager.boardStateCache;

// Initial state loading - references BoardStateManager singleton
let isLoadingInitialState = boardStateManager.isLoadingInitialState;
let initialStateLoaded = boardStateManager.initialStateLoaded;
let lastStrokeEventTime = boardStateManager.lastStrokeEventTime;
let lastBoardStateMessageTime = boardStateManager.lastBoardStateMessageTime;
let stateLoadingMaxTimeout = boardStateManager.stateLoadingMaxTimeout;
const STATE_LOADING_MAX_TIME = 7000;
const HOST_SEND_DELAY = 60000;
const BOARD_STATE_FALLBACK_TIMEOUT = 120000;
let cachedInitialStrokes = boardStateManager.cachedInitialStrokes;

// Board lock for non-host users (waiting for DataChannel connection)
let isBoardLocked = false;
let boardLockTimeout = null;
const BOARD_LOCK_TIMEOUT_MS = 10000; // 10 seconds timeout

// Undo/Redo History Management - references HistoryManager singleton
const MAX_HISTORY_SIZE = historyManager.maxHistorySize;
let historyStack = historyManager.historyStack;
let redoStack = historyManager.redoStack;
let isRestoringHistory = historyManager.isRestoringHistory;

// Canvas hash tracking - references BoardStateManager singleton
let lastReceivedCanvasHash = boardStateManager.lastReceivedCanvasHash;
let currentCanvasHash = boardStateManager.currentCanvasHash;

// ===== ADVANCED OPTIMIZATIONS =====

// 1. Binary Stroke Format (Float32Array for efficient encoding)
const USE_BINARY_STROKES = true;
const BINARY_STROKE_SIZE = 9;

// 2. Adaptive Send Rate - references OptimizationState singleton
const ADAPTIVE_SEND_RATE = true;
const MIN_SEND_INTERVAL = 2;
const MAX_SEND_INTERVAL = 12;
let currentSendInterval = optimizationState.currentSendInterval;
let lastStrokeDistance = optimizationState.lastStrokeDistance;

// 3. Stroke Compression (Ramer-Douglas-Peucker algorithm)
const USE_STROKE_COMPRESSION = true;
const RDP_EPSILON = 1.5;
let compressionStatsTotal = optimizationState.compressionStatsTotal;
let compressionStatsSaved = optimizationState.compressionStatsSaved;

// 4. Predictive Interpolation - references UserState singleton
const USE_PREDICTIVE_INTERPOLATION = true;
const PREDICTION_TIME_MS = 50;
let remoteCursorPredictions = userState.remoteCursorPredictions;

// Connection attempt timeout - references ConnectionState singleton
let connectionAttemptTimeout = connectionState.connectionAttemptTimeout;
const CONNECTION_ATTEMPT_TIMEOUT = 8000;

// Utility: generate consistent color for user based on username hash
/**
 * Generate a consistent color for a user (uses BaseGame method if available)
 * @param {string} username - Username to generate color for
 * @returns {string} Color in HSL or hex format
 */
function generateUserColor(username) {
    // Use BaseGame's method if available for consistency across framework
    if (whiteboardGame && typeof whiteboardGame.generateUserColor === 'function') {
        return whiteboardGame.generateUserColor(username);
    }

    // Fallback to legacy implementation
    if (!username) return '#667eea'; // Default color

    // Simple hash function for username
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }

    // Generate pleasant colors (avoid too dark or too light)
    const hue = Math.abs(hash % 360);
    const saturation = 65 + (Math.abs(hash) % 20); // 65-85%
    const lightness = 45 + (Math.abs(hash >> 8) % 15); // 45-60%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// ===== ADVANCED OPTIMIZATION FUNCTIONS =====

/**
 * 1. Binary Stroke Encoding - Convert strokes to Float32Array for 50% size reduction
 */
function encodeStrokesBinary(strokes) {
    if (!USE_BINARY_STROKES || !strokes || strokes.length === 0) return null;

    const buffer = new Float32Array(strokes.length * BINARY_STROKE_SIZE);
    let offset = 0;

    for (const stroke of strokes) {
        // Parse color to RGB
        const rgb = parseColor(stroke.color);

        // Encode flags: bit 0 = erase, bit 1 = magic
        const flags = (stroke.erase ? 1 : 0) | (stroke.isMagic ? 2 : 0);

        buffer[offset++] = stroke.x1;
        buffer[offset++] = stroke.y1;
        buffer[offset++] = stroke.x2;
        buffer[offset++] = stroke.y2;
        buffer[offset++] = stroke.size;
        buffer[offset++] = rgb.r;
        buffer[offset++] = rgb.g;
        buffer[offset++] = rgb.b;
        buffer[offset++] = flags;
    }

    return buffer;
}

function decodeStrokesBinary(buffer) {
    if (!buffer || !(buffer instanceof Float32Array)) return null;

    const strokes = [];
    const count = buffer.length / BINARY_STROKE_SIZE;

    for (let i = 0; i < count; i++) {
        const offset = i * BINARY_STROKE_SIZE;
        const flags = buffer[offset + 8];

        strokes.push({
            x1: buffer[offset],
            y1: buffer[offset + 1],
            x2: buffer[offset + 2],
            y2: buffer[offset + 3],
            size: buffer[offset + 4],
            color: `rgb(${Math.round(buffer[offset + 5])}, ${Math.round(buffer[offset + 6])}, ${Math.round(buffer[offset + 7])})`,
            erase: (flags & 1) !== 0,
            isMagic: (flags & 2) !== 0
        });
    }

    return strokes;
}

function parseColor(colorStr) {
    // Handle hex colors
    if (colorStr.startsWith('#')) {
        const hex = colorStr.slice(1);
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        };
    }
    // Handle rgb colors
    const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
        return {r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3])};
    }
    // Default white
    return {r: 255, g: 255, b: 255};
}

/**
 * 2. Adaptive Send Rate - Adjust FPS based on drawing speed
 */
function updateAdaptiveSendRate(distance) {
    if (!ADAPTIVE_SEND_RATE) return;

    lastStrokeDistance = distance;

    // Fast drawing (>10px per stroke) = high FPS
    // Slow drawing (<5px per stroke) = low FPS
    if (distance > 10) {
        currentSendInterval = Math.max(MIN_SEND_INTERVAL, currentSendInterval - 1);
    } else if (distance < 5) {
        currentSendInterval = Math.min(MAX_SEND_INTERVAL, currentSendInterval + 1);
    }
}

/**
 * 3. Ramer-Douglas-Peucker Algorithm - Stroke compression
 */
function compressStrokes(strokes) {
    if (!USE_STROKE_COMPRESSION || !strokes || strokes.length <= 2) return strokes;

    // Group consecutive strokes into paths
    const paths = [];
    let currentPath = [];

    for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i];

        // Start new path or add to current
        if (currentPath.length === 0) {
            currentPath.push(stroke);
        } else {
            const lastStroke = currentPath[currentPath.length - 1];
            // Check if strokes are connected (endpoint matches startpoint)
            const dx = stroke.x1 - lastStroke.x2;
            const dy = stroke.y1 - lastStroke.y2;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 2 && stroke.color === lastStroke.color &&
                stroke.size === lastStroke.size && stroke.erase === lastStroke.erase) {
                currentPath.push(stroke);
            } else {
                // Start new path
                paths.push(currentPath);
                currentPath = [stroke];
            }
        }
    }
    if (currentPath.length > 0) paths.push(currentPath);

    // Compress each path
    const compressed = [];
    for (const path of paths) {
        if (path.length <= 2) {
            compressed.push(...path);
        } else {
            const points = path.map((s, i) => i === 0 ? {x: s.x1, y: s.y1} : null).filter(p => p);
            points.push(...path.map(s => ({x: s.x2, y: s.y2})));

            const reducedPoints = rdpReduce(points, RDP_EPSILON);

            // Convert back to strokes
            for (let i = 1; i < reducedPoints.length; i++) {
                compressed.push({
                    x1: reducedPoints[i - 1].x,
                    y1: reducedPoints[i - 1].y,
                    x2: reducedPoints[i].x,
                    y2: reducedPoints[i].y,
                    color: path[0].color,
                    size: path[0].size,
                    erase: path[0].erase,
                    isMagic: path[0].isMagic
                });
            }

            compressionStatsTotal += path.length;
            compressionStatsSaved += (path.length - (reducedPoints.length - 1));
        }
    }

    return compressed;
}

function rdpReduce(points, epsilon) {
    if (points.length <= 2) return points;

    // Find point with maximum distance
    let maxDist = 0;
    let maxIndex = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIndex = i;
        }
    }

    // If max distance is greater than epsilon, recursively simplify
    if (maxDist > epsilon) {
        const left = rdpReduce(points.slice(0, maxIndex + 1), epsilon);
        const right = rdpReduce(points.slice(maxIndex), epsilon);
        return left.slice(0, -1).concat(right);
    }

    // Otherwise, return endpoints only
    return [first, last];
}

function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
        const pdx = point.x - lineStart.x;
        const pdy = point.y - lineStart.y;
        return Math.sqrt(pdx * pdx + pdy * pdy);
    }

    const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq));
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;
    const pdx = point.x - projX;
    const pdy = point.y - projY;

    return Math.sqrt(pdx * pdx + pdy * pdy);
}

// Utility: detect small portrait/mobile screens
function isMobilePortrait() {
    try {
        // Consider portrait mobile if width <= 900 and orientation is portrait (or height > width)
        const smallWidth = window.innerWidth <= 900;
        const isPortraitMedia = typeof window.matchMedia === 'function' && window.matchMedia('(orientation: portrait)').matches;
        const heightGreater = window.innerHeight > window.innerWidth;
        return smallWidth && (isPortraitMedia || heightGreater);
    } catch (e) {
        return false;
    }
}

// Utility: hide/show connection modal safely (used for mobile quick UX)
function hideConnectionModal() {
    const el = document.getElementById('connectionModal');
    if (!el) return;
    el.classList.add('hidden');
    // also remove active/collapsed to avoid UI remnants
    el.classList.remove('active');
    el.classList.remove('collapsed');
}

// ============================================
// VIEWPORT TRANSFORM FUNCTIONS (Pan & Zoom)
// ============================================

/**
 * Save viewport transform (zoom and pan) to localStorage
 */
function saveViewportTransform() {
    try {
        localStorage.setItem('whiteboard_viewport', JSON.stringify(viewportTransform));
        console.log(`[Viewport] Saved transform - zoom: ${viewportTransform.zoom.toFixed(2)}, pan: (${Math.round(viewportTransform.panX)}, ${Math.round(viewportTransform.panY)})`);
    } catch (e) {
        console.warn('[Viewport] Failed to save transform:', e);
    }
}

/**
 * Apply viewport transform (zoom) to canvas element
 * Handles centering when canvas is smaller than viewport and scrolling when larger
 */
function applyViewportTransform() {
    if (!canvas) return;

    const {zoom, panX, panY} = viewportTransform;

    // Apply scale AND translate for panning support
    // When panX/panY are 0, flexbox handles centering
    // When user pans with hand tool, translate shifts the canvas
    const transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;

    canvas.style.transform = transform;
    canvas.style.transformOrigin = 'center center';

    // Apply SAME transform to magic canvas for alignment
    if (magicCanvas) {
        magicCanvas.style.transform = transform;
        magicCanvas.style.transformOrigin = 'center center';
    }

    // Update zoom indicator UI
    updateZoomIndicator();

    console.log(`[Viewport] Transform applied - zoom: ${Math.round(zoom * 100)}%, pan: (${Math.round(panX)}, ${Math.round(panY)})`);
}

/**
 * Update zoom indicator display
 */
function updateZoomIndicator() {
    const zoomPercent = Math.round(viewportTransform.zoom * 100);
    const indicator = document.getElementById('zoomIndicator');
    if (indicator) {
        indicator.textContent = `${zoomPercent}%`;
    }
}

/**
 * Center canvas in viewport - with flexbox, just apply transform!
 * The wrapper's flexbox centering handles the actual centering.
 */
function centerCanvasInViewport() {
    // With flexbox centering on wrapper, we don't need to calculate panX/panY
    // Just reset pan to 0 and let flexbox do the centering
    viewportTransform.panX = 0;
    viewportTransform.panY = 0;

    applyViewportTransform();

    console.log(`[Viewport] Canvas centered via flexbox - zoom: ${Math.round(viewportTransform.zoom * 100)}%`);
}

/**
 * Convert viewport (screen) coordinates to canvas coordinates
 * @param {number} viewportX - X coordinate in viewport (screen pixels from window)
 * @param {number} viewportY - Y coordinate in viewport (screen pixels from window)
 * @returns {Object} { x, y } in canvas coordinates (0-1920, 0-1080)
 */
function viewportToCanvas(viewportX, viewportY) {
    const {zoom, panX, panY} = viewportTransform;

    // Get canvas element's bounding rect (which includes the transform)
    const canvasRect = canvas.getBoundingClientRect();

    // Calculate position relative to the transformed canvas
    const relativeX = viewportX - canvasRect.left;
    const relativeY = viewportY - canvasRect.top;

    // Convert from transformed canvas pixels to absolute canvas coordinates
    // The canvas display size is CANVAS_CONFIG.WIDTH x CANVAS_CONFIG.HEIGHT
    // When zoomed, the displayed size changes, so we scale back to get absolute coords
    const canvasX = (relativeX / zoom);
    const canvasY = (relativeY / zoom);

    return {x: canvasX, y: canvasY};
}

/**
 * Convert canvas coordinates to viewport (screen) coordinates
 * @param {number} canvasX - X coordinate in canvas space (0-1920)
 * @param {number} canvasY - Y coordinate in canvas space (0-1080)
 * @returns {Object} { x, y } in viewport coordinates (screen pixels)
 */
function canvasToViewport(canvasX, canvasY) {
    const {zoom, panX, panY} = viewportTransform;

    // Get canvas element's bounding rect (which includes the transform)
    const canvasRect = canvas.getBoundingClientRect();

    // Convert from absolute canvas coordinates to transformed screen position
    const viewportX = (canvasX * zoom) + canvasRect.left;
    const viewportY = (canvasY * zoom) + canvasRect.top;

    return {x: viewportX, y: viewportY};
}

/**
 * Check if canvas coordinates are outside the board area
 * Canvas bounds: 0-1920 x 0-1080
 * @param {number} canvasX - X coordinate in canvas space
 * @param {number} canvasY - Y coordinate in canvas space
 * @returns {boolean} true if outside canvas bounds
 */
function isOutsideCanvas(canvasX, canvasY) {
    return canvasX < 0 || canvasX > CANVAS_CONFIG.WIDTH ||
        canvasY < 0 || canvasY > CANVAS_CONFIG.HEIGHT;
}

/**
 * Handle click outside canvas - automatically activate hand mode
 * @param {number} canvasX - X coordinate in canvas space
 * @param {number} canvasY - Y coordinate in canvas space
 */
function handleClickOutsideCanvas(canvasX, canvasY) {
    if (isOutsideCanvas(canvasX, canvasY) && currentTool !== 'hand') {
        // Store current tool before switching
        previousTool = currentTool;
        autoHandModeActive = true;

        // Switch to hand tool
        setTool('hand');

        console.log(`[Auto Hand Mode] Clicked outside canvas at (${Math.round(canvasX)}, ${Math.round(canvasY)}) - activated hand mode`);
    }
}

/**
 * Handle click inside canvas - restore previous tool if auto hand mode was active
 * @param {number} canvasX - X coordinate in canvas space
 * @param {number} canvasY - Y coordinate in canvas space
 */
function handleClickInsideCanvas(canvasX, canvasY) {
    if (!isOutsideCanvas(canvasX, canvasY) && autoHandModeActive) {
        // Restore previous tool
        autoHandModeActive = false;
        setTool(previousTool);

        console.log(`[Auto Hand Mode] Clicked inside canvas - restored ${previousTool} tool`);
    }
}

/**
 * Calculate optimal zoom to fit canvas in viewport
 * Uses the wrapper's parent (canvas-container) dimensions with padding
 * @returns {number} The calculated zoom level
 */
function calculateAutoFitZoom() {
    // Get the canvas container dimensions (wrapper's parent)
    const container = document.getElementById('canvasContainer');
    const containerWidth = container ? container.clientWidth : window.innerWidth;
    const containerHeight = container ? container.clientHeight : window.innerHeight;

    // Add padding (80px = 40px on each side from CSS)
    const padding = 80;
    const availableWidth = Math.max(containerWidth - padding, 100);
    const availableHeight = Math.max(containerHeight - padding, 100);

    // Calculate scale to fit canvas in available space
    const scaleX = availableWidth / CANVAS_CONFIG.WIDTH;
    const scaleY = availableHeight / CANVAS_CONFIG.HEIGHT;

    // Use the smaller scale to ensure canvas fits, but don't zoom in beyond 100%
    const fitScale = Math.min(scaleX, scaleY, 1.0);

    console.log(`[Zoom] Auto-fit: container ${containerWidth}x${containerHeight}, available ${availableWidth}x${availableHeight}, scale: ${Math.round(fitScale * 100)}%`);

    return fitScale;
}

/**
 * Zoom in (increase zoom level) - centers canvas after zoom
 */
function zoomIn() {
    const newZoom = Math.min(CANVAS_CONFIG.MAX_ZOOM, viewportTransform.zoom + CANVAS_CONFIG.ZOOM_STEP);
    viewportTransform.zoom = newZoom;
    centerCanvasInViewport(); // Center after zoom
    updateCanvasCursor(); // Update cursor to reflect new zoom
    console.log(`[Zoom] Zoomed in to ${Math.round(newZoom * 100)}%`);
}

/**
 * Zoom out (decrease zoom level) - centers canvas after zoom
 */
function zoomOut() {
    const newZoom = Math.max(CANVAS_CONFIG.MIN_ZOOM, viewportTransform.zoom - CANVAS_CONFIG.ZOOM_STEP);
    viewportTransform.zoom = newZoom;
    centerCanvasInViewport(); // Center after zoom
    updateCanvasCursor(); // Update cursor to reflect new zoom
    console.log(`[Zoom] Zoomed out to ${Math.round(newZoom * 100)}%`);
}

/**
 * Reset zoom to auto-fit viewport and center canvas
 */
function resetZoom() {
    // Recalculate optimal zoom for current viewport size
    viewportTransform.zoom = calculateAutoFitZoom();

    // Center canvas in viewport with new zoom
    centerCanvasInViewport();

    // Save the reset state
    saveViewportTransform();

    // Update cursor to reflect new zoom
    updateCanvasCursor();

    console.log(`[Zoom] Reset to auto-fit ${Math.round(viewportTransform.zoom * 100)}% and centered`);
}

// Expose zoom functions globally for HTML onclick handlers
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.resetZoom = resetZoom;

function showConnectionModal() {
    const el = document.getElementById('connectionModal');
    if (!el) return;
    el.classList.remove('hidden');
    // ensure modal content visible (not collapsed) when showing
    el.classList.remove('collapsed');
    el.classList.add('active');
}

// --- Random helpers: generate agent name, channel name and numeric passwords ---
function randomDigits(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
    return s;
}

function randomLowercase(n) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    let s = '';
    for (let i = 0; i < n; i++) {
        s += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    return s;
}

function generatePassword() {
    // First 4 characters: lowercase letters
    // Last 4 characters: digits
    return randomLowercase(4) + randomDigits(4);
}

function _generateRandomAgentNameBase() {
    // similar to previous fallback: short random alpha string
    return 'User-' + Math.random().toString(36).slice(2, 8);
}

// expose a global so other code uses same generator if present
window.generateRandomAgentName = window.generateRandomAgentName || function () {
    return _generateRandomAgentNameBase();
};

/**
 * Lock the board (prevent drawing) - used when non-host is waiting for DataChannel connection
 */
function lockBoard(message = 'Connecting to whiteboard...') {
    isBoardLocked = true;

    // Show overlay notification
    showBoardLockNotification(message);

    // Set timeout to unlock with error if connection takes too long
    if (boardLockTimeout) clearTimeout(boardLockTimeout);
    boardLockTimeout = setTimeout(() => {
        unlockBoard();
        showToast('⚠️ Connection timeout - Board access restored with limited functionality', 'warning', 5000);
    }, BOARD_LOCK_TIMEOUT_MS);

    console.log('[Whiteboard] Board locked:', message);
}

/**
 * Unlock the board (allow drawing)
 */
function unlockBoard() {
    isBoardLocked = false;

    // Clear timeout
    if (boardLockTimeout) {
        clearTimeout(boardLockTimeout);
        boardLockTimeout = null;
    }

    // Hide overlay notification
    hideBoardLockNotification();

    console.log('[Whiteboard] Board unlocked');
}

/**
 * Show board lock notification overlay
 */
function showBoardLockNotification(message) {
    let overlay = document.getElementById('boardLockOverlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'boardLockOverlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            backdrop-filter: blur(3px);
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 30px 50px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 400px;
        `;

        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        spinner.style.cssText = `
            width: 50px;
            height: 50px;
            border: 5px solid #f3f3f3;
            border-top: 5px solid #6965db;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        `;

        const messageEl = document.createElement('div');
        messageEl.id = 'boardLockMessage';
        messageEl.style.cssText = `
            font-size: 18px;
            color: #333;
            font-weight: 600;
            margin-bottom: 10px;
        `;
        messageEl.textContent = message;

        const subtext = document.createElement('div');
        subtext.style.cssText = `
            font-size: 14px;
            color: #666;
        `;
        subtext.textContent = 'Please wait...';

        content.appendChild(spinner);
        content.appendChild(messageEl);
        content.appendChild(subtext);
        overlay.appendChild(content);
        document.body.appendChild(overlay);

        // Add spinner animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    } else {
        const messageEl = document.getElementById('boardLockMessage');
        if (messageEl) messageEl.textContent = message;
        overlay.style.display = 'flex';
    }
}

/**
 * Hide board lock notification overlay
 */
function hideBoardLockNotification() {
    const overlay = document.getElementById('boardLockOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function enqueueStroke(s, peerId) {
    // Normalize minimal stroke shape
    const stroke = {
        x1: Number(s.x1) || 0,
        y1: Number(s.y1) || 0,
        x2: Number(s.x2) || 0,
        y2: Number(s.y2) || 0,
        color: s.color || '#000',
        size: s.size || 1,
        erase: !!s.erase,
        isMagic: !!s.isMagic,  // Preserve magic flag
        peerId: peerId || null  // Track who sent this stroke
    };

    incomingStrokeQueue.push(stroke);

    // Safety: drop oldest if queue exceeds max
    if (incomingStrokeQueue.length > MAX_STROKES_QUEUE) {
        // remove oldest (keep the newest MAX_STROKES_QUEUE items)
        incomingStrokeQueue.splice(0, incomingStrokeQueue.length - MAX_STROKES_QUEUE);
    }
}

function enqueueStrokes(arr, peerId) {
    if (!Array.isArray(arr)) return;
    for (const s of arr) enqueueStroke(s, peerId);
}

// ===== Initial State Loading Management =====

function showStateLoadingLoader() {
    try {
        let loader = document.getElementById('stateLoadingLoader');
        if (!loader) {
            // Create loader overlay
            loader = document.createElement('div');
            loader.id = 'stateLoadingLoader';
            loader.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 9999;
                gap: 16px;
            `;

            const spinner = document.createElement('div');
            spinner.style.cssText = `
                width: 50px;
                height: 50px;
                border: 4px solid rgba(102, 126, 234, 0.2);
                border-top-color: #667eea;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            `;

            const text = document.createElement('div');
            text.textContent = 'Loading whiteboard state...';
            text.style.cssText = `
                color: white;
                font-size: 16px;
                font-weight: 600;
            `;

            const styles = document.createElement('style');
            styles.textContent = `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(styles);

            loader.appendChild(spinner);
            loader.appendChild(text);
            document.body.appendChild(loader);
        }
        loader.style.display = 'flex';
    } catch (e) {
        console.warn('Failed to show loader', e);
    }
}

function hideStateLoadingLoader() {
    try {
        const loader = document.getElementById('stateLoadingLoader');
        if (loader) {
            loader.style.display = 'none';
        }
    } catch (e) {
        console.warn('Failed to hide loader', e);
    }
}

function startInitialStateLoading() {
    console.log('[Init] Starting initial state loading...');

    // Check if we're the only agent connected
    const agentCount = users.size;

    console.log(`[Init] ${agentCount} agents connected, will stop on: 1) Timeout (30s) OR 2) Canvas received via DataChannel`);
    isLoadingInitialState = true;
    lastStrokeEventTime = Date.now();
    cachedInitialStrokes = [];

    showStateLoadingLoader();

    // Max timeout: 30 seconds - force completion even if not fully synced
    stateLoadingMaxTimeout = setTimeout(() => {
        console.log('[Init] ⏱️ Max timeout reached (30s), stopping initialization');
        finishInitialStateLoading();
    }, STATE_LOADING_MAX_TIME);

    // NOTE: Initialization stops on:
    // 1. Timeout (above)
    // 2. Canvas received via DataChannel (handleBoardStateChunk)
    // 3. If only 1 agent - skip immediately (no one to send canvas)
}

function finishInitialStateLoading() {
    console.log(`[Init] ✅ Finished initial state loading. Cached ${cachedInitialStrokes.length} strokes`);

    // Clear timeout timer
    if (stateLoadingMaxTimeout) {
        clearTimeout(stateLoadingMaxTimeout);
        stateLoadingMaxTimeout = null;
    }

    // Allow drawing
    isLoadingInitialState = false;
    hideStateLoadingLoader();

    // Draw all cached strokes at once
    if (cachedInitialStrokes.length > 0) {
        console.log(`[Init] Drawing ${cachedInitialStrokes.length} cached strokes...`);
        cachedInitialStrokes.forEach(stroke => {
            enqueueStroke(stroke);
        });
        cachedInitialStrokes = [];
    }
}


lastDrawActivityTime = Date.now();

// Auto-save state
let autoSaveTimer = null;
const AUTO_SAVE_IDLE_DELAY = 5000; // Save after 5 seconds of idle

/**
 * Record drawing activity to trigger auto-save after idle period
 *
 * IMPORTANT: Only call this for permanent canvas changes (regular strokes, not magic strokes)
 * Magic strokes are temporary overlays and should NOT trigger storage saves
 */
function recordDrawActivity() {
    // Update timestamp when local drawing occurs
    lastDrawActivityTime = Date.now();

    // Reset auto-save timer (save after idle period)
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = setTimeout(() => {
        // Save to storage after idle period (host only)
        if (connected && channel && channel.isHostAgent()) {
            console.log('[Auto-Save] Idle detected, saving board state...');
            saveBoardStateToStorage();
        }
    }, AUTO_SAVE_IDLE_DELAY);
}

// ===== Canvas Utility Functions =====

/**
 * Capture canvas dimensions (both device pixels and CSS pixels)
 * @returns {Object} { canvasWidth, canvasHeight, cssWidth, cssHeight }
 */
function captureCanvasDimensions() {
    return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        cssWidth: canvas.clientWidth || Math.max(1, Math.floor(canvas.width / (canvas._dpr || 1))),
        cssHeight: canvas.clientHeight || Math.max(1, Math.floor(canvas.height / (canvas._dpr || 1)))
    };
}

/**
 * Capture canvas as PNG data URL with dimensions
 * @returns {Object|null} { dataUrl, dataSize, dimensions } or null if empty
 */
function captureCanvasSnapshot() {
    if (!canvas || !ctx) return null;

    try {
        const dimensions = captureCanvasDimensions();
        const dataUrl = canvas.toDataURL('image/png', 1.0); // 100% quality
        const dataSize = dataUrl.length;

        if (dataSize < 1000) {
            return null; // Canvas is empty
        }

        return {
            dataUrl: dataUrl,
            dataSize: dataSize,
            dimensions: dimensions
        };
    } catch (e) {
        console.error('[Canvas Util] Failed to capture canvas:', e);
        return null;
    }
}

/**
 * Draw image on canvas with proper scaling and centering
 * Uses canvas physical dimensions (1920x1080) for consistent rendering across agents
 * @param {Image} img - The image to draw
 * @param {Object} originalDimensions - { cssWidth, cssHeight } of original canvas (optional)
 * @param {Function} onSuccess - Callback on success
 * @param {Function} onError - Callback on error
 */
function drawCanvasImage(img, originalDimensions, onSuccess, onError) {
    if (!canvas || !ctx || !img) {
        if (onError) onError(new Error('Canvas or image not available'));
        return;
    }

    try {
        // Use canvas PHYSICAL dimensions (e.g., 1920x1080) for absolute coordinates
        // This ensures images render at same position/size across all agents
        const canvasPhysicalWidth = canvas.width;
        const canvasPhysicalHeight = canvas.height;

        console.log(`[Canvas Util] Drawing image at absolute canvas coordinates (${canvasPhysicalWidth}x${canvasPhysicalHeight})`);

        // Clear current canvas
        ctx.clearRect(0, 0, canvasPhysicalWidth, canvasPhysicalHeight);
        boardState = []; // Clear stroke array

        // Calculate scale to fit image while preserving aspect ratio
        const scale = Math.min(canvasPhysicalWidth / img.width, canvasPhysicalHeight / img.height);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;

        // Center the image at absolute canvas coordinates
        const offsetX = (canvasPhysicalWidth - scaledWidth) / 2;
        const offsetY = (canvasPhysicalHeight - scaledHeight) / 2;

        // Draw image at absolute coordinates (will be same on all agents)
        ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);

        console.log(`[Canvas Util] ✓ Image drawn at absolute coords (scale=${scale.toFixed(2)}, offset=${Math.round(offsetX)},${Math.round(offsetY)}, size=${Math.round(scaledWidth)}x${Math.round(scaledHeight)})`);

        if (onSuccess) {
            onSuccess({scale, offsetX, offsetY, scaledWidth, scaledHeight});
        }
    } catch (e) {
        console.error('[Canvas Util] Failed to draw image:', e);
        if (onError) onError(e);
    }
}

/**
 * Load and draw image from data URL
 * @param {string} dataUrl - Image data URL
 * @param {Object} originalDimensions - { cssWidth, cssHeight }
 * @param {Function} onSuccess - Callback on success
 * @param {Function} onError - Callback on error
 */
function loadAndDrawCanvasImage(dataUrl, originalDimensions, onSuccess, onError) {
    const img = new Image();

    img.onload = function () {
        drawCanvasImage(img, originalDimensions, onSuccess, onError);
    };

    img.onerror = function (err) {
        console.error('[Canvas Util] Failed to load image:', err);
        if (onError) onError(err);
    };

    img.src = dataUrl;
}

// ===== Board State Management =====

function addStrokeToBoardState(stroke) {
    // Add stroke to persistent board state
    boardState.push(stroke);

    // Track stroke for history (incremental snapshots)
    trackStrokeForHistory(stroke);

    // Record drawing activity (for idle detection and auto-save)
    // This will trigger storage.put after 5 seconds of idle
    recordDrawActivity();

    // Limit size to prevent memory issues
    if (boardState.length > MAX_BOARD_STATE_SIZE) {
        boardState.splice(0, boardState.length - MAX_BOARD_STATE_SIZE);
    }
}

function clearBoardState() {
    boardState = [];
    lastBroadcastStrokeCount = 0;  // Reset broadcast counter
    lastBroadcastCanvasHash = null;  // Reset canvas hash
}


// ============================================
// Channel Storage - Save/Load Board State
// ============================================

/**
 * Unified helper function to save data to channel storage
 * @param {object} content - Content to save
 * @param {object} metadata - Metadata object
 * @param {function} onSuccess - Success callback
 * @param {function} onError - Error callback
 */
function putChannelStorage( content, metadata, onSuccess, onError) {
    if (!channel) {
        console.error('[Storage] Channel not available');
        if (onError) onError({status: 'error', error: 'Channel not available'});
        return;
    }

    channel.storagePut({
        storageKey: STORAGE_KEY,
        content: content,
        encrypted: true,
        metadata: metadata
    }, function (response) {
        if (response.status === 'success') {
            if (onSuccess) onSuccess(response);
        } else {
            if (onError) onError(response);
        }
    });
}

/**
 * Save board state to channel storage (host agent only)
 * Uses storage key 'whiteboard-data'
 *
 * New approach: Export entire canvas as JPG image for maximum compression
 * This is much simpler and more efficient than storing individual strokes
 *
 * Triggered by:
 * - Auto-save after 5 seconds of idle (only for permanent strokes, not magic pen)
 * - Clear canvas
 * - Import image
 * - Undo/Redo operations
 *
 * NOT triggered by:
 * - Magic pen strokes (temporary overlays that auto-disappear)
 */
function saveBoardStateToStorage() {
    if (!connected || !channel || !canvas || !ctx) {
        console.log('[Storage] Not ready to save - connected:', connected, 'channel:', !!channel, 'canvas:', !!canvas);
        return;
    }

    // Only host saves to avoid conflicts
    if (!channel.isHostAgent()) {
        console.log('[Storage] Not host agent, skipping storage save');
        return;
    }

    try {
        console.log('[Storage] Saving board state to channel storage...');

        // Create a temporary canvas to add white background before exporting as JPG
        // (JPG doesn't support transparency, so we need white background)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Fill with white background
        tempCtx.fillStyle = '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Draw current canvas on top
        tempCtx.drawImage(canvas, 0, 0);

        // Export as JPG with 100% quality
        const jpegQuality = 1.0; // 100% quality - maximum quality
        const canvasImageJPG = tempCanvas.toDataURL('image/jpeg', jpegQuality);

        // Calculate size
        const imageSizeBytes = Math.round((canvasImageJPG.length * 3) / 4); // Approximate base64 size
        const imageSizeMB = (imageSizeBytes / 1024 / 1024).toFixed(2);

        console.log(`[Storage] Canvas exported as JPG: ${imageSizeMB} MB (quality: ${jpegQuality * 100}%)`);

        // Check if size is approaching limit
        if (imageSizeBytes > 18 * 1024 * 1024) { // 18 MB warning threshold
            console.warn(`[Storage] ⚠️ Storage size is large: ${imageSizeMB} MB`);
            addChatMessage('⚠️ Warning', `Canvas storage is large (${imageSizeMB} MB). Consider clearing some content.`, '#FF9800');
        }

        // Prepare board state object (simplified - just the image)
        const boardStateData = {
            canvasImage: canvasImageJPG,  // JPG image of entire canvas
            imageFormat: 'jpeg',
            imageQuality: jpegQuality,
            imageSizeBytes: imageSizeBytes,
            canvasWidth: CANVAS_CONFIG.WIDTH,
            canvasHeight: CANVAS_CONFIG.HEIGHT,
            timestamp: Date.now(),
            author: username,
            version: 3  // VERSION_3: JPG image format
        };

        // Metadata
        const metadata = {
            contentType: 'application/json',
            description: `Whiteboard saved as JPG by ${username}`,
            version: 3,  // VERSION_3: JPG image format
            properties: {
                imageFormat: 'jpeg',
                imageQuality: jpegQuality,
                imageSizeMB: imageSizeMB,
                canvasResolution: `${CANVAS_CONFIG.WIDTH}×${CANVAS_CONFIG.HEIGHT}`,
                savedBy: username,
                savedAt: new Date().toISOString()
            }
        };

        // Save using unified storage helper
        putChannelStorage(
            boardStateData,
            metadata,
            function(response) {
                console.log(`[Storage] ✓ Board state saved successfully (${imageSizeMB} MB JPG)`);
            },
            function(response) {
                console.error('[Storage] Failed to save board state:', response);

                // Show error notification to user
                const errorMsg = response.error || response.message || 'Unknown error';
                addChatMessage('❌ Sync Error', `Failed to save: ${errorMsg}`, '#f44336');

                // Check if it's a size limit error
                if (errorMsg.includes('exceeds maximum') || errorMsg.includes('PAYLOAD_TOO_LARGE')) {
                    addChatMessage('💡 Tip', 'Canvas is too large. Try clearing some content to reduce size.', '#FF9800');
                }
            }
        );

    } catch (e) {
        console.error('[Storage] Error saving board state:', e);
        addChatMessage('❌ Sync Error', `Failed to save board state: ${e.message}`, '#f44336');
    }
}

/**
 * Load board state from channel storage on connect
 * Supports multiple format versions:
 * - VERSION_3: JPG image format (current)
 * - VERSION_2: Binary strokes + PNG snapshot
 * - VERSION_1: JSON strokes + PNG snapshot (legacy)
 */
function loadBoardStateFromStorage() {
    if (!connected || !channel) {
        console.log('[Storage] Not ready to load - connected:', connected, 'channel:', !!channel);
        return;
    }

    try {
        console.log('[Storage] Loading board state from channel storage...');

        channel.storageGet({
            storageKey: STORAGE_KEY
        }, function (response) {
            console.log('[Storage] Get response:', response);

            if (response.status === 'success' && response.data) {
                try {
                    const boardStateData = response.data;
                    console.log('[Storage] ✓ Loaded board state:', boardStateData);

                    // Clear current board
                    if (canvas && ctx) {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                    clearBoardState();

                    // VERSION_3: JPG image format (simplest and best compression)
                    if (boardStateData.version === 3 && boardStateData.canvasImage) {
                        const img = new Image();
                        img.onload = function () {
                            try {
                                // Fill canvas with white background first (JPG doesn't have transparency)
                                ctx.fillStyle = '#FFFFFF';
                                ctx.fillRect(0, 0, canvas.width, canvas.height);

                                // Draw JPG image to canvas
                                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                                const sizeMB = boardStateData.imageSizeMB || (boardStateData.imageSizeBytes / 1024 / 1024).toFixed(2);
                                console.log(`[Storage] ✓ Loaded JPG image: ${sizeMB} MB`);
                                addChatMessage('System', `Loaded whiteboard (${sizeMB} MB JPG)`, '#4CAF50');

                                // Mark initial state as loaded
                                initialStateLoaded = true;
                                finishInitialStateLoading();
                            } catch (e) {
                                console.error('[Storage] Failed to render JPG image:', e);
                                addChatMessage('❌ Load Error', `Failed to render image: ${e.message}`, '#f44336');
                                initialStateLoaded = true;
                                finishInitialStateLoading();
                            }
                        };
                        img.onerror = function () {
                            console.error('[Storage] Failed to load JPG image');
                            addChatMessage('❌ Load Error', 'Failed to load whiteboard image', '#f44336');
                            initialStateLoaded = true;
                            finishInitialStateLoading();
                        };
                        img.src = boardStateData.canvasImage;
                        return;
                    }

                    // VERSION_2 or VERSION_1: Legacy stroke-based formats
                    // Decode strokes (support both binary and JSON formats)
                    let loadedStrokes = [];

                    if (boardStateData.binaryStrokes && Array.isArray(boardStateData.binaryStrokes)) {
                        // VERSION_2: Binary format
                        try {
                            const binaryArray = new Float32Array(boardStateData.binaryStrokes);
                            loadedStrokes = decodeStrokesBinary(binaryArray);
                            console.log(`[Storage] Decoded ${loadedStrokes.length} strokes from binary format (${boardStateData.binaryStrokes.length * 4} bytes)`);
                        } catch (e) {
                            console.error('[Storage] Failed to decode binary strokes, trying JSON fallback:', e);
                            loadedStrokes = boardStateData.strokes || [];
                        }
                    } else if (boardStateData.strokes && Array.isArray(boardStateData.strokes)) {
                        // VERSION_1: JSON format (fallback)
                        loadedStrokes = boardStateData.strokes;
                        console.log(`[Storage] Loaded ${loadedStrokes.length} strokes from JSON format`);
                    }

                    // Restore canvas snapshot if available (for VERSION_2/VERSION_1)
                    if (boardStateData.canvasSnapshot) {
                        const img = new Image();
                        img.onload = function () {
                            try {
                                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                console.log('[Storage] Canvas snapshot rendered');

                                // Then restore strokes on top
                                if (loadedStrokes.length > 0) {
                                    console.log(`[Storage] Restoring ${loadedStrokes.length} strokes...`);
                                    loadedStrokes.forEach(stroke => {
                                        addStrokeToBoardState(stroke);
                                        drawStroke(stroke);
                                    });
                                }

                                addChatMessage('System', `Loaded board state (${loadedStrokes.length} strokes)`, '#4CAF50');
                                initialStateLoaded = true;
                                finishInitialStateLoading();
                            } catch (e) {
                                console.error('[Storage] Failed to render canvas snapshot:', e);
                                initialStateLoaded = true;
                                finishInitialStateLoading();
                            }
                        };
                        img.onerror = function () {
                            console.error('[Storage] Failed to load canvas snapshot image');
                            // Continue with strokes only
                            if (loadedStrokes.length > 0) {
                                loadedStrokes.forEach(stroke => {
                                    addStrokeToBoardState(stroke);
                                    drawStroke(stroke);
                                });
                            }
                            initialStateLoaded = true;
                            finishInitialStateLoading();
                        };
                        img.src = boardStateData.canvasSnapshot;
                        canvasSnapshot = boardStateData.canvasSnapshot;
                    } else {
                        // No canvas snapshot, just restore strokes
                        if (loadedStrokes.length > 0) {
                            loadedStrokes.forEach(stroke => {
                                addStrokeToBoardState(stroke);
                                drawStroke(stroke);
                            });
                        }
                        addChatMessage('System', `Loaded board state (${loadedStrokes.length} strokes)`, '#4CAF50');
                        initialStateLoaded = true;
                        finishInitialStateLoading();
                    }

                } catch (e) {
                    console.error('[Storage] Error applying loaded board state:', e);
                    addChatMessage('❌ Load Error', `Failed to apply board state: ${e.message}`, '#f44336');
                    initialStateLoaded = true;
                    finishInitialStateLoading();
                }
            } else if (response.status === 'error' && response.data && response.data.includes('not found')) {
                // No saved state yet - this is fine for new boards
                console.log('[Storage] No saved board state found (new board)');
                initialStateLoaded = true;
                finishInitialStateLoading();
            } else {
                console.warn('[Storage] Failed to load board state:', response);

                // Show error notification to user
                const errorMsg = response.error || response.message || 'Unknown error';
                addChatMessage('❌ Load Error', `Failed to load board state: ${errorMsg}`, '#f44336');

                initialStateLoaded = true;
                finishInitialStateLoading();
            }
        });

    } catch (e) {
        console.error('[Storage] Error loading board state:', e);
        addChatMessage('❌ Load Error', `Failed to load board state: ${e.message}`, '#f44336');
        initialStateLoaded = true;
    }
}

function applyBoardState(strokes) {
    if (!Array.isArray(strokes) || strokes.length === 0) return;

    console.log(`[Board State] Applying ${strokes.length} strokes to canvas`);

    // Apply all strokes immediately without animation
    strokes.forEach(stroke => {
        // Draw directly to canvas
        const cssW = canvas.clientWidth || Math.max(1, Math.floor(canvas.width / (canvas._dpr || 1)));
        const cssH = canvas.clientHeight || Math.max(1, Math.floor(canvas.height / (canvas._dpr || 1)));

        const x1 = (stroke.x1 * cssW) / 100;
        const y1 = (stroke.y1 * cssH) / 100;
        const x2 = (stroke.x2 * cssW) / 100;
        const y2 = (stroke.y2 * cssH) / 100;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (stroke.erase) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.strokeStyle = stroke.color || '#000';
        }

        ctx.lineWidth = stroke.size || 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();

        // Add to board state
        addStrokeToBoardState(stroke);
    });
}

// Board state image cache (for multi-part image messages)
let boardStateImageCache = {
    latestOrderNumber: 0,
    currentOrderNumber: 0,
    totalParts: 0,
    receivedParts: {},
    receivedCount: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    cssWidth: 0,
    cssHeight: 0
};


// NOTE: requestBoardState() is no longer needed because agents automatically broadcast
// their board state every 30 seconds. New agents will receive the next broadcast within
// 30 seconds maximum, and the initial state loading has a 5-second timeout anyway.

// --- end of code change ---

function _processStrokeQueueFrame() {
    try {

        if (!canvas || !ctx) return;

        // Drain up to MAX_STROKES_PER_FRAME strokes
        const toProcess = incomingStrokeQueue.splice(0, MAX_STROKES_PER_FRAME);

        // Track last position per peer for cursor updates
        const lastPositionPerPeer = new Map();

        // Group ALL strokes (regular + magic) into contiguous paths for smoothing
        const groups = [];
        let currentGroup = null;
        for (const s of toProcess) {
            const color = s.color || '#000';
            const size = s.size || 1;
            const erase = !!s.erase;
            const isMagic = !!s.isMagic;

            // Strokes are in absolute canvas coordinates (0-1920, 0-1080)
            const x1 = s.x1;
            const y1 = s.y1;
            const x2 = s.x2;
            const y2 = s.y2;

            // Track last position for this peer (for cursor update)
            if (s.peerId) {
                lastPositionPerPeer.set(s.peerId, {x: x2, y: y2, color: color});
            }

            // Group contiguous strokes (separate groups for magic vs regular)
            const contiguous = currentGroup &&
                currentGroup.color === color &&
                currentGroup.size === size &&
                currentGroup.erase === erase &&
                currentGroup.isMagic === isMagic &&
                (Math.hypot(currentGroup.lastX - x1, currentGroup.lastY - y1) < Math.max(2, size * 2));

            if (!currentGroup || !contiguous) {
                currentGroup = {color, size, erase, isMagic, points: [], lastX: x2, lastY: y2};
                currentGroup.points.push({x: x1, y: y1});
                currentGroup.points.push({x: x2, y: y2});
                groups.push(currentGroup);
            } else {
                currentGroup.points.push({x: x2, y: y2});
                currentGroup.lastX = x2;
                currentGroup.lastY = y2;
            }
        }

        // Draw each group - drawSmoothPath will handle magic vs regular
        for (const g of groups) {
            if (g.points.length < 2) continue;
            drawSmoothPath(g.points, g.color, g.size, g.erase, g.isMagic);

            // IMPORTANT: For magic strokes, add to magicStrokes array for fade animation
            // This ensures remote magic strokes fade properly like local ones
            if (g.isMagic && g.points.length >= 2) {
                // Convert path segments into individual strokes for magicStrokes array
                for (let i = 0; i < g.points.length - 1; i++) {
                    const magicStroke = {
                        x1: g.points[i].x,
                        y1: g.points[i].y,
                        x2: g.points[i + 1].x,
                        y2: g.points[i + 1].y,
                        color: g.color,
                        size: g.size,
                        erase: g.erase,
                        isMagic: true,
                        id: `magic_remote_${magicStrokeIdCounter++}`,
                        createdAt: Date.now(),
                        expiresAt: Date.now() + MAGIC_PEN_DURATION
                    };
                    magicStrokes.push(magicStroke);
                }
                // Start cleanup if not already running
                startMagicPenCleanup();
            }
        }

        // Update cursors AFTER drawing strokes
        for (const [peerId, pos] of lastPositionPerPeer) {
            remoteCursorTargets.set(peerId, {
                x: pos.x,
                y: pos.y,
                color: pos.color
            });
        }
    } catch (e) {
        console.warn('[Render] processStrokeQueueFrame failed:', e);
    }
}

// Draw a smooth path given an array of CSS pixel points using quadratic midpoint smoothing
function drawSmoothPath(points, color, size, erase, isMagic = false) {
    if (!ctx || !points || points.length === 0) return;

    // Select correct canvas: magic pen uses magic canvas, regular uses main canvas
    const drawCtx = (isMagic && magicCtx) ? magicCtx : ctx;

    drawCtx.save();
    drawCtx.lineWidth = size;
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.strokeStyle = erase ? '#ffffff' : (color || '#000');

    if (points.length === 2) {
        drawCtx.beginPath();
        drawCtx.moveTo(points[0].x, points[0].y);
        drawCtx.lineTo(points[1].x, points[1].y);
        drawCtx.stroke();
        drawCtx.restore();

        // Note: Magic strokes are already added to magicStrokes array in draw() function
        // via addMagicStroke() - don't add them again here to avoid duplicates
        return;
    }

    // Use midpoint quadratic smoothing
    drawCtx.beginPath();
    const firstMidX = (points[0].x + points[1].x) / 2;
    const firstMidY = (points[0].y + points[1].y) / 2;
    drawCtx.moveTo(firstMidX, firstMidY);

    for (let i = 1; i < points.length - 1; i++) {
        const cur = points[i];
        const next = points[i + 1];
        const midX = (cur.x + next.x) / 2;
        const midY = (cur.y + next.y) / 2;
        drawCtx.quadraticCurveTo(cur.x, cur.y, midX, midY);
    }

    const last = points[points.length - 1];
    drawCtx.lineTo(last.x, last.y);
    drawCtx.stroke();
    drawCtx.restore();

    // Note: Magic strokes are already added to magicStrokes array in draw() function
    // via addMagicStroke() - don't add them again here to avoid duplicates
}

function _renderLoop(ts) {
    try {
        if (!_lastRenderTs) _lastRenderTs = ts;
        const elapsed = ts - _lastRenderTs;
        if (elapsed >= RENDER_INTERVAL) {
            _lastRenderTs = ts - (elapsed % RENDER_INTERVAL);

            // Process stroke queue
            if (incomingStrokeQueue.length > 0) {
                _processStrokeQueueFrame();
            }

            // Process cursor interpolation for smooth movement
            _updateRemoteCursors();
        }
    } catch (e) {
        console.warn('renderLoop tick failed', e);
    }
    // Always request next frame while loop running
    if (_renderLoopRunning) requestAnimationFrame(_renderLoop);
}

/**
 * Smoothly interpolate remote cursors towards their target positions
 * Called from render loop for smooth 60fps animation
 */
function _updateRemoteCursors() {
    remoteCursorTargets.forEach((target, peerId) => {
        let cursor = remoteCursors.get(peerId);

        if (!cursor) {
            // Create cursor element if it doesn't exist
            cursor = document.createElement('div');
            cursor.className = 'remote-cursor';
            cursor.setAttribute('data-name', peerId);
            cursor.style.background = target.color || '#667eea';
            document.getElementById('cursorsLayer').appendChild(cursor);
            remoteCursors.set(peerId, cursor);

            // Store current position (start at target to avoid jump)
            cursor._currentX = target.x;
            cursor._currentY = target.y;
        }

        // Initialize current position if not set
        if (cursor._currentX === undefined) {
            cursor._currentX = target.x;
            cursor._currentY = target.y;
        }

        // Smoothly interpolate towards target position
        cursor._currentX += (target.x - cursor._currentX) * CURSOR_INTERPOLATION_SPEED;
        cursor._currentY += (target.y - cursor._currentY) * CURSOR_INTERPOLATION_SPEED;

        // Convert canvas coordinates to viewport coordinates
        const viewportPos = canvasToViewport(cursor._currentX, cursor._currentY);

        // Update cursor position
        cursor.style.left = viewportPos.x + 'px';
        cursor.style.top = viewportPos.y + 'px';

        // Update color if changed
        if (target.color && cursor.style.background !== target.color) {
            cursor.style.background = target.color;
        }
    });
}

function startRenderLoop() {
    if (_renderLoopRunning) return;
    _renderLoopRunning = true;
    _lastRenderTs = 0;
    requestAnimationFrame(_renderLoop);
}

function stopRenderLoop() {
    _renderLoopRunning = false;
}

// Stroke sending loop using requestAnimationFrame
let _strokeSendLoopRunning = false;
let lastDataChannelSendTime = 0;
const DATACHANNEL_SEND_INTERVAL = 4; // ~250fps for DataChannel (ultra-smooth, especially for mobile)

// Get cursor style for current tool
function getCursorForTool(tool) {
    switch (tool) {
        case 'hand':
            return 'grab';
        case 'erase':
            return 'crosshair';
        case 'magic':
            return 'crosshair';
        case 'draw':
        default:
            return 'crosshair';
    }
}

function _strokeSendLoop(ts) {
    if (!_strokeSendLoopRunning) return;

    // Send immediately via DataChannel for smooth real-time drawing (every frame if available)
    // Use adaptive send interval based on drawing speed
    const sendInterval = ADAPTIVE_SEND_RATE ? currentSendInterval : DATACHANNEL_SEND_INTERVAL;

    if (webrtcHelper && strokeBuffer.length > 0 && (ts - lastDataChannelSendTime) >= sendInterval) {
        // Apply stroke compression if enabled
        let strokes = USE_STROKE_COMPRESSION ? compressStrokes(strokeBuffer.slice()) : strokeBuffer.slice();

        // Log compression stats
        if (USE_STROKE_COMPRESSION && compressionStatsTotal > 0) {
            const savedPercent = ((compressionStatsSaved / compressionStatsTotal) * 100).toFixed(1);
            if (compressionStatsTotal % 100 === 0) {
                console.log(`[Compression] Saved ${compressionStatsSaved}/${compressionStatsTotal} strokes (${savedPercent}%)`);
            }
        }

        // Try binary encoding if enabled
        const binaryData = USE_BINARY_STROKES ? encodeStrokesBinary(strokes) : null;

        let strokeData;
        if (binaryData) {
            // Send binary format
            // Convert Float32Array to regular array for JSON serialization
            strokeData = {
                type: 'stroke-batch-binary',
                binaryStrokes: Array.from(binaryData),  // Convert to regular array
                count: strokes.length,
                sender: username,
                color: currentColor
            };
        } else {
            // Fallback to JSON format
            strokeData = {
                type: 'stroke-batch',
                strokes: strokes,
                sender: username,
                color: currentColor
            };
        }

        const sentCount = webrtcHelper.broadcastDataChannel(strokeData);
        if (sentCount > 0) {
            strokeBuffer = [];
            lastDataChannelSendTime = ts;
        }
    }

    // If no DataChannel, fall back to normal batching via messaging platform (slower)
    if (!webrtcHelper && strokeBuffer.length > 0 && (ts - lastStrokeSendTime) >= STROKE_BATCH_INTERVAL) {
        lastStrokeSendTime = ts;
    }

    // Continue loop
    if (_strokeSendLoopRunning) {
        requestAnimationFrame(_strokeSendLoop);
    }
}

function startStrokeSendLoop() {
    if (_strokeSendLoopRunning) return;
    _strokeSendLoopRunning = true;
    lastStrokeSendTime = 0;
    requestAnimationFrame(_strokeSendLoop);
}

function stopStrokeSendLoop() {
    _strokeSendLoopRunning = false;
}

// Initial buffering flag to avoid 'continuous draw' effect when connecting
let initialBuffering = false;            // true when we should accumulate incoming events

// Canvas scaling mode: 'stretch' | 'fit' | 'preserve'
let CANVAS_SCALE_MODE = 'fit'; // default to aspect-preserving fit

// Allow runtime change
window.setWhiteboardScaleMode = function (mode) {
    if (['stretch', 'fit', 'preserve'].includes(mode)) {
        CANVAS_SCALE_MODE = mode;
        resizeCanvas();
    } else {
        console.warn('Invalid scale mode:', mode);
    }
};


// Initialize username/channel/password inputs on page load
// Now using common connection-modal.js
function initializeCredentialInputs() {
    // Load and initialize connection modal with whiteboard customization
    window.loadConnectionModal({
        localStoragePrefix: 'whiteboard_',
        channelPrefix: 'whiteboard-',
        title: '🎨 Join Whiteboard',
        collapsedTitle: '🎨 Join Whiteboard',
        onConnect: function(username, channel, password) {
            // Call the whiteboard's connect function
            connect();
        },
        onHideModal: function() {
            // Modal hidden after connection
            console.log('[Whiteboard] Connection modal hidden');
        }
    });
}

// Make header toolbar draggable - VERTICAL ONLY (stays centered horizontally)
function initDraggableHeader() {
    const header = document.querySelector('.header');
    if (!header) return;

    let isDragging = false;
    let initialY = 0;
    let yOffset = 0;
    const minTop = 5;
    const maxTopOffset = window.innerHeight - 60;

    // Load saved Y position from localStorage
    try {
        const savedPos = localStorage.getItem('whiteboard_toolbar_top');
        if (savedPos) {
            const top = parseInt(savedPos, 10);
            // Validate is within bounds
            const validTop = Math.max(minTop, Math.min(maxTopOffset, top));
            yOffset = validTop;
            header.style.top = validTop + 'px';
            console.log(`[Toolbar] Restored vertical position: ${validTop}px`);
        }
    } catch (e) {
        console.warn('Failed to load toolbar position', e);
    }

    function dragStart(e) {
        // Don't drag if clicking on buttons, inputs, or interactive elements
        const target = e.target;
        if (target.tagName === 'BUTTON' ||
            target.tagName === 'INPUT' ||
            target.classList.contains('color-btn') ||
            target.closest('button') ||
            target.closest('input')) {
            return;
        }

        isDragging = true;
        if (e.type === "touchstart") {
            initialY = e.touches[0].clientY - yOffset;
        } else {
            initialY = e.clientY - yOffset;
        }
        header.classList.add('dragging');
    }

    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();

        let currentY;
        if (e.type === "touchmove") {
            currentY = e.touches[0].clientY - initialY;
        } else {
            currentY = e.clientY - initialY;
        }

        // Constrain Y within viewport bounds
        const constrainedY = Math.max(minTop, Math.min(maxTopOffset, currentY));
        yOffset = constrainedY;

        // Keep header centered horizontally with transform translateX(-50%)
        // Only modify top for vertical dragging
        header.style.top = constrainedY + 'px';
    }

    function dragEnd(e) {
        if (!isDragging) return;
        isDragging = false;
        header.classList.remove('dragging');

        // Save Y position to localStorage
        try {
            localStorage.setItem('whiteboard_toolbar_top', String(yOffset));
        } catch (e) {
            console.warn('Failed to save toolbar position', e);
        }
    }

    // Mouse events
    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    // Touch events for mobile
    header.addEventListener('touchstart', dragStart, {passive: false});
    document.addEventListener('touchmove', drag, {passive: false});
    document.addEventListener('touchend', dragEnd);

    // Double-click to reset position
    header.addEventListener('dblclick', (e) => {
        const target = e.target;
        if (target.tagName === 'BUTTON' ||
            target.tagName === 'INPUT' ||
            target.classList.contains('color-btn') ||
            target.closest('button') ||
            target.closest('input')) {
            return;
        }

        console.log('[Toolbar] Double-click detected, resetting toolbar to top-center');
        yOffset = 16; // Default top position (var(--space-4) = 16px)
        header.style.top = yOffset + 'px';
        localStorage.removeItem('whiteboard_toolbar_top');

        try {
            addChatMessage('System', 'Toolbar reset to top-center ↻', '#4CAF50');
        } catch (err) {
            console.log('Toolbar reset to top-center');
        }
    });

    // Keyboard shortcut to reset (Ctrl+Shift+R)
    document.addEventListener('keydown', (e) => {
        // Space key: enable pan mode (Excalidraw-style)
        if (e.code === 'Space' && !e.repeat) {
            // Don't activate pan mode if user is typing in an input field
            const activeElement = document.activeElement;
            if (activeElement && (
                activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.isContentEditable
            )) {
                return;
            }

            e.preventDefault();
            spaceKeyPressed = true;

            // Change cursor to indicate pan mode
            if (canvas) {
                canvas.style.cursor = 'grab';
            }
        }

        // Ctrl+Shift+R: reset toolbar position
        if (e.ctrlKey && e.shiftKey && e.key === 'R') {
            e.preventDefault();
            console.log('[Toolbar] Resetting toolbar to top-center');
            yOffset = 16;
            header.style.top = yOffset + 'px';
            localStorage.removeItem('whiteboard_toolbar_top');

            try {
                addChatMessage('System', 'Toolbar position reset to top-center (Ctrl+Shift+R)', '#4CAF50');
            } catch (err) {
                console.log('Toolbar reset to top-center');
            }
        }
    });

    // Space key release: disable pan mode
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            spaceKeyPressed = false;

            // Stop panning if active
            if (isPanning && !e.touches) {
                isPanning = false;
                saveViewportTransform();
            }

            // Restore cursor
            if (canvas && currentTool !== 'hand') {
                canvas.style.cursor = getCursorForTool(currentTool);
            }
        }
    });

    console.log('[Toolbar] ✓ Vertical-only draggable toolbar initialized');
    console.log('[Toolbar] 💡 Drag header UP/DOWN to reposition vertically');
    console.log('[Toolbar] 💡 Header stays CENTERED HORIZONTALLY');
    console.log('[Toolbar] 💡 Double-click empty toolbar space to reset to top');
    console.log('[Toolbar] 💡 Or press Ctrl+Shift+R to reset');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('whiteboard');
    ctx = canvas.getContext('2d');

    // Create magic pen canvas layer - STANDARD canvas layering technique
    // Both canvases absolutely positioned in same wrapper
    magicCanvas = document.createElement('canvas');
    magicCanvas.id = 'whiteboard-magic';
    magicCanvas.style.position = 'absolute';
    magicCanvas.style.pointerEvents = 'none'; // Click through to main canvas

    // Insert in same parent (wrapper), after main canvas
    canvas.parentNode.appendChild(magicCanvas);
    magicCtx = magicCanvas.getContext('2d');

    console.log('[Magic Pen] Magic canvas layer created');

    // Clear old positioning data (from old system) - force recalculation
    localStorage.removeItem('whiteboard_viewport');

    // Initialize canvas with fixed size
    resizeCanvas();

    // Reset zoom to auto-fit viewport and center board (uses body width/height)
    // This ensures the board is properly centered initially
    resetZoom();

    console.log(`[Init] Canvas initialized with auto-fit zoom and centered position`);

    // Setup canvas event listeners (drawing, pan, zoom)
    setupCanvas();

    window.addEventListener('resize', handleResize);

    // Initialize undo/redo buttons as disabled (no history yet)
    updateUndoRedoButtons();

    // Handle orientation change with delay to let layout settle
    window.addEventListener('orientationchange', () => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                handleResize();
            });
        });
    });

    // Initialize username/channel/password inputs
    initializeCredentialInputs();

    // Make header toolbar draggable
    initDraggableHeader();

    // Keyboard shortcuts for zoom
    document.addEventListener('keydown', (e) => {
        // Ctrl+Plus or Ctrl+= for zoom in
        if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
            e.preventDefault();
            zoomIn();
        }
        // Ctrl+Minus for zoom out
        else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
            e.preventDefault();
            zoomOut();
        }
        // Ctrl+0 for reset zoom
        else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
            e.preventDefault();
            resetZoom();
        }
    });

    // Sidebar toggle for mobile
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('closed');

            // Update aria attributes
            const expanded = !sidebar.classList.contains('closed');
            sidebarToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            sidebarToggle.title = expanded ? 'Hide sidebar' : 'Show sidebar';

            if (!sidebarToggle.getAttribute('aria-controls')) {
                sidebarToggle.setAttribute('aria-controls', 'sidebar');
            }

            // Resize canvas after sidebar animation
            requestAnimationFrame(() => handleResize());
        });

        // Initialize aria attributes
        sidebarToggle.setAttribute('aria-controls', 'sidebar');
        sidebarToggle.title = sidebar.classList.contains('closed') ? 'Show sidebar' : 'Hide sidebar';
    }

    // Chat input: Enter key should send message
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                sendChat();
            }
        });
    }

    // Toolbar toggle button setup - removed (now using toggleToolbar() function integrated with whiteboard icon)

    // Chat toggle button setup - collapse/expand chat
    const chatToggleBtn = document.getElementById('chatToggleBtn');
    const chatBox = document.querySelector('.chat-box');

    if (chatToggleBtn && chatBox) {
        // Always start collapsed
        chatBox.className = 'chat-box collapsed';
        updateChatToggleButton();

        chatToggleBtn.addEventListener('click', () => {
            const classes = chatBox.className;

            if (classes.includes('collapsed')) {
                chatBox.className = 'chat-box chat-normal';
            } else if (classes.includes('chat-normal')) {
                chatBox.className = 'chat-box chat-expanded';
            } else if (classes.includes('chat-expanded')) {
                chatBox.className = 'chat-box chat-minimized';
            } else if (classes.includes('chat-minimized')) {
                chatBox.className = 'chat-box collapsed';
            } else {
                chatBox.className = 'chat-box chat-minimized';
            }

            updateChatToggleButton();
        });

        function updateChatToggleButton() {
            const classes = chatBox.className;

            if (classes.includes('collapsed')) {
                chatToggleBtn.textContent = '▼';
                chatToggleBtn.title = 'Expand chat - Click to show';
            } else if (classes.includes('chat-expanded')) {
                chatToggleBtn.textContent = '▲';
                chatToggleBtn.title = 'Collapse chat - Click to minimize';
            } else if (classes.includes('chat-minimized')) {
                chatToggleBtn.textContent = '◀';
                chatToggleBtn.title = 'Minimize more - Click to continue';
            } else {
                chatToggleBtn.textContent = '▼';
                chatToggleBtn.title = 'Minimize chat - Click to expand';
            }
        }
    }
    setupCanvas();

    // Start the rAF render loop after canvas is ready
    startRenderLoop();

    // Header share button setup
    const headerShare = document.getElementById('header-share-btn');
    if (headerShare) {
        headerShare.onclick = function () {
            const ch = channelName || (document.getElementById('channelInput') ? document.getElementById('channelInput').value.trim() : '');
            const pw = channelPassword || (document.getElementById('passwordInput') ? document.getElementById('passwordInput').value.trim() : '');
            if (ch && pw) {
                if (typeof ShareModal !== 'undefined' && typeof ShareModal.show === 'function') {
                    ShareModal.show(ch, pw);
                } else if (typeof MiniGameUtils !== 'undefined' && typeof MiniGameUtils.showShareModal === 'function') {
                    MiniGameUtils.showShareModal(ch, pw, '');
                } else if (typeof MiniGameUtils !== 'undefined' && typeof MiniGameUtils.showToast === 'function') {
                    MiniGameUtils.showToast('Share UI not available', 'error');
                } else {
                    alert('Share UI not available');
                }
            } else {
                if (typeof MiniGameUtils !== 'undefined' && typeof MiniGameUtils.showToast === 'function') {
                    MiniGameUtils.showToast('No active channel to share', 'error');
                } else {
                    alert('No active channel to share');
                }
            }
        };
    }
});

// Debounced resize to avoid excessive redraws
let resizeTimeout = null;
let resizeRAF = null;

function resizeCanvas() {
    if (!canvas) return;

    // Cancel any pending prepared playback
    if (preparedTimer) {
        clearTimeout(preparedTimer);
        preparedTimer = null;
    }
    preparedDraw = [];
    initialBuffering = false;

    // Get device pixel ratio for high-DPI displays
    const dpr = window.devicePixelRatio || 1;

    // Set fixed canvas size (absolute coordinate space)
    const canvasWidth = CANVAS_CONFIG.WIDTH;
    const canvasHeight = CANVAS_CONFIG.HEIGHT;

    // IMPORTANT: Use FIXED canvas buffer size (1920x1080) regardless of DPR
    // This ensures canvas snapshots are consistent across all devices (mobile/desktop)
    // Without this, mobile (DPR=2) would have 3840x2160 buffer, causing sync issues
    canvas.width = canvasWidth;  // Always 1920
    canvas.height = canvasHeight; // Always 1080

    // Set canvas display size (CSS pixels - fixed dimensions)
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';

    // Re-acquire context and configure
    ctx = canvas.getContext('2d', {alpha: false});

    // DO NOT scale context by DPR - keep 1:1 mapping for consistent sync
    // This ensures absolute coordinates work the same on all devices
    // Note: This may reduce sharpness on high-DPI displays, but ensures
    // images and drawings sync correctly between mobile and desktop

    // Store DPR for reference (informational only)
    canvas._dpr = dpr;

    // Resize magic canvas to match main canvas exactly
    if (magicCanvas) {
        magicCanvas.width = canvasWidth;
        magicCanvas.height = canvasHeight;
        magicCanvas.style.width = canvasWidth + 'px';
        magicCanvas.style.height = canvasHeight + 'px';
        magicCtx = magicCanvas.getContext('2d');
        console.log('[Magic Pen] Magic canvas resized to match main canvas');
    }

    // Apply viewport transform (zoom and pan)
    applyViewportTransform();

    // Redraw all strokes from boardState at fixed resolution
    redrawCanvas();

    console.log(`[Canvas] Fixed canvas: ${canvasWidth}×${canvasHeight} CSS pixels (${canvas.width}×${canvas.height} buffer pixels, DPR=${dpr} [not applied for sync consistency], zoom=${viewportTransform.zoom.toFixed(2)})`);
}


// Debounced resize handler
function handleResize() {
    // Cancel any pending resize
    if (resizeTimeout) clearTimeout(resizeTimeout);
    if (resizeRAF) cancelAnimationFrame(resizeRAF);

    // Use RAF for smooth resize
    resizeRAF = requestAnimationFrame(() => {
        // Don't call resizeCanvas() - it redraws everything!
        // Instead, just recalculate zoom and center the view

        // Recalculate optimal zoom for new viewport size
        const oldZoom = viewportTransform.zoom;
        viewportTransform.zoom = calculateAutoFitZoom();

        // Recenter canvas in new viewport
        centerCanvasInViewport();

        // Update cursor for new zoom level
        updateCanvasCursor();

        console.log(`[Resize] Zoom adjusted from ${(oldZoom * 100).toFixed(1)}% to ${(viewportTransform.zoom * 100).toFixed(1)}% (no redraw)`);

        resizeRAF = null;
    });
}

function setupCanvas() {
    // Get canvas wrapper element (parent of canvas)
    const canvasWrapper = canvas.parentElement;

    // ===== Drawing Event Handlers =====
    // Attach to canvas for drawing
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // ===== ALSO attach to canvas-wrapper for clicks outside canvas (auto hand mode) =====
    if (canvasWrapper) {
        canvasWrapper.addEventListener('mousedown', startDrawing);
        canvasWrapper.addEventListener('mousemove', draw);
        canvasWrapper.addEventListener('mouseup', stopDrawing);
        console.log('[Setup] ✅ Mouse events attached to canvas AND canvas-wrapper for auto hand mode');
    }


    // ===== Zoom Event Handler (Mouse wheel) - simple zoom with flexbox centering =====
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();

        // Zoom in/out based on wheel direction
        const zoomDelta = e.deltaY > 0 ? -CANVAS_CONFIG.ZOOM_WHEEL_STEP : CANVAS_CONFIG.ZOOM_WHEEL_STEP;
        const oldZoom = viewportTransform.zoom;
        const newZoom = Math.max(CANVAS_CONFIG.MIN_ZOOM,
            Math.min(CANVAS_CONFIG.MAX_ZOOM, oldZoom + zoomDelta));

        // Update zoom
        viewportTransform.zoom = newZoom;

        // Apply transform - flexbox on wrapper handles centering automatically
        applyViewportTransform();
        saveViewportTransform();

        // Update cursor to reflect new zoom scale
        updateCanvasCursor();

        console.log(`[Wheel Zoom] ${Math.round(oldZoom * 100)}% → ${Math.round(newZoom * 100)}%`);
    }, {passive: false});

    // Send cursor position immediately via DataChannel (even when not drawing)
    let lastCursorSendTime = 0;
    const CURSOR_SEND_THROTTLE = 16; // ~60fps for cursor updates

    canvas.addEventListener('mousemove', (e) => {

        // Don't send cursor updates while panning or drawing
        if (isPanning || drawing) return;

        const now = performance.now();

        // Throttle cursor updates to 60fps (16.67ms)
        //if (now - lastCursorSendTime < CURSOR_SEND_THROTTLE) return;

        if (connected && webrtcHelper) {
            // Convert viewport to canvas coordinates for cursor position
            const pos = viewportToCanvas(e.clientX, e.clientY);

            // Calculate distance moved since last sent cursor position (distance-based throttling)
            const dx = lastSentCursorX >= 0 ? pos.x - lastSentCursorX : CURSOR_MIN_DISTANCE_SCREEN / viewportTransform.zoom + 1;
            const dy = lastSentCursorY >= 0 ? pos.y - lastSentCursorY : CURSOR_MIN_DISTANCE_SCREEN / viewportTransform.zoom + 1;
            const distanceMoved = Math.sqrt(dx * dx + dy * dy);

            // Scale threshold based on zoom level for consistent visual behavior
            const distanceThreshold = CURSOR_MIN_DISTANCE_SCREEN / viewportTransform.zoom;

            // Only send if cursor moved enough distance (prevents duplicate position sends)
            if (distanceMoved >= distanceThreshold || true) {
                lastCursorSendTime = now;
                lastSentCursorX = pos.x;
                lastSentCursorY = pos.y;

                webrtcHelper.broadcastDataChannel({
                    type: 'cursor',
                    x: pos.x,  // Use absolute canvas coordinates
                    y: pos.y,
                    color: currentColor
                });
            }
        }
    });

    // ===== Touch Gesture Support (Drawing OR Pan/Zoom based on tool) =====
    let isTouchDrawing = false; // Track if currently drawing with touch
    let lastTouchMidX = 0;
    let lastTouchMidY = 0;
    let isPinching = false;

    canvas.addEventListener('touchstart', (e) => {
        if (currentTool === 'hand' || e.touches.length === 2) {
            // Hand tool mode OR two-finger gesture: pan and zoom
            if (e.touches.length === 1) {
                // Single finger pan (hand tool only)
                if (currentTool === 'hand') {
                    e.preventDefault();
                    e.stopPropagation();

                    const touch = e.touches[0];
                    lastTouchMidX = touch.clientX;
                    lastTouchMidY = touch.clientY;
                    isPanning = true;

                    const canvasContainer = canvas.parentElement.parentElement;
                    if (canvasContainer) {
                        canvasContainer.style.cursor = 'grabbing';
                    }
                } else {
                    // Drawing tools: Check if touching outside canvas (AUTO HAND MODE)
                    const touch = e.touches[0];
                    const pos = viewportToCanvas(touch.clientX, touch.clientY);

                    if (isOutsideCanvas(pos.x, pos.y)) {
                        // Outside canvas - activate auto hand mode
                        e.preventDefault();
                        e.stopPropagation();

                        console.log(`[AUTO HAND MOBILE] 🎯 Touch outside canvas at (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
                        handleClickOutsideCanvas(pos.x, pos.y);

                        lastTouchMidX = touch.clientX;
                        lastTouchMidY = touch.clientY;
                        isPanning = true;

                        console.log(`[AUTO HAND MOBILE] ✅ Panning enabled, start: (${lastTouchMidX}, ${lastTouchMidY})`);
                    } else {
                        // Inside canvas - normal drawing
                        e.preventDefault();
                        e.stopPropagation();
                        isTouchDrawing = true;

                        const syntheticEvent = {
                            clientX: touch.clientX,
                            clientY: touch.clientY,
                            preventDefault: () => {
                            },
                            stopPropagation: () => {
                            }
                        };

                        startDrawing(syntheticEvent);
                        draw(syntheticEvent);
                    }
                }
            } else if (e.touches.length === 2) {
                // Two-finger gesture: pinch zoom + pan
                e.preventDefault();
                e.stopPropagation();

                // Stop any ongoing drawing
                if (isTouchDrawing) {
                    stopDrawing();
                    isTouchDrawing = false;
                }

                isPanning = false;
                isPinching = true;

                const touch1 = e.touches[0];
                const touch2 = e.touches[1];

                touchStartDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );
                touchStartZoom = viewportTransform.zoom;
                touchStartPanX = viewportTransform.panX;
                touchStartPanY = viewportTransform.panY;

                // Store midpoint for zoom centering
                touchStartMidX = (touch1.clientX + touch2.clientX) / 2;
                touchStartMidY = (touch1.clientY + touch2.clientY) / 2;
                lastTouchMidX = touchStartMidX;
                lastTouchMidY = touchStartMidY;
            }
        } else {
            // Drawing tool mode: 1 finger = draw
            if (e.touches.length === 1 && !isPinching) {
                e.preventDefault();
                e.stopPropagation();
                isTouchDrawing = true;

                const touch = e.touches[0];
                const syntheticEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    preventDefault: () => {
                    },
                    stopPropagation: () => {
                    }
                };

                startDrawing(syntheticEvent);
                draw(syntheticEvent);
            }
        }
    }, {passive: false});

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && isPinching) {
            // Two-finger gesture: simultaneous pinch zoom + pan (Excalidraw-style)
            e.preventDefault();
            e.stopPropagation();

            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            // Calculate current distance for zoom
            const currentDistance = Math.hypot(
                touch2.clientX - touch1.clientX,
                touch2.clientY - touch1.clientY
            );

            // Calculate zoom scale
            const zoomScale = currentDistance / touchStartDistance;
            const newZoom = Math.max(CANVAS_CONFIG.MIN_ZOOM,
                Math.min(CANVAS_CONFIG.MAX_ZOOM, touchStartZoom * zoomScale));

            // Just update zoom - flexbox on wrapper handles centering automatically
            viewportTransform.zoom = newZoom;

            // Apply transform (CSS transform handles visual update, no redraw needed)
            applyViewportTransform();
            updateCanvasCursor(); // Update cursor for new zoom level

            console.log(`[Pinch Zoom] ${Math.round(touchStartZoom * 100)}% → ${Math.round(newZoom * 100)}%`);
        } else if (e.touches.length === 1) {
            if (isPanning && (currentTool === 'hand' || autoHandModeActive)) {
                // Single finger pan (hand tool or auto-hand mode)
                e.preventDefault();
                e.stopPropagation();

                const touch = e.touches[0];
                const deltaX = touch.clientX - lastTouchMidX;
                const deltaY = touch.clientY - lastTouchMidY;

                // Update viewport pan
                viewportTransform.panX += deltaX;
                viewportTransform.panY += deltaY;

                lastTouchMidX = touch.clientX;
                lastTouchMidY = touch.clientY;

                // Apply transform
                applyViewportTransform();
            } else if (isTouchDrawing) {
                // Single touch for drawing
                e.preventDefault();
                e.stopPropagation();

                const touch = e.touches[0];
                const syntheticEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    preventDefault: () => {
                    },
                    stopPropagation: () => {
                    }
                };

                draw(syntheticEvent);
            }
        }
    }, {passive: false});

    canvas.addEventListener('touchend', (e) => {
        // End panning when all fingers lifted
        if (e.touches.length === 0) {
            if (isPanning || isPinching) {
                saveViewportTransform();
            }
            isPanning = false;
            isPinching = false;

            // Restore previous tool if auto-hand mode was active (mobile same as PC)
            if (autoHandModeActive) {
                autoHandModeActive = false;
                setTool(previousTool);
                console.log(`[AUTO HAND MOBILE] ✅ Touch ended - restored ${previousTool} tool`);
            }

            const canvasContainer = canvas.parentElement.parentElement;
            if (canvasContainer && currentTool === 'hand') {
                canvasContainer.style.cursor = 'grab';
            }

            // Stop drawing if touch ends
            if (isTouchDrawing) {
                e.preventDefault();
                e.stopPropagation();
                isTouchDrawing = false;
                stopDrawing();
            }
        } else if (e.touches.length === 1 && isPinching) {
            // Transition from 2 fingers to 1 finger
            saveViewportTransform();
            isPinching = false;
            touchStartDistance = 0;

            // If hand tool, start panning with remaining finger
            if (currentTool === 'hand') {
                isPanning = true;
                const touch = e.touches[0];
                lastTouchMidX = touch.clientX;
                lastTouchMidY = touch.clientY;
            } else if (!isTouchDrawing) {
                // For drawing tools, start drawing with remaining finger if not already drawing
                isTouchDrawing = true;
                const touch = e.touches[0];
                const syntheticEvent = {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    preventDefault: () => {
                    },
                    stopPropagation: () => {
                    }
                };
                startDrawing(syntheticEvent);
            }
        }
    }, {passive: false});

    canvas.addEventListener('touchcancel', (e) => {
        // Handle touch cancel (e.g., system gesture interrupts)
        isPanning = false;
        isPinching = false;
        touchStartDistance = 0;

        const canvasContainer = canvas.parentElement.parentElement;
        if (canvasContainer && currentTool === 'hand') {
            canvasContainer.style.cursor = 'grab';
        }

        // Stop drawing on cancel
        if (isTouchDrawing) {
            isTouchDrawing = false;
            stopDrawing();
        }
    }, {passive: false});

    // Setup drag-to-scroll for canvas container
    setupCanvasScroll();
}

/**
 * Setup drag-to-scroll functionality for the canvas container
 * Allows panning the canvas by clicking and dragging when canvas is larger than viewport
 * Works for both desktop (mouse) and mobile (touch)
 */
function setupCanvasScroll() {
    const canvasContainer = document.getElementById('canvasContainer');
    if (!canvasContainer) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;

    // Mouse drag to scroll (desktop)
    canvasContainer.addEventListener('mousedown', (e) => {
        // Only start dragging if clicking on the container background (not on canvas while drawing)
        // or if holding space bar (pan mode)
        if (e.target !== canvas && e.target !== canvasContainer) return;
        if (drawing) return; // Don't interfere with drawing

        // Check if canvas is larger than container (scrollable)
        const isScrollable = canvasContainer.scrollWidth > canvasContainer.clientWidth ||
            canvasContainer.scrollHeight > canvasContainer.clientHeight;

        if (!isScrollable) return; // No need to drag if not scrollable

        isDragging = true;
        canvasContainer.classList.add('panning');
        startX = e.pageX - canvasContainer.offsetLeft;
        startY = e.pageY - canvasContainer.offsetTop;
        scrollLeft = canvasContainer.scrollLeft;
        scrollTop = canvasContainer.scrollTop;
        e.preventDefault();
    });

    canvasContainer.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const x = e.pageX - canvasContainer.offsetLeft;
        const y = e.pageY - canvasContainer.offsetTop;
        const walkX = (x - startX) * 1.5; // Multiply for faster scrolling
        const walkY = (y - startY) * 1.5;

        canvasContainer.scrollLeft = scrollLeft - walkX;
        canvasContainer.scrollTop = scrollTop - walkY;
    });

    canvasContainer.addEventListener('mouseup', () => {
        isDragging = false;
        canvasContainer.classList.remove('panning');
    });

    canvasContainer.addEventListener('mouseleave', () => {
        isDragging = false;
        canvasContainer.classList.remove('panning');
    });

    // Touch drag to scroll (mobile) - DISABLED to prevent interference with canvas drawing
    // Mobile users use 2-finger gesture on canvas for pan/zoom instead
    // Single finger is reserved for drawing only

    // NOTE: Container touch scrolling disabled because:
    // - 1 finger on canvas = drawing (should not move board)
    // - 2 fingers on canvas = pan/zoom
    // - Container scrolling would interfere with drawing gestures

    console.log('[Canvas Scroll] Drag-to-scroll enabled for canvas container (mouse only, touch disabled for drawing)');
}

// ============================================================================
// CONNECTION & INITIALIZATION (Framework Only)
// ============================================================================

async function connect() {
    console.log('[Whiteboard] Connecting via framework...');

    // GUARD: Prevent duplicate connection if already connected
    if (connected) {
        console.warn('[Whiteboard] Already connected, ignoring duplicate connect request');
        return;
    }

    // GUARD: Prevent race condition - check and set connecting flag IMMEDIATELY
    if (connecting) {
        console.warn('[Whiteboard] Connection already in progress, ignoring duplicate connect request');
        return;
    }
    connecting = true; // Set immediately to block any concurrent calls

    // GUARD: Check if whiteboardGame instance already exists and is connected/connecting
    if (whiteboardGame) {
        if (whiteboardGame.connected) {
            console.warn('[Whiteboard] WhiteboardGame already connected, ignoring duplicate connect request');
            connected = true; // Sync state
            connecting = false; // Reset flag
            return;
        }
        if (whiteboardGame.connecting) {
            console.warn('[Whiteboard] WhiteboardGame connection in progress, ignoring duplicate connect request');
            connecting = false; // Reset flag
            return;
        }
    }

    // Hide modal immediately on mobile for better UX
    if (isMobilePortrait()) hideConnectionModal();

    username = document.getElementById('usernameInput').value.trim() || 'User';
    channelName = document.getElementById('channelInput').value.trim();
    channelPassword = document.getElementById('passwordInput').value.trim();

    if (!channelName || !channelPassword) {
        connecting = false; // Reset connecting flag on validation error
        if (isMobilePortrait()) showConnectionModal();
        alert('Please enter room name and password');
        return;
    }

    // Save connection settings
    try {
        localStorage.setItem('whiteboard_username', username);
        localStorage.setItem('whiteboard_channel', channelName);
        localStorage.setItem('whiteboard_password', channelPassword);
    } catch (e) {
        console.warn('Failed to save connection settings:', e);
    }

    // Update document title with channel name
    document.title = channelName || 'Whiteboard';

    try {
        // Initialize and connect via WhiteboardGame framework
        console.log('[Whiteboard] Connecting via framework...');

        // Create game instance
        const game = new WhiteboardGame();

        // Initialize whiteboard state references (connect to global state)
        game.initializeWhiteboardState(users, remoteCursors, remoteCursorTargets);

        // Initialize first
        await game.initialize();

        // Connect (this sets up channel and webrtc automatically)
        await game.connect({
            username,
            channelName,
            channelPassword
        });

        // Start the game
        game.start();

        // Store in module-level variable
        whiteboardGame = game;

        // Update global state with framework objects
        connected = true;
        connecting = false; // Reset connecting flag on success
        connectionState.connected = true;
        channel = game.channel;
        webrtcHelper = game.webrtcHelper;
        connectionState.channel = game.channel;
        connectionState.webrtcHelper = game.webrtcHelper;

        // Update UI
        hideConnectionModal();
        const connEl = document.querySelector('.connection-status');
        if (connEl) {
            connEl.dataset.status = 'Connected';
            connEl.classList.remove('offline');
            connEl.classList.add('online');
        }

        // Add self to users
        users.set(username, {color: currentColor});

        // Get existing users
        const agentNames = channel.connectedAgents || [];
        agentNames.forEach(name => {
            if (name !== username) {
                users.set(name, {color: generateUserColor(name)});
                addChatMessage('System', `${name} is already in the whiteboard`, '#2196F3');
                showConnectToast(name);
            }
        });

        updateUserList();
        addChatMessage('System', 'Connected to whiteboard!', '#4CAF50');
        console.log('[Whiteboard] Connected successfully');

        // Update URL hash with connection credentials
        try {
            if (window.ShareModal && typeof window.ShareModal.updateUrlWithAuth === 'function') {
                window.ShareModal.updateUrlWithAuth({
                    channel: channelName,
                    password: channelPassword
                });
                console.log('[Whiteboard] ✓ URL hash updated with auth info');
            }
        } catch (e) {
            console.warn('[Whiteboard] Failed to update URL hash:', e);
        }

        // Hide connection modal after successful connection
        if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
            window.ConnectionModal.hide();
        }

        // Show share button
        try {
            MiniGameUtils.toggleShareButton(true);
            const hs = document.getElementById('header-share-btn');
            if (hs) hs.style.display = 'inline-block';
        } catch (e) {
            console.warn('Failed to show share button:', e);
        }

        // Initialize draw activity timestamp
        lastDrawActivityTime = Date.now();

        // NOTE: Board state is now handled via:
        // - Channel Storage API for long-term persistence (saveBoardStateToStorage/loadBoardStateFromStorage)
        // - DataChannel for real-time stroke updates (stroke-batch-binary messages)
        // No need for periodic event message broadcasts or presence messages anymore
        // channel.connectedAgents already tracks all users automatically

        // Check if we need initial state
        const otherAgents = agentNames.filter(name => name !== username);
        if (otherAgents.length === 0) {
            console.log('[Whiteboard] First agent - checking channel storage...');
            initialStateLoaded = false;
            loadBoardStateFromStorage();
        } else {
            console.log(`[Whiteboard] Other agents present (${otherAgents.length}) - checking storage...`);
            initialStateLoaded = false;
            loadBoardStateFromStorage();

            // Set timeout as fallback
            setTimeout(() => {
                if (!initialStateLoaded) {
                    initialStateLoaded = true;
                    console.log('[Board State] Timeout - marking as loaded');
                }
            }, 5000);
        }

        // Start initial state loading
        startInitialStateLoading();

    } catch (error) {
        console.error('[Whiteboard] Connection failed:', error);
        connecting = false; // Reset connecting flag on error
        alert('Connection failed: ' + error.message);
        if (isMobilePortrait()) showConnectionModal();
    }
}


function sendWhiteboardEvent(eventType, data) {
    if (!connected || !channel) {
        console.warn('[Whiteboard] Event not sent - not connected');
        return;
    }

    try {
        // 1. Send via WebRTC DataChannel first (instant P2P)
        if (webrtcHelper) {
            const sent = webrtcHelper.broadcastDataChannel({
                type: eventType,
                ...data
            });
            if (sent > 0) {
                console.log(`[DataChannel] Sent ${eventType} to ${sent} peer(s)`);
            }
        }

        // 2. Send via Messaging Platform (persistence + fallback)
        const content = JSON.stringify({
            type: eventType,
            data: data
        });
    } catch (error) {
        console.error('Send whiteboard event error:', error);
    }
}


// ============================================
// CONNECTION FUNCTIONS
// ============================================

/**
 * Fetch canvas from storage and apply it (uses channel.storageGet)
 * Uses SAME storage key and format as auto-save: 'whiteboard-data'
 */
function fetchCanvasFromStorage(fromPeer, actionType) {
    // Check if sync is already in progress - silently skip (no toast)
    if (syncInProgress) {
        console.log(`[Board State] Sync already in progress (${syncInitiator}), skipping fetch request from ${fromPeer}`);
        return; // Silently skip - don't show warning toast
    }

    console.log(`[Board State] Step 2: Fetching from channel storage (notified by ${fromPeer})...`);

    if (!connected || !channel) {
        console.error(`[Board State] Not connected - cannot fetch from storage`);
        return;
    }

    // Set sync lock
    syncInProgress = true;
    syncInitiator = 'receiver';
    console.log(`[Board State] 🔒 Sync lock acquired (receiver) from ${fromPeer}`);

    channel.storageGet({
        storageKey: STORAGE_KEY
    }, function (response) {
        if (response.status === 'success' && response.data) {
            const boardStateData = response.data;
            console.log(`[Board State] ✓ Step 2 complete: Retrieved from storage`);

            // Check if it's from someone else (avoid applying our own canvas)
            if (boardStateData.author === username) {
                console.log(`[Board State] Skipping - canvas is from self`);
                // Release sync lock
                syncInProgress = false;
                syncInitiator = null;
                console.log(`[Board State] 🔓 Sync lock released (self-canvas)`);
                return;
            }

            // Apply canvas snapshot (same format as auto-save)
            if (boardStateData.canvasSnapshot) {
                const img = new Image();
                img.onload = function () {
                    try {
                        // Clear existing canvas
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        clearBoardState();

                        // Draw the image at exact canvas dimensions to ensure 1:1 rendering
                        // This ensures images and drawings appear at same position on all agents
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                        // Also restore strokes if available
                        if (boardStateData.strokes && Array.isArray(boardStateData.strokes)) {
                            boardStateData.strokes.forEach(stroke => {
                                addStrokeToBoardState(stroke);
                            });
                        }

                        console.log(`[Board State] ✅ Canvas synced successfully from ${fromPeer} at ${canvas.width}x${canvas.height}`);

                        // Show notification
                        if (actionType === 'sync') {
                            MiniGameUtils.showToast(`✓ Canvas synced from ${fromPeer}`, 'success', 3000);
                            addChatMessage('System', `Canvas synced from ${fromPeer}`, '#4CAF50');
                        }

                        // Release sync lock after successful apply
                        syncInProgress = false;
                        syncInitiator = null;
                        console.log(`[Board State] 🔓 Sync lock released (receiver)`);

                    } catch (e) {
                        console.error(`[Board State] Failed to draw synced canvas:`, e);
                        // Release sync lock on error
                        syncInProgress = false;
                        syncInitiator = null;
                        console.log(`[Board State] 🔓 Sync lock released (error)`);
                    }
                };

                img.onerror = function (err) {
                    console.error(`[Board State] Failed to load canvas image:`, err);
                    MiniGameUtils.showToast(`Failed to load canvas from ${fromPeer}`, 'error');
                    // Release sync lock on error
                    syncInProgress = false;
                    syncInitiator = null;
                    console.log(`[Board State] 🔓 Sync lock released (image error)`);
                };

                img.src = boardStateData.canvasSnapshot;
            } else {
                console.warn(`[Board State] No canvas snapshot in storage`);
                // Release sync lock
                syncInProgress = false;
                syncInitiator = null;
                console.log(`[Board State] 🔓 Sync lock released (no snapshot)`);
            }

        } else if (response.status === 'error' && response.data && response.data.includes('not found')) {
            console.warn(`[Board State] No data in storage (key: ${STORAGE_KEY})`);
            // Release sync lock
            syncInProgress = false;
            syncInitiator = null;
            console.log(`[Board State] 🔓 Sync lock released (not found)`);
        } else {
            console.error(`[Board State] Failed to fetch from storage:`, response);
            // Release sync lock
            syncInProgress = false;
            syncInitiator = null;
            console.log(`[Board State] 🔓 Sync lock released (fetch error)`);
        }
    });
}

/**
 * Send board state to agent
 * NOTE: Logic is now in WhiteboardGame.sendBoardStateToAgent
 */
function sendBoardStateToAgent(agentId, actionType = 'sync') {
    if (!whiteboardGame) {
        console.error('[sendBoardStateToAgent] whiteboardGame not initialized yet');
        return;
    }

    if (typeof whiteboardGame.sendBoardStateToAgent !== 'function') {
        console.error('[sendBoardStateToAgent] sendBoardStateToAgent method not found on whiteboardGame instance');
        console.error('[sendBoardStateToAgent] whiteboardGame type:', typeof whiteboardGame);
        console.error('[sendBoardStateToAgent] whiteboardGame keys:', Object.keys(whiteboardGame));
        return;
    }

    whiteboardGame.sendBoardStateToAgent(agentId, actionType);
}

/**
 * Send notification that canvas is ready in storage
 * NOTE: Logic is now in WhiteboardGame.sendCanvasSyncNotification
 */
function sendCanvasSyncNotification(agentId, actionType) {
    if (whiteboardGame) {
        whiteboardGame.sendCanvasSyncNotification(agentId, actionType);
    }
}

/**
 * Fallback: Send canvas directly via DataChannel chunks (for backwards compatibility)
 */
function sendCanvasDirectly(agentId, dataUrl, dimensions, actionType) {
    if (!webrtcHelper || !webrtcHelper.sendData) {
        throw new Error('WebRTC not available');
    }

    const dataSize = dataUrl.length;
    const CHUNK_SIZE = 16000;
    const totalChunks = Math.ceil(dataSize / CHUNK_SIZE);

    console.log(`[Board State] Fallback: Sending ${totalChunks} chunks directly to ${agentId}`);

    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, dataSize);
        const chunk = dataUrl.substring(start, end);

        const chunkData = {
            type: 'board-state-chunk',
            chunkIndex: i,
            totalChunks: totalChunks,
            chunk: chunk,
            final: (i === totalChunks - 1),
            canvasWidth: dimensions.canvasWidth,
            canvasHeight: dimensions.canvasHeight,
            cssWidth: dimensions.cssWidth,
            cssHeight: dimensions.cssHeight,
            sender: username,
            actionType: actionType
        };

        setTimeout(() => {
            if (webrtcHelper && webrtcHelper.sendData) {
                try {
                    webrtcHelper.sendData(agentId, chunkData);
                } catch (sendErr) {
                    console.error(`[Board State] Failed to send chunk ${i}:`, sendErr);
                }
            }
        }, i * 15);
    }
}

function handleBoardStateChunk(peerId, data) {
    try {
        const {
            chunkIndex,
            totalChunks,
            chunk,
            final,
            canvasWidth,
            canvasHeight,
            cssWidth,
            cssHeight,
            canvasHash,
            sender,
            actionType
        } = data;

        if (!chunk) {
            console.warn(`[Board State] Invalid chunk data from ${peerId}`);
            return;
        }

        // ENHANCEMENT: Ignore messages from self
        if (sender === username) {
            console.log(`[Board State] Ignoring board state chunk from self (sender: ${sender})`);
            return;
        }

        // ENHANCEMENT: Check if this is a duplicate based on hash (only on first chunk)
        if (chunkIndex === 0 && canvasHash && canvasHash === lastReceivedCanvasHash) {
            console.log(`[Board State] Ignoring duplicate board state (same hash: ${canvasHash})`);
            return;
        }

        // Initialize receiving state if needed
        if (!window._receivingBoardState) {
            window._receivingBoardState = {
                peerId: peerId,
                totalChunks: totalChunks,
                receivedChunks: 0,
                chunks: new Array(totalChunks),
                canvasWidth: 0,
                canvasHeight: 0,
                cssWidth: 0,
                cssHeight: 0,
                canvasHash: canvasHash || null,
                actionType: actionType || 'sync' // Store action type for toast
            };
            console.log(`[Board State] Receiving board state from ${peerId} (${totalChunks} chunks expected) [hash: ${canvasHash || 'none'}] [action: ${actionType || 'sync'}]`);
        }
        const state = window._receivingBoardState;

        // Store chunk
        state.chunks[chunkIndex] = chunk;
        state.receivedChunks++;

        // Store dimensions from any chunk that has them
        if (canvasWidth && canvasHeight) {
            state.canvasWidth = canvasWidth;
            state.canvasHeight = canvasHeight;
        }
        if (cssWidth && cssHeight) {
            state.cssWidth = cssWidth;
            state.cssHeight = cssHeight;
        }
        // Store hash from first chunk
        if (chunkIndex === 0 && canvasHash) {
            state.canvasHash = canvasHash;
        }
        // Store action type from first chunk
        if (chunkIndex === 0 && actionType) {
            state.actionType = actionType;
        }

        console.log(`[Board State] Received chunk ${chunkIndex + 1}/${totalChunks} from ${peerId}`);

        // Check if all chunks received
        if (state.receivedChunks === totalChunks || final) {
            console.log(`[Board State] All chunks received from ${peerId}, reconstructing canvas...`);

            // Update last received hash to prevent duplicates
            if (state.canvasHash) {
                lastReceivedCanvasHash = state.canvasHash;
                console.log(`[Board State] Updated lastReceivedCanvasHash: ${lastReceivedCanvasHash}`);
            }

            // Reconstruct full data URL
            const fullDataUrl = state.chunks.join('');

            // SMART SYNC PROTECTION: Check if we should ask for confirmation
            const shouldAskConfirmation = shouldConfirmSyncOverwrite(peerId, state.actionType);

            if (shouldAskConfirmation === 'auto-reject') {
                // Auto-rejected (user is drawing) - already handled in shouldConfirmSyncOverwrite
                return;
            } else if (shouldAskConfirmation) {
                // Ask user before overwriting their canvas
                confirmSyncOverwrite(peerId, state.actionType, () => {
                    // User accepted - apply the sync
                    applySyncToCanvas(fullDataUrl, state, peerId);
                }, () => {
                    // User rejected - discard the sync
                    console.log(`[Board State] ⛔ User rejected sync from ${peerId}`);
                    MiniGameUtils.showToast(`🚫 Sync from ${peerId} rejected`, 'warning');
                    addChatMessage('System', `You rejected sync from ${peerId}`, '#FF9800');
                    window._receivingBoardState = null;
                });
            } else {
                // Auto-apply sync (safe cases)
                applySyncToCanvas(fullDataUrl, state, peerId);
            }
        }
    } catch (e) {
        console.error(`[Board State] Failed to handle chunk from ${peerId}:`, e);
        window._receivingBoardState = null;
    }
}

/**
 * Check if we should ask for confirmation before applying sync
 * (to prevent accidental overwrite of user's work)
 */
function shouldConfirmSyncOverwrite(peerId, actionType) {
    // OFFLINE MODE: Reject all incoming syncs
    if (syncMode === 'offline') {
        console.log(`[Board State] ⛔ OFFLINE MODE - Rejecting sync from ${peerId}`);
        MiniGameUtils.showToast(`🚫 Sync blocked (Offline Mode)`, 'info');
        window._receivingBoardState = null;
        return 'auto-reject';
    }

    // AUTO-ACCEPT MODE: Accept all syncs automatically (except when drawing)
    if (syncMode === 'auto-accept') {
        // Still protect during active drawing
        if (drawing) {
            console.log(`[Board State] ⛔ Auto-rejecting sync from ${peerId} - user is actively drawing`);
            MiniGameUtils.showToast(`🚫 Sync from ${peerId} blocked - you're drawing`, 'warning');
            addChatMessage('System', `Sync from ${peerId} auto-rejected (you're drawing)`, '#FF9800');
            window._receivingBoardState = null;
            return 'auto-reject';
        }
        // Auto-accept everything else
        console.log(`[Board State] ✅ AUTO-ACCEPT MODE - Accepting sync from ${peerId}`);
        return false;
    }

    // CONFIRM MODE (default): Smart confirmation logic

    // Always auto-apply during initial loading
    if (isLoadingInitialState) {
        return false;
    }

    // Auto-reject if user is actively drawing (too disruptive)
    if (drawing) {
        console.log(`[Board State] ⛔ Auto-rejecting sync from ${peerId} - user is actively drawing`);
        MiniGameUtils.showToast(`🚫 Sync from ${peerId} blocked - you're drawing`, 'warning');
        addChatMessage('System', `Sync from ${peerId} auto-rejected (you're drawing)`, '#FF9800');
        window._receivingBoardState = null;
        return 'auto-reject'; // Special value to trigger auto-rejection
    }

    // Auto-apply if canvas is blank (nothing to lose)
    if (boardState.length === 0) {
        return false;
    }

    // Auto-apply undo/redo actions (collaborative editing) - but only in confirm mode
    // In confirm mode, real-time strokes are always applied
    if (actionType === 'undo' || actionType === 'redo') {
        return false;
    }

    // Ask for confirmation for sync/import when user has work on canvas
    return true;
}

/**
 * Show confirmation dialog before overwriting canvas
 */
function confirmSyncOverwrite(peerId, actionType, onAccept, onReject) {
    const actionLabel = actionType === 'import' ? 'imported an image' : 'wants to sync the canvas';
    const message = `${peerId} ${actionLabel}. Accept and replace your current canvas?`;

    if (confirm(message)) {
        onAccept();
    } else {
        onReject();
    }
}

/**
 * Apply sync to canvas (after confirmation or auto-approval)
 */
function applySyncToCanvas(fullDataUrl, state, peerId) {
    // Validate data
    if (!fullDataUrl || fullDataUrl.length < 100) {
        console.error('[Board State] Invalid data URL received from', peerId);
        MiniGameUtils.showToast(`❌ Received invalid data from ${peerId}`, 'error');
        addChatMessage('System', `Failed to sync from ${peerId} (invalid data)`, '#f44336');
        window._receivingBoardState = null;
        return;
    }

    console.log(`[Board State] Applying sync from ${peerId} (${Math.round(fullDataUrl.length / 1024)}KB)`);

    // Use utility function to load and draw image
    loadAndDrawCanvasImage(
        fullDataUrl,
        {cssWidth: state.cssWidth, cssHeight: state.cssHeight},
        (result) => {
            console.log(`[Board State] ✓ Board state loaded and scaled from ${peerId} (scale=${result.scale.toFixed(2)}) [action: ${state.actionType}]`);

            // Save canvas snapshot to preserve received image/canvas on window resize
            try {
                canvasSnapshot = fullDataUrl; // Use the received data URL directly
                console.log('[Board State] Canvas snapshot saved for resize preservation');
            } catch (e) {
                console.warn('[Board State] Failed to save canvas snapshot:', e);
                MiniGameUtils.showToast('⚠️ Warning: Image may not persist on resize', 'warning');
            }

            // Show appropriate toast based on action type
            const actionType = state.actionType || 'sync';
            if (actionType === 'undo') {
                showUndoToast(peerId);
                addChatMessage('System', `${peerId} undid last action`, '#4CAF50');
            } else if (actionType === 'redo') {
                showRedoToast(peerId);
                addChatMessage('System', `${peerId} redid last action`, '#4CAF50');
            } else if (actionType === 'import') {
                showImageImportToast(peerId);
                addChatMessage('System', `📷 ${peerId} imported an image`, '#4CAF50');
            } else {
                showSyncToast(peerId);
                addChatMessage('System', `Board synced from ${peerId}`, '#4CAF50');
            }

            // Stop initialization - canvas received via DataChannel!
            if (isLoadingInitialState) {
                console.log('[Init] 🎨 Canvas received via DataChannel, stopping initialization');
                finishInitialStateLoading();
            }

            window._receivingBoardState = null;
        },
        (err) => {
            console.error(`[Board State] Failed to load image from ${peerId}:`, err);
            MiniGameUtils.showToast(`❌ Failed to apply sync from ${peerId}`, 'error');
            addChatMessage('System', `Failed to sync board from ${peerId}: ${err.message}`, '#f44336');
            window._receivingBoardState = null;
        }
    );
}

// Drawing
function startDrawing(e) {
    // Block drawing while board is locked (waiting for DataChannel connection)
    if (isBoardLocked) {
        showToast('⏳ Waiting for connection...', 'info', 2000);
        return;
    }

    // Block drawing while loading initial state
    if (isLoadingInitialState) return;

    // Detect if this is a touch event (synthetic event without button property)
    const isTouchEvent = e.button === undefined;

    // Convert viewport to canvas coordinates to check boundaries
    const pos = viewportToCanvas(e.clientX, e.clientY);

    // DEBUG: Log click position
    console.log(`[DEBUG] Click at viewport (${e.clientX}, ${e.clientY}) → canvas (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
    console.log(`[DEBUG] Canvas bounds: 0-${CANVAS_CONFIG.WIDTH} x 0-${CANVAS_CONFIG.HEIGHT}`);
    console.log(`[DEBUG] Outside canvas? ${isOutsideCanvas(pos.x, pos.y)}`);
    console.log(`[DEBUG] Current tool: ${currentTool}, isPanning: ${isPanning}`);

    // AUTO HAND MODE: If clicking outside canvas bounds, automatically activate hand mode
    if (!isTouchEvent && e.button === 0) {
        if (isOutsideCanvas(pos.x, pos.y)) {
            console.log(`[AUTO HAND] 🎯 Activating hand mode - clicked outside canvas!`);
            e.preventDefault(); // Prevent default browser behavior for dragging
            handleClickOutsideCanvas(pos.x, pos.y);
            // After switching to hand mode, start panning
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            canvas.style.cursor = 'grabbing';
            console.log(`[AUTO HAND] ✅ isPanning set to true, panStart: (${panStartX}, ${panStartY})`);
            return;
        } else {
            // If inside canvas and auto hand mode was active, restore previous tool
            handleClickInsideCanvas(pos.x, pos.y);
        }
    }

    // SPACE KEY or MIDDLE MOUSE or HAND TOOL: Start panning (Excalidraw-style)
    // Note: Skip this check for touch events (they're handled separately)
    if (!isTouchEvent && (spaceKeyPressed || e.button === 1 || currentTool === 'hand')) {
        e.preventDefault();
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        canvas.style.cursor = 'grabbing';
        return;
    }

    // Left mouse button OR touch event: draw (but not if space key is pressed or hand tool)
    if ((isTouchEvent || (e.button === 0 && !spaceKeyPressed)) && currentTool !== 'hand') {
        // Block drawing when panning
        if (isPanning) return;

        // NOTE: Snapshot capture moved to stopDrawing() for better mobile performance
        // Capturing canvas.toDataURL() here causes 50-500ms delay on mobile!

        drawing = true;

        // Use already calculated position
        lastX = pos.x;
        lastY = pos.y;

        // initialize incremental path (absolute canvas coordinates)
        _currentPath = [{x: pos.x, y: pos.y}];
        _currentPathDrawnSegments = 0;

        // Record draw activity only for permanent strokes (not magic pen)
        // Magic pen doesn't modify persistent canvas state, so no need to trigger auto-save
        if (currentTool !== 'magic') {
            recordDrawActivity();
        }
    }
}

function draw(e) {

    // PANNING MODE: Handle panning (space key, middle mouse, or hand tool)
    if (isPanning && !e.touches) {
        e.preventDefault();

        // Calculate delta in screen pixels
        const deltaX = e.clientX - panStartX;
        const deltaY = e.clientY - panStartY;

        // Update viewport pan
        viewportTransform.panX += deltaX;
        viewportTransform.panY += deltaY;

        // Update start position for next delta
        panStartX = e.clientX;
        panStartY = e.clientY;

        // Apply the transform
        applyViewportTransform();

        return;
    }

    // Block drawing when panning or loading or space key pressed
    if (!drawing || isLoadingInitialState || isPanning || spaceKeyPressed) return;

    // Convert viewport to canvas coordinates (absolute coordinates)
    const pos = viewportToCanvas(e.clientX, e.clientY);
    const x = pos.x;
    const y = pos.y;
    const isMagic =  currentTool === 'magic';

    // Add to incremental path for smoothing
    if (!_currentPath) _currentPath = [{x: lastX, y: lastY, isMagic}];
    _currentPath.push({x, y, isMagic});

    // Select which canvas to draw on: magic pen uses magic canvas layer
    const drawCtx = isMagic ? magicCtx : ctx;

    // Draw incremental smoothing for all tools EXCEPT magic pen
    // Magic pen strokes are added to magicStrokes array and drawn by fade animation
    if (!isMagic) {
        try {
            if (_currentPath.length === 2) {
                // simple line for first segment
                drawCtx.save();
                drawCtx.beginPath();
                drawCtx.moveTo(_currentPath[0].x, _currentPath[0].y);
                drawCtx.lineTo(_currentPath[1].x, _currentPath[1].y);
                drawCtx.strokeStyle = currentTool === 'erase' ? '#ffffff' : currentColor;
                drawCtx.lineWidth = currentSize;
                drawCtx.lineCap = 'round';
                drawCtx.stroke();
                drawCtx.restore();
                _currentPathDrawnSegments = 1;
            } else if (_currentPath.length >= 3) {
                // draw only the newest quadratic segment
                const n = _currentPath.length;
                const p1 = _currentPath[n - 3];
                const p2 = _currentPath[n - 2];
                const p3 = _currentPath[n - 1];
                const m1x = (p1.x + p2.x) / 2;
                const m1y = (p1.y + p2.y) / 2;
                const m2x = (p2.x + p3.x) / 2;
                const m2y = (p2.y + p3.y) / 2;

                drawCtx.save();
                drawCtx.beginPath();
                drawCtx.moveTo(m1x, m1y);
                drawCtx.quadraticCurveTo(p2.x, p2.y, m2x, m2y);
                drawCtx.strokeStyle = currentTool === 'erase' ? '#ffffff' : currentColor;
                drawCtx.lineWidth = currentSize;
                drawCtx.lineCap = 'round';
                drawCtx.lineJoin = 'round';
                drawCtx.stroke();
                drawCtx.restore();

                _currentPathDrawnSegments++;
            }
        } catch (err) {
            // fallback to simple line
            console.log('warning', '[Drawing] Smoothing failed, falling back to simple line:', err);
            drawLine(lastX, lastY, x, y, currentColor, currentSize, currentTool === 'erase');
        }
    }

    // ========================================
    // DRAWING STROKE DATA (NOT Throttled - Sent Immediately)
    // ========================================
    // This sends actual drawing stroke data with ABSOLUTE CANVAS COORDINATES
    // Every single stroke is sent immediately for real-time drawing collaboration
    if (connected) {
        // Calculate distance between points
        const dx = x - lastX;
        const dy = y - lastY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Update adaptive send rate based on drawing speed
        updateAdaptiveSendRate(distance);

        // Interpolate if gap is too large (common on mobile with less frequent touch events)
        // This fixes the "dashed line" issue on mobile
        // Reduced threshold for better mobile performance - fill gaps more aggressively
        const MAX_GAP = Math.max(currentSize * 1.5, 3); // Minimum 3px gap detection

        if (distance > MAX_GAP) {
            // Interpolate intermediate points to fill the gap
            const steps = Math.ceil(distance / MAX_GAP);
            const interpolatedStrokes = [];

            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const interpX = lastX + dx * t;
                const interpY = lastY + dy * t;

                const stroke = {
                    x1: i === 1 ? lastX : (lastX + dx * ((i - 1) / steps)),
                    y1: i === 1 ? lastY : (lastY + dy * ((i - 1) / steps)),
                    x2: interpX,
                    y2: interpY,
                    color: currentColor,
                    size: currentSize,
                    erase: currentTool === 'erase',
                    isMagic: currentTool === 'magic'  // Mark magic strokes
                };

                interpolatedStrokes.push(stroke);

                // Magic pen: add to magic strokes (auto-disappear), otherwise add to board state
                if (currentTool === 'magic') {
                    addMagicStroke(stroke);
                } else {
                    addStrokeToBoardState(stroke);
                }
            }

            // SEND DIRECTLY WITHOUT BUFFERING - Immediate transmission for mobile
            // This prevents dashed lines by sending interpolated strokes instantly
            if (webrtcHelper && interpolatedStrokes.length > 0) {
                const strokes = USE_STROKE_COMPRESSION ? compressStrokes(interpolatedStrokes) : interpolatedStrokes;
                const binaryData = USE_BINARY_STROKES ? encodeStrokesBinary(strokes) : null;

                let strokeData;
                if (binaryData) {
                    strokeData = {
                        type: 'stroke-batch-binary',
                        binaryStrokes: Array.from(binaryData),
                        count: strokes.length,
                        sender: username,
                        color: currentColor
                    };
                } else {
                    strokeData = {
                        type: 'stroke-batch',
                        strokes: strokes,
                        sender: username,
                        color: currentColor
                    };
                }

                webrtcHelper.broadcastDataChannel(strokeData);
            }
        } else {
            // Normal case: no interpolation needed
            const stroke = {
                x1: lastX,  // Absolute canvas coordinates (0-1920)
                y1: lastY,
                x2: x,
                y2: y,
                color: currentColor,
                size: currentSize,
                erase: currentTool === 'erase',
                isMagic: currentTool === 'magic'
            };

            // Magic pen: add to magic strokes (auto-disappear), otherwise add to board state
            if (currentTool === 'magic') {
                addMagicStroke(stroke);
            } else {
                addStrokeToBoardState(stroke);
            }

            // SEND DIRECTLY WITHOUT BUFFERING - Immediate transmission
            // Single stroke sent instantly for lowest latency
            if (webrtcHelper) {
                const strokeData = {
                    type: 'stroke-batch',
                    strokes: [stroke],
                    sender: username,
                    color: currentColor
                };
                webrtcHelper.broadcastDataChannel(strokeData);
            }
        }
    }

    lastX = x;
    lastY = y;
}

function stopDrawing() {
    // PANNING MODE: Stop panning
    if (isPanning) {
        isPanning = false;

        // Restore cursor based on space key state
        if (spaceKeyPressed) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = getCursorForTool(currentTool);
        }

        // Save viewport transform after panning
        saveViewportTransform();
        return;
    }

    drawing = false;

    // flush any remaining incremental path segments (draw full smooth path)
    // Magic pen strokes are already drawn incrementally via addMagicStroke, so skip this
    const isMagic =  currentTool === 'magic';
    if (!isMagic) {
        try {
            if (_currentPath && _currentPath.length > 1) {
                drawSmoothPath(_currentPath, currentColor, currentSize, currentTool === 'erase', false);
            }
        } catch (e) { /* ignore */
        }
    }

    _currentPath = null;
    _currentPathDrawnSegments = 0;

    // Stop the stroke send loop
    stopStrokeSendLoop();

    // Schedule history snapshot for 2 seconds after drawing stops
    // This prevents blocking the UI during drawing (especially on mobile)
    scheduleHistorySnapshot();
}

/**
 * Draw a line on the main canvas
 */
function drawLine(x1, y1, x2, y2, color, size, erase = false) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = erase ? '#ffffff' : color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
}

/**
 * Draw a single stroke object from boardState
 */
function drawStroke(stroke) {
    if (!stroke || !canvas || !ctx) {
        return;
    }

    try {
        // Strokes are stored in absolute canvas coordinates (0-1920, 0-1080)
        // Draw them directly without conversion
        const x1 = stroke.x1;
        const y1 = stroke.y1;
        const x2 = stroke.x2;
        const y2 = stroke.y2;

        drawLine(x1, y1, x2, y2, stroke.color, stroke.size, stroke.erase || false);
    } catch (e) {
        console.error('[DrawStroke] Error rendering stroke:', e);
    }
}

// ------------------------------------------------------------------
// Magic Pen Functions
// ------------------------------------------------------------------

/**
 * Add a magic pen stroke that will auto-disappear
 * NOTE: Magic strokes are temporary overlays and do NOT trigger recordDrawActivity()
 * or storage saves since they don't modify the persistent canvas state
 */
function addMagicStroke(stroke) {
    const magicStroke = {
        ...stroke,
        id: `magic_${magicStrokeIdCounter++}`,
        createdAt: Date.now(),
        expiresAt: Date.now() + MAGIC_PEN_DURATION,
        isMagic: true
    };

    magicStrokes.push(magicStroke);

    // Draw the stroke immediately on the magic canvas (will be redrawn with fade effect)
    if (magicCtx) {
        magicCtx.save();
        magicCtx.beginPath();
        magicCtx.moveTo(magicStroke.x1, magicStroke.y1);
        magicCtx.lineTo(magicStroke.x2, magicStroke.y2);
        magicCtx.strokeStyle = magicStroke.erase ? '#ffffff' : magicStroke.color;
        magicCtx.lineWidth = magicStroke.size;
        magicCtx.lineCap = 'round';
        magicCtx.lineJoin = 'round';
        magicCtx.stroke();
        magicCtx.restore();
    }

    // Start magic pen cleanup if not already running
    startMagicPenCleanup();
}

/**
 * Start the magic pen cleanup timer
 */
let magicPenCleanupInterval = null;

function startMagicPenCleanup() {
    if (magicPenCleanupInterval) return;

    magicPenCleanupInterval = setInterval(() => {
        const now = Date.now();

        // Remove expired strokes from array
        const beforeCount = magicStrokes.length;
        magicStrokes = magicStrokes.filter(stroke => now < stroke.expiresAt);
        const expiredCount = beforeCount - magicStrokes.length;

        if (expiredCount > 0) {
            console.log(`[Magic Pen] Removed ${expiredCount} expired strokes, ${magicStrokes.length} remaining`);
        }

        // Always redraw magic canvas with fade effect for remaining strokes
        if (magicCanvas && magicCtx) {
            magicCtx.clearRect(0, 0, magicCanvas.width, magicCanvas.height);
            drawMagicStrokesOnLayer();
        }

        // Stop cleanup if no more magic strokes
        if (magicStrokes.length === 0 && magicPenCleanupInterval) {
            clearInterval(magicPenCleanupInterval);
            magicPenCleanupInterval = null;

            // Final clear of magic canvas
            if (magicCanvas && magicCtx) {
                magicCtx.clearRect(0, 0, magicCanvas.width, magicCanvas.height);
            }

            console.log('[Magic Pen] Cleanup stopped, magic canvas cleared');
        }
    }, 1000 / 30); // 30 FPS for smooth fade animation
}

/**
 * Render magic pen strokes as an overlay on top of the canvas with fade effect
 * Called every frame to show fading animation
 *
 * IMPORTANT: Magic strokes are drawn directly but marked in magicStrokes array
 * To "remove" them, we need to clear canvas and redraw from boardState + remaining magic strokes
 */
function renderMagicStrokesOverlay() {
    if (!magicCtx || magicStrokes.length === 0) return;

    const now = Date.now();

    magicStrokes.forEach(stroke => {
        const timeLeft = stroke.expiresAt - now;

        // Calculate opacity (fade out in last MAGIC_PEN_FADE_DURATION ms)
        let opacity = 1.0;
        if (timeLeft < MAGIC_PEN_FADE_DURATION) {
            opacity = Math.max(0, timeLeft / MAGIC_PEN_FADE_DURATION);
        }

        // Draw stroke with fade effect
        magicCtx.save();
        magicCtx.globalAlpha = opacity;

        magicCtx.beginPath();
        magicCtx.moveTo(stroke.x1, stroke.y1);
        magicCtx.lineTo(stroke.x2, stroke.y2);
        magicCtx.strokeStyle = stroke.erase ? '#ffffff' : stroke.color;
        magicCtx.lineWidth = stroke.size;
        magicCtx.lineCap = 'round';
        magicCtx.lineJoin = 'round';
        magicCtx.stroke();

        magicCtx.restore();
    });
}

/**
 * Draw all magic pen strokes on the magic canvas layer with fade effect
 * Called periodically during cleanup to update fade animation
 */
function drawMagicStrokesOnLayer() {
    renderMagicStrokesOverlay();
}

/**
 * Draw all magic pen strokes with fade effect (legacy function for redrawCanvas)
 * Now just calls renderMagicStrokesOverlay for compatibility
 */
function drawMagicStrokes() {
    renderMagicStrokesOverlay();
}

// Tools
function setTool(tool) {
    currentTool = tool;

    // If user manually selects a tool, disable auto hand mode
    // (This prevents auto-switching when clicking inside canvas after manual tool selection)
    if (!autoHandModeActive) {
        // Only update previousTool if not in auto mode
        // This prevents overwriting the stored tool when auto-switching
        previousTool = tool;
    }

    // Only affect tool buttons (draw/erase/hand), not all buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.opacity = '0.7';
    });

    const selectedBtn = document.getElementById(tool + 'Btn');
    if (selectedBtn) {
        selectedBtn.classList.add('active');
        selectedBtn.style.opacity = '1';
    }

    // Update canvas cursor based on tool (unless space key is pressed)
    if (!spaceKeyPressed) {
        canvas.style.cursor = getCursorForTool(tool);
    }

    const canvasContainer = canvas.parentElement.parentElement;
    if (tool === 'hand') {
        if (canvasContainer && !spaceKeyPressed) {
            canvasContainer.style.cursor = 'grab';
        }
        // Hide custom cursor when using hand tool
        const customCursor = document.getElementById('customCursor');
        if (customCursor) {
            customCursor.style.display = 'none';
        }
    } else {
        canvas.style.cursor = 'none';
        if (canvasContainer) {
            canvasContainer.style.cursor = '';
        }
        // Update canvas cursor
        updateCanvasCursor();
    }
}

function setColor(color, el) {
    currentColor = color;
    document.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active'));
    if (el && el.classList) el.classList.add('active');

    // Update canvas cursor
    updateCanvasCursor();
}

function updateSize(size) {
    currentSize = parseInt(size);
    document.getElementById('sizeLabel').textContent = size + 'px';

    // Update canvas cursor
    updateCanvasCursor();
}

function clearCanvas() {
    if (confirm('Clear whiteboard for everyone?')) {
        // Capture any pending strokes first
        if (pendingStrokesForHistory.length > 0) {
            captureHistorySnapshot();
        }

        // Create a ClearCanvasCommand with the current state (for undo)
        const previousState = JSON.parse(JSON.stringify(boardState));
        const clearCommand = new ClearCanvasCommand(previousState, undoRedoManager.localUsername || 'local');

        // Actually clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        clearBoardState();  // Clear persistent board state
        canvasSnapshot = null;  // Clear canvas snapshot (no more imported image)

        // Record the command (this adds to undo stack)
        undoRedoManager.recordCommand(clearCommand);

        // Broadcast clear to other agents
        sendWhiteboardEvent('clear', {});

        // Save cleared state to storage (host only)
        if (connected && channel && channel.isHostAgent()) {
            console.log('[Clear] Saving cleared state to storage...');
            setTimeout(() => saveBoardStateToStorage(), 500);
        }

        console.log('[Clear] Canvas cleared, previous state saved for undo');
    }
}

function exportImage() {
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
}

function importImage() {
    console.log('[Import] Opening file picker...');
    const fileInput = document.getElementById('imageImportInput');

    if (!fileInput) {
        console.error('[Import] File input not found!');
        MiniGameUtils.showToast('❌ Error: File input not found', 'error');
        return;
    }

    // Set up the file input handler
    fileInput.onchange = function (e) {
        const file = e.target.files[0];
        if (!file) {
            console.log('[Import] No file selected');
            return;
        }

        console.log(`[Import] Loading file: ${file.name} (${Math.round(file.size / 1024)}KB)`);
        MiniGameUtils.showToast(`📂 Loading ${file.name}...`, 'info');

        // Validate it's an image
        if (!file.type.startsWith('image/')) {
            const errorMsg = 'Please select an image file (PNG, JPG, etc.)';
            console.error('[Import] Invalid file type:', file.type);
            MiniGameUtils.showToast('❌ Invalid file type', 'error');
            alert(errorMsg);
            return;
        }

        // Check file size (warn if > 5MB)
        if (file.size > 5 * 1024 * 1024) {
            console.warn('[Import] Large file detected:', Math.round(file.size / 1024 / 1024) + 'MB');
            MiniGameUtils.showToast('⚠️ Large file may take time to process...', 'warning');
        }

        const reader = new FileReader();

        reader.onload = function (event) {
            const img = new Image();

            img.onload = function () {
                console.log(`[Import] Image loaded: ${img.width}x${img.height}`);

                // Validate canvas is ready
                if (!canvas || !ctx) {
                    console.error('[Import] Canvas not ready!');
                    MiniGameUtils.showToast('❌ Canvas not ready. Please try again.', 'error');
                    fileInput.value = '';
                    return;
                }

                // Capture history BEFORE clearing (so user can undo back to this state)
                try {
                    if (pendingStrokesForHistory.length > 0) {
                        captureHistorySnapshot(); // Save pending strokes first
                    }
                } catch (e) {
                    console.warn('[Import] Failed to capture history before import:', e);
                }

                // Use the same drawing logic as received images for consistent scaling
                // This ensures imported images scale correctly across different resolutions
                const originalDimensions = {
                    cssWidth: img.width,
                    cssHeight: img.height
                };

                // Use utility function to draw image with proper scaling
                drawCanvasImage(img, originalDimensions,
                    (result) => {
                        console.log(`[Import] ✓ Image drawn on canvas (scale=${result.scale.toFixed(2)}, offset=${Math.round(result.offsetX)},${Math.round(result.offsetY)})`);

                        // Show success notification
                        MiniGameUtils.showToast(`✅ Image imported: ${file.name}`, 'success');
                        addChatMessage('System', `📷 You imported: ${file.name}`, '#4CAF50');

                        // Save canvas snapshot to preserve image on window resize
                        try {
                            canvasSnapshot = canvas.toDataURL('image/png');
                            console.log('[Import] Canvas snapshot saved for resize preservation');
                        } catch (e) {
                            console.warn('[Import] Failed to save canvas snapshot:', e);
                            MiniGameUtils.showToast('⚠️ Warning: Image may not persist on resize', 'warning');
                        }

                        // Check if we have other users to broadcast to
                        const otherUsers = Array.from(users.keys()).filter(name => name !== username);

                        if (otherUsers.length > 0) {
                            // Broadcast canvas to all connected agents via DataChannel
                            console.log(`[Import] Broadcasting to ${otherUsers.length} users...`);
                            MiniGameUtils.showToast(`📡 Broadcasting to ${otherUsers.length} user(s)...`, 'info');

                            try {
                                broadcastCanvasToAllAgents('import');
                                console.log('[Import] ✓ Broadcast completed');
                                MiniGameUtils.showToast('✅ Image shared with others', 'success');
                            } catch (broadcastErr) {
                                console.error('[Import] ❌ Broadcast failed:', broadcastErr);
                                MiniGameUtils.showToast('⚠️ Failed to share with others', 'warning');
                                addChatMessage('System', 'Failed to broadcast image to others', '#FF9800');
                            }
                        } else {
                            console.log('[Import] No other users to broadcast to');
                            MiniGameUtils.showToast('ℹ️ Image imported (you\'re alone)', 'info');
                        }

                        // Capture FULL snapshot after importing image (includes canvas image data)
                        try {
                            setTimeout(() => {
                                captureFullSnapshot();
                            }, 100); // Small delay to ensure canvas is fully rendered
                        } catch (e) {
                            console.warn('[Import] Failed to capture history after import:', e);
                        }

                        // Save to storage after import (host only)
                        if (connected && channel && channel.isHostAgent()) {
                            console.log('[Import] Saving imported image to storage...');
                            setTimeout(() => saveBoardStateToStorage(), 1000);
                        }

                        // Reset file input for next import
                        fileInput.value = '';
                    },
                    (err) => {
                        console.error('[Import] Failed to draw image:', err);
                        MiniGameUtils.showToast('❌ Failed to draw image on canvas', 'error');
                        alert('Failed to draw image on canvas. Please try again.\n\nError: ' + err.message);
                        fileInput.value = '';
                    }
                );
            };

            img.onerror = function (err) {
                console.error('[Import] Failed to load image:', err);
                MiniGameUtils.showToast('❌ Failed to load image file', 'error');
                alert('Failed to load image. The file may be corrupted or in an unsupported format.\n\nPlease try another file.');
                fileInput.value = '';
            };

            try {
                img.src = event.target.result;
            } catch (e) {
                console.error('[Import] Failed to set image source:', e);
                MiniGameUtils.showToast('❌ Failed to process image data', 'error');
                alert('Failed to process image data. Please try again.');
                fileInput.value = '';
            }
        };

        reader.onerror = function (err) {
            console.error('[Import] Failed to read file:', err);
            MiniGameUtils.showToast('❌ Failed to read file', 'error');
            alert('Failed to read file. Please check the file and try again.');
            fileInput.value = '';
        };

        try {
            reader.readAsDataURL(file);
        } catch (e) {
            console.error('[Import] Failed to start reading file:', e);
            MiniGameUtils.showToast('❌ Failed to read file', 'error');
            alert('Failed to read file. Please try again.');
            fileInput.value = '';
        }
    };

    // Trigger file picker
    fileInput.click();
}

function broadcastCanvasToAllAgents(actionType = 'sync') {
    if (!connected || !webrtcHelper) {
        console.log('[Broadcast] ⚠️ Not connected or no WebRTC helper - skipping broadcast');
        MiniGameUtils.showToast('⚠️ Not connected - cannot broadcast', 'warning');
        return;
    }

    // Get all connected users (except self)
    const otherAgents = Array.from(users.keys()).filter(name => name !== username);

    console.log(`[Broadcast] 📡 Broadcasting canvas (${actionType}) to ${otherAgents.length} agents: ${otherAgents.join(', ')}`);

    let successCount = 0;
    let errorCount = 0;

    // Send canvas snapshot to each connected peer via DataChannel
    otherAgents.forEach(agentName => {
        try {
            sendBoardStateToAgent(agentName, actionType);
            successCount++;
        } catch (e) {
            console.error(`[Broadcast] ❌ Failed to send to ${agentName}:`, e);
            errorCount++;
        }
    });

    if (errorCount === 0) {
        console.log(`[Broadcast] ✓ Canvas broadcast queued for all ${successCount} agents`);
    } else {
        console.warn(`[Broadcast] ⚠️ Canvas broadcast partial: ${successCount} success, ${errorCount} failed`);
        MiniGameUtils.showToast(`⚠️ Broadcast to ${errorCount} user(s) failed`, 'warning');
    }
}

function updateRemoteCursor(agentName, x, y, color) {
    let cursor = remoteCursors.get(agentName);

    if (!cursor) {
        cursor = document.createElement('div');
        cursor.className = 'remote-cursor';
        cursor.setAttribute('data-name', agentName);
        cursor.style.background = color || '#667eea';
        document.getElementById('cursorsLayer').appendChild(cursor);
        remoteCursors.set(agentName, cursor);
    }

    // Convert canvas coordinates (0-1920, 0-1080) to viewport screen coordinates
    const viewportPos = canvasToViewport(x, y);

    // Position cursor at viewport coordinates
    cursor.style.left = viewportPos.x + 'px';
    cursor.style.top = viewportPos.y + 'px';
}

// Update user list UI from the `users` Map and update user count
function updateUserList() {
    try {
        const listEl = document.getElementById('userList');

        // Update compact agents badge (managed by MiniGameUtils)
        try {
            if (window.MiniGameUtils && typeof window.MiniGameUtils.setAgentsCount === 'function') {
                window.MiniGameUtils.setAgentsCount(users.size);
            }
        } catch (e) { /* ignore */
        }

        // Update footer user count badge
        updateUserCountBadge();

        // Update user list (if element exists)
        if (listEl) {
            // Clear current list
            listEl.innerHTML = '';

            // Sort users alphabetically for stable ordering
            const entries = Array.from(users.entries()).sort((a, b) => a[0].localeCompare(b[0]));

            for (const [name, info] of entries) {
                const li = document.createElement('li');
                li.className = 'user-item';

                // User avatar (colored circle)
                const avatar = document.createElement('div');
                avatar.className = 'user-avatar';
                avatar.style.background = (info && info.color) ? info.color : '#667eea';
                li.appendChild(avatar);

                // User name
                const nameSpan = document.createElement('span');
                nameSpan.className = 'user-name';
                nameSpan.textContent = name;
                li.appendChild(nameSpan);

                // Status indicator (online)
                const status = document.createElement('span');
                status.className = 'user-status';
                li.appendChild(status);

                listEl.appendChild(li);
            }
        }
    } catch (e) {
        console.warn('updateUserList failed', e);
    }
}

// Chat
function sendChat() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (message && connected && whiteboardGame) {
        try {
            // Use BaseGame's sendChat method
            whiteboardGame.sendChat(message)
                .then(() => {
                    console.log('Chat message sent successfully');
                    input.value = '';
                    // Add to own chat display immediately (messages from self won't trigger chat-text event)
                    addChatMessage(username || 'You', message, '#6965db');
                })
                .catch(error => {
                    console.error('Failed to send chat message:', error);
                });
        } catch (e) {
            console.error('Send chat error:', e);
        }
    }
}

function addChatMessage(from, message, color = '#333') {
    const chatMessages = document.getElementById('chatMessages');
    const msgElement = document.createElement('div');
    msgElement.className = 'chat-message';
    msgElement.innerHTML = `<strong style="color: ${color}">${from}:</strong> ${message}`;
    chatMessages.appendChild(msgElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Initialize ShareModal on page load
document.addEventListener('DOMContentLoaded', () => {
    if (typeof ShareModal !== 'undefined') {
        try {
            ShareModal.init();
        } catch (e) {
            console.warn('ShareModal init failed', e);
        }

        // If page opened via share link, prefill connection modal inputs (channel/password) and set agent name
        try {
            ShareModal.processSharedLink(function (auth, agentName) {
                try {
                    // Prefill channel & password and disable those inputs
                    const chEl = document.getElementById('channelInput');
                    const pwEl = document.getElementById('passwordInput');
                    const userEl = document.getElementById('usernameInput');

                    if (auth && chEl && pwEl) {
                        chEl.value = auth.c || chEl.value || '';
                        pwEl.value = auth.p || pwEl.value || '';
                        // Allow editing - users can change channel/password if they want
                        // Warning will be shown in the connection modal
                    }

                    // Agent name priority:
                    // 1. Encrypted agentName from link
                    // 2. Saved username from localStorage (one-time set, persists across channels)
                    // 3. Generate random name
                    let finalName = null;
                    if (agentName && agentName.trim()) {
                        finalName = agentName; // Use encrypted name from link
                    } else {
                        // Try to get saved username from localStorage
                        try {
                            const savedUsername = localStorage.getItem('whiteboard_username');
                            if (savedUsername && savedUsername.trim()) {
                                finalName = savedUsername; // Use saved username
                                console.log('[Share Link] Using saved username from localStorage:', savedUsername);
                            }
                        } catch (e) {
                            console.warn('[Share Link] Failed to read saved username:', e);
                        }
                    }
                    // If still no name, generate random one
                    if (!finalName) {
                        finalName = window.generateRandomAgentName ? window.generateRandomAgentName() : ('User-' + Math.random().toString(36).slice(2, 8));
                        console.log('[Share Link] Generated random username:', finalName);
                    }

                    if (userEl) {
                        userEl.value = finalName;
                        userEl.disabled = false; // allow edit
                        requestAnimationFrame(() => {
                            userEl.focus();
                            userEl.select();
                        });
                    }

                    // Ensure connection modal visible so user can click Connect
                    const modal = document.getElementById('connectionModal');
                    if (modal) {
                        modal.classList.add('active');
                    }
                } catch (e) {
                    console.warn('onConnect handler failed', e);
                }
            });
        } catch (e) {
            console.warn('ShareModal.processSharedLink failed', e);
        }
    }
});

// ============================================
// Window Resize Handler (Preserve Canvas on Resize)
// ============================================
// Note: resizeTimeout is declared earlier in the file (line ~1632)
window.addEventListener('resize', () => {
    // Debounce resize events to avoid excessive redraws
    if (resizeTimeout) clearTimeout(resizeTimeout);

    resizeTimeout = setTimeout(() => {
        if (canvas && ctx) {
            console.log('[Resize] Window resized, redrawing canvas with snapshot...');

            // Save current canvas state before resize if we don't have a snapshot
            if (!canvasSnapshot && canvas) {
                try {
                    canvasSnapshot = canvas.toDataURL('image/png');
                    console.log('[Resize] Canvas snapshot captured before resize');
                } catch (e) {
                    console.warn('[Resize] Failed to capture canvas snapshot:', e);
                }
            }

            // Redraw canvas with preserved snapshot and strokes
            redrawCanvas();
        }
    }, 250); // Wait 250ms after resize stops
});

// Message handling: incoming messages are queued and processed; while `initialBuffering` is true
// stroke messages are accumulated into the preparedDraw buffer in the channel 'message' handler.
// (The legacy `handleWhiteboardEvent` and replay helpers were removed to simplify flow.)

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================

// ============================================
// Toast Notification Functions (Using MiniGameUtils or BaseGame)
// ============================================

/**
 * Show toast notification (uses BaseGame if available, otherwise MiniGameUtils)
 * @param {string} message - Message to display
 * @param {string} type - Toast type: 'info', 'success', 'error', 'warning'
 */
function showToast(message, type = 'info') {
    // Use BaseGame method if available for consistency
    if (whiteboardGame && typeof whiteboardGame.showToast === 'function') {
        whiteboardGame.showToast(message, type);
        return;
    }

    // Fallback to MiniGameUtils
    if (typeof MiniGameUtils !== 'undefined' && typeof MiniGameUtils.showToast === 'function') {
        MiniGameUtils.showToast(message, type);
    }
}

/**
 * Show toast for user connection
 * @param {string} username - Username of the user who connected
 */
function showConnectToast(username) {
    console.log(`[Toast] 📞 showConnectToast called for: ${username}`);
    showToast(`👋 ${username} joined`, 'success');
}

/**
 * Show toast for user disconnection
 * @param {string} username - Username of the user who disconnected
 */
function showDisconnectToast(username) {
    console.log(`[Toast] 👋 showDisconnectToast called for: ${username}`);
    showToast(`👋 ${username} left`, 'info');
}

/**
 * Show toast for image import
 * @param {string} username - Username of the user who imported
 */
function showImageImportToast(username) {
    console.log(`[Toast] 🖼️ showImageImportToast called for: ${username}`);
    showToast(`🖼️ ${username} imported an image`, 'info');
}

/**
 * Show toast for undo action
 * @param {string} username - Username of the user who undid
 */
function showUndoToast(username) {
    console.log(`[Toast] ⏪ showUndoToast called for: ${username}`);
    showToast(`⏪ ${username} undid last action`, 'info');
}

/**
 * Show toast for redo action
 * @param {string} username - Username of the user who redid
 */
function showRedoToast(username) {
    console.log(`[Toast] ⏩ showRedoToast called for: ${username}`);
    showToast(`⏩ ${username} redid last action`, 'info');
}

/**
 * Show toast for canvas sync
 * @param {string} username - Username of the user who synced
 */
function showSyncToast(username) {
    console.log(`[Toast] ✨ showSyncToast called for: ${username}`);
    showToast(`✨ ${username} synced the canvas`, 'success');
}

/**
 * Show toast for canvas clear
 * @param {string} username - Username of the user who cleared
 */
function showClearToast(username) {
    console.log(`[Toast] 🗑️ showClearToast called for: ${username}`);
    showToast(`🗑️ ${username} cleared the canvas`, 'warning');
}

// ============================================
// Unified Footer Panel Functions
// ============================================

/**
 * Toggle the unified footer panel (expand/collapse)
 */
function toggleFooter() {
    const footer = document.getElementById('unifiedFooter');
    if (!footer) return;

    footer.classList.toggle('collapsed');
    footer.classList.toggle('expanded');

    // Note: Footer state is NOT saved to localStorage - always starts collapsed on page load
}

/**
 * Update the user count badge in the footer
 */
function updateUserCountBadge() {
    const badge = document.getElementById('userCountBadge');
    if (badge) {
        badge.textContent = users.size;
    }
}

/**
 * Disconnect from the channel and reset the whiteboard
 * Shows confirmation dialog before disconnecting
 */
function disconnect() {
    if (!connected) {
        console.warn('Not connected');
        return;
    }

    // Show confirmation dialog
    const confirmDisconnect = confirm('Are you sure you want to disconnect from the whiteboard?\n\nYour drawing will be cleared.');

    if (!confirmDisconnect) {
        console.log('Disconnect cancelled by user');
        return;
    }

    try {
        // Disconnect channel
        if (channel) {
            channel.disconnect();
            channel = null;
        }

        // Reset WebRTC
        if (webrtcHelper) {
            webrtcHelper = null;
        }

        // Reset state
        connected = false;
        initialStateLoaded = false;  // Reset for next connection
        lastBroadcastStrokeCount = 0;  // Reset broadcast counter
        users.clear();
        remoteCursors.clear();
        updateUserList();
        updateUserCountBadge();

        // Clear canvas
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Remove URL hash (auth credentials)
        try {
            if (window.location.hash) {
                window.history.replaceState(null, '', window.location.pathname + window.location.search);
                console.log('[Whiteboard] ✓ URL hash removed');
            }
        } catch (e) {
            console.warn('[Whiteboard] Failed to remove URL hash:', e);
        }

        // Show connection modal
        const modal = document.getElementById('connectionModal');
        if (modal) {
            modal.classList.add('active');
        }

        console.log('Disconnected successfully');
    } catch (e) {
        console.error('Error during disconnect:', e);
    }
}

// Initialize share button
document.addEventListener('DOMContentLoaded', () => {
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn && typeof ShareModal !== 'undefined') {
        shareBtn.addEventListener('click', () => {
            try {
                ShareModal.show(channelName, channelPassword);
            } catch (e) {
                console.error('Failed to show share modal:', e);
            }
        });
    }
});

// Initialize footer state - always start collapsed (don't restore from localStorage)
document.addEventListener('DOMContentLoaded', () => {
    try {
        const footer = document.getElementById('unifiedFooter');
        if (footer) {
            // Always start collapsed, remove any expanded class
            footer.classList.remove('expanded');
            footer.classList.add('collapsed');
            console.log('[Footer] Chat panel initialized as collapsed (not restored from localStorage)');
        }

        // Clear any old footer state from localStorage (cleanup)
        try {
            localStorage.removeItem('whiteboardFooterState');
        } catch (e) {
            // Ignore
        }
    } catch (e) {
        console.warn('Failed to initialize footer state', e);
    }
});

// ============================================
// RSYNC FUNCTIONS - Direct execution
// ============================================

/**
 * Trigger manual rsync - broadcasts canvas to all agents
 * Skips if only one agent is connected
 */
function triggerManualRsync() {
    try {
        // Check if we have multiple agents (more than just ourselves)
        const otherAgents = Array.from(users.keys()).filter(name => name !== username);

        // Show confirmation dialog when multiple users are connected
        const confirmSync = confirm(`Sync canvas to ${otherAgents.length} other user(s)?\n\nThis will broadcast your current canvas state to all connected users.`);

        if (!confirmSync) {
            console.log('[Rsync] User cancelled sync operation');
            return;
        }

        const rsyncBtn = document.getElementById('rsyncBtn');

        // Add spinning animation
        if (rsyncBtn) {
            rsyncBtn.classList.add('syncing');
        }

        // Broadcast canvas using existing method (same logic as import image)
        broadcastCanvasToAllAgents('sync');

        // Show success notification
        addChatMessage('✨ Sync', `Broadcasting canvas to ${otherAgents.length} user(s)...`, '#4CAF50');

        // Remove spinning animation after 2 seconds
        setTimeout(() => {
            if (rsyncBtn) {
                rsyncBtn.classList.remove('syncing');
            }
        }, 2000);

    } catch (e) {
        console.error('Error during rsync operation:', e);

        // Show error notification
        addChatMessage('❌ Sync Error', `Failed to sync: ${e.message}`, '#f44336');

        const rsyncBtn = document.getElementById('rsyncBtn');
        if (rsyncBtn) {
            rsyncBtn.classList.remove('syncing');
        }
    }
}

// ============================================
// UNDO/REDO FUNCTIONS - OPTIMIZED INCREMENTAL APPROACH
// ============================================

// Track strokes added since last snapshot
let pendingStrokesForHistory = [];
let historySnapshotTimer = null;

// Sync operation lock - prevents concurrent sync operations
let syncInProgress = false;
let syncInitiator = null; // Track who initiated sync ('sender' or 'receiver')

/**
 * Capture incremental changes (stroke deltas) for undo/redo history
 * Uses the professional Command pattern for better undo/redo management
 */
function captureHistorySnapshot() {
    if (undoRedoManager.isExecuting) {
        return; // Don't capture during undo/redo operations
    }

    try {
        // Only capture if we have pending strokes
        if (pendingStrokesForHistory.length === 0) {
            console.log('[History] No pending strokes to capture');
            return;
        }

        // Create a DrawStrokesCommand for the pending strokes
        const strokes = pendingStrokesForHistory.slice(); // Copy the array
        const command = new DrawStrokesCommand(strokes, undoRedoManager.localUsername || 'local');

        // Record the command (this adds to undo stack and clears redo)
        undoRedoManager.recordCommand(command);

        // Clear pending strokes
        pendingStrokesForHistory = [];

        console.log(`[History] Captured DrawStrokesCommand: +${strokes.length} strokes`);
    } catch (e) {
        console.error('[History] Error capturing snapshot:', e);
    }
}

/**
 * Schedule a delayed history snapshot (2 seconds after drawing stops)
 * This prevents blocking the UI during drawing (especially on mobile)
 */
function scheduleHistorySnapshot() {
    // Clear any existing timer
    if (historySnapshotTimer) {
        clearTimeout(historySnapshotTimer);
    }

    // Schedule snapshot for 2 seconds later (increased from 1s for better mobile performance)
    historySnapshotTimer = setTimeout(() => {
        try {
            console.log('[History] Delayed snapshot triggered');
            captureHistorySnapshot();
        } catch (e) {
            console.error('[History] Error in scheduled snapshot:', e);
        } finally {
            historySnapshotTimer = null;
        }
    }, 2000); // 2 second delay
}

/**
 * Track a new stroke for history (called when stroke is added to boardState)
 * Uses direct reference for performance - strokes are treated as immutable
 */
function trackStrokeForHistory(stroke) {
    if (!isRestoringHistory && stroke) {
        pendingStrokesForHistory.push(stroke); // Direct reference (strokes are immutable)
    }
}

/**
 * Capture a full snapshot for image imports (includes canvas image data)
 * This is needed because images don't generate strokes
 */
function captureFullSnapshot() {
    if (isRestoringHistory) {
        return;
    }

    try {
        // Create a full snapshot with canvas image
        const snapshot = {
            type: 'full',
            boardState: JSON.parse(JSON.stringify(boardState)),
            canvasImage: canvas.toDataURL('image/jpeg', 0.85), // Use JPEG for speed
            timestamp: Date.now()
        };

        // Add to history stack
        historyStack.push(snapshot);

        // Limit history size
        if (historyStack.length > MAX_HISTORY_SIZE) {
            historyStack.shift();
        }

        // Clear pending strokes since we captured full state
        pendingStrokesForHistory = [];

        // Clear redo stack
        redoStack = [];

        updateUndoRedoButtons();

        console.log(`[History] Full snapshot captured (image import)`);
    } catch (e) {
        console.error('[History] Error capturing full snapshot:', e);
    }
}

/**
 * Restore canvas state from a snapshot by applying incremental changes
 */
function restoreSnapshot(snapshot, isUndo = true) {
    if (!snapshot) {
        console.warn('[History] No snapshot to restore');
        return;
    }

    try {
        isRestoringHistory = true;

        if (snapshot.type === 'incremental') {
            // Incremental snapshot - apply or revert stroke deltas
            if (isUndo) {
                // UNDO: Remove the strokes that were added in this snapshot
                const strokesToRemove = snapshot.addedStrokes.length;
                boardState.splice(-strokesToRemove, strokesToRemove);

                console.log(`[History] UNDO: Removed ${strokesToRemove} strokes. New boardState length: ${boardState.length}`);
            } else {
                // REDO: Re-add the strokes that were removed
                snapshot.addedStrokes.forEach(stroke => {
                    boardState.push(stroke);
                });

                console.log(`[History] REDO: Re-added ${snapshot.addedStrokes.length} strokes. New boardState length: ${boardState.length}`);
            }

            // Redraw entire canvas from boardState
            redrawCanvas();

        } else if (snapshot.type === 'full' || snapshot.canvasImage) {
            // Full snapshot (legacy support or from image import)
            restoreFullSnapshot(snapshot);
        } else {
            console.warn('[History] Unknown snapshot type:', snapshot);
        }

        isRestoringHistory = false;
        updateUndoRedoButtons();

    } catch (e) {
        console.error('[History] Error restoring snapshot:', e);
        isRestoringHistory = false;
    }
}

/**
 * Restore a full snapshot (legacy or image import)
 */
function restoreFullSnapshot(snapshot) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (snapshot.canvasImage) {
        const img = new Image();
        img.onload = function () {
            ctx.drawImage(img, 0, 0);
            console.log(`[History] ✓ Restored canvas image from full snapshot`);

            boardState = JSON.parse(JSON.stringify(snapshot.boardState)); // Deep clone
            boardState.forEach(stroke => {
                drawStroke(stroke);
            });

            console.log(`[History] Restored full snapshot with ${boardState.length} strokes`);
        };
        img.onerror = function () {
            console.error('[History] Failed to restore canvas image');
            boardState = JSON.parse(JSON.stringify(snapshot.boardState));
            redrawCanvas();
        };
        img.src = snapshot.canvasImage;
    } else {
        boardState = JSON.parse(JSON.stringify(snapshot.boardState));
        redrawCanvas();
    }
}

/**
 * Update undo/redo button enabled/disabled states
 */
function updateUndoRedoButtons() {
    undoRedoManager.updateButtons();
}

/**
 * Trigger undo - uses the professional UndoRedoManager
 * Broadcasts notification AND syncs canvas state to other agents
 */
function triggerUndo() {
    try {
        const command = undoRedoManager.undo(true); // true = broadcast notification to others

        if (command) {
            // Sync the updated canvas state to other agents
            // This ensures they see the undo result
            if (connected && webrtcHelper) {
                // Send a sync message with current board state
                syncCanvasAfterUndoRedo('undo');
            }

            // Save to storage if host
            if (connected && channel && channel.isHostAgent()) {
                setTimeout(() => saveBoardStateToStorage(), 500);
            }

            console.log(`[Undo] ✓ Undone: ${command.type}`);
        }
    } catch (e) {
        console.error('[Undo] Error during undo operation:', e);
        addChatMessage('❌ Undo Error', `Failed to undo: ${e.message}`, '#f44336');
    }
}

/**
 * Trigger redo - uses the professional UndoRedoManager
 * Broadcasts notification AND syncs canvas state to other agents
 */
function triggerRedo() {
    try {
        const command = undoRedoManager.redo(true); // true = broadcast notification to others

        if (command) {
            // Sync the updated canvas state to other agents
            if (connected && webrtcHelper) {
                syncCanvasAfterUndoRedo('redo');
            }

            // Save to storage if host
            if (connected && channel && channel.isHostAgent()) {
                setTimeout(() => saveBoardStateToStorage(), 500);
            }

            console.log(`[Redo] ✓ Redone: ${command.type}`);
        }
    } catch (e) {
        console.error('[Redo] Error during redo operation:', e);
        addChatMessage('❌ Redo Error', `Failed to redo: ${e.message}`, '#f44336');
    }
}

/**
 * Sync canvas state after undo/redo operation
 * Sends the current board state to all connected peers
 */
function syncCanvasAfterUndoRedo(action) {
    if (!webrtcHelper || !connected) return;

    try {
        // Send the full board state sync via storage (most reliable)
        // This is better than trying to send large data via DataChannel
        if (channel && channel.isHostAgent()) {
            // Host saves to storage, others will fetch
            saveBoardStateToStorage();
            console.log(`[UndoRedo] Canvas synced via storage after ${action}`);
        } else {
            // Non-host can request a re-sync from host
            console.log(`[UndoRedo] Non-host ${action} - canvas changes are local only`);
        }
    } catch (e) {
        console.error(`[UndoRedo] Error syncing canvas after ${action}:`, e);
    }
}

// ============================================
// TOOLBAR COLLAPSE/EXPAND TOGGLE
// ============================================

/**
 * Toggle entire header between expanded and collapsed (3 dots square) state
 */
function toggleToolbar() {
    try {
        console.log('[Toolbar] toggleToolbar() called');

        const header = document.getElementById('mainHeader');
        if (!header) {
            console.warn('[Toolbar] Header element not found');
            return;
        }

        // Toggle toolbar-collapsed class on entire header (NOT 'collapsed')
        header.classList.toggle('toolbar-collapsed');

        // Don't save state to localStorage - always starts expanded on refresh
        const isCollapsed = header.classList.contains('toolbar-collapsed');

        console.log(`[Toolbar] ${isCollapsed ? 'Collapsed to square' : 'Expanded'} header`);
    } catch (e) {
        console.error('[Toolbar] Error toggling toolbar:', e);
    }
}

/**
 * Initialize toolbar state - always start expanded (removed localStorage)
 */
function initializeToolbarState() {
    try {
        const header = document.getElementById('mainHeader');
        if (!header) return;

        // Always start expanded - remove toolbar-collapsed class
        header.classList.remove('toolbar-collapsed');
        console.log('[Toolbar] Initialized to expanded state');
    } catch (e) {
        console.error('Error initializing toolbar state:', e);
    }
}

// Initialize toolbar state when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeToolbarState);
} else {
    initializeToolbarState();
}

// ============================================
// CANVAS CURSOR (Custom with Size & Scale)
// ============================================

/**
 * Create a custom cursor SVG that scales with brush size and zoom
 * @param {string} tool - Current tool (draw, erase, magic)
 * @param {number} size - Brush size in pixels
 * @param {number} scale - Current canvas scale/zoom
 * @param {string} penColor - Current pen color (hex)
 * @returns {string} CSS cursor value
 */
function createCustomCursor(tool, size, scale, penColor) {
    try {
        // Calculate cursor size (scaled by zoom)
        const cursorSize = Math.max(8, Math.min(64, size * scale));
        const radius = cursorSize / 2;
        const center = cursorSize / 2;

        let svg;

        if (tool === 'erase') {
            // Eraser: circle outline with X inside (always red)
            svg = `
                <svg width="${cursorSize}" height="${cursorSize}" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="${center}" cy="${center}" r="${radius - 1}" 
                            fill="none" stroke="rgba(255,0,0,0.6)" stroke-width="2"/>
                    <line x1="${center - radius/2}" y1="${center - radius/2}" 
                          x2="${center + radius/2}" y2="${center + radius/2}" 
                          stroke="rgba(255,0,0,0.8)" stroke-width="2"/>
                    <line x1="${center + radius/2}" y1="${center - radius/2}" 
                          x2="${center - radius/2}" y2="${center + radius/2}" 
                          stroke="rgba(255,0,0,0.8)" stroke-width="2"/>
                </svg>
            `;
        } else if (tool === 'magic') {
            // Magic: purple circle filled with slight transparency
            const color = 'rgba(138,43,226,0.5)';
            const borderColor = 'rgba(138,43,226,0.9)';
            svg = `
                <svg width="${cursorSize}" height="${cursorSize}" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="${center}" cy="${center}" r="${radius - 1}" 
                            fill="${color}" stroke="${borderColor}" stroke-width="1.5"/>
                    <circle cx="${center}" cy="${center}" r="1.5" fill="${borderColor}"/>
                </svg>
            `;
        } else {
            // Draw: use selected pen color with pure filled circle (no border)
            const color = penColor || '#000000';
            // Convert hex to rgba for fill (70% opacity for better visibility)
            const fillColor = hexToRgba(color, 0.7);

            svg = `
                <svg width="${cursorSize}" height="${cursorSize}" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="${center}" cy="${center}" r="${radius - 1}" 
                            fill="${fillColor}"/>
                </svg>
            `;
        }

        // Encode SVG to data URL
        const encoded = encodeURIComponent(svg.trim());
        const hotspot = Math.round(center);

        return `url('data:image/svg+xml,${encoded}') ${hotspot} ${hotspot}, crosshair`;
    } catch (e) {
        console.error('Error creating custom cursor:', e);
        return 'crosshair';
    }
}

/**
 * Convert hex color to rgba
 * @param {string} hex - Hex color (e.g., '#FF5733')
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} RGBA color string
 */
function hexToRgba(hex, alpha = 1) {
    try {
        // Remove # if present
        hex = hex.replace('#', '');

        // Parse hex values
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        return `rgba(${r},${g},${b},${alpha})`;
    } catch (e) {
        console.error('Error converting hex to rgba:', e);
        return `rgba(0,0,0,${alpha})`;
    }
}

/**
 * Update canvas cursor based on current tool, size, zoom, and color
 */
function updateCanvasCursor() {
    try {
        const canvas = document.getElementById('whiteboard');
        if (!canvas) return;

        // Set cursor based on tool
        switch (currentTool) {
            case 'draw':
            case 'magic':
            case 'erase':
                // Create custom cursor with size, zoom level, and current pen color
                canvas.style.cursor = createCustomCursor(currentTool, currentSize, viewportTransform.zoom, currentColor);
                break;
            case 'hand':
                canvas.style.cursor = isPanning ? 'grabbing' : 'grab';
                break;
            default:
                canvas.style.cursor = 'default';
        }
    } catch (e) {
        console.error('Error updating canvas cursor:', e);
    }
}

// Initialize cursor when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateCanvasCursor);
} else {
    updateCanvasCursor();
}



// ============================================
// SYNC MODE SETTINGS
// ============================================

/**
 * Toggle sync mode settings modal
 */
function toggleSyncMode() {
    const modal = document.getElementById('syncModeModal');
    if (modal) {
        if (modal.style.display === 'none' || modal.style.display === '') {
            openSyncModeModal();
        } else {
            closeSyncModeModal();
        }
    }
}

/**
 * Open sync mode settings modal
 */
function openSyncModeModal() {
    const modal = document.getElementById('syncModeModal');
    if (modal) {
        // Set current mode
        const radios = document.querySelectorAll('input[name="syncMode"]');
        radios.forEach(radio => {
            if (radio.value === syncMode) {
                radio.checked = true;
                updateSyncModeSelection(radio);
            }
        });

        modal.style.display = 'flex';
    }
}

/**
 * Close sync mode settings modal
 */
function closeSyncModeModal() {
    const modal = document.getElementById('syncModeModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Update visual selection of sync mode radio button
 */
function updateSyncModeSelection(radio) {
    // Update border colors for all labels
    const labels = document.querySelectorAll('input[name="syncMode"]');
    labels.forEach(input => {
        const label = input.closest('label');
        if (label) {
            if (input.checked) {
                label.style.borderColor = '#6965db';
                label.style.background = '#f0f0ff';
            } else {
                label.style.borderColor = '#e5e7eb';
                label.style.background = 'white';
            }
        }
    });
}

/**
 * Apply selected sync mode
 */
function applySyncMode() {
    const selectedRadio = document.querySelector('input[name="syncMode"]:checked');
    if (selectedRadio) {
        const newMode = selectedRadio.value;
        const oldMode = syncMode;

        syncMode = newMode;
        localStorage.setItem('whiteboardSyncMode', newMode);

        // Update button appearance
        updateSyncModeButton();

        // Show confirmation toast
        const modeLabels = {
            'confirm': '✅ Confirm Mode',
            'auto-accept': '⚡ Auto-Accept Mode',
            'offline': '🔒 Offline Mode'
        };

        MiniGameUtils.showToast(`Sync mode changed to: ${modeLabels[newMode]}`, 'success');

        // Log mode change
        console.log(`[Sync Mode] Changed from ${oldMode} to ${newMode}`);

        // Add chat message
        addChatMessage('System', `Sync mode: ${modeLabels[newMode]}`, '#10b981');
    }

    closeSyncModeModal();
}

/**
 * Update sync mode button appearance based on current mode
 */
function updateSyncModeButton() {
    const btn = document.getElementById('syncModeBtn');
    if (!btn) return;

    const modeConfig = {
        'confirm': {icon: '🔄', title: 'Sync Mode: Confirm (click to change)'},
        'auto-accept': {icon: '⚡', title: 'Sync Mode: Auto-Accept (click to change)'},
        'offline': {icon: '🔒', title: 'Sync Mode: Offline (click to change)'}
    };

    const config = modeConfig[syncMode] || modeConfig['confirm'];
    btn.textContent = config.icon;
    btn.title = config.title;
}

// Initialize sync mode button on load
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateSyncModeButton);
    } else {
        updateSyncModeButton();
    }
}

// ============================================
// INITIALIZATION
// ============================================

// Initialize undo/redo button states on page load
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateUndoRedoButtons);
    } else {
        updateUndoRedoButtons();
    }
}

// ============================================
// DEBUG UTILITIES (exposed to window for console access)
// ============================================

/**
 * Debug function to verify coordinate system
 * Call from console: window.debugWhiteboard()
 */
window.debugWhiteboard = function () {
    console.log('=== Whiteboard Debug Info ===');
    console.log('Canvas Config:', CANVAS_CONFIG);
    console.log('Viewport Transform:', viewportTransform);
    console.log('Canvas Element:', {
        width: canvas?.width,
        height: canvas?.height,
        styleWidth: canvas?.style.width,
        styleHeight: canvas?.style.height,
        clientWidth: canvas?.clientWidth,
        clientHeight: canvas?.clientHeight
    });
    console.log('Board State:', {
        totalStrokes: boardState?.length || 0,
        lastStroke: boardState?.[boardState.length - 1]
    });
    console.log('Connection:', {
        connected,
        username,
        channelName,
        users: users.size
    });
    console.log('Zoom:', `${Math.round(viewportTransform.zoom * 100)}%`);
    console.log('Canvas Position:', {
        panX: Math.round(viewportTransform.panX),
        panY: Math.round(viewportTransform.panY)
    });

    // Test coordinate conversion
    if (canvas) {
        const testViewportPos = {x: 100, y: 100};
        const canvasPos = viewportToCanvas(testViewportPos.x, testViewportPos.y);
        const backToViewport = canvasToViewport(canvasPos.x, canvasPos.y);
        console.log('Coordinate Conversion Test:');
        console.log('  Viewport (100, 100) →', `Canvas (${canvasPos.x.toFixed(2)}, ${canvasPos.y.toFixed(2)})`);
        console.log('  Canvas back to Viewport →', `(${backToViewport.x.toFixed(2)}, ${backToViewport.y.toFixed(2)})`);
    }
};

/**
 * Debug function to test drawing at specific canvas coordinates
 * Call from console: window.testDrawAtCanvasPos(960, 540, 'red')
 */
window.testDrawAtCanvasPos = function (canvasX, canvasY, color = 'red') {
    if (!canvas || !ctx) {
        console.error('Canvas not ready');
        return;
    }

    console.log(`Drawing test marker at canvas coordinates (${canvasX}, ${canvasY})`);

    // Draw a cross marker
    const size = 20;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(canvasX - size, canvasY);
    ctx.lineTo(canvasX + size, canvasY);
    ctx.moveTo(canvasX, canvasY - size);
    ctx.lineTo(canvasX, canvasY + size);
    ctx.stroke();
    ctx.restore();

    console.log(`✓ Marker drawn. Canvas center is at (960, 540)`);
};

console.log('[Whiteboard] Debug utilities available: window.debugWhiteboard(), window.testDrawAtCanvasPos(x, y, color)');

// ============================================
// FRAMEWORK INTEGRATION
// ============================================

/**
 * Integration with common game framework
 * Board state sync and other methods are now encapsulated in WhiteboardGame class
 */

console.log('[Whiteboard] Framework integration ready - all methods in WhiteboardGame class');

// ============================================
// END FRAMEWORK INTEGRATION
// ============================================

// NOTE: Page unload cleanup is now handled automatically by BaseGame._setupCleanupOnUnload()
// No need for duplicate code here

