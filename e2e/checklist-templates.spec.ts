import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { settle } from './support/navigation';

const origin = 'http://127.0.0.1:4173';

async function signIn(page: Page, user = 'parent') {
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin },
    data: { email: `${user}@example.test`, password: `synthetic-${user}-password` }
  });
  expect(response.status()).toBe(200);
}

async function createSource(page: Page, title: string) {
  await page.goto('/lists');
  const create = page.getByRole('form', { name: 'Create a family list', exact: true });
  await create.getByLabel('List name').fill(title);
  await create.getByLabel('Share with family').check();
  await create.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const add = page.getByRole('form', { name: 'Add things to do', exact: true });
  await add.getByLabel('Things to add').fill('Coats\nToothbrushes\nChargers\nCards\nWater bottles');
  await add.getByRole('button', { name: 'Add items', exact: true }).click();
  await expect(page.getByText('0 of 5 items ready', { exact: true })).toBeVisible();
  await page.getByRole('article', { name: 'Coats', exact: true }).getByRole('button', { name: 'Mark ready', exact: true }).click();
  await expect(page.getByText('1 of 5 items ready', { exact: true })).toBeVisible();
  return page.url();
}

async function saveTemplate(page: Page, expectedName: string) {
  await page.getByRole('button', { name: 'Save as template', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit template', exact: true })).toBeVisible();
  await expect(page.getByLabel('Template name')).toHaveValue(expectedName);
  return page.url();
}

function fields(form: Locator) {
  return form.evaluate(element => Object.fromEntries(new FormData(element as HTMLFormElement)) as Record<string, string>);
}

for (const javaScriptEnabled of [true, false]) {
  test(`a parent reuses a packing template on a phone (JavaScript ${javaScriptEnabled})`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 375, height: 812 } });
    const suffix = randomUUID().slice(0, 6);
    const title = `Weekend packing ${suffix}`;
    const template = `Three-day family trip ${suffix}`;
    const trip = `Spring family trip ${suffix}`;
    const notes = 'Bring all chargers in one bag';
    const contents = 'Coats\nToothbrushes\nWater bottles\nChargers\nCards';
    try {
      const page = await context.newPage();
      await signIn(page);
      const listUrl = await createSource(page, title);
      await saveTemplate(page, title);
      const edit = page.getByRole('form', { name: 'Edit template', exact: true });
      await edit.getByLabel('Template name').fill('   ');
      await edit.getByLabel('Description (optional)').fill(notes);
      await edit.getByLabel('Items, one per line').fill(contents);
      await edit.getByRole('button', { name: 'Save template', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Enter a template name');
      if (javaScriptEnabled) await expect(edit.getByLabel('Template name')).toBeFocused();
      await expect(edit.getByLabel('Description (optional)')).toHaveValue(notes);
      await expect(edit.getByLabel('Items, one per line')).toHaveValue(contents);
      await edit.getByLabel('Template name').fill(template);
      await edit.getByRole('button', { name: 'Save template', exact: true }).click();
      await expect(page.getByRole('article', { name: template, exact: true })).toBeVisible();

      await page.goto('/lists');
      await page.getByRole('link', { name: 'Choose a template', exact: true }).click();
      await settle(page);
      const choice = page.getByRole('article', { name: template, exact: true });
      await choice.getByRole('link', { name: 'Use this template', exact: true }).click();
      await settle(choice);
      const preview = page.getByRole('region', { name: 'Preview', exact: true });
      await expect(preview.getByRole('listitem')).toHaveText(contents.split('\n'));
      const copy = page.getByRole('form', { name: 'Create a fresh list', exact: true });
      await expect(copy.getByLabel('Share with family')).not.toBeChecked();
      await expect(copy.getByLabel('Target date (optional)')).toHaveValue('');
      if (javaScriptEnabled) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
        await page.screenshot({ path: testInfo.outputPath('packing-template-preview-phone.png'), fullPage: true });
      }
      await copy.getByLabel('List name').fill('   ');
      await copy.getByLabel('Description (optional)').fill('Pack the night before');
      await copy.getByLabel('Target date (optional)').fill('2099-11-22');
      await copy.getByRole('button', { name: 'Create list', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Check the list name');
      if (javaScriptEnabled) await expect(copy.getByLabel('List name')).toBeFocused();
      await expect(copy.getByLabel('Description (optional)')).toHaveValue('Pack the night before');
      await expect(copy.getByLabel('Target date (optional)')).toHaveValue('2099-11-22');
      await copy.getByLabel('List name').fill(trip);
      await copy.getByRole('button', { name: 'Create list', exact: true }).click();
      await expect(page.getByRole('heading', { name: trip, exact: true })).toBeVisible();
      await expect(page.getByText('0 of 5 items ready', { exact: true })).toBeVisible();
      await expect(page.locator('header')).toContainText('Parents only · 2099-11-22');
      const copyUrl = page.url();
      await page.getByRole('article', { name: 'Coats', exact: true }).getByRole('button', { name: 'Mark ready', exact: true }).click();
      await expect(page.getByText('1 of 5 items ready', { exact: true })).toBeVisible();

      await page.goto('/lists/templates');
      await choice.getByRole('link', { name: 'Use this template', exact: true }).click();
      await settle(choice);
      await expect(preview.getByRole('listitem')).toHaveText(contents.split('\n'));
      await page.goto(listUrl);
      await expect(page.getByText('1 of 5 items ready', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Use this list again', exact: true }).click();
      await settle(page);
      await expect(preview.getByRole('listitem')).toHaveText(['Coats', 'Toothbrushes', 'Chargers', 'Cards', 'Water bottles']);
      await expect(copy.getByLabel('Share with family')).not.toBeChecked();

      await page.goto('/lists/templates');
      await choice.getByRole('link', { name: 'Edit template', exact: true }).click();
      await settle(choice);
      await page.getByText('Remove template', { exact: true }).click();
      await page.getByRole('button', { name: 'Remove this template', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'List templates', exact: true })).toBeVisible();
      await expect(choice).toHaveCount(0);
      await page.goto(copyUrl);
      await expect(page.getByRole('heading', { name: trip, exact: true })).toBeVisible();
      await expect(page.getByText('1 of 5 items ready', { exact: true })).toBeVisible();
    } finally { await context.close(); }
  });
}

test('private templates and preview data stay within active parent households', async ({ browser, page }) => {
  const suffix = randomUUID().slice(0, 6);
  const listTitle = `Shared packing ${suffix}`;
  const title = `Private reusable packing ${suffix}`;
  const description = `Private reminders ${suffix}`;
  const item = `Private surprise ${suffix}`;
  await signIn(page);
  const listUrl = await createSource(page, listTitle);
  const editUrl = await saveTemplate(page, listTitle);
  const edit = page.getByRole('form', { name: 'Edit template', exact: true });
  await edit.getByLabel('Template name').fill(title);
  await edit.getByLabel('Description (optional)').fill(description);
  await edit.getByLabel('Items, one per line').fill(item);
  await edit.getByRole('button', { name: 'Save template', exact: true }).click();
  const choice = page.getByRole('article', { name: title, exact: true });
  await expect(choice).toContainText(description);
  await choice.getByRole('link', { name: 'Edit template', exact: true }).click();
  await settle(choice);
  const submitted = await fields(edit);
  await page.getByRole('link', { name: 'Use this template', exact: true }).click();
  await settle(page);
  await expect(page.getByRole('region', { name: 'Preview', exact: true })).toContainText(item);
  const copyUrl = new URL(page.url());
  const submittedCopy = await fields(page.getByRole('form', { name: 'Create a fresh list', exact: true }));
  const childContext = await browser.newContext(), outsiderContext = await browser.newContext(), anonymousContext = await browser.newContext();
  try {
    const child = await childContext.newPage(), outsider = await outsiderContext.newPage();
    await signIn(child, 'kid');
    await signIn(outsider, 'other-parent');
    expect((await anonymousContext.request.get('/lists/templates', { maxRedirects: 0 })).status()).toBe(303);
    for (const url of ['/lists/templates', editUrl, copyUrl.href]) {
      for (const requester of [child, outsider]) {
        const html = await requester.request.get(url);
        expect(html.status()).toBe(requester === child ? 403 : 200);
        expect(html.headers()['cache-control']).toBe('no-store');
        const markup = await html.text();
        for (const value of [title, description, item]) expect(markup).not.toContain(value);
        const dataUrl = new URL(url, origin);
        dataUrl.pathname += '/__data.json';
        const json = await requester.request.get(dataUrl.href);
        expect(json.headers()['cache-control']).toBe('no-store');
        const data = await json.text();
        for (const value of [title, description, item]) expect(data).not.toContain(value);
      }
    }
    await child.goto(listUrl);
    await expect(child.getByRole('heading', { name: listTitle, exact: true })).toBeVisible();
    await expect(child.getByRole('button', { name: 'Save as template', exact: true })).toHaveCount(0);
    for (const [url, form] of [[editUrl + '?/update', submitted], [copyUrl.href + '?/create', submittedCopy]] as const) {
      const update = await child.request.post(url, { headers: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' }, form });
      expect(update.status()).toBe(403);
      expect(await update.json()).toMatchObject({ type: 'error', error: { status: 403 } });
    }
    const outsideCopy = await outsider.request.post(copyUrl.href + '?/create', {
      headers: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' }, form: { ...submittedCopy, name: 'Outside request' }
    });
    expect(outsideCopy.status()).toBe(409);
    expect(await outsideCopy.json()).toMatchObject({ type: 'failure', status: 409 });

    const disabled = await anonymousContext.request.post('/api/auth/sign-in/email', {
      headers: { origin }, data: { email: 'disabled-expense@example.test', password: 'synthetic-disabled-expense-password' }
    });
    expect(disabled.status()).toBe(401);
    expect((await anonymousContext.request.get(editUrl, { maxRedirects: 0 })).status()).toBe(303);
  } finally {
    await Promise.all([childContext.close(), outsiderContext.close(), anonymousContext.close()]);
  }
});

test('stale previews survive rejection and an identical HTTP retry creates only one checklist', async ({ page, browser }) => {
  const title = `Packing review ${randomUUID().slice(0, 6)}`;
  await signIn(page);
  await createSource(page, title);
  const editUrl = await saveTemplate(page, title);
  await page.getByRole('link', { name: 'Use this template', exact: true }).click();
  await settle(page);
  await expect(page.getByRole('region', { name: 'Preview', exact: true })).toContainText(title);
  const previewUrl = page.url();
  const copy = page.getByRole('form', { name: 'Create a fresh list', exact: true });
  await copy.getByLabel('List name').fill(`${title} next month`);
  const initial = await fields(copy);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await signIn(other);
    const sessionCookie = async (p: Page) => (await p.context().cookies()).find(cookie => cookie.name.endsWith('session_token'))?.value;
    expect(await sessionCookie(other)).toBeTruthy();
    expect(await sessionCookie(page)).toBeTruthy();
    expect(await sessionCookie(other) === await sessionCookie(page)).toBe(false);
    await other.goto(editUrl);
    await other.getByLabel('Items, one per line').fill('Jackets\nChargers');
    await other.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(other.getByRole('article', { name: title, exact: true })).toContainText('2 items');
    for (let attempt = 0; attempt < 2; attempt++) {
      await copy.getByRole('button', { name: 'Create list', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('The source changed');
      expect(await fields(copy)).toEqual(initial);
    }
    await page.getByRole('link', { name: 'Reload preview', exact: true }).click();
    await settle(page);
    await expect(page.getByRole('region', { name: 'Preview', exact: true }).getByRole('listitem')).toHaveText(['Jackets', 'Chargers']);
    await copy.getByLabel('List name').fill(initial.name);
    const payload = await fields(copy);
    const requests = await Promise.all([0, 1].map(() => page.request.post(previewUrl + '?/create', {
      headers: { origin, 'x-sveltekit-action': 'true', accept: 'application/json' },
      form: payload
    })));
    expect(requests.map(response => response.status())).toEqual([200, 200]);
    const actions = await Promise.all(requests.map(response => response.json()));
    for (const action of actions) expect(action).toMatchObject({ type: 'redirect', status: 303 });
    const location = actions[0].location as string;
    expect(location).toMatch(/^\/lists\//);
    expect(actions[1].location).toBe(location);
    await page.goto(location);
    await expect(page.getByRole('heading', { name: initial.name, exact: true })).toBeVisible();
    await expect(page.getByText('0 of 2 items ready', { exact: true })).toBeVisible();
    await page.goto('/lists');
    await expect(page.getByRole('link', { name: initial.name, exact: true })).toHaveCount(1);
  } finally { await otherContext.close(); }
});

async function beforeHydration(page: Page, path: string, modulePattern: string, edit: () => Promise<void>) {
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const loading = new Promise<void>(resolve => { requested = resolve; });
  const delay = async (route: import('@playwright/test').Route) => { requested(); await gate; await route.continue(); };
  await page.route(modulePattern, delay);
  try {
    await page.goto(path, { waitUntil: 'commit' });
    await loading;
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'false');
    await edit();
    release();
    await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  } finally {
    release();
    await page.unroute(modulePattern, delay);
  }
}

test('template edits and fresh-list fields entered before hydration survive submission', async ({ page, browser }) => {
  const title = `Hydration packing ${randomUUID().slice(0, 6)}`;
  await signIn(page);
  await createSource(page, title);
  const editUrl = await saveTemplate(page, title);
  const editContext = await browser.newContext(), copyContext = await browser.newContext();
  try {
    const early = await editContext.newPage();
    await signIn(early);
    const name = early.getByLabel('Template name'), description = early.getByLabel('Description (optional)');
    const contents = early.getByLabel('Items, one per line');
    const removePanel = early.getByText('Remove template', { exact: true });
    await beforeHydration(early, editUrl, '**/src/routes/lists/templates/**/+page.svelte*', async () => {
      await description.fill('Change while loading');
      await contents.fill('Gloves\nSnacks');
      await removePanel.click();
      await name.selectText();
    });
    await expect(early.getByRole('button', { name: 'Remove this template', exact: true })).toBeVisible();
    await expect(name).toBeFocused();
    await early.keyboard.insertText(`${title} updated`);
    const draft = await fields(early.getByRole('form', { name: 'Edit template', exact: true }));
    expect(draft).toMatchObject({ name: `${title} updated`, description: 'Change while loading', items: 'Gloves\nSnacks' });
    await early.getByRole('button', { name: 'Save template', exact: true }).click();
    const choice = early.getByRole('article', { name: draft.name, exact: true });
    await expect(choice).toContainText('Change while loading');
    const href = await choice.getByRole('link', { name: 'Use this template', exact: true }).getAttribute('href');
    const copy = await copyContext.newPage();
    await signIn(copy);
    await beforeHydration(copy, href!, '**/src/routes/lists/copy/**/+page.svelte*', async () => {
      await copy.getByLabel('Description (optional)').fill('Phone draft');
      await copy.getByLabel('Target date (optional)').fill('2099-11-30');
      await copy.getByLabel('Share with family').check();
      await copy.getByLabel('List name').selectText();
    });
    await expect(copy.getByLabel('List name')).toBeFocused();
    await copy.keyboard.insertText(`${title} copied`);
    const copyForm = copy.getByRole('form', { name: 'Create a fresh list', exact: true });
    expect(await fields(copyForm)).toMatchObject({ name: `${title} copied`, description: 'Phone draft', targetDate: '2099-11-30', shared: 'yes' });
    await copyForm.getByRole('button', { name: 'Create list', exact: true }).click();
    const header = copy.locator('header');
    await expect(header).toContainText(`${title} copied`);
    await expect(header).toContainText('Phone draft');
    await expect(header).toContainText('Shared with family · 2099-11-30');
    await expect(header).toContainText('0 of 2 items ready');
  } finally { await Promise.all([editContext.close(), copyContext.close()]); }
});
