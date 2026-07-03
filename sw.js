const CACHE_NAME = 'rally-pwa-v28';

const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/js/app.js',
    '/js/route_manager.js',
    '/js/pacenote_engine.js',
    '/js/execution_engine.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(APP_SHELL))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) return caches.delete(key);
            }));
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Bypass SW for map tiles
    if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('cartocdn.com')) {
        return; 
    }

    event.respondWith(
        caches.match(event.request)
        .then((response) => {
            if (response) return response;
            return fetch(event.request).then((networkResponse) => {
                // Dynamically cache audio files as they are loaded
                if (url.pathname.includes('/audio/')) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Return offline fallback if needed
            });
        })
    );
});
