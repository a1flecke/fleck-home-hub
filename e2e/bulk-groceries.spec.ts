import { expect, test, type Locator, type Page } from '@playwright/test';

async function signInAsBulk(page: Page, key: string) {
  const origin = 'http://127.0.0.1:4173';
  const login = await page.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin },
    data: {
      email: `grocery-parent-${key}@example.test`,
      password: `synthetic-grocery-parent-${key}-password`
    }
  });
  expect(login.status(), 'the bulk-grocery fixture signed in').toBe(200);
}

async function openBulk(page: Page) {
  await page.goto('/groceries');
  await page.getByRole('link', { name: 'Paste several items at once' }).click();
  await expect(page.getByRole('heading', { name: 'Add several groceries' })).toBeVisible();
}

async function pasteAndReview(page: Page, lines: string[]) {
  await page.getByLabel('Paste your list').fill(lines.join('\n'));
  await page.getByRole('button', { name: 'Review list' }).click();
  const review = page.getByRole('region', { name: 'Review bulk groceries' });
  await expect(review).toBeVisible();
  return review;
}

function lineGroup(review: Locator, line: string) {
  return review.getByRole('group', { name: new RegExp(`Original line: ${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
}

async function showBought(page: Page) {
  const bought = page.locator('details[data-grocery-group="bought"]');
  if (!(await bought.evaluate(element => (element as HTMLDetailsElement).open))) await bought.locator(':scope > summary').click();
}

test('a member pastes a list, corrects an uncertain line, skips a match and adds the rest', async ({ page }, testInfo) => {
  const stamp = Date.now();
  const milk = `Synthetic bulk milk ${stamp}`;
  const bread = `Synthetic bulk bread ${stamp}`;
  const apples = `Synthetic bulk apples ${stamp}`;
  const rice = `Synthetic bulk rice ${stamp}`;
  const salt = `Salt to taste ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsBulk(page, 'bulk-a');
  await page.goto('/groceries');
  await page.screenshot({ path: testInfo.outputPath('bulk-link-mobile.png'), fullPage: true });

  const add = page.getByRole('form', { name: 'Add grocery item' });
  await add.getByLabel('Item', { exact: true }).fill(milk);
  await add.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('article').filter({ hasText: milk })).toBeVisible();

  await page.getByRole('link', { name: 'Paste several items at once' }).click();
  await expect(page.getByRole('heading', { name: 'Add several groceries' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('bulk-paste-mobile.png'), fullPage: true });
  const review = await pasteAndReview(page, [
    `2 gallons ${milk}`,
    `1 loaf ${bread}`,
    `3 ${apples}`,
    `2 ${apples}`,
    `2 cups ${rice}`,
    salt
  ]);

  await expect(review.getByRole('heading', { name: 'Review 6 items' })).toBeVisible();
  await expect(review.getByText('4 to add · 2 skipped')).toBeVisible();
  const milkLine = lineGroup(review, `2 gallons ${milk}`);
  const breadLine = lineGroup(review, `1 loaf ${bread}`);
  const duplicateApples = lineGroup(review, `2 ${apples}`);
  await expect(milkLine).toContainText(`Already on your list: ${milk}`);
  await expect(milkLine.getByRole('radio', { name: 'Skip this item' })).toBeChecked();
  await expect(duplicateApples).toContainText('also appears earlier in the pasted list');
  await expect(duplicateApples.getByRole('radio', { name: 'Skip this item' })).toBeChecked();
  await expect(breadLine).toContainText('could not be split confidently');
  await expect(breadLine.getByLabel('Item name')).toHaveValue(`1 loaf ${bread}`);

  await breadLine.getByLabel('Item name').fill(bread);
  await breadLine.getByLabel('Quantity').fill('1');
  await breadLine.getByLabel('Unit').fill('loaf');
  await page.screenshot({ path: testInfo.outputPath('bulk-review-mobile.png'), fullPage: true });
  await review.getByRole('button', { name: 'Add selected items' }).click();

  await expect(page.getByRole('status').filter({ hasText: /^Added 4 items and skipped 2\.$/ })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: milk })).toHaveCount(1);
  await expect(page.getByRole('article').filter({ hasText: bread })).toContainText('1 loaf');
  await expect(page.getByRole('article').filter({ hasText: apples })).toHaveCount(1);
  await expect(page.getByRole('article').filter({ hasText: apples })).toContainText('3');
  await expect(page.getByRole('article').filter({ hasText: rice })).toContainText('2 cups');
  await expect(page.getByRole('article').filter({ hasText: salt })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('bulk-added-mobile.png'), fullPage: true });
});

