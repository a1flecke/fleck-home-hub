import { expect, test, type Browser, type Page } from '@playwright/test';

const base = 'http://127.0.0.1:4173';
async function signIn(page: Page, email: string, password: string, heading: RegExp | string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}
async function signedInContext(browser: Browser, email: string, password: string, heading: string) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await signIn(page, email, password, heading);
  return { context, page };
}

test('a child with a still-valid session loses dashboard, grocery and chore access', async ({ page, browser }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const kid = await signedInContext(browser, 'revoke-kid@example.test', 'synthetic-revoke-kid-password', "Revoke Kid's My Day");
  try {
    await signIn(page, 'parent@example.test', 'synthetic-parent-password', 'Hello, Sample Parent');
    await page.goto('/settings/household');
    const person = page.getByRole('listitem').filter({ hasText: 'Revoke Kid' });
    await expect(person).toContainText('Child');
    await person.getByText('Disable access for Revoke Kid').click();
    await expect(person.getByText('immediately lose access', { exact: false })).toBeVisible();
    await person.getByRole('button', { name: 'Confirm disable Revoke Kid' }).click();
    await expect(page.getByRole('status')).toContainText('Access disabled');
    await expect(page.getByRole('heading', { name: 'Disabled access' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'disabled' }).filter({ hasText: 'Revoke Kid' })).toContainText('by Sample Parent');
    await page.screenshot({ path: 'docs/screenshots/household-member-disabled-mobile.png' });
    expect((await kid.page.request.get('/dashboard')).status()).toBe(403);
    expect((await kid.page.request.get('/groceries')).status()).toBe(403);
    expect((await kid.page.request.get('/calendar')).status()).toBe(403);
    expect((await kid.page.request.get('/display/data')).status()).toBe(403);
    const grocery = await kid.page.request.post('/groceries?/add', { form: { name: 'Forbidden item', quantity: '', unit: '' }, headers: { origin: base } });
    expect(JSON.stringify(await grocery.json())).not.toContain('"type":"success"');
    const submit = await kid.page.request.post('/dashboard?/transition', { form: { id: 'revoke-pending-chore', action: 'submit' }, headers: { origin: base } });
    expect(submit.status()).toBe(403);
    await kid.page.goto('/dashboard');
    await expect(kid.page.getByText('No household access')).toBeVisible();
    await page.goto('/groceries');
    await expect(page.getByText('Forbidden item')).toHaveCount(0);
  } finally { await kid.context.close(); }
});

test('a disabled parent cannot invite, approve chores or open household settings', async ({ page, browser }) => {
  const former = await signedInContext(browser, 'revoke-parent@example.test', 'synthetic-revoke-parent-password', 'Hello, Revoke Parent');
  try {
    await signIn(page, 'parent@example.test', 'synthetic-parent-password', 'Hello, Sample Parent');
    await page.goto('/settings/household');
    const person = page.getByRole('listitem').filter({ hasText: 'Revoke Parent' });
    await person.getByText('Disable access for Revoke Parent').click();
    await person.getByRole('button', { name: 'Confirm disable Revoke Parent' }).click();
    await expect(page.getByRole('status')).toContainText('Access disabled');
    await expect(person.getByText('Disable access for')).toHaveCount(0);
    expect((await former.page.request.get('/settings/household')).status()).toBe(403);
    const invite = await former.page.request.post('/settings/household?/invite', { form: { role: 'kid' }, headers: { origin: base } });
    expect(invite.status()).toBe(403);
    const verify = await former.page.request.post('/dashboard?/transition', { form: { id: 'revoke-pending-chore', action: 'verify' }, headers: { origin: base } });
    expect(verify.status()).toBe(403);
    const disable = await former.page.request.post('/settings/household?/disable', { form: { member: 'anyone' }, headers: { origin: base } });
    expect(disable.status()).toBe(403);
    await page.goto('/dashboard');
    await expect(page.getByText('Revocation pending chore')).toBeVisible();
  } finally { await former.context.close(); }
});

test('two parents disabling each other at once leave exactly one active parent', async ({ browser }) => {
  const one = await signedInContext(browser, 'race-one@example.test', 'synthetic-race-one-password', 'Hello, Race One');
  const two = await signedInContext(browser, 'race-two@example.test', 'synthetic-race-two-password', 'Hello, Race Two');
  try {
    const members = async (page: Page) => (await page.goto('/settings/household'))?.status();
    // Learn each member id from the settings form each parent legitimately sees.
    const idOf = async (page: Page, name: string) => {
      await members(page);
      return page.getByRole('listitem').filter({ hasText: name }).locator('input[name="member"]').inputValue({ timeout: 5000 }).catch(async () => {
        await page.getByRole('listitem').filter({ hasText: name }).getByText('Disable access for').click();
        return page.getByRole('listitem').filter({ hasText: name }).locator('input[name="member"]').inputValue();
      });
    };
    const twoId = await idOf(one.page, 'Race Two');
    const oneId = await idOf(two.page, 'Race One');
    const action = '/settings/household?/disable&household=synthetic-race-household';
    const [a, b] = await Promise.all([
      one.page.request.post(action, { form: { member: twoId }, headers: { origin: base } }),
      two.page.request.post(action, { form: { member: oneId }, headers: { origin: base } })
    ]);
    const outcomes = await Promise.all([a, b].map(async (r) => (r.status() === 403 ? 'denied' : JSON.stringify(await r.json()).includes('Access disabled') ? 'disabled' : 'rejected')));
    expect(outcomes.filter((o) => o === 'disabled')).toHaveLength(1);
    const access = [(await one.page.request.get('/settings/household?household=synthetic-race-household')).status(), (await two.page.request.get('/settings/household?household=synthetic-race-household')).status()];
    expect(access.filter((status) => status === 200)).toHaveLength(1);
  } finally { await one.context.close(); await two.context.close(); }
});
