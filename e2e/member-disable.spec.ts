import { expect, test, type Browser, type Page } from '@playwright/test';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const base = 'http://127.0.0.1:4173';
const actionHeaders = { origin: base, accept: 'application/json', 'x-sveltekit-action': 'true' };
const signedOut = { type: 'redirect', status: 303, location: '/sign-in' };
async function expectSignInRedirect(page: Page, path: string) {
  const response = await page.request.get(path, { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/sign-in');
}
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

test('disabling the final membership signs out the child in their existing browser', async ({ page, browser }) => {
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
    for (const path of ['/dashboard', '/groceries', '/calendar', '/display/data']) {
      await expectSignInRedirect(kid.page, path);
    }
    const grocery = await kid.page.request.post('/groceries?/add', { form: { name: 'Forbidden item', quantity: '', unit: '' }, headers: actionHeaders });
    expect(await grocery.json()).toMatchObject(signedOut);
    const submit = await kid.page.request.post('/dashboard?/transition', { form: { id: 'revoke-pending-chore', action: 'submit' }, headers: actionHeaders });
    expect(await submit.json()).toMatchObject(signedOut);
    await kid.page.goto('/dashboard');
    await expect(kid.page).toHaveURL('/sign-in');
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
    await expectSignInRedirect(former.page, '/settings/household');
    const invite = await former.page.request.post('/settings/household?/invite', { form: { role: 'kid' }, headers: actionHeaders });
    expect(await invite.json()).toMatchObject(signedOut);
    const verify = await former.page.request.post('/dashboard?/transition', { form: { id: 'revoke-pending-chore', action: 'verify' }, headers: actionHeaders });
    expect(await verify.json()).toMatchObject(signedOut);
    const disable = await former.page.request.post('/settings/household?/disable', { form: { member: 'anyone' }, headers: actionHeaders });
    expect(await disable.json()).toMatchObject(signedOut);
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
    const access = [(await one.page.request.get('/settings/household?household=synthetic-race-household', { maxRedirects: 0 })).status(), (await two.page.request.get('/settings/household?household=synthetic-race-household', { maxRedirects: 0 })).status()];
    expect(access.sort()).toEqual([200, 303]);
  } finally { await one.context.close(); await two.context.close(); }
});

const selectedHousehold = 'synthetic-disable-selected';
const selectedSettings = `/settings/household?household=${selectedHousehold}`;

test('the same session keeps access to its other household after a parent is disabled', async ({ page, browser }) => {
  const retained = await signedInContext(browser, 'retained-parent@example.test', 'synthetic-retained-parent-password', 'Hello, Retained Parent');
  const remainingSettings = '/settings/household?household=synthetic-disable-retained';
  try {
    await retained.page.goto(selectedSettings);
    await expect(retained.page.getByText('Multi Parent · Parent', { exact: true })).toBeVisible();
    await signIn(page, 'multi-parent@example.test', 'synthetic-multi-parent-password', 'Hello, Multi Parent');
    await page.goto(selectedSettings);
    await expect(page.getByRole('combobox', { name: 'Household', exact: true })).toHaveValue(selectedHousehold);
    const member = page.getByRole('listitem').filter({ hasText: 'Retained Parent · Parent' });
    await member.getByText('Disable access for Retained Parent', { exact: true }).click();
    await member.getByRole('button', { name: 'Confirm disable Retained Parent', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Access disabled');
    await expect(member).toContainText('disabled');
    await expect(page.getByRole('combobox', { name: 'Household', exact: true })).toHaveValue(selectedHousehold);

    expect((await retained.page.request.get(selectedSettings, { maxRedirects: 0 })).status()).toBe(403);
    const write = await retained.page.request.post(`/settings/household?/invite&household=${selectedHousehold}`, {
      form: { role: 'kid' }, headers: actionHeaders, maxRedirects: 0
    });
    expect(write.status()).toBe(403);
    await retained.page.goto(remainingSettings);
    await expect(retained.page.getByText('Retained Parent · Parent (you)', { exact: true })).toBeVisible();
    await expect(retained.page.getByText('Multi Parent · Parent', { exact: true })).toHaveCount(0);
  } finally { await retained.context.close(); }
});

for (const javaScriptEnabled of [true, false]) {
  const target = javaScriptEnabled ? 'Retry Script' : 'Retry Native';
  test(`a rejected disable can be corrected with JavaScript ${javaScriptEnabled ? 'on' : 'off'}`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 375, height: 812 } });
    try {
      const login = await context.request.post(`${base}/api/auth/sign-in/email`, {
        headers: { origin: base }, data: { email: 'multi-parent@example.test', password: 'synthetic-multi-parent-password' }
      });
      expect(login.status()).toBe(200);
      const page = await context.newPage();
      await page.goto(selectedSettings);
      await expect(page.getByRole('heading', { name: 'Household access' })).toBeVisible();
      const member = page.getByRole('listitem').filter({ hasText: `${target} · Child` });
      const openConfirmation = () => member.getByText(`Disable access for ${target}`, { exact: true }).click();
      const confirm = member.getByRole('button', { name: `Confirm disable ${target}`, exact: true });
      await openConfirmation();
      await member.locator('input[name="member"]').evaluate((input: HTMLInputElement) => { input.value = 'missing-synthetic-member'; });
      await confirm.click();
      await expect(page.getByRole('status')).toContainText('That person is not part of this household');
      await expect(page.getByRole('combobox', { name: 'Household', exact: true })).toHaveValue(selectedHousehold);
      await expect(member.getByText(`${target} · Child`, { exact: true })).toBeVisible();

      await openConfirmation();
      await confirm.click();
      await expect(page.getByRole('status')).toContainText('Access disabled');
      await expect(member).toContainText('disabled');
      await expect(page.getByRole('combobox', { name: 'Household', exact: true })).toHaveValue(selectedHousehold);
    } finally { await context.close(); }
  });
}
