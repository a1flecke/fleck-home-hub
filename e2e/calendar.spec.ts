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

function householdLocalDate(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function signInAsParent(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('parent@example.test');
  await page.getByLabel('Password').fill('synthetic-parent-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Sample Parent' })).toBeVisible();
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
    await article.getByLabel('Event date').fill('2099-07-02');
    await article.getByLabel('Description (optional)').fill('Synthetic description');
    await article.getByLabel('All day').uncheck();
    await article.getByLabel('Sunday').check();
    await article.getByLabel('Sample Kid').check();
    await article.getByLabel('Start time').fill('09:00');
    await article.getByLabel('End time').fill('10:00');
    const titleInput = article.getByLabel('Event title');
    await titleInput.focus();
    await titleInput.evaluate((input: HTMLInputElement) => input.select());
    release();
    await delayed.waitForLoadState('networkidle');
    await delayed.keyboard.insertText(updatedTitle);
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

test('calendar routes reject anonymous, child, disabled and cross-origin requests', async ({ page, browser }) => {
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
  const disabledContext = await browser.newContext();
  try {
    const login = await disabledContext.request.post('http://127.0.0.1:4173/api/auth/sign-in/email', { headers, data: { email: 'disabled-grocery@example.test', password: 'synthetic-disabled-grocery-password' } });
    expect(login.status()).toBe(200);
    expect((await disabledContext.request.get('http://127.0.0.1:4173/calendar', { maxRedirects: 0 })).status()).toBe(403);
  } finally { await disabledContext.close(); }
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

test('calendar navigation shifts by view, keeps the date and works from the keyboard', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsParent(page);
  await page.goto('/calendar?date=2028-01-31&view=month');
  const nav = page.getByRole('navigation', { name: 'Calendar navigation' });
  await expect(page.getByRole('heading', { name: 'January 2028' })).toBeVisible();

  await nav.getByRole('link', { name: 'Next month', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\?date=2028-02-29&view=month$/);
  await expect(page.getByRole('heading', { name: 'February 2028' })).toBeVisible();
  await nav.getByRole('link', { name: 'Next month', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\?date=2028-03-29&view=month$/);
  await nav.getByRole('link', { name: 'Previous month', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\?date=2028-02-29&view=month$/);

  const viewForm = page.locator('form[method="GET"]');
  await viewForm.getByLabel('View').selectOption('week');
  await viewForm.getByRole('button', { name: 'Show calendar' }).click();
  await expect(page).toHaveURL(/\/calendar\?date=2028-02-29&view=week$/);
  await expect(page.getByRole('heading', { name: 'Week of February 27 – March 4, 2028' })).toBeVisible();

  const previousWeek = page.getByRole('navigation', { name: 'Calendar navigation' }).getByRole('link', { name: 'Previous week', exact: true });
  await previousWeek.focus();
  await expect(previousWeek).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/calendar\?date=2028-02-22&view=week$/);
  await expect(page.getByRole('heading', { name: 'Week of February 20 – 26, 2028' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Calendar navigation' }).getByRole('link', { name: 'Next week', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\?date=2028-02-29&view=week$/);

  await viewForm.getByLabel('View').selectOption('day');
  await viewForm.getByRole('button', { name: 'Show calendar' }).click();
  await expect(page).toHaveURL(/\/calendar\?date=2028-02-29&view=day$/);
  await expect(page.getByRole('heading', { name: 'Tuesday, February 29, 2028' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Calendar navigation' }).getByRole('link', { name: 'Previous day', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\?date=2028-02-28&view=day$/);

  const beforeToday = householdLocalDate('America/Chicago');
  await page.goto('/calendar?date=2028-01-01&view=day');
  const todayLink = page.getByRole('navigation', { name: 'Calendar navigation' }).getByRole('link', { name: 'Today', exact: true });
  const todayHref = await todayLink.getAttribute('href');
  const afterToday = householdLocalDate('America/Chicago');
  const expectedTodayUrl = new URL(todayHref!, page.url()).href;
  expect([beforeToday, afterToday]).toContain(new URL(expectedTodayUrl).searchParams.get('date'));
  await todayLink.click();
  await expect(page).toHaveURL(expectedTodayUrl);
  await page.screenshot({ path: testInfo.outputPath('calendar-navigation-mobile.png'), fullPage: true });
});

test('calendar navigation works without JavaScript at mobile width', async ({ page, browser }) => {
  await signInAsParent(page);
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const noScript = await context.newPage();
    await noScript.goto('/calendar?date=2028-02-29&view=week');
    await expect(noScript.getByRole('heading', { name: 'Week of February 27 – March 4, 2028' })).toBeVisible();
    await expect(noScript.locator('form[method="GET"]').getByLabel('Choose date')).toHaveValue('2028-02-29');
    await expect(noScript.getByRole('navigation', { name: 'Calendar navigation' }).getByRole('link', { name: 'Today', exact: true })).toBeVisible();

    const nextWeek = noScript.getByRole('navigation', { name: 'Calendar navigation' }).getByRole('link', { name: 'Next week', exact: true });
    const box = await nextWeek.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await nextWeek.click();
    await expect(noScript).toHaveURL(/\/calendar\?date=2028-03-07&view=week$/);
    await expect(noScript.getByRole('heading', { name: 'Week of March 5 – 11, 2028' })).toBeVisible();

    const beforeToday = householdLocalDate('America/Chicago');
    await noScript.goto('/calendar?date=2028-01-01&view=week');
    const todayLink = noScript.getByRole('navigation', { name: 'Calendar navigation' }).getByRole('link', { name: 'Today', exact: true });
    const todayHref = await todayLink.getAttribute('href');
    const afterToday = householdLocalDate('America/Chicago');
    const expectedTodayUrl = new URL(todayHref!, noScript.url()).href;
    expect([beforeToday, afterToday]).toContain(new URL(expectedTodayUrl).searchParams.get('date'));
    await todayLink.click();
    await expect(noScript).toHaveURL(expectedTodayUrl);

    const form = noScript.locator('form[method="GET"]');
    await form.getByLabel('Choose date').fill('2028-12-31');
    await form.getByLabel('View').selectOption('month');
    await form.getByRole('button', { name: 'Show calendar' }).click();
    await expect(noScript).toHaveURL(/\/calendar\?date=2028-12-31&view=month$/);
    await expect(noScript.getByRole('heading', { name: 'December 2028' })).toBeVisible();
    await noScript.getByRole('navigation', { name: 'Calendar navigation' }).getByRole('link', { name: 'Previous month', exact: true }).click();
    await expect(noScript).toHaveURL(/\/calendar\?date=2028-11-30&view=month$/);
    await expect(noScript.getByRole('heading', { name: 'November 2028' })).toBeVisible();
  } finally { await context.close(); }
});

test('a child can navigate the calendar but sees no management controls', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('kid@example.test');
  await page.getByLabel('Password').fill('synthetic-kid-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: "Sample Kid's My Day" })).toBeVisible();
  await page.goto('/calendar?date=2028-01-31&view=month');
  const nav = page.getByRole('navigation', { name: 'Calendar navigation' });
  await nav.getByRole('link', { name: 'Next month', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\?date=2028-02-29&view=month$/);
  await expect(page.getByRole('heading', { name: 'February 2028' })).toBeVisible();
  await expect(page.getByText('Add an event', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Edit event', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Cancel/ })).toHaveCount(0);
});

function expectCalendarContext(page: Page, date: string, view: string) {
  const url = new URL(page.url());
  expect(url.pathname).toBe('/calendar');
  expect(url.searchParams.get('date')).toBe(date);
  expect(url.searchParams.get('view')).toBe(view);
}

test('calendar actions keep the selected month date and view', async ({ page }, testInfo) => {
  const title = `Synthetic month event ${testInfo.repeatEachIndex}`;
  await signInAsParent(page);
  await page.goto('/calendar?date=2088-04-15&view=month');
  const addEvent = page.locator('details').filter({ has: page.getByText('Add an event', { exact: true }) });
  await addEvent.getByText('Add an event', { exact: true }).click();
  await addEvent.getByLabel('Event title').fill(title);
  await addEvent.getByLabel('All day').check();
  const actions = await addEvent.locator('form[action^="?/saveEvent"]').getAttribute('action');
  expect(actions).toContain('date=2088-04-15');
  expect(actions).toContain('view=month');
  await addEvent.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByText('Event saved.')).toBeVisible();
  expectCalendarContext(page, '2088-04-15', 'month');
  const event = articleByTitle(page, title);
  await expect(event).toBeVisible();

  await event.getByText('Edit event').click();
  await event.getByLabel('All day').uncheck();
  await event.getByLabel('Start time').fill('15:00');
  await event.getByLabel('End time').fill('14:00');
  await event.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Unable to save event');
  expectCalendarContext(page, '2088-04-15', 'month');
  await expect(event.getByLabel('Start time')).toHaveValue('15:00');

  await event.getByRole('button', { name: 'Cancel event' }).click();
  await expect(page.getByText('Event cancelled.')).toBeVisible();
  expectCalendarContext(page, '2088-04-15', 'month');
  await expect(articleByTitle(page, title)).toHaveCount(0);
});
