import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, email: string, password: string, heading: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

test('kid sees a friendly daily plan, large completion actions, and separated money', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'day-kid@example.test', 'synthetic-day-kid-password', "Day Kid's My Day");
  await expect(page.getByText('Your day', { exact: true })).toBeVisible();
  for (const heading of ['To do today', 'Needs rework', 'Overdue', 'Awaiting approval', 'Coming up soon', 'Later', 'Recently completed', 'Coming up']) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Needs rework' }).getByText('Please put the books back neatly')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Awaiting approval' }).getByText('Waiting for parent verification').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently completed' }).getByText('Approved! You earned $2.50!').first()).toBeVisible();
  const earnings = page.getByRole('article', { name: 'Earnings for Day Kid' });
  await expect(earnings.getByText('Waiting for verification: $3.00')).toBeVisible();
  await expect(earnings.getByText('Verified earnings owed: $5.00')).toBeVisible();
  await expect(page.getByText('Pending money is not earned until a parent checks your work.')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Chore: Day today 1' })).toBeVisible();
  const button = page.getByRole('article', { name: 'Chore: Day today 1' }).getByRole('button', { name: 'Mark complete' });
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await expect(page.getByRole('article', { name: 'Chore: Day today 1' }).getByText('$2.00 reward')).toBeVisible();
  const siblingResponse = await page.request.get('/dashboard');
  const siblingHtml = await siblingResponse.text();
  expect(siblingHtml).not.toContain('Day sibling secret chore');
  expect(siblingHtml).not.toContain('Day sibling secret payment');
  await page.screenshot({ path: testInfo.outputPath('kid-my-day-mobile.png'), fullPage: true });

  await button.click();
  await expect(page.getByRole('status')).toContainText('Nice job! Waiting for a parent to check.');
  await expect(page.getByRole('region', { name: 'Awaiting approval' }).getByRole('article', { name: 'Chore: Day today 1' })).toBeVisible();
  await expect(earnings.getByText('Waiting for verification: $5.00')).toBeVisible();
  await expect(earnings.getByText('Verified earnings owed: $5.00')).toBeVisible();
  await expect(page.getByRole('region', { name: 'To do today' }).getByRole('article')).toHaveCount(2);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('kid-my-day-desktop.png'), fullPage: true });
});

test('kid completion works without JavaScript', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'day-kid@example.test', 'synthetic-day-kid-password', "Day Kid's My Day");
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto('/dashboard');
    const card = native.getByRole('article', { name: 'Chore: Day today 2' });
    await card.getByRole('button', { name: 'Mark complete' }).click();
    await expect(native.getByRole('status')).toContainText('Nice job! Waiting for a parent to check.');
    await expect(native.getByRole('region', { name: 'Awaiting approval' }).getByRole('article', { name: 'Chore: Day today 2' })).toBeVisible();
    await expect(native.getByRole('article', { name: 'Earnings for Day Kid' }).getByText('Waiting for verification:')).toBeVisible();
    await native.screenshot({ path: testInfo.outputPath('kid-my-day-native.png'), fullPage: true });
  } finally { await context.close(); }
});

test('empty kid day is calm and clear', async ({ page }) => {
  await signIn(page, 'day-empty-kid@example.test', 'synthetic-day-empty-kid-password', "Day Empty Kid's My Day");
  await expect(page.getByRole('heading', { name: 'To do today', exact: true })).toBeVisible();
  await expect(page.getByText('No chores yet. Enjoy your day!')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Earnings for Day Empty Kid' }).getByText('Verified earnings owed: $0.00')).toBeVisible();
});
