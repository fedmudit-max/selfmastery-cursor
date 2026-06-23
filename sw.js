const CACHE_NAME = 'king-v12';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './data.js',
    './logic.js',
    './ui-main.js',
    './ui-overlays.js',
    './ui-actions.js',
    './ui-history.js',
    './ui-day.js',
    './boot.js',
    './manifest.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

/** App code: network first (fresh updates), cache as offline fallback. */
function networkFirst(request) {
    return fetch(request)
        .then((response) => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
        })
        .catch(() => caches.match(request));
}

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const path = new URL(event.request.url).pathname;
    const isAppFile = /\.(js|css|html)$/.test(path);

    event.respondWith(
        isAppFile
            ? networkFirst(event.request)
            : caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});
