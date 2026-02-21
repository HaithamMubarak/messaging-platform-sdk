/**
 * QuickShare - Peer-to-peer file sharing via WebRTC DataChannels
 *
 * Features:
 * - Multi-user room support
 * - Peer-to-peer file transfer (no server storage)
 * - Chunked transfer for large files (up to 100MB)
 * - Progress tracking
 * - Encrypted transfer (DTLS)
 *
 * @class QuickShare
 * @extends AgentInteractionBase
 */
class QuickShare extends AgentInteractionBase {
    constructor(options = {}) {
        super({
            storagePrefix: 'quickshare',
            customType: 'quickshare',
            dataChannelName: 'file-transfer',
            dataChannelOptions: {
                ordered: true,      // Must be ordered for file chunks
                maxRetransmits: 10  // Retry for reliability
            },
            relayMode: 'p2p-mesh',  // Direct P2P for file transfers
            ...options
        });

        // File transfer settings
        this.MAX_FILE_SIZE = options.maxFileSize || 100 * 1024 * 1024; // 100MB default
        this.CHUNK_SIZE = options.chunkSize || 64 * 1024; // 64KB chunks

        // Transfer tracking
        this.outgoingTransfers = new Map(); // transferId -> { file, recipients, progress }
        this.incomingTransfers = new Map(); // transferId -> { metadata, chunks, progress }

        // Completed files (available for download)
        this.receivedFiles = new Map(); // transferId -> { metadata, blob, url }

        console.log('[QuickShare] Created with max file size:', this._formatSize(this.MAX_FILE_SIZE));
    }

    // =========================================================================
    // Lifecycle Overrides
    // =========================================================================

    async onInitialize() {
        console.log('[QuickShare] Initializing file sharing...');
    }

    onStart() {
        console.log('[QuickShare] File sharing session started');
    }

    onStop() {
        // Cancel all pending transfers
        this.cancelAllTransfers();
        console.log('[QuickShare] File sharing session stopped');
    }

    /**
     * Handle player join event
     */
    onPlayerJoin(detail) {
        console.log('[QuickShare] User joined:', detail.agentName);
        this.emit('user-joined', detail.agentName);
    }

    /**
     * Handle player leave event
     */
    onPlayerLeave(detail) {
        console.log('[QuickShare] User left:', detail.agentName);

        // Cancel any transfers with this peer
        this.outgoingTransfers.forEach((transfer, id) => {
            if (transfer.recipients.has(detail.agentName)) {
                transfer.recipients.delete(detail.agentName);
                if (transfer.recipients.size === 0) {
                    this.cancelTransfer(id);
                }
            }
        });

        this.emit('user-left', detail.agentName);
    }

    /**
     * Handle DataChannel open event
     */
    onDataChannelOpen(peerId) {
        console.log('[QuickShare] DataChannel open with:', peerId);
        this.emit('datachannel-open', peerId);
    }

    /**
     * Handle DataChannel close event
     */
    onDataChannelClose(peerId) {
        console.log('[QuickShare] DataChannel closed with:', peerId);

        // Cancel any transfers with this peer
        this.outgoingTransfers.forEach((transfer, id) => {
            if (transfer.recipients.has(peerId)) {
                transfer.recipients.delete(peerId);
                if (transfer.recipients.size === 0) {
                    this.cancelTransfer(id);
                }
            }
        });

        // Cancel incoming transfers from this peer
        this.incomingTransfers.forEach((transfer, id) => {
            if (transfer.metadata && transfer.metadata.from === peerId) {
                console.log(`[QuickShare] Cancelling incoming transfer from ${peerId}`);
                this.cancelTransfer(id);
            }
        });

        this.emit('datachannel-close', peerId);
    }

