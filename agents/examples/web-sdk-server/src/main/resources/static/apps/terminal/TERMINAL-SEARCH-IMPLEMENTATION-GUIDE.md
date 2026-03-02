# 🔍 Terminal Search Implementation Guide

## 📋 Overview
Add Ctrl+F search functionality to find text in terminal output with highlighting and navigation.

**Priority:** ⭐⭐⭐⭐⭐ (High - Common user expectation)  
**Complexity:** Medium (2-3 hours)  
**Impact:** High - Essential for debugging and log analysis

---

## 🎯 Features

### Core Features:
- ✅ Search bar overlay (Ctrl+F to toggle)
- ✅ Highlight all matches in yellow
- ✅ Current match highlighted in orange
- ✅ Next/Previous navigation (Enter/Shift+Enter or arrows)
- ✅ Case-sensitive toggle
- ✅ Regex support toggle
- ✅ Match counter (e.g., "3/15")
- ✅ Esc to close search

### Advanced Features:
- ✅ Search from current position
- ✅ Wrap around search
- ✅ Scroll to match position
- ✅ Matches shown on scrollbar (like VS Code)
- ✅ Clear highlights on close

---

## 💻 IMPLEMENTATION

### Step 1: Install XTerm Search Addon

**Option A: Use CDN**

Add to `apps/terminal/index.html`:

```html
<!-- After xterm-addon-fit.js -->
<script src="lib/xterm-addon-search.js"></script>
```

**Option B: Download locally**

Download from: https://cdn.jsdelivr.net/npm/xterm-addon-search@0.13.0/lib/xterm-addon-search.js

Place in: `apps/terminal/lib/xterm-addon-search.js`

---

### Step 2: Add Search UI to terminal.css

**File:** `apps/terminal/terminal.css` (MODIFY)

```css
/* ========================================
   Terminal Search Overlay
   ======================================== */

.terminal-search-overlay {
    position: absolute;
    top: 8px;
    right: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    display: none; /* Hidden by default */
    flex-direction: row;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 1000;
    min-width: 320px;
}

.terminal-search-overlay.visible {
    display: flex;
}

.terminal-search-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
}

.terminal-search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.terminal-search-counter {
    color: var(--text-muted);
    font-size: 12px;
    min-width: 50px;
    text-align: center;
}

.terminal-search-btn {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s;
}

.terminal-search-btn:hover {
    background: var(--bg-hover);
}

.terminal-search-btn:active {
    background: var(--bg-active);
}

.terminal-search-btn.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
}

.terminal-search-close {
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    transition: color 0.15s;
}

.terminal-search-close:hover {
    color: var(--text-primary);
}
```

---

### Step 3: Add Search Bar HTML

**File:** `apps/terminal/index.html` (MODIFY)

Add inside each `.terminal-panel`:

```html
<!-- In the HTML structure, add after terminal container -->
<div class="terminal-container" id="terminal-{{sessionId}}"></div>

<!-- 🆕 Search Overlay -->
<div class="terminal-search-overlay" id="search-overlay-{{sessionId}}">
    <input type="text" 
           class="terminal-search-input" 
           id="search-input-{{sessionId}}"
           placeholder="Find in terminal..."
           onkeydown="handleSearchKeydown(event, '{{sessionId}}')">
    <span class="terminal-search-counter" id="search-counter-{{sessionId}}">0/0</span>
    <button class="terminal-search-btn" 
            onclick="searchPrevious('{{sessionId}}')" 
            title="Previous (Shift+Enter)">↑</button>
    <button class="terminal-search-btn" 
            onclick="searchNext('{{sessionId}}')" 
            title="Next (Enter)">↓</button>
    <button class="terminal-search-btn" 
            id="search-case-btn-{{sessionId}}"
            onclick="toggleSearchCase('{{sessionId}}')" 
            title="Case Sensitive">Aa</button>
    <button class="terminal-search-btn" 
            id="search-regex-btn-{{sessionId}}"
            onclick="toggleSearchRegex('{{sessionId}}')" 
            title="Use Regex">.*</button>
    <button class="terminal-search-close" 
            onclick="closeSearch('{{sessionId}}')" 
            title="Close (Esc)">✕</button>
</div>
```

