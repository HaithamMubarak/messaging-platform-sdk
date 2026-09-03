/*
 * The service worker a Knock lands in.
 *
 * A knock carries NO PAYLOAD, so this file cannot say what happened — and that
 * is the design, not a limitation to work around later. The push service sees
 * an empty POST; this worker shows a generic notice; the page fetches the real
 * thing over the authenticated channel when somebody opens it.
 *
 * Serve it from the ROOT of whatever scope needs it. A service worker's scope
 * is its own directory: /js/knock-sw.js can only control /js/*, which is the
 * single most common reason push "silently does nothing".
 */

self.addEventListener('push', (event) => {
    // Browsers require a visible notification for every push (userVisibleOnly).
    // Swallowing one costs the site its push permission, so there is no path
    // through here that shows nothing.
    let title = 'Something is waiting';
    let body = 'Open to see what changed.';

    // A payload is not expected. If a future feature ever sends one, honour it
    // rather than ignoring it — but never REQUIRE it.
    if (event.data) {
        try {
            const data = event.data.json();
            title = data.title || title;
            body = data.body || body;
        } catch (e) { /* not JSON: keep the generic text */ }
    }

    event.waitUntil(self.registration.showNotification(title, {
        body: body,
        // One waiting notice, not a pile: repeats about the same thing collapse.
        tag: 'knock',
        renotify: false,
        requireInteraction: false
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // Focus a tab that is already open before making another one.
        for (const client of all) {
            if ('focus' in client) return client.focus();
        }
        if (self.clients.openWindow) {
            return self.clients.openWindow('/');
        }
    })());
});