    /**
     * Handle DataChannel error event
     */
    onDataChannelError(peerId, error, isGracefulClose) {
        // Only log as error if it's not a graceful close
        if (isGracefulClose) {
            console.log('[QuickShare] DataChannel gracefully closed with:', peerId);
        } else {
            console.error('[QuickShare] DataChannel error with:', peerId, error);
        }

        // Cancel any transfers with this peer (same as close)
        this.outgoingTransfers.forEach((transfer, id) => {
            if (transfer.recipients.has(peerId)) {
                transfer.recipients.delete(peerId);
                if (transfer.recipients.size === 0) {
                    this.cancelTransfer(id);
                }
            }
        });

        // Cancel incoming transfers from this peer
        this.incomingTransfers.forEach((transfer, id) => {
            if (transfer.metadata && transfer.metadata.from === peerId) {
                if (!isGracefulClose) {
                    console.log(`[QuickShare] Cancelling incoming transfer from ${peerId} due to error`);
                }
                this.cancelTransfer(id);
            }
        });

        this.emit('datachannel-error', peerId, error, isGracefulClose);
    }

    // =========================================================================
    // File Transfer API
    // =========================================================================

    /**
     * Share a file with all connected peers or specific peer
     * @param {File} file - File to share
     * @param {string|null} targetPeer - Specific peer or null for all
     * @returns {string} Transfer ID
     */
    async shareFile(file, targetPeer = null) {
        if (!this.connected) {
            throw new Error('Not connected to room');
        }

        // Validate file size
        if (file.size > this.MAX_FILE_SIZE) {
            throw new Error(`File too large. Maximum size is ${this._formatSize(this.MAX_FILE_SIZE)}`);
        }

        const transferId = this._generateTransferId();
        const recipients = targetPeer
            ? [targetPeer]
            : this.getConnectedPeers().filter(p => p !== this.username);

        if (recipients.length === 0) {
            throw new Error('No connected peers to share with');
        }

        console.log(`[QuickShare] Starting transfer ${transferId}: ${file.name} (${this._formatSize(file.size)}) to ${recipients.length} peer(s)`);

        // Create transfer record
        const transfer = {
            id: transferId,
            file: file,
            recipients: new Set(recipients),
            progress: new Map(), // peerId -> progress (0-100)
            totalChunks: Math.ceil(file.size / this.CHUNK_SIZE),
            startTime: Date.now(),
            status: 'starting'
        };

        // Initialize progress for each recipient
        recipients.forEach(peer => transfer.progress.set(peer, 0));
        this.outgoingTransfers.set(transferId, transfer);

        // Send file metadata to recipients
        const metadata = {
            type: 'file-metadata',
            transferId: transferId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type || 'application/octet-stream',
            totalChunks: transfer.totalChunks,
            chunkSize: this.CHUNK_SIZE,
            from: this.username
        };

        if (targetPeer) {
            this.sendData(metadata, targetPeer);
        } else {
            // Broadcast to all peers by calling sendData without target
            this.sendData(metadata);
        }

        // Emit transfer started
        this.emit('transfer-started', {
            transferId,
            fileName: file.name,
            fileSize: file.size,
            recipients: Array.from(recipients),
            direction: 'outgoing'
        });

        // Start sending chunks after a brief delay (allow metadata to arrive)
        setTimeout(() => this._sendFileChunks(transferId), 100);

        return transferId;
    }

    /**
     * Cancel an outgoing transfer
     * @param {string} transferId - Transfer to cancel
     */
    cancelTransfer(transferId) {
        const transfer = this.outgoingTransfers.get(transferId);
        if (transfer) {
            transfer.status = 'cancelled';

            // Notify recipients
            const cancelMsg = {
                type: 'transfer-cancelled',
                transferId: transferId,
                from: this.username
            };

            transfer.recipients.forEach(peer => {
                this.sendData(cancelMsg, peer);
            });

            this.outgoingTransfers.delete(transferId);
            this.emit('transfer-cancelled', { transferId, direction: 'outgoing' });

            console.log(`[QuickShare] Cancelled outgoing transfer ${transferId}`);
        }

        // Also check incoming
        const incoming = this.incomingTransfers.get(transferId);
        if (incoming) {
            this.incomingTransfers.delete(transferId);
            this.emit('transfer-cancelled', { transferId, direction: 'incoming' });
            console.log(`[QuickShare] Cancelled incoming transfer ${transferId}`);
        }
    }

