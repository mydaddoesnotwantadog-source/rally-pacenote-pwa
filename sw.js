const CACHE_NAME = 'rally-pwa-v25';

const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/js/app.js',
    '/js/route_manager.js',
    '/js/pacenote_engine.js',
    '/js/execution_engine.js'
];

// Placeholder for audio files we'd cache
const AUDIO_ASSETS = [
    // '/audio/left_5.m4a'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then((cache) => cache.addAll([...APP_SHELL, ...AUDIO_ASSETS]))
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
    
    // Bypass SW for map tiles. Leaflet aggressively aborts fetch requests when panning,
    // which causes standard SW fetch handlers to crash and leave blank gray tiles.
    if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('cartocdn.com')) {
        return; // Let the browser handle these directly
    }

    event.respondWith(
        caches.match(event.request)
        .then((response) => response || fetch(event.request))
    );
});
