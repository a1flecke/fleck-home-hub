import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

async function signIn(page: Page, email: string, password: string, heading: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

test('parent reviews grouped submissions, validates rework, and verifies once', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'verify-parent@example.test', 'synthetic-verify-parent-password', 'Hello, Verify Parent');
  const summary = page.getByRole('link', { name: /25 submissions are waiting for review/ });
  await expect(summary).toContainText('$40.00 in pending rewards');
  await summary.click();
  await expect(page.getByRole('heading', { name: 'Review completed chores' })).toBeVisible();
  await expect(page.getByText('25 submissions · $40.00 in pending rewards')).toBeVisible();
  await expect(page.getByText('Verified earnings owed so far: $0.00')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verification Kid', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verification Sibling', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(20);
  await page.screenshot({ path: testInfo.outputPath('verify-inbox-mobile.png'), fullPage: true });

  await page.getByRole('link', { name: 'Next page' }).first().click();
  await expect(page.getByText('Page 2 of 2').first()).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5);
  await expect(page.getByRole('article').filter({ hasText: 'Verification sibling 01' })).toBeVisible();
  await page.getByRole('link', { name: 'Previous page' }).first().click();
  await page.getByRole('link', { name: 'Verification Kid (15)' }).click();
  await expect(page).toHaveURL(/child=/);
  await expect(page.getByRole('article')).toHaveCount(15);
  await page.getByRole('link', { name: 'Verification Empty (0)' }).click();
  await expect(page.getByText('No completed chores are waiting for review.')).toBeVisible();
  await page.getByRole('link', { name: 'All children (25)' }).click();
  await expect(page.getByRole('article')).toHaveCount(20);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('verify-inbox-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });

  const first = page.getByRole('article', { name: 'Review Verification kid 15' });
  const verifiedId = await first.locator('input[name="id"]').inputValue();
  await first.getByRole('button', { name: 'Verify and record $2.00' }).click();
  await expect(page.getByRole('status')).toContainText('Chore verified');
  await expect(page.getByText('24 submissions · $38.00 in pending rewards')).toBeVisible();
  await expect(page.getByText('Verified earnings owed so far: $2.00')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Review Verification kid 15' })).toHaveCount(0);

  const duplicate = await page.request.post('/verify?/review', { form: { id: verifiedId, action: 'verify' }, headers: { origin }, maxRedirects: 0 });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toMatchObject({ type: 'failure', status: 409 });

  const rework = page.getByRole('article', { name: 'Review Verification kid 14' });
  const reason = rework.getByLabel(/Reason for returning work/);
  await reason.fill('   ');
  await rework.getByRole('button', { name: 'Return for rework' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a reason');
  await expect(reason).toHaveValue('   ');
  await expect(page.getByText('24 submissions · $38.00 in pending rewards')).toBeVisible();
  await reason.fill('Please dry the dishes');
  await rework.getByRole('button', { name: 'Return for rework' }).click();
  await expect(page.getByRole('status')).toContainText('Work returned for rework');
  await expect(page.getByText('23 submissions · $36.00 in pending rewards')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Review Verification kid 14' })).toHaveCount(0);

  const secondParent = await browser.newContext();
  try {
    const login = await secondParent.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'verify-parent-two@example.test', password: 'synthetic-verify-parent-two-password' } });
    expect(login.status()).toBe(200);
    expect((await (await secondParent.request.get('/api/auth/get-session')).json()).user.email).toBe('verify-parent-two@example.test');
    const competing = await secondParent.request.post('/verify?/review', { form: { id: 'verify-kid-13', action: 'verify' }, headers: { origin } });
    expect(competing.status()).toBe(200);
  } finally { await secondParent.close(); }
  const stale = await page.request.post('/verify?/review', { form: { id: 'verify-kid-13', action: 'verify' }, headers: { origin }, maxRedirects: 0 });
  expect(stale.status()).toBe(409);
  const forged = await page.request.post('/verify?/review', { form: { id: 'verify-kid-01', action: 'verify' }, headers: { origin: 'https://attacker.example.test' } });
  expect(forged.status()).toBe(403);

  await page.goto('/dashboard');
  const earnings = page.getByRole('article', { name: 'Earnings for Verification Kid' });
  await expect(earnings.getByText('Verified earnings owed: $4.00')).toBeVisible();
  await expect(page.getByText(/22 submissions are waiting for review/)).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('verify-dashboard-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'verify-kid@example.test', 'synthetic-verify-kid-password', "Verification Kid's My Day");
  expect((await page.request.get('/verify', { maxRedirects: 0 })).status()).toBe(403);
  const reworked = page.getByRole('article').filter({ hasText: 'Verification kid 14' });
  await expect(reworked.getByText('Needs rework')).toBeVisible();
  await expect(reworked.getByText('Please dry the dishes')).toBeVisible();
});

test('verification queue works without JavaScript and keeps the child filter', async ({ page, browser }, testInfo) => {
  await signIn(page, 'verify-parent@example.test', 'synthetic-verify-parent-password', 'Hello, Verify Parent');
  await page.goto('/verify');
  const siblingLink = await page.getByRole('link', { name: /Verification Sibling \(10\)/ }).getAttribute('href');
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const native = await context.newPage();
    await native.goto(siblingLink!);
    await expect(native.getByText('Showing 10 of 10 submissions for this child.')).toBeVisible();
    const article = native.getByRole('article', { name: 'Review Verification sibling 10' });
    const reason = article.getByLabel(/Reason for returning work/);
    await reason.fill('   ');
    await article.getByRole('button', { name: 'Return for rework' }).click();
    await expect(native.getByRole('alert')).toContainText('Enter a reason');
    await expect(reason).toHaveValue('   ');
    await expect(native).toHaveURL(/child=/);
    await expect(native.getByText('Showing 10 of 10 submissions for this child.')).toBeVisible();
    await article.getByRole('button', { name: 'Verify and record $1.00' }).click();
    await expect(native.getByRole('status')).toContainText('Chore verified');
    await expect(native).toHaveURL(/child=.*notice=verified/);
    await expect(native.getByRole('article', { name: 'Review Verification sibling 10' })).toHaveCount(0);
    await expect(native.getByText('Showing 9 of 9 submissions for this child.')).toBeVisible();
    await native.screenshot({ path: testInfo.outputPath('verify-inbox-native.png'), fullPage: true });
  } finally { await context.close(); }
});

test('rework reason survives delayed hydration and appears in submitted data', async ({ page, browser }) => {
  await signIn(page, 'verify-parent@example.test', 'synthetic-verify-parent-password', 'Hello, Verify Parent');
  await page.goto('/verify');
  const siblingLink = await page.getByRole('link', { name: /Verification Sibling/ }).getAttribute('href');
  const context = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  let release!: () => void;
  let blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/verify/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await delayed.goto(siblingLink!, { waitUntil: 'commit' });
    await requested;
    const article = delayed.getByRole('article', { name: 'Review Verification sibling 09' });
    const reason = article.getByLabel(/Reason for returning work/);
    await reason.fill('Dirty reason typed before hydration');
    release();
    await delayed.waitForLoadState('networkidle');
    await expect(reason).toHaveValue('Dirty reason typed before hydration');
    expect(await article.locator('form[action^="?/review"]').evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)))).toMatchObject({ id: 'verify-sibling-09', reason: 'Dirty reason typed before hydration' });
  } finally { release(); await context.close(); }
});