**Note:** Replace `{{sessionId}}` with actual session ID when creating terminal.

---

### Step 4: Add Search Logic to terminal.js

**File:** `apps/terminal/terminal.js` (MODIFY)

**Location:** In `initTerminal()` function:

```javascript
// Import SearchAddon (at top of file)
// const { SearchAddon } = require('xterm-addon-search'); // If using modules
// OR it's available globally as Terminal.SearchAddon

// In initTerminal(), after creating terminal:
const searchAddon = new SearchAddon();
terminal.loadAddon(searchAddon);

// Store search addon in session
session.searchAddon = searchAddon;
session.searchOptions = {
    caseSensitive: false,
    regex: false,
    wholeWord: false
};

// Create search overlay for this terminal
const panel = document.getElementById(`panel-${sessionId}`);
const searchOverlay = document.createElement('div');
searchOverlay.className = 'terminal-search-overlay';
searchOverlay.id = `search-overlay-${sessionId}`;
searchOverlay.innerHTML = `
    <input type="text" 
           class="terminal-search-input" 
           id="search-input-${sessionId}"
           placeholder="Find in terminal..."
           onkeydown="handleSearchKeydown(event, '${sessionId}')">
    <span class="terminal-search-counter" id="search-counter-${sessionId}">0/0</span>
    <button class="terminal-search-btn" 
            onclick="searchPrevious('${sessionId}')" 
            title="Previous (Shift+Enter)">↑</button>
    <button class="terminal-search-btn" 
            onclick="searchNext('${sessionId}')" 
            title="Next (Enter)">↓</button>
    <button class="terminal-search-btn" 
            id="search-case-btn-${sessionId}"
            onclick="toggleSearchCase('${sessionId}')" 
            title="Case Sensitive">Aa</button>
    <button class="terminal-search-btn" 
            id="search-regex-btn-${sessionId}"
            onclick="toggleSearchRegex('${sessionId}')" 
            title="Use Regex">.*</button>
    <button class="terminal-search-close" 
            onclick="closeSearch('${sessionId}')" 
            title="Close (Esc)">✕</button>
`;

panel.appendChild(searchOverlay);

// Add global keyboard shortcut for search
terminal.attachCustomKeyEventHandler((e) => {
    // Ctrl+F - Open search
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        openSearch(sessionId);
        return false;
    }
    
    // Esc - Close search if open
    if (e.key === 'Escape' && isSearchOpen(sessionId)) {
        e.preventDefault();
        closeSearch(sessionId);
        return false;
    }
    
    return true; // Allow other handlers
});
```

---

### Step 5: Implement Search Functions

**File:** `apps/terminal/terminal.js` (ADD)

