import { expect, test } from '@playwright/test';

type ManifestIcon = { src: string; type: string };

test('manifest and every declared icon are served with installable metadata', async ({ page, request }) => {
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');

  const manifest = await manifestResponse.json() as { start_url: string; icons: ManifestIcon[] };
  expect(manifest.start_url).toBe('/dashboard');
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.status(), `${icon.src} must be served`).toBe(200);
    expect(response.headers()['content-type']).toContain(icon.type);
  }

  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/icon.svg');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f766e');
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.length))).toBe(0);
});

test('the installed start URL requires sign-in and then launches authenticated household data', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json() as { start_url: string };
  const signedOut = await request.get(manifest.start_url, { maxRedirects: 0 });
  expect(signedOut.status()).toBe(303);
  expect(signedOut.headers()['location']).toMatch(/\/sign-in$/);

  await page.goto(manifest.start_url);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Parent dashboard')).toBeVisible({ timeout: 5000 });

  await page.goto(manifest.start_url);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Parent dashboard')).toBeVisible();
});
