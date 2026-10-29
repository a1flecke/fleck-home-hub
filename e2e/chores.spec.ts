import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, role: 'parent' | 'kid') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(`${role}@example.test`);
  await page.getByLabel('Password').fill(`synthetic-${role}-password`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /hello|my day/i })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
}

async function create(page: Page, title: string) {
  await page.getByText('Add a chore', { exact: true }).click();
  await page.getByLabel('Chore title').fill(title);
  await page.getByLabel('Assigned child').selectOption({ label: 'Sample Kid' });
  await page.getByLabel('Due date').fill('2026-11-01');
  await page.getByLabel('Reward in dollars').fill('2.00');
  await page.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.getByText(title)).toBeVisible();
}

test('child submits and parent verifies a paid chore', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'parent');
  await create(page, 'Feed the cat');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('parent-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await signOut(page);
  await signIn(page, 'kid');
  const kidChore = page.getByRole('article').filter({ hasText: 'Feed the cat' });
  const choreId = await kidChore.locator('input[name="id"]').inputValue();
  await kidChore.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('Nice job! Waiting for a parent to check.')).toBeVisible();
  await expect(page.getByText('Waiting for verification: $2.00')).toBeVisible();
  await expect(page.getByText('Verified earnings owed: $0.00')).toBeVisible();
  const unauthorized = await page.request.post('/dashboard?/transition', { form: { id: choreId, action: 'verify' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(unauthorized.status()).not.toBe(200);
  await page.screenshot({ path: testInfo.outputPath('kid-mobile.png'), fullPage: true });
  await signOut(page);
  await signIn(page, 'parent');
  await page.getByRole('article').filter({ hasText: 'Feed the cat' }).getByRole('button', { name: 'Verify' }).click();
  await signOut(page);
  await signIn(page, 'kid');
  await expect(page.getByText('Approved! You earned $2.00!')).toBeVisible();
});

test('parent returns work and child resubmits before verification', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'parent');
  await create(page, 'Tidy the table');
  await signOut(page);
  await signIn(page, 'kid');
  await page.getByRole('article').filter({ hasText: 'Tidy the table' }).getByRole('button', { name: 'Mark complete' }).click();
  await signOut(page);
  await signIn(page, 'parent');
  const chore = page.getByRole('article').filter({ hasText: 'Tidy the table' });
  await chore.getByLabel('Rework reason').fill('Please wipe the corners');
  await chore.getByRole('button', { name: 'Needs rework' }).click();
  await signOut(page);
  await signIn(page, 'kid');
  await expect(page.getByText('Please wipe the corners')).toBeVisible();
  await page.getByRole('article').filter({ hasText: 'Tidy the table' }).getByRole('button', { name: 'Mark complete' }).click();
  await signOut(page);
  await signIn(page, 'parent');
  await page.getByRole('article').filter({ hasText: 'Tidy the table' }).getByRole('button', { name: 'Verify' }).click();
  await signOut(page);
  await signIn(page, 'kid');
  await expect(page.getByRole('article').filter({ hasText: 'Tidy the table' }).getByText('Approved! You earned $2.00!')).toBeVisible();
});

test('server rejects anonymous, child and cross-origin mutations and hides other assignments', async ({ page }) => {
  const url = '/dashboard?/create';
  const body = { title: 'Forged chore', assignee: 'invalid', dueDate: '2026-11-01', reward: '2' };
  const anonymous = await page.request.post(url, { form: body, headers: { origin: 'http://127.0.0.1:4173' }, maxRedirects: 0 });
  expect(await anonymous.json()).toMatchObject({ type: 'redirect', status: 303, location: '/sign-in' });
  await signIn(page, 'parent');
  await expect(page.getByText('Forged chore')).toHaveCount(0);
  await page.getByText('Add a chore', { exact: true }).click();
  await page.getByLabel('Chore title').fill('Private assignment');
  await page.getByLabel('Assigned child').selectOption({ label: 'Other Kid' });
  await page.getByLabel('Due date').fill('2026-11-01');
  await page.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.getByText('Private assignment')).toBeVisible();
  const kidId = await page.getByLabel('Assigned child').locator('option', { hasText: 'Sample Kid' }).getAttribute('value');
  const forged = await page.request.post(url, { form: body, headers: { origin: 'https://attacker.example.test' } });
  expect(forged.status()).toBe(403);
  await signOut(page);
  await signIn(page, 'kid');
  await expect(page.getByText('Private assignment')).toHaveCount(0);
  const child = await page.request.post(url, { form: { ...body, assignee: kidId! }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(child.status()).not.toBe(200);
});
