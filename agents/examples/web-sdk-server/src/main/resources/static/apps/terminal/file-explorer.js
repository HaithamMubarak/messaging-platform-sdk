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

        // Upload control
        this.uploadAbortController = null;

        // Callbacks
        this.onToast = options.onToast || (() => {});

        // Create DOM elements
        this.createDomElements();
        this.attachEventListeners();
    }

    // Note: Storage operations now delegated to storageManager (storage-manager.js)
    // Use: storageManager.getFileExplorerPath(sessionId) and storageManager.setFileExplorerPath(sessionId, path)

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
     * Create all DOM elements for the File browser
     */
    createDomElements() {
        // Create main panel
        this.panel = document.createElement('div');
        this.panel.className = 'sftp-panel';
        this.panel.id = 'sftpPanel';
        this.panel.innerHTML = `
            <div class="sftp-header">
                <div class="sftp-header-title">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-inbox"></use></svg></span>
                    <span>File Explorer</span>
                    <span id="sftpConnectionName" style="font-weight: normal; color: var(--text-muted);"></span>
                </div>
            </div>

            <div class="sftp-toolbar">
                <button class="sftp-toolbar-btn" onclick="fileExplorer.goUp()" title="Go Up (Parent Directory)">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-chevron-up"></use></svg></span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.goHome()" title="Go Home">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-hard-drive"></use></svg></span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.refresh()" title="Refresh Directory">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-refresh"></use></svg></span>
                </button>
                <button class="sftp-toolbar-btn" onclick="window.refreshCurrentSftp?window.refreshCurrentSftp():void(0)" title="Refresh SFTP Connection (use if connection times out)">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-channel"></use></svg></span>
                    <span class="label" style="font-size: 0.8em;">Reconnect</span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.createNewFile()" title="New File">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-plus"></use></svg></span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.createNewFolder()" title="New Folder">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-layers"></use></svg></span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.uploadFile()" title="Upload File">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-upload"></use></svg></span>
                    <span class="label">Upload</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.downloadSelected()" title="Download Selected">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-download"></use></svg></span>
                    <span class="label">Download</span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.editSelected()" title="Edit File">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-pen"></use></svg></span>
                </button>
                <button class="sftp-toolbar-btn" onclick="fileExplorer.deleteSelected()" title="Delete Selected">
                    <span><svg class="icon icon--sm" aria-hidden="true"><use href="#i-trash"></use></svg></span>
                </button>
            </div>

            <div class="sftp-path-bar">
                <input type="text" id="sftpPathInput" placeholder="/path/to/directory" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" onkeypress="if(event.key==='Enter') fileExplorer.navigateTo(this.value)">
                <button class="sftp-path-go-btn" onclick="fileExplorer.navigateTo(document.getElementById('sftpPathInput').value)">Go</button>
            </div>

            <div class="sftp-filter-bar">
                <input type="text" id="sftpFilterInput" placeholder="Filter files…" autocomplete="off" oninput="fileExplorer.filterFiles(this.value)" title="Filter files by name (highlights matching files)">
                <button class="sftp-filter-clear" onclick="fileExplorer.clearFilter()" title="Clear filter"><svg class="icon icon--sm" aria-hidden="true"><use href="#i-x"></use></svg></button>
            </div>

            <div class="sftp-file-list" id="sftpFileList">
                <div class="sftp-empty">
                    <div class="sftp-empty-icon"><svg class="icon icon--lg" aria-hidden="true"><use href="#i-inbox"></use></svg></div>
                    <div class="sftp-empty-text">Connect to SSH session to browse files</div>
                </div>
            </div>

            <div class="sftp-status-bar" id="sftpStatusBar">
                <span id="sftpItemCount">0 items</span>
                <span id="sftpConnectionStatus">Disconnected</span>
            </div>

            <!-- Upload progress - inside the panel -->
            <div class="sftp-upload-progress" id="sftpUploadProgress">
                <div class="sftp-upload-info">
                    <span class="sftp-upload-filename" id="sftpUploadFilename">file.txt</span>
                    <span class="sftp-upload-percent" id="sftpUploadPercent">0%</span>
                    <button class="sftp-upload-cancel" id="sftpUploadCancel" title="Cancel upload"><svg class="icon icon--sm" aria-hidden="true"><use href="#i-x"></use></svg></button>
                </div>
                <div class="sftp-upload-bar">
                    <div class="sftp-upload-bar-fill" id="sftpUploadBarFill" style="width: 0%"></div>
                </div>
            </div>

            <!-- Hidden file input for uploads -->
            <input type="file" id="sftpFileUpload" style="display: none" multiple onchange="fileExplorer.handleFileUpload(this.files)">

            <!-- Drop overlay -->
            <div class="sftp-drop-overlay" id="sftpDropOverlay">
                <div class="sftp-drop-text">Drop files here to upload</div>
            </div>
        `;

        // Create context menu
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'sftp-context-menu';
        this.contextMenu.id = 'sftpContextMenu';
        this.contextMenu.innerHTML = `
            <div class="sftp-context-menu-item" onclick="fileExplorer.openSelected()">
                <svg class="icon icon--sm" aria-hidden="true"><use href="#i-arrow-right"></use></svg> Open
            </div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.editSelected()">
                <svg class="icon icon--sm" aria-hidden="true"><use href="#i-code"></use></svg> Edit
            </div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.downloadSelected()">
                <svg class="icon icon--sm" aria-hidden="true"><use href="#i-download"></use></svg> Download
            </div>
            <div class="sftp-context-menu-separator"></div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.renameSelected()">
                <svg class="icon icon--sm" aria-hidden="true"><use href="#i-pen"></use></svg> Rename
            </div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.copyPath()">
                <svg class="icon icon--sm" aria-hidden="true"><use href="#i-copy"></use></svg> Copy Path
            </div>
            <div class="sftp-context-menu-item" onclick="fileExplorer.showProperties()">
                <svg class="icon icon--sm" aria-hidden="true"><use href="#i-info"></use></svg> Properties
            </div>
            <div class="sftp-context-menu-separator"></div>
            <div class="sftp-context-menu-item danger" onclick="fileExplorer.deleteSelected()">
                <svg class="icon icon--sm" aria-hidden="true"><use href="#i-trash"></use></svg> Delete
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
        this.isRemote = connectionInfo.isRemote || false; // ✅ Track if this is a remote/shared session
        this.remoteOwner = connectionInfo.remoteOwner || null; // ✅ Track the owner for proxying
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
     * ✅ For Remote (Host B): Uses proxy to request from owner (Host A)
     */
    async connect() {
        try {
            this.showLoading('Loading files...');

            let result;

            // ✅ For remote sessions (Host B - viewer): Use proxy
            if (this.isRemote && window.proxyFileSystemRequest) {
                console.log('[FileExplorer] Remote session - using proxy for initial load');
                result = await window.proxyFileSystemRequest(this.terminalSessionId, 'list', { path: '.' });
            } else {
                // ✅ For local/owner sessions (Host A): Direct API call
                // Backend auto-creates file system session using terminal session ID
                // First request will return the default directory (home for SSH, user.home for local)
                const response = await fetch(
                    `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/list?path=.`
                );
                result = await response.json();
            }

            if (result.error || !result.success) {
                throw new Error(result.error || 'Failed to connect');
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

            // Set connection state first
            this.isConnected = true;

            // ✅ Check localStorage for last visited path for this session
            const savedPath = storageManager.getFileExplorerPath(this.terminalSessionId);

            if (savedPath) {
                console.log('[FileExplorer] Found saved path in localStorage:', savedPath);
                // Navigate to saved path (will load files from that directory)
                await this.navigateTo(savedPath);

                // Update connection status
                this.updateConnectionStatus('Connected');
                this.onToast('success', 'Connected', `Connected to ${this.connectionInfo?.name || 'file system'}`);
                return; // navigateTo already handled all UI updates
            }

            // Set state for default path
            this.currentPath = defaultPath;
            this.files = mappedFiles;

            // Save initial path to localStorage
            storageManager.setFileExplorerPath(this.terminalSessionId, this.currentPath);

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
     * ✅ For remote sessions (Host B): Uses proxy to request from owner
     * ✅ For local/owner sessions (Host A): Direct API call
     */
    async loadDirectory(path = null, triggerEvent = true) {
        if (!this.isConnected) return;

        const targetPath = path || this.currentPath;
        const previousPath = this.currentPath; // Save previous path for recovery

        console.log('[FileExplorer] loadDirectory:', targetPath, 'triggerEvent:', triggerEvent, 'isRemote:', this.isRemote);

        try {
            this.showLoading('Loading...');

            let result;

            // ✅ For remote sessions (Host B - viewer): Use proxy
            if (this.isRemote && window.proxyFileSystemRequest) {
                console.log('[FileExplorer] Remote session - using proxy for directory load');
                result = await window.proxyFileSystemRequest(this.terminalSessionId, 'list', { path: targetPath });
            } else {
                // ✅ For local/owner sessions (Host A): Direct API call
                // Use unified file system API (with increased timeout for slow connections)
                const response = await fetch(
                    `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/list?path=${encodeURIComponent(targetPath)}`,
                    { signal: AbortSignal.timeout(30000) } // 30 second timeout (increased from 10s)
                );
                result = await response.json();
            }

            console.log('[FileSystem] Backend response:', JSON.stringify(result, null, 2));
            console.log('[FileSystem] Requested path:', targetPath);
            console.log('[FileSystem] Backend currentDir:', result.currentDir);

            // ✅ Check for backend errors and handle gracefully
            if (!result.success || result.error) {
                const errorMsg = result.error || result.message || 'Unknown error';
                const errorCode = result.errorCode || 'UNKNOWN';
                console.error('[FileSystem] Backend returned error:', errorCode, errorMsg);
                throw new Error(`${errorCode}: ${errorMsg}`);
            }

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
            } else if (errorMsg.includes('IO_ERROR') || errorMsg.includes('Error reading file')) {
                errorMsg = 'File system error - try refreshing or reconnecting';
            }

            this.showError(`Cannot access "${targetPath}": ${errorMsg}`);

            // Restore previous path (don't let backend change our path on error)
            this.currentPath = previousPath;
            
            // ✅ Update path bar even on error to show we're back to previous path
            this.updatePathBar();

            // Re-throw so navigateTo can handle it
            throw error;
        }
    }

    /**
     * Update navigation state and optionally share with other agents
     * This centralizes all navigation state updates and sharing logic
     *
     * ✅ Saves current path to localStorage for persistence across page reloads
     */
    updateNavigationState(path, files, triggerEvent = true) {
        console.log('[FileExplorer] updateNavigationState:', path, 'files:', files.length, 'triggerEvent:', triggerEvent);

        this.currentPath = path;
        this.files = files;

        // ✅ Save current path to localStorage for this session
        if (this.terminalSessionId) {
            storageManager.setFileExplorerPath(this.terminalSessionId, this.currentPath);
            console.log('[FileExplorer] Saved path to localStorage:', this.currentPath);

            // Also save to in-memory session cache (for quick switching between tabs)
            this.sessionCache.set(this.terminalSessionId, {
                lastPath: this.currentPath,
                connectionInfo: this.connectionInfo
            });
        }

        // Update UI
        this.updatePathBar();
        this.renderFileList();

        // ✅ REMOVED: No longer share navigation with other agents
        // Navigation is a personal preference and shouldn't sync across shared sessions
        // Only actual file changes (write/delete/mkdir) should notify the owner
    }

    /**
     * Render file list
     */
    renderFileList() {
        if (this.files.length === 0) {
            this.fileList.innerHTML = `
                <div class="sftp-empty">
                    <div class="sftp-empty-icon"><svg class="icon icon--lg" aria-hidden="true"><use href="#i-inbox"></use></svg></div>
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
     */
    async navigateTo(path) {
        if (!path || path.trim() === '') {
            this.onToast('warning', 'Invalid Path', 'Please enter a valid path');
            return;
        }

        // Trim whitespace
        path = path.trim();

        console.log('[FileExplorer] Navigating to:', path);

        try {
            await this.loadDirectory(path, true); // triggerEvent=true for UI consistency

            // ✅ Update path bar with the new currentPath
            this.updatePathBar();

            // ✅ Also update again after a short delay to ensure consistency
            setTimeout(() => {
                this.updatePathBar();
            }, 50);

        } catch (error) {
            console.error('[FileExplorer] Navigation failed:', error);
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
        if (!this.isConnected) {
            console.warn('[FileExplorer] Cannot refresh - not connected');
            return;
        }

        try {
            await this.loadDirectory();
            this.onToast('info', 'Refreshed', 'Directory listing refreshed');
        } catch (error) {
            console.error('[FileExplorer] Refresh failed:', error);
            // ✅ Don't show error toast if we already showed error in loadDirectory
            // Just log it and allow user to continue
            if (!error.message.includes('Cannot access')) {
                this.onToast('error', 'Refresh Failed', error.message || 'Failed to refresh directory');
            }
            // Don't re-throw - allow file explorer to remain functional
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
     * Download selected file with chunking support for large files
     */
    async downloadSelected() {
        if (!this.selectedFile || this.selectedFile.isDirectory) {
            this.onToast('warning', 'No Selection', 'Please select a file to download');
            return;
        }

        try {
            this.onToast('info', 'Downloading...', `Downloading ${this.selectedFile.name}`);

            let blob;

            // ✅ Check if this is a remote/shared session (Host B viewing Host A's terminal)
            if (this.isRemote && window.proxyFileSystemRequest) {
                console.log('[FileExplorer] Remote session - using FileTransferProxy for download');

                // Use FileTransferProxy for chunked download
                if (!window.fileTransferProxy) {
                    window.fileTransferProxy = new FileTransferProxy({
                        proxyRequestFn: window.proxyFileSystemRequest,
                        onToast: this.onToast
                    });
                }

                // FileTransferProxy handles file info fetch and chunking decision
                blob = await window.fileTransferProxy.downloadFile(
                    this.terminalSessionId,
                    this.selectedFile.path,
                    this.selectedFile.size,
                    (progress) => {
                        // Could add progress indicator here if needed
                        console.log(`[FileExplorer] Download progress: ${progress}%`);
                    }
                );
            } else {
                // ✅ Owner: Direct HTTP download
                console.log('[FileExplorer] Local/owner session - direct HTTP download');

                const url = `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/download?path=${encodeURIComponent(this.selectedFile.path)}`;
                const response = await fetch(url);

                if (!response.ok) {
                    throw new Error(`Download failed: ${response.status}`);
                }

                blob = await response.blob();
            }

            // Create a temporary URL for the blob
            const blobUrl = window.URL.createObjectURL(blob);

            // Create hidden link and trigger download
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = this.selectedFile.name;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();

            // Clean up
            setTimeout(() => {
                document.body.removeChild(link);
                window.URL.revokeObjectURL(blobUrl);
            }, 100);

            this.onToast('success', 'Download Complete', `Downloaded ${this.selectedFile.name}`);
        } catch (error) {
            console.error('[FileExplorer] Download error:', error);
            this.onToast('error', 'Download Failed', error.message || 'Failed to download file');
        }
    }

    /**
     * Download file in chunks for large file support
     * @param {string} filePath - Path of file to download
     * @param {number} fileSize - Total file size in bytes
     * @param {number} chunkSize - Size of each chunk
     * @returns {Promise<Blob>} Downloaded file as Blob
     */
    async downloadFileChunked(filePath, fileSize, chunkSize) {
        const totalChunks = Math.ceil(fileSize / chunkSize);
        const chunks = [];

        console.log(`[FileExplorer] Downloading in ${totalChunks} chunks (${chunkSize} bytes each)`);

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * chunkSize;
            const end = Math.min(start + chunkSize, fileSize);

            // Request chunk from owner
            const result = await window.proxyFileSystemRequest(
                this.terminalSessionId,
                'download-chunk',
                {
                    path: filePath,
                    start: start,
                    end: end
                }
            );

            if (!result.success || result.error) {
                throw new Error(result.error || `Failed to download chunk ${chunkIndex + 1}/${totalChunks}`);
            }

            // Decode Base64 chunk
            const binaryString = atob(result.chunkData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            chunks.push(bytes);

            const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            console.log(`[FileExplorer] Downloaded chunk ${chunkIndex + 1}/${totalChunks} (${progress}%)`);
        }

        // Combine all chunks into single Blob
        return new Blob(chunks, { type: 'application/octet-stream' });
    }

    /**
     * Open file upload dialog
     */
    uploadFile() {
        this.panel.querySelector('#sftpFileUpload').click();
    }

    /**
     * Handle file upload with chunking support for large files
     */
    async handleFileUpload(files) {
        if (!this.isConnected || files.length === 0) return;

        const progressContainer = this.panel.querySelector('#sftpUploadProgress');
        const progressFilename = this.panel.querySelector('#sftpUploadFilename');
        const progressPercent = this.panel.querySelector('#sftpUploadPercent');
        const progressBar = this.panel.querySelector('#sftpUploadBarFill');
        const cancelBtn = this.panel.querySelector('#sftpUploadCancel');

        // Setup cancel button
        cancelBtn.onclick = () => {
            if (this.uploadAbortController) {
                console.log('[FileExplorer] Cancelling upload...');
                this.uploadAbortController.abort();
                this.uploadAbortController = null;
                progressContainer.classList.remove('visible');
                if (this.onToast) {
                    this.onToast('info', 'Upload Cancelled', 'File upload was cancelled');
                }
            }
        };

        for (const file of files) {
            try {
                // Create new abort controller for this upload
                this.uploadAbortController = new AbortController();

                progressContainer.classList.add('visible');
                progressFilename.textContent = file.name;
                progressPercent.textContent = '0%';
                progressBar.style.width = '0%';

                const remotePath = this.currentPath.endsWith('/')
                    ? this.currentPath + file.name
                    : this.currentPath + '/' + file.name;

                let result;

                // ✅ Check if this is a remote/shared session (Host B viewing Host A's terminal)
                if (this.isRemote && window.proxyFileSystemRequest) {
                    console.log('[FileExplorer] Remote session - using FileTransferProxy for upload');

                    // Use FileTransferProxy for chunked upload with progress tracking
                    if (!window.fileTransferProxy) {
                        window.fileTransferProxy = new FileTransferProxy({
                            proxyRequestFn: window.proxyFileSystemRequest,
                            onToast: this.onToast
                        });
                    }

                    result = await window.fileTransferProxy.uploadFile(
                        this.terminalSessionId,
                        file,
                        remotePath,
                        (progress) => {
                            // Update progress UI
                            progressPercent.textContent = `${progress}%`;
                            progressBar.style.width = `${progress}%`;
                        },
                        this.uploadAbortController.signal
                    );
                } else {
                    // ✅ Owner: Direct HTTP upload with progress tracking
                    console.log('[FileExplorer] Local/owner session - direct HTTP upload');

                    progressPercent.textContent = 'Uploading...';
                    progressBar.style.width = '50%';

                    const formData = new FormData();
                    formData.append('file', file);

                    const response = await fetch(
                        `${this.mlsUrl}/filesystem/${encodeURIComponent(this.terminalSessionId)}/upload?path=${encodeURIComponent(remotePath)}`,
                        {
                            method: 'POST',
                            body: formData,
                            signal: this.uploadAbortController.signal
                        }
                    );

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`);
                    }

                    result = await response.json();
                }

                // Check for errors in result
                if (result.error) {
                    throw new Error(result.error);
                }

                progressPercent.textContent = '100%';
                progressBar.style.width = '100%';

                const fileSizeStr = window.fileTransferProxy
                    ? window.fileTransferProxy.formatFileSize(file.size)
                    : (file.size > 1024 * 1024
                        ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                        : `${(file.size / 1024).toFixed(1)} KB`);

                this.onToast('success', 'Upload Complete', `${file.name} (${fileSizeStr}) uploaded successfully`);

                // Send notification to owner for remote sessions
                this.sendFileSystemNotification('write', {
                    path: remotePath,
                    name: file.name
                });

            } catch (error) {
                // Check if upload was cancelled
                if (error.name === 'AbortError') {
                    console.log('[FileExplorer] Upload cancelled by user');
                    // Don't show error toast for user-initiated cancellation
                    break; // Stop processing remaining files
                }

                console.error('[FileExplorer] Upload error:', error);
                this.onToast('error', 'Upload Failed', `${file.name}: ${error.message}`);
            } finally {
                // Clean up abort controller
                this.uploadAbortController = null;
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
     * Upload file in chunks for large file support
     * @param {File} file - File to upload
     * @param {string} remotePath - Destination path on remote system
     * @param {Function} progressCallback - Called with progress percentage (0-100)
     * @returns {Promise<object>} Upload result
     */
    async uploadFileChunked(file, remotePath, progressCallback) {
        const CHUNK_SIZE = 64 * 1024; // 64KB chunks (safe for WebRTC DataChannel)
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        console.log(`[FileExplorer] Uploading ${file.name} in ${totalChunks} chunks (${CHUNK_SIZE} bytes each)`);

        try {
            // Step 1: Initialize upload on owner's side
            const initResult = await window.proxyFileSystemRequest(
                this.terminalSessionId,
                'upload-init',
                {
                    uploadId: uploadId,
                    fileName: file.name,
                    filePath: remotePath,
                    fileSize: file.size,
                    totalChunks: totalChunks,
                    chunkSize: CHUNK_SIZE
                }
            );

            if (!initResult.success) {
                throw new Error(initResult.error || 'Failed to initialize upload');
            }

            console.log('[FileExplorer] Upload initialized:', uploadId);

            // Step 2: Upload chunks sequentially
            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                const start = chunkIndex * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);

                // Read chunk as Base64
                const chunkData = await this.readChunkAsBase64(chunk);

                // Send chunk to owner
                const chunkResult = await window.proxyFileSystemRequest(
                    this.terminalSessionId,
                    'upload-chunk',
                    {
                        uploadId: uploadId,
                        chunkIndex: chunkIndex,
                        chunkData: chunkData,
                        chunkSize: chunk.size
                    }
                );

                if (!chunkResult.success) {
                    throw new Error(chunkResult.error || `Failed to upload chunk ${chunkIndex + 1}/${totalChunks}`);
                }

                // Update progress
                const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
                if (progressCallback) {
                    progressCallback(progress);
                }

                console.log(`[FileExplorer] Uploaded chunk ${chunkIndex + 1}/${totalChunks} (${progress}%)`);
            }

            // Step 3: Finalize upload (assemble chunks on owner's side)
            const finalizeResult = await window.proxyFileSystemRequest(
                this.terminalSessionId,
                'upload-finalize',
                {
                    uploadId: uploadId,
                    fileName: file.name,
                    filePath: remotePath
                }
            );

            if (!finalizeResult.success) {
                throw new Error(finalizeResult.error || 'Failed to finalize upload');
            }

            console.log('[FileExplorer] Upload finalized successfully');
            return finalizeResult;

        } catch (error) {
            // Cleanup on error
            try {
                await window.proxyFileSystemRequest(
                    this.terminalSessionId,
                    'upload-cancel',
                    { uploadId: uploadId }
                );
            } catch (cleanupError) {
                console.warn('[FileExplorer] Failed to cleanup after error:', cleanupError);
            }
            throw error;
        }
    }

    /**
     * Read file chunk as Base64
     * @param {Blob} chunk - File chunk to read
     * @returns {Promise<string>} Base64 encoded chunk
     */
    readChunkAsBase64(chunk) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(chunk);
        });
    }

    /**
     * Read file as Base64 for remote transmission (legacy - for small files)
     * @param {File} file - File to read
     * @returns {Promise<string>} Base64 encoded file content
     */
    readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Remove data URL prefix (e.g., "data:image/png;base64,")
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
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

        const sure = await AppDialog.ask({
            title: this.selectedFile.isDirectory ? 'Delete this folder?' : 'Delete this file?',
            body: confirmMsg, confirmLabel: 'Delete', danger: true
        });
        if (!sure) return;

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
        const name = await AppDialog.askFor('Name for the new file', 'new-file.txt', { title: 'New file' });
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
        const name = await AppDialog.askFor('Name for the new folder', 'new-folder', { title: 'New folder' });
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

        const newName = await AppDialog.askFor('New name', this.selectedFile.name, { title: 'Rename' });
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

            const props = `
Name: ${info.name}
Path: ${info.path}
Type: ${info.isDirectory ? 'Directory' : 'File'}
Size: ${this.formatSize(info.size)}
Permissions: ${info.permissions} (${info.permissionsOctal})
Modified: ${this.formatDate(info.mtime)}
Accessed: ${this.formatDate(info.atime)}
            `.trim();

            AppDialog.tell(props, { title: info.name });

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

        // Menu semantics + keyboard focus (shared helper from terminal.js).
        if (typeof window.wireContextMenuA11y === 'function') {
            window.wireContextMenuA11y(this.contextMenu);
        }
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
                <div class="sftp-empty-icon"><svg class="icon icon--lg" aria-hidden="true"><use href="#i-alert-circle"></use></svg></div>
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
        // Neutral sprite icons (shared site icon set) instead of per-type emoji
        const svg = (name) => `<svg class="icon icon--sm" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
        if (file.isDirectory) return svg('inbox');
        if (file.isLink) return svg('external');

        const type = file.type || 'file';
        if (type === 'folder') return svg('inbox');
        if (type === 'document' || type === 'text') return svg('book');
        return svg('code');
    }

    /**
     * Filter files by name (highlights matching files)
     */
    filterFiles(query) {
        if (!this.fileList) return;

        query = query.trim().toLowerCase();
        const fileItems = this.fileList.querySelectorAll('.sftp-file-item');

        fileItems.forEach(item => {
            const filename = item.querySelector('.sftp-file-name')?.textContent.toLowerCase() || '';

            if (!query) {
                // No filter - show all files normally
                item.style.display = '';
                item.classList.remove('filtered-match');
            } else if (filename.includes(query)) {
                // Match - highlight it
                item.style.display = '';
                item.classList.add('filtered-match');
            } else {
                // No match - dim it but keep visible
                item.style.display = '';
                item.classList.remove('filtered-match');
                item.style.opacity = '0.3';
            }
        });

        // Show clear button if filter is active
        const clearBtn = this.panel.querySelector('.sftp-filter-clear');
        if (clearBtn) {
            clearBtn.style.display = query ? 'flex' : 'none';
        }
    }

    /**
     * Clear file filter
     */
    clearFilter() {
        const filterInput = this.panel.querySelector('#sftpFilterInput');
        if (filterInput) {
            filterInput.value = '';
        }

        // Reset all file items
        const fileItems = this.fileList.querySelectorAll('.sftp-file-item');
        fileItems.forEach(item => {
            item.style.display = '';
            item.style.opacity = '';
            item.classList.remove('filtered-match');
        });

        // Hide clear button
        const clearBtn = this.panel.querySelector('.sftp-filter-clear');
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }
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



