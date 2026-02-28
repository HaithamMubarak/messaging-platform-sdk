/**
 * File Editor Component - Multi-Tab File Editor
 * Supports both popup and pinned modes with multiple file tabs
 * Each tab is associated with a terminal session and file path
 */

class FileEditor {
    constructor(options = {}) {
        this.mlsUrl = options.mlsUrl || 'http://localhost:8088';
        this.mode = 'popup';  // 'popup' or 'pinned'
        this.tabs = [];  // Array of open file tabs
        this.activeTabId = null;
        this.autoSaveTimeouts = new Map();  // Per-tab auto-save timers
        this.onToast = options.onToast || (() => {});
        this.theme = options.theme || 'dark';  // 'dark' or 'light'

        // CodeMirror editors
        this.editorPopup = null;
        this.editorPinned = null;

        // Create UI elements
        this.createPopupEditor();
        this.createPinnedEditor();
        this.initializeCodeMirror();
        this.attachEventListeners();
        this.applyTheme();
    }

    /**
     * Set editor theme (dark or light)
     */
    setTheme(theme) {
        this.theme = theme;
        this.applyTheme();

        // Update CodeMirror theme
        const cmTheme = theme === 'light' ? 'default' : 'monokai';
        if (this.editorPopup) {
            this.editorPopup.setOption('theme', cmTheme);
        }
        if (this.editorPinned) {
            this.editorPinned.setOption('theme', cmTheme);
        }
    }

    /**
     * Apply theme classes to editor elements
     */
    applyTheme() {
        const themeClass = this.theme === 'light' ? 'theme-light' : '';

        if (this.popupOverlay) {
            this.popupOverlay.className = `file-editor-overlay ${themeClass}`;
        }
        if (this.pinnedPanel) {
            this.pinnedPanel.className = `file-editor-pinned ${themeClass}`;
        }
    }

