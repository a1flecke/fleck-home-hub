import { expect, test, type Page } from '@playwright/test';
import { hydrated } from './support/navigation';

const origin = 'http://127.0.0.1:4173';

function householdLocalDate(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function fullDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00.000Z`));
}

async function signIn(page: Page, email: string, password: string, heading: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

async function createEvent(page: Page, form: Record<string, string>) {
  const response = await page.request.post('/calendar?/saveEvent', { form, headers: { origin } });
  expect(await response.json()).toMatchObject({ type: 'success', status: 200 });
}

test('parent creates an event in the calendar and finds it on My Day', async ({ page }, testInfo) => {
  const index = testInfo.repeatEachIndex;
  const titles = ['A', 'B', 'C', 'D', 'E', 'F'].map(letter => `Synthetic coming up ${letter} ${index}`);
  const description = `Synthetic private description ${index}`;
  const location = `Synthetic private location ${index}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'calendar-parent@example.test', 'synthetic-calendar-parent-password', 'Hello, Calendar Parent');
  const before = householdLocalDate('Pacific/Kiritimati');
  await page.goto('/calendar?view=day');
  await hydrated(page);
  const today = await page.locator('form[method="GET"]').getByLabel('Choose date').inputValue();
  const after = householdLocalDate('Pacific/Kiritimati');
  expect([before, after]).toContain(today);

  const add = page.locator('details').filter({ has: page.getByText('Add an event', { exact: true }) });
  await add.getByText('Add an event', { exact: true }).click();
  const form = add.locator('form[action^="?/saveEvent"]');
  await form.getByLabel('Event title').fill(titles[0]);
  await form.getByLabel('All day').check();
  await form.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByText('Event saved.')).toBeVisible();

  for (let offset = 1; offset < titles.length; offset += 1) {
    const extra: Record<string, string> = { title: titles[offset], date: today, allDay: 'on' };
    if (offset === 1) {
      extra.description = description;
      extra.location = location;
    }
    await createEvent(page, extra);
  }

  const response = await page.request.get('/dashboard');
  const html = await response.text();
  expect(html).toContain(titles[0]);
  expect(html).not.toContain(description);
  expect(html).not.toContain(location);

  await page.goto('/dashboard');
  const card = page.getByRole('region', { name: 'Coming up' });
  await expect(card.getByRole('heading', { name: 'Coming up' })).toBeVisible();
  await expect(card.getByRole('heading', { name: fullDate(today) })).toBeVisible();
  for (const title of titles.slice(0, 5)) await expect(card.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await expect(card.getByRole('link', { name: new RegExp(titles[5]) })).toHaveCount(0);
  await expect(card.getByRole('link', { name: '+1 more' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'View calendar' })).toHaveAttribute('href', `/calendar?date=${today}&view=week`);
  await expect(card.getByRole('link', { name: 'Add an event' })).toHaveAttribute('href', `/calendar?date=${today}&view=day`);
  await expect(page.getByRole('heading', { name: "Tonight's meal" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Earnings' })).toBeVisible();
  await expect(page.getByText('No chores yet. Enjoy your day!')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard-coming-up-mobile.png'), fullPage: true });

  const eventLink = card.getByRole('link', { name: new RegExp(titles[0]) });
  await expect(eventLink).toHaveAttribute('href', `/calendar?date=${today}&view=day`);
  await eventLink.click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?date=${today}&view=day$`));
  await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: titles[0], exact: true }) })).toBeVisible();
});

test('empty upcoming events show helpful copy and a calendar link', async ({ page }) => {
  await signIn(page, 'calendar-empty-parent@example.test', 'synthetic-calendar-empty-parent-password', 'Hello, Calendar Empty Parent');
  const card = page.getByRole('region', { name: 'Coming up' });
  await expect(card).toContainText('Nothing coming up in the next seven days.');
  await expect(card.getByRole('link', { name: 'View calendar' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Add an event' })).toBeVisible();
});

test('kid sees the same upcoming event read-only, including without JavaScript', async ({ page, browser }, testInfo) => {
  const index = testInfo.repeatEachIndex;
  const title = `000 Synthetic kid coming up ${index}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'calendar-parent@example.test', 'synthetic-calendar-parent-password', 'Hello, Calendar Parent');
  await page.goto('/calendar?view=day');
  const today = await page.locator('form[method="GET"]').getByLabel('Choose date').inputValue();
  await createEvent(page, { title, date: today, allDay: 'on' });
  await signIn(page, 'calendar-kid@example.test', 'synthetic-calendar-kid-password', "Calendar Kid's My Day");
  await page.goto('/dashboard');
  const card = page.getByRole('region', { name: 'Coming up' });
  await expect(card.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Add an event' })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'View calendar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'To do today', exact: true })).toBeVisible();
  await expect(page.getByText('No chores yet. Enjoy your day!')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard-coming-up-kid-mobile.png'), fullPage: true });

  const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 } });
  try {
    const noScript = await context.newPage();
    await noScript.goto('/dashboard');
    await expect(noScript.getByRole('heading', { name: 'Coming up', exact: true })).toBeVisible();
    const eventLink = noScript.getByRole('link', { name: new RegExp(title) });
    await expect(eventLink).toBeVisible();
    await eventLink.click();
    await expect(noScript).toHaveURL(new RegExp(`/calendar\\?date=${today}&view=day$`));
    await expect(noScript.getByRole('article').filter({ has: noScript.getByRole('heading', { name: title, exact: true }) })).toBeVisible();
    await expect(noScript.getByText('Edit event', { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('dashboard rejects anonymous and disabled sessions', async ({ page, browser }) => {
  const anonymous = await page.request.get('/dashboard', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers()['location']).toBe('/sign-in');
  const context = await browser.newContext();
  try {
    const login = await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: 'disabled-grocery@example.test', password: 'synthetic-disabled-grocery-password' } });
    expect(login.status()).toBe(401);
    expect((await context.request.get(`${origin}/dashboard`, { maxRedirects: 0 })).status()).toBe(303);
  } finally { await context.close(); }
});
