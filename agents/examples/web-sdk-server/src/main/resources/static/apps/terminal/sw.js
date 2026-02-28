/**
 * Service Worker for Messaging Platform - Shared Terminal PWA
 * Enables offline functionality by caching all terminal assets
 */

const CACHE_NAME = 'messaging-platform-shared-terminal-v1.6.0';
const CACHE_TIMESTAMP = '2026-02-28';

// Files to cache for offline use
const STATIC_ASSETS = [
    // Main app files
    './index.html',
    './terminal.js',
    './terminal.css',
    './terminal-sharing.js',
    './file-explorer.js',
    './file-explorer.css',
    './file-editor.js',
    './file-editor.css',
    './note-editor.js',
    './note-editor.css',
    './manifest.json',

    // CodeMirror Core
    './libs/codemirror/css/codemirror.min.css',
    './libs/codemirror/theme/monokai.min.css',
    './libs/codemirror/js/codemirror.min.js',

    // CodeMirror Language Modes
    './libs/codemirror/mode/javascript/javascript.min.js',
    './libs/codemirror/mode/xml/xml.min.js',
    './libs/codemirror/mode/css/css.min.js',
    './libs/codemirror/mode/htmlmixed/htmlmixed.min.js',
    './libs/codemirror/mode/python/python.min.js',
    './libs/codemirror/mode/markdown/markdown.min.js',
    './libs/codemirror/mode/yaml/yaml.min.js',
    './libs/codemirror/mode/shell/shell.min.js',
    './libs/codemirror/mode/sql/sql.min.js',
    './libs/codemirror/mode/clike/clike.min.js',
    './libs/codemirror/mode/php/php.min.js',
    './libs/codemirror/mode/ruby/ruby.min.js',
    './libs/codemirror/mode/go/go.min.js',
    './libs/codemirror/mode/rust/rust.min.js',
    './libs/codemirror/mode/swift/swift.min.js',
    './libs/codemirror/mode/properties/properties.min.js',

    // CodeMirror Addons
    './libs/codemirror/addon/edit/matchbrackets.min.js',
    './libs/codemirror/addon/edit/closebrackets.min.js',
    './libs/codemirror/addon/selection/active-line.min.js',
    './libs/codemirror/addon/scroll/annotatescrollbar.min.js',
    './libs/codemirror/addon/search/searchcursor.min.js',
    './libs/codemirror/addon/search/matchesonscrollbar.css',
    './libs/codemirror/addon/search/match-highlighter.min.js',
    './libs/codemirror/addon/search/matchesonscrollbar.min.js',

    // Dependencies (from parent directories - adjust paths as needed)
    '../../../lib/xterm/xterm.js',
    '../../../lib/xterm/xterm.css',
    '../../../lib/xterm/xterm-addon-fit.js',
    '../../../lib/qrcode/qrcode.min.js',
    '../../web-agent.js',
    '../../UserConnectionBase.js',

    // Web SDK server base (if needed)
    '../../../',
];

// Install event - cache all static assets
self.addEventListener('install', (event) => {
    console.log('[ServiceWorker] Installing...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[ServiceWorker] Caching app shell');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[ServiceWorker] All assets cached');
                return self.skipWaiting(); // Activate immediately
            })
            .catch((error) => {
                console.error('[ServiceWorker] Cache failed:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[ServiceWorker] Activating...');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[ServiceWorker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[ServiceWorker] Activated');
            return self.clients.claim(); // Take control immediately
        })
    );
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip WebSocket connections
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        return;
    }

    // Skip API calls to SLS/MLS (localhost:8088)
    if (url.hostname === 'localhost' && url.port === '8088') {
        // Let these requests go through to network (SLS service)
        return;
    }

    // Skip cloud messaging WebSocket/API calls
    if (url.hostname.includes('messaging') || url.pathname.includes('/api/')) {
        return;
    }

    // Strategy: Cache First, falling back to Network
    event.respondWith(
        caches.match(request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    console.log('[ServiceWorker] Serving from cache:', url.pathname);
                    return cachedResponse;
                }

                // Not in cache - fetch from network
                console.log('[ServiceWorker] Fetching from network:', url.pathname);
                return fetch(request).then((response) => {
                    // Don't cache if not a success response
                    if (!response || response.status !== 200 || response.type === 'error') {
                        return response;
                    }

                    // Cache static assets for future use
                    if (shouldCacheResponse(url)) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                    }

                    return response;
                }).catch((error) => {
                    console.error('[ServiceWorker] Fetch failed:', error);

                    // If offline, return cached index.html as fallback
                    if (request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }

                    throw error;
                });
            })
    );
});

/**
 * Determine if a response should be cached
 */
function shouldCacheResponse(url) {
    // Cache static assets (JS, CSS, HTML, fonts, images)
    const cacheableExtensions = ['.js', '.css', '.html', '.png', '.jpg', '.svg', '.woff', '.woff2', '.json'];
    return cacheableExtensions.some(ext => url.pathname.endsWith(ext));
}

// Listen for messages from the app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CACHE_URLS') {
        event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.addAll(event.data.urls);
            })
        );
    }
});

console.log('[ServiceWorker] Loaded - Cache:', CACHE_NAME, 'Timestamp:', CACHE_TIMESTAMP);

