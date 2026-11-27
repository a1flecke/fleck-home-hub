import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { addCalendarDays } from '../src/lib/calendar/dates';
import { localDate } from '../src/lib/chores/recurrence';

const origin = 'http://127.0.0.1:4173';
const phone = { width: 375, height: 812 };
const names = ['Pack raincoats', 'Charge the tablet', 'Put maps in the car', 'Fill water bottles'];
const calendarPath = (date: string) => `/calendar?date=${date}&view=day`;
const item = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const eventCard = (page: Page, name: string) => page.getByRole('article').filter({
  has: page.getByRole('heading', { name, exact: true })
});
const filters = (page: Page) => page.getByRole('navigation', { name: 'Filter items', exact: true });
const readySection = (page: Page) => page.getByRole('region', { name: 'Getting ready', exact: true });
const session = async (page: Page) => (await page.context().cookies()).find(cookie => cookie.name.endsWith('session_token'))?.value;
const fields = (form: Locator) => form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)) as Record<string, string>);

async function signIn(page: Page, key: string) {
  const user = `prep-${key}`;
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin }, data: { email: `${user}@example.test`, password: `synthetic-${user}-password` }
  });
  expect(response.status()).toBe(200);
  expect(await session(page)).toBeTruthy();
}

async function createEvent(page: Page, name: string, date: string) {
  await page.goto(calendarPath(date));
  const add = page.getByText('Add an event', { exact: true });
  await add.click();
  const form = page.locator('details').filter({ has: add }).locator('form[action^="?/saveEvent"]');
  await form.getByLabel('Event title').fill(name);
  await form.getByLabel('All day').check();
  await form.getByRole('button', { name: 'Save event', exact: true }).click();
  await expect(eventCard(page, name)).toBeVisible();
}

async function createList(page: Page, title: string, items: string[], shared = false) {
  await page.goto('/lists');
  const create = page.getByRole('form', { name: 'Create a family list', exact: true });
  await create.getByLabel('List name').fill(title);
  if (shared) await create.getByLabel('Share with family').check();
  await create.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add things to do', exact: true });
  await add.getByLabel('Things to add').fill(items.join('\n'));
  await add.getByRole('button', { name: 'Add items', exact: true }).click();
  await expect(page.getByText(`0 of ${items.length} items ready`, { exact: true })).toBeVisible();
  return page.url();
}

