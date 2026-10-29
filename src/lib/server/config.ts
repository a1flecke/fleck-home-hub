export function readIdentityConfig(env: Record<string, string | undefined>) {
  const secret = env.AUTH_SECRET;
  const dbPath = env.DATABASE_PATH;
  if (!secret || secret.length < 32 || !dbPath) throw new Error('AUTH_SECRET (at least 32 characters) and DATABASE_PATH are required');
  let url: URL;
  try { url = new URL(env.AUTH_ORIGIN ?? ''); } catch { throw new Error('AUTH_ORIGIN must be an absolute URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('AUTH_ORIGIN must be an HTTPS origin, or localhost over HTTP');
  }
  return { secret, origin: url.origin, dbPath };
}