test('verification routes reject anonymous, child, cross-household and disabled sessions', async ({ page, browser }) => {
  const anonymous = await page.request.get('/verify', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers()['location']).toBe('/sign-in');
  const otherHousehold = await browser.newContext();
  try {
    const login = await otherHousehold.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'other-parent@example.test', password: 'synthetic-other-parent-password' } });
    expect(login.status()).toBe(200);
    const ownQueue = await otherHousehold.request.get('/verify');
    expect(ownQueue.status()).toBe(200);
    expect(await ownQueue.text()).toContain('No completed chores are waiting for review.');
    const crossHousehold = await otherHousehold.request.post('/verify?/review', { form: { id: 'verify-kid-01', action: 'verify' }, headers: { origin }, maxRedirects: 0 });
    expect(crossHousehold.status()).toBe(409);
  } finally { await otherHousehold.close(); }

  const disabled = await browser.newContext();
  try {
    const login = await disabled.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'disabled-expense@example.test', password: 'synthetic-disabled-expense-password' } });
    expect(login.status()).toBe(401);
    expect((await disabled.request.get('/verify', { maxRedirects: 0 })).status()).toBe(303);
  } finally { await disabled.close(); }

  const parent = await browser.newContext();
  try {
    const login = await parent.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'verify-parent@example.test', password: 'synthetic-verify-parent-password' } });
    expect(login.status()).toBe(200);
    const response = await parent.request.get('/verify');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
  } finally { await parent.close(); }
});
