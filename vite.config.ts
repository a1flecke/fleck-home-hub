import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({ cacheDir: process.env.E2E_VITE_CACHE_DIR, plugins: [tailwindcss(), sveltekit({
  adapter: adapter(),
  csp: { directives: { 'default-src': ['self'], 'script-src': ['self'], 'style-src': ['self'], 'object-src': ['none'], 'base-uri': ['self'], 'frame-ancestors': ['none'], 'form-action': ['self'] } },
  ...(process.env.AUTH_ORIGIN ? { paths: { origin: process.env.AUTH_ORIGIN } } : {})
})] });
