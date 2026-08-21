/**
 * Note Editor Component
 * Supports both popup and pinned (side panel) modes
 * Similar to file-explorer editor but for notes
 */

class NoteEditor {
    constructor(options = {}) {
        this.mlsUrl = options.mlsUrl || (typeof MLS_URL !== 'undefined' ? MLS_URL : 'http://localhost:8088');
        this.currentNoteId = null;
        this.mode = 'popup';  // 'popup' or 'pinned'
        this.isVisible = false;
        this.autoSaveTimeout = null;
        this.onToast = options.onToast || (() => {});

        // Create UI elements
        this.createPopupEditor();
        this.createPinnedEditor();
        this.attachEventListeners();
    }

    /**
     * Create popup modal editor
     */
    createPopupEditor() {
        this.popupOverlay = document.createElement('div');
        this.popupOverlay.className = 'note-editor-overlay';
        this.popupOverlay.id = 'noteEditorOverlay';
        this.popupOverlay.innerHTML = `
            <div class="note-editor-modal">
                <div class="note-editor-header">
                    <div class="note-editor-title-section">
                        <span class="note-editor-icon"><svg class="icon icon--sm" aria-hidden="true"><use href="#i-pen"></use></svg></span>
                        <input type="text" class="note-editor-title-input" id="noteEditorTitleInput" placeholder="Untitled Note">
                    </div>
                    <div class="note-editor-actions">
                        <button class="note-editor-btn secondary" onclick="noteEditor.pinToSide()" title="Pin to right side">
                            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-target"></use></svg> Pin
                        </button>
                        <button class="note-editor-btn secondary" onclick="noteEditor.close()">
                            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-x"></use></svg> Close
                        </button>
                    </div>
                </div>
                <div class="note-editor-body">
                    <textarea class="note-editor-textarea" id="noteEditorContent" placeholder="Start typing your note..." spellcheck="true"></textarea>
                </div>
                <div class="note-editor-footer">
                    <span class="note-editor-status" id="noteEditorStatus">Ready</span>
                    <div class="note-editor-footer-actions">
                        <button class="note-editor-btn small" onclick="noteEditor.toggleSharing()" id="noteEditorShareBtn">
                            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-lock"></use></svg> Private
                        </button>
                        <button class="note-editor-btn small primary" onclick="noteEditor.save()">
                            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-hard-drive"></use></svg> Save
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.popupOverlay);
    }

    /**
     * Create pinned side panel editor
     */
    createPinnedEditor() {
        this.pinnedPanel = document.createElement('div');
        this.pinnedPanel.className = 'note-editor-pinned';
        this.pinnedPanel.id = 'noteEditorPinned';
        this.pinnedPanel.innerHTML = `
            <div class="note-editor-resizer" id="noteEditorResizer"></div>
            <div class="note-editor-pinned-content">
                <div class="note-editor-header">
                    <div class="note-editor-title-section">
                        <span class="note-editor-icon"><svg class="icon icon--sm" aria-hidden="true"><use href="#i-pen"></use></svg></span>
                        <input type="text" class="note-editor-title-input" id="noteEditorTitleInputPinned" placeholder="Untitled Note">
                    </div>
                    <div class="note-editor-actions">
                        <button class="note-editor-btn secondary small" onclick="noteEditor.unpinToPopup()" title="Unpin to popup">
                            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-chevron-left"></use></svg>
                        </button>
                        <button class="note-editor-btn secondary small" onclick="noteEditor.close()">
                            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-x"></use></svg>
                        </button>
                    </div>
                </div>
                <div class="note-editor-body">
                    <textarea class="note-editor-textarea" id="noteEditorContentPinned" placeholder="Start typing your note..." spellcheck="true"></textarea>
                </div>
                <div class="note-editor-footer">
                    <span class="note-editor-status" id="noteEditorStatusPinned">Ready</span>
                    <div class="note-editor-footer-actions">
                        <button class="note-editor-btn small" onclick="noteEditor.toggleSharing()" id="noteEditorShareBtnPinned">
                            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-lock"></use></svg> Private
                        </button>
                        <button class="note-editor-btn small primary" onclick="noteEditor.save()">
                            <svg class="icon icon--sm" aria-hidden="true"><use href="#i-hard-drive"></use></svg> Save
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.pinnedPanel);
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Auto-save on input (debounced)
        const setupAutoSave = (textarea) => {
            textarea.addEventListener('input', () => {
                this.markAsModified();
                clearTimeout(this.autoSaveTimeout);
                this.autoSaveTimeout = setTimeout(() => {
                    this.save(true);  // Auto-save
                }, 2000);  // 2 seconds after last keystroke
            });
        };

