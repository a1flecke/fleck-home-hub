import { expect, test } from '@playwright/test';

test('pausing and resuming discards a refresh started before the pause', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/display/data', async route => {
    const response = await route.fetch();
    const body = await response.json();
    started();
    await held;
    await route.fulfill({ response, json: { ...body, today: '2000-01-01' } }).catch(() => {});
  });
  await page.goto('/display');
  await expect(page.getByRole('button', { name: 'Pause automatic updates' })).toBeEnabled();
  await page.clock.fastForward(60_000);
  await requested;
  await page.getByRole('button', { name: 'Pause automatic updates' }).click();
  await page.getByRole('button', { name: 'Resume automatic updates' }).click();
  const response = page.waitForResponse('**/display/data');
  release();
  await response;
  await page.clock.runFor(100);
  await expect(page.getByRole('button', { name: 'Pause automatic updates' })).toBeVisible();
  await expect(page.getByText('2000-01-01', { exact: false })).toHaveCount(0);
});

test('a stalled refresh reports a connection problem and later recovers', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  let requests = 0;
  await page.route('**/display/data', async route => {
    requests++;
    if (requests === 1) {
      started();
      await held;
      await route.abort().catch(() => {});
    } else {
      await route.continue();
    }
  });
  try {
    await page.goto('/display');
    await expect(page.getByRole('button', { name: 'Pause automatic updates' })).toBeEnabled();
    await page.clock.fastForward(60_000);
    await requested;
    await page.clock.runFor(15_000);
    await expect(page.getByRole('status')).toContainText('Unable to update the display');
    const response = page.waitForResponse('**/display/data');
    await page.clock.fastForward(60_000);
    await response;
    await expect(page.getByRole('status')).toHaveCount(0);
  } finally { release(); }
});

