/**
 * File Explorer Component
 * Universal file browser for both local and remote (SSH/SFTP) file systems
 */

class FileExplorer {
    constructor(options = {}) {
        this.mlsUrl = options.mlsUrl || (typeof MLS_URL !== 'undefined' ? MLS_URL : 'http://localhost:8088');
        this.terminalSessionId = null;  // Terminal session ID - used directly for all file operations
        this.currentPath = '/';
        this.files = [];
        this.selectedFile = null;
        this.isConnected = false;
        this.connectionInfo = null;

        // SFTP session cache: terminalSessionId → { sftpSessionId, lastPath, connectionInfo }
        this.sessionCache = new Map();

        // DOM Elements
        this.panel = null;
        this.fileList = null;
        this.pathInput = null;
        this.statusBar = null;
        this.contextMenu = null;
        this.editorOverlay = null;

        // Callbacks
        this.onToast = options.onToast || (() => {});

        // Create DOM elements
        this.createDomElements();
        this.attachEventListeners();
    }

    /**
     * Send file system notification to owner (for remote sessions)
     * @param {string} operation - Operation type (read, write, delete, mkdir, rename, navigate)
     * @param {object} details - Operation details (path, oldPath, newPath, etc.)
     */
    sendFileSystemNotification(operation, details) {
        // Check if this is a remote session
        if (window.isRemoteFileSystem && window.isRemoteFileSystem(this.terminalSessionId)) {
            const session = window.sessions?.get(this.terminalSessionId);
            if (session && session.owner && window.terminalSharing) {
                console.log('[FileExplorer] Sending notification to owner:', operation, details);
                window.terminalSharing.sendFileSystemNotification(
                    this.terminalSessionId,
                    operation,
                    details,
                    session.owner
                );
            }
        }
    }