    /**
     * Cancel all active transfers
     */
    cancelAllTransfers() {
        this.outgoingTransfers.forEach((_, id) => this.cancelTransfer(id));
        this.incomingTransfers.forEach((_, id) => this.cancelTransfer(id));
    }

    /**
     * Get transfer progress
     * @param {string} transferId - Transfer ID
     * @returns {Object|null} Progress info
     */
    getTransferProgress(transferId) {
        const outgoing = this.outgoingTransfers.get(transferId);
        if (outgoing) {
            const avgProgress = Array.from(outgoing.progress.values())
                .reduce((a, b) => a + b, 0) / outgoing.progress.size;
            return {
                transferId,
                direction: 'outgoing',
                fileName: outgoing.file.name,
                fileSize: outgoing.file.size,
                progress: avgProgress,
                status: outgoing.status,
                recipients: Array.from(outgoing.recipients)
            };
        }

        const incoming = this.incomingTransfers.get(transferId);
        if (incoming) {
            const progress = (incoming.receivedChunks / incoming.metadata.totalChunks) * 100;
            return {
                transferId,
                direction: 'incoming',
                fileName: incoming.metadata.fileName,
                fileSize: incoming.metadata.fileSize,
                progress: progress,
                status: incoming.status,
                from: incoming.metadata.from
            };
        }

        return null;
    }

    /**
     * Get all active transfers
     * @returns {Array} Array of transfer info
     */
    getActiveTransfers() {
        const transfers = [];

        this.outgoingTransfers.forEach((_, id) => {
            const progress = this.getTransferProgress(id);
            if (progress) transfers.push(progress);
        });

        this.incomingTransfers.forEach((_, id) => {
            const progress = this.getTransferProgress(id);
            if (progress) transfers.push(progress);
        });

        return transfers;
    }

    /**
     * Get received files (completed downloads)
     * @returns {Array} Array of received file info
     */
    getReceivedFiles() {
        const files = [];
        this.receivedFiles.forEach((file, transferId) => {
            files.push({
                transferId,
                fileName: file.metadata.fileName,
                fileSize: file.metadata.fileSize,
                fileType: file.metadata.fileType,
                from: file.metadata.from,
                receivedAt: file.receivedAt,
                downloadUrl: file.url
            });
        });
        return files;
    }

    /**
     * Download a received file
     * @param {string} transferId - Transfer ID of received file
     */
    downloadFile(transferId) {
        const file = this.receivedFiles.get(transferId);
        if (!file) {
            console.warn(`[QuickShare] No received file with ID ${transferId}`);
            return;
        }

        // Create download link and click it
        const a = document.createElement('a');
        a.href = file.url;
        a.download = file.metadata.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        console.log(`[QuickShare] Downloading ${file.metadata.fileName}`);
    }

    /**
     * Clear received files
     * @param {string|null} transferId - Specific transfer or null for all
     */
    clearReceivedFiles(transferId = null) {
        if (transferId) {
            const file = this.receivedFiles.get(transferId);
            if (file && file.url) {
                URL.revokeObjectURL(file.url);
            }
            this.receivedFiles.delete(transferId);
        } else {
            this.receivedFiles.forEach(file => {
                if (file.url) URL.revokeObjectURL(file.url);
            });
            this.receivedFiles.clear();
        }
    }

    // =========================================================================
    // Data Channel Message Handling
    // =========================================================================

    /**
     * Override parent to handle file transfer messages
     */
    onDataChannelMessage(peerId, data) {
        // Handle file transfer messages
        switch (data.type) {
            case 'file-metadata':
                this._handleFileMetadata(peerId, data);
                break;
            case 'file-chunk':
                this._handleFileChunk(peerId, data);
                break;
            case 'chunk-ack':
                this._handleChunkAck(peerId, data);
                break;
            case 'transfer-cancelled':
                this._handleTransferCancelled(peerId, data);
                break;
            case 'transfer-complete':
                this._handleTransferComplete(peerId, data);
                break;
            default:
                // Let parent handle other message types
                if (super.onDataChannelMessage) {
                    super.onDataChannelMessage(peerId, data);
                }
                break;
        }
    }

