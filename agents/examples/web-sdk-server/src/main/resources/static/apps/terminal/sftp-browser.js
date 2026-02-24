/**
 * SFTP File Browser Component
 * MobaXterm-style SFTP panel for SSH connections
 */

class SftpBrowser {
    constructor(options = {}) {
        this.mlsUrl = options.mlsUrl || 'http://localhost:8088';
        this.terminalSessionId = null;
        this.sftpSessionId = null;
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
                    <span>SFTP Browser</span>
                    <span id="sftpConnectionName" style="font-weight: normal; color: var(--text-muted);"></span>
                </div>
                <div class="sftp-header-close" onclick="sftpBrowser.close()" title="Close">✕</div>
            </div>

            <div class="sftp-toolbar">
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.goUp()" title="Go Up (Parent Directory)">
                    <span>⬆️</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.goHome()" title="Go Home">
                    <span>🏠</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.refresh()" title="Refresh">
                    <span>🔄</span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.createNewFile()" title="New File">
                    <span>📄</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.createNewFolder()" title="New Folder">
                    <span>📁</span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.uploadFile()" title="Upload File">
                    <span>⬆️</span>
                    <span class="label">Upload</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.downloadSelected()" title="Download Selected">
                    <span>⬇️</span>
                    <span class="label">Download</span>
                </button>
                <div class="sftp-toolbar-separator"></div>
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.editSelected()" title="Edit File">
                    <span>✏️</span>
                </button>
                <button class="sftp-toolbar-btn" onclick="sftpBrowser.deleteSelected()" title="Delete Selected">
                    <span>🗑️</span>
                </button>
            </div>

            <div class="sftp-path-bar">
                <input type="text" id="sftpPathInput" placeholder="/path/to/directory" onkeypress="if(event.key==='Enter') sftpBrowser.navigateTo(this.value)">
                <button class="sftp-path-go-btn" onclick="sftpBrowser.navigateTo(document.getElementById('sftpPathInput').value)">Go</button>
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
            <input type="file" id="sftpFileUpload" style="display: none" multiple onchange="sftpBrowser.handleFileUpload(this.files)">

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
            <div class="sftp-context-menu-item" onclick="sftpBrowser.openSelected()">
                <span class="icon">📂</span> Open
            </div>
            <div class="sftp-context-menu-item" onclick="sftpBrowser.editSelected()">
                <span class="icon">✏️</span> Edit
            </div>
            <div class="sftp-context-menu-item" onclick="sftpBrowser.downloadSelected()">
                <span class="icon">⬇️</span> Download
            </div>
            <div class="sftp-context-menu-separator"></div>
            <div class="sftp-context-menu-item" onclick="sftpBrowser.renameSelected()">
                <span class="icon">📝</span> Rename
            </div>
            <div class="sftp-context-menu-item" onclick="sftpBrowser.copyPath()">
                <span class="icon">📋</span> Copy Path
            </div>
            <div class="sftp-context-menu-item" onclick="sftpBrowser.showProperties()">
                <span class="icon">ℹ️</span> Properties
            </div>
            <div class="sftp-context-menu-separator"></div>
            <div class="sftp-context-menu-item danger" onclick="sftpBrowser.deleteSelected()">
                <span class="icon">🗑️</span> Delete
            </div>
        `;

        // Create editor modal
        this.editorOverlay = document.createElement('div');
        this.editorOverlay.className = 'sftp-editor-overlay';
        this.editorOverlay.id = 'sftpEditorOverlay';
        this.editorOverlay.innerHTML = `
            <div class="sftp-editor-modal">
                <div class="sftp-editor-header">
                    <div class="sftp-editor-title">
                        <span>📝</span>
                        <span id="sftpEditorFileName">file.txt</span>
                        <span class="sftp-editor-title-path" id="sftpEditorFilePath">/path/to/file.txt</span>
                    </div>
                    <div class="sftp-editor-actions">
                        <button class="sftp-editor-btn secondary" onclick="sftpBrowser.closeEditor()">Cancel</button>
                        <button class="sftp-editor-btn primary" onclick="sftpBrowser.saveFile()">
                            💾 Save
                        </button>
                    </div>
                </div>
                <div class="sftp-editor-body">
                    <textarea class="sftp-editor-textarea" id="sftpEditorContent" spellcheck="false"></textarea>
                </div>
                <div class="sftp-editor-status">
                    <span id="sftpEditorStatus">Ready</span>
                    <span id="sftpEditorCursor">Line 1, Column 1</span>
                </div>
            </div>
        `;

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

        // Editor cursor position tracking
        const editorContent = this.editorOverlay.querySelector('#sftpEditorContent');
        editorContent.addEventListener('keyup', () => this.updateEditorCursor());
        editorContent.addEventListener('click', () => this.updateEditorCursor());
        editorContent.addEventListener('input', () => {
            this.editorOverlay.querySelector('#sftpEditorStatus').textContent = 'Modified';
            this.editorOverlay.querySelector('#sftpEditorStatus').classList.add('modified');
        });

        // Tab key handling in editor
        editorContent.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editorContent.selectionStart;
                const end = editorContent.selectionEnd;
                editorContent.value = editorContent.value.substring(0, start) + '    ' + editorContent.value.substring(end);
                editorContent.selectionStart = editorContent.selectionEnd = start + 4;
            }
        });
    }

    /**
     * Append elements to the document
     */
    mount(container) {
        container.appendChild(this.panel);
        document.body.appendChild(this.contextMenu);
        document.body.appendChild(this.editorOverlay);
    }

    /**
     * Open SFTP panel for a terminal session
     */
    async open(terminalSessionId, connectionInfo = {}) {
        // Save current session's path before switching
        if (this.terminalSessionId && this.isConnected) {
            this.sessionCache.set(this.terminalSessionId, {
                sftpSessionId: this.sftpSessionId,
                lastPath: this.currentPath,
                connectionInfo: this.connectionInfo
            });
            // Also persist to localStorage
            try {
                localStorage.setItem(`sftp_last_path_${this.terminalSessionId}`, this.currentPath);
            } catch (e) { /* ignore */ }
        }

        // Check if we have a cached session for this terminal
        const cached = this.sessionCache.get(terminalSessionId);

        this.terminalSessionId = terminalSessionId;
        this.connectionInfo = connectionInfo;
        this.panel.classList.add('visible');

        // Update header with connection name
        const connName = this.panel.querySelector('#sftpConnectionName');
        if (connectionInfo.name) {
            connName.textContent = `- ${connectionInfo.name}`;
        }

        if (cached && cached.sftpSessionId) {
            // Restore cached session
            this.sftpSessionId = cached.sftpSessionId;
            this.currentPath = cached.lastPath || '/';
            this.isConnected = true;
            this.updateConnectionStatus('Connected');
            this.updatePathBar();
            await this.loadDirectory(this.currentPath);
        } else {
            // Restore last path from localStorage if available
            try {
                const savedPath = localStorage.getItem(`sftp_last_path_${terminalSessionId}`);
                if (savedPath) {
                    this._initialPath = savedPath;
                }
            } catch (e) { /* ignore */ }

            await this.connect();
        }
    }

    /**
     * Connect to SFTP
     */
    async connect() {
        try {
            this.showLoading('Connecting to SFTP...');

            const response = await fetch(`${this.mlsUrl}/sftp/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.terminalSessionId })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            this.sftpSessionId = result.sessionId || this.terminalSessionId;
            this.currentPath = result.currentDir || '/';
            this.isConnected = true;

            this.updateConnectionStatus('Connected');
            this.updatePathBar();

            // Navigate to saved last path if available
            const initialPath = this._initialPath;
            this._initialPath = null;  // Clear after use
            if (initialPath && initialPath !== this.currentPath) {
                await this.loadDirectory(initialPath);
            } else {
                await this.loadDirectory();
            }

            this.onToast('success', 'SFTP Connected', `Connected to ${this.connectionInfo.host || 'server'}`);

        } catch (error) {
            console.error('[SFTP] Connection error:', error);
            this.showError('Connection failed: ' + error.message);
            this.updateConnectionStatus('Disconnected');
            this.onToast('error', 'SFTP Error', error.message);
        }
    }

    /**
     * Close SFTP panel
     */
    async close() {
        // ✅ Save last path before closing
        if (this.terminalSessionId && this.currentPath) {
            this.sessionCache.set(this.terminalSessionId, {
                sftpSessionId: null,  // Session will be closed
                lastPath: this.currentPath,
                connectionInfo: this.connectionInfo
            });
            try {
                localStorage.setItem(`sftp_last_path_${this.terminalSessionId}`, this.currentPath);
            } catch (e) { /* ignore */ }
        }

        if (this.isConnected && this.sftpSessionId) {
            try {
                await fetch(`${this.mlsUrl}/sftp/close`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: this.sftpSessionId })
                });
            } catch (e) {
                console.error('[SFTP] Error closing:', e);
            }
        }

        this.isConnected = false;
        this.sftpSessionId = null;
        this.terminalSessionId = null;
        this.files = [];
        this.selectedFile = null;
        this.panel.classList.remove('visible');
        this.updateConnectionStatus('Disconnected');
    }

    /**
     * Load directory contents
     */
    async loadDirectory(path = null) {
        if (!this.isConnected) return;

        const targetPath = path || this.currentPath;
        const previousPath = this.currentPath; // Save previous path for recovery

        try {
            this.showLoading('Loading...');

            const response = await fetch(
                `${this.mlsUrl}/sftp/list?sessionId=${encodeURIComponent(this.sftpSessionId)}&path=${encodeURIComponent(targetPath)}`
            );

            const result = await response.json();

            console.log('[SFTP] Backend response:', JSON.stringify(result, null, 2));
            console.log('[SFTP] Requested path:', targetPath);
            console.log('[SFTP] Backend currentDir:', result.currentDir);

            if (result.error) {
                throw new Error(result.error);
            }

            this.files = result.files || [];

            // Use backend's currentDir since it now accurately reflects the navigation
            // Backend changes directory before returning currentDir
            this.currentPath = result.currentDir || targetPath;

            console.log('[SFTP] Successfully loaded - targetPath:', targetPath, '- currentDir from backend:', result.currentDir, '- final currentPath:', this.currentPath);

            // ALWAYS update path input to show current directory
            this.updatePathBar();

            this.renderFileList();

            // ✅ Save last navigated path for session persistence
            if (this.terminalSessionId) {
                try {
                    localStorage.setItem(`sftp_last_path_${this.terminalSessionId}`, this.currentPath);
                } catch (e) { /* ignore */ }
                // Also update session cache
                this.sessionCache.set(this.terminalSessionId, {
                    sftpSessionId: this.sftpSessionId,
                    lastPath: this.currentPath,
                    connectionInfo: this.connectionInfo
                });
            }

        } catch (error) {
            console.error('[SFTP] Load directory error:', error);
            const errorMsg = error.message || 'Unknown error';
            this.showError(`Cannot access "${targetPath}": ${errorMsg}`);

            // Restore previous path (don't let backend change our path on error)
            this.currentPath = previousPath;

            // Re-throw so navigateTo can handle it
            throw error;
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
                     ondblclick="sftpBrowser.handleDoubleClick(${index}, event)"
                     onclick="sftpBrowser.selectFile(${index})"
                     oncontextmenu="sftpBrowser.showContextMenu(event, ${index})">
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
     */
    async navigateTo(path) {
        if (!path || path.trim() === '') {
            this.onToast('warning', 'Invalid Path', 'Please enter a valid path');
            return;
        }

        // Trim whitespace
        path = path.trim();

        console.log('[SFTP] Navigating to:', path);

        try {
            await this.loadDirectory(path);
            // Force update path bar after successful navigation
            setTimeout(() => {
                this.updatePathBar();
            }, 50);
        } catch (error) {
            console.error('[SFTP] Navigation failed:', error);
            this.onToast('error', 'Navigation Failed', error.message || 'Failed to navigate to path');

            // Path was already restored in loadDirectory, force update UI
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
        // Get home directory from backend instead of using '~'
        try {
            const response = await fetch(
                `${this.mlsUrl}/sftp/home?sessionId=${encodeURIComponent(this.sftpSessionId)}`
            );
            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            const homePath = result.homePath || '/root';
            console.log('[SFTP] Home directory:', homePath);
            await this.navigateTo(homePath);
        } catch (error) {
            console.warn('[SFTP] Could not get home directory, trying /root:', error);
            // Fallback to /root
            await this.navigateTo('/root');
        }
    }

    /**
     * Refresh current directory
     */
    async refresh() {
        await this.loadDirectory();
        this.onToast('info', 'Refreshed', 'Directory listing refreshed');
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
    async editFile(path) {
        if (!this.isConnected) return;

        try {
            const response = await fetch(
                `${this.mlsUrl}/sftp/file?sessionId=${encodeURIComponent(this.sftpSessionId)}&path=${encodeURIComponent(path)}`
            );

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            // Open editor
            const fileName = path.split('/').pop();
            this.editorOverlay.querySelector('#sftpEditorFileName').textContent = fileName;
            this.editorOverlay.querySelector('#sftpEditorFilePath').textContent = path;
            this.editorOverlay.querySelector('#sftpEditorContent').value = result.content;
            this.editorOverlay.querySelector('#sftpEditorStatus').textContent = 'Ready';
            this.editorOverlay.querySelector('#sftpEditorStatus').classList.remove('modified');

            this.editorOverlay.dataset.filePath = path;
            this.editorOverlay.classList.add('visible');

            // Focus editor
            setTimeout(() => {
                this.editorOverlay.querySelector('#sftpEditorContent').focus();
            }, 100);

        } catch (error) {
            console.error('[SFTP] Edit file error:', error);
            this.onToast('error', 'Error', error.message);
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

    /**
     * Save file from editor
     */
    async saveFile() {
        const path = this.editorOverlay.dataset.filePath;
        const content = this.editorOverlay.querySelector('#sftpEditorContent').value;

        try {
            const response = await fetch(`${this.mlsUrl}/sftp/file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sftpSessionId,
                    path: path,
                    content: content
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            this.editorOverlay.querySelector('#sftpEditorStatus').textContent = 'Saved';
            this.editorOverlay.querySelector('#sftpEditorStatus').classList.remove('modified');

            this.onToast('success', 'File Saved', `${path.split('/').pop()} saved successfully`);

        } catch (error) {
            console.error('[SFTP] Save file error:', error);
            this.onToast('error', 'Save Failed', error.message);
        }
    }

    /**
     * Close editor
     */
    closeEditor() {
        const status = this.editorOverlay.querySelector('#sftpEditorStatus');
        if (status.classList.contains('modified')) {
            if (!confirm('You have unsaved changes. Close anyway?')) {
                return;
            }
        }
        this.editorOverlay.classList.remove('visible');
    }

    /**
     * Download selected file
     */
    downloadSelected() {
        if (!this.selectedFile || this.selectedFile.isDirectory) {
            this.onToast('warning', 'No Selection', 'Please select a file to download');
            return;
        }

        const url = `${this.mlsUrl}/sftp/download?sessionId=${encodeURIComponent(this.sftpSessionId)}&path=${encodeURIComponent(this.selectedFile.path)}`;

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
                    `${this.mlsUrl}/sftp/upload?sessionId=${encodeURIComponent(this.sftpSessionId)}&path=${encodeURIComponent(remotePath)}`,
                    {
                        method: 'POST',
                        body: formData
                    }
                );

                const result = await response.json();

                if (result.error) {
                    throw new Error(result.error);
                }

                progressPercent.textContent = '100%';
                progressBar.style.width = '100%';

                this.onToast('success', 'Upload Complete', `${file.name} uploaded successfully`);

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
            const response = await fetch(`${this.mlsUrl}/sftp/delete`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sftpSessionId,
                    path: this.selectedFile.path,
                    isDirectory: this.selectedFile.isDirectory
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            this.onToast('success', 'Deleted', `${this.selectedFile.name} deleted`);
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
            const response = await fetch(`${this.mlsUrl}/sftp/create-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sftpSessionId,
                    path: path
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            this.onToast('success', 'File Created', `${name} created`);
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
            const response = await fetch(`${this.mlsUrl}/sftp/mkdir`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sftpSessionId,
                    path: path
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            this.onToast('success', 'Folder Created', `${name} created`);
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
            const response = await fetch(`${this.mlsUrl}/sftp/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sftpSessionId,
                    oldPath: oldPath,
                    newPath: newPath
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            this.onToast('success', 'Renamed', `Renamed to ${newName}`);
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
            const response = await fetch(
                `${this.mlsUrl}/sftp/info?sessionId=${encodeURIComponent(this.sftpSessionId)}&path=${encodeURIComponent(this.selectedFile.path)}`
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
     */
    updatePathBar() {
        // Get fresh reference in case DOM changed
        const pathInput = this.panel.querySelector('#sftpPathInput');
        if (pathInput) {
            console.log('[SFTP] Updating path bar - currentPath:', this.currentPath, '- pathInput.value before:', pathInput.value);
            pathInput.value = this.currentPath;
            console.log('[SFTP] Path bar updated - pathInput.value after:', pathInput.value);
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
    module.exports = SftpBrowser;
}

