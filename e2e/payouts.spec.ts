import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, role: 'parent' | 'payout-kid') {
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

const cents = (text: string) => {
  const match = text.match(/\$(\d+)\.(\d{2})/);
  if (!match) throw new Error('Missing balance');
  return Number(match[1]) * 100 + Number(match[2]);
};
const money = (amount: number) => `$${(amount / 100).toFixed(2)}`;

test('dashboard preserves form edits made before hydration', async ({ page, browser }) => {
  await signIn(page, 'parent');
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void;
  let blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/dashboard/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await delayed.goto('/dashboard', { waitUntil: 'commit' });
    await requested;
    await delayed.getByText('Payday schedule', { exact: true }).click();
    const payday = delayed.locator('form[action="?/payday"]');
    await payday.getByLabel('First payday').fill('2099-01-01');
    await payday.getByLabel('Frequency').selectOption('14');
    await delayed.getByText('Household time zone', { exact: true }).click();
    const timezone = delayed.locator('form[action="?/timezone"]');
    await timezone.getByLabel('Time zone (for example, America/Chicago)').fill('Asia/Tokyo');
    await delayed.getByText('Add a recurring chore', { exact: true }).click();
    const recurring = delayed.locator('form[action="?/series"]').first();
    await recurring.getByLabel('Starts on').fill('2099-02-01');
    release();
    await delayed.waitForLoadState('networkidle');
    await expect(payday.getByLabel('First payday')).toHaveValue('2099-01-01');
    await expect(payday.getByLabel('Frequency')).toHaveValue('14');
    await expect(timezone.getByLabel('Time zone (for example, America/Chicago)')).toHaveValue('Asia/Tokyo');
    await expect(recurring.getByLabel('Starts on')).toHaveValue('2099-02-01');
    expect(await payday.evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)))).toMatchObject({ anchor: '2099-01-01', cadence: '14' });
  } finally { release(); await context.close(); }
});

