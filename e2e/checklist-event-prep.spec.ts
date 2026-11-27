import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';
const first = '2099-05-04';
const next = '2099-05-11';
const calendar = (date: string, view = 'day') => `/calendar?date=${date}&view=${view}`;
const article = (page: Page, name: string) => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

async function signIn(page: Page, user = 'parent') {
  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email: `${user}@example.test`, password: `synthetic-${user}-password` }, headers: { origin }
  });
  expect(response.status()).toBe(200);
}

async function createEvent(page: Page, title: string, date: string, repeats = false) {
  const form = new URLSearchParams({ title, date, allDay: 'on' });
  if (repeats) form.set('weekday', String(new Date(`${date}T00:00:00Z`).getUTCDay()));
  const response = await page.request.post(`${origin}/calendar?/saveEvent&date=${date}&view=day`, {
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded', 'x-sveltekit-action': 'true', accept: 'application/json' },
    data: form.toString()
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ type: 'success', status: 200 });
}

async function createList(page: Page, title: string, shared = false) {
  await page.goto('/lists');
  const create = page.getByRole('form', { name: 'Create a family list', exact: true });
  await create.getByLabel('List name').fill(title);
  if (shared) await create.getByLabel('Share with family').check();
  await create.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add things to do', exact: true });
  await add.getByLabel('Things to add').fill('Coats\nChargers');
  await add.getByRole('button', { name: 'Add items', exact: true }).click();
  await expect(page.getByText('0 of 2 items ready', { exact: true })).toBeVisible();
  return page.url();
}

function fields(form: Locator) {
  return form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)) as Record<string, string>);
}