    _handleFileMetadata(peerId, data) {
        console.log(`[QuickShare] Received file metadata from ${peerId}:`, data.fileName, this._formatSize(data.fileSize));

        // Validate file size
        if (data.fileSize > this.MAX_FILE_SIZE) {
            console.warn(`[QuickShare] Rejecting file - too large: ${this._formatSize(data.fileSize)}`);
            return;
        }

        // Create incoming transfer record
        const transfer = {
            id: data.transferId,
            metadata: data,
            chunks: new Array(data.totalChunks),
            receivedChunks: 0,
            status: 'receiving',
            startTime: Date.now()
        };

        this.incomingTransfers.set(data.transferId, transfer);

        // Emit transfer started
        this.emit('transfer-started', {
            transferId: data.transferId,
            fileName: data.fileName,
            fileSize: data.fileSize,
            from: data.from,
            direction: 'incoming'
        });
    }

    _handleFileChunk(peerId, data) {
        const transfer = this.incomingTransfers.get(data.transferId);
        if (!transfer) {
            console.warn(`[QuickShare] Unknown transfer: ${data.transferId}`);
            return;
        }

        // Decode chunk data and store
        transfer.chunks[data.chunkIndex] = this._base64ToArrayBuffer(data.data);
        transfer.receivedChunks++;

        // Calculate and emit progress
        const progress = (transfer.receivedChunks / transfer.metadata.totalChunks) * 100;
        this.emit('transfer-progress', {
            transferId: data.transferId,
            progress: progress,
            direction: 'incoming',
            fileName: transfer.metadata.fileName
        });

        // Send acknowledgment
        this.sendData({
            type: 'chunk-ack',
            transferId: data.transferId,
            chunkIndex: data.chunkIndex
        }, peerId);

        // Check if complete
        if (transfer.receivedChunks === transfer.metadata.totalChunks) {
            this._completeIncomingTransfer(data.transferId);
        }
    }

    _handleChunkAck(peerId, data) {
        const transfer = this.outgoingTransfers.get(data.transferId);
        if (!transfer) return;

        // Update progress for this peer
        const chunkProgress = ((data.chunkIndex + 1) / transfer.totalChunks) * 100;
        transfer.progress.set(peerId, chunkProgress);

        // Calculate average progress
        const avgProgress = Array.from(transfer.progress.values())
            .reduce((a, b) => a + b, 0) / transfer.progress.size;

        this.emit('transfer-progress', {
            transferId: data.transferId,
            progress: avgProgress,
            direction: 'outgoing',
            fileName: transfer.file.name
        });

        // Check if all recipients complete
        if (avgProgress >= 100) {
            this._completeOutgoingTransfer(data.transferId);
        }
    }

    _handleTransferCancelled(peerId, data) {
        const transfer = this.incomingTransfers.get(data.transferId);
        if (transfer) {
            this.incomingTransfers.delete(data.transferId);
            this.emit('transfer-cancelled', {
                transferId: data.transferId,
                direction: 'incoming',
                by: peerId
            });
            console.log(`[QuickShare] Transfer ${data.transferId} cancelled by sender`);
        }
    }

    _handleTransferComplete(peerId, data) {
        console.log(`[QuickShare] Transfer ${data.transferId} complete confirmation from ${peerId}`);
    }

    // =========================================================================
    // File Sending Logic
    // =========================================================================