test('a matching item added in another session rejects the batch and preserves the review edits', async ({ page, browser }) => {
  const stamp = Date.now();
  const rice = `Synthetic conflict bulk rice ${stamp}`;
  const apples = `Synthetic conflict bulk apples ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsBulk(page, 'bulk-b');
  await openBulk(page);
  const review = await pasteAndReview(page, [`2 cups ${rice}`, `3 ${apples}`]);
  const riceLine = lineGroup(review, `2 cups ${rice}`);
  await riceLine.getByLabel('Quantity').fill('5');
  await riceLine.getByLabel('Unit').fill('cups');

  const otherContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const other = await otherContext.newPage();
    await signInAsBulk(other, 'bulk-b');
    const primarySession = (await page.context().cookies()).find(cookie => cookie.name === 'better-auth.session_token');
    const otherSession = (await otherContext.cookies()).find(cookie => cookie.name === 'better-auth.session_token');
    expect(Boolean(primarySession && otherSession && primarySession.value !== otherSession.value), 'the browsers have distinct authenticated sessions').toBe(true);
    await other.goto('/groceries');
    const add = other.getByRole('form', { name: 'Add grocery item' });
    await add.getByLabel('Item', { exact: true }).fill(rice);
    await add.getByLabel('Quantity', { exact: true }).fill('2');
    await add.getByLabel('Unit', { exact: true }).fill('cups');
    await add.getByRole('button', { name: 'Add item' }).click();
    await expect(other.getByRole('article').filter({ hasText: rice })).toContainText('2 cups');

    await review.getByRole('button', { name: 'Add selected items' }).click();
    await expect(page.getByRole('alert')).toContainText('The grocery list changed');
    await expect(page.getByRole('alert')).toContainText('Nothing was added');
    const recovered = page.getByRole('region', { name: 'Review bulk groceries' });
    const recoveredRice = lineGroup(recovered, `2 cups ${rice}`);
    await expect(recoveredRice).toContainText(`Already on your list: ${rice}`);
    await expect(recoveredRice.getByLabel('Item name')).toHaveValue(rice);
    await expect(recoveredRice.getByLabel('Quantity')).toHaveValue('5');
    await expect(recoveredRice.getByLabel('Unit')).toHaveValue('cups');
    await expect(recoveredRice.getByRole('radio', { name: 'Add this item' })).toBeChecked();
    await expect(page.getByRole('article').filter({ hasText: apples })).toHaveCount(0);

    await recoveredRice.getByRole('radio', { name: 'Skip this item' }).check();
    await recovered.getByRole('button', { name: 'Add selected items' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Added 1 item and skipped 1\.$/ })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: apples })).toContainText('3');
    await expect(page.getByRole('article').filter({ hasText: rice })).toHaveCount(1);
    await expect(page.getByRole('article').filter({ hasText: rice })).toContainText('2 cups');
  } finally { await otherContext.close(); }
});

test('bulk review and confirmation work without JavaScript for an active child', async ({ page, browser }) => {
  const stamp = Date.now();
  const rice = `Synthetic native bulk rice ${stamp}`;
  const basil = `Synthetic native bulk basil ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsBulk(page, 'bulk-kid');

  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto('/groceries/bulk');
    await native.getByLabel('Paste your list').fill(`2 cups ${rice}\n${basil}`);
    await native.getByRole('button', { name: 'Review list' }).click();
    const review = native.getByRole('region', { name: 'Review bulk groceries' });
    await expect(review.getByRole('heading', { name: 'Review 2 items' })).toBeVisible();
    await lineGroup(review, `2 cups ${rice}`).getByLabel('Unit').fill('bowls');
    await review.getByRole('button', { name: 'Add selected items' }).click();

    await expect(native.getByRole('status').filter({ hasText: /^Added 2 items and skipped 0\.$/ })).toBeVisible();
    await expect(native.getByRole('article').filter({ hasText: rice })).toContainText('2 bowls');
    await expect(native.getByRole('article').filter({ hasText: basil })).toBeVisible();
  } finally { await context.close(); }
});