for (const javaScriptEnabled of [true, false]) {
  test(`parents attach, create, and relink trip preparations on a phone (JavaScript ${javaScriptEnabled})`, async ({ browser }, testInfo) => {
    const tag = randomUUID().slice(0, 6);
    const trip = `Weekend trip ${tag}`;
    const packing = `Weekend packing ${tag}`;
    const food = `Food to bring ${tag}`;
    const parentContext = await browser.newContext({ javaScriptEnabled, viewport: { width: 375, height: 812 } });
    const childContext = await browser.newContext();
    try {
      const parent = await parentContext.newPage(), child = await childContext.newPage();
      await signIn(parent);
      await createEvent(parent, trip, first, true);
      const packingUrl = await createList(parent, packing, true);
      const chosenView = calendar('2099-05-06', 'week');
      await parent.goto(chosenView);
      const event = article(parent, trip);
      await event.getByRole('link', { name: 'Attach existing checklist', exact: true }).click();
      const attach = parent.getByRole('form', { name: 'Attach existing checklist', exact: true });
      await attach.getByRole('combobox', { name: 'Checklist', exact: true }).selectOption({ label: `${packing} (shared)` });
      await attach.getByRole('button', { name: 'Attach checklist', exact: true }).click();
      await expect(parent).toHaveURL(origin + chosenView);
      await expect(event.getByRole('link', { name: packing, exact: true })).toBeVisible();

      await event.getByRole('link', { name: 'Add preparation checklist', exact: true }).click();
      const create = parent.getByRole('form', { name: 'Add preparation checklist', exact: true });
      const notes = 'Bring a cooler if it is warm';
      await create.getByLabel('List name').fill('   ');
      await create.getByLabel('Description (optional)').fill(notes);
      await create.getByRole('button', { name: 'Create checklist', exact: true }).click();
      await expect(parent.getByRole('alert')).toContainText('Check the list name');
      expect(new URL(parent.url()).searchParams.get('date')).toBe('2099-05-06');
      expect(new URL(parent.url()).searchParams.get('view')).toBe('week');
      if (javaScriptEnabled) await expect(create.getByLabel('List name')).toBeFocused();
      await expect(create.getByLabel('Description (optional)')).toHaveValue(notes);
      await expect(create.getByLabel('Share with family')).not.toBeChecked();
      await create.getByLabel('List name').fill(food);
      await create.getByRole('button', { name: 'Create checklist', exact: true }).click();
      await expect(parent).toHaveURL(origin + chosenView);
      const foodLink = event.getByRole('link', { name: food, exact: true });
      await expect(foodLink).toBeVisible();
      const foodPath = new URL(await foodLink.getAttribute('href') || '', parent.url()).pathname;

      await signIn(child, 'kid');
      await child.goto(chosenView);
      const childEvent = article(child, trip);
      await expect(childEvent.getByRole('link', { name: packing, exact: true })).toBeVisible();
      for (const path of [chosenView, '/calendar/__data.json?date=2099-05-06&view=week']) {
        const response = await child.request.get(path);
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toBe('no-store');
        const text = await response.text();
        expect(text).toContain(packing);
        for (const privateValue of [food, notes, foodPath.split('/').at(-1)!]) expect(text).not.toContain(privateValue);
      }
      await childEvent.getByRole('link', { name: packing, exact: true }).click();
      await child.getByRole('article', { name: 'Coats', exact: true }).getByRole('button', { name: 'Mark ready', exact: true }).click();
      await expect(child.getByText('1 of 2 items ready', { exact: true })).toBeVisible();
      await parent.goto(calendar(first));
      await expect(event.getByRole('region', { name: 'Preparation', exact: true })).toContainText('1 of 2 items ready');
      if (javaScriptEnabled) {
        expect(await parent.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
        await event.screenshot({ path: testInfo.outputPath('event-preparation-phone.png') });
        const secondContext = await browser.newContext();
        try {
          const secondParent = await secondContext.newPage();
          await signIn(secondParent, 'multi-parent');
          await secondParent.goto(chosenView);
          await article(secondParent, trip).getByRole('link', { name: packing, exact: true }).click();
          await expect(secondParent.getByText('1 of 2 items ready', { exact: true })).toBeVisible();
        } finally { await secondContext.close(); }
      }
      await parent.goto(calendar(next));
      await expect(event).toBeVisible();
      await expect(event.getByRole('link', { name: packing, exact: true })).toHaveCount(0);
      await parent.goto(calendar(first));
      await event.getByRole('button', { name: 'Cancel this occurrence', exact: true }).click();
      await expect(parent.getByRole('status')).toContainText('Event cancelled.');
      await expect(event).toHaveCount(0);

      await parent.goto(packingUrl);
      await expect(parent.getByRole('region', { name: 'Calendar event', exact: true })).toContainText('This date was cancelled or moved');
      await expect(parent.getByText('1 of 2 items ready', { exact: true })).toBeVisible();
      await parent.getByRole('link', { name: 'Change or remove calendar link', exact: true }).click();
      const search = parent.getByRole('form', { name: 'Find calendar events', exact: true });
      await search.getByLabel('Starting date').fill(next);
      await search.getByRole('button', { name: 'Show events', exact: true }).click();
      await expect(parent).toHaveURL(new RegExp(`date=${next}`));
      const link = parent.getByRole('form', { name: 'Choose a calendar event', exact: true });
      const actual = await link.getByRole('option', { name: `${trip} · Monday, May 11, 2099 · All day`, exact: true }).getAttribute('value');
      expect(actual).toMatch(new RegExp(`/${next}$`));
      await link.getByRole('combobox', { name: 'Calendar event', exact: true }).selectOption(actual!);
      await link.getByRole('button', { name: 'Save calendar link', exact: true }).click();
      await expect(parent).toHaveURL(packingUrl);
      const current = parent.getByRole('region', { name: 'Calendar event', exact: true });
      await expect(current.getByRole('link', { name: 'Open in calendar', exact: true })).toBeVisible();
      await current.getByRole('link', { name: 'Open in calendar', exact: true }).click();
      await expect(parent).toHaveURL(origin + calendar(next));
      await expect(event.getByRole('link', { name: packing, exact: true })).toBeVisible();
      await event.getByRole('link', { name: packing, exact: true }).click();
      await current.getByRole('link', { name: 'Change or remove calendar link', exact: true }).click();
      await parent.getByRole('form', { name: 'Remove calendar link', exact: true }).getByRole('button', { name: 'Remove calendar link', exact: true }).click();
      await expect(current.getByRole('link', { name: 'Link to calendar event', exact: true })).toBeVisible();
      await expect(parent.getByText('1 of 2 items ready', { exact: true })).toBeVisible();
    } finally { await Promise.all([parentContext.close(), childContext.close()]); }
  });
}

async function early(page: Page, url: string, glob: string, edit: () => Promise<void>) {
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  const delay = async (route: Route) => { requested(); await gate; await route.continue(); };
  const target = new URL(url, origin);
  target.hash = '';
  await page.goto('/lists');
  await page.route(glob, delay);
  try {
    await page.goto(target.href, { waitUntil: 'commit' });
    await arrived;
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'false');
    await edit();
    release();
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  } finally {
    release();
    await page.unroute(glob, delay);
  }
}