    /**
     * Create popup modal editor with tab bar
     */
    createPopupEditor() {
        this.popupOverlay = document.createElement('div');
        this.popupOverlay.className = 'file-editor-overlay';
        this.popupOverlay.id = 'fileEditorOverlay';
        this.popupOverlay.innerHTML = `
            <div class="file-editor-modal">
                <div class="file-editor-header">
                    <div class="file-editor-actions">
                        <button class="file-editor-btn secondary small" onclick="fileEditor.saveAllFiles()" title="Save all files">
                            💾 Save All
                        </button>
                        <button class="file-editor-btn secondary small" onclick="fileEditor.pinToSide()" title="Pin to right side">
                            📌 Pin
                        </button>
                        <button class="file-editor-btn secondary small" onclick="fileEditor.close()">
                            ✕ Close
                        </button>
                    </div>
                    <div class="file-editor-tabs" id="fileEditorTabs">
                        <!-- Tabs will be added here -->
                    </div>
                </div>
                <div class="file-editor-body">
                    <div class="file-editor-codemirror" id="fileEditorContent"></div>
                </div>
                <div class="file-editor-footer">
                    <div class="file-editor-status-left">
                        <span class="file-editor-status" id="fileEditorStatus">Ready</span>
                        <span class="file-editor-path" id="fileEditorPath"></span>
                    </div>
                    <div class="file-editor-status-right">
                        <span id="fileEditorCursor">Line 1, Col 1</span>
                        <span id="fileEditorEncoding">UTF-8</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.popupOverlay);
    }

    /**
     * Create pinned side panel editor with tab bar
     */
    createPinnedEditor() {
        this.pinnedPanel = document.createElement('div');
        this.pinnedPanel.className = 'file-editor-pinned';
        this.pinnedPanel.id = 'fileEditorPinned';
        this.pinnedPanel.innerHTML = `
        <div class="file-editor-resizer" id="fileEditorResizer"></div>
        <div class="file-editor-pinned-content">
            <div class="file-editor-header">
                <div class="file-editor-actions">
                    <button class="file-editor-btn secondary small" onclick="fileEditor.saveAllFiles()" title="Save all">
                        💾
                    </button>
                    <button class="file-editor-btn secondary small" onclick="fileEditor.unpinToPopup()" title="Unpin to popup">
                        ⬅️
                    </button>
                    <button class="file-editor-btn secondary small" onclick="fileEditor.close()">
                        ✕
                    </button>
                </div>
                <div class="file-editor-tabs" id="fileEditorTabsPinned">
                    <!-- Tabs will be added here -->
                </div>
            </div>
            <div class="file-editor-body">
                <div class="file-editor-codemirror" id="fileEditorContentPinned"></div>
            </div>
                <div class="file-editor-footer">
                    <div class="file-editor-status-left">
                        <span class="file-editor-status" id="fileEditorStatusPinned">Ready</span>
                        <span class="file-editor-path" id="fileEditorPathPinned"></span>
                    </div>
                    <div class="file-editor-status-right">
                        <span id="fileEditorCursorPinned">Line 1, Col 1</span>
                        <span id="fileEditorEncodingPinned">UTF-8</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.pinnedPanel);
    }

    /**
     * Initialize CodeMirror editors
     */
    initializeCodeMirror() {
        // Wait for CodeMirror to be available
        if (typeof CodeMirror === 'undefined') {
            console.warn('[FileEditor] CodeMirror not loaded, using fallback');
            return;
        }

        // Initialize popup editor
        const containerPopup = document.getElementById('fileEditorContent');
        this.editorPopup = CodeMirror(containerPopup, {
            lineNumbers: true,
            theme: 'monokai',
            indentUnit: 4,
            tabSize: 4,
            lineWrapping: false,
            mode: 'text/plain',
            matchBrackets: true,
            autoCloseBrackets: true,
            styleActiveLine: true,
            highlightSelectionMatches: { showToken: /\w/, annotateScrollbar: true }
        });

        // Initialize pinned editor
        const containerPinned = document.getElementById('fileEditorContentPinned');
        this.editorPinned = CodeMirror(containerPinned, {
            lineNumbers: true,
            theme: 'monokai',
            indentUnit: 4,
            tabSize: 4,
            lineWrapping: false,
            mode: 'text/plain',
            matchBrackets: true,
            autoCloseBrackets: true,
            styleActiveLine: true,
            highlightSelectionMatches: { showToken: /\w/, annotateScrollbar: true }
        });
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // If CodeMirror is available, setup change listeners
        if (this.editorPopup) {
            this.editorPopup.on('change', () => {
                if (!this.activeTabId) return;
                this.markTabAsModified(this.activeTabId);

                // Auto-save only for notes (not regular files)
                const tab = this.tabs.find(t => t.id === this.activeTabId);
                if (tab && tab.terminalId === 'notes') {
                    // Debounced auto-save for notes only
                    if (this.autoSaveTimeouts.has(this.activeTabId)) {
                        clearTimeout(this.autoSaveTimeouts.get(this.activeTabId));
                    }
                    const timeout = setTimeout(() => {
                        this.saveFile(this.activeTabId, true);
                    }, 2000);
                    this.autoSaveTimeouts.set(this.activeTabId, timeout);
                }
            });

            this.editorPopup.on('cursorActivity', () => {
                this.updateCursorPosition(this.editorPopup, 'fileEditorCursor');
            });

            // Add Ctrl+S keyboard shortcut for quick save
            this.editorPopup.on('keydown', (cm, event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                    event.preventDefault();
                    if (this.activeTabId) {
                        this.saveFile(this.activeTabId, false);
                    }
                }
            });
        }

        if (this.editorPinned) {
            this.editorPinned.on('change', () => {
                if (!this.activeTabId) return;
                this.markTabAsModified(this.activeTabId);

                // Auto-save only for notes (not regular files)
                const tab = this.tabs.find(t => t.id === this.activeTabId);
                if (tab && tab.terminalId === 'notes') {
                    // Debounced auto-save for notes only
                    if (this.autoSaveTimeouts.has(this.activeTabId)) {
                        clearTimeout(this.autoSaveTimeouts.get(this.activeTabId));
                    }
                    const timeout = setTimeout(() => {
                        this.saveFile(this.activeTabId, true);
                    }, 2000);
                    this.autoSaveTimeouts.set(this.activeTabId, timeout);
                }
            });

            this.editorPinned.on('cursorActivity', () => {
                this.updateCursorPosition(this.editorPinned, 'fileEditorCursorPinned');
            });

            // Add Ctrl+S keyboard shortcut for quick save
            this.editorPinned.on('keydown', (cm, event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                    event.preventDefault();
                    if (this.activeTabId) {
                        this.saveFile(this.activeTabId, false);
                    }
                }
            });
        }

        // ...existing code...        // Resize functionality for pinned mode
        this.setupResizer();

        // ESC key to close (popup mode only)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.tabs.length > 0 && this.mode === 'popup') {
                this.close();
            }
        });
    }

    /**
     * Setup resizer for pinned mode
     */
    setupResizer() {
        const resizer = document.getElementById('fileEditorResizer');
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = this.pinnedPanel.offsetWidth;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const delta = startX - e.clientX;
            const newWidth = startWidth + delta;
            const minWidth = 400;
            const maxWidth = window.innerWidth * 0.7;

            if (newWidth >= minWidth && newWidth <= maxWidth) {
                this.pinnedPanel.style.width = newWidth + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    /**
     * Open a file in a new tab or switch to existing tab
     */
    async openFile(terminalSessionId, terminalSessionName, filePath) {
        try {
            // Check if file is already open
            const existingTab = this.tabs.find(t =>
                t.terminalId === terminalSessionId && t.filePath === filePath
            );

            if (existingTab) {
                // Switch to existing tab
                this.switchTab(existingTab.id);
                return;
            }

            // For notes, extract the noteId from the path format: note://{title}/{noteId}
            // Backend expects: note://{noteId}
            let backendPath = filePath;
            if (filePath.startsWith('note://')) {
                const parts = filePath.substring(7).split('/'); // Remove 'note://' and split
                if (parts.length === 2) {
                    // Format is note://{title}/{noteId}, extract noteId for backend
                    const noteId = parts[1];
                    backendPath = `note://${noteId}`;
                }
            }

            // Fetch file content from backend
            const response = await fetch(
                `${this.mlsUrl}/filesystem/${encodeURIComponent(terminalSessionId)}/read?path=${encodeURIComponent(backendPath)}`
            );

            if (!response.ok) {
                throw new Error('Failed to load file');
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.message || 'Failed to load file');
            }

            // Create new tab
            const tabId = `${terminalSessionId}:${filePath}:${Date.now()}`;
            const tab = {
                id: tabId,
                terminalId: terminalSessionId,
                terminalName: terminalSessionName,
                filePath: filePath,  // Keep display path with title
                backendPath: backendPath,  // Store backend path for saving
                content: result.content || '',
                modified: false,
                readOnly: false
            };

            console.log('[FileEditor] Opened tab:', tab, new Error());

            this.tabs.push(tab);
            this.activeTabId = tabId;

            // Show editor and update UI
            this.showEditor();
            this.renderTabs();
            this.loadTabContent(tabId);

            this.onToast('success', '📁 File Opened', this.getFileName(filePath));

        } catch (error) {
            console.error('[FileEditor] Failed to open file:', error);
            this.onToast('error', 'Open Failed', error.message);
        }
    }

    /**
     * Show editor (popup or pinned based on mode)
     */
    showEditor() {
        if (this.mode === 'popup') {
            this.popupOverlay.classList.add('visible');
        } else {
            this.pinnedPanel.classList.add('visible');
        }
    }

    /**
     * Hide editor
     */
    hideEditor() {
        this.popupOverlay.classList.remove('visible');
        this.pinnedPanel.classList.remove('visible');
    }

    /**
     * Render all tabs in tab bar
     * ✅ FULL RE-RENDER: Only call when tabs added/removed/modified status changes
     */
    renderTabs() {
        const tabBarPopup = document.getElementById('fileEditorTabs');
        const tabBarPinned = document.getElementById('fileEditorTabsPinned');

        const tabsHTML = this.tabs.map(tab => {
            const fileName = this.getFileName(tab.filePath);
            const isActive = tab.id === this.activeTabId;
            const modifiedMarker = tab.modified ? ' *' : '';

            // Create tooltip with full file information
            const tooltipInfo = [
                `File: ${fileName}`,
                `Path: ${tab.filePath}`,
                `Session: ${tab.terminalName}`,
                `Status: ${tab.modified ? 'Modified' : 'Saved'}`
            ].join('\n');

            return `
                <div class="file-editor-tab ${isActive ? 'active' : ''}" 
                     data-tab-id="${tab.id}"
                     title="${this.escapeHtml(tooltipInfo)}"
                     onclick="fileEditor.switchTab('${tab.id}')">
                    <div class="file-editor-tab-content">
                        <div class="file-editor-tab-session">[${this.escapeHtml(tab.terminalName)}]</div>
                        <div class="file-editor-tab-name">${this.escapeHtml(fileName)}${modifiedMarker}</div>
                    </div>
                    <span class="file-editor-tab-close" onclick="event.stopPropagation(); fileEditor.closeTab('${tab.id}')">✕</span>
                </div>
            `;
        }).join('');

        tabBarPopup.innerHTML = tabsHTML;
        tabBarPinned.innerHTML = tabsHTML;
    }

    /**
     * Update tab active states without full re-render
     * ✅ NO BLINKING: Just changes CSS classes
     */
    updateTabActiveStates() {
        // Update both popup and pinned tab bars
        [document.getElementById('fileEditorTabs'), document.getElementById('fileEditorTabsPinned')].forEach(tabBar => {
            if (!tabBar) return;

            // Remove active class from all tabs
            tabBar.querySelectorAll('.file-editor-tab').forEach(tabEl => {
                tabEl.classList.remove('active');
            });

            // Add active class to current tab
            const activeTabEl = tabBar.querySelector(`[data-tab-id="${this.activeTabId}"]`);
            if (activeTabEl) {
                activeTabEl.classList.add('active');
            }
        });
    }

    /**
     * Switch to a specific tab
     */
    switchTab(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        // Save current tab content before switching
        if (this.activeTabId) {
            this.saveCurrentContent();
        }

        this.activeTabId = tabId;
        this.loadTabContent(tabId);

        // ✅ FIX: Just update active states, don't re-render (prevents blinking!)
        this.updateTabActiveStates();
    }

    /**
     * Load tab content into editor
     */
    loadTabContent(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        const pathPopup = document.getElementById('fileEditorPath');
        const pathPinned = document.getElementById('fileEditorPathPinned');
        const statusPopup = document.getElementById('fileEditorStatus');
        const statusPinned = document.getElementById('fileEditorStatusPinned');

        // Set path
        pathPopup.textContent = tab.filePath;
        pathPinned.textContent = tab.filePath;

        // Detect file type and get CodeMirror mode
        const mode = this.getCodeMirrorMode(tab.filePath);

        // Set content and mode in CodeMirror
        if (this.editorPopup) {
            this.editorPopup.setValue(tab.content);
            this.editorPopup.setOption('mode', mode);
        }
        if (this.editorPinned) {
            this.editorPinned.setValue(tab.content);
            this.editorPinned.setOption('mode', mode);
        }

        // Set status
        const status = tab.modified ? 'Modified' : 'Ready';
        statusPopup.textContent = status;
        statusPinned.textContent = status;

        // Focus editor
        setTimeout(() => {
            if (this.mode === 'popup' && this.editorPopup) {
                this.editorPopup.focus();
            } else if (this.editorPinned) {
                this.editorPinned.focus();
            }
        }, 100);
    }

    /**
     * Save current content to tab object
     */
    saveCurrentContent() {
        if (!this.activeTabId) return;

        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (!tab) return;

        // Get content from CodeMirror
        const editor = this.mode === 'popup' ? this.editorPopup : this.editorPinned;
        if (editor) {
            tab.content = editor.getValue();
        }
    }

    /**
     * Close a specific tab
     */
    async closeTab(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        // Check if modified
        if (tab.modified) {
            const shouldSave = confirm(`Save changes to ${this.getFileName(tab.filePath)}?`);
            if (shouldSave) {
                await this.saveFile(tabId);
            }
        }

        // Remove tab
        this.tabs = this.tabs.filter(t => t.id !== tabId);

        // Clear auto-save timeout
        if (this.autoSaveTimeouts.has(tabId)) {
            clearTimeout(this.autoSaveTimeouts.get(tabId));
            this.autoSaveTimeouts.delete(tabId);
        }

        // Switch to another tab or close editor
        if (this.tabs.length > 0) {
            if (this.activeTabId === tabId) {
                // Switch to last tab
                this.switchTab(this.tabs[this.tabs.length - 1].id);
            }
            this.renderTabs();
        } else {
            // No tabs left, close editor
            this.activeTabId = null;
            this.hideEditor();
        }
    }

    /**
     * Close all tabs for a terminal session
     */
    async closeSessionTabs(terminalSessionId) {
        const sessionTabs = this.tabs.filter(t => t.terminalId === terminalSessionId);

        for (const tab of sessionTabs) {
            await this.closeTab(tab.id);
        }
    }

    /**
     * Mark tab as modified (NO BLINKING - only updates modified marker)
     */
    markTabAsModified(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        // Skip if already marked as modified (prevent unnecessary updates)
        if (tab.modified) return;

        tab.modified = true;

        // Update only the specific tab's modified marker (NO FULL RE-RENDER)
        [document.getElementById('fileEditorTabs'), document.getElementById('fileEditorTabsPinned')].forEach(tabBar => {
            if (!tabBar) return;

            const tabEl = tabBar.querySelector(`[data-tab-id="${tabId}"]`);
            if (tabEl) {
                const tabNameEl = tabEl.querySelector('.file-editor-tab-name');
                if (tabNameEl && !tabNameEl.textContent.endsWith(' *')) {
                    tabNameEl.textContent += ' *';
                }
            }
        });

        const status = this.mode === 'popup'
            ? document.getElementById('fileEditorStatus')
            : document.getElementById('fileEditorStatusPinned');

        if (status) {
            status.textContent = 'Modified';
            status.classList.add('modified');
        }
    }

    /**
     * Save a specific file
     */
    async saveFile(tabId, isAutoSave = false) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        // Save current content to tab
        if (tab.id === this.activeTabId) {
            this.saveCurrentContent();
        }

        try {
            const status = this.mode === 'popup'
                ? document.getElementById('fileEditorStatus')
                : document.getElementById('fileEditorStatusPinned');

            status.textContent = 'Saving...';

            // For notes, use backendPath if available (contains noteId only)
            const pathToSave = tab.backendPath || tab.filePath;

            const response = await fetch(
                `${this.mlsUrl}/filesystem/${encodeURIComponent(tab.terminalId)}/write`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: pathToSave,
                        content: tab.content
                    })
                }
            );

            if (!response.ok) {
                throw new Error('Failed to save file');
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.message || 'Failed to save file');
            }

            // Mark as saved
            tab.modified = false;
            this.renderTabs();

            status.textContent = '💾 Saved';
            status.classList.remove('modified');
            status.classList.add('saved');

            setTimeout(() => {
                status.textContent = 'Ready';
                status.classList.remove('saved');
            }, 2000);

            if (!isAutoSave) {
                this.onToast('success', '💾 Saved', this.getFileName(tab.filePath));
            }

        } catch (error) {
            console.error('[FileEditor] Failed to save file:', error);

            const status = this.mode === 'popup'
                ? document.getElementById('fileEditorStatus')
                : document.getElementById('fileEditorStatusPinned');

            status.textContent = 'Save failed ✗';
            this.onToast('error', 'Save Failed', error.message);
        }
    }

    /**
     * Save current file (active tab)
     */
    async saveCurrentFile() {
        if (this.activeTabId) {
            await this.saveFile(this.activeTabId);
        }
    }

    /**
     * Save all modified files
     */
    async saveAllFiles() {
        const modifiedTabs = this.tabs.filter(t => t.modified);

        if (modifiedTabs.length === 0) {
            this.onToast('info', 'No Changes', 'All files are saved');
            return;
        }

        for (const tab of modifiedTabs) {
            await this.saveFile(tab.id);
        }

        this.onToast('success', '💾 Saved All', `${modifiedTabs.length} file(s) saved`);
    }

    /**
     * Pin to right side
     */
    pinToSide() {
        if (this.mode === 'pinned') return;

        // Save current content
        this.saveCurrentContent();

        // Switch mode
        this.mode = 'pinned';
        this.popupOverlay.classList.remove('visible');
        this.pinnedPanel.classList.add('visible');

        // Reload current tab
        if (this.activeTabId) {
            this.loadTabContent(this.activeTabId);
        }

        this.onToast('info', '📌 Pinned', 'Editor pinned to right side');
    }

    /**
     * Unpin back to popup
     */
    unpinToPopup() {
        if (this.mode === 'popup') return;

        // Save current content
        this.saveCurrentContent();

        // Switch mode
        this.mode = 'popup';
        this.pinnedPanel.classList.remove('visible');
        this.popupOverlay.classList.add('visible');

        // Reload current tab
        if (this.activeTabId) {
            this.loadTabContent(this.activeTabId);
        }

        this.onToast('info', '📝 Unpinned', 'Editor back to popup mode');
    }

    /**
     * Close editor (prompts for unsaved changes)
     */
    async close() {
        // Check for modified tabs
        const modifiedTabs = this.tabs.filter(t => t.modified);

        if (modifiedTabs.length > 0) {
            const fileList = modifiedTabs.map(t => this.getFileName(t.filePath)).join(', ');
            const shouldSave = confirm(`Save changes to ${modifiedTabs.length} file(s)?\n\n${fileList}`);

            if (shouldSave) {
                await this.saveAllFiles();
            }
        }

        // Close all tabs
        this.tabs = [];
        this.activeTabId = null;
        this.hideEditor();

        // Clear all auto-save timeouts
        this.autoSaveTimeouts.forEach(timeout => clearTimeout(timeout));
        this.autoSaveTimeouts.clear();
    }

    /**
     * Get file name from path
     */
    getFileName(filePath) {
        // Special handling for notes: note://{title}/{noteId}
        if (filePath.startsWith('note://')) {
            const parts = filePath.substring(7).split('/');  // Remove 'note://' and split
            if (parts.length === 2) {
                return parts[0];  // Return title (first part), not noteId (second part)
            }
            // Fallback for old format: note://{noteId}
            return parts[0] || 'Untitled Note';
        }

        // Regular file path
        const parts = filePath.split(/[/\\]/);
        return parts[parts.length - 1] || filePath;
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Detect file type from extension for syntax highlighting
     */
    detectFileType(filePath) {
        // ...existing code...
    }

    /**
     * Get CodeMirror mode for file type
     */
    getCodeMirrorMode(filePath) {
        const ext = filePath.split('.').pop().toLowerCase();

        const modeMap = {
            // JavaScript/TypeScript
            'js': 'javascript',
            'jsx': 'jsx',
            'ts': { name: 'javascript', typescript: true },
            'tsx': { name: 'jsx', typescript: true },

            // Web
            'html': 'htmlmixed',
            'htm': 'htmlmixed',
            'xml': 'xml',
            'css': 'css',
            'scss': 'text/x-scss',
            'sass': 'text/x-sass',
            'less': 'text/x-less',

            // Data
            'json': { name: 'javascript', json: true },
            'yaml': 'yaml',
            'yml': 'yaml',
            'toml': 'toml',

            // Programming
            'py': 'python',
            'java': 'text/x-java',
            'c': 'text/x-csrc',
            'cpp': 'text/x-c++src',
            'cc': 'text/x-c++src',
            'cxx': 'text/x-c++src',
            'h': 'text/x-csrc',
            'hpp': 'text/x-c++src',
            'cs': 'text/x-csharp',
            'php': 'php',
            'rb': 'ruby',
            'go': 'go',
            'rs': 'rust',
            'swift': 'swift',
            'kt': 'text/x-kotlin',
            'scala': 'text/x-scala',

            // Shell
            'sh': 'shell',
            'bash': 'shell',
            'zsh': 'shell',
            'fish': 'shell',

            // SQL
            'sql': 'sql',

            // Markup
            'md': 'markdown',
            'markdown': 'markdown',

            // Config
            'conf': 'properties',
            'cfg': 'properties',
            'ini': 'properties',
            'properties': 'properties',

            // Others
            'txt': 'text/plain',
            'log': 'text/plain',
        };

        return modeMap[ext] || 'text/plain';
    }

    /**
     * Update cursor position display
     */
    updateCursorPosition(editor, cursorSpanId) {
        if (!editor) return;
        const cursor = editor.getCursor();
        const cursorSpan = document.getElementById(cursorSpanId);
        if (cursorSpan) {
            cursorSpan.textContent = `Line ${cursor.line + 1}, Col ${cursor.ch + 1}`;
        }
    }

    /**
     * Update line numbers manually
     */
    updateLineNumbers(textarea, lineNumbersDiv) {
        // Not needed with CodeMirror - it handles line numbers automatically
    }

    /**
     * Get active file info
     */
    getActiveFile() {
        if (!this.activeTabId) return null;
        return this.tabs.find(t => t.id === this.activeTabId);
    }
}

// Export for global use
window.FileEditor = FileEditor;