    async _sendFileChunks(transferId) {
        const transfer = this.outgoingTransfers.get(transferId);
        if (!transfer || transfer.status === 'cancelled') return;

        transfer.status = 'sending';
        const file = transfer.file;

        for (let i = 0; i < transfer.totalChunks; i++) {
            if (transfer.status === 'cancelled') {
                console.log(`[QuickShare] Transfer ${transferId} cancelled, stopping`);
                return;
            }

            const start = i * this.CHUNK_SIZE;
            const end = Math.min(start + this.CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            // Read chunk as ArrayBuffer
            const chunkData = await this._readChunk(chunk);
            const base64Data = this._arrayBufferToBase64(chunkData);

            // Send chunk to all recipients
            const chunkMsg = {
                type: 'file-chunk',
                transferId: transferId,
                chunkIndex: i,
                totalChunks: transfer.totalChunks,
                data: base64Data
            };

            transfer.recipients.forEach(peer => {
                if (this.isDataChannelOpen(peer)) {
                    this.sendData(chunkMsg, peer);
                }
            });

            // Small delay between chunks to avoid overwhelming DataChannel buffer
            if (i < transfer.totalChunks - 1) {
                await this._delay(10);
            }
        }

        console.log(`[QuickShare] All chunks sent for ${transferId}`);
    }

    _readChunk(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
        });
    }

    // =========================================================================
    // Transfer Completion
    // =========================================================================

    _completeIncomingTransfer(transferId) {
        const transfer = this.incomingTransfers.get(transferId);
        if (!transfer) return;

        console.log(`[QuickShare] Completing incoming transfer: ${transfer.metadata.fileName}`);

        // Combine chunks into blob
        const blob = new Blob(transfer.chunks, { type: transfer.metadata.fileType });
        const url = URL.createObjectURL(blob);

        // Store completed file
        this.receivedFiles.set(transferId, {
            metadata: transfer.metadata,
            blob: blob,
            url: url,
            receivedAt: Date.now()
        });

        // Clean up transfer
        this.incomingTransfers.delete(transferId);

        // Notify sender
        this.sendData({
            type: 'transfer-complete',
            transferId: transferId
        }, transfer.metadata.from);

        // Calculate transfer time
        const duration = Date.now() - transfer.startTime;
        const speed = transfer.metadata.fileSize / (duration / 1000); // bytes/sec

        // Emit completion
        this.emit('transfer-complete', {
            transferId: transferId,
            fileName: transfer.metadata.fileName,
            fileSize: transfer.metadata.fileSize,
            from: transfer.metadata.from,
            direction: 'incoming',
            duration: duration,
            speed: speed,
            downloadUrl: url
        });

        console.log(`[QuickShare] Transfer complete: ${transfer.metadata.fileName} in ${duration}ms (${this._formatSize(speed)}/s)`);
    }

    _completeOutgoingTransfer(transferId) {
        const transfer = this.outgoingTransfers.get(transferId);
        if (!transfer || transfer.status === 'complete') return;

        transfer.status = 'complete';

        const duration = Date.now() - transfer.startTime;
        const speed = transfer.file.size / (duration / 1000);

        this.emit('transfer-complete', {
            transferId: transferId,
            fileName: transfer.file.name,
            fileSize: transfer.file.size,
            recipients: Array.from(transfer.recipients),
            direction: 'outgoing',
            duration: duration,
            speed: speed
        });

        // Clean up after a delay
        setTimeout(() => {
            this.outgoingTransfers.delete(transferId);
        }, 5000);

        console.log(`[QuickShare] Outgoing transfer complete: ${transfer.file.name} in ${duration}ms`);
    }

    // =========================================================================
    // Utility Methods
    // =========================================================================

    /**
     * Get list of all connected users (including self)
     * Inherits from AgentSessionBase
     * @returns {Array<string>} Array of usernames
     */
    // getConnectedUsers() - uses parent implementation from AgentSessionBase

    /**
     * Get list of connected peers with DataChannel
     * @returns {Array<string>} Array of peer IDs
     */
    getConnectedPeers() {
        const peers = [];
        if (this.webrtcHelper) {
            const connectedUsers = super.getConnectedUsers();
            connectedUsers.forEach(peerId => {
                if (peerId !== this.username && this.isDataChannelOpen(peerId)) {
                    peers.push(peerId);
                }
            });
        }
        return peers;
    }

    /**
     * Check if DataChannel is open with peer
     * @param {string} peerId - Peer ID
     * @returns {boolean}
     */
    isDataChannelOpen(peerId) {
        // Use parent class method from AgentSessionBase
        return super.isDataChannelOpen(peerId);
    }

    _generateTransferId() {
        return 'xfer_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
    }

    _formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    _arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// =============================================================================
// UI Integration & Page Initialization
// =============================================================================

// Global QuickShare instance
let quickShareInstance = null;
let currentUsername = '';

