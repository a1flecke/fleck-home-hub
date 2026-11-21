import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

async function signIn(page: Page, email: string, password: string, heading: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

test('schedule and historical correction forms preserve edits made before hydration', async ({ page, browser }) => {
  await signIn(page, 'history-parent@example.test', 'synthetic-history-parent-password', 'Hello, History Parent');
  const payments = await page.getByRole('article', { name: 'Earnings for History Kid' }).getByRole('link', { name: /payments/ }).getAttribute('href');
  const seriesContext = await browser.newContext({ storageState: await page.context().storageState() });
  let releaseSeries!: () => void;
  let seriesBlocked!: () => void;
  const seriesGate = new Promise<void>(resolve => { releaseSeries = resolve; });
  const seriesRequested = new Promise<void>(resolve => { seriesBlocked = resolve; });
  try {
    const delayed = await seriesContext.newPage();
    await delayed.route('**/src/routes/chores/series/+page.svelte*', async route => { seriesBlocked(); await seriesGate; await route.continue(); });
    await delayed.goto('/chores/series', { waitUntil: 'commit' });
    await seriesRequested;
    await delayed.getByText('Add a recurring chore', { exact: true }).click();
    const form = delayed.locator('form[action="?/series"]').first();
    await form.getByLabel('Recurring chore title').fill('Synthetic hydrated schedule');
    await form.getByRole('combobox', { name: 'Recurring assigned child' }).selectOption({ label: 'History Kid' });
    const assignee = await form.getByRole('combobox', { name: 'Recurring assigned child' }).inputValue();
    await form.getByLabel('Starts on').fill('2099-02-01');
    await form.getByLabel('Monday').check();
    await form.getByLabel('Recurring reward in dollars').fill('3.50');
    releaseSeries();
    await delayed.waitForLoadState('networkidle');
    await expect(form.getByLabel('Recurring chore title')).toHaveValue('Synthetic hydrated schedule');
    await expect(form.getByLabel('Starts on')).toHaveValue('2099-02-01');
    await expect(form.getByLabel('Monday')).toBeChecked();
    expect(await form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({ title: 'Synthetic hydrated schedule', assignee, startDate: '2099-02-01', weekday: '1', reward: '3.50' });
  } finally { releaseSeries(); await seriesContext.close(); }

  const paymentContext = await browser.newContext({ storageState: await page.context().storageState() });
  let releasePayment!: () => void;
  let paymentBlocked!: () => void;
  const paymentGate = new Promise<void>(resolve => { releasePayment = resolve; });
  const paymentRequested = new Promise<void>(resolve => { paymentBlocked = resolve; });
  try {
    const delayed = await paymentContext.newPage();
    await delayed.route('**/src/routes/earnings/*/+page.svelte*', async route => { paymentBlocked(); await paymentGate; await route.continue(); });
    await delayed.goto(`${payments}?page=2`, { waitUntil: 'commit' });
    await paymentRequested;
    const article = delayed.getByRole('article').filter({ hasText: 'Synthetic payment 2' });
    await article.getByText('Correct this payment').click();
    await article.getByLabel('Correction reason').fill('Preserved correction reason');
    releasePayment();
    await delayed.waitForLoadState('networkidle');
    await expect(article.getByLabel('Correction reason')).toHaveValue('Preserved correction reason');
    expect(await article.locator('form[action^="?/reversePayout"]').evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({ reason: 'Preserved correction reason' });
  } finally { releasePayment(); await paymentContext.close(); }

  const nativeContext = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const native = await nativeContext.newPage();
    await native.goto(`${payments}?page=2`);
    const article = native.getByRole('article').filter({ hasText: 'Synthetic payment 4' });
    await article.getByText('Correct this payment').click();
    await article.getByLabel('Correction reason').fill('   ');
    await article.getByRole('button', { name: 'Record correction' }).click();
    await expect(native.getByRole('alert')).toContainText('Unable to correct payment');
    await expect(article.getByLabel('Correction reason')).toHaveValue('   ');
    await article.getByLabel('Correction reason').fill('Native historical correction');
    await article.getByRole('button', { name: 'Record correction' }).click();
    await expect(native.getByRole('status')).toContainText('Payment correction recorded');
    await expect(native.getByRole('article').filter({ hasText: 'Synthetic payment 4' }).getByText('Corrected: Native historical correction')).toBeVisible();
  } finally { await nativeContext.close(); }
});

test('parent pages through bounded chore and payment history and corrects an older payment', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'history-parent@example.test', 'synthetic-history-parent-password', 'Hello, History Parent');
  await expect(page.getByRole('link', { name: /3 submissions are waiting for review/ })).toBeVisible();
  await page.getByRole('link', { name: 'Chore history' }).click();
  await expect(page.getByRole('heading', { name: 'Family chore history' })).toBeVisible();
  await page.getByRole('link', { name: 'History Kid' }).click();
  await expect(page).toHaveURL(/scope=verified&page=1&child=/);
  await expect(page.getByText('Showing 25 of 60 in this view.')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'History sibling private chore' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Waiting for review (3)' }).click();
  await expect(page).toHaveURL(/scope=review&child=/);
  await expect(page.getByText('Showing 3 of 3 in this view.')).toBeVisible();
  await page.getByRole('link', { name: 'Completed (60)' }).click();
  await expect(page).toHaveURL(/scope=verified&child=/);
  await expect(page.getByText('Showing 25 of 60 in this view.')).toBeVisible();
  await expect(page.getByText('Page 1 of 3').first()).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'History completed 060' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chore-history-mobile.png'), fullPage: true });
  await page.getByRole('link', { name: 'Next page' }).first().click();
  await expect(page.getByText('Page 2 of 3').first()).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'History completed 035' })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'History completed 060' })).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('chore-history-desktop.png'), fullPage: true });

  await page.goto('/dashboard');
  await expect(page.getByText('Chores waiting for you')).toBeVisible();
  const siblingHistory = await page.getByRole('article', { name: 'Earnings for History Sibling' }).getByRole('link', { name: /payments/ }).getAttribute('href');
  const kidPayments = await page.getByRole('article', { name: 'Earnings for History Kid' }).getByRole('link', { name: 'View all 25 payments' }).getAttribute('href');
  await page.getByRole('article', { name: 'Earnings for History Kid' }).getByRole('link', { name: 'View all 25 payments' }).click();
  await expect(page.getByRole('heading', { name: "History Kid's payments" })).toBeVisible();
  await expect(page.getByText('Showing 20 of 25 payments.')).toBeVisible();
  await page.getByRole('link', { name: 'Next page' }).first().click();
  await expect(page.getByText('Page 2 of 2').first()).toBeVisible();
  const older = page.getByRole('article').filter({ hasText: 'Synthetic older payment' });
  await expect(older).toBeVisible();
  await expect(page.getByText('Corrected: Synthetic older correction')).toBeVisible();
  await older.getByText('Correct this payment').click();
  await older.getByLabel('Correction reason').fill('Corrected older payment');
  await older.getByRole('button', { name: 'Record correction' }).click();
  await expect(page.getByRole('status')).toContainText('Payment correction recorded');
  const corrected = page.getByRole('article').filter({ hasText: 'Synthetic older payment' });
  await expect(corrected.getByText('Corrected: Corrected older payment')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('payment-history-page-2.png'), fullPage: true });

  const childId = new URL(kidPayments!, origin).pathname.split('/').at(-1)!;
  const forgedCorrection = await page.request.post(`/earnings/${childId}?/reversePayout`, { form: { id: 'forged', reason: 'Forged' }, headers: { origin: 'https://attacker.example.test' } });
  expect(forgedCorrection.status()).toBe(403);

  await page.goto('/chores/history?scope=review');
  const pending = page.getByRole('article').filter({ hasText: 'History pending 1' });
  await expect(pending).toBeVisible();
  await pending.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Chore verified');
  await expect(page.getByRole('article').filter({ hasText: 'History pending 1' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Waiting for review (2)' })).toBeVisible();

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'history-kid@example.test', 'synthetic-history-kid-password', "History Kid's My Day");
  const kidDashboard = await page.request.get('/dashboard');
  const kidHtml = await kidDashboard.text();
  expect(kidHtml).toContain('History completed 060');
  expect(kidHtml).not.toContain('History sibling private chore');
  expect(kidHtml).not.toContain('Sibling private payment');
  const siblingResponse = await page.request.get(siblingHistory!);
  expect(siblingResponse.status()).toBe(404);
  expect(await siblingResponse.text()).not.toContain('Sibling private payment');
  expect((await page.request.get('/chores/series')).status()).toBe(403);
  expect((await page.request.get('/chores/history?scope=verified')).headers()['cache-control']).toContain('no-store');
  const childCorrection = await page.request.post(`/earnings/${childId}?/reversePayout`, { form: { id: 'forged', reason: 'Forged' }, headers: { origin } });
  expect(childCorrection.status()).toBe(403);

  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const noScript = await context.newPage();
    await noScript.goto('/dashboard');
    await noScript.getByRole('link', { name: 'My chore history' }).click();
    await expect(noScript.getByRole('heading', { name: 'My chore history' })).toBeVisible();
    await noScript.getByRole('link', { name: 'Completed (61)' }).click();
    await expect(noScript.getByText('Page 1 of 3').first()).toBeVisible();
    await noScript.getByRole('link', { name: 'Next page' }).first().click();
    await expect(noScript.getByText('Page 2 of 3').first()).toBeVisible();
    await expect(noScript.getByRole('article').filter({ hasText: 'History completed 036' })).toBeVisible();
  } finally { await context.close(); }
});

