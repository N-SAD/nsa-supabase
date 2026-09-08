// Service Worker NSA ERP - version 202609081407
const CACHE_NAME = 'nsa-erp-202609081407';
const URLS = ['/mobile', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Toujours réseau en priorité pour avoir la dernière version
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
