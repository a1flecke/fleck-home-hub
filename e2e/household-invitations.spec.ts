import { expect, test, openInvitation } from './invitation-test';

test.use({ trace: 'off', screenshot: 'off', video: 'off', viewport: { width: 375, height: 812 } });

test('a parent invites another parent and that parent can manage household access', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/settings/household');
  await expect(page.getByRole('heading', { name: 'Household access' })).toBeVisible();
  await page.getByLabel('Invite as').selectOption('parent');
  const submission = page.waitForRequest((request) => request.method() === 'POST');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  expect((await submission).headers().origin).toBe('http://127.0.0.1:4173');
  await expect(page.getByLabel('Invitation link')).toBeVisible();
  const link = await page.getByLabel('Invitation link').inputValue();
  await page.getByLabel('Invitation link').evaluate((input: HTMLInputElement) => { input.value = ''; input.removeAttribute('value'); });
  expect(link.includes('/accept-invitation#')).toBe(true);
  await expect(page.getByText('Parent invitation pending')).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, recordVideo: undefined });
  try {
    const invitee = await context.newPage();
    await openInvitation(invitee, link);
    await invitee.getByLabel('Name').fill('Invited Parent');
    await invitee.getByLabel('Email').fill('invited-parent@example.test');
    await invitee.getByLabel('Password').fill('synthetic-invited-parent-password');
    await invitee.getByRole('button', { name: 'Create account' }).click();
    await expect(invitee.getByText('Your account is ready.', { exact: false })).toBeVisible();
    await invitee.goto('/sign-in');
    await invitee.getByLabel('Email').fill('invited-parent@example.test');
    await invitee.getByLabel('Password').fill('synthetic-invited-parent-password');
    await invitee.getByRole('button', { name: 'Sign in' }).click();
    await expect(invitee.getByRole('heading', { name: 'Hello, Invited Parent' })).toBeVisible();
    await invitee.goto('/settings/household');
    await expect(invitee.getByRole('listitem').filter({ hasText: 'Invited Parent · Parent (you)' })).toBeVisible();
    await expect(invitee.getByRole('listitem').filter({ hasText: 'Sample Parent · Parent' })).toBeVisible();
  } finally { await context.close(); }
});

test('a child joins after correcting an existing-email error and cannot administer access', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/settings/household');
  await page.getByLabel('Invite as').selectOption('kid');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByText('Child invitation pending')).toBeVisible();
  const link = await page.getByLabel('Invitation link').inputValue();
  await page.getByLabel('Invitation link').evaluate((input: HTMLInputElement) => { input.value = ''; input.removeAttribute('value'); });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const child = await context.newPage();
    await openInvitation(child, link);
    await child.getByLabel('Name').fill('Invited Child');
    await child.getByLabel('Email').fill('parent@example.test');
    await child.getByLabel('Password').fill('synthetic-child-password');
    await child.getByRole('button', { name: 'Create account' }).click();
    await expect(child.getByRole('alert')).toContainText('existing accounts cannot be linked');
    await expect(child.getByLabel('Name')).toHaveValue('Invited Child');
    await child.getByLabel('Email').fill('invited-child@example.test');
    await child.getByLabel('Password').fill('synthetic-child-password');
    await child.getByRole('button', { name: 'Create account' }).click();
    await expect(child.getByText('Your account is ready.', { exact: false })).toBeVisible();
    await child.goto('/sign-in');
    await child.getByLabel('Email').fill('invited-child@example.test');
    await child.getByLabel('Password').fill('synthetic-child-password');
    await child.getByRole('button', { name: 'Sign in' }).click();
    await expect(child.getByRole('heading', { name: "Invited Child's My Day" })).toBeVisible();
    const response = await child.goto('/settings/household');
    expect(response?.status()).toBe(403);
  } finally { await context.close(); }
});

test('child role selected before hydration is submitted as child', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void, blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/settings/household/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await delayed.goto('/settings/household', { waitUntil: 'commit' });
    await requested;
    await delayed.getByLabel('Invite as').selectOption('kid');
    release();
    await delayed.waitForLoadState('networkidle');
    await expect(delayed.getByLabel('Invite as')).toHaveValue('kid');
    const form = delayed.locator('form[action^="?/invite"]');
    expect(await form.evaluate((element: HTMLFormElement) => new FormData(element).get('role'))).toBe('kid');
    await form.getByRole('button', { name: 'Create invitation' }).click();
    await delayed.getByLabel('Invitation link').evaluate((element: HTMLInputElement) => { element.value = ''; element.removeAttribute('value'); });
    await expect(delayed.getByText('Child invitation pending')).toBeVisible();
  } finally { release(); await context.close(); }
});

