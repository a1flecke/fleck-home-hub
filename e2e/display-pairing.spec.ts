import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function signedIn(browser: Browser, email: string, password: string, heading: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  return { context, page };
}

/** Creates an event (optionally shared) in the signed-in parent's household. */
async function addEvent(page: Page, title: string, options: { share: boolean; description?: string }) {
  const created = await page.request.post('/calendar?/saveEvent', { form: { title, date: today(), allDay: 'on', description: options.description ?? '' }, headers: { origin } });
  expect(await created.json()).toMatchObject({ type: 'success' });
  if (!options.share) return;
  await page.goto('/display/settings');
  const item = page.getByRole('region', { name: 'Choose what to share' }).getByRole('article').filter({ hasText: title });
  await item.getByRole('button', { name: 'Show on display' }).click();
  await expect(item.getByRole('button', { name: 'Remove from display' })).toBeVisible();
}

/** A parent creates a pairing code through the real form and returns it. */
async function createCode(page: Page, label: string) {
  await page.goto('/settings/displays');
  await page.getByLabel('Display name').fill(label);
  await page.getByRole('button', { name: 'Create pairing code' }).click();
  const region = page.getByRole('region', { name: 'New pairing code' });
  await expect(region.getByRole('heading', { name: `Pairing code for ${label}` })).toBeVisible();
  const code = (await region.locator('p.font-mono').innerText()).trim();
  expect(code).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
  return code;
}

async function pairDisplay(browser: Browser, code: string, options: { javaScriptEnabled?: boolean; viewport?: { width: number; height: number } } = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1280, height: 800 }, javaScriptEnabled: options.javaScriptEnabled ?? true });
  const page = await context.newPage();
  await page.goto('/display/pair');
  await page.getByLabel('Pairing code').fill(code);
  await page.getByRole('button', { name: 'Pair this display' }).click();
  await expect(page.getByRole('heading', { name: 'Family display' })).toBeVisible();
  return { context, page };
}

async function displayToken(context: BrowserContext) {
  const cookie = (await context.cookies()).find(item => item.name === 'fleck_display');
  if (!cookie) throw new Error('display cookie missing');
  return cookie;
}

