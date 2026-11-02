import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, posix } from 'node:path';

const root = process.cwd();
const staticDirectory = join(root, 'static');
const manifestPath = join(staticDirectory, 'manifest.webmanifest');

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type WebManifest = {
  name: string;
  short_name: string;
  description: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
};

function readManifest(): WebManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as WebManifest;
}

function pngDimensions(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function sourceText(directory: string): string {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

describe('installable PWA assets', () => {
  it('declares accurate names, colors, scope and an authenticated start URL', () => {
    const manifest = readManifest();
    expect(manifest.name).toBe('Fleck Home Hub');
    expect(manifest.short_name).toBe('Home Hub');
    expect(manifest.description.trim()).not.toBe('');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#faf8f1');
    expect(manifest.theme_color).toBe('#0f766e');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.id).toBe('/');

    const scope = new URL(manifest.scope, 'https://hub.invalid');
    const start = new URL(manifest.start_url, 'https://hub.invalid');
    expect(start.pathname.startsWith(scope.pathname)).toBe(true);
  });

  it('declares SVG, PNG and maskable icons that all exist', () => {
    const manifest = readManifest();
    expect(manifest.icons).toEqual([
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]);

    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(true);
      expect(icon.src.startsWith('//')).toBe(false);
      const path = join(staticDirectory, ...icon.src.split('/').filter(Boolean));
      expect(posix.normalize(path).startsWith(staticDirectory)).toBe(true);
      expect(existsSync(path), `${icon.src} must exist`).toBe(true);
      expect(extname(path)).toBe(icon.type === 'image/png' ? '.png' : '.svg');
    }
  });

  it('ships correctly sized PNG installation icons', () => {
    expect(pngDimensions(join(staticDirectory, 'icon-192.png'))).toEqual({ width: 192, height: 192 });
    expect(pngDimensions(join(staticDirectory, 'icon-512.png'))).toEqual({ width: 512, height: 512 });
    expect(pngDimensions(join(staticDirectory, 'icon-maskable-512.png'))).toEqual({ width: 512, height: 512 });
    expect(pngDimensions(join(staticDirectory, 'apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
    expect(pngDimensions(join(staticDirectory, 'favicon-32.png'))).toEqual({ width: 32, height: 32 });
  });

  it('does not advertise or register offline behavior that is not implemented', () => {
    const manifest = readManifest();
    expect(manifest).not.toHaveProperty('serviceworker');
    expect(manifest).not.toHaveProperty('service_worker');
    expect(sourceText(join(root, 'src'))).not.toMatch(/serviceWorker\s*\.\s*register|navigator\.serviceWorker/);
    expect(sourceText(staticDirectory)).not.toMatch(/serviceWorker\s*\.\s*register|navigator\.serviceWorker/);
    expect(existsSync(join(staticDirectory, 'sw.js'))).toBe(false);
  });
});