test('household invitation actions reject anonymous, child, cross-household, and forged role requests', async ({ request }) => {
  const origin = 'http://127.0.0.1:4173';
  const headers = { origin, accept: 'application/json', 'x-sveltekit-action': 'true' };
  const anonymous = await request.post('/settings/household?/invite', { headers, form: { role: 'parent' }, maxRedirects: 0 });
  const anonymousBody = await anonymous.json();
  expect(anonymousBody).toMatchObject({ type: 'redirect', status: 303, location: '/sign-in' });
  const login = await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: 'kid@example.test', password: 'synthetic-kid-password' } });
  expect(login.status()).toBe(200);
  expect((await request.get('/dashboard')).status()).toBe(200);
  const child = await request.post('/settings/household?/invite', { headers, form: { role: 'parent' } });
  expect(child.status()).toBe(403);
  expect((await child.json()).type).toBe('error');
  await request.post('/api/auth/sign-out', { headers: { origin }, data: {} });
  const parentLogin = await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: 'parent@example.test', password: 'synthetic-parent-password' } });
  expect(parentLogin.status()).toBe(200);
  expect((await request.get('/dashboard')).status()).toBe(200);
  const other = await request.post('/settings/household?/invite&household=synthetic-other-household', { headers, form: { role: 'kid' } });
  expect(other.status()).toBe(403);
  expect((await other.json()).type).toBe('error');
  const forged = await request.post('/settings/household?/invite', { headers, form: { role: 'administrator' } });
  expect(forged.status()).toBe(400);
  expect(await forged.json()).toMatchObject({ type: 'failure', status: 400 });
});

test('account details entered before hydration survive and are submitted', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/settings/household');
  await page.getByLabel('Invite as').selectOption('kid');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = await page.getByLabel('Invitation link').inputValue();
  await page.getByLabel('Invitation link').evaluate((input: HTMLInputElement) => { input.value = ''; input.removeAttribute('value'); });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  let release!: () => void, blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/accept-invitation/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await openInvitation(delayed, link, { waitUntil: 'commit' });
    await requested;
    await delayed.getByLabel('Name').fill('Early Child');
    await delayed.getByLabel('Email').fill('early-child@example.test');
    await delayed.getByLabel('Password').fill('synthetic-early-child-password');
    await expect(delayed.getByRole('button', { name: 'Create account' })).toBeDisabled();
    release();
    await delayed.waitForLoadState('networkidle');
    await expect(delayed.getByLabel('Name')).toHaveValue('Early Child');
    await expect(delayed.getByLabel('Email')).toHaveValue('early-child@example.test');
    await expect(delayed.getByLabel('Password')).toHaveValue('synthetic-early-child-password');
    const form = delayed.locator('form');
    expect(await form.evaluate((element: HTMLFormElement) => { const data = new FormData(element); return [data.get('name'), data.get('email'), data.get('password')]; })).toEqual(['Early Child', 'early-child@example.test', 'synthetic-early-child-password']);
    await delayed.getByRole('button', { name: 'Create account' }).click();
    await expect(delayed.getByText('Your account is ready.', { exact: false })).toBeVisible();
  } finally { release(); await context.close(); }
});


test('household selection made before hydration survives and opens the chosen household', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('multi-parent@example.test');
  await page.getByLabel('Password').fill('synthetic-multi-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Multi Parent' })).toBeVisible();
  let release!: () => void, blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    await page.route('**/src/routes/settings/household/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await page.goto('/settings/household', { waitUntil: 'commit' });
    await requested;
    const selector = page.locator('select[name=household]');
    await selector.selectOption('synthetic-other-household');
    release();
    await page.waitForLoadState('networkidle');
    await expect(selector).toHaveValue('synthetic-other-household');
    const form = selector.locator('xpath=ancestor::form');
    expect(await form.evaluate((element: HTMLFormElement) => new FormData(element).get('household'))).toBe('synthetic-other-household');
    await form.getByRole('button', { name: 'Show household' }).click();
    await expect(page.getByText('Other Parent · Parent')).toBeVisible();
    await expect(page.getByText('Sample Parent · Parent')).toHaveCount(0);
  } finally { release(); }
});


