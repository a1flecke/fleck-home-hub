import { expect, test } from '@playwright/test';
import { hydrated, settle } from './support/navigation';

test('sign-in cannot submit before hydration', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  } finally { await context.close(); }
});

test('sign-in preserves credentials typed before hydration and signs in', async ({ page }) => {
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { requested = resolve; });
  const pageModule = '**/src/routes/sign-in/+page.svelte*';
  await page.route(pageModule, async route => { requested(); await gate; await route.continue(); });
  try {
    await page.goto('/sign-in', { waitUntil: 'commit' });
    await blocked;
    const email = page.getByLabel('Email');
    const password = page.getByLabel('Password');
    await email.fill('parent@example.test');
    await password.fill('synthetic-parent-password');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    release();
    await hydrated(page);
    await expect(email).toHaveValue('parent@example.test');
    await expect(password).toHaveValue('synthetic-parent-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Parent dashboard')).toBeVisible({ timeout: 5000 });
  } finally {
    release();
    await page.unroute(pageModule);
  }
});

test('leftover parent-test API route is not exposed', async ({ request }) => {
  const response = await request.post('/api/households/any/parent-test', {
    headers: { origin: 'http://127.0.0.1:4173' }
  });
  expect(response.status()).toBe(404);
});

test('shared display and sign-in are usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).display).toBe('standalone');
  const home = await page.goto('/');
  expect(home?.headers()['x-content-type-options']).toBe('nosniff');
  expect(home?.headers()['x-frame-options']).toBe('DENY');
  expect(home?.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(home?.headers()['content-security-policy']).toContain("object-src 'none'");
  expect(home?.headers()['strict-transport-security']).toBeUndefined();
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'document.body.setAttribute("data-csp-test", "executed")';
    document.body.append(script);
  });
  await expect(page.locator('body')).not.toHaveAttribute('data-csp-test', 'executed');
  expect(await page.locator('body > div').evaluate(element => getComputedStyle(element).display)).toBe('contents');
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
  await expect(page.getByText('This preview contains example data only.')).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await settle(page);
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
  const dataResponse = await page.request.get('/dashboard/__data.json');
  expect(dataResponse.status()).toBe(200);
  expect(dataResponse.headers()['cache-control']).toContain('no-store');
  for (const route of ['/chores/week', '/chores/week/again', '/sign-in']) {
    const response = await page.request.get(route, { maxRedirects: 0 });
    expect(response.headers()['cache-control'], route).toContain('no-store');
  }
  await expect(page.getByText('Add a chore', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await settle(page);
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Your day', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Add a chore', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
});