test('history routes reject anonymous and disabled sessions', async ({ page, browser }) => {
  const anonymous = await page.request.get('/chores/history', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers()['location']).toBe('/sign-in');
  const context = await browser.newContext();
  try {
    const login = await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'disabled-grocery@example.test', password: 'synthetic-disabled-grocery-password' } });
    expect(login.status()).toBe(200);
    expect((await context.request.get('/chores/history', { maxRedirects: 0 })).status()).toBe(403);
    expect((await context.request.get('/earnings/not-a-household-child', { maxRedirects: 0 })).status()).toBe(403);
  } finally { await context.close(); }
});

test('a parent review on a child-filtered history page keeps the child filter', async ({ page }) => {
  await signIn(page, 'history-parent@example.test', 'synthetic-history-parent-password', 'Hello, History Parent');
  await page.goto('/chores/history?scope=review');
  await page.getByRole('navigation', { name: 'Filter by child' }).getByRole('link', { name: 'History Kid', exact: true }).click();
  await expect(page).toHaveURL(/[?&]child=/);
  const childId = new URL(page.url()).searchParams.get('child');
  const pending = page.getByRole('article').filter({ hasText: 'History pending 2' });
  await pending.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Chore verified');
  await expect(page.getByRole('article').filter({ hasText: 'History pending 2' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('child')).toBe(childId);
  expect(new URL(page.url()).searchParams.get('scope')).toBe('review');
  await expect(page.getByRole('navigation', { name: 'Filter by child' }).getByRole('link', { name: 'History Kid', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('a child can finish work from the history page they reach from My Day', async ({ page, browser }) => {
  await signIn(page, 'history-kid@example.test', 'synthetic-history-kid-password', "History Kid's My Day");
  await page.goto('/chores/history?scope=overdue');
  await expect(page.getByRole('heading', { name: 'My chore history' })).toBeVisible();
  const overdue = page.getByRole('article').filter({ hasText: 'History overdue 4' });
  await overdue.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByRole('status')).toContainText('Waiting for a parent to check');
  await expect(page.getByRole('article').filter({ hasText: 'History overdue 4' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('scope')).toBe('overdue');
  await page.goto('/chores/history?scope=review');
  await expect(page.getByRole('article').filter({ hasText: 'History overdue 4' })).toContainText('Waiting for parent verification');
  await expect(page.getByRole('article').filter({ hasText: 'History overdue 4' }).getByRole('button')).toHaveCount(0);

  // A child still cannot review work, and cannot submit a sibling's chore, from this route.
  const forgedReview = await page.request.post('/chores/history?/transition&scope=review&page=1', { form: { id: 'history-pending-3', action: 'verify' }, headers: { origin }, maxRedirects: 0 });
  expect(forgedReview.status()).toBe(400);
  const forgedSibling = await page.request.post('/chores/history?/transition&scope=overdue&page=1', { form: { id: 'history-sibling-private', action: 'submit' }, headers: { origin }, maxRedirects: 0 });
  expect(forgedSibling.status()).toBe(400);

  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const noScript = await context.newPage();
    await noScript.goto('/chores/history?scope=overdue');
    await noScript.getByRole('article').filter({ hasText: 'History overdue 3' }).getByRole('button', { name: 'Mark complete' }).click();
    await expect(noScript.getByRole('status')).toContainText('Waiting for a parent to check');
    await expect(noScript.getByRole('article').filter({ hasText: 'History overdue 3' })).toHaveCount(0);
  } finally { await context.close(); }
});
