// Minimal share-target bridge. This worker deliberately does not cache or serve
// offline content; every request except a Web Share Target POST goes to the network.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/meals/share') {
    event.respondWith(fetch(event.request));
  }
});