```javascript
// ========================================
// SECTION: TERMINAL SEARCH
// ========================================

/**
 * Check if search is open for a session
 */
function isSearchOpen(sessionId) {
    const overlay = document.getElementById(`search-overlay-${sessionId}`);
    return overlay && overlay.classList.contains('visible');
}

/**
 * Open search overlay for terminal session
 */
function openSearch(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    const overlay = document.getElementById(`search-overlay-${sessionId}`);
    const input = document.getElementById(`search-input-${sessionId}`);
    
    if (!overlay || !input) {
        console.warn('[Search] Search overlay not found for session:', sessionId);
        return;
    }
    
    // Show overlay
    overlay.classList.add('visible');
    
    // Focus input
    input.focus();
    
    // Select existing text if any
    input.select();
    
    console.log('[Search] Opened for session:', sessionId);
}

/**
 * Close search overlay
 */
function closeSearch(sessionId) {
    const overlay = document.getElementById(`search-overlay-${sessionId}`);
    const input = document.getElementById(`search-input-${sessionId}`);
    
    if (overlay) {
        overlay.classList.remove('visible');
    }
    
    if (input) {
        input.value = '';
    }
    
    // Clear highlights (search with empty string)
    const session = sessions.get(sessionId);
    if (session && session.searchAddon) {
        session.searchAddon.clearDecorations();
    }
    
    // Return focus to terminal
    if (session && session.terminal) {
        session.terminal.focus();
    }
    
    console.log('[Search] Closed for session:', sessionId);
}

/**
 * Perform search
 */
function performSearch(sessionId, direction = 'next') {
    const session = sessions.get(sessionId);
    if (!session || !session.searchAddon) return;
    
    const input = document.getElementById(`search-input-${sessionId}`);
    const query = input.value;
    
    if (!query) {
        // Clear search if empty
        session.searchAddon.clearDecorations();
        updateSearchCounter(sessionId, 0, 0);
        return;
    }
    
    // Get search options
    const options = {
        caseSensitive: session.searchOptions.caseSensitive,
        regex: session.searchOptions.regex,
        wholeWord: session.searchOptions.wholeWord,
        decorations: {
            matchBackground: '#ffeb3b', // Yellow highlight
            matchBorder: '1px solid #fbc02d',
            matchOverviewRuler: '#ffeb3b',
            activeMatchBackground: '#ff9800', // Orange for current match
            activeMatchBorder: '1px solid #f57c00',
            activeMatchColorOverviewRuler: '#ff9800'
        }
    };
    
    // Perform search
    let found = false;
    if (direction === 'next') {
        found = session.searchAddon.findNext(query, options);
    } else {
        found = session.searchAddon.findPrevious(query, options);
    }
    
    if (!found && query) {
        // No match found - show feedback
        input.style.borderColor = '#ef4444'; // Red border
        setTimeout(() => {
            input.style.borderColor = '';
        }, 500);
    } else {
        input.style.borderColor = '';
    }
    
    // Update counter
    // Note: XTerm search addon doesn't provide match count directly
    // We'd need to implement custom counting or estimate
    updateSearchCounter(sessionId, found ? 1 : 0, 1);
    
    console.log('[Search] Query:', query, 'Direction:', direction, 'Found:', found);
}

/**
 * Search next occurrence
 */
function searchNext(sessionId) {
    performSearch(sessionId, 'next');
}

/**
 * Search previous occurrence
 */
function searchPrevious(sessionId) {
    performSearch(sessionId, 'previous');
}

/**
 * Toggle case-sensitive search
 */
function toggleSearchCase(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    session.searchOptions.caseSensitive = !session.searchOptions.caseSensitive;
    
    // Update button visual state
    const btn = document.getElementById(`search-case-btn-${sessionId}`);
    if (btn) {
        if (session.searchOptions.caseSensitive) {
            btn.classList.add('active');
            btn.title = 'Case Sensitive: ON';
        } else {
            btn.classList.remove('active');
            btn.title = 'Case Sensitive: OFF';
        }
    }
    
    // Re-run search with new options
    performSearch(sessionId, 'next');
    
    console.log('[Search] Case sensitive:', session.searchOptions.caseSensitive);
}

/**
 * Toggle regex search
 */
function toggleSearchRegex(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    session.searchOptions.regex = !session.searchOptions.regex;
    
    // Update button visual state
    const btn = document.getElementById(`search-regex-btn-${sessionId}`);
    if (btn) {
        if (session.searchOptions.regex) {
            btn.classList.add('active');
            btn.title = 'Regex: ON';
        } else {
            btn.classList.remove('active');
            btn.title = 'Regex: OFF';
        }
    }
    
    // Re-run search with new options
    performSearch(sessionId, 'next');
    
    console.log('[Search] Regex:', session.searchOptions.regex);
}

/**
 * Update search counter display
 */
function updateSearchCounter(sessionId, current, total) {
    const counter = document.getElementById(`search-counter-${sessionId}`);
    if (counter) {
        if (total === 0) {
            counter.textContent = 'No matches';
            counter.style.color = 'var(--text-muted)';
        } else {
            counter.textContent = `${current}/${total}`;
            counter.style.color = 'var(--text-primary)';
        }
    }
}

/**
 * Handle keyboard shortcuts in search input
 */
function handleSearchKeydown(event, sessionId) {
    switch (event.key) {
        case 'Enter':
            event.preventDefault();
            if (event.shiftKey) {
                searchPrevious(sessionId);
            } else {
                searchNext(sessionId);
            }
            break;
            
        case 'Escape':
            event.preventDefault();
            closeSearch(sessionId);
            break;
            
        case 'ArrowUp':
            event.preventDefault();
            searchPrevious(sessionId);
            break;
            
        case 'ArrowDown':
            event.preventDefault();
            searchNext(sessionId);
            break;
    }
}

// Make functions globally accessible
window.openSearch = openSearch;
window.closeSearch = closeSearch;
window.searchNext = searchNext;
window.searchPrevious = searchPrevious;
window.toggleSearchCase = toggleSearchCase;
window.toggleSearchRegex = toggleSearchRegex;
window.handleSearchKeydown = handleSearchKeydown;
```