test('pasted text and review edits survive delayed hydration and are submitted', async ({ page, browser }) => {
  const stamp = Date.now();
  const rice = `Synthetic hydrated bulk rice ${stamp}`;
  const apples = `Synthetic hydrated bulk apples ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsBulk(page, 'bulk-live');

  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let releaseFirst!: () => void, releaseSecond!: () => void, firstRequest!: () => void, secondRequest!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  const first = new Promise<void>(resolve => { firstRequest = resolve; });
  const second = new Promise<void>(resolve => { secondRequest = resolve; });
  let requests = 0;
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/groceries/bulk/+page.svelte*', async route => {
      requests += 1;
      if (requests === 1) firstRequest();
      if (requests === 2) secondRequest();
      if (requests === 1) await firstGate;
      else if (requests === 2) await secondGate;
      await route.continue();
    });
    await delayed.goto('/groceries/bulk', { waitUntil: 'commit' });
    await first;
    const pasted = [`2 cups ${rice}`, `3 ${apples}`].join('\n');
    await delayed.getByLabel('Paste your list').fill(pasted);
    releaseFirst();
    await delayed.waitForLoadState('networkidle');
    await expect(delayed.getByLabel('Paste your list')).toHaveValue(pasted);

    await delayed.getByRole('button', { name: 'Review list' }).click();
    await second;
    const review = delayed.getByRole('region', { name: 'Review bulk groceries' });
    const riceLine = lineGroup(review, `2 cups ${rice}`);
    await riceLine.getByLabel('Quantity').fill('4');
    await riceLine.getByLabel('Unit').fill('jars');
    releaseSecond();
    await delayed.waitForLoadState('networkidle');
    expect(await review.evaluate(element => Object.fromEntries(new FormData(element.querySelector('form') as HTMLFormElement)))).toMatchObject({
      'name-0': rice,
      'quantity-0': '4',
      'unit-0': 'jars',
      'name-1': apples
    });
    await review.getByRole('button', { name: 'Add selected items' }).click();
    await expect(delayed.getByRole('article').filter({ hasText: rice })).toContainText('4 jars');
    await expect(delayed.getByRole('article').filter({ hasText: apples })).toContainText('3');
  } finally { releaseFirst(); releaseSecond(); await context.close(); }
});

for (const javaScriptEnabled of [true, false]) test(`invalid bulk review values stay editable (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ page, browser }) => {
  const stamp = Date.now();
  const rice = `Synthetic validated bulk rice ${stamp}`;
  const corrected = `Synthetic corrected bulk rice ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsBulk(page, 'bulk-a');
  await openBulk(page);

  const context = await browser.newContext({ javaScriptEnabled, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const view = await context.newPage();
    await view.goto('/groceries/bulk');
    await view.getByLabel('Paste your list').fill(`2 cups ${rice}`);
    await view.getByRole('button', { name: 'Review list' }).click();
    const review = view.getByRole('region', { name: 'Review bulk groceries' });
    const line = lineGroup(review, `2 cups ${rice}`);
    await line.getByLabel('Item name').fill('   ');
    await line.getByLabel('Quantity').fill('4');
    await line.getByLabel('Unit').fill('bags');
    await review.getByRole('button', { name: 'Add selected items' }).click();

    await expect(view.getByRole('alert')).toContainText('Check each item name');
    await expect(review).toBeVisible();
    await expect(line.getByLabel('Quantity')).toHaveValue('4');
    await expect(line.getByLabel('Unit')).toHaveValue('bags');
    await expect(line.getByLabel('Item name')).toHaveValue('   ');
    await expect(view.getByRole('article').filter({ hasText: rice })).toHaveCount(0);

    await line.getByLabel('Item name').fill(corrected);
    await review.getByRole('button', { name: 'Add selected items' }).click();
    await expect(view.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();
    await expect(view.getByRole('article').filter({ hasText: corrected })).toContainText('4 bags');
  } finally { await context.close(); }
});

test('cancelling a reviewed list returns to the grocery list without saving', async ({ page }) => {
  const stamp = Date.now();
  const rice = `Synthetic cancelled bulk rice ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsBulk(page, 'bulk-a');
  await openBulk(page);
  const review = await pasteAndReview(page, [`2 cups ${rice}`]);
  await expect(lineGroup(review, `2 cups ${rice}`)).toBeVisible();

  await page.getByRole('link', { name: 'Cancel without saving' }).click();
  await expect(page.getByRole('heading', { name: 'Grocery list' })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: rice })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('article').filter({ hasText: rice })).toHaveCount(0);
});

test('live refresh and parent bought-item cleanup still work after a bulk addition', async ({ page, browser }) => {
  const stamp = Date.now();
  const rice = `Synthetic live bulk rice ${stamp}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsBulk(page, 'bulk-live');
  await page.clock.install();
  await page.goto('/groceries');
  await expect(page.getByText('Live updates on.')).toBeVisible();

  const otherContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const other = await otherContext.newPage();
    await other.goto('/groceries/bulk');
    await other.getByLabel('Paste your list').fill(`2 cups ${rice}`);
    await other.getByRole('button', { name: 'Review list' }).click();
    await other.getByRole('region', { name: 'Review bulk groceries' }).getByRole('button', { name: 'Add selected items' }).click();
    await expect(other.getByRole('status').filter({ hasText: /^Added 1 item and skipped 0\.$/ })).toBeVisible();

    const item = page.getByRole('article').filter({ hasText: rice });
    await expect(item).toHaveCount(0);
    await page.clock.runFor(25_000);
    await expect(item).toContainText('2 cups');

    await item.getByRole('button', { name: 'Mark bought' }).click();
    await showBought(page);
    await expect(item).toContainText('Bought');
    await page.getByText('Clear bought items…', { exact: true }).click();
    await page.getByRole('form', { name: 'Clear bought items' }).getByRole('button', { name: 'Clear 1 bought item' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Cleared 1 bought item.' })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: rice })).toHaveCount(0);
  } finally { await otherContext.close(); }
});