async function useTemplate(page: Page, template: string, title: string, shared = false) {
  await page.goto('/lists');
  await page.getByRole('link', { name: 'Choose a template', exact: true }).click();
  await item(page, template).getByRole('link', { name: 'Use this template', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Preview', exact: true }).getByRole('listitem')).toHaveText(names);
  const copy = page.getByRole('form', { name: 'Create a fresh list', exact: true });
  await copy.getByLabel('List name').fill(title);
  await expect(copy.getByLabel('Share with family')).not.toBeChecked();
  if (shared) await copy.getByLabel('Share with family').check();
  await copy.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('0 of 4 items ready', { exact: true })).toBeVisible();
  return page.url();
}

async function attach(page: Page, event: string, date: string, checklist: string, shared = true) {
  await page.goto(calendarPath(date));
  await eventCard(page, event).getByRole('link', { name: 'Attach existing checklist', exact: true }).click();
  const form = page.getByRole('form', { name: 'Attach existing checklist', exact: true });
  await form.getByRole('combobox', { name: 'Checklist', exact: true }).selectOption({ label: `${checklist} (${shared ? 'shared' : 'parents only'})` });
  await form.getByRole('button', { name: 'Attach checklist', exact: true }).click();
  await expect(page).toHaveURL(origin + calendarPath(date));
  await expect(eventCard(page, event).getByRole('link', { name: checklist, exact: true })).toBeVisible();
}

async function editItem(page: Page, name: string) {
  await item(page, name).getByText('Edit item', { exact: true }).click();
  return item(page, name).getByRole('form', { name: 'Edit ' + name, exact: true });
}

async function assign(page: Page, name: string, person: string) {
  const form = await editItem(page, name);
  await form.getByRole('combobox', { name: 'Assigned to', exact: true }).selectOption({ label: person });
  await form.getByRole('button', { name: 'Save item', exact: true }).click();
  const label = person === 'Unassigned' ? person : `Assigned to ${person}`;
  await expect(item(page, name).getByText(label, { exact: true }).and(page.locator('p'))).toBeVisible();
}

async function markReady(page: Page, name: string, count: number) {
  await item(page, name).getByRole('button', { name: 'Mark ready', exact: true }).click();
  await expect(page.getByText(`${count} of 4 items ready`, { exact: true })).toBeVisible();
}

test('a family uses a template, shares trip responsibilities, and gets ready on independently signed-in phones', async ({ browser }, testInfo) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: phone })));
  const [parent, alex, riley] = await Promise.all(contexts.map(context => context.newPage()));
  const today = localDate(new Date(), 'America/Chicago');
  const date = addCalendarDays(today, 1);
  const nextDate = addCalendarDays(today, 20);
  const trip = 'Weekend cabin trip', packing = 'Cabin packing', template = 'Weekend packing template';
  const privateName = 'Private gift packing', privateItem = 'Surprise telescope wrapping';
  try {
    await Promise.all([signIn(parent, 'parent'), signIn(alex, 'alex'), signIn(riley, 'riley')]);
    expect(new Set(await Promise.all([parent, alex, riley].map(session))).size).toBe(3);
    await createEvent(parent, trip, date);
    await createList(parent, template, names);
    await parent.getByRole('button', { name: 'Save as template', exact: true }).click();
    await expect(parent.getByLabel('Template name')).toHaveValue(template);
    const listUrl = await useTemplate(parent, template, packing, true);
    await attach(parent, trip, date, packing);
    await eventCard(parent, trip).getByRole('link', { name: packing, exact: true }).click();
    await assign(parent, names[0], 'Alex');
    await assign(parent, names[1], 'Riley');
    await assign(parent, names[2], 'Trip Parent');
    await filters(parent).getByRole('link', { name: 'My items', exact: true }).click();
    await expect(item(parent, names[2])).toBeVisible();
    await expect(item(parent, names[0])).toHaveCount(0);
    await filters(parent).getByRole('link', { name: 'Unassigned', exact: true }).click();
    await expect(item(parent, names[3])).toBeVisible();
    await expect(item(parent, names[2])).toHaveCount(0);
    await assign(parent, names[3], 'Trip Parent');
    await expect(parent).toHaveURL(listUrl);
    await assign(parent, names[3], 'Unassigned');

    const privateUrl = await createList(parent, privateName, [privateItem]);
    await createEvent(parent, 'Family holiday', date);
    await attach(parent, 'Family holiday', date, privateName, false);
    await alex.goto('/dashboard');
    const alexPrep = readySection(alex);
    await expect(alexPrep).toContainText(packing);
    await expect(alexPrep).toContainText(names[0]);
    await expect(alexPrep).toContainText(names[3]);
    await expect(alexPrep).not.toContainText(names[1]);
    await expect(alexPrep).not.toContainText(names[2]);
    const privateId = new URL(privateUrl).pathname.split('/').at(-1)!;
    for (const path of ['/dashboard', '/dashboard/__data.json', calendarPath(date), `/calendar/__data.json?date=${date}&view=day`, '/lists', '/lists/__data.json', privateUrl, privateUrl + '/__data.json']) {
      const response = await alex.request.get(path);
      expect(response.headers()['cache-control']).toBe('no-store');
      const body = await response.text();
      for (const secret of [privateName, privateItem, privateId]) expect(body).not.toContain(secret);
      if (path.startsWith('/dashboard')) {
        expect(body).toContain(names[0]);
        expect(body).not.toContain(names[1]);
        expect(body).not.toContain(names[2]);
      }
    }

    await parent.goto(listUrl);
    const deniedState = await fields(item(parent, names[1]).locator('form[action^="?/completion"]'));
    const rejected = await alex.request.post(listUrl + '?/completion&items=todo', {
      headers: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' },
      form: { ...deniedState, completed: 'yes' }
    });
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({ type: 'failure', status: 409 });
    await alexPrep.getByRole('link', { name: packing, exact: true }).click();
    await expect(item(alex, names[1]).getByRole('button', { name: 'Mark ready', exact: true })).toHaveCount(0);
    await markReady(alex, names[0], 1);
    await expect(filters(alex).getByRole('link', { name: 'Still to do', exact: true })).toHaveAttribute('aria-current', 'page');

    await riley.goto('/dashboard');
    const rileyPrep = readySection(riley);
    await expect(rileyPrep).toContainText(names[1]);
    await expect(rileyPrep).toContainText(names[3]);
    await expect(rileyPrep).not.toContainText(names[0]);
    await rileyPrep.getByRole('link', { name: packing, exact: true }).click();
    await markReady(riley, names[1], 2);
    await markReady(riley, names[3], 3);
    await filters(riley).getByRole('link', { name: 'Completed', exact: true }).click();
    await expect(item(riley, names[1])).toBeVisible();
    await expect(item(riley, names[2])).toHaveCount(0);

    await parent.goto('/dashboard');
    const parentPrep = readySection(parent);
    const cabin = parentPrep.getByRole('listitem').filter({ has: parent.getByRole('heading', { name: packing, exact: true }) });
    await expect(cabin).toContainText('3 of 4 items ready');
    await expect(cabin).toContainText('1 thing still to do');
    await expect(cabin).toContainText(names[2]);
    await expect(cabin).not.toContainText(names[1]);
    expect(await parent.evaluate(() => document.documentElement.scrollWidth)).toBe(phone.width);
    await parentPrep.screenshot({ path: testInfo.outputPath('getting-ready-phone.png') });
    await parentPrep.getByRole('link', { name: packing, exact: true }).click();
    await markReady(parent, names[2], 4);
    await parent.getByRole('region', { name: 'Calendar event', exact: true }).getByRole('link', { name: 'Open in calendar', exact: true }).click();
    const preparation = eventCard(parent, trip).getByRole('region', { name: 'Preparation', exact: true });
    await expect(preparation.getByText('Ready: 4 of 4 items', { exact: true })).toBeVisible();
    await expect(preparation.getByText('Everything is ready!', { exact: true })).toBeVisible();
    expect(await parent.evaluate(() => document.documentElement.scrollWidth)).toBe(phone.width);
    await eventCard(parent, trip).screenshot({ path: testInfo.outputPath('trip-ready-phone.png') });

    await createEvent(parent, 'Another cabin trip', nextDate);
    const fresh = await useTemplate(parent, template, 'Packing for the next trip');
    expect(fresh).not.toBe(listUrl);
    for (const name of names) {
      await expect(item(parent, name).getByText('Unassigned', { exact: true }).and(parent.locator('p'))).toBeVisible();
      await expect(item(parent, name).getByRole('button', { name: 'Mark ready', exact: true })).toBeVisible();
    }
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('native assignment restores the entered name and selected owner and keeps the filter through correction', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: phone });
  try {
    const page = await context.newPage();
    await signIn(page, 'peer');
    await createList(page, 'Native assignment ' + randomUUID().slice(0, 6), ['Pack the blanket']);
    await filters(page).getByRole('link', { name: 'Still to do', exact: true }).click();
    await expect(filters(page).getByRole('link', { name: 'Still to do', exact: true })).toHaveAttribute('aria-current', 'page');
    const form = await editItem(page, 'Pack the blanket');
    const owner = form.getByRole('combobox', { name: 'Assigned to', exact: true });
    const [alex] = await owner.selectOption({ label: 'Alex' });
    await form.getByLabel('Item name').fill('   ');
    await form.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Check its name');
    await expect(form.getByLabel('Item name')).toHaveValue('   ');
    await expect(owner).toHaveValue(alex);
    expect(new URL(page.url()).searchParams.get('items')).toBe('todo');
    await form.getByLabel('Item name').fill('Pack the picnic blanket');
    await form.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(page).toHaveURL(/\?items=todo$/);
    await expect(item(page, 'Pack the picnic blanket')).toContainText('Assigned to Alex');
    await item(page, 'Pack the picnic blanket').getByRole('button', { name: 'Mark ready', exact: true }).click();
    await expect(page.getByText('1 of 1 items ready', { exact: true })).toBeVisible();
    await filters(page).getByRole('link', { name: 'Completed', exact: true }).click();
    await expect(item(page, 'Pack the picnic blanket')).toBeVisible();
  } finally { await context.close(); }
});