---

### Step 6: Add Search Input Handler

**File:** `apps/terminal/terminal.js` (ADD)

Add real-time search as user types:

```javascript
// In openSearch() function, add after input.focus():

// Search as user types (with debouncing)
let searchTimeout = null;
input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        performSearch(sessionId, 'next');
    }, 300); // 300ms debounce
});
```

---

### Step 7: Add Menu Item for Search

**File:** `apps/terminal/terminal.js` (MODIFY)

Add to tab context menu:

```javascript
// In showTabContextMenu() - add menu item:
<div class="context-menu-item" onclick="tabContextMenuAction('search')">
    🔍 Search in Terminal
</div>

// In tabContextMenuAction() - handle 'search':
case 'search':
    openSearch(sessionId);
    break;
```

---

## 🎨 ENHANCED VERSION (With Scrollbar Annotations)

### Step 8: Add Scrollbar Annotations (Optional)

**What:** Show search matches on scrollbar (like VS Code)

**Install:** `xterm-addon-search` already includes this functionality!

**Enable in terminal.js:**

```javascript
// In initTerminal(), when creating search addon:
const searchAddon = new SearchAddon();
terminal.loadAddon(searchAddon);

// Configure to show matches on scrollbar
searchAddon.onDidChangeResults((result) => {
    const { matchIndex, matchCount } = result;
    updateSearchCounter(sessionId, matchIndex + 1, matchCount);
    console.log(`[Search] ${matchIndex + 1}/${matchCount} matches`);
});
```

---

## 🧪 TESTING CHECKLIST

### Basic Functionality:
- [ ] Ctrl+F opens search overlay
- [ ] Esc closes search overlay
- [ ] Search input accepts text
- [ ] Enter finds next match
- [ ] Shift+Enter finds previous match
- [ ] Arrow up/down navigate matches
- [ ] Matches are highlighted in yellow
- [ ] Current match is highlighted in orange
- [ ] Search wraps around (end → start)

### Options:
- [ ] Case-sensitive toggle works
- [ ] Regex toggle works
- [ ] "Aa" button shows active state
- [ ] ".*" button shows active state
- [ ] Options persist during session

### Edge Cases:
- [ ] Search with no matches shows feedback
- [ ] Search in empty terminal
- [ ] Search in terminal with ANSI colors
- [ ] Search with special characters
- [ ] Search with regex syntax errors
- [ ] Multiple terminals have independent search
- [ ] Search persists when switching tabs
- [ ] Close search clears highlights

### Performance:
- [ ] Search in large output (>10k lines)
- [ ] Real-time search with debouncing
- [ ] No lag when typing in search
- [ ] Highlights don't slow down terminal

---

## 📊 METRICS TO TRACK

1. **Usage:**
   - Times search is opened per session
   - Average searches per session
   - Most common search queries

2. **Performance:**
   - Search time for different output sizes
   - Regex vs plain search performance

3. **Adoption:**
   - % of users who use search
   - Repeat usage rate

---

## 🎯 SUCCESS CRITERIA

**Feature is successful if:**
1. ✅ Ctrl+F opens search instantly
2. ✅ Matches are highlighted clearly
3. ✅ Navigation is intuitive (Enter/Shift+Enter)
4. ✅ Works in all terminal types
5. ✅ No performance issues with large output
6. ✅ Positive user feedback