    /**
     * Create all DOM elements for the SFTP browser
     */
    createDomElements() {
        // Create main panel
        this.panel = document.createElement('div');
        this.panel.className = 'sftp-panel';
        this.panel.id = 'sftpPanel';
        this.panel.innerHTML = `
            <div class="sftp-header">
                <div class="sftp-header-title">
                    <span>📁</span>
                    <span>File Explorer</span>
                    <span id="sftpConnectionName" style="font-weight: normal; color: var(--text-muted);"></span>
                </div>
                <div class="sftp-header-close" onclick="fileExplorer.close()" title="Close">✕</div>
            </div>

            <div class="sftp-toolbar">
                <button class="sftp-toolbar-btn" onclick="fileExplorer.goUp()" title="Go Up (Parent Directory)">
                    <span>⬆️</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.goHome()" title="Go Home">
                    <span>🏠</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.refresh()" title="Refresh Directory">
                    <span>🔄</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="window.refreshCurrentSftp?window.refreshCurrentSftp():void(0)" title="Refresh SFTP Connection (use if connection times out)">
                    <span>🔌</span>
                    <span class="label" style="font-size: 0.8em;">Reconnect</span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.createNewFile()" title="New File">
                    <span>📄</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.createNewFolder()" title="New Folder">
                    <span>📁</span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.uploadFile()" title="Upload File">
                    <span>⬆️</span>
                    <span class="label">Upload</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.downloadSelected()" title="Download Selected">
                    <span>⬇️</span>
                    <span class="label">Download</span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.editSelected()" title="Edit File">
                    <span>✏️</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.deleteSelected()" title="Delete Selected">
                    <span>🗑️</span>
                </button>
            </div>

            <div class="sftp-path-bar">
                <input type="text" id="sftpPathInput" placeholder="/path/to/directory" onkeypress="if(event.key==='Enter') fileExplorer.navigateTo(this.value)">
                <button class="sftp-path-go-btn" onclick="fileExplorer.navigateTo(document.getElementById('sftpPathInput').value)">Go</button>
            </div>

            <div class="sftp-file-list" id="sftpFileList">
                <div class="sftp-empty">
                    <div class="sftp-empty-icon">📂</div>
                    <div class="sftp-empty-text">Connect to SSH session to browse files</div>
                </div>
            </div>

            <div class="sftp-status-bar" id="sftpStatusBar">
                <span id="sftpItemCount">0 items</span>
                <span id="sftpConnectionStatus">Disconnected</span>
            </div>

            <!-- Hidden file input for uploads -->
            <input type="file" id="sftpFileUpload" style="display: none" multiple onchange="fileExplorer.handleFileUpload(this.files)">

            <!-- Drop overlay -->
            <div class="sftp-drop-overlay" id="sftpDropOverlay">
                <div class="sftp-drop-text">Drop files here to upload</div>
            </div>

            <!-- Upload progress -->
            <div class="sftp-upload-progress" id="sftpUploadProgress">
                <div class="sftp-upload-info">
                    <span class="sftp-upload-filename" id="sftpUploadFilename">file.txt</span>
                    <span class="sftp-upload-percent" id="sftpUploadPercent">0%</span>
                </div>
                <div class="sftp-upload-bar">
                    <div class="sftp-upload-bar-fill" id="sftpUploadBarFill" style="width: 0%"></div>
                </div>
            </div>
        `;

        // Create context menu
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'sftp-context-menu';
        this.contextMenu.id = 'sftpContextMenu';
        this.contextMenu.innerHTML = `
            <div class="sftp-context-menu-item" onclick="fileExplorer.openSelected()">
                <span class="icon">📂</span> Open
            </div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.editSelected()">
                <span class="icon">✏️</span> Edit
            </div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.downloadSelected()">
                <span class="icon">⬇️</span> Download
            </div>
            <div class="sftp-context-menu-separator"></div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.renameSelected()">
                <span class="icon">📝</span> Rename
            </div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.copyPath()">
                <span class="icon">📋</span> Copy Path
            </div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.showProperties()">
                <span class="icon">ℹ️</span> Properties
            </div>
            <div class="sftp-context-menu-separator"></div>
            <div class="sftp-context-menu-item danger" onclick="fileExplorer.deleteSelected()">
                <span class="icon">🗑️</span> Delete
            </div>
        `;

        // OLD: Editor modal - REMOVED
        // File editing now uses FileEditor component (file-editor.js)
        // Supports multi-tab editing with session context!

        // Store references
        this.fileList = this.panel.querySelector('#sftpFileList');
        this.pathInput = this.panel.querySelector('#sftpPathInput');
        this.statusBar = this.panel.querySelector('#sftpStatusBar');
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Click outside to close context menu
        document.addEventListener('click', () => {
            this.contextMenu.classList.remove('visible');
        });

        // Drag and drop
        this.panel.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.isConnected) {
                this.panel.querySelector('#sftpDropOverlay').classList.add('visible');
            }
        });

        this.panel.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.panel.querySelector('#sftpDropOverlay').classList.remove('visible');
        });

        this.panel.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.panel.querySelector('#sftpDropOverlay').classList.remove('visible');
            if (this.isConnected && e.dataTransfer.files.length > 0) {
                this.handleFileUpload(e.dataTransfer.files);
            }
        });

        // OLD: Editor event listeners - REMOVED
        // File editor now managed by FileEditor component
    }

    /**
     * Append elements to the document
     */
    mount(container) {
        container.appendChild(this.panel);
        document.body.appendChild(this.contextMenu);
        // OLD: Editor overlay removed - using FileEditor component now
    }

    /**
     * Open SFTP panel for a terminal session
     * ✅ BACKEND REMEMBERS LAST PATH AUTOMATICALLY!
     */
    async open(terminalSessionId, connectionInfo = {}) {
        console.log('[FileExplorer] Opening for terminal:', terminalSessionId);

        // Save current session to in-memory cache before switching
        if (this.terminalSessionId && this.isConnected && this.terminalSessionId !== terminalSessionId) {
            this.sessionCache.set(this.terminalSessionId, {
                lastPath: this.currentPath,
                connectionInfo: this.connectionInfo
            });
        }

        // Check if we have a cached session for this terminal (in-memory, this page session only)
        const cached = this.sessionCache.get(terminalSessionId);

        this.terminalSessionId = terminalSessionId;
        this.connectionInfo = connectionInfo;
        this.panel.classList.add('visible');

        // Update header with connection name
        const connName = this.panel.querySelector('#sftpConnectionName');
        if (connectionInfo.name) {
            connName.textContent = `- ${connectionInfo.name}`;
        }

        if (cached) {
            // Restore from in-memory cache (fast switching between tabs in same page session)
            console.log('[FileExplorer] Using cached session, path:', cached.lastPath);
            this.currentPath = cached.lastPath || '/';
            this.isConnected = true;
            this.updateConnectionStatus('Connected');
            this.updatePathBar();
            await this.loadDirectory(this.currentPath);
        } else {
            // New session or page refresh
            // Backend will automatically return the last navigated path!
            console.log('[FileExplorer] New session - backend will restore last path');
            await this.connect();
        }
    }

    /**
     * Connect to file system (backend auto-creates session on first operation)
     * Backend uses terminal session ID directly - no separate file system session ID needed!
     *
     * ✅ For SSH: Backend returns the default home directory from sftpChannel.pwd()
     * ✅ For Local: Backend returns user.home directory
     */
    async connect() {
        try {
            this.showLoading('Loading files...');

            // Backend auto-creates file system session using terminal session ID
            // First request will return the default directory (home for SSH, user.home for local)

            // List "." - backend will use its default directory and return it in currentDirectory
            const response = await fetch(
                `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/list?path=.`
            );

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            // ✅ Backend returns its default directory (SSH home or local user.home)
            const defaultPath = result.currentDirectory || '/';
            const files = result.files || [];

            // Map backend property names to frontend property names
            const mappedFiles = files.map(file => ({
                ...file,
                isDirectory: file.directory || file.isDirectory || false,
                isLink: file.symbolicLink || file.isLink || false,
                mtime: file.lastModified || file.mtime
            }));

            console.log('[FileExplorer] Connected - backend default directory:', defaultPath);

            // Set state
            this.currentPath = defaultPath;
            this.files = mappedFiles;
            this.isConnected = true;

            // Update UI
            this.updateConnectionStatus('Connected');
            this.updatePathBar();
            this.renderFileList();

            this.onToast('success', 'Connected', `Connected to ${this.connectionInfo?.name || 'file system'}`);

        } catch (error) {
            console.error('[FileExplorer] Connection error:', error);
            this.showError('Connection failed: ' + error.message);
            this.updateConnectionStatus('Disconnected');
            this.onToast('error', 'Connection Error', error.message);
        }
    }

    /**
     * Close SFTP panel
     * Backend persists navigation automatically - no need to save!
     */
    async close() {
        // Save to in-memory cache for quick switching (this page session only)
        if (this.terminalSessionId && this.currentPath) {
            this.sessionCache.set(this.terminalSessionId, {
                lastPath: this.currentPath,
                connectionInfo: this.connectionInfo
            });
        }

        // No backend cleanup needed - file system auto-closes with terminal!
        this.isConnected = false;
        this.terminalSessionId = null;
        this.files = [];
        this.selectedFile = null;
        this.panel.classList.remove('visible');
        this.updateConnectionStatus('Disconnected');
    }

    /**
     * Load directory contents
     */
    async loadDirectory(path = null, triggerEvent = true) {
        if (!this.isConnected) return;

        const targetPath = path || this.currentPath;
        const previousPath = this.currentPath; // Save previous path for recovery

        console.log('[FileExplorer] loadDirectory:', targetPath, 'triggerEvent:', triggerEvent);

        try {
            this.showLoading('Loading...');

            // Use unified file system API (with increased timeout for slow connections)
            const response = await fetch(
                `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/list?path=${encodeURIComponent(targetPath)}`,
                { signal: AbortSignal.timeout(30000) } // 30 second timeout (increased from 10s)
            );

            const result = await response.json();

            console.log('[FileSystem] Backend response:', JSON.stringify(result, null, 2));
            console.log('[FileSystem] Requested path:', targetPath);
            console.log('[FileSystem] Backend currentDir:', result.currentDir);

            if (result.error) {
                throw new Error(result.error);
            }

            // Use backend's currentDir since it now accurately reflects the navigation
            const finalPath = result.currentDirectory || result.currentDir || targetPath;
            const files = result.files || [];

            // Map backend property names to frontend property names
            const mappedFiles = files.map(file => ({
                ...file,
                // Map backend "directory" to frontend "isDirectory"
                isDirectory: file.directory || file.isDirectory || false,
                // Map backend "symbolicLink" to frontend "isLink"
                isLink: file.symbolicLink || file.isLink || false,
                // Keep mtime for backward compatibility
                mtime: file.lastModified || file.mtime
            }));

            console.log('[SFTP] Successfully loaded - targetPath:', targetPath, '- currentDir from backend:', result.currentDirectory, '- final currentPath:', finalPath);
            console.log('[FileSystem] Mapped files sample:', mappedFiles.slice(0, 3));

            // ✅ Use updateNavigationState for consistent state updates and sharing
            // Pass triggerEvent to control whether navigation is broadcast
            this.updateNavigationState(finalPath, mappedFiles, triggerEvent);

        } catch (error) {
            console.error('[SFTP] Load directory error:', error);
            let errorMsg = error.message || 'Unknown error';

            // Provide helpful messages for common errors
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                errorMsg = 'Request timed out - SDK Local Service may be offline';
            } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
                errorMsg = 'Cannot connect to SDK Local Service - check if it\'s running';
            }

            this.showError(`Cannot access "${targetPath}": ${errorMsg}`);

            // Restore previous path (don't let backend change our path on error)
            this.currentPath = previousPath;

            // Re-throw so navigateTo can handle it
            throw error;
        }
    }

    /**
     * Update navigation state and optionally share with other agents
     * This centralizes all navigation state updates and sharing logic
     *
     * ✅ BACKEND PERSISTS CURRENT DIRECTORY IN SESSION!
     * No need for localStorage - backend remembers path automatically
     */
    updateNavigationState(path, files, triggerEvent = true) {
        console.log('[FileExplorer] updateNavigationState:', path, 'files:', files.length, 'triggerEvent:', triggerEvent);

        this.currentPath = path;
        this.files = files;

        // Update UI
        this.updatePathBar();
        this.renderFileList();

        // Save to in-memory session cache (for quick switching between tabs)
        if (this.terminalSessionId) {
            this.sessionCache.set(this.terminalSessionId, {
                fsSessionId: this.terminalSessionId,
                lastPath: this.currentPath,
                connectionInfo: this.connectionInfo
            });
        }

        // Share navigation with other agents (only if this is a local action)
        if (triggerEvent && window.terminalSharing) {
            // Extract SSH session ID from SFTP session ID (format: sftp-{sshId})
            const sshSessionId = this.terminalSessionId ? this.terminalSessionId.replace('sftp-', '') : this.terminalSessionId;
            if (sshSessionId) {
                window.terminalSharing.shareFileSystemNavigation(sshSessionId, path, files);
                console.log('[FileExplorer] Shared navigation update to other agents');
            }
        }

        // Show sync toast only if this came from remote
        if (!triggerEvent) {
            console.log('[SFTP Browser] Synced to remote navigation:', path);
            if (this.onToast) {
                this.onToast('info', '📁 SFTP Synced', `Following owner to: ${path}`, 2000);
            }
        }
    }

    /**
     * Render file list
     */
    renderFileList() {
        if (this.files.length === 0) {
            this.fileList.innerHTML = `
                <div class="sftp-empty">
                    <div class="sftp-empty-icon">📂</div>
                    <div class="sftp-empty-text">Directory is empty</div>
                </div>
            `;
        } else {
            this.fileList.innerHTML = this.files.map((file, index) => `
                <div class="sftp-file-item ${file.isDirectory ? 'directory' : ''}"
                     data-index="${index}"
                     data-path="${this.escapeHtml(file.path)}"
                     data-is-directory="${file.isDirectory}"
                     ondblclick="fileExplorer.handleDoubleClick(${index}, event)"
                     onclick="fileExplorer.selectFile(${index})"
                     oncontextmenu="fileExplorer.showContextMenu(event, ${index})">
                    <div class="sftp-file-icon">${this.getFileIcon(file)}</div>
                    <div class="sftp-file-details">
                        <div class="sftp-file-name">${this.escapeHtml(file.name)}</div>
                        <div class="sftp-file-meta">
                            <span>${file.isDirectory ? 'Directory' : this.formatSize(file.size)}</span>
                            <span>${this.formatDate(file.mtime)}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        this.updateItemCount();
    }

    /**
     * Select a file
     */
    selectFile(index) {
        // Deselect previous
        this.fileList.querySelectorAll('.sftp-file-item').forEach(el => el.classList.remove('selected'));

        // Select new
        const item = this.fileList.querySelector(`[data-index="${index}"]`);
        if (item) {
            item.classList.add('selected');
            this.selectedFile = this.files[index];
        }
    }

    /**
     * Handle double-click on file/folder
     */
    handleDoubleClick(index, event) {
        // Prevent default behavior (opening link, etc.)
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const file = this.files[index];
        if (file.isDirectory) {
            this.navigateTo(file.path);
        } else {
            // Open file in editor
            this.editFile(file.path);
        }
    }

    /**
     * Navigate to path
     * @param {string} path - Path to navigate to
     * @param {boolean} sendSync - Whether to send sync message to owner (default: true)
     */
    async navigateTo(path, sendSync = true) {
        if (!path || path.trim() === '') {
            this.onToast('warning', 'Invalid Path', 'Please enter a valid path');
            return;
        }

        // Trim whitespace
        path = path.trim();

        console.log('[SFTP] Navigating to:', path, 'sendSync:', sendSync);

        try {
            await this.loadDirectory(path, sendSync); // ✅ Pass sendSync to loadDirectory

            // ✅ Send navigation sync to owner if this is a remote session and sendSync is true
            if (sendSync && window.isRemoteFileSystem && window.isRemoteFileSystem(this.terminalSessionId)) {
                const session = window.sessions?.get(this.terminalSessionId);
                if (session && session.owner && window.terminalSharing) {
                    console.log('[FileExplorer] Sending navigation sync to owner:', session.owner);
                    window.terminalSharing.sendFileSystemNavigate(this.terminalSessionId, path, session.owner);
                }
            }

            // ✅ Immediately update path bar with the new currentPath
            // (after loadDirectory completes and currentPath is updated)
            this.updatePathBar();

            // ✅ Also update again after a short delay to ensure consistency
            // (in case any async operations are still pending)
            setTimeout(() => {
                this.updatePathBar();
            }, 50);

        } catch (error) {
            console.error('[SFTP] Navigation failed:', error);
            this.onToast('error', 'Navigation Failed', error.message || 'Failed to navigate to path');

            // Path was already restored in loadDirectory, update UI to show it
            this.updatePathBar();
        }
    }

    /**
     * Go up to parent directory
     */
    async goUp() {
        if (this.currentPath === '/' || this.currentPath === '') return;

        const parts = this.currentPath.split('/').filter(p => p);
        parts.pop();
        const parentPath = '/' + parts.join('/');

        await this.navigateTo(parentPath || '/');
    }

    /**
     * Go to home directory
     */
    async goHome() {
        // Get home directory from status endpoint
        try {
            const response = await fetch(
                `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/status`
            );
            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            // ✅ Extract homeDirectory from message field (format: "homeDirectory:/path/to/home")
            let homePath = result.currentDirectory || '/'; // Fallback to currentDirectory

            if (result.message && result.message.startsWith('homeDirectory:')) {
                homePath = result.message.substring('homeDirectory:'.length);
                console.log('[FileSystem] Home directory from status:', homePath);
            } else {
                console.warn('[FileSystem] No homeDirectory in response, using currentDirectory');
            }

            await this.navigateTo(homePath);
        } catch (error) {
            console.warn('[FileSystem] Could not get home directory, using /:', error);
            // Fallback to root
            await this.navigateTo('/');
        }
    }

    /**
     * Refresh current directory
     */
    async refresh() {
        try {
            await this.loadDirectory();
            this.onToast('info', 'Refreshed', 'Directory listing refreshed');
        } catch (error) {
            console.error('[FileExplorer] Refresh failed:', error);
            this.onToast('error', 'Refresh Failed', error.message || 'Failed to refresh directory');
        }
    }

    /**
     * Open selected file/folder
     */
    openSelected() {
        if (!this.selectedFile) return;

        if (this.selectedFile.isDirectory) {
            this.navigateTo(this.selectedFile.path);
        } else {
            this.editFile(this.selectedFile.path);
        }
    }

    /**
     * Edit file (open in editor)
     */
    /**
     * Edit file using FileEditor component
     */
    async editFile(path) {
        if (!this.isConnected) return;

        // Use new FileEditor component (multi-tab support!)
        if (window.fileEditor) {
            await fileEditor.openFile(
                this.terminalSessionId,
                this.connectionInfo.name || 'Terminal',
                path
            );
        } else {
            console.error('[FileExplorer] FileEditor not initialized');
            this.onToast('error', 'Editor Error', 'File editor not available');
        }
    }

    /**
     * Edit selected file
     */
    editSelected() {
        if (!this.selectedFile || this.selectedFile.isDirectory) {
            this.onToast('warning', 'No Selection', 'Please select a file to edit');
            return;
        }
        this.editFile(this.selectedFile.path);
    }

    // OLD EMBEDDED EDITOR - REMOVED
    // File editing now uses FileEditor component with multi-tab support!
    /*
    async saveFile() { ... }
    closeEditor() { ... }
    */

    /**
     * Download selected file
     */
    downloadSelected() {
        if (!this.selectedFile || this.selectedFile.isDirectory) {
            this.onToast('warning', 'No Selection', 'Please select a file to download');
            return;
        }

        const url = `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/read-binary?path=${encodeURIComponent(this.selectedFile.path)}`;

        // Create hidden link and click it
        const link = document.createElement('a');
        link.href = url;
        link.download = this.selectedFile.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.onToast('info', 'Download Started', `Downloading ${this.selectedFile.name}`);
    }

    /**
     * Open file upload dialog
     */
    uploadFile() {
        this.panel.querySelector('#sftpFileUpload').click();
    }

    /**
     * Handle file upload
     */
    async handleFileUpload(files) {
        if (!this.isConnected || files.length === 0) return;

        const progressContainer = this.panel.querySelector('#sftpUploadProgress');
        const progressFilename = this.panel.querySelector('#sftpUploadFilename');
        const progressPercent = this.panel.querySelector('#sftpUploadPercent');
        const progressBar = this.panel.querySelector('#sftpUploadBarFill');

        for (const file of files) {
            try {
                progressContainer.classList.add('visible');
                progressFilename.textContent = file.name;
                progressPercent.textContent = '0%';
                progressBar.style.width = '0%';

                const formData = new FormData();
                formData.append('file', file);

                const remotePath = this.currentPath.endsWith('/')
                    ? this.currentPath + file.name
                    : this.currentPath + '/' + file.name;

                // Note: For real progress tracking, you'd need XHR with progress events
                // This is a simplified version
                progressPercent.textContent = 'Uploading...';
                progressBar.style.width = '50%';

                const response = await fetch(
                    `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/upload?path=${encodeURIComponent(remotePath)}`,
                    {
                        method: 'POST',
                        body: formData
                    }
                );

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`);
                }

                const result = await response.json();

                if (result.error) {
                    throw new Error(result.error);
                }

                progressPercent.textContent = '100%';
                progressBar.style.width = '100%';

                this.onToast('success', 'Upload Complete', `${file.name} uploaded successfully`);

                // Send notification to owner for remote sessions
                this.sendFileSystemNotification('write', {
                    path: remotePath,
                    name: file.name
                });

            } catch (error) {
                console.error('[SFTP] Upload error:', error);
                this.onToast('error', 'Upload Failed', `${file.name}: ${error.message}`);
            }
        }

        // Hide progress after a delay
        setTimeout(() => {
            progressContainer.classList.remove('visible');
        }, 1000);

        // Refresh directory
        await this.refresh();
    }

    /**
     * Delete selected file/folder
     */
    async deleteSelected() {
        if (!this.selectedFile) {
            this.onToast('warning', 'No Selection', 'Please select a file or folder to delete');
            return;
        }

        const confirmMsg = this.selectedFile.isDirectory
            ? `Delete folder "${this.selectedFile.name}" and all its contents?`
            : `Delete file "${this.selectedFile.name}"?`;

        if (!confirm(confirmMsg)) return;

        try {
            let result;

            // Check if this is a remote/shared session
            if (window.isRemoteFileSystem && window.isRemoteFileSystem(this.terminalSessionId)) {
                result = await window.proxyFileSystemRequest(this.terminalSessionId, 'delete', {
                    path: this.selectedFile.path,
                    recursive: this.selectedFile.isDirectory
                });
            } else {
                // Use unified file system API - session ID in URL, params in query string
                const response = await fetch(
                    `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/delete?path=${encodeURIComponent(this.selectedFile.path)}&recursive=${this.selectedFile.isDirectory}`,
                    { method: 'DELETE' }
                );
                result = await response.json();
            }

            if (result.error) {
                throw new Error(result.error);
            }

            this.onToast('success', 'Deleted', `${this.selectedFile.name} deleted`);

            // Send notification to owner
            this.sendFileSystemNotification('delete', {
                path: this.selectedFile.path,
                name: this.selectedFile.name
            });

            this.selectedFile = null;
            await this.refresh();

        } catch (error) {
            console.error('[SFTP] Delete error:', error);
            this.onToast('error', 'Delete Failed', error.message);
        }
    }

    /**
     * Create new file
     */
    async createNewFile() {
        const name = prompt('Enter file name:', 'new-file.txt');
        if (!name) return;

        const path = this.currentPath.endsWith('/')
            ? this.currentPath + name
            : this.currentPath + '/' + name;

        try {
            let result;

            // Check if this is a remote/shared session
            if (window.isRemoteFileSystem && window.isRemoteFileSystem(this.terminalSessionId)) {
                result = await window.proxyFileSystemRequest(this.terminalSessionId, 'write', {
                    path: path,
                    content: ''  // Empty file
                });
            } else {
                // Use write endpoint to create empty file
                const response = await fetch(
                    `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/write`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: path,
                            content: ''  // Empty file
                        })
                    }
                );
                result = await response.json();
            }

            if (result.error) {
                throw new Error(result.error);
            }

            this.onToast('success', 'File Created', `${name} created`);

            // Send notification to owner
            this.sendFileSystemNotification('write', {
                path: path,
                name: name
            });

            await this.refresh();

            // Open the new file in editor
            this.editFile(path);

        } catch (error) {
            console.error('[SFTP] Create file error:', error);
            this.onToast('error', 'Create Failed', error.message);
        }
    }

    /**
     * Create new folder
     */
    async createNewFolder() {
        const name = prompt('Enter folder name:', 'new-folder');
        if (!name) return;

        const path = this.currentPath.endsWith('/')
            ? this.currentPath + name
            : this.currentPath + '/' + name;

        try {
            let result;

            // Check if this is a remote/shared session
            if (window.isRemoteFileSystem && window.isRemoteFileSystem(this.terminalSessionId)) {
                result = await window.proxyFileSystemRequest(this.terminalSessionId, 'mkdir', {
                    path: path
                });
            } else {
                // Use mkdir endpoint with path in query string
                const response = await fetch(
                    `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/mkdir?path=${encodeURIComponent(path)}`,
                    { method: 'POST' }
                );
                result = await response.json();
            }

            if (result.error) {
                throw new Error(result.error);
            }

            this.onToast('success', 'Folder Created', `${name} created`);

            // Send notification to owner
            this.sendFileSystemNotification('mkdir', {
                path: path,
                name: name
            });

            await this.refresh();

        } catch (error) {
            console.error('[SFTP] Create folder error:', error);
            this.onToast('error', 'Create Failed', error.message);
        }
    }

    /**
     * Rename selected file/folder
     */
    async renameSelected() {
        if (!this.selectedFile) return;

        const newName = prompt('Enter new name:', this.selectedFile.name);
        if (!newName || newName === this.selectedFile.name) return;

        const oldPath = this.selectedFile.path;
        const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
        const newPath = parentPath + '/' + newName;

        try {
            let result;

            // Check if this is a remote/shared session
            if (window.isRemoteFileSystem && window.isRemoteFileSystem(this.terminalSessionId)) {
                result = await window.proxyFileSystemRequest(this.terminalSessionId, 'rename', {
                    oldPath: oldPath,
                    newPath: newPath
                });
            } else {
                // Use rename endpoint with paths in query string
                const response = await fetch(
                    `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/rename?oldPath=${encodeURIComponent(oldPath)}&newPath=${encodeURIComponent(newPath)}`,
                    { method: 'POST' }
                );
                result = await response.json();
            }

            if (result.error) {
                throw new Error(result.error);
            }

            this.onToast('success', 'Renamed', `Renamed to ${newName}`);

            // Send notification to owner
            this.sendFileSystemNotification('rename', {
                oldPath: oldPath,
                newPath: newPath,
                oldName: this.selectedFile.name,
                newName: newName
            });

            await this.refresh();

        } catch (error) {
            console.error('[SFTP] Rename error:', error);
            this.onToast('error', 'Rename Failed', error.message);
        }
    }

    /**
     * Copy path to clipboard
     */
    copyPath() {
        if (!this.selectedFile) return;

        navigator.clipboard.writeText(this.selectedFile.path).then(() => {
            this.onToast('info', 'Path Copied', 'Path copied to clipboard');
        }).catch(err => {
            console.error('[SFTP] Copy path error:', err);
        });
    }

    /**
     * Show file properties
     */
    async showProperties() {
        if (!this.selectedFile) return;

        try {
            // Use info endpoint with session ID in path
            const response = await fetch(
                `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/info?path=${encodeURIComponent(this.selectedFile.path)}`
            );

            const info = await response.json();

            if (info.error) {
                throw new Error(info.error);
            }

            // Simple alert for now - could be made into a modal
            const props = `
Name: ${info.name}
Path: ${info.path}
Type: ${info.isDirectory ? 'Directory' : 'File'}
Size: ${this.formatSize(info.size)}
Permissions: ${info.permissions} (${info.permissionsOctal})
Modified: ${this.formatDate(info.mtime)}
Accessed: ${this.formatDate(info.atime)}
            `.trim();

            alert(props);

        } catch (error) {
            console.error('[SFTP] Properties error:', error);
            this.onToast('error', 'Error', error.message);
        }
    }

    /**
     * Show context menu
     */
    showContextMenu(event, index) {
        event.preventDefault();
        event.stopPropagation();

        this.selectFile(index);

        this.contextMenu.style.left = event.clientX + 'px';
        this.contextMenu.style.top = event.clientY + 'px';
        this.contextMenu.classList.add('visible');
    }

    /**
     * Show loading state
     */
    showLoading(message = 'Loading...') {
        this.fileList.innerHTML = `
            <div class="sftp-loading">
                <div class="sftp-loading-spinner"></div>
                <div class="sftp-loading-text">${message}</div>
            </div>
        `;
    }

    /**
     * Show error state
     */
    showError(message) {
        this.fileList.innerHTML = `
            <div class="sftp-empty">
                <div class="sftp-empty-icon">❌</div>
                <div class="sftp-empty-text">${this.escapeHtml(message)}</div>
            </div>
        `;
    }

    /**
     * Update connection status
     */
    updateConnectionStatus(status) {
        const statusEl = this.panel.querySelector('#sftpConnectionStatus');
        if (statusEl) {
            statusEl.textContent = status;
        }
    }

    /**
     * Update path bar to show current directory
     * ✅ SMART UPDATE: Only skip if user is actively typing a DIFFERENT path
     */
    updatePathBar() {
        // Get fresh reference in case DOM changed
        const pathInput = this.panel.querySelector('#sftpPathInput');
        if (pathInput) {
            // ✅ Smart check: Don't update if user is typing AND the value is different
            if (document.activeElement === pathInput && pathInput.value !== this.currentPath) {
                console.log('[SFTP] Path bar NOT updated - user is typing different path:', pathInput.value);
                return;
            }

            console.log('[SFTP] Updating path bar to:', this.currentPath);
            pathInput.value = this.currentPath;
        } else {
            console.warn('[SFTP] Path input not found, cannot update path bar');
        }
        // Also update the stored reference
        this.pathInput = pathInput;
    }

    /**
     * Update item count
     */
    updateItemCount() {
        const countEl = this.panel.querySelector('#sftpItemCount');
        if (countEl) {
            const folders = this.files.filter(f => f.isDirectory).length;
            const files = this.files.length - folders;
            countEl.textContent = `${folders} folder(s), ${files} file(s)`;
        }
    }

    /**
     * Update editor cursor position
     */
    updateEditorCursor() {
        const textarea = this.editorOverlay.querySelector('#sftpEditorContent');
        const text = textarea.value.substring(0, textarea.selectionStart);
        const lines = text.split('\n');
        const line = lines.length;
        const column = lines[lines.length - 1].length + 1;

        this.editorOverlay.querySelector('#sftpEditorCursor').textContent = `Line ${line}, Column ${column}`;
    }

    /**
     * Get file icon based on type
     */
    getFileIcon(file) {
        if (file.isDirectory) return '📁';
        if (file.isLink) return '🔗';

        const type = file.type || 'file';
        const icons = {
            'folder': '📁',
            'text': '📄',
            'image': '🖼️',
            'archive': '📦',
            'executable': '⚙️',
            'document': '📑',
            'audio': '🎵',
            'video': '🎬',
            'file': '📄'
        };

        return icons[type] || '📄';
    }

    /**
     * Format file size
     */
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Format date
     */
    formatDate(timestamp) {
        if (!timestamp) return '-';
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /**
     * Escape HTML
     */
    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileExplorer;
}