test('early ownership and text edits survive hydration and a rejected draft keeps its version across two parent sessions', async ({ browser, page }) => {
  const peerContext = await browser.newContext({ viewport: phone });
  try {
    const peer = await peerContext.newPage();
    await Promise.all([signIn(page, 'parent'), signIn(peer, 'peer')]);
    expect(await session(page)).not.toBe(await session(peer));
    const original = 'Check the day bag', earlyName = 'Check the picnic day bag';
    const list = await createList(page, 'Early ownership ' + randomUUID().slice(0, 6), [original]);
    await peer.goto(list + '?items=unassigned');
    const staleForm = await editItem(peer, original);
    const stalePayload = await fields(staleForm);

    let release!: () => void, requested!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const arrived = new Promise<void>(resolve => { requested = resolve; });
    const modules = (url: URL) => decodeURIComponent(url.pathname).endsWith('/src/routes/lists/[id]/+page.svelte');
    const delay = async (route: Route) => { requested(); await gate; await route.continue(); };
    await page.route(modules, delay);
    let selected = '';
    const earlyForm = item(page, original).getByRole('form', { name: 'Edit ' + original, exact: true });
    try {
      await page.goto(list + '?items=todo', { waitUntil: 'commit' });
      await arrived;
      await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'false');
      await editItem(page, original);
      [selected] = await earlyForm.getByRole('combobox', { name: 'Assigned to', exact: true }).selectOption({ label: 'Alex' });
      await earlyForm.getByLabel('Item name').selectText();
      release();
      await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
    } finally {
      release();
      await page.unroute(modules, delay);
    }
    await expect(earlyForm.getByLabel('Item name')).toBeFocused();
    await page.keyboard.insertText(earlyName);
    expect(await fields(earlyForm)).toMatchObject({ name: earlyName, assignedTo: selected, version: stalePayload.version });

    const editPath = list + '?/editItem&items=unassigned';
    const bad = 'outside-household-member';
    const forged = async (route: Route) => {
      const body = new URLSearchParams(route.request().postData() ?? '');
      body.set('assignedTo', bad);
      await route.continue({ postData: body.toString() });
    };
    await peer.route(editPath, forged, { times: 1 });
    await staleForm.getByLabel('Item name').fill('Co-parent draft');
    await staleForm.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(peer.getByRole('alert')).toContainText('Choose an active household member');
    await expect(staleForm.getByRole('combobox', { name: 'Assigned to', exact: true })).toHaveValue(bad);
    expect(await fields(staleForm)).toMatchObject({ name: 'Co-parent draft', assignedTo: bad, version: stalePayload.version });
    await earlyForm.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect(item(page, earlyName)).toContainText('Assigned to Alex');
    for (let attempt = 0; attempt < 2; attempt++) {
      await peer.getByRole('button', { name: 'Save item', exact: true }).click();
      await expect(peer.getByRole('alert')).toContainText('Someone changed this item');
      await expect(peer.getByLabel('Item name')).toHaveValue('Co-parent draft');
      const retained = await fields(item(peer, earlyName).getByRole('form', { name: 'Edit ' + earlyName, exact: true }));
      expect(retained).toMatchObject({ name: 'Co-parent draft', assignedTo: bad, version: stalePayload.version });
      expect(new URL(peer.url()).searchParams.get('items')).toBe('unassigned');
    }
    await page.reload();
    await expect(item(page, earlyName)).toContainText('Assigned to Alex');
  } finally { await peerContext.close(); }
});
