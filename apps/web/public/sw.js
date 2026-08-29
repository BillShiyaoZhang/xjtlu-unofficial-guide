const CACHE_NAME = 'xjtlu-guide-offline-v1';
const OFFLINE_URL = '/offline.html';
const PRIVATE_PREFIXES = [
  '/v1',
  '/editor',
  '/signin-with-chatgpt',
  '/report',
  '/reports',
  '/research-intake',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.add(new Request(OFFLINE_URL, { cache: 'reload' })),
      ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PRIVATE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      const fallback = await caches.match(OFFLINE_URL);
      return fallback ?? Response.error();
    }),
  );
});
