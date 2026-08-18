/**
 * Collaborative Document Editor
 * Real-time markdown editor with live preview using UserConnectionBase
 */

// ============================================
// COLLABORATIVE DOCUMENT CLASS
// ============================================

class CollabDoc extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'collabdoc',
            customType: 'collab-doc',
            autoCreateDataChannel: true,
            dataChannelName: 'doc-data',
            supportsPauseResume: false
        });

        // CodeMirror instance
        this.editor = null;

        // Document state
        this.docTitle = 'Untitled Document';
        this.content = '';
        this.viewMode = 'edit'; // edit, split, preview
        this.theme = 'light';

        // Users and cursors
        this.users = new Map();
        this.remoteCursors = new Map();

        // Change tracking for sync
        this.lastSyncContent = '';
        this.syncDebounceTimer = null;
        this.syncDebounceDelay = 300;

        // Cursor sync
        this.lastCursorSend = 0;
        this.cursorSendInterval = 100;
    }

    async onInitialize() {
        console.log('[CollabDoc] Initializing...');

        // Initialize CodeMirror
        this.editor = CodeMirror.fromTextArea(document.getElementById('editorTextarea'), {
            mode: 'gfm',
            theme: 'eclipse',
            lineNumbers: true,
            lineWrapping: true,
            autofocus: true,
            extraKeys: {
                'Ctrl-S': () => this.exportMarkdown(),
                'Cmd-S': () => this.exportMarkdown()
            }
        });

        // Listen to changes
        this.editor.on('change', (cm, change) => {
            this.handleLocalChange(change);
        });

        // Listen to cursor activity
        this.editor.on('cursorActivity', () => {
            this.handleCursorActivity();
        });

        // Setup view mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setViewMode(btn.dataset.mode);
            });
        });

        // Document title
        document.getElementById('docTitle').addEventListener('input', (e) => {
            this.docTitle = e.target.value;
            this.broadcastTitle();
        });

        console.log('[CollabDoc] Initialized');
    }

    onConnect(detail) {
        // Dismiss the connection dialog — without this it stays over the app
        // even though the session is live.
        if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
            window.ConnectionModal.hide();
        }
        console.log('[CollabDoc] Connected:', detail);

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
                    color: this.generateUserColor(username),
                    cursor: null
                });
            }
        });

        this.updateUsersUI();

        // Request sync if not host
        if (!this.isHost() && detail.users.length > 0) {
            setTimeout(() => {
                this.requestDocumentSync();
            }, 500);
        }
    }

    onUserJoin(detail) {
        console.log('[CollabDoc] User joined:', detail.agentName);

        this.users.set(detail.agentName, {
            color: this.generateUserColor(detail.agentName),
            cursor: null
        });

        this.updateUsersUI();
        this.showToast(`${detail.agentName} joined`, 'success');

        // Sync document to new user
        if (this.isHost()) {
            this.syncDocumentTo(detail.agentName);
        }
    }

    onUserLeave(detail) {
        console.log('[CollabDoc] User left:', detail.agentName);

        this.users.delete(detail.agentName);

        // Remove remote cursor
        const cursorEl = this.remoteCursors.get(detail.agentName);
        if (cursorEl && cursorEl.parentElement) {
            cursorEl.parentElement.removeChild(cursorEl);
        }
        this.remoteCursors.delete(detail.agentName);

        this.updateUsersUI();
        this.showToast(`${detail.agentName} left`, 'info');
    }

    onDataChannelMessage(peerId, data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'content-change':
                this.handleRemoteChange(data);
                break;
            case 'title-change':
                this.handleTitleChange(data);
                break;
            case 'cursor-move':
                this.handleRemoteCursor(data);
                break;
            case 'doc-sync':
                this.handleDocSync(data);
                break;
            case 'request-sync':
                if (this.isHost()) {
                    this.syncDocumentTo(data.username);
                }
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

    // ============================================
    // DOCUMENT CHANGES
    // ============================================

    handleLocalChange(change) {
        // Update stats
        this.updateStats();

        // Update preview if visible
        if (this.viewMode !== 'edit') {
            this.updatePreview();
        }

        // Debounce sync to avoid flooding network
        clearTimeout(this.syncDebounceTimer);
        this.syncDebounceTimer = setTimeout(() => {
            this.broadcastContentChange(change);
        }, this.syncDebounceDelay);
    }

    broadcastContentChange(change) {
        const content = this.editor.getValue();

        if (content === this.lastSyncContent) return;

        this.lastSyncContent = content;

        const data = {
            type: 'content-change',
            username: this.username,
            content: content,
            timestamp: Date.now()
        };

        this.sendData(data);
    }

    handleRemoteChange(data) {
        if (data.username === this.username) return;

        // Get current cursor position
        const cursor = this.editor.getCursor();

        // Update content
        this.lastSyncContent = data.content;
        this.editor.setValue(data.content);

        // Restore cursor (approximately)
        this.editor.setCursor(cursor);

        // Update preview
        if (this.viewMode !== 'edit') {
            this.updatePreview();
        }

        this.updateStats();
    }

    broadcastTitle() {
        const data = {
            type: 'title-change',
            title: this.docTitle
        };

        this.sendData(data);
    }

    handleTitleChange(data) {
        this.docTitle = data.title;
        document.getElementById('docTitle').value = data.title;
    }

    // ============================================
    // CURSOR SYNC
    // ============================================

    handleCursorActivity() {
        const now = Date.now();
        if (now - this.lastCursorSend < this.cursorSendInterval) return;

        this.lastCursorSend = now;
        this.updateStats();

        const cursor = this.editor.getCursor();

        const data = {
            type: 'cursor-move',
            username: this.username,
            line: cursor.line,
            ch: cursor.ch
        };

        this.sendData(data);
    }

    handleRemoteCursor(data) {
        if (data.username === this.username) return;

        const user = this.users.get(data.username);
        if (!user) return;

        // Update or create cursor element
        let cursorEl = this.remoteCursors.get(data.username);

        if (!cursorEl) {
            cursorEl = document.createElement('div');
            cursorEl.className = 'remote-cursor';
            cursorEl.style.background = user.color;
            cursorEl.innerHTML = `<div class="remote-cursor-label" style="background: ${user.color}">${data.username}</div>`;

            // Add to CodeMirror wrapper
            const cmWrapper = this.editor.getWrapperElement();
            cmWrapper.appendChild(cursorEl);

            this.remoteCursors.set(data.username, cursorEl);
        }

        // Position cursor
        const coords = this.editor.cursorCoords({line: data.line, ch: data.ch}, 'local');
        cursorEl.style.left = coords.left + 'px';
        cursorEl.style.top = coords.top + 'px';
    }

    // ============================================
    // VIEW MODE
    // ============================================

    setViewMode(mode) {
        this.viewMode = mode;

        const editorPane = document.getElementById('editorPane');
        const previewPane = document.getElementById('previewPane');
        const editorLayout = document.querySelector('.editor-layout');

        // Update button states
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Update layout
        editorLayout.classList.remove('split');

        if (mode === 'edit') {
            editorPane.classList.remove('hidden');
            previewPane.classList.add('hidden');
        } else if (mode === 'preview') {
            editorPane.classList.add('hidden');
            previewPane.classList.remove('hidden');
            this.updatePreview();
        } else if (mode === 'split') {
            editorPane.classList.remove('hidden');
            previewPane.classList.remove('hidden');
            editorLayout.classList.add('split');
            this.updatePreview();
        }

        this.editor.refresh();
    }

    updatePreview() {
        const content = this.editor.getValue();
        const html = marked.parse(content);
        document.getElementById('previewContent').innerHTML = html;
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';

        if (this.theme === 'dark') {
            document.body.classList.add('dark-theme');
            this.editor.setOption('theme', 'monokai');
            document.getElementById('themeBtn').textContent = '☀️';
            document.getElementById('previewContent').classList.add('dark');
        } else {
            document.body.classList.remove('dark-theme');
            this.editor.setOption('theme', 'eclipse');
            document.getElementById('themeBtn').textContent = '🌙';
            document.getElementById('previewContent').classList.remove('dark');
        }
    }

    // ============================================
    // MARKDOWN HELPERS
    // ============================================

    insertMarkdown(before, after) {
        const selection = this.editor.getSelection();
        const replacement = before + (selection || 'text') + after;
        this.editor.replaceSelection(replacement);

        if (!selection) {
            // Move cursor to select 'text'
            const cursor = this.editor.getCursor();
            this.editor.setSelection(
                {line: cursor.line, ch: cursor.ch - after.length - 4},
                {line: cursor.line, ch: cursor.ch - after.length}
            );
        }

        this.editor.focus();
    }

    insertHeading(level) {
        const cursor = this.editor.getCursor();
        const line = this.editor.getLine(cursor.line);
        const prefix = '#'.repeat(level) + ' ';

        if (line.startsWith('#')) {
            // Replace existing heading
            const newLine = line.replace(/^#+\s*/, prefix);
            this.editor.replaceRange(newLine, {line: cursor.line, ch: 0}, {line: cursor.line, ch: line.length});
        } else {
            // Add heading
            this.editor.replaceRange(prefix, {line: cursor.line, ch: 0});
        }

        this.editor.focus();
    }

    insertList() {
        const cursor = this.editor.getCursor();
        const selection = this.editor.getSelection();

        if (selection) {
            const lines = selection.split('\n');
            const numbered = lines.map((line, i) => `- ${line}`).join('\n');
            this.editor.replaceSelection(numbered);
        } else {
            this.editor.replaceRange('- ', cursor);
        }

        this.editor.focus();
    }

    insertQuote() {
        const cursor = this.editor.getCursor();
        const selection = this.editor.getSelection();

        if (selection) {
            const lines = selection.split('\n');
            const quoted = lines.map(line => `> ${line}`).join('\n');
            this.editor.replaceSelection(quoted);
        } else {
            this.editor.replaceRange('> ', cursor);
        }

        this.editor.focus();
    }

    // ============================================
    // EXPORT
    // ============================================

    exportMarkdown() {
        const content = this.editor.getValue();
        const blob = new Blob([content], {type: 'text/markdown'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.docTitle || 'document'}.md`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('Markdown exported!', 'success');
    }

    exportHTML() {
        const content = this.editor.getValue();
        const html = marked.parse(content);

        const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.docTitle}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.7;
        }
        h1, h2, h3 { margin-top: 24px; margin-bottom: 12px; }
        code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
        pre { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 8px; overflow-x: auto; }
        blockquote { border-left: 4px solid #4f46e5; padding-left: 16px; color: #666; font-style: italic; }
    </style>
</head>
<body>
${html}
</body>
</html>`;

        const blob = new Blob([fullHTML], {type: 'text/html'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.docTitle || 'document'}.html`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('HTML exported!', 'success');
    }

    // ============================================
    // STATS
    // ============================================

    updateStats() {
        const content = this.editor.getValue();
        const cursor = this.editor.getCursor();

        // Cursor position
        document.getElementById('cursorPosition').textContent = `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`;

        // Word count
        const words = content.trim().split(/\s+/).filter(w => w.length > 0).length;
        document.getElementById('wordCount').textContent = `${words} word${words !== 1 ? 's' : ''}`;

        // Character count
        document.getElementById('charCount').textContent = `${content.length} character${content.length !== 1 ? 's' : ''}`;
    }

    updateUsersUI() {
        const usersList = document.getElementById('usersList');

        let html = `
            <div class="user-badge">
                <div class="user-color-dot" style="background: var(--primary)"></div>
                <span>${this.username}</span>
            </div>
        `;

        this.users.forEach((user, username) => {
            html += `
                <div class="user-badge">
                    <div class="user-color-dot" style="background: ${user.color}"></div>
                    <span>${username}</span>
                </div>
            `;
        });

        usersList.innerHTML = html;
    }

    // ============================================
    // SYNC
    // ============================================

    requestDocumentSync() {
        const data = {
            type: 'request-sync',
            username: this.username
        };

        this.sendData(data);
    }

    syncDocumentTo(username) {
        const data = {
            type: 'doc-sync',
            title: this.docTitle,
            content: this.editor.getValue()
        };

        this.sendData(data, username);
    }

    handleDocSync(data) {
        this.docTitle = data.title;
        document.getElementById('docTitle').value = data.title;

        this.lastSyncContent = data.content;
        this.editor.setValue(data.content);

        this.updateStats();
        if (this.viewMode !== 'edit') {
            this.updatePreview();
        }
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

let collabDoc = null;
let isConnecting = false;

async function connectCollabDoc(username, channel, password) {
    if (isConnecting) {
        console.warn('[CollabDoc] Connection already in progress');
        return;
    }
    if (collabDoc && collabDoc.connected) {
        console.warn('[CollabDoc] Already connected');
        return;
    }

    isConnecting = true;

    try {
        collabDoc = new CollabDoc();
        window.collabDoc = collabDoc;

        await collabDoc.initialize();
        await collabDoc.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });

        collabDoc.start();

        // Update URL for sharing
        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' + channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }

        console.log('[CollabDoc] Connected and ready!');
    } catch (error) {
        console.error('[CollabDoc] Connection failed:', error);
        alert('Failed to connect: ' + error.message);
        collabDoc = null;
    } finally {
        isConnecting = false;
    }
}

function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'collabdoc_',
        channelPrefix: 'doc-',
        title: '📝 Join Document',
        collapsedTitle: '📝 Document',
        onConnect: function(username, channel, password) {
            connectCollabDoc(username, channel, password);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[CollabDoc] Page loaded');

    initializeConnectionModal();

    // Process shared link
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'CollabDoc',
            storagePrefix: 'collabdoc_',
            connectCallback: async function() {
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectCollabDoc(username, channel, password);
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

