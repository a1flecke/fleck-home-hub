import { expect, test } from '@playwright/test';

test('shared display and sign-in are usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).display).toBe('standalone');
  const home = await page.goto('/');
  expect(home?.headers()['x-content-type-options']).toBe('nosniff');
  expect(home?.headers()['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
  await expect(page.getByText('This preview contains example data only.')).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('parent and child sessions enforce access at the API', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Parent dashboard')).toBeVisible({ timeout: 5000 });
  const dashboard = await page.reload();
  expect(dashboard?.headers()['cache-control']).toContain('no-store');
  const actionRequest = page.waitForRequest(request => request.url().includes('/parent-test'));
  await page.getByRole('button', { name: 'Check parent access' }).click();
  const parentUrl = (await actionRequest).url();
  await expect(page.getByRole('status')).toHaveText('Parent access confirmed.');
  expect((await page.request.post(parentUrl, { headers: { origin: 'https://attacker.example.test' } })).status()).toBe(403);
  expect((await page.request.post(parentUrl)).status()).toBe(403);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Your day')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Check parent access' })).toHaveCount(0);
  expect((await page.request.post(parentUrl, { headers: { origin: 'http://127.0.0.1:4173' } })).status()).toBe(403);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
  expect((await page.request.post(parentUrl)).status()).toBe(401);
});