---

## 🔄 ALTERNATIVES CONSIDERED

### Alternative 1: Custom Search Implementation
**Pros:** Full control, custom features
**Cons:** Reinventing the wheel, more bugs, more maintenance
**Decision:** Use XTerm addon (battle-tested)

### Alternative 2: Browser Find (Ctrl+F)
**Pros:** No implementation needed
**Cons:** Searches entire page, not just terminal, poor UX
**Decision:** Custom terminal-specific search

---

## 🚀 DEPLOYMENT PLAN

### Step 1: Add XTerm Search Addon
- Download addon or use CDN
- Add to index.html
- Update sw.js cache

### Step 2: Add UI
- Add CSS for search overlay
- Add HTML template
- Test styling

### Step 3: Add Logic
- Integrate with terminal.js
- Add keyboard handlers
- Add search functions
- Test functionality

### Step 4: Polish
- Add animations
- Improve feedback
- Add tooltips
- Test mobile

### Step 5: Deploy
- Update service worker version
- Deploy to staging
- Test thoroughly
- Deploy to production

**Total time:** 2-3 hours

---

## 📚 REFERENCES

### XTerm.js Search Addon:
- NPM: https://www.npmjs.com/package/xterm-addon-search
- Docs: https://github.com/xtermjs/xterm.js/tree/master/addons/xterm-addon-search
- Demo: https://xtermjs.org/docs/api/addons/search/

### API:
```javascript
searchAddon.findNext(term, searchOptions);
searchAddon.findPrevious(term, searchOptions);
searchAddon.clearDecorations();
searchAddon.onDidChangeResults((result) => {
    // result: { matchIndex, matchCount }
});
```

### Search Options:
```javascript
{
    caseSensitive: boolean,
    regex: boolean,
    wholeWord: boolean,
    decorations: {
        matchBackground: string,
        matchBorder: string,
        matchOverviewRuler: string,
        activeMatchBackground: string,
        activeMatchBorder: string,
        activeMatchColorOverviewRuler: string
    }
}
```

---

## 💡 FUTURE ENHANCEMENTS

### Phase 2 Ideas:
1. **Search History** - Remember recent searches
2. **Saved Searches** - Save common regex patterns
3. **Search & Replace** - Replace matches (dangerous!)
4. **Multi-Session Search** - Search across all terminals
5. **Export Matches** - Copy all matches to clipboard
6. **Filter View** - Show only matching lines
7. **Search Templates** - Pre-defined patterns (IPs, URLs, errors)

### Advanced Features:
```javascript
// Search templates
const SEARCH_TEMPLATES = {
    'IP Address': /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    'Email': /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    'URL': /https?:\/\/[^\s]+/g,
    'Error': /error|exception|failed|fatal/gi,
    'Warning': /warn|warning|caution/gi,
    'Success': /success|complete|done|ok/gi
};
```

---

## ✅ IMPLEMENTATION CHECKLIST

- [ ] Download xterm-addon-search.js
- [ ] Add to apps/terminal/lib/
- [ ] Add <script> tag in index.html
- [ ] Add CSS for search overlay
- [ ] Create search overlay HTML template
- [ ] Initialize SearchAddon in initTerminal()
- [ ] Add Ctrl+F keyboard handler
- [ ] Implement openSearch()
- [ ] Implement closeSearch()
- [ ] Implement performSearch()
- [ ] Implement searchNext()
- [ ] Implement searchPrevious()
- [ ] Implement toggleSearchCase()
- [ ] Implement toggleSearchRegex()
- [ ] Implement updateSearchCounter()
- [ ] Implement handleSearchKeydown()
- [ ] Test in local terminal
- [ ] Test in SSH terminal
- [ ] Test case-sensitive mode
- [ ] Test regex mode
- [ ] Test with no matches
- [ ] Test Esc to close
- [ ] Update sw.js cache version
- [ ] Add to keyboard shortcuts help

---

**Implementation Status:** 📝 Ready to implement  
**Next Step:** Download xterm-addon-search.js  
**Estimated Time:** 2-3 hours

---