/**
 * Initialize QuickShare on page load
 */
function initializeQuickShare() {
    console.log('[QuickShare] Page loaded');

    // Setup drop zone
    setupDropZone();

    // Load connection modal using connection-modal.js
    loadConnectionModal({
        localStoragePrefix: 'quickshare_',
        channelPrefix: 'share-',
        title: '🔗 Join Quick Share Room',
        collapsedTitle: '🔗 Quick Share',
        onConnect: handleConnect,
        onHideModal: () => {
            document.getElementById('appContainer').classList.add('active');
        }
    });

    // Process shared link and setup auto-connect using centralized utility (like Air Hockey)
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'QuickShare',
            storagePrefix: 'quickshare_',
            connectCallback: async function() {
                console.log('[QuickShare] Auto-connect triggered');
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await handleConnect(username, channel, password);
                } else {
                    console.warn('[QuickShare] Auto-connect skipped: missing username or channel');
                }
            }
        });
    }
}

/**
 * Handle connection
 */
async function handleConnect(username, channelName, password) {
    try {
        currentUsername = username;

        // Create QuickShare instance
        quickShareInstance = new QuickShare({
            maxFileSize: 100 * 1024 * 1024 // 100MB
        });

        await quickShareInstance.initialize();

        // Setup event handlers
        setupQuickShareEvents();

        // Connect
        await quickShareInstance.connect({
            username: username,
            channelName: channelName,
            channelPassword: password
        });

        // Start session
        quickShareInstance.start();

        // Update UI
        document.getElementById('roomBadge').textContent = channelName;
        updateUsersList();

        // Update URL hash with connection credentials for sharing
        if (window.ShareModal && typeof window.ShareModal.updateUrlWithAuth === 'function') {
            window.ShareModal.updateUrlWithAuth({
                channel: channelName,
                password: password
            });
            console.log('[QuickShare] URL hash updated with auth info');
        }

        // Setup share modal
        if (typeof ShareModal !== 'undefined') {
            ShareModal.init({
                channel: channelName,
                password: password,
                agentName: username
            });
            document.getElementById('shareBtn').style.display = 'inline-flex';
            document.getElementById('shareBtn').onclick = () => ShareModal.show();
        }

        // Hide connection modal
        if (window.ConnectionModal) {
            window.ConnectionModal.hide();
        }

        showToast('Connected to room!', 'success');

    } catch (error) {
        console.error('[QuickShare] Connection failed:', error);
        showToast('Failed to connect: ' + error.message, 'error');
        throw error; // Re-throw to let connection-modal handle it
    }
}

/**
 * Setup QuickShare event handlers
 */
function setupQuickShareEvents() {
    quickShareInstance.on('user-joined', (agentName) => {
        console.log('[QuickShare] User joined:', agentName);
        showToast(`${agentName} joined the room`);
        updateUsersList();
    });

    quickShareInstance.on('user-left', (agentName) => {
        console.log('[QuickShare] User left:', agentName);
        showToast(`${agentName} left the room`);
        updateUsersList();
    });

    quickShareInstance.on('datachannel-open', (peerId) => {
        console.log('[QuickShare] DataChannel open with:', peerId);
        updateUsersList();
    });

    quickShareInstance.on('datachannel-close', (peerId) => {
        console.log('[QuickShare] DataChannel closed with:', peerId);
        showToast(`Connection closed with ${peerId}`, 'warning');
        updateUsersList();
        // Cancel any active transfers with this peer
        cancelTransfersWithPeer(peerId);
    });

    quickShareInstance.on('datachannel-error', (peerId, error, isGracefulClose) => {
        // Only show error toast if it's not a graceful close
        if (isGracefulClose) {
            console.log('[QuickShare] DataChannel gracefully closed with:', peerId);
            // Don't show error toast for graceful closes (normal disconnect)
        } else {
            console.error('[QuickShare] DataChannel error with:', peerId, error);
            showToast(`Connection error with ${peerId}`, 'error');
        }
        updateUsersList();
        // Cancel any active transfers with this peer
        cancelTransfersWithPeer(peerId);
    });

    quickShareInstance.on('transfer-started', (info) => {
        console.log('[QuickShare] Transfer started:', info);
        updateTransfersList();
        if (info.direction === 'incoming') {
            showToast(`Receiving ${info.fileName} from ${info.from}`, 'success');
        }
    });

    quickShareInstance.on('transfer-progress', (info) => {
        updateTransferProgress(info);
    });

    quickShareInstance.on('transfer-complete', (info) => {
        console.log('[QuickShare] Transfer complete:', info);
        updateTransfersList();
        updateReceivedList();
        if (info.direction === 'incoming') {
            showToast(`Received ${info.fileName}!`, 'success');
        } else {
            showToast(`Sent ${info.fileName}!`, 'success');
        }
    });

    quickShareInstance.on('transfer-cancelled', (info) => {
        console.log('[QuickShare] Transfer cancelled:', info);
        updateTransfersList();
        showToast('Transfer cancelled', 'error');
    });
}