test('a parent pairs a kitchen display that shows only approved information (Journey A)', async ({ browser }) => {
  const stamp = Date.now();
  const shared = `Kitchen shared event ${stamp}`;
  const hidden = `Kitchen private event ${stamp}`;
  const parent = await signedIn(browser, 'parent@example.test', 'synthetic-parent-password', 'Hello, Sample Parent', { width: 375, height: 812 });
  let display: Awaited<ReturnType<typeof pairDisplay>> | undefined;
  try {
    await addEvent(parent.page, hidden, { share: false, description: 'PRIVATE-PAIRED-DESCRIPTION' });
    await addEvent(parent.page, shared, { share: true, description: 'PRIVATE-PAIRED-DESCRIPTION' });
    const code = await createCode(parent.page, `Kitchen screen ${stamp}`);
    // The code is shown once: reloading the page must not reveal it again.
    await parent.page.goto('/settings/displays');
    await expect(parent.page.locator('body')).not.toContainText(code);
    await expect(parent.page.getByRole('region', { name: 'Unused pairing codes' })).toContainText(`Kitchen screen ${stamp}`);

    display = await pairDisplay(browser, code);
    const page = display.page;
    expect(page.url()).toBe(`${origin}/display`);
    await expect(page.getByRole('region', { name: "Today's events" }).getByText(shared)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(hidden);
    await expect(page.locator('body')).not.toContainText('PRIVATE-PAIRED-DESCRIPTION');
    await expect(page.getByRole('link', { name: 'Back to My Day' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Choose what to share' })).toHaveCount(0);
    await page.screenshot({ path: 'docs/screenshots/display-paired-landscape.png', fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'docs/screenshots/display-paired-mobile.png', fullPage: true });

    // No ordinary account login exists on this device; the only credential is the restricted cookie.
    const cookies = await display.context.cookies();
    expect(cookies.map(item => item.name)).toEqual(['fleck_display']);
    expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/display' });
    expect(await page.evaluate(() => document.cookie)).toBe('');
    // SvelteKit keeps scroll positions in sessionStorage; the credential must not be anywhere in page storage.
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(stored).not.toContain((await displayToken(display.context)).value);

    // The pairing code is single use and the unused-code list is now empty.
    const replay = await browser.newContext();
    try {
      const attempt = await replay.newPage();
      await attempt.goto('/display/pair');
      await attempt.getByLabel('Pairing code').fill(code);
      await attempt.getByRole('button', { name: 'Pair this display' }).click();
      await expect(attempt.getByRole('alert')).toContainText('not valid');
      expect((await replay.cookies())).toEqual([]);
    } finally { await replay.close(); }
    await parent.page.goto('/settings/displays');
    const device = parent.page.getByRole('listitem').filter({ hasText: `Kitchen screen ${stamp}` });
    await expect(device).toContainText('Active');
    await expect(device).toContainText('Paired');
    await expect(parent.page.getByRole('region', { name: 'Unused pairing codes' })).toHaveCount(0);
    // Captured only after reload, so the one-time code never appears in a committed screenshot.
    await parent.page.screenshot({ path: 'docs/screenshots/displays-settings-mobile.png', fullPage: true });
    await expect(parent.page.locator('body')).not.toContainText((await displayToken(display.context)).value);
  } finally { await display?.context.close(); await parent.context.close(); }
});

test('pairing works without JavaScript and a signed-in device is told to sign out first', async ({ browser }) => {
  const stamp = Date.now();
  const parent = await signedIn(browser, 'parent@example.test', 'synthetic-parent-password', 'Hello, Sample Parent');
  try {
    const code = await createCode(parent.page, `No script screen ${stamp}`);
    // This same device is signed in as a person, so pairing is refused and the code survives.
    await parent.page.goto('/display/pair');
    await expect(parent.page.getByRole('button', { name: 'Sign out of this account' })).toBeVisible();
    await expect(parent.page.getByLabel('Pairing code')).toHaveCount(0);
    const refused = await parent.page.request.post('/display/pair', { form: { code }, headers: { origin } });
    expect(await refused.text()).toContain('"status":409');

    const display = await pairDisplay(browser, code, { javaScriptEnabled: false });
    try { await expect(display.page.getByRole('button', { name: 'Pause automatic updates' })).toBeDisabled(); }
    finally { await display.context.close(); }
  } finally { await parent.context.close(); }
});

test('a paired display cannot perform any ordinary household action (Journey B)', async ({ browser }) => {
  const stamp = Date.now();
  const parent = await signedIn(browser, 'parent@example.test', 'synthetic-parent-password', 'Hello, Sample Parent');
  const display = await pairDisplay(browser, await createCode(parent.page, `Locked screen ${stamp}`));
  try {
    const cookie = await displayToken(display.context);
    // The browser would not even send this cookie outside /display; send it anyway to prove the server refuses it.
    const headers = { cookie: `${cookie.name}=${cookie.value}`, origin };
    const client = display.context.request;
    const reads = ['/dashboard', '/calendar', '/groceries', '/meals', '/settings/household', '/settings/sessions', '/settings/displays', '/display/settings', '/api/households/synthetic/anything'];
    for (const path of reads) {
      const response = await client.get(path, { headers, maxRedirects: 0 });
      expect(response.status(), path).not.toBe(200);
      expect(await response.text(), path).not.toContain(cookie.value);
    }
    const writes: [string, Record<string, string>][] = [
      ['/dashboard?/transition', { id: 'revoke-pending-chore', action: 'verify' }],
      ['/groceries?/add', { name: `Forbidden grocery ${stamp}`, quantity: '', unit: '' }],
      ['/calendar?/saveEvent', { title: `Forbidden event ${stamp}`, date: today(), allDay: 'on' }],
      ['/display/settings?/share', { kind: 'event', id: 'x', visible: 'yes' }],
      ['/settings/household?/invite', { role: 'parent' }],
      ['/settings/household?/disable', { member: 'anyone' }],
      ['/settings/displays?/create', { label: 'Self-issued screen' }],
      ['/settings/displays?/revoke', { id: 'x' }]
    ];
    for (const [path, form] of writes) {
      const response = await client.post(path, { form, headers, maxRedirects: 0 });
      const body = await response.text();
      expect(body, path).not.toContain('"type":"success"');
      expect(response.status() === 200 ? body : String(response.status()), path).toMatch(/redirect|failure|error|^[34]\d\d$/);
    }
    const signOut = await client.post('/api/auth/list-sessions', { headers, maxRedirects: 0 });
    expect(signOut.status()).not.toBe(200);
    // Nothing was created.
    await parent.page.goto('/groceries');
    await expect(parent.page.locator('body')).not.toContainText(`Forbidden grocery ${stamp}`);
    await parent.page.goto(`/calendar?date=${today()}&view=day`);
    await expect(parent.page.locator('body')).not.toContainText(`Forbidden event ${stamp}`);
    await parent.page.goto('/settings/displays');
    await expect(parent.page.locator('body')).not.toContainText('Self-issued screen');
    // The display still works and its data endpoint never carries management or private fields.
    const data = await client.get('/display/data', { headers });
    expect(data.status()).toBe(200);
    const json = await data.json();
    expect(json).toMatchObject({ mode: 'device', canManage: false });
    expect(JSON.stringify(json)).not.toMatch(/choices|reward|notes|assignee|token|email/i);
  } finally { await display.context.close(); await parent.context.close(); }
});

test('revoking a display sends it to the pairing-required screen and the credential stays dead (Journey C)', async ({ browser }) => {
  const stamp = Date.now();
  const label = `Revocable screen ${stamp}`;
  const parent = await signedIn(browser, 'parent@example.test', 'synthetic-parent-password', 'Hello, Sample Parent', { width: 375, height: 812 });
  const display = await pairDisplay(browser, await createCode(parent.page, label), { viewport: { width: 375, height: 812 } });
  try {
    const cookie = await displayToken(display.context);
    await display.page.clock.install();
    await display.page.goto('/display');
    await expect(display.page.getByRole('button', { name: 'Pause automatic updates' })).toBeEnabled();

    await parent.page.goto('/settings/displays');
    const device = parent.page.getByRole('listitem').filter({ hasText: label });
    await device.getByText(`Revoke ${label}`).click();
    await device.getByRole('button', { name: `Confirm revoke ${label}` }).click();
    await expect(parent.page.getByRole('status')).toContainText('Display revoked');
    await expect(parent.page.getByRole('listitem').filter({ hasText: label })).toContainText('Revoked');

    await display.page.clock.fastForward(60_000);
    await expect(display.page.getByRole('heading', { name: 'Pairing required' })).toBeVisible();
    await expect(display.page.getByText('Family display')).toHaveCount(0);
    await display.page.screenshot({ path: 'docs/screenshots/display-pairing-required-mobile.png', fullPage: true });

    // Reloading cannot restore access, and the old credential is refused even when presented by hand.
    await display.page.reload();
    await expect(display.page.getByRole('heading', { name: 'Pairing required' })).toBeVisible();
    const clean = await browser.newContext();
    try {
      const response = await clean.request.get('/display/data', { headers: { cookie: `${cookie.name}=${cookie.value}` }, maxRedirects: 0 });
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ mode: 'unpaired' });
    } finally { await clean.close(); }
  } finally { await display.context.close(); await parent.context.close(); }
});

test('two households each see only their own approved records (Journey D)', async ({ browser }) => {
  const stamp = Date.now();
  const home = `Home-only event ${stamp}`;
  const other = `Other-only event ${stamp}`;
  const parentHome = await signedIn(browser, 'parent@example.test', 'synthetic-parent-password', 'Hello, Sample Parent');
  const parentOther = await signedIn(browser, 'other-parent@example.test', 'synthetic-other-parent-password', 'Hello, Other Parent');
  let homeDisplay: Awaited<ReturnType<typeof pairDisplay>> | undefined;
  let otherDisplay: Awaited<ReturnType<typeof pairDisplay>> | undefined;
  try {
    await addEvent(parentHome.page, home, { share: true });
    await addEvent(parentOther.page, other, { share: true });
    homeDisplay = await pairDisplay(browser, await createCode(parentHome.page, `Home screen ${stamp}`));
    otherDisplay = await pairDisplay(browser, await createCode(parentOther.page, `Other screen ${stamp}`));
    await expect(homeDisplay.page.getByText(home)).toBeVisible();
    await expect(homeDisplay.page.locator('body')).not.toContainText(other);
    await expect(otherDisplay.page.getByText(other)).toBeVisible();
    await expect(otherDisplay.page.locator('body')).not.toContainText(home);
    // A parent sees only their own household's displays.
    await parentOther.page.goto('/settings/displays');
    await expect(parentOther.page.locator('body')).not.toContainText(`Home screen ${stamp}`);
    await expect(parentOther.page.getByRole('listitem').filter({ hasText: `Other screen ${stamp}` })).toBeVisible();
  } finally {
    await homeDisplay?.context.close(); await otherDisplay?.context.close();
    await parentHome.context.close(); await parentOther.context.close();
  }
});

test('disabling the pairing parent invalidates their displays but not the other parent\'s (Journey E)', async ({ browser }) => {
  const stamp = Date.now();
  const one = await signedIn(browser, 'display-one@example.test', 'synthetic-display-one-password', 'Hello, Display Parent One');
  const two = await signedIn(browser, 'display-two@example.test', 'synthetic-display-two-password', 'Hello, Display Parent Two');
  const bystander = await signedIn(browser, 'other-parent@example.test', 'synthetic-other-parent-password', 'Hello, Other Parent');
  let oneDisplay: Awaited<ReturnType<typeof pairDisplay>> | undefined;
  let twoDisplay: Awaited<ReturnType<typeof pairDisplay>> | undefined;
  let otherHousehold: Awaited<ReturnType<typeof pairDisplay>> | undefined;
  try {
    oneDisplay = await pairDisplay(browser, await createCode(one.page, `One screen ${stamp}`));
    twoDisplay = await pairDisplay(browser, await createCode(two.page, `Two screen ${stamp}`));
    otherHousehold = await pairDisplay(browser, await createCode(bystander.page, `Bystander screen ${stamp}`));
    const pending = await createCode(one.page, `Unredeemed screen ${stamp}`);
    await two.page.goto('/settings/household');
    const person = two.page.getByRole('listitem').filter({ hasText: 'Display Parent One' });
    await person.getByText('Disable access for Display Parent One').click();
    await person.getByRole('button', { name: 'Confirm disable Display Parent One' }).click();
    await expect(two.page.getByRole('status')).toContainText('Access disabled');

    for (const display of [oneDisplay, twoDisplay, otherHousehold]) await display.page.reload();
    await expect(oneDisplay.page.getByRole('heading', { name: 'Pairing required' })).toBeVisible();
    await expect(twoDisplay.page.getByRole('heading', { name: 'Family display' })).toBeVisible();
    await expect(otherHousehold.page.getByRole('heading', { name: 'Family display' })).toBeVisible();

    const late = await browser.newContext();
    try {
      const page = await late.newPage();
      await page.goto('/display/pair');
      await page.getByLabel('Pairing code').fill(pending);
      await page.getByRole('button', { name: 'Pair this display' }).click();
      await expect(page.getByRole('alert')).toContainText('not valid');
    } finally { await late.close(); }
    await two.page.goto('/settings/displays');
    await expect(two.page.getByRole('listitem').filter({ hasText: `One screen ${stamp}` })).toContainText('Revoked');
    await expect(two.page.getByRole('listitem').filter({ hasText: `Two screen ${stamp}` })).toContainText('Active');
    // The disabled parent can no longer open display management or create codes.
    expect((await one.page.request.get('/settings/displays')).status()).toBe(403);
  } finally {
    for (const item of [oneDisplay, twoDisplay, otherHousehold]) await item?.context.close();
    await one.context.close(); await two.context.close(); await bystander.context.close();
  }
});

test('display management rejects children, cross-origin requests and invalid names', async ({ browser }) => {
  const kid = await signedIn(browser, 'kid@example.test', 'synthetic-kid-password', "Sample Kid's My Day");
  const parent = await signedIn(browser, 'parent@example.test', 'synthetic-parent-password', 'Hello, Sample Parent');
  try {
    expect((await kid.page.request.get('/settings/displays')).status()).toBe(403);
    const childCreate = await kid.page.request.post('/settings/displays?/create', { form: { label: 'Child screen' }, headers: { origin } });
    expect(await childCreate.text()).not.toContain('"type":"success"');
    const anonymous = await (await browser.newContext()).request.get('/settings/displays', { maxRedirects: 0 });
    expect(anonymous.status()).toBe(303);
    const crossOrigin = await parent.page.request.post('/settings/displays?/create', { form: { label: 'Cross origin screen' }, headers: { origin: 'https://attacker.example.test' } });
    expect(await crossOrigin.text()).toContain('403');
    await parent.page.goto('/settings/displays');
    await parent.page.getByLabel('Display name').fill('   ');
    await parent.page.getByRole('button', { name: 'Create pairing code' }).click();
    await expect(parent.page.getByRole('status')).toContainText('1 to 60 characters');
    await expect(parent.page.locator('body')).not.toContainText('Cross origin screen');
    const response = await parent.page.request.get('/settings/displays');
    expect(response.headers()['cache-control']).toBe('no-store');
  } finally { await kid.context.close(); await parent.context.close(); }
});
