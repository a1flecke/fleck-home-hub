import { expect, test } from '@playwright/test';

test('a parent reviews and resolves individual missed dates using native forms', async ({ page, browser }, testInfo) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /hello|my day/i })).toBeVisible();
  const title = `Recovery journey ${testInfo.repeatEachIndex}`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shift = (days: number) => new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  async function createSeries(name: string) {
    const panel = page.locator('details').filter({ has: page.getByText('Add a recurring chore', { exact: true }) });
    await panel.getByText('Add a recurring chore', { exact: true }).click();
    const series = panel.locator('form');
    await series.getByLabel('Recurring chore title').fill(name);
    await series.getByLabel('Recurring assigned child').selectOption({ label: 'Sample Kid' });
    await series.getByLabel('Starts on').fill(shift(-3));
    for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await series.getByLabel(day, { exact: true }).check();
    await series.getByLabel('Recurring reward in dollars').fill('2.00');
    await series.getByRole('button', { name: 'Add recurring chore' }).click();
    const schedule = page.getByRole('article')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Skip occurrence', exact: true }) });
    await expect(schedule).toBeVisible();
  }
  const neighbor = 'Before ' + title;
  await createSeries(neighbor);
  await createSeries(title);
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto('/chores/recovery');
    const card = (date: string) => native.getByRole('article').filter({ has: native.getByRole('heading', { name: title, exact: true }) }).filter({ has: native.locator(`time[datetime="${date}"]`) });
    for (let index = 0; index < 100 && await card(shift(-3)).count() === 0; index++) {
      await native.getByRole('link', { name: 'Next chore' }).click();
    }
    await expect(card(shift(-3))).toBeVisible();
    const reviewUrl = native.url();
    const previous = native.getByRole('link', { name: 'Previous chore' });
    await previous.click();
    await expect(native).not.toHaveURL(reviewUrl);
    await expect(card(shift(-3))).toHaveCount(0);
    await native.getByRole('link', { name: 'Next chore' }).click();
    await expect(native).toHaveURL(reviewUrl);
    await expect(card(shift(-3))).toBeVisible();
    await expect(card(shift(-2))).toBeVisible();
    await expect(card(shift(-1))).toBeVisible();
    await card(shift(-3)).getByRole('button', { name: 'Skip this date' }).click();
    await expect(native.getByRole('status')).toContainText('Date skipped');
    await expect(card(shift(-3))).toHaveCount(0);
    const create = card(shift(-2));
    await create.getByLabel('Confirmed reward in dollars').fill('1.50');
    await create.getByLabel('I confirm this late chore').check();
    await create.getByRole('button', { name: 'Create late chore' }).click();
    await expect(native.getByRole('status')).toContainText('Late chore created');
    await expect(card(shift(-2))).toHaveCount(0);
    await expect(card(shift(-1))).toBeVisible();
    await native.screenshot({ path: testInfo.outputPath('recovery-mobile.png'), fullPage: true });
  } finally { await context.close(); }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /hello|my day/i })).toBeVisible();
  const occurrence = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).filter({ hasText: `Due ${shift(-2)}` });
  await expect(occurrence).toBeVisible();
  await occurrence.getByRole('button', { name: 'Mark complete' }).click();
  await expect(occurrence.getByText('Waiting for parent verification')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /hello|my day/i })).toBeVisible();
  await occurrence.getByRole('button', { name: 'Verify' }).click();
  await expect(occurrence.getByText('Approved! You earned $1.50!')).toBeVisible();
});
