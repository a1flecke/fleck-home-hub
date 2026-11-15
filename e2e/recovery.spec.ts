import { expect, test, type Page } from '@playwright/test';

async function signInParent(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /hello|my day/i })).toBeVisible();
}

function dateOffset(days: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

async function createSeries(page: Page, name: string, startDate: string) {
  const panel = page.locator('details').filter({ has: page.getByText('Add a recurring chore', { exact: true }) });
  await panel.getByText('Add a recurring chore', { exact: true }).click();
  const series = panel.locator('form');
  await series.getByLabel('Recurring chore title').fill(name);
  await series.getByLabel('Recurring assigned child').selectOption({ label: 'Sample Kid' });
  await series.getByLabel('Starts on').fill(startDate);
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await series.getByLabel(day, { exact: true }).check();
  await series.getByLabel('Recurring reward in dollars').fill('2.00');
  await series.getByRole('button', { name: 'Add recurring chore' }).click();
  const schedule = page.getByRole('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Skip occurrence', exact: true }) });
  await expect(schedule).toBeVisible();
}

test('a parent reviews and resolves individual missed dates using native forms', async ({ page, browser }, testInfo) => {
  await signInParent(page);
  const title = `Recovery journey ${testInfo.repeatEachIndex}`;
  const neighbor = 'Before ' + title;
  await createSeries(page, neighbor, dateOffset(-3));
  await createSeries(page, title, dateOffset(-3));
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto('/chores/recovery');
    const card = (date: string) => native.getByRole('article').filter({ has: native.getByRole('heading', { name: title, exact: true }) }).filter({ has: native.locator(`time[datetime="${date}"]`) });
    for (let index = 0; index < 100 && await card(dateOffset(-3)).count() === 0; index++) {
      await native.getByRole('link', { name: 'Next chore' }).click();
    }
    await expect(card(dateOffset(-3))).toBeVisible();
    const reviewUrl = native.url();
    const previous = native.getByRole('link', { name: 'Previous chore' });
    await previous.click();
    await expect(native).not.toHaveURL(reviewUrl);
    await expect(card(dateOffset(-3))).toHaveCount(0);
    await native.getByRole('link', { name: 'Next chore' }).click();
    await expect(native).toHaveURL(reviewUrl);
    await expect(card(dateOffset(-3))).toBeVisible();
    await expect(card(dateOffset(-2))).toBeVisible();
    await expect(card(dateOffset(-1))).toBeVisible();
    await card(dateOffset(-3)).getByRole('button', { name: 'Skip this date' }).click();
    await expect(native.getByRole('status')).toContainText('Date skipped');
    await expect(card(dateOffset(-3))).toHaveCount(0);
    const create = card(dateOffset(-2));
    const reward = create.getByLabel('Confirmed reward in dollars');
    const confirmed = create.getByLabel('I confirm this late chore');
    await reward.fill('1.555');
    await confirmed.check();
    await create.getByRole('button', { name: 'Create late chore' }).click();
    await expect(native.getByRole('alert').filter({ hasText: 'Enter a reward' })).toBeVisible();
    await expect(reward).toHaveValue('1.555');
    await expect(confirmed).toBeChecked();
    await expect(card(dateOffset(-1))).toBeVisible();
    await reward.fill('1.50');
    await create.getByRole('button', { name: 'Create late chore' }).click();
    await expect(native.getByRole('status')).toContainText('Late chore created');
    await expect(card(dateOffset(-2))).toHaveCount(0);
    await expect(card(dateOffset(-1))).toBeVisible();
    await native.screenshot({ path: testInfo.outputPath('recovery-mobile.png'), fullPage: true });
  } finally { await context.close(); }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /hello|my day/i })).toBeVisible();
  const occurrence = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).filter({ hasText: `Due ${dateOffset(-2)}` });
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

test('recovery keeps edits through delayed hydration and a rejected submission', async ({ page }, testInfo) => {
  await signInParent(page);
  const title = 'Recovery hydration ' + testInfo.repeatEachIndex;
  const date = dateOffset(-2);
  await createSeries(page, title, date);
  await page.goto('/chores/recovery');
  const form = page.getByRole('form', { name: 'Create late chore for ' + title + ' on ' + date, exact: true });
  for (let index = 0; index < 100 && await form.count() === 0; index++) {
    await page.getByRole('link', { name: 'Next chore', exact: true }).click();
  }
  await expect(form).toBeVisible();
  const reviewUrl = page.url();
  const reward = form.getByLabel('Confirmed reward in dollars');
  const confirmed = form.getByLabel('I confirm this late chore');

  // The root layout calls register from onMount, which runs after hydration.
  await page.addInitScript(() => {
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (...args) => {
      document.documentElement.dataset.recoveryHydrated = 'true';
      return register(...args);
    };
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const module = '**/src/routes/chores/recovery/+page.svelte*';
  await page.route(module, async route => { await gate; await route.continue(); });
  try {
    const requested = page.waitForRequest(module, { timeout: 5000 });
    await Promise.all([page.goto(reviewUrl, { waitUntil: 'commit' }), requested]);
    await reward.fill('1.75');
    await confirmed.check();
    await reward.selectText();
    await expect(page.locator('html')).not.toHaveAttribute('data-recovery-hydrated', 'true');
  } finally {
    release();
  }
  await expect(page.locator('html')).toHaveAttribute('data-recovery-hydrated', 'true');
  await page.unroute(module);
  await expect(reward).toHaveValue('1.75');
  await expect(confirmed).toBeChecked();
  expect(await reward.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 4]);
  await page.keyboard.insertText('1.755');

  await form.getByRole('button', { name: 'Create late chore', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter a reward' })).toBeVisible();
  await expect(reward).toHaveValue('1.755');
  await expect(confirmed).toBeChecked();
  expect(await page.getByRole('form', { name: 'Create late chore for ' + title + ' on ' + dateOffset(-1), exact: true })
    .getByLabel('Confirmed reward in dollars').inputValue()).toBe('');

  await reward.fill('1.75');
  const submitted = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/chores/recovery?/decide'));
  await form.getByRole('button', { name: 'Create late chore', exact: true }).click();
  const fields = new URLSearchParams((await submitted).postData() ?? '');
  expect(fields.get('confirmed')).toBe('yes');
  expect(fields.get('reward')).toBe('1.75');
  await expect(page.getByRole('status').filter({ hasText: 'Late chore created' })).toBeVisible();
  await expect(form).toHaveCount(0);
});