test('early checklist, event, and date choices survive hydration and submit in their original calendar context', async ({ page }) => {
  const tag = randomUUID().slice(0, 6);
  const trip = `Early trip ${tag}`, packing = `Early packing ${tag}`, change = `Another trip ${tag}`;
  const prepModule = '**/src/routes/lists/preparation/**/+page.svelte*';
  const linkModule = '**/src/routes/lists/*/event/+page.svelte*';
  await signIn(page);
  await createEvent(page, trip, first);
  await createEvent(page, change, next);
  const listUrl = await createList(page, packing);
  const cal = calendar(first, 'day');
  await page.goto(cal);
  await article(page, trip).getByRole('link', { name: 'Attach existing checklist', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Event preparation', exact: true })).toBeVisible();
  const prep = page.url();
  const attach = page.getByRole('form', { name: 'Attach existing checklist', exact: true });
  let selection: string | null = null;
  await early(page, prep, prepModule, async () => {
    [selection] = await attach.getByRole('combobox', { name: 'Checklist', exact: true }).selectOption({ label: `${packing} (parents only)` });
  });
  expect((await fields(attach)).checklist).toBe(selection);
  await attach.getByRole('button', { name: 'Attach checklist', exact: true }).click();
  await expect(article(page, trip).getByRole('link', { name: packing, exact: true })).toBeVisible();

  const create = page.getByRole('form', { name: 'Add preparation checklist', exact: true });
  const food = `Early food ${tag}`;
  await early(page, prep, prepModule, async () => {
    await create.getByLabel('List name').fill(food);
    await create.getByLabel('Description (optional)').fill('Entered while loading');
    await create.getByLabel('Share with family').check();
    await create.getByLabel('List name').selectText();
  });
  await expect(create.getByLabel('List name')).toBeFocused();
  await page.keyboard.insertText(food + ' shared');
  expect(await fields(create)).toMatchObject({ name: food + ' shared', description: 'Entered while loading', shared: 'yes' });
  await create.getByRole('button', { name: 'Create checklist', exact: true }).click();
  await expect(article(page, trip).getByRole('link', { name: food + ' shared', exact: true })).toBeVisible();

  await page.goto(listUrl);
  const manage = page.getByRole('link', { name: 'Change or remove calendar link', exact: true });
  await manage.click();
  await expect(page.getByRole('heading', { name: 'Link to calendar event', exact: true })).toBeVisible();
  const picker = page.url();
  const search = page.getByRole('form', { name: 'Find calendar events', exact: true });
  await early(page, picker, linkModule, async () => {
    await search.getByLabel('Starting date').fill(next);
  });
  expect((await fields(search)).date).toBe(next);
  await search.getByRole('button', { name: 'Show events', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`date=${next}`));
  const selectedView = page.url();
  const link = page.getByRole('form', { name: 'Choose a calendar event', exact: true });
  const eventValue = await link.getByRole('option').filter({ hasText: change }).getAttribute('value');
  await early(page, selectedView, linkModule, async () => {
    await link.getByRole('combobox', { name: 'Calendar event', exact: true }).selectOption(eventValue!);
  });
  const payload = await fields(link);
  expect(payload.occurrence).toBe(eventValue);
  const rejected = await page.request.post(picker + '?/link&date=' + next, {
    headers: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' },
    form: { ...payload, occurrence: payload.occurrence.replace(next, first) }
  });
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ type: 'failure', status: 409 });
  await link.getByRole('button', { name: 'Save calendar link', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Calendar event', exact: true })).toContainText(change);
});

test('paired display responses exclude checklist data even for an opted-in event', async ({ browser, page }) => {
  const tag = randomUUID().slice(0, 6);
  const eventName = `Kitchen trip ${tag}`, privateName = `Private surprise ${tag}`, sharedName = `Family packing ${tag}`;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await signIn(page);
  await createEvent(page, eventName, date);
  await page.goto(calendar(date));
  const event = article(page, eventName);
  for (const name of [privateName, sharedName]) {
    await event.getByRole('link', { name: 'Add preparation checklist', exact: true }).click();
    const create = page.getByRole('form', { name: 'Add preparation checklist', exact: true });
    await create.getByLabel('List name').fill(name);
    if (name === sharedName) await create.getByLabel('Share with family').check();
    await create.getByRole('button', { name: 'Create checklist', exact: true }).click();
    await expect(event.getByRole('link', { name, exact: true })).toBeVisible();
  }
  const listPaths = await event.getByRole('region', { name: 'Preparation' }).getByRole('link').evaluateAll(links => links
    .map(link => new URL((link as HTMLAnchorElement).href).pathname)
    .filter(path => /^\/lists\/[\w-]+$/.test(path)));
  expect(listPaths).toHaveLength(2);
  await page.goto('/display/settings');
  const row = page.getByRole('region', { name: 'Choose what to share' }).getByRole('article').filter({ hasText: eventName });
  await row.getByRole('button', { name: 'Show on display', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Remove from display', exact: true })).toBeVisible();
  await page.goto('/settings/displays');
  const displayName = `Kitchen test ${tag}`;
  await page.getByLabel('Display name').fill(displayName);
  await page.getByRole('button', { name: 'Create pairing code', exact: true }).click();
  const region = page.getByRole('region', { name: 'New pairing code' });
  await expect(region.getByRole('heading', { name: `Pairing code for ${displayName}` })).toBeVisible();
  const code = (await region.locator('p.font-mono').innerText()).trim();
  const context = await browser.newContext();
  try {
    const display = await context.newPage();
    await display.goto('/display/pair');
    await display.getByLabel('Pairing code').fill(code);
    await display.getByRole('button', { name: 'Pair this display', exact: true }).click();
    await expect(display.getByRole('region', { name: "Today's events" })).toContainText(eventName);
    for (const path of ['/display', '/display/__data.json', '/display/data']) {
      const response = await context.request.get(path);
      expect(response.status()).toBe(200);
      const body = await response.text();
      expect(body).toContain(eventName);
      for (const name of [privateName, sharedName, ...listPaths.map(path => path.split('/').at(-1)!)]) expect(body).not.toContain(name);
    }
  } finally { await context.close(); }
});