for (const javaScriptEnabled of [true, false]) {
  test(`failed child invitation preserves role for correction (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled });
    const page = await context.newPage();
    try {
      // The sign-in control requires JavaScript, so authenticate through the real API.
      const origin = 'http://127.0.0.1:4173';
      const login = await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'multi-parent@example.test', password: 'synthetic-multi-parent-password' } });
      expect(login.status()).toBe(200);
      await page.goto('/settings/household?household=synthetic-failure-household');
      await expect(page.getByRole('heading', { name: 'Household access' })).toBeVisible();
      await page.getByLabel('Invite as').selectOption('kid');
      await page.getByRole('button', { name: 'Create invitation' }).click();
      await expect(page.getByRole('status')).toContainText('could not be created');
      await expect(page.getByLabel('Invite as')).toHaveValue('kid');
      await expect(page.locator('select[name=household]')).toHaveValue('synthetic-failure-household');
      await page.getByLabel('Invite as').selectOption('parent');
      await page.getByRole('button', { name: 'Create invitation' }).click();
      await expect(page.getByLabel('Invitation link')).toBeVisible();
      await page.getByLabel('Invitation link').evaluate((input: HTMLInputElement) => { input.value = ''; input.removeAttribute('value'); });
      await expect(page.getByText('Parent invitation pending').last()).toBeVisible();
    } finally { await context.close(); }
  });
}


test('a parent revokes a copied invitation and redemption fails', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/settings/household');
  await page.getByLabel('Invite as').selectOption('kid');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = await page.getByLabel('Invitation link').inputValue();
  await page.getByLabel('Invitation link').evaluate((input: HTMLInputElement) => { input.value = ''; input.removeAttribute('value'); });
  const id = await page.locator('article').last().locator('input[name=id]').inputValue();
  let release!: () => void, blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    await page.route('**/src/routes/settings/household/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await page.goto('/settings/household', { waitUntil: 'commit' });
    await requested;
    const pending = page.locator(`article:has(input[value="${id}"])`);
    await pending.getByText('Revoke invitation', { exact: true }).click();
    await expect(pending.getByText('This link will stop working.')).toBeVisible();
    release();
    await page.waitForLoadState('networkidle');
    await expect(pending.getByText('This link will stop working.')).toBeVisible();
    await pending.getByRole('button', { name: 'Confirm revoke' }).click();
  } finally { release(); }
  await expect(page.getByRole('status')).toHaveText('Invitation revoked.');
  await expect(page.locator(`article:has(input[value="${id}"])`)).toHaveCount(0);
  const context = await browser.newContext();
  try {
    const invitee = await context.newPage();
    await openInvitation(invitee, link);
    await invitee.getByLabel('Name').fill('Revoked Invitee');
    await invitee.getByLabel('Email').fill('revoked-invitee@example.test');
    await invitee.getByLabel('Password').fill('synthetic-invitee-password');
    await invitee.getByRole('button', { name: 'Create account' }).click();
    await expect(invitee.getByRole('alert')).toContainText('been revoked');
  } finally { await context.close(); }
});

test('invitation routes enforce revocation authorization, origin and privacy headers', async ({ request, browser }) => {
  const origin = 'http://127.0.0.1:4173';
  const headers = { origin, accept: 'application/json', 'x-sveltekit-action': 'true' };
  // Use a real pending record for each negative authorization request.
  const parent = await browser.newContext();
  try {
    const login = await parent.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'parent@example.test', password: 'synthetic-parent-password' } });
    expect(login.status()).toBe(200);
    const page = await parent.newPage();
    await page.goto('/settings/household');
    await expect(page.getByRole('heading', { name: 'Household access' })).toBeVisible();
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(page.getByLabel('Invitation link')).toBeVisible();
    await page.getByLabel('Invitation link').evaluate((input: HTMLInputElement) => { input.value = ''; input.removeAttribute('value'); });
    const id = await page.locator('article').last().locator('input[name=id]').inputValue();
    const anonymous = await request.post('/settings/household?/revoke', { headers, form: { id }, maxRedirects: 0 });
    expect(await anonymous.json()).toMatchObject({ type: 'redirect', status: 303, location: '/sign-in' });
    for (const email of ['kid@example.test', 'other-parent@example.test']) {
      const password = email.startsWith('kid') ? 'synthetic-kid-password' : 'synthetic-other-parent-password';
      const signedIn = await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email, password } });
      expect(signedIn.status()).toBe(200);
      expect((await request.get('/dashboard')).status()).toBe(200);
      const denied = await request.post('/settings/household?/revoke', { headers, form: { id } });
      expect(denied.status()).toBe(email.startsWith('kid') ? 403 : 400);
      expect((await denied.json()).type).toBe(email.startsWith('kid') ? 'error' : 'failure');
      await request.post('/api/auth/sign-out', { headers: { origin }, data: {} });
    }
    for (const action of ['invite', 'revoke']) {
      const denied = await parent.request.post(`${origin}/settings/household?/${action}`, { headers: { ...headers, origin: 'https://untrusted.example.test' }, form: { role: 'kid', id } });
      expect(denied.status()).toBe(403);
    }
    const accept = await request.post('/accept-invitation', { headers: { ...headers, origin: 'https://untrusted.example.test' }, form: { token: 'a'.repeat(43) } });
    expect(accept.status()).toBe(403);
    for (const path of ['/settings/household', '/accept-invitation']) {
      const response = await parent.request.get(`${origin}${path}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(response.headers()['referrer-policy']).toBe('origin');
    }
    const revoked = await parent.request.post(`${origin}/settings/household?/revoke`, { headers, form: { id } });
    expect(await revoked.json()).toMatchObject({ type: 'success', status: 200 });
  } finally { await parent.close(); }
});
