// Service Worker - Clear cache on update
const CACHE_VERSION = 'v13-emergency-db-fix';
const CACHE_URLS = [
    'app.html',
    'index.html',
    'css/style.css',
    'js/app.js',
    'js/firebase-config.js',
    'js/ui.js',
    'js/database.js'
];

self.addEventListener('install', (event) => {
    console.log('Service Worker installing - clearing old caches');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_VERSION) {
                        console.log('Deleting cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activating');
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Network first strategy with fallback to cache
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful responses
                if (response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_VERSION).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback to cache if network fails
                return caches.match(event.request).then((cachedResponse) => {
                    return cachedResponse || new Response('Offline');
                });
            })
    );
});