        setupAutoSave(document.getElementById('noteEditorContent'));
        setupAutoSave(document.getElementById('noteEditorContentPinned'));

        // Title input changes
        const setupTitleChange = (input) => {
            input.addEventListener('input', () => {
                this.markAsModified();
            });
        };

        setupTitleChange(document.getElementById('noteEditorTitleInput'));
        setupTitleChange(document.getElementById('noteEditorTitleInputPinned'));

        // Resize functionality for pinned mode
        this.setupResizer();

        // Escape key to close (popup mode only)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible && this.mode === 'popup') {
                this.close();
            }
        });
    }

    /**
     * Setup resizer for pinned mode
     */
    setupResizer() {
        const resizer = document.getElementById('noteEditorResizer');
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
            const delta = startX - e.clientX;  // Negative = smaller, positive = larger
            const newWidth = startWidth + delta;
            const minWidth = 300;
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
     * Open note in popup mode (default)
     */
    async open(noteId) {
        try {
            // Fetch note from backend
            const response = await fetch(`${this.mlsUrl}/api/notes/${noteId}`);
            if (!response.ok) {
                throw new Error('Failed to load note');
            }

            const note = await response.json();
            this.currentNoteId = noteId;

            // Show in current mode
            if (this.mode === 'popup') {
                this.showPopup(note);
            } else {
                this.showPinned(note);
            }

            this.isVisible = true;

        } catch (error) {
            console.error('[NoteEditor] Failed to open note:', error);
            this.onToast('error', 'Load Failed', 'Failed to load note');
        }
    }

    /**
     * Show popup modal
     */
    showPopup(note) {
        const titleInput = document.getElementById('noteEditorTitleInput');
        const contentTextarea = document.getElementById('noteEditorContent');
        const shareBtn = document.getElementById('noteEditorShareBtn');

        titleInput.value = note.title || 'Untitled Note';
        contentTextarea.value = note.content || '';
        shareBtn.textContent = note.shared ? 'Shared' : 'Private';
        shareBtn.classList.toggle('shared', note.shared);

        this.popupOverlay.classList.add('visible');
        this.mode = 'popup';

        // Focus content
        setTimeout(() => contentTextarea.focus(), 100);
    }

    /**
     * Show pinned panel
     */
    showPinned(note) {
        const titleInput = document.getElementById('noteEditorTitleInputPinned');
        const contentTextarea = document.getElementById('noteEditorContentPinned');
        const shareBtn = document.getElementById('noteEditorShareBtnPinned');

        titleInput.value = note.title || 'Untitled Note';
        contentTextarea.value = note.content || '';
        shareBtn.textContent = note.shared ? 'Shared' : 'Private';
        shareBtn.classList.toggle('shared', note.shared);

        this.pinnedPanel.classList.add('visible');
        this.mode = 'pinned';

        // Focus content
        setTimeout(() => contentTextarea.focus(), 100);
    }

    /**
     * Pin to right side
     */
    async pinToSide() {
        if (this.mode === 'pinned') return;

        // Get current values from popup
        const titleInput = document.getElementById('noteEditorTitleInput');
        const contentTextarea = document.getElementById('noteEditorContent');

        // Hide popup
        this.popupOverlay.classList.remove('visible');

        // Show in pinned mode
        const note = {
            title: titleInput.value,
            content: contentTextarea.value,
            shared: titleInput.dataset.shared === 'true'
        };

        this.showPinned(note);
        this.onToast('info', '<svg class="icon icon--sm" aria-hidden="true"><use href="#i-target"></use></svg> Pinned', 'Note pinned to right side');
    }

    /**
     * Unpin back to popup
     */
    async unpinToPopup() {
        if (this.mode === 'popup') return;

        // Get current values from pinned
        const titleInput = document.getElementById('noteEditorTitleInputPinned');
        const contentTextarea = document.getElementById('noteEditorContentPinned');

        // Hide pinned
        this.pinnedPanel.classList.remove('visible');

        // Show in popup mode
        const note = {
            title: titleInput.value,
            content: contentTextarea.value,
            shared: titleInput.dataset.shared === 'true'
        };

        this.showPopup(note);
        this.onToast('info', 'Unpinned', 'Note back to popup mode');
    }

    /**
     * Save note
     */
    async save(isAutoSave = false) {
        if (!this.currentNoteId) return;

        try {
            const titleInput = this.mode === 'popup'
                ? document.getElementById('noteEditorTitleInput')
                : document.getElementById('noteEditorTitleInputPinned');
            const contentTextarea = this.mode === 'popup'
                ? document.getElementById('noteEditorContent')
                : document.getElementById('noteEditorContentPinned');
            const statusSpan = this.mode === 'popup'
                ? document.getElementById('noteEditorStatus')
                : document.getElementById('noteEditorStatusPinned');

            const note = {
                id: this.currentNoteId,
                title: titleInput.value || 'Untitled Note',
                content: contentTextarea.value || '',
                shared: titleInput.dataset.shared === 'true'
            };

            statusSpan.textContent = 'Saving...';

            const response = await fetch(`${this.mlsUrl}/api/notes/${this.currentNoteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(note)
            });

            if (!response.ok) {
                throw new Error('Failed to save note');
            }

            statusSpan.textContent = '<svg class="icon icon--sm" aria-hidden="true"><use href="#i-hard-drive"></use></svg> Saved';
            statusSpan.classList.add('saved');

            setTimeout(() => {
                statusSpan.textContent = 'Ready';
                statusSpan.classList.remove('saved');
            }, 2000);

            if (!isAutoSave) {
                this.onToast('success', '<svg class="icon icon--sm" aria-hidden="true"><use href="#i-hard-drive"></use></svg> Saved', 'Note saved successfully');
            }

            // Notify sidebar to update
            if (window.updateNotesList) {
                window.updateNotesList();
            }

        } catch (error) {
            console.error('[NoteEditor] Failed to save note:', error);
            const statusSpan = this.mode === 'popup'
                ? document.getElementById('noteEditorStatus')
                : document.getElementById('noteEditorStatusPinned');
            statusSpan.textContent = 'Save failed ✗';
            this.onToast('error', 'Save Failed', 'Failed to save note');
        }
    }

    /**
     * Toggle sharing
     */
    async toggleSharing() {
        if (!this.currentNoteId) return;

        const titleInput = this.mode === 'popup'
            ? document.getElementById('noteEditorTitleInput')
            : document.getElementById('noteEditorTitleInputPinned');
        const shareBtn = this.mode === 'popup'
            ? document.getElementById('noteEditorShareBtn')
            : document.getElementById('noteEditorShareBtnPinned');

        const isShared = titleInput.dataset.shared === 'true';
        const newShared = !isShared;

        titleInput.dataset.shared = newShared;
        shareBtn.textContent = newShared ? 'Shared' : 'Private';
        shareBtn.classList.toggle('shared', newShared);

        this.markAsModified();
        await this.save();

        this.onToast('success', newShared ? 'Note Shared' : 'Note Unshared',
                     newShared ? 'Note is now shared' : 'Note sharing disabled');
    }

    /**
     * Mark as modified
     */
    markAsModified() {
        const statusSpan = this.mode === 'popup'
            ? document.getElementById('noteEditorStatus')
            : document.getElementById('noteEditorStatusPinned');
        statusSpan.textContent = 'Modified';
        statusSpan.classList.add('modified');
    }

    /**
     * Close editor
     */
    async close() {
        // Save if modified
        const statusSpan = this.mode === 'popup'
            ? document.getElementById('noteEditorStatus')
            : document.getElementById('noteEditorStatusPinned');

        if (statusSpan.textContent === 'Modified') {
            const shouldSave = await AppDialog.ask({
                title: 'Save before closing?', body: 'This note has changes that are not written yet.',
                confirmLabel: 'Save', cancelLabel: 'Discard'
            });
            if (shouldSave) {
                await this.save();
            }
        }

        // Hide editor
        this.popupOverlay.classList.remove('visible');
        this.pinnedPanel.classList.remove('visible');
        this.isVisible = false;
        this.currentNoteId = null;

        clearTimeout(this.autoSaveTimeout);
    }
}

// Export for global use
window.NoteEditor = NoteEditor;