test('a verified chore can be partially paid and the child sees the remaining amount', async ({ page, browser }, testInfo) => {
  const title = `Payment chore ${testInfo.repeatEachIndex}`;
  await page.setViewportSize({ width: 375, height: 812 });
  const anonymous = await page.request.post('/dashboard?/payout', { form: { child: 'forged', amount: '1.00', date: '2026-11-01', requestId: 'anonymous' }, headers: { origin: 'http://127.0.0.1:4173' }, maxRedirects: 0 });
  expect(await anonymous.json()).toMatchObject({ type: 'redirect', status: 303, location: '/sign-in' });
  await signIn(page, 'parent');
  await page.getByText('Payday schedule', { exact: true }).click();
  const paydayForm = page.locator('form[action="?/payday"]');
  const payday = '2099-01-01';
  await paydayForm.getByLabel('First payday').fill(payday);
  await paydayForm.getByRole('combobox', { name: 'Frequency' }).selectOption('14');
  await paydayForm.getByRole('button', { name: 'Save payday' }).click();
  await expect(page.getByText(`Next payday: ${payday}`)).toBeVisible();
  await page.getByText('Add a chore', { exact: true }).click();
  const choreForm = page.locator('form[action="?/create"]');
  await choreForm.getByLabel('Chore title', { exact: true }).fill(title);
  await choreForm.getByRole('combobox', { name: 'Assigned child', exact: true }).selectOption({ label: 'Payout Kid' });
  await choreForm.getByLabel('Due date', { exact: true }).fill('2026-11-01');
  await choreForm.getByLabel('Reward in dollars', { exact: true }).fill('5.00');
  await choreForm.getByRole('button', { name: 'Add chore', exact: true }).click();
  const chore = page.getByRole('article').filter({ hasText: title });
  await expect(chore).toBeVisible();
  await signOut(page);
  await signIn(page, 'payout-kid');
  await chore.getByRole('button', { name: 'Mark complete' }).click();
  await expect(chore.getByText('Waiting for parent verification')).toBeVisible();
  await signOut(page);
  await signIn(page, 'parent');
  await chore.getByRole('button', { name: 'Verify' }).click();
  await expect(chore.getByText('Approved! You earned $5.00!')).toBeVisible();
  const delayedContext = await browser.newContext({ storageState: await page.context().storageState() });
  let releasePayment!: () => void;
  let paymentBlocked!: () => void;
  const paymentGate = new Promise<void>(resolve => { releasePayment = resolve; });
  const paymentRequested = new Promise<void>(resolve => { paymentBlocked = resolve; });
  try {
    const delayed = await delayedContext.newPage();
    await delayed.route('**/src/routes/dashboard/+page.svelte*', async route => { paymentBlocked(); await paymentGate; await route.continue(); });
    await delayed.goto('/dashboard', { waitUntil: 'commit' });
    await paymentRequested;
    const earnings = delayed.getByRole('article', { name: 'Earnings for Payout Kid' });
    await earnings.getByText('Record a payment', { exact: true }).click();
    await earnings.getByLabel('Payment amount').fill('2.00');
    await earnings.getByLabel('Payment date').fill('2026-11-01');
    releasePayment();
    await delayed.waitForLoadState('networkidle');
    await expect(earnings.getByLabel('Payment amount')).toHaveValue('2.00');
    await expect(earnings.getByLabel('Payment date')).toHaveValue('2026-11-01');
    expect(await earnings.locator('form[action="?/payout"]').evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)))).toMatchObject({ amount: '2.00', date: '2026-11-01' });
  } finally { releasePayment(); await delayedContext.close(); }
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let owedBefore: number, paidBefore: number, childId: string, payoutId: string;
  try {
    const noScript = await context.newPage();
    await noScript.goto('/dashboard');
    const earnings = noScript.getByRole('article', { name: 'Earnings for Payout Kid' });
    owedBefore = cents(await earnings.getByText(/^Verified earnings owed:/).innerText());
    paidBefore = cents(await earnings.getByText(/^Paid so far:/).innerText());
    await earnings.getByText('Record a payment', { exact: true }).click();
    childId = await earnings.locator('input[name="child"]').inputValue();
    await earnings.getByLabel('Payment amount').fill('2.00');
    await earnings.getByLabel('Payment date').fill('2026-11-01');
    await earnings.getByLabel('Payment note').fill('Synthetic partial payment');
    await earnings.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(earnings.getByText(/^Verified earnings owed:/)).toHaveText(`Verified earnings owed: ${money(owedBefore - 200)}`);
    await expect(earnings.getByText(/^Paid so far:/)).toHaveText(`Paid so far: ${money(paidBefore + 200)}`);
    await expect(earnings.getByText('Synthetic partial payment')).toBeVisible();
    payoutId = await earnings.locator('form[action="?/reversePayout"] input[name="id"]').inputValue();
    await noScript.screenshot({ path: testInfo.outputPath('payout-parent-mobile.png'), fullPage: true });
    await noScript.setViewportSize({ width: 1280, height: 900 });
    await noScript.screenshot({ path: testInfo.outputPath('payout-parent-desktop.png'), fullPage: true });
  } finally { await context.close(); }
  const correctionHydration = await browser.newContext({ storageState: await page.context().storageState() });
  let releaseCorrection!: () => void;
  let correctionBlocked!: () => void;
  const correctionGate = new Promise<void>(resolve => { releaseCorrection = resolve; });
  const correctionRequested = new Promise<void>(resolve => { correctionBlocked = resolve; });
  try {
    const delayed = await correctionHydration.newPage();
    await delayed.route('**/src/routes/dashboard/+page.svelte*', async route => { correctionBlocked(); await correctionGate; await route.continue(); });
    await delayed.goto('/dashboard', { waitUntil: 'commit' });
    await correctionRequested;
    const entry = delayed.getByRole('article', { name: 'Earnings for Payout Kid' });
    await entry.getByText('Correct this payment').click();
    await entry.getByLabel('Correction reason').fill('Synthetic correction');
    releaseCorrection();
    await delayed.waitForLoadState('networkidle');
    await expect(entry.getByLabel('Correction reason')).toBeVisible();
    expect(await entry.locator('form[action="?/reversePayout"]').evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)))).toMatchObject({ id: payoutId, reason: 'Synthetic correction' });
  } finally { releaseCorrection(); await correctionHydration.close(); }
  await signOut(page);
  await signIn(page, 'payout-kid');
  const childEarnings = page.getByRole('article', { name: 'Earnings for Payout Kid' });
  await expect(childEarnings.getByText(/^Verified earnings owed:/)).toHaveText(`Verified earnings owed: ${money(owedBefore - 200)}`);
  await expect(childEarnings.getByText('Synthetic partial payment')).toBeVisible();
  await expect(page.getByText('Record a payment')).toHaveCount(0);
  const forged = await page.request.post('/dashboard?/payout', { form: { child: childId, amount: '1.00', date: '2026-11-01', requestId: 'child-forgery' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(forged.status()).not.toBe(200);
  const crossOrigin = await page.request.post('/dashboard?/payout', { form: { child: childId, amount: '1.00', date: '2026-11-01', requestId: 'cross-origin' }, headers: { origin: 'https://attacker.example.test' } });
  expect(crossOrigin.status()).toBe(403);
  const childCorrection = await page.request.post('/dashboard?/reversePayout', { form: { id: payoutId, reason: 'Forged correction' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(childCorrection.status()).not.toBe(200);
  const childPayday = await page.request.post('/dashboard?/payday', { form: { anchor: payday, cadence: '7' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(childPayday.status()).not.toBe(200);
  await signOut(page);
  await signIn(page, 'parent');
  const correction = page.getByRole('article', { name: 'Earnings for Payout Kid' });
  await correction.getByText('Correct this payment').click();
  await correction.getByLabel('Correction reason').fill('   ');
  await correction.getByRole('button', { name: 'Record correction' }).click();
  await expect(page.getByRole('status')).toContainText('Unable to correct payment');
  await expect(correction.getByLabel('Correction reason')).toBeVisible();
  await expect(correction.getByLabel('Correction reason')).toHaveValue('   ');
  const correctionContext = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const noScript = await correctionContext.newPage();
    await noScript.goto('/dashboard');
    const entry = noScript.getByRole('article', { name: 'Earnings for Payout Kid' });
    await entry.getByText('Correct this payment').click();
    await entry.getByLabel('Correction reason').fill('   ');
    await entry.getByRole('button', { name: 'Record correction' }).click();
    await expect(noScript.getByRole('status')).toContainText('Unable to correct payment');
    await expect(entry.getByLabel('Correction reason')).toBeVisible();
    await expect(entry.getByRole('textbox', { name: 'Correction reason' })).toHaveValue('   ');
    await entry.getByRole('textbox', { name: 'Correction reason' }).fill('Recorded by mistake');
    await entry.getByRole('button', { name: 'Record correction' }).click();
    await expect(entry.getByText('Correction: Recorded by mistake')).toBeVisible();
  } finally { await correctionContext.close(); }
  await page.reload();
  await expect(correction.getByText(/^Verified earnings owed:/)).toHaveText(`Verified earnings owed: ${money(owedBefore)}`);
  await expect(correction.getByText('Correction: Recorded by mistake')).toBeVisible();
});
