const CACHEABLE_ASSET_PATHS = new Set([
  '/apple-touch-icon.png',
  '/favicon-32.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/icon-maskable.svg',
  '/icon.svg',
  '/manifest.webmanifest',
  '/service-worker.js'
]);

/** Default-deny caching for every dynamic SvelteKit route, data endpoint and API response. */
export function isDynamicResponsePath(pathname: string): boolean {
  return !pathname.startsWith('/_app/immutable/') && !CACHEABLE_ASSET_PATHS.has(pathname);
}

export function applySecurityHeaders(response: Response, pathname: string): Response {
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set(
    'referrer-policy',
    pathname.startsWith('/accept-invitation') || pathname.startsWith('/settings/household') ? 'origin' : 'same-origin'
  );
  if (isDynamicResponsePath(pathname)) {
    response.headers.set('cache-control', 'no-store');
  }
  return response;
}