/**
 * Setup drop zone
 */
function setupDropZone() {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

/**
 * Handle file selection
 */
function handleFileSelect(event) {
    handleFiles(event.target.files);
    event.target.value = '';
}

/**
 * Handle files
 */
async function handleFiles(files) {
    if (!quickShareInstance || !quickShareInstance.connected) {
        showToast('Not connected to room', 'error');
        return;
    }

    const peers = quickShareInstance.getConnectedPeers();
    if (peers.length === 0) {
        showToast('No connected peers to share with', 'error');
        return;
    }

    for (const file of files) {
        try {
            await quickShareInstance.shareFile(file);
            console.log(`[QuickShare] Started sharing: ${file.name}`);
        } catch (error) {
            console.error('[QuickShare] Share failed:', error);
            showToast(`Failed to share ${file.name}: ${error.message}`, 'error');
        }
    }

    updateTransfersList();
}

/**
 * Update users list
 */
function updateUsersList() {
    const list = document.getElementById('usersList');
    if (!list || !quickShareInstance) return;

    const users = quickShareInstance.getConnectedUsers();
    const connectedPeers = quickShareInstance.getConnectedPeers();

    list.innerHTML = users.map(user => {
        const isHost = users.indexOf(user) === 0;
        const isYou = user === currentUsername;
        const hasDC = connectedPeers.includes(user) || isYou;

        let classes = 'user-badge';
        if (isHost) classes += ' host';
        if (isYou) classes += ' you';

        return `
            <div class="${classes}">
                ${hasDC ? '<span class="peer-status"></span>' : ''}
                ${user}
                ${isHost ? ' 👑' : ''}
                ${isYou ? ' (you)' : ''}
            </div>
        `;
    }).join('');

    const countEl = document.getElementById('userCount');
    if (countEl) {
        countEl.textContent = users.length;
    }
}

/**
 * Update transfers list
 */
function updateTransfersList() {
    const section = document.getElementById('transfersSection');
    const list = document.getElementById('transfersList');
    if (!section || !list || !quickShareInstance) return;

    const transfers = quickShareInstance.getActiveTransfers();

    if (transfers.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    list.innerHTML = transfers.map(t => `
        <div class="transfer-item" data-transfer-id="${t.transferId}">
            <div class="transfer-icon">${t.direction === 'outgoing' ? '📤' : '📥'}</div>
            <div class="transfer-info">
                <div class="transfer-name">${t.fileName}</div>
                <div class="transfer-details">
                    ${formatSize(t.fileSize)} •
                    ${t.direction === 'outgoing' ? `To: ${t.recipients?.join(', ') || 'All'}` : `From: ${t.from}`}
                </div>
                <div class="transfer-progress">
                    <div class="transfer-progress-bar" style="width: ${t.progress}%"></div>
                </div>
            </div>
            <div class="transfer-status ${t.status}">${Math.round(t.progress)}%</div>
        </div>
    `).join('');
}

/**
 * Update transfer progress
 */
function updateTransferProgress(info) {
    const item = document.querySelector(`[data-transfer-id="${info.transferId}"]`);
    if (item) {
        const progressBar = item.querySelector('.transfer-progress-bar');
        const status = item.querySelector('.transfer-status');
        if (progressBar) progressBar.style.width = `${info.progress}%`;
        if (status) status.textContent = `${Math.round(info.progress)}%`;
    }
}

/**
 * Update received files list
 */
function updateReceivedList() {
    const section = document.getElementById('receivedSection');
    const list = document.getElementById('receivedList');
    if (!section || !list || !quickShareInstance) return;

    const files = quickShareInstance.getReceivedFiles();

    if (files.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    list.innerHTML = files.map(f => `
        <div class="received-item">
            <div class="transfer-icon">📄</div>
            <div class="transfer-info">
                <div class="transfer-name">${f.fileName}</div>
                <div class="transfer-details">${formatSize(f.fileSize)} • From: ${f.from}</div>
            </div>
            <button class="download-btn" onclick="downloadFile('${f.transferId}')">Download</button>
        </div>
    `).join('');
}

/**
 * Download file
 */
function downloadFile(transferId) {
    if (quickShareInstance) {
        quickShareInstance.downloadFile(transferId);
    }
}

/**
 * Cancel all active transfers with a specific peer
 * Called when peer disconnects or has DataChannel error
 */
function cancelTransfersWithPeer(peerId) {
    if (!quickShareInstance) return;

    let cancelledCount = 0;

    // Cancel outgoing transfers to this peer
    quickShareInstance.outgoingTransfers.forEach((transfer, transferId) => {
        if (transfer.recipients && transfer.recipients.includes(peerId)) {
            console.log(`[QuickShare] Cancelling outgoing transfer ${transferId} to ${peerId}`);
            quickShareInstance.emit('transfer-cancelled', {
                transferId: transferId,
                direction: 'outgoing',
                fileName: transfer.file?.name || 'unknown',
                reason: 'peer_disconnected'
            });
            quickShareInstance.outgoingTransfers.delete(transferId);
            cancelledCount++;
        }
    });

    // Cancel incoming transfers from this peer
    quickShareInstance.incomingTransfers.forEach((transfer, transferId) => {
        if (transfer.metadata && transfer.metadata.from === peerId) {
            console.log(`[QuickShare] Cancelling incoming transfer ${transferId} from ${peerId}`);
            quickShareInstance.emit('transfer-cancelled', {
                transferId: transferId,
                direction: 'incoming',
                fileName: transfer.metadata?.fileName || 'unknown',
                reason: 'peer_disconnected'
            });
            quickShareInstance.incomingTransfers.delete(transferId);
            cancelledCount++;
        }
    });

    if (cancelledCount > 0) {
        console.log(`[QuickShare] Cancelled ${cancelledCount} transfer(s) with ${peerId}`);
        updateTransfersList();
    }
}

/**
 * Disconnect
 */
function disconnect() {
    if (quickShareInstance) {
        quickShareInstance.disconnect();
        quickShareInstance = null;
    }

    // Clear URL hash
    if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        console.log('[QuickShare] Cleared URL hash on disconnect');
    }

    const appContainer = document.getElementById('appContainer');
    if (appContainer) {
        appContainer.classList.remove('active');
    }

    // Reload page to reset state
    window.location.reload();
}

/**
 * Format file size
 */
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Show toast notification
 * Uses MiniGameUtils from common-utils.js for consistent toast behavior
 */
function showToast(message, type = 'info', duration = 3000) {
    // Use MiniGameUtils if available (loaded from common-utils.js)
    if (typeof MiniGameUtils !== 'undefined' && typeof MiniGameUtils.showToast === 'function') {
        MiniGameUtils.showToast(message, type, duration);
    } else {
        // Fallback: log to console if MiniGameUtils not available
        console.log(`[QuickShare] Toast (${type}): ${message}`);
    }
}

// =============================================================================
// Initialize on DOM load
// =============================================================================

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initializeQuickShare);
}

// =============================================================================
// Exports
// =============================================================================

// Export for browser
if (typeof window !== 'undefined') {
    window.QuickShare = QuickShare;
    window.handleFileSelect = handleFileSelect;
    window.downloadFile = downloadFile;
    window.disconnect = disconnect;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { QuickShare };
}