test('a parent explicitly shares an event and changes appear on the family display', async ({ page }, testInfo) => {
  const title = `Synthetic shared event ${testInfo.repeatEachIndex}`;
  const updated = `Updated synthetic event ${testInfo.repeatEachIndex}`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const anonymous = await page.request.get('/display', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers().location).toBe('/sign-in');
  const anonymousData = await page.request.get('/display/data', { maxRedirects: 0 });
  expect(anonymousData.status()).toBe(303);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const created = await page.request.post('/calendar?/saveEvent', { form: { title, date: today, allDay: 'on' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(await created.json()).toMatchObject({ type: 'success', status: 200 });
  const initialDisplay = await page.goto('/display');
  expect(await initialDisplay?.text()).not.toContain(title);
  await expect(page.locator('meta[http-equiv="refresh" i]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Refresh display' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Family display' })).toBeVisible();
  const todaySection = page.getByRole('region', { name: "Today's events" });
  await expect(page.locator('body')).not.toContainText(title);
  await page.getByRole('link', { name: 'Choose what to share' }).click();
  const sharing = page.getByRole('region', { name: 'Choose what to share' });
  const event = sharing.getByRole('article').filter({ hasText: title });
  const id = await event.locator('input[name="id"]').inputValue();
  await event.getByRole('button', { name: 'Show on display' }).click();
  await expect(event.getByRole('button', { name: 'Remove from display' })).toBeVisible();
  await page.clock.install();
  await page.getByRole('link', { name: 'View family display' }).click();
  await expect(todaySection.getByText(title)).toBeVisible();
  const change = await page.request.post('/calendar?/saveEvent', { form: { id, title: updated, date: today, allDay: 'on' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(await change.json()).toMatchObject({ type: 'success', status: 200 });
  await page.clock.fastForward(60_000);
  await expect(todaySection.getByText(updated)).toBeVisible();
  await page.getByRole('button', { name: 'Pause automatic updates' }).click();
  const pausedChange = await page.request.post('/calendar?/saveEvent', { form: { id, title, date: today, allDay: 'on' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(await pausedChange.json()).toMatchObject({ type: 'success', status: 200 });
  await page.clock.fastForward(60_000);
  await expect(todaySection.getByText(updated)).toBeVisible();
  await page.getByRole('button', { name: 'Resume automatic updates' }).click();
  await page.clock.fastForward(60_000);
  await expect(todaySection.getByText(title)).toBeVisible();
  await page.context().setOffline(true);
  try {
    await page.clock.fastForward(60_000);
    await expect(page.getByRole('status')).toContainText('Unable to update the display');
  } finally { await page.context().setOffline(false); }
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: testInfo.outputPath('display-landscape.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: testInfo.outputPath('display-mobile.png'), fullPage: true });
  await page.goto(`/calendar?date=${today}&view=day`);
  const calendarEvent = page.getByRole('article').filter({ hasText: title });
  await calendarEvent.getByText('Edit event').click();
  await calendarEvent.getByLabel('Event title').fill(updated);
  await calendarEvent.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('article').filter({ hasText: updated })).toBeVisible();
  await page.goto('/display');
  await expect(todaySection.getByText(updated)).toBeVisible();
  await expect(todaySection.getByText(title, { exact: true })).toHaveCount(0);
});

test('children cannot manage display settings and responses are private', async ({ page }, testInfo) => {
  const title = `Synthetic private fixture ${testInfo.repeatEachIndex}`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const created = await page.request.post('/calendar?/saveEvent', { form: { title, date: today, allDay: 'on' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(await created.json()).toMatchObject({ type: 'success', status: 200 });
  await page.goto('/display/settings');
  const fixture = page.getByRole('article').filter({ hasText: title });
  const id = await fixture.locator('input[name="id"]').inputValue();
  const forged = await page.request.post('/display/settings?/share', { form: { kind: 'event', id, visible: 'yes' }, headers: { origin: 'https://attacker.example.test' } });
  expect(forged.status()).toBe(403);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  const display = await page.request.get('/display');
  expect(display.status()).toBe(200);
  expect(display.headers()['cache-control']).toContain('no-store');
  const data = await page.request.get('/display/data');
  expect(data.status()).toBe(200);
  expect(data.headers()['cache-control']).toContain('no-store');
  expect(await data.text()).not.toContain(title);
  expect((await page.request.get('/display/settings')).status()).toBe(403);
  const change = await page.request.post('/display/settings?/share', { form: { kind: 'event', id, visible: 'yes' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(change.status()).toBe(403);
});

test('a selected chore shows its current progress without displaying its reward', async ({ page }, testInfo) => {
  const title = `Synthetic display chore ${testInfo.repeatEachIndex}`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const add = page.locator('details').filter({ has: page.getByText('Add a chore', { exact: true }) });
  await add.getByText('Add a chore', { exact: true }).click();
  await add.getByLabel('Chore title').fill(title);
  await add.getByLabel('Assigned child').selectOption({ label: 'Sample Kid' });
  await add.getByLabel('Due date').fill(today);
  await add.getByLabel('Reward in dollars').fill('2.00');
  await add.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.getByRole('article').filter({ hasText: title })).toBeVisible();
  await page.goto('/display/settings');
  const choice = page.getByRole('article').filter({ hasText: title });
  await choice.getByRole('button', { name: 'Show on display' }).click();
  await expect(choice.getByRole('button', { name: 'Remove from display' })).toBeVisible();
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome home' })).toBeVisible();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  const chore = page.getByRole('article').filter({ hasText: title });
  await chore.getByRole('button', { name: 'Mark complete' }).click();
  await expect(chore.getByText('Waiting for parent verification')).toBeVisible();
  const response = await page.goto('/display');
  const displayChore = page.getByRole('region', { name: 'Shared chores' }).getByRole('article').filter({ hasText: title });
  await expect(displayChore.getByText('Waiting for a parent')).toBeVisible();
  expect(await response?.text()).not.toContain('$2.00');
});

test('manual display refresh works without JavaScript', async ({ page, browser }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    const display = await context.newPage();
    await display.goto('/display');
    await expect(display.getByRole('button', { name: 'Pause automatic updates' })).toBeDisabled();
    await display.getByRole('link', { name: 'Refresh display' }).click();
    await expect(display.getByRole('heading', { name: 'Family display' })).toBeVisible();
  } finally { await context.close(); }
});
