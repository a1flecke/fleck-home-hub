import { expect, test, type Page } from '@playwright/test';

function articleByTitle(page: Page, title: string) {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

async function waitForHydration(page: Page) {
  // Calendar submissions are native form POSTs followed by a full document load.
  // Let module loading settle before editing bound fields so Svelte hydration
  // cannot run between Playwright's select and insert steps.
  await page.waitForLoadState('networkidle');
}

test('parent creates and edits an event and schedules an inbox item', async ({ page }, testInfo) => {
  const eventTitle = `Synthetic calendar walk ${testInfo.repeatEachIndex}`;
  const updatedTitle = `Synthetic walk updated ${testInfo.repeatEachIndex}`;
  const inboxTitle = `Synthetic dentist ${testInfo.repeatEachIndex}`;
  const updatedInboxTitle = `Synthetic dentist visit ${testInfo.repeatEachIndex}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.getByRole('link', { name: 'Family calendar' }).click();
  await page.goto('/calendar?date=2099-03-07&view=day');
  await waitForHydration(page);
  const addEvent = page.locator('details').filter({ has: page.getByText('Add an event', { exact: true }) });
  await addEvent.getByText('Add an event', { exact: true }).click();
  const create = addEvent.locator('form[action^="?/saveEvent"]');
  await create.getByLabel('Event title').fill(eventTitle);
  await create.getByLabel('Event date').fill('2099-03-07');
  await create.getByLabel('All day').check();
  await create.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByText('Event saved.')).toBeVisible();
  await waitForHydration(page);
  const event = articleByTitle(page, eventTitle);
  await expect(event).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('calendar-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('calendar-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await event.getByText('Edit event').click();
  await event.getByLabel('Event title').fill(updatedTitle);
  await event.getByLabel('All day').uncheck();
  await event.getByLabel('Start time').fill('15:00');
  await event.getByLabel('End time').fill('14:00');
  await event.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Unable to save event');
  await waitForHydration(page);
  await expect(event.getByLabel('Event title')).toHaveValue(updatedTitle);
  await event.getByLabel('End time').fill('16:00');
  await event.getByRole('button', { name: 'Save changes' }).click();
  await expect(articleByTitle(page, updatedTitle).getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();
  await waitForHydration(page);
  const addInbox = page.locator('details').filter({ has: page.getByText('Add to the inbox', { exact: true }) });
  await addInbox.getByText('Add to the inbox', { exact: true }).click();
  const inbox = addInbox.locator('form[action^="?/addInbox"]');
  await inbox.getByLabel('Inbox title').fill(inboxTitle);
  await inbox.getByRole('button', { name: 'Add item' }).click();
  const item = articleByTitle(page, inboxTitle);
  await expect(item).toBeVisible();
  await waitForHydration(page);
  await item.getByText('Edit item').click();
  await item.getByLabel('Inbox title').fill('   ');
  await expect(item.getByLabel('Inbox title')).toHaveValue('   ');
  await item.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('status')).toContainText('Unable to save item');
  await waitForHydration(page);
  await expect(item.getByLabel('Inbox title')).toHaveValue('   ');
  await item.getByLabel('Inbox title').fill(updatedInboxTitle);
  await item.getByRole('button', { name: 'Save item' }).click();
  const updated = articleByTitle(page, updatedInboxTitle);
  await expect(updated).toBeVisible();
  await waitForHydration(page);
  await updated.getByText('Schedule this').click();
  await updated.getByLabel('Event date').fill('2099-03-08');
  await updated.getByLabel('Start time').fill('15:00');
  await updated.getByLabel('End time').fill('14:00');
  await updated.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByRole('status')).toContainText('Unable to save event');
  await waitForHydration(page);
  await expect(updated.getByLabel('Event date')).toHaveValue('2099-03-08');
  await updated.getByLabel('End time').fill('16:00');
  await updated.getByRole('button', { name: 'Schedule event' }).click();
  await expect(page.getByText('Event saved.')).toBeVisible();
  await page.goto('/calendar?date=2099-03-08&view=day');
  await expect(articleByTitle(page, updatedInboxTitle)).toBeVisible();
});

test('pre-hydration event edits survive hydration and are saved', async ({ page, browser }, testInfo) => {
  const title = `Hydration calendar event ${testInfo.repeatEachIndex}`;
  const updatedTitle = `Edited before hydration ${testInfo.repeatEachIndex}`;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const created = await page.request.post('/calendar?/saveEvent', { form: { title, date: '2099-07-01', allDay: 'on' }, headers: { origin: 'http://127.0.0.1:4173' } });
  expect(await created.json()).toMatchObject({ type: 'success', status: 200 });
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void;
  let blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/calendar/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await delayed.goto('/calendar?date=2099-07-01&view=day', { waitUntil: 'commit' });
    await requested;
    const article = articleByTitle(delayed, title);
    await article.getByText('Edit event').click();
    await article.getByLabel('Event title').fill(updatedTitle);
    await article.getByLabel('Event date').fill('2099-07-02');
    await article.getByLabel('Description (optional)').fill('Synthetic description');
    await article.getByLabel('All day').uncheck();
    await article.getByLabel('Sunday').check();
    await article.getByLabel('Sample Kid').check();
    await article.getByLabel('Start time').fill('09:00');
    await article.getByLabel('End time').fill('10:00');
    release();
    await delayed.waitForLoadState('networkidle');
    await expect(article.getByLabel('Event title')).toHaveValue(updatedTitle);
    await expect(article.getByLabel('Event date')).toHaveValue('2099-07-02');
    await expect(article.getByLabel('Description (optional)')).toHaveValue('Synthetic description');
    await expect(article.getByLabel('All day')).not.toBeChecked();
    await expect(article.getByLabel('Sunday')).toBeChecked();
    await expect(article.getByLabel('Sample Kid')).toBeChecked();
    const submitted = await article.locator('form[action^="?/saveEvent"]').evaluate(form => [...new FormData(form as HTMLFormElement).entries()]);
    expect(submitted).toContainEqual(['weekday', '0']);
    expect(submitted.some(([name]) => name === 'participant')).toBe(true);
    await article.getByLabel('Sunday').uncheck();
    await article.getByRole('button', { name: 'Save changes' }).click();
    await expect(delayed.getByText('Event saved.')).toBeVisible();
    await delayed.goto('/calendar?date=2099-07-02&view=day');
    const saved = articleByTitle(delayed, updatedTitle);
    await expect(saved.locator('p').filter({ hasText: 'Synthetic description' })).toBeVisible();
    await expect(saved.getByText(/09:00–10:00/)).toBeVisible();
  } finally { release(); await context.close(); }
});

test('calendar view and inbox owner selections survive delayed hydration', async ({ page, browser }, testInfo) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const existing = await page.request.post('/calendar?/addInbox', {
    form: { title: `Existing inbox item ${testInfo.repeatEachIndex}`, description: '', owner: '' },
    headers: { origin: 'http://127.0.0.1:4173' }
  });
  expect(await existing.json()).toMatchObject({ type: 'success', status: 200 });
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  let release!: () => void, blocked!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { blocked = resolve; });
  try {
    const delayed = await context.newPage();
    await delayed.route('**/src/routes/calendar/+page.svelte*', async route => { blocked(); await gate; await route.continue(); });
    await delayed.goto('/calendar?date=2099-08-01&view=day', { waitUntil: 'commit' }); await requested;
    const view = delayed.locator('form[method="GET"] select[name="view"]');
    await view.selectOption('month');
    const addInbox = delayed.locator('details').filter({ has: delayed.getByText('Add to the inbox', { exact: true }) });
    await addInbox.getByText('Add to the inbox', { exact: true }).click();
    const owner = addInbox.getByLabel('Tentative owner');
    await owner.selectOption({ label: 'Sample Kid' });
    const selected = await owner.inputValue();
    release(); await delayed.waitForLoadState('networkidle');
    await expect(view).toHaveValue('month');
    await expect(owner).toHaveValue(selected);
    expect(await owner.evaluate(element => new FormData((element as HTMLSelectElement).form!).get('owner'))).toBe(selected);
  } finally { release(); await context.close(); }
});

test('calendar routes reject anonymous, child and cross-origin mutations', async ({ page }) => {
  const headers = { origin: 'http://127.0.0.1:4173' };
  const form = { title: 'Forged event', date: '2099-08-01', allDay: 'on' };
  const anonymous = await page.request.post('/calendar?/saveEvent', { form, headers, maxRedirects: 0 });
  expect(await anonymous.json()).toMatchObject({ type: 'redirect', status: 303, location: '/sign-in' });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  const child = await page.request.post('/calendar?/saveEvent', { form, headers });
  expect(child.status()).toBe(403);
  expect(await child.json()).toMatchObject({ type: 'failure', status: 403 });
  const crossOrigin = await page.request.post('/calendar?/saveEvent', { form, headers: { origin: 'https://attacker.example.test' } });
  expect(crossOrigin.status()).toBe(403);
  const response = await page.request.get('/calendar');
  expect(response.headers()['cache-control']).toContain('no-store');
});

test('calendar event creation works without JavaScript', async ({ page, browser }, testInfo) => {
  const title = `No script calendar event ${testInfo.repeatEachIndex}`;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const noScript = await context.newPage();
    await noScript.goto('/calendar?date=2099-09-01&view=day');
    const addEvent = noScript.locator('details').filter({ has: noScript.getByText('Add an event', { exact: true }) });
    await addEvent.getByText('Add an event', { exact: true }).click();
    const form = addEvent.locator('form[action^="?/saveEvent"]');
    await form.getByLabel('Event title').fill(title);
    await form.getByLabel('All day').check();
    await form.getByRole('button', { name: 'Save event' }).click();
    await expect(articleByTitle(noScript, title)).toBeVisible();
  } finally { await context.close(); }
});

test('invalid event retains entered details for correction', async ({ page }, testInfo) => {
  const title = `Synthetic appointment ${testInfo.repeatEachIndex}`;
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
  await page.goto('/calendar?date=2099-10-01&view=day');
  const section = page.locator('details').filter({ has: page.getByText('Add an event', { exact: true }) });
  await section.getByText('Add an event', { exact: true }).click();
  await section.getByLabel('Event title').fill(title);
  await section.getByLabel('Start time').fill('15:00');
  await section.getByLabel('End time').fill('14:00');
  await section.getByLabel('Description (optional)').fill('Remember the forms');
  await section.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('status')).toContainText('Unable to save event');
  await expect(section.getByLabel('Event title')).toHaveValue(title);
  await expect(section.getByLabel('Description (optional)')).toHaveValue('Remember the forms');
  await expect(section.getByLabel('Start time')).toHaveValue('15:00');
  await section.getByLabel('End time').fill('16:00');
  await section.getByRole('button', { name: 'Save event' }).click();
  await expect(articleByTitle(page, title)).toBeVisible();
});
